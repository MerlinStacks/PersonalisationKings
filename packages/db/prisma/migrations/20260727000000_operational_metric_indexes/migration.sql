CREATE INDEX "GeneratedArtifact_merchantId_bytesDeletedAt_cleanupAttempts_idx"
  ON "GeneratedArtifact"("merchantId", "bytesDeletedAt", "cleanupAttempts");
CREATE INDEX "OperationalCheckRun_completedAt_idx" ON "OperationalCheckRun"("completedAt");
