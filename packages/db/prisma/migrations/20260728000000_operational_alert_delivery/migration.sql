CREATE TYPE "OperationalAlertDeliveryStatus" AS ENUM ('pending', 'delivering', 'delivered', 'failed');

ALTER TABLE "OperationalAlert" ADD COLUMN "notificationVersion" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "OperationalAlertDelivery" (
  "id" TEXT NOT NULL,
  "alertId" TEXT NOT NULL,
  "notificationVersion" INTEGER NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'webhook',
  "payload" JSONB NOT NULL,
  "status" "OperationalAlertDeliveryStatus" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "claimToken" TEXT,
  "lastError" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationalAlertDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperationalAlertDelivery_alertId_notificationVersion_channel_key"
  ON "OperationalAlertDelivery"("alertId", "notificationVersion", "channel");
CREATE INDEX "OperationalAlertDelivery_status_nextAttemptAt_idx" ON "OperationalAlertDelivery"("status", "nextAttemptAt");
CREATE INDEX "OperationalAlertDelivery_status_claimedAt_idx" ON "OperationalAlertDelivery"("status", "claimedAt");

ALTER TABLE "OperationalAlertDelivery" ADD CONSTRAINT "OperationalAlertDelivery_alertId_fkey"
  FOREIGN KEY ("alertId") REFERENCES "OperationalAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "OperationalAlertDelivery" ("id", "alertId", "notificationVersion", "payload", "updatedAt")
SELECT gen_random_uuid()::text, "id", "notificationVersion",
  jsonb_build_object(
    'schemaVersion', 'operational-alert.v1',
    'alertId', "id",
    'merchantId', "merchantId",
    'rule', "rule",
    'severity', "severity"::text,
    'status', "status"::text,
    'summary', "summary",
    'details', "details",
    'notificationVersion', "notificationVersion",
    'observedAt', "lastObservedAt",
    'transitionAt', COALESCE("acknowledgedAt", "updatedAt"),
    'resolvedAt', "resolvedAt",
    'acknowledgedAt', "acknowledgedAt",
    'acknowledgedByUserId', "acknowledgedByUserId"
  ), CURRENT_TIMESTAMP
FROM "OperationalAlert"
WHERE "status" IN ('open'::"OperationalAlertStatus", 'acknowledged'::"OperationalAlertStatus");
