ALTER TABLE "GeneratedArtifact"
  ADD COLUMN "retentionHoldAt" TIMESTAMP(3),
  ADD COLUMN "retentionHoldUntil" TIMESTAMP(3),
  ADD COLUMN "retentionHoldReason" TEXT,
  ADD COLUMN "retentionHoldSetByUserId" TEXT;

CREATE INDEX "GeneratedArtifact_merchantId_retentionHoldAt_retentionHoldUntil_idx"
  ON "GeneratedArtifact"("merchantId", "retentionHoldAt", "retentionHoldUntil");
