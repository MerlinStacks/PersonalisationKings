import { randomUUID } from "node:crypto";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { prisma } from "@personalise-kings/db";
import { ok } from "../../../../../../lib/api";
import { consumePasskeyRateLimit } from "../../../../../../lib/passkey-rate-limit";
import { PASSKEY_CHALLENGE_TTL_MS, passkeyRelyingParty } from "../../../../../../lib/passkeys";
import { requireSameOrigin } from "../../../../../../lib/same-origin";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const retryAfter = consumePasskeyRateLimit(request, "authentication_options");
  if (retryAfter) return ok({ error: "rate_limited" }, { status: 429, headers: { "retry-after": String(retryAfter) } });
  const relyingParty = passkeyRelyingParty();
  const options = await generateAuthenticationOptions({
    rpID: relyingParty.rpID,
    timeout: PASSKEY_CHALLENGE_TTL_MS,
    userVerification: "required"
  });
  const challengeId = randomUUID();
  const now = new Date();
  await prisma.$transaction([
    prisma.adminWebAuthnChallenge.deleteMany({ where: { staffUserId: null, expiresAt: { lte: now } } }),
    prisma.adminWebAuthnChallenge.create({
      data: {
        id: challengeId,
        ceremony: "authentication",
        challenge: options.challenge,
        expiresAt: new Date(now.getTime() + PASSKEY_CHALLENGE_TTL_MS)
      }
    })
  ]);
  return ok({ challengeId, options }, { headers: { "cache-control": "no-store" } });
}
