ALTER TABLE "ExternalOrder"
ADD COLUMN "lastEventAt" TIMESTAMP(3),
ADD COLUMN "lastEventType" TEXT;

CREATE INDEX "ExternalOrder_storeId_lastEventAt_idx"
ON "ExternalOrder"("storeId", "lastEventAt");
