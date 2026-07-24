import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { prisma } from "@personalise-kings/db";
import { Prisma } from "@prisma/client";
import * as z from "zod";
import { badRequest, ok, parseJson } from "../../../../../../lib/api";
import { consumePasskeyRateLimit } from "../../../../../../lib/passkey-rate-limit";
import { MAX_PASSKEYS_PER_USER, passkeyRelyingParty, webAuthnResponseSchema } from "../../../../../../lib/passkeys";
import { getAdminSession } from "../../../../../../lib/session";
import { requireSameOrigin } from "../../../../../../lib/same-origin";

const requestSchema = z.object({
  challengeId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  response: webAuthnResponseSchema
}).strict();
class PasskeyLimitError extends Error {}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const session = await getAdminSession();
  const retryAfter = consumePasskeyRateLimit(request, "registration_verify", session.userId);
  if (retryAfter) return ok({ error: "rate_limited" }, { status: 429, headers: { "retry-after": String(retryAfter) } });
  const parsed = await parseJson(request, requestSchema);
  if (parsed.error) return parsed.error;
  const challenge = await prisma.adminWebAuthnChallenge.findFirst({
    where: {
      id: parsed.data.challengeId,
      merchantId: session.merchantId,
      staffUserId: session.userId,
      ceremony: "registration",
      consumedAt: null,
      expiresAt: { gt: new Date() }
    }
  });
  if (!challenge) return badRequest("Passkey registration challenge is invalid or expired");

  let verification;
  try {
    const relyingParty = passkeyRelyingParty();
    verification = await verifyRegistrationResponse({
      response: parsed.data.response as unknown as RegistrationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: relyingParty.origin,
      expectedRPID: relyingParty.rpID,
      requireUserVerification: true
    });
  } catch {
    return badRequest("Passkey registration could not be verified");
  }
  if (!verification.verified) return badRequest("Passkey registration could not be verified");
  const info = verification.registrationInfo;
  const now = new Date();
  let created: { id: string; name: string; createdAt: Date } | null;
  try {
    created = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${session.userId}, 0))`);
      const count = await tx.staffPasskey.count({ where: { merchantId: session.merchantId, staffUserId: session.userId } });
      if (count >= MAX_PASSKEYS_PER_USER) throw new PasskeyLimitError();
      const consumed = await tx.adminWebAuthnChallenge.updateMany({
        where: { id: challenge.id, merchantId: session.merchantId, staffUserId: session.userId, ceremony: "registration", consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now }
      });
      if (consumed.count !== 1) return null;
      const passkey = await tx.staffPasskey.create({
        data: {
          merchantId: session.merchantId,
          staffUserId: session.userId,
          credentialId: info.credential.id,
          publicKey: Buffer.from(info.credential.publicKey),
          counter: BigInt(info.credential.counter),
          transports: info.credential.transports ?? [],
          deviceType: info.credentialDeviceType,
          backedUp: info.credentialBackedUp,
          name: parsed.data.name
        }
      });
      await tx.auditEvent.create({
        data: {
          merchantId: session.merchantId,
          actorUserId: session.userId,
          action: "auth.passkey_registered",
          targetType: "StaffPasskey",
          targetId: passkey.id,
          metadata: { name: passkey.name, deviceType: passkey.deviceType, backedUp: passkey.backedUp }
        }
      });
      return passkey;
    });
  } catch (error) {
    if (error instanceof PasskeyLimitError) {
      return ok({ error: "passkey_limit", message: `At most ${MAX_PASSKEYS_PER_USER} passkeys can be registered` }, { status: 409 });
    }
    throw error;
  }
  if (!created) return badRequest("Passkey registration challenge has already been used");
  return ok({ id: created.id, name: created.name, createdAt: created.createdAt });
}
