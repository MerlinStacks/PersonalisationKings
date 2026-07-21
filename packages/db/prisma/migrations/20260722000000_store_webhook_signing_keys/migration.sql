-- AlterTable
ALTER TABLE "Store" ADD COLUMN "activeWebhookSigningKeyId" TEXT;

-- CreateTable
CREATE TABLE "StoreWebhookSigningKey" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "StoreWebhookSigningKey_pkey" PRIMARY KEY ("id")
);

-- Backfill complete legacy credentials without guessing partial pairs.
INSERT INTO "StoreWebhookSigningKey" ("id", "merchantId", "storeId", "keyId", "secretEncrypted", "createdAt")
SELECT 'legacy_' || md5("id" || ':' || "webhookSigningKeyId"), "merchantId", "id", "webhookSigningKeyId", "webhookSecretEncrypted", CURRENT_TIMESTAMP
FROM "Store"
WHERE "webhookSigningKeyId" IS NOT NULL AND "webhookSecretEncrypted" IS NOT NULL;

UPDATE "Store" SET "activeWebhookSigningKeyId" = "webhookSigningKeyId"
WHERE "webhookSigningKeyId" IS NOT NULL AND "webhookSecretEncrypted" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "StoreWebhookSigningKey_storeId_keyId_key" ON "StoreWebhookSigningKey"("storeId", "keyId");
CREATE INDEX "StoreWebhookSigningKey_storeId_revokedAt_idx" ON "StoreWebhookSigningKey"("storeId", "revokedAt");
CREATE INDEX "StoreWebhookSigningKey_merchantId_createdAt_idx" ON "StoreWebhookSigningKey"("merchantId", "createdAt");

-- AddForeignKey
ALTER TABLE "StoreWebhookSigningKey" ADD CONSTRAINT "StoreWebhookSigningKey_storeId_merchantId_fkey" FOREIGN KEY ("storeId", "merchantId") REFERENCES "Store"("id", "merchantId") ON DELETE CASCADE ON UPDATE CASCADE;
