import { buildTotpUri, decryptTotpSecret, encryptTotpSecret, generateTotpSecret } from "@personalise-kings/auth";
import { prisma } from "@personalise-kings/db";
import { ok } from "../../../../../lib/api";
import { adminMfaEncryptionKey } from "../../../../../lib/mfa";
import { getPendingAdminSession } from "../../../../../lib/session";
import { requireSameOrigin } from "../../../../../lib/same-origin";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const session = await getPendingAdminSession();
  if (!session || session.staffUser.mfaEnabled) return ok({ error: "invalid_mfa_session" }, { status: 401 });
  const key = adminMfaEncryptionKey();
  const existing = session.pendingTotpSecretEncrypted && session.pendingTotpExpiresAt && session.pendingTotpExpiresAt > new Date()
    ? decryptTotpSecret(session.pendingTotpSecretEncrypted, key, session.staffUser.id)
    : null;
  const secret = existing ?? generateTotpSecret();
  if (!existing) {
    await prisma.adminSession.update({
      where: { id: session.id },
      data: {
        pendingTotpSecretEncrypted: encryptTotpSecret(secret, key, session.staffUser.id),
        pendingTotpExpiresAt: new Date(Date.now() + 10 * 60_000)
      }
    });
  }
  return ok({ secret, otpauthUri: buildTotpUri("PersonaliseKings", session.staffUser.email, secret) }, { headers: { "cache-control": "no-store" } });
}
