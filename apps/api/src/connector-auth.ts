import { decryptStoreWebhookSecret } from "@personalise-kings/auth";
import { prisma } from "@personalise-kings/db";
import { createHmac, timingSafeEqual } from "node:crypto";

export async function authenticateStoreRequest(storeId: string, keyId: string, signature: string, rawBody: string) {
  const encryptionKey = process.env.PK_CONNECTOR_SECRET_ENCRYPTION_KEY;
  if (!encryptionKey) return { status: "not_configured" as const };

  const signingKey = await prisma.storeWebhookSigningKey.findFirst({
    where: { storeId, keyId, revokedAt: null, store: { connectionStatus: "connected" } },
    include: { store: true }
  });
  if (!signingKey) return { status: "invalid_key" as const };

  const secret = decryptStoreWebhookSecret(signingKey.secretEncrypted, encryptionKey, storeId, keyId);
  if (!secret) return { status: "not_configured" as const };
  if (!isValidHmac(signature, rawBody, secret)) return { status: "invalid_signature" as const };
  return { status: "authenticated" as const, store: signingKey.store, signingKey: { id: signingKey.id, keyId, retiredAt: signingKey.retiredAt } };
}

export function isValidHmac(signature: string, body: string, secret: string) {
  const received = signature.startsWith("sha256=") ? signature.slice(7) : "";
  if (!/^[0-9a-f]{64}$/.test(received)) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}
