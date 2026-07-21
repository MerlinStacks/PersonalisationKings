import { encryptStoreWebhookSecret } from "@personalise-kings/auth";
import { prisma } from "@personalise-kings/db";
import { randomBytes } from "node:crypto";

export async function rotateStoreSigningKey(storeId: string, merchantId: string) {
  const encryptionKey = process.env.PK_CONNECTOR_SECRET_ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error("Connector secret encryption is not configured");
  const keyId = `pk_${randomBytes(16).toString("base64url")}`;
  const secret = randomBytes(32).toString("base64url");
  const encrypted = encryptStoreWebhookSecret(secret, encryptionKey, storeId, keyId);
  const result = await prisma.$transaction(async (tx) => {
    const store = await tx.store.findFirst({ where: { id: storeId, merchantId } });
    if (!store) return null;
    const now = new Date();
    if (store.activeWebhookSigningKeyId) {
      await tx.storeWebhookSigningKey.updateMany({
        where: { storeId, keyId: store.activeWebhookSigningKeyId, revokedAt: null, retiredAt: null },
        data: { retiredAt: now }
      });
    }
    const signingKey = await tx.storeWebhookSigningKey.create({
      data: { merchantId, storeId, keyId, secretEncrypted: encrypted }
    });
    await tx.store.update({
      where: { id_merchantId: { id: storeId, merchantId } },
      data: { activeWebhookSigningKeyId: keyId, webhookSigningKeyId: keyId, webhookSecretEncrypted: encrypted }
    });
    return { signingKey, previousKeyId: store.activeWebhookSigningKeyId };
  }, { isolationLevel: "Serializable" });
  return result ? { ...result, secret } : null;
}

export async function revokeRetiredSigningKey(storeId: string, merchantId: string, keyId: string) {
  const store = await prisma.store.findFirst({ where: { id: storeId, merchantId }, select: { activeWebhookSigningKeyId: true } });
  if (!store || store.activeWebhookSigningKeyId === keyId) return false;
  const revoked = await prisma.storeWebhookSigningKey.updateMany({
    where: { storeId, merchantId, keyId, retiredAt: { not: null }, revokedAt: null },
    data: { revokedAt: new Date() }
  });
  return revoked.count === 1;
}
