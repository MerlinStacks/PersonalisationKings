import {
  ConnectorClaimLostError,
  InvalidCustomisationReferenceError,
  InvalidStoredConnectorEventError,
  enqueueConnectorWakeups,
  processClaimedConnectorDelivery
} from "@personalise-kings/connector-processing";
import { prisma } from "@personalise-kings/db";
import { addCounter, recordHistogram } from "@personalise-kings/observability/telemetry";
import { Prisma, type WebhookDelivery } from "@prisma/client";
import { randomUUID } from "node:crypto";

const staleClaimSeconds = 15 * 60;
const maximumAttempts = 10;

export async function processNextConnectorDelivery(deliveryId?: string) {
  const delivery = await claimConnectorDelivery(deliveryId);
  if (!delivery?.claimToken) return false;
  const startedAt = performance.now();
  let outcome = "processed";
  try {
    await processClaimedConnectorDelivery(delivery.id, delivery.claimToken);
  } catch (error) {
    if (error instanceof ConnectorClaimLostError) {
      outcome = "claim_lost";
    } else {
      const permanent = isPermanentConnectorProcessingError(error);
      const terminal = permanent || delivery.attempts >= maximumAttempts;
      outcome = terminal ? "failed" : "retry";
      const message = (error instanceof Error ? error.message : "Unknown connector processing error").slice(0, 1000);
      const updated = await prisma.webhookDelivery.updateMany({
        where: { id: delivery.id, status: "processing", claimToken: delivery.claimToken },
        data: {
          status: terminal ? "failed" : "pending",
          failedAt: terminal ? new Date() : null,
          nextAttemptAt: new Date(Date.now() + connectorRetryDelayMs(delivery.attempts)),
          claimedAt: null,
          processingStartedAt: null,
          claimToken: null,
          error: message
        }
      });
      if (updated.count !== 1) outcome = "claim_lost";
      console.error("Connector inbox processing failed", { deliveryId: delivery.id, outcome, error: message });
    }
  } finally {
    addCounter("pk.connector.inbox.processing_attempts", 1, { outcome });
    recordHistogram("pk.connector.inbox.processing_attempt_duration", (performance.now() - startedAt) / 1000, { outcome });
  }
  return true;
}

export async function processConnectorInbox(maximumDeliveries = 10) {
  let processed = 0;
  while (processed < maximumDeliveries && await processNextConnectorDelivery()) processed += 1;
  return processed;
}

export function processConnectorDelivery(deliveryId: string) {
  return processNextConnectorDelivery(deliveryId);
}

export async function reconcileConnectorWakeups(maximumDeliveries = 100) {
  const deliveries = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "WebhookDelivery"
    WHERE "processedAt" IS NULL
      AND "failedAt" IS NULL
      AND (
        ("status" = 'pending'::"WebhookDeliveryStatus" AND "attempts" < ${maximumAttempts} AND "nextAttemptAt" <= NOW())
        OR (
          "status" = 'processing'::"WebhookDeliveryStatus"
          AND ("claimedAt" IS NULL OR "claimedAt" < NOW() - (${staleClaimSeconds} * INTERVAL '1 second'))
        )
      )
    ORDER BY "receivedAt" ASC
    LIMIT ${maximumDeliveries}
  `);
  try {
    const enqueued = await enqueueConnectorWakeups(deliveries.map((delivery) => delivery.id));
    if (enqueued > 0) addCounter("pk.connector.inbox.wakeups", enqueued, { outcome: "enqueued", producer: "reconciliation" });
    return enqueued;
  } catch (error) {
    addCounter("pk.connector.inbox.wakeups", 1, { outcome: "failed", producer: "reconciliation" });
    throw error;
  }
}

async function claimConnectorDelivery(deliveryId?: string) {
  const target = deliveryId ? Prisma.sql`AND "id" = ${deliveryId}` : Prisma.empty;
  return prisma.$transaction(async (tx) => {
    const [candidate] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "WebhookDelivery"
      WHERE "processedAt" IS NULL
        AND "failedAt" IS NULL
        ${target}
        AND (
          ("status" = 'pending'::"WebhookDeliveryStatus" AND "attempts" < ${maximumAttempts} AND "nextAttemptAt" <= NOW())
          OR (
            "status" = 'processing'::"WebhookDeliveryStatus"
            AND ("claimedAt" IS NULL OR "claimedAt" < NOW() - (${staleClaimSeconds} * INTERVAL '1 second'))
          )
        )
      ORDER BY "receivedAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    if (!candidate) return null;
    const claimToken = randomUUID();
    const [claimed] = await tx.$queryRaw<WebhookDelivery[]>(Prisma.sql`
      UPDATE "WebhookDelivery"
      SET "status" = 'processing'::"WebhookDeliveryStatus",
          "claimToken" = ${claimToken},
          "claimedAt" = NOW(),
          "processingStartedAt" = NOW(),
          "attempts" = "attempts" + 1,
          "error" = NULL
      WHERE "id" = ${candidate.id}
      RETURNING *
    `);
    return claimed ?? null;
  });
}

export function connectorRetryDelayMs(attempts: number) {
  return Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, attempts - 1));
}

export function isPermanentConnectorProcessingError(error: unknown) {
  return error instanceof InvalidStoredConnectorEventError || error instanceof InvalidCustomisationReferenceError;
}
