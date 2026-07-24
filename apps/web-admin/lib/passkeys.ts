import * as z from "zod";
import { timingSafeEqual } from "node:crypto";

export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const PASSKEY_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const MAX_PASSKEYS_PER_USER = 10;

export const webAuthnResponseSchema = z.object({
  id: z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/),
  rawId: z.string().min(1).max(1024),
  type: z.literal("public-key"),
  response: z.record(z.string(), z.unknown()),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  authenticatorAttachment: z.string().optional()
}).passthrough();

export function passkeyRelyingParty(env: Record<string, string | undefined> = process.env) {
  const configured = env.PK_WEBAPP_URL
    ?? (env.NODE_ENV === "development" || env.NODE_ENV === "test" ? "http://localhost:3000" : null);
  if (!configured) throw new Error("PK_WEBAPP_URL is required for passkeys");
  const url = new URL(configured);
  if (!url.hostname || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PK_WEBAPP_URL must be an exact origin for passkeys");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) {
    throw new Error("Passkeys require HTTPS except on localhost");
  }
  return { rpID: url.hostname, origin: url.origin, rpName: "PersonaliseKings" };
}

export function passkeyUserId(merchantId: string, userId: string) {
  const value = new TextEncoder().encode(`${merchantId}:${userId}`);
  if (value.byteLength > 64) throw new Error("Passkey user identity exceeds the WebAuthn limit");
  return value;
}

export function matchesPasskeyUserHandle(userHandle: unknown, merchantId: string, userId: string) {
  if (userHandle === undefined || userHandle === null) return true;
  if (typeof userHandle !== "string" || !/^[A-Za-z0-9_-]+$/.test(userHandle)) return false;
  const expected = Buffer.from(passkeyUserId(merchantId, userId)).toString("base64url");
  return userHandle.length === expected.length && timingSafeEqual(Buffer.from(userHandle), Buffer.from(expected));
}
