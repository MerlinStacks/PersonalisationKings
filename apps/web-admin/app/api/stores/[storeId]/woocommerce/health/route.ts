import { prisma } from "@personalise-kings/db";
import { notFound, ok } from "../../../../../../lib/api";
import { writeAuditEvent } from "../../../../../../lib/audit";
import { requirePermission } from "../../../../../../lib/rbac";
import { requireSameOrigin } from "../../../../../../lib/same-origin";
import { checkWooCommerceCredentials, connectorEncryptionKeys, decryptWooCommerceCredentials } from "../../../../../../lib/woocommerce";

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ storeId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_store");
  if (access.error) return access.error;
  const { storeId } = await params;

  const store = await prisma.store.findFirst({
    where: { id: storeId, merchantId: access.session.merchantId, type: "woocommerce" },
    include: { credential: true }
  });
  if (!store) return notFound("WooCommerce store not found");
  if (!store.credential || store.connectionStatus === "revoked") {
    return ok({ error: "credentials_missing", message: "Connect or re-authorize this store first" }, { status: 409 });
  }

  let credentials;
  try {
    credentials = decryptWooCommerceCredentials(
      store.credential.encryptedPayload,
      connectorEncryptionKeys(),
      access.session.merchantId,
      store.id
    );
  } catch {
    return ok({ error: "credential_storage_unavailable", message: "Store credential encryption is not configured" }, { status: 503 });
  }

  const now = new Date();
  if (!credentials) {
    await recordHealthResult({
      storeId: store.id,
      merchantId: access.session.merchantId,
      actorUserId: access.session.userId,
      expectedCredentialId: store.credential.id,
      now,
      status: "failed",
      error: "Stored WooCommerce credentials could not be decrypted"
    });
    return ok({ healthy: false, message: "Stored WooCommerce credentials could not be decrypted" });
  }

  let health;
  try {
    health = await checkWooCommerceCredentials(store.url, credentials);
  } catch (error) {
    health = { healthy: false, error: error instanceof Error ? error.message : "The WooCommerce store could not be reached safely" };
  }
  const rejected = health.statusCode === 401 || health.statusCode === 403 || health.statusCode === 404
    || Boolean(health.statusCode && health.statusCode >= 300 && health.statusCode < 400);
  await recordHealthResult({
    storeId: store.id,
    merchantId: access.session.merchantId,
    actorUserId: access.session.userId,
    expectedCredentialId: store.credential.id,
    now,
    status: health.healthy ? "connected" : rejected ? "disconnected" : store.connectionStatus,
    error: health.healthy ? null : health.error ?? "WooCommerce health check failed",
    successful: health.healthy,
    statusCode: health.statusCode
  });

  return ok({ healthy: health.healthy, status: health.healthy ? "connected" : rejected ? "disconnected" : store.connectionStatus, message: health.error });
}

async function recordHealthResult(input: Readonly<{
  storeId: string;
  merchantId: string;
  actorUserId: string;
  expectedCredentialId: string;
  now: Date;
  status: "pending" | "connected" | "disconnected" | "revoked" | "failed";
  error: string | null;
  successful?: boolean;
  statusCode?: number;
}>) {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.store.updateMany({
      where: {
        id: input.storeId,
        merchantId: input.merchantId,
        credentialReference: input.expectedCredentialId,
        connectionStatus: { not: "revoked" }
      },
      data: {
        connectionStatus: input.status,
        connectionLastCheckedAt: input.now,
        connectionLastError: input.error,
        ...(input.successful
          ? { connectionLastSuccessfulAt: input.now }
          : { connectionLastFailedAt: input.now })
      }
    });
    if (updated.count !== 1) return;
    await writeAuditEvent({
      merchantId: input.merchantId,
      actorUserId: input.actorUserId,
      action: "store.connection_health_checked",
      targetType: "Store",
      targetId: input.storeId,
      metadata: { provider: "woocommerce", healthy: Boolean(input.successful), statusCode: input.statusCode, resultingStatus: input.status }
    }, tx);
  });
}
