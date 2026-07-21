import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export const STAFF_ROLES = ["owner_admin", "designer", "production_operator", "support", "auditor"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const PERMISSIONS = [
  "manage_store",
  "manage_design",
  "manage_staff",
  "download_artifact",
  "regenerate_artifact",
  "delete_asset",
  "view_order",
  "view_customisation",
  "view_audit"
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_LABELS: Record<StaffRole, string> = {
  owner_admin: "Owner/admin",
  designer: "Designer",
  production_operator: "Production operator",
  support: "Support",
  auditor: "Read-only auditor"
};

export const ROLE_PERMISSIONS = {
  owner_admin: ["manage_store", "manage_design", "manage_staff", "download_artifact", "regenerate_artifact", "delete_asset", "view_order", "view_customisation", "view_audit"],
  designer: ["manage_design"],
  production_operator: ["download_artifact", "regenerate_artifact", "view_order", "view_customisation"],
  support: ["view_order", "view_customisation"],
  auditor: ["view_order", "view_customisation", "view_audit"]
} as const satisfies Record<StaffRole, readonly Permission[]>;

export function roleCan(role: StaffRole, permission: Permission) {
  return ROLE_PERMISSIONS[role].some((allowed) => allowed === permission);
}

export interface EmbedTokenPayload {
  storeId: string;
  allowedOrigin: string;
  externalProductId: string;
  externalVariantId?: string;
  designId: string;
  designVersionId: string;
  expiresAt: number;
}

export function signEmbedToken(payload: EmbedTokenPayload, secret: string) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyEmbedToken(token: string, secret: string): EmbedTokenPayload | null {
  if (typeof token !== "string" || token.length > 8192 || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!isCanonicalBase64Url(body) || !isCanonicalBase64Url(signature, 32)) return null;

  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!safeEqual(signature, expected)) return null;

  const payload = parseJsonObject(body);
  if (!payload || !isNonEmptyString(payload.storeId) || !isExactOrigin(payload.allowedOrigin)
    || !isNonEmptyString(payload.externalProductId) || !isNonEmptyString(payload.designId)
    || !isNonEmptyString(payload.designVersionId)
    || (payload.externalVariantId !== undefined && !isNonEmptyString(payload.externalVariantId))
    || !Number.isSafeInteger(payload.expiresAt) || Number(payload.expiresAt) < Math.floor(Date.now() / 1000)) return null;

  return payload as unknown as EmbedTokenPayload;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, salt, hash] = storedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !hash) return false;

  const candidate = await scrypt(password, salt, 64) as Buffer;
  return safeEqual(candidate.toString("base64url"), hash);
}

export function generateSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateTotpSecret() {
  return encodeBase32(randomBytes(20));
}

