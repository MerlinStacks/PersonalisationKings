import { decryptTotpSecret, generateRecoveryCodes, hashRecoveryCode, verifyTotp } from "@personalise-kings/auth";
import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { ok, parseJson } from "../../../../../lib/api";
import { writeAuditEvent } from "../../../../../lib/audit";
import { adminMfaEncryptionKey, adminRecoveryCodePepper } from "../../../../../lib/mfa";
import { completeAdminSession, getPendingAdminSession } from "../../../../../lib/session";
import { requireSameOrigin } from "../../../../../lib/same-origin";

const schema = z.object({ code: z.string().regex(/^\d{6}$/) });

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const session = await getPendingAdminSession();
  if (!session || session.staffUser.mfaEnabled || !session.pendingTotpSecretEncrypted
    || !session.pendingTotpExpiresAt || session.pendingTotpExpiresAt <= new Date()) return ok({ error: "invalid_mfa_session" }, { status: 401 });
  const secret = decryptTotpSecret(session.pendingTotpSecretEncrypted, adminMfaEncryptionKey(), session.staffUser.id);
  const step = secret ? verifyTotp(parsed.data.code, secret) : null;
  if (step === null) return ok({ error: "invalid_mfa_code" }, { status: 401 });
  const codes = generateRecoveryCodes();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const enabled = await tx.staffUser.updateMany({
      where: { id: session.staffUser.id, mfaEnabled: false },
      data: { mfaEnabled: true, mfaEnabledAt: now, totpSecretEncrypted: session.pendingTotpSecretEncrypted, totpLastUsedStep: step }
    });
    if (enabled.count !== 1) throw new Error("MFA enrollment was already completed");
    await tx.staffRecoveryCode.createMany({
      data: codes.map((code) => ({ staffUserId: session.staffUser.id, codeHash: hashRecoveryCode(code, adminRecoveryCodePepper()) }))
    });
    await writeAuditEvent({
      merchantId: session.staffUser.merchantId,
      actorUserId: session.staffUser.id,
      action: "auth.mfa_enrolled",
      targetType: "StaffUser",
      targetId: session.staffUser.id,
      metadata: { recoveryCodeCount: codes.length }
    }, tx);
    await writeAuditEvent({
      merchantId: session.staffUser.merchantId,
      actorUserId: session.staffUser.id,
      action: "auth.login",
      targetType: "AdminSession",
      targetId: session.id,
      metadata: { method: "totp_enrollment" }
    }, tx);
  });
  await completeAdminSession(session.id);
  return ok({ recoveryCodes: codes }, { headers: { "cache-control": "no-store" } });
}
