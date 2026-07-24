import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { badRequest, notFound, ok, parseJson } from "../../../../../lib/api";
import { writeAuditEvent } from "../../../../../lib/audit";
import { requirePermission } from "../../../../../lib/rbac";
import { requireSameOrigin } from "../../../../../lib/same-origin";
import { persistStoreCredential } from "../../../../../lib/store-credentials";
import { checkWooCommerceCredentials, connectorEncryptionKeys, encryptWooCommerceCredentials, normalizeWooCommerceStoreUrl } from "../../../../../lib/woocommerce";

const manualCredentialSchema = z.object({
  storeId: z.string().min(1).max(200).optional(),
  url: z.string().min(1).max(2_048).optional(),
  consumerKey: z.string().min(1).max(200).startsWith("ck_"),
  consumerSecret: z.string().min(1).max(200).startsWith("cs_")
}).strict().refine((value) => Boolean(value.storeId) !== Boolean(value.url), {
  message: "Provide either a store ID or a store URL"
});

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_store");
  if (access.error) return access.error;
  const parsed = await parseJson(request, manualCredentialSchema);
  if (parsed.error) return parsed.error;

  const requestedStore = parsed.data.storeId ? await prisma.store.findFirst({
    where: { id: parsed.data.storeId, merchantId: access.session.merchantId },
    select: { id: true, type: true, url: true }
  }) : null;
  if (parsed.data.storeId && !requestedStore) return notFound("Store not found");
  if (requestedStore?.type !== undefined && requestedStore.type !== "woocommerce") {
    return badRequest("Only WooCommerce stores accept WooCommerce REST API credentials");
  }

  let storeUrl: string;
  let encryptionKeys: ReturnType<typeof connectorEncryptionKeys>;
  try {
    storeUrl = normalizeWooCommerceStoreUrl(requestedStore?.url ?? parsed.data.url ?? "");
    encryptionKeys = connectorEncryptionKeys();
  } catch (error) {
    const message = error instanceof Error ? error.message : "The WooCommerce credentials could not be prepared";
    const configurationError = message.includes("PK_CONNECTOR_SECRET_ENCRYPTION") || message.includes("wrapping key") || message.includes("base64-encoded 32-byte key");
    return configurationError
      ? ok({ error: "credential_storage_unavailable", message: "Store credential encryption is not configured" }, { status: 503 })
      : badRequest(message);
  }

  let health;
  try {
    health = await checkWooCommerceCredentials(storeUrl, {
      consumerKey: parsed.data.consumerKey,
      consumerSecret: parsed.data.consumerSecret
    });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "The WooCommerce store could not be reached safely");
  }
  if (!health.healthy) {
    return ok({ error: "connection_failed", message: health.error ?? "WooCommerce rejected the credentials" }, { status: 422 });
  }

  const existingStore = requestedStore ?? await prisma.store.findUnique({
    where: {
      merchantId_type_url: {
        merchantId: access.session.merchantId,
        type: "woocommerce",
        url: storeUrl
      }
    },
    select: { id: true, type: true, url: true }
  });
  const now = new Date();
  const saved = await prisma.$transaction(async (tx) => {
    if (existingStore) {
      await tx.wooCommerceAuthAttempt.updateMany({
        where: { storeId: existingStore.id, callbackReceivedAt: null, cancelledAt: null },
        data: { cancelledAt: now }
      });
    }
    const store = existingStore
      ? await tx.store.update({
        where: { id_merchantId: { id: existingStore.id, merchantId: access.session.merchantId } },
        data: { url: storeUrl }
      })
      : await tx.store.upsert({
        where: {
          merchantId_type_url: {
            merchantId: access.session.merchantId,
            type: "woocommerce",
            url: storeUrl
          }
        },
        update: {},
        create: {
          merchantId: access.session.merchantId,
          type: "woocommerce",
          url: storeUrl,
          connectionStatus: "pending"
        }
      });
    const encryptedPayload = encryptWooCommerceCredentials({
      consumerKey: parsed.data.consumerKey,
      consumerSecret: parsed.data.consumerSecret
    }, encryptionKeys, access.session.merchantId, store.id);
    if (!existingStore) {
      await tx.wooCommerceAuthAttempt.updateMany({
        where: { storeId: store.id, callbackReceivedAt: null, cancelledAt: null },
        data: { cancelledAt: now }
      });
    }
    const result = await persistStoreCredential(tx, {
      merchantId: access.session.merchantId,
      storeId: store.id,
      encryptedPayload,
      permissions: "unknown",
      source: "manual",
      verifiedAt: now
    });
    await writeAuditEvent({
      merchantId: access.session.merchantId,
      actorUserId: access.session.userId,
      action: result.rotated ? "store.credential_rotated" : "store.connected",
      targetType: "Store",
      targetId: store.id,
      metadata: { provider: "woocommerce", source: "manual", healthStatus: health.statusCode }
    }, tx);
    return { storeId: store.id, rotated: result.rotated };
  });

  return ok({ ...saved, connected: true });
}
