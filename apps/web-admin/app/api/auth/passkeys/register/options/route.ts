import { randomUUID } from "node:crypto";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { prisma } from "@personalise-kings/db";
import { ok } from "../../../../../../lib/api";
import { consumePasskeyRateLimit } from "../../../../../../lib/passkey-rate-limit";
import { MAX_PASSKEYS_PER_USER, PASSKEY_CHALLENGE_TTL_MS, passkeyRelyingParty, passkeyUserId } from "../../../../../../lib/passkeys";
import { getAdminSession } from "../../../../../../lib/session";
import { requireSameOrigin } from "../../../../../../lib/same-origin";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const session = await getAdminSession();
  const retryAfter = consumePasskeyRateLimit(request, "registration_options", session.userId);
  if (retryAfter) return ok({ error: "rate_limited" }, { status: 429, headers: { "retry-after": String(retryAfter) } });
  const existing = await prisma.staffPasskey.findMany({
    where: { merchantId: session.merchantId, staffUserId: session.userId },
    select: { credentialId: true, transports: true }
  });
  if (existing.length >= MAX_PASSKEYS_PER_USER) {
    return ok({ error: "passkey_limit", message: `At most ${MAX_PASSKEYS_PER_USER} passkeys can be registered` }, { status: 409 });
  }
  const relyingParty = passkeyRelyingParty();
  const options = await generateRegistrationOptions({
    rpName: relyingParty.rpName,
    rpID: relyingParty.rpID,
    userName: session.email,
    userDisplayName: session.email,
    userID: passkeyUserId(session.merchantId, session.userId),
    timeout: PASSKEY_CHALLENGE_TTL_MS,
    attestationType: "none",
    excludeCredentials: existing.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports as AuthenticatorTransportFuture[]
    })),
    authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" }
  });
  const challengeId = randomUUID();
  const now = new Date();
  await prisma.$transaction([
    prisma.adminWebAuthnChallenge.deleteMany({
      where: { staffUserId: session.userId, merchantId: session.merchantId, ceremony: "registration" }
    }),
    prisma.adminWebAuthnChallenge.create({
      data: {
        id: challengeId,
        merchantId: session.merchantId,
        staffUserId: session.userId,
        ceremony: "registration",
        challenge: options.challenge,
        expiresAt: new Date(now.getTime() + PASSKEY_CHALLENGE_TTL_MS)
      }
    })
  ]);
  return ok({ challengeId, options }, { headers: { "cache-control": "no-store" } });
}