export function buildTotpUri(issuer: string, account: string, secret: string) {
  const query = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?${query.toString()}`;
}

export function verifyTotp(code: string, secret: string, nowMs = Date.now(), driftSteps = 1): bigint | null {
  if (!/^\d{6}$/.test(code) || !Number.isSafeInteger(driftSteps) || driftSteps < 0 || driftSteps > 2) return null;
  let key: Uint8Array;
  try { key = decodeBase32(secret); } catch { return null; }
  const currentStep = BigInt(Math.floor(nowMs / 30_000));
  for (let drift = -driftSteps; drift <= driftSteps; drift += 1) {
    const step = currentStep + BigInt(drift);
    if (step < 0n) continue;
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(step);
    const digest = createHmac("sha1", key).update(counter).digest();
    const offset = digest[digest.length - 1]! & 0x0f;
    const value = ((digest[offset]! & 0x7f) << 24) | ((digest[offset + 1]! & 0xff) << 16)
      | ((digest[offset + 2]! & 0xff) << 8) | (digest[offset + 3]! & 0xff);
    const expected = String(value % 1_000_000).padStart(6, "0");
    if (safeEqual(code, expected)) return step;
  }
  return null;
}

export function generateRecoveryCodes(count = 10) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 20) throw new TypeError("Recovery code count must be between 1 and 20");
  return Array.from({ length: count }, () => randomBytes(16).toString("hex").toUpperCase().match(/.{1,4}/g)!.join("-"));
}

export function normalizeRecoveryCode(code: string) {
  return code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function hashRecoveryCode(code: string, pepper: string) {
  if (!pepper) throw new Error("Recovery code pepper must be configured");
  return createHmac("sha256", pepper).update(normalizeRecoveryCode(code)).digest("hex");
}

export function encryptTotpSecret(secret: string, encryptionKey: string, staffUserId: string) {
  if (!secret || !staffUserId) throw new Error("TOTP secret and staff user ID are required");
  const key = decodeEncryptionKey(encryptionKey, "PK_ADMIN_MFA_ENCRYPTION_KEY");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`staff-totp:${staffUserId}`));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `mfa-aes-256-gcm:v1:${nonce.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptTotpSecret(encrypted: string, encryptionKey: string, staffUserId: string) {
  const [algorithm, version, nonceValue, tagValue, ciphertextValue] = encrypted.split(":");
  if (algorithm !== "mfa-aes-256-gcm" || version !== "v1" || !nonceValue || !tagValue || !ciphertextValue) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", decodeEncryptionKey(encryptionKey, "PK_ADMIN_MFA_ENCRYPTION_KEY"), Buffer.from(nonceValue, "base64url"));
    decipher.setAAD(Buffer.from(`staff-totp:${staffUserId}`));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function encryptStoreWebhookSecret(secret: string, encryptionKey: string, storeId: string, keyId: string) {
  if (!secret || !storeId || !keyId) throw new Error("Webhook secret, store ID, and key ID are required");
  const key = decodeEncryptionKey(encryptionKey, "PK_CONNECTOR_SECRET_ENCRYPTION_KEY");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`store-webhook:${storeId}:${keyId}`));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `connector-aes-256-gcm:v2:${nonce.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptStoreWebhookSecret(encrypted: string, encryptionKey: string, storeId: string, keyId: string) {
  if (!encrypted.startsWith("connector-aes-256-gcm:")) return decryptConnectorSecret(encrypted, encryptionKey);
  const [algorithm, version, nonceValue, tagValue, ciphertextValue] = encrypted.split(":");
  if (algorithm !== "connector-aes-256-gcm" || version !== "v2" || !nonceValue || !tagValue || !ciphertextValue) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", decodeEncryptionKey(encryptionKey, "PK_CONNECTOR_SECRET_ENCRYPTION_KEY"), Buffer.from(nonceValue, "base64url"));
    decipher.setAAD(Buffer.from(`store-webhook:${storeId}:${keyId}`));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function encryptConnectorSecret(secret: string, encryptionKey: string) {
  if (!secret) throw new Error("Connector secret must not be empty");
  const key = decodeEncryptionKey(encryptionKey, "PK_CONNECTOR_SECRET_ENCRYPTION_KEY");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `aes-256-gcm:${nonce.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptConnectorSecret(encrypted: string, encryptionKey: string) {
  const [algorithm, nonceValue, tagValue, ciphertextValue] = encrypted.split(":");
  if (algorithm !== "aes-256-gcm" || !nonceValue || !tagValue || !ciphertextValue) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", decodeEncryptionKey(encryptionKey, "PK_CONNECTOR_SECRET_ENCRYPTION_KEY"), Buffer.from(nonceValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function decodeEncryptionKey(value: string, name: string) {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error(`${name} must be a base64-encoded 32-byte key`);
  return key;
}

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function encodeBase32(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += base32Alphabet[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(input: string) {
  const normalized = input.replace(/=+$/g, "").toUpperCase();
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) throw new TypeError("Invalid base32 value");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of normalized) {
    value = (value << 5) | base32Alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

function parseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function isCanonicalBase64Url(value: string, decodedLength?: number) {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return (decodedLength === undefined || decoded.length === decodedLength)
    && decoded.toString("base64url") === value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isExactOrigin(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}
