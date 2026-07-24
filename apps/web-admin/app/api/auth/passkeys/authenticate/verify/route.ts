import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { generateSessionToken, hashSessionToken } from "@personalise-kings/auth";
import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { badRequest, ok, parseJson } from "../../../../../../lib/api";
import { consumePasskeyRateLimit } from "../../../../../../lib/passkey-rate-limit";
import { matchesPasskeyUserHandle, PASSKEY_SESSION_TTL_MS, passkeyRelyingParty, webAuthnResponseSchema } from "../../../../../../lib/passkeys";
import { setOpaqueSessionCookie } from "../../../../../../lib/session";
import { requireSameOrigin } from "../../../../../../lib/same-origin";

const requestSchema = z.object({ challengeId: z.string().uuid(), response: webAuthnResponseSchema }).strict();
class PasskeyStateChangedError extends Error {}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const retryAfter = consumePasskeyRateLimit(request, "authentication_verify");
  if (retryAfter) return ok({ error: "rate_limited" }, { status: 429, headers: { "retry-after": String(retryAfter) } });
  const parsed = await parseJson(request, requestSchema);
  if (parsed.error) return parsed.error;
  const [challenge, passkey] = await Promise.all([
    prisma.adminWebAuthnChallenge.findFirst({
      where: { id: parsed.data.challengeId, ceremony: "authentication", staffUserId: null, consumedAt: null, expiresAt: { gt: new Date() } }
    }),
    prisma.staffPasskey.findUnique({ where: { credentialId: parsed.data.response.id }, include: { staffUser: true } })
  ]);
  if (!challenge || !passkey || !passkey.staffUser.mfaEnabled || !passkey.staffUser.totpSecretEncrypted) {
    return badRequest("Passkey authentication is invalid or expired");
  }
  if (!matchesPasskeyUserHandle(parsed.data.response.response.userHandle, passkey.merchantId, passkey.staffUserId)) {
    return badRequest("Passkey authentication is invalid or expired");
  }

  let verification;
  try {
    const relyingParty = passkeyRelyingParty();
    verification = await verifyAuthenticationResponse({
      response: parsed.data.response as unknown as AuthenticationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: relyingParty.origin,
      expectedRPID: relyingParty.rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.counter),
        transports: passkey.transports as AuthenticatorTransportFuture[]
      },
      requireUserVerification: true
    });
  } catch {
    return badRequest("Passkey authentication could not be verified");
  }
  if (!verification.verified) return badRequest("Passkey authentication could not be verified");

  const now = new Date();
  const expiresAt = new Date(now.getTime() + PASSKEY_SESSION_TTL_MS);
  const token = generateSessionToken();
  try {
    await prisma.$transaction(async (tx) => {
      const consumed = await tx.adminWebAuthnChallenge.updateMany({
        where: { id: challenge.id, ceremony: "authentication", staffUserId: null, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now }
      });
      if (consumed.count !== 1) throw new PasskeyStateChangedError();
      const advanced = await tx.staffPasskey.updateMany({
        where: { id: passkey.id, merchantId: passkey.merchantId, counter: passkey.counter },
        data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: now }
      });
      if (advanced.count !== 1) throw new PasskeyStateChangedError();
      await tx.adminSession.create({
        data: {
          staffUserId: passkey.staffUserId,
          tokenHash: hashSessionToken(token),
          mfaVerifiedAt: now,
          expiresAt,
          userAgent: (request.headers.get("user-agent") ?? "Unknown device").slice(0, 300)
        }
      });
      await tx.auditEvent.create({
        data: {
          merchantId: passkey.merchantId,
          actorUserId: passkey.staffUserId,
          action: "auth.passkey_login",
          targetType: "StaffPasskey",
          targetId: passkey.id,
          metadata: { deviceType: passkey.deviceType, backedUp: passkey.backedUp }
        }
      });
    });
  } catch (error) {
    if (error instanceof PasskeyStateChangedError) return badRequest("Passkey authentication challenge has already been used");
    throw error;
  }
  await setOpaqueSessionCookie(token, expiresAt);
  return ok({ authenticated: true });
}
