-- CreateEnum
CREATE TYPE "ProofJobStatus" AS ENUM ('queued', 'running', 'ready', 'failed');

-- CreateTable
CREATE TABLE "ProofJob" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "customisationRevisionId" TEXT NOT NULL,
    "proofAssetVersionId" TEXT,
    "rendererVersion" TEXT NOT NULL,
    "status" "ProofJobStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProofJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProofJob_customisationRevisionId_key" ON "ProofJob"("customisationRevisionId");
CREATE UNIQUE INDEX "ProofJob_proofAssetVersionId_key" ON "ProofJob"("proofAssetVersionId");
CREATE INDEX "ProofJob_status_nextAttemptAt_idx" ON "ProofJob"("status", "nextAttemptAt");
CREATE INDEX "ProofJob_merchantId_status_idx" ON "ProofJob"("merchantId", "status");
CREATE UNIQUE INDEX "ProofJob_customisationRevisionId_merchantId_key" ON "ProofJob"("customisationRevisionId", "merchantId");
CREATE UNIQUE INDEX "ProofJob_proofAssetVersionId_merchantId_key" ON "ProofJob"("proofAssetVersionId", "merchantId");

-- AddForeignKey
ALTER TABLE "ProofJob" ADD CONSTRAINT "ProofJob_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProofJob" ADD CONSTRAINT "ProofJob_customisationRevisionId_merchantId_fkey" FOREIGN KEY ("customisationRevisionId", "merchantId") REFERENCES "CustomisationRevision"("id", "merchantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProofJob" ADD CONSTRAINT "ProofJob_proofAssetVersionId_merchantId_fkey" FOREIGN KEY ("proofAssetVersionId", "merchantId") REFERENCES "AssetVersion"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;
