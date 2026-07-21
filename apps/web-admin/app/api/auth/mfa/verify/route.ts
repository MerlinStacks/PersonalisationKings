import { decryptTotpSecret, hashRecoveryCode, verifyTotp } from "@personalise-kings/auth";
import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { ok, parseJson } from "../../../../../lib/api";
import { writeAuditEvent } from "../../../../../lib/audit";
import { adminMfaEncryptionKey, adminRecoveryCodePepper } from "../../../../../lib/mfa";
import { completeAdminSession, getPendingAdminSession } from "../../../../../lib/session";
import { requireSameOrigin } from "../../../../../lib/same-origin";

const schema = z.object({ code: z.string().min(6).max(40), recovery: z.boolean().default(false) });

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const session = await getPendingAdminSession();
  if (!session || !session.staffUser.mfaEnabled || !session.staffUser.totpSecretEncrypted) return ok({ error: "invalid_mfa_session" }, { status: 401 });

  let method: "totp" | "recovery_code";
  if (parsed.data.recovery) {
    const hash = hashRecoveryCode(parsed.data.code, adminRecoveryCodePepper());
    const consumed = await prisma.staffRecoveryCode.updateMany({
      where: { staffUserId: session.staffUser.id, codeHash: hash, usedAt: null },
      data: { usedAt: new Date() }
    });
    if (consumed.count !== 1) return ok({ error: "invalid_mfa_code" }, { status: 401 });
    method = "recovery_code";
  } else {
    const secret = decryptTotpSecret(session.staffUser.totpSecretEncrypted, adminMfaEncryptionKey(), session.staffUser.id);
    const step = secret ? verifyTotp(parsed.data.code, secret) : null;
    if (step === null) return ok({ error: "invalid_mfa_code" }, { status: 401 });
    const advanced = await prisma.staffUser.updateMany({
      where: { id: session.staffUser.id, OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }] },
      data: { totpLastUsedStep: step }
    });
    if (advanced.count !== 1) return ok({ error: "mfa_code_replayed" }, { status: 409 });
    method = "totp";
  }
  await completeAdminSession(session.id);
  await writeAuditEvent({
    merchantId: session.staffUser.merchantId,
    actorUserId: session.staffUser.id,
    action: method === "totp" ? "auth.login" : "auth.recovery_code_used",
    targetType: "AdminSession",
    targetId: session.id,
    metadata: { method }
  });
  return ok({ authenticated: true }, { headers: { "cache-control": "no-store" } });
}
