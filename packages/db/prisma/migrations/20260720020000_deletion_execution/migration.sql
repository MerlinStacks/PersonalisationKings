-- CreateEnum
CREATE TYPE "DeletionRequestStatus" AS ENUM ('pending', 'processing', 'blocked_ordered', 'live_deleted', 'completed', 'failed');

-- AlterTable
UPDATE "DeletionRequest" SET "status" = 'failed' WHERE "status" NOT IN ('pending', 'processing', 'blocked_ordered', 'live_deleted', 'completed', 'failed');

ALTER TABLE "DeletionRequest"
    ALTER COLUMN "status" DROP DEFAULT,
    ALTER COLUMN "status" TYPE "DeletionRequestStatus" USING ("status"::"DeletionRequestStatus"),
    ALTER COLUMN "status" SET DEFAULT 'pending',
    ADD COLUMN "backupPurgedAt" TIMESTAMP(3),
    ADD COLUMN "completedAt" TIMESTAMP(3),
    ADD COLUMN "claimedAt" TIMESTAMP(3),
    ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lastError" TEXT,
    ADD COLUMN "eligibilityReason" TEXT,
    ADD COLUMN "executionPlan" JSONB;

-- CreateIndex
CREATE INDEX "DeletionRequest_status_nextAttemptAt_idx" ON "DeletionRequest"("status", "nextAttemptAt");
CREATE INDEX "DeletionRequest_merchantId_subjectType_subjectId_idx" ON "DeletionRequest"("merchantId", "subjectType", "subjectId");
CREATE UNIQUE INDEX "DeletionRequest_active_subject_key" ON "DeletionRequest"("merchantId", "subjectType", "subjectId") WHERE "status" <> 'completed';
