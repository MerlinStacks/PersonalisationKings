import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
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
  owner_admin: ["manage_store", "manage_design", "manage_staff", "download_artifact", "regenerate_artifact", "delete_asset", "view_audit"],
  designer: ["manage_design"],
  production_operator: ["download_artifact", "regenerate_artifact"],
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

export interface AdminSessionPayload {
  merchantId: string;
  userId: string;
  role: StaffRole;
  expiresAt: number;
}

export function signAdminSession(payload: AdminSessionPayload, secret: string) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyAdminSession(token: string, secret: string): AdminSessionPayload | null {
  if (typeof token !== "string" || token.length > 8192 || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!isCanonicalBase64Url(body) || !isCanonicalBase64Url(signature, 32)) return null;

  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!safeEqual(signature, expected)) return null;

  const payload = parseJsonObject(body);
  if (!payload || !isNonEmptyString(payload.merchantId) || !isNonEmptyString(payload.userId)
    || !Number.isSafeInteger(payload.expiresAt) || Number(payload.expiresAt) < Math.floor(Date.now() / 1000)
    || typeof payload.role !== "string" || !STAFF_ROLES.includes(payload.role as StaffRole)) return null;

  return payload as unknown as AdminSessionPayload;
}

export function encryptConnectorSecret(secret: string, encryptionKey: string) {
  if (!secret) throw new Error("Connector secret must not be empty");
  const key = decodeEncryptionKey(encryptionKey);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `aes-256-gcm:${nonce.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptConnectorSecret(encrypted: string, encryptionKey: string) {
  const [algorithm, nonceValue, tagValue, ciphertextValue] = encrypted.split(":");
  if (algorithm !== "aes-256-gcm" || !nonceValue || !tagValue || !ciphertextValue) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", decodeEncryptionKey(encryptionKey), Buffer.from(nonceValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function decodeEncryptionKey(value: string) {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("PK_CONNECTOR_SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
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
