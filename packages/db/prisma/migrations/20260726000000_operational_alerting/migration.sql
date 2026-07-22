CREATE TYPE "OperationalCheckStatus" AS ENUM ('succeeded', 'degraded', 'failed');
CREATE TYPE "OperationalAlertSeverity" AS ENUM ('warning', 'critical');
CREATE TYPE "OperationalAlertStatus" AS ENUM ('open', 'acknowledged', 'resolved');

CREATE TABLE "OperationalCheckRun" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "checkType" TEXT NOT NULL,
  "status" "OperationalCheckStatus" NOT NULL,
  "metrics" JSONB NOT NULL,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,
  "correlationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationalCheckRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationalAlert" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "rule" TEXT NOT NULL,
  "severity" "OperationalAlertSeverity" NOT NULL,
  "status" "OperationalAlertStatus" NOT NULL DEFAULT 'open',
  "summary" TEXT NOT NULL,
  "details" JSONB NOT NULL,
  "firstTriggeredAt" TIMESTAMP(3) NOT NULL,
  "lastObservedAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedByUserId" TEXT,
  "occurrences" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationalAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperationalCheckRun_runId_checkType_merchantId_key" ON "OperationalCheckRun"("runId", "checkType", "merchantId");
CREATE INDEX "OperationalCheckRun_merchantId_checkType_completedAt_idx" ON "OperationalCheckRun"("merchantId", "checkType", "completedAt");
CREATE INDEX "OperationalCheckRun_status_completedAt_idx" ON "OperationalCheckRun"("status", "completedAt");
CREATE UNIQUE INDEX "OperationalAlert_fingerprint_key" ON "OperationalAlert"("fingerprint");
CREATE INDEX "OperationalAlert_merchantId_status_severity_idx" ON "OperationalAlert"("merchantId", "status", "severity");
CREATE INDEX "OperationalAlert_status_lastObservedAt_idx" ON "OperationalAlert"("status", "lastObservedAt");

ALTER TABLE "OperationalCheckRun" ADD CONSTRAINT "OperationalCheckRun_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperationalAlert" ADD CONSTRAINT "OperationalAlert_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
