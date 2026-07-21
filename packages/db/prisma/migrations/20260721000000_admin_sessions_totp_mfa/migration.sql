-- AlterTable
ALTER TABLE "StaffUser"
    ADD COLUMN "mfaEnabledAt" TIMESTAMP(3),
    ADD COLUMN "totpSecretEncrypted" TEXT,
    ADD COLUMN "totpLastUsedStep" BIGINT;

-- The previous flag was informational and had no enrolled secret behind it.
UPDATE "StaffUser" SET "mfaEnabled" = FALSE WHERE "mfaEnabled" = TRUE;

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "mfaVerifiedAt" TIMESTAMP(3),
    "pendingTotpSecretEncrypted" TEXT,
    "pendingTotpExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffRecoveryCode" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    CONSTRAINT "StaffRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");
CREATE INDEX "AdminSession_staffUserId_revokedAt_expiresAt_idx" ON "AdminSession"("staffUserId", "revokedAt", "expiresAt");
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");
CREATE UNIQUE INDEX "StaffRecoveryCode_codeHash_key" ON "StaffRecoveryCode"("codeHash");
CREATE INDEX "StaffRecoveryCode_staffUserId_usedAt_idx" ON "StaffRecoveryCode"("staffUserId", "usedAt");

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffRecoveryCode" ADD CONSTRAINT "StaffRecoveryCode_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddConstraint
ALTER TABLE "StaffUser" ADD CONSTRAINT "StaffUser_mfa_configuration_check" CHECK (
  ("mfaEnabled" = FALSE AND "totpSecretEncrypted" IS NULL AND "mfaEnabledAt" IS NULL)
  OR
  ("mfaEnabled" = TRUE AND "totpSecretEncrypted" IS NOT NULL AND "mfaEnabledAt" IS NOT NULL)
);
