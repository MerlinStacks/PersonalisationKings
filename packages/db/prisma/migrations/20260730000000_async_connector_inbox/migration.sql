CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('pending', 'processing', 'processed', 'failed');

ALTER TABLE "WebhookDelivery"
  ADD COLUMN "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "claimedAt" TIMESTAMP(3),
  ADD COLUMN "claimToken" TEXT,
  ADD COLUMN "correlationId" TEXT;

UPDATE "WebhookDelivery"
SET "status" = CASE
  WHEN "processedAt" IS NOT NULL THEN 'processed'::"WebhookDeliveryStatus"
  WHEN "failedAt" IS NOT NULL THEN 'failed'::"WebhookDeliveryStatus"
  ELSE 'pending'::"WebhookDeliveryStatus"
END,
"processingStartedAt" = NULL;

CREATE INDEX "WebhookDelivery_status_nextAttemptAt_receivedAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt", "receivedAt");
CREATE INDEX "WebhookDelivery_status_claimedAt_idx" ON "WebhookDelivery"("status", "claimedAt");
CREATE INDEX "WebhookDelivery_merchantId_status_receivedAt_idx" ON "WebhookDelivery"("merchantId", "status", "receivedAt");
