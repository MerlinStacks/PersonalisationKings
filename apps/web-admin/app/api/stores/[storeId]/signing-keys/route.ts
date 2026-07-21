import { prisma } from "@personalise-kings/db";
import { notFound, ok } from "../../../../../lib/api";
import { writeAuditEvent } from "../../../../../lib/audit";
import { requirePermission } from "../../../../../lib/rbac";
import { requireSameOrigin } from "../../../../../lib/same-origin";
import { rotateStoreSigningKey } from "../../../../../lib/store-signing-keys";

export async function GET(_request: Request, { params }: Readonly<{ params: Promise<{ storeId: string }> }>) {
  const access = await requirePermission("manage_store");
  if (access.error) return access.error;
  const { storeId } = await params;
  const store = await prisma.store.findFirst({
    where: { id: storeId, merchantId: access.session.merchantId },
    select: {
      activeWebhookSigningKeyId: true,
      webhookSigningKeys: { orderBy: { createdAt: "desc" }, select: { keyId: true, createdAt: true, retiredAt: true, revokedAt: true } }
    }
  });
  if (!store) return notFound("Store not found");
  return ok({ activeKeyId: store.activeWebhookSigningKeyId, keys: store.webhookSigningKeys }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ storeId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_store");
  if (access.error) return access.error;
  const { storeId } = await params;
  const rotated = await rotateStoreSigningKey(storeId, access.session.merchantId);
  if (!rotated) return notFound("Store not found");
  await writeAuditEvent({
    merchantId: access.session.merchantId,
    actorUserId: access.session.userId,
    action: rotated.previousKeyId ? "store.signing_key_rotated" : "store.signing_key_created",
    targetType: "Store",
    targetId: storeId,
    metadata: { keyId: rotated.signingKey.keyId, previousKeyId: rotated.previousKeyId }
  });
  return ok({ keyId: rotated.signingKey.keyId, secret: rotated.secret }, { status: 201, headers: { "cache-control": "no-store" } });
}
