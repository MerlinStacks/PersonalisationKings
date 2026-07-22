BEGIN;

LOCK TABLE "GeneratedArtifact" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "GeneratedArtifact"
  ADD COLUMN "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
  ADD COLUMN "bytesDeletedAt" TIMESTAMP(3),
  ADD COLUMN "cleanupClaimedAt" TIMESTAMP(3),
  ADD COLUMN "cleanupClaimToken" TEXT,
  ADD COLUMN "cleanupAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextCleanupAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastCleanupError" TEXT,
  ADD COLUMN "downloadLeaseUntil" TIMESTAMP(3);

UPDATE "GeneratedArtifact"
SET "contentType" = CASE
  WHEN LOWER("artifactType") LIKE '%pdf%' THEN 'application/pdf'
  WHEN LOWER("artifactType") LIKE '%png%' THEN 'image/png'
  WHEN LOWER("artifactType") LIKE '%svg%' THEN 'image/svg+xml'
  ELSE 'application/octet-stream'
END;

CREATE UNIQUE INDEX "PrintJobAttempt_id_merchantId_key" ON "PrintJobAttempt"("id", "merchantId");
CREATE UNIQUE INDEX "OrderArtworkSnapshot_id_merchantId_key" ON "OrderArtworkSnapshot"("id", "merchantId");
CREATE UNIQUE INDEX "PrintJob_id_merchantId_key" ON "PrintJob"("id", "merchantId");
CREATE UNIQUE INDEX "GeneratedArtifact_objectKey_key" ON "GeneratedArtifact"("objectKey");
CREATE INDEX "GeneratedArtifact_merchantId_bytesDeletedAt_createdAt_idx" ON "GeneratedArtifact"("merchantId", "bytesDeletedAt", "createdAt");
CREATE INDEX "GeneratedArtifact_bytesDeletedAt_cleanupClaimedAt_nextCleanupAttemptAt_idx" ON "GeneratedArtifact"("bytesDeletedAt", "cleanupClaimedAt", "nextCleanupAttemptAt");
CREATE INDEX "GeneratedArtifact_downloadLeaseUntil_idx" ON "GeneratedArtifact"("downloadLeaseUntil");

ALTER TABLE "GeneratedArtifact" DROP CONSTRAINT "GeneratedArtifact_printJobAttemptId_fkey";
ALTER TABLE "GeneratedArtifact" DROP CONSTRAINT "GeneratedArtifact_outputProfileVersionId_fkey";
ALTER TABLE "OrderArtworkSnapshot" DROP CONSTRAINT "OrderArtworkSnapshot_customisationRevisionId_fkey";
ALTER TABLE "OrderArtworkSnapshot" DROP CONSTRAINT "OrderArtworkSnapshot_designVersionId_fkey";
ALTER TABLE "OrderArtworkSnapshot" DROP CONSTRAINT "OrderArtworkSnapshot_outputProfileVersionId_fkey";
ALTER TABLE "PrintJob" DROP CONSTRAINT "PrintJob_orderId_fkey";
ALTER TABLE "PrintJob" DROP CONSTRAINT "PrintJob_artworkSnapshotId_fkey";
ALTER TABLE "PrintJobAttempt" DROP CONSTRAINT "PrintJobAttempt_printJobId_fkey";
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_orderId_merchantId_fkey"
  FOREIGN KEY ("orderId", "merchantId") REFERENCES "ExternalOrder"("id", "merchantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_artworkSnapshotId_merchantId_fkey"
  FOREIGN KEY ("artworkSnapshotId", "merchantId") REFERENCES "OrderArtworkSnapshot"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrintJobAttempt" ADD CONSTRAINT "PrintJobAttempt_printJobId_merchantId_fkey"
  FOREIGN KEY ("printJobId", "merchantId") REFERENCES "PrintJob"("id", "merchantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderArtworkSnapshot" ADD CONSTRAINT "OrderArtworkSnapshot_customisationRevisionId_merchantId_fkey"
  FOREIGN KEY ("customisationRevisionId", "merchantId") REFERENCES "CustomisationRevision"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderArtworkSnapshot" ADD CONSTRAINT "OrderArtworkSnapshot_designVersionId_merchantId_fkey"
  FOREIGN KEY ("designVersionId", "merchantId") REFERENCES "DesignVersion"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderArtworkSnapshot" ADD CONSTRAINT "OrderArtworkSnapshot_outputProfileVersionId_merchantId_fkey"
  FOREIGN KEY ("outputProfileVersionId", "merchantId") REFERENCES "OutputProfileVersion"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GeneratedArtifact" ADD CONSTRAINT "GeneratedArtifact_printJobAttemptId_merchantId_fkey"
  FOREIGN KEY ("printJobAttemptId", "merchantId") REFERENCES "PrintJobAttempt"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GeneratedArtifact" ADD CONSTRAINT "GeneratedArtifact_outputProfileVersionId_merchantId_fkey"
  FOREIGN KEY ("outputProfileVersionId", "merchantId") REFERENCES "OutputProfileVersion"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
