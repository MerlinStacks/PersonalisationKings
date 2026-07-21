export function adminMfaEncryptionKey() {
  const value = process.env.PK_ADMIN_MFA_ENCRYPTION_KEY;
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("PK_ADMIN_MFA_ENCRYPTION_KEY is required in production");
  return Buffer.alloc(32, 11).toString("base64");
}

export function adminRecoveryCodePepper() {
  const value = process.env.PK_ADMIN_RECOVERY_CODE_PEPPER;
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("PK_ADMIN_RECOVERY_CODE_PEPPER is required in production");
  return "dev-recovery-code-pepper-change-me";
}
