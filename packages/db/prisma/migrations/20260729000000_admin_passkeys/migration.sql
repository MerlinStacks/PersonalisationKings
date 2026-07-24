CREATE TYPE "WebAuthnCeremony" AS ENUM ('registration', 'authentication');

CREATE UNIQUE INDEX "StaffUser_id_merchantId_key" ON "StaffUser"("id", "merchantId");

CREATE TABLE "StaffPasskey" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "credentialId" VARCHAR(1024) NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL,
    "transports" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "StaffPasskey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminWebAuthnChallenge" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT,
    "staffUserId" TEXT,
    "ceremony" "WebAuthnCeremony" NOT NULL,
    "challenge" VARCHAR(256) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    CONSTRAINT "AdminWebAuthnChallenge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AdminWebAuthnChallenge_ownership_check" CHECK (
        ("ceremony" = 'registration' AND "merchantId" IS NOT NULL AND "staffUserId" IS NOT NULL)
        OR ("ceremony" = 'authentication' AND "merchantId" IS NULL AND "staffUserId" IS NULL)
    )
);

CREATE UNIQUE INDEX "StaffPasskey_credentialId_key" ON "StaffPasskey"("credentialId");
CREATE INDEX "StaffPasskey_merchantId_staffUserId_createdAt_idx" ON "StaffPasskey"("merchantId", "staffUserId", "createdAt");
CREATE UNIQUE INDEX "AdminWebAuthnChallenge_challenge_key" ON "AdminWebAuthnChallenge"("challenge");
CREATE INDEX "AdminWebAuthnChallenge_expiresAt_consumedAt_idx" ON "AdminWebAuthnChallenge"("expiresAt", "consumedAt");
CREATE INDEX "AdminWebAuthnChallenge_staffUserId_ceremony_expiresAt_idx" ON "AdminWebAuthnChallenge"("staffUserId", "ceremony", "expiresAt");

ALTER TABLE "StaffPasskey" ADD CONSTRAINT "StaffPasskey_staffUserId_merchantId_fkey"
    FOREIGN KEY ("staffUserId", "merchantId") REFERENCES "StaffUser"("id", "merchantId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdminWebAuthnChallenge" ADD CONSTRAINT "AdminWebAuthnChallenge_staffUserId_merchantId_fkey"
    FOREIGN KEY ("staffUserId", "merchantId") REFERENCES "StaffUser"("id", "merchantId") ON DELETE CASCADE ON UPDATE CASCADE;
