CREATE INDEX "ProofJob_status_claimedAt_idx" ON "ProofJob"("status", "claimedAt");
CREATE INDEX "DeletionRequest_status_claimedAt_idx" ON "DeletionRequest"("status", "claimedAt");
CREATE INDEX "PrintJob_status_createdAt_idx" ON "PrintJob"("status", "createdAt");
CREATE INDEX "PrintJob_createdAt_idx" ON "PrintJob"("createdAt");
CREATE INDEX "PrintJob_orderId_artworkSnapshotId_idx" ON "PrintJob"("orderId", "artworkSnapshotId");
CREATE INDEX "WebhookDelivery_processedAt_receivedAt_idx" ON "WebhookDelivery"("processedAt", "receivedAt");
CREATE INDEX "OutboxEvent_dispatchedAt_failedAt_createdAt_idx" ON "OutboxEvent"("dispatchedAt", "failedAt", "createdAt");
