import { roleCan } from "@personalise-kings/auth";
import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { badRequest, ok } from "../../../../../lib/api";
import { writeAuditEvent } from "../../../../../lib/audit";
import { persistStoreCredential } from "../../../../../lib/store-credentials";
import { connectorEncryptionKeys, encryptWooCommerceCredentials } from "../../../../../lib/woocommerce";

const MAX_CALLBACK_BYTES = 16 * 1_024;
const callbackSchema = z.object({
  key_id: z.union([z.string().min(1).max(100), z.number().int().nonnegative()]).transform(String),
  user_id: z.string().min(20).max(200),
  consumer_key: z.string().min(1).max(200).startsWith("ck_"),
  consumer_secret: z.string().min(1).max(200).startsWith("cs_"),
  key_permissions: z.literal("read")
}).strict();

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_CALLBACK_BYTES) return badRequest("WooCommerce callback payload is too large");

  let rawBody: string;
  try {
    rawBody = await readLimitedBody(request, MAX_CALLBACK_BYTES);
  } catch {
    return badRequest("WooCommerce callback payload is too large");
  }

  let payload: z.infer<typeof callbackSchema>;
  try {
    payload = callbackSchema.parse(JSON.parse(rawBody));
  } catch {
    return badRequest("Invalid WooCommerce authorization callback");
  }

  const attempt = await prisma.wooCommerceAuthAttempt.findUnique({
    where: { id: payload.user_id },
    include: { store: { select: { id: true, merchantId: true, type: true, url: true } } }
  });
  const now = new Date();
  if (!attempt || attempt.store.type !== "woocommerce" || attempt.expiresAt <= now
    || attempt.callbackReceivedAt || attempt.cancelledAt) {
    return badRequest("WooCommerce authorization attempt is invalid or expired");
  }
  const actor = await prisma.staffUser.findFirst({
    where: { id: attempt.actorUserId, merchantId: attempt.merchantId },
    select: { role: true }
  });
  if (!actor || !roleCan(actor.role, "manage_store")) {
    return badRequest("WooCommerce authorization attempt is no longer authorized");
  }

  let encryptedPayload: string;
  try {
    encryptedPayload = encryptWooCommerceCredentials({
      consumerKey: payload.consumer_key,
      consumerSecret: payload.consumer_secret
    }, connectorEncryptionKeys(), attempt.merchantId, attempt.storeId);
  } catch {
    return ok({ error: "credential_storage_unavailable", message: "Store credential encryption is not configured" }, { status: 503 });
  }

  const saved = await prisma.$transaction(async (tx) => {
    const currentActor = await tx.staffUser.findFirst({
      where: { id: attempt.actorUserId, merchantId: attempt.merchantId },
      select: { role: true }
    });
    if (!currentActor || !roleCan(currentActor.role, "manage_store")) return null;
    const claimed = await tx.wooCommerceAuthAttempt.updateMany({
      where: {
        id: attempt.id,
        callbackReceivedAt: null,
        cancelledAt: null,
        expiresAt: { gt: now }
      },
      data: { callbackReceivedAt: now }
    });
    if (claimed.count !== 1) return null;

    const result = await persistStoreCredential(tx, {
      merchantId: attempt.merchantId,
      storeId: attempt.storeId,
      encryptedPayload,
      externalKeyId: payload.key_id,
      permissions: payload.key_permissions,
      source: "woocommerce_auth"
    });
    await writeAuditEvent({
      merchantId: attempt.merchantId,
      actorUserId: attempt.actorUserId,
      action: result.rotated ? "store.credential_rotated" : "store.connected",
      targetType: "Store",
      targetId: attempt.storeId,
      metadata: { provider: "woocommerce", source: "native_authorization", permissions: payload.key_permissions }
    }, tx);
    return result;
  });

  if (!saved) return badRequest("WooCommerce authorization attempt has already been used");
  return ok({ success: true });
}

async function readLimitedBody(request: Request, limit: number) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Payload too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}
