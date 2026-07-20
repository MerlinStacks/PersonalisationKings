import { prisma } from "@personalise-kings/db";
import { notFound, ok } from "../../../../../../lib/api";
import { writeAuditEvent } from "../../../../../../lib/audit";
import { requirePermission } from "../../../../../../lib/rbac";
import { requireSameOrigin } from "../../../../../../lib/same-origin";

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ storeId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_store");
  if (access.error) return access.error;
  const { storeId } = await params;

  const store = await prisma.store.findFirst({
    where: { id: storeId, merchantId: access.session.merchantId, type: "woocommerce" },
    include: { credential: { select: { id: true, source: true } } }
  });
  if (!store) return notFound("WooCommerce store not found");

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.wooCommerceAuthAttempt.updateMany({
      where: { storeId: store.id, callbackReceivedAt: null, cancelledAt: null },
      data: { cancelledAt: now }
    });
    await tx.storeCredential.deleteMany({ where: { storeId: store.id, merchantId: access.session.merchantId } });
    await tx.store.update({
      where: { id_merchantId: { id: store.id, merchantId: access.session.merchantId } },
      data: {
        credentialReference: null,
        connectionStatus: "revoked",
        connectionRevokedAt: now,
        connectionLastError: null
      }
    });
    await writeAuditEvent({
      merchantId: access.session.merchantId,
      actorUserId: access.session.userId,
      action: "store.credential_revoked",
      targetType: "Store",
      targetId: store.id,
      metadata: { provider: "woocommerce", hadCredential: Boolean(store.credential), source: store.credential?.source }
    }, tx);
  });

  return ok({ storeId: store.id, revoked: true });
}
