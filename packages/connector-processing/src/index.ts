import { prisma } from "@personalise-kings/db";
import { connectorEventEnvelopeSchema, type ConnectorEventEnvelope } from "@personalise-kings/connector-contracts";
import { addCounter, recordHistogram, withSpan } from "@personalise-kings/observability/telemetry";
import { Prisma } from "@prisma/client";
export {
  closeConnectorWakeups,
  connectorWakeupJob,
  connectorWakeupJobName,
  connectorWakeupQueueName,
  connectorWakeupRedisUrl,
  enqueueConnectorWakeup,
  enqueueConnectorWakeups,
  startConnectorWakeupWorker
} from "./connector-wakeup";
const toInputJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function receiveConnectorEvent(event: ConnectorEventEnvelope, correlationId: string) {
  const store = await prisma.store.findUnique({ where: { id: event.store_id } });
  if (!store || store.connectionStatus !== "connected") return { status: "unknown_store" as const };
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`connector-receipt:${store.id}`}, 0))`);
    const existing = await tx.webhookDelivery.findMany({
      where: {
        storeId: store.id,
        OR: [
          { eventId: event.event_id },
          { idempotencyKey: event.payload.idempotency_key },
          { nonce: event.nonce }
        ]
      },
      take: 4
    });
    if (existing.length > 0) {
      const exact = existing.find((delivery) => delivery.eventId === event.event_id
        && delivery.idempotencyKey === event.payload.idempotency_key
        && delivery.nonce === event.nonce
        && delivery.contentDigest === event.content_digest);
      if (exact && existing.length === 1) return { status: "duplicate" as const, deliveryId: exact.id };
      return { status: "identity_conflict" as const };
    }
    const delivery = await tx.webhookDelivery.create({
      data: {
        merchantId: store.merchantId,
        storeId: store.id,
        eventId: event.event_id,
        eventType: event.event_type,
        eventVersion: event.event_version,
        connectorInstanceId: event.connector_instance_id,
        idempotencyKey: event.payload.idempotency_key,
        nonce: event.nonce,
        contentDigest: event.content_digest,
        rawPayload: toInputJson(event),
        correlationId
      }
    });
    return { status: "accepted" as const, deliveryId: delivery.id };
  });
}

export async function processClaimedConnectorDelivery(deliveryId: string, claimToken: string) {
  const persisted = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, select: { rawPayload: true, correlationId: true } });
  if (!persisted) throw new ConnectorClaimLostError();
  const parsed = connectorEventEnvelopeSchema.safeParse(persisted.rawPayload);
  if (!parsed.success) throw new InvalidStoredConnectorEventError();
  const event = parsed.data;
  const correlationId = persisted.correlationId ?? deliveryId;
  const startedAt = performance.now();
  let outcome = "failed";
  return withSpan("connector.inbox.process", { "pk.connector.event_type": event.event_type }, async (span) => {
    try {
      const result = await processConnectorEventTransaction(deliveryId, claimToken, event, correlationId);
      outcome = result.status;
      if (result.status === "processed") {
        addCounter("pk.outbox.events.created", 1, {
          event_type: connectorOutboxEventType(event),
          producer: "connector"
        });
      }
      return result;
    } finally {
      span.setAttribute("pk.connector.processing.outcome", outcome);
      addCounter("pk.connector.inbox.processing", 1, { event_type: event.event_type, outcome });
      recordHistogram("pk.connector.inbox.processing.duration", (performance.now() - startedAt) / 1000, {
        event_type: event.event_type,
        outcome
      });
    }
  });
}

async function processConnectorEventTransaction(deliveryId: string, claimToken: string, event: ConnectorEventEnvelope, correlationId: string) {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "WebhookDelivery"
      WHERE "id" = ${deliveryId}
        AND "status" = 'processing'::"WebhookDeliveryStatus"
        AND "claimToken" = ${claimToken}
      FOR UPDATE
    `);
    if (claimed.length !== 1) throw new ConnectorClaimLostError();
    const delivery = await tx.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    const store = await tx.store.findUnique({ where: { id: delivery.storeId } });
    if (!store || store.connectionStatus !== "connected" || store.id !== event.store_id) {
      throw new ConnectorStoreUnavailableError();
    }
    const lockKey = `${store.id}:${event.payload.external_order_id}`;
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const eventAt = new Date(event.payload.event_timestamp);
    const existingOrder = await tx.externalOrder.findUnique({
      where: { storeId_externalOrderId: { storeId: store.id, externalOrderId: event.payload.external_order_id } },
      select: { id: true, lastEventAt: true, lastEventType: true }
    });
    if (existingOrder && isStaleOrderEvent(existingOrder, event.event_type, eventAt)) {
      await completeConnectorDelivery(tx, delivery.id, claimToken);
      return { status: "stale" as const, deliveryId: delivery.id, orderId: existingOrder.id };
    }

    const externalOrder = await tx.externalOrder.upsert({
      where: { storeId_externalOrderId: { storeId: store.id, externalOrderId: event.payload.external_order_id } },
      update: {
        externalOrderNumber: event.payload.external_order_number,
        currency: event.payload.currency,
        status: event.payload.order_status,
        rawPayload: toInputJson(event.payload),
        lastEventAt: eventAt,
        lastEventType: event.event_type
      },
      create: {
        merchantId: store.merchantId,
        storeId: store.id,
        externalOrderId: event.payload.external_order_id,
        externalOrderNumber: event.payload.external_order_number,
        currency: event.payload.currency,
        status: event.payload.order_status,
        rawPayload: toInputJson(event.payload),
        lastEventAt: eventAt,
        lastEventType: event.event_type
      }
    });

    const previousLineItems = await tx.ecommerceLineItem.findMany({
      where: { orderId: externalOrder.id },
      select: { customisationRevision: { select: { id: true, sessionId: true } } }
    });
    const affectedSessionIds = new Set(previousLineItems.flatMap((lineItem) =>
      lineItem.customisationRevision ? [lineItem.customisationRevision.sessionId] : []
    ));
    const previousRevisionSessions = new Map(previousLineItems.flatMap((lineItem) =>
      lineItem.customisationRevision
        ? [[lineItem.customisationRevision.id, lineItem.customisationRevision.sessionId] as const]
        : []
    ));
    const incomingRevisionIds = new Set<string>();
    const incomingSessionIds = new Set<string>();
    await tx.ecommerceLineItem.deleteMany({ where: { orderId: externalOrder.id } });

    for (const item of event.payload.line_items) {
      const revision = item.customisation_reference
        ? await tx.customisationRevision.findUnique({
          where: { opaqueReference: item.customisation_reference },
          include: { session: true, lineItems: { select: { orderId: true } } }
        })
        : null;
      const actionablePaidEvent = event.event_type === "order.paid"
        && !["cancelled", "refunded"].includes(event.payload.order_status);
      const allowedSessionStatuses = actionablePaidEvent
        ? ["committed", "ordered"]
        : ["committed", "ordered", "needs_review", "cancelled"];
      // Session expiry gates customer editing; signed store lifecycle events can arrive much later.
      const validRevision = revision
        && revision.merchantId === store.merchantId
        && revision.session.storeId === store.id
        && revision.session.externalProductId === item.external_product_id
        && (revision.session.externalVariantId ?? null) === (item.external_variant_id ?? null)
        && allowedSessionStatuses.includes(revision.session.status)
        && revision.lineItems.every((lineItem) => lineItem.orderId === externalOrder.id);

      if (item.customisation_reference && !validRevision) {
        throw new InvalidCustomisationReferenceError(item.external_line_item_id);
      }

      await tx.ecommerceLineItem.create({
        data: {
          merchantId: store.merchantId,
          orderId: externalOrder.id,
          externalLineItemId: item.external_line_item_id,
          externalProductId: item.external_product_id,
          externalVariantId: item.external_variant_id,
          quantity: item.quantity,
          customisationRevisionId: validRevision ? revision.id : undefined,
          metadata: toInputJson({ ...item.metadata, customisation_reference: item.customisation_reference })
        }
      });
      if (validRevision) {
        affectedSessionIds.add(revision.sessionId);
        incomingRevisionIds.add(revision.id);
        incomingSessionIds.add(revision.sessionId);
      }

      if (actionablePaidEvent && validRevision) {
        const existingPrintJob = await tx.printJob.findFirst({
          where: {
            orderId: externalOrder.id,
            artworkSnapshot: { customisationRevisionId: revision.id }
          },
          select: { id: true }
        });
        if (!existingPrintJob) {
          const profile = await tx.outputProfile.findFirst({
            where: { merchantId: store.merchantId, activeVersionId: { not: null } },
            include: { activeVersion: true },
            orderBy: { updatedAt: "desc" }
          });
          if (!profile?.activeVersion) throw new Error("No active output profile is configured");

          const snapshot = await tx.orderArtworkSnapshot.create({
            data: {
              merchantId: store.merchantId,
              customisationRevisionId: revision.id,
              designVersionId: revision.designVersionId,
              outputProfileVersionId: profile.activeVersion.id,
              renderSpecSchemaVersion: "scene-graph.v1",
              snapshot: toInputJson({
                renderSpec: revision.renderSpec,
                designVersionId: revision.designVersionId,
                outputProfileVersionId: profile.activeVersion.id,
                originalCustomerInputs: revision.customerInputs,
                rendererBuild: "pending-phase-0",
                preflightRuleVersion: profile.activeVersion.preflightRuleVersion
              })
            }
          });
          await tx.printJob.create({
            data: { merchantId: store.merchantId, orderId: externalOrder.id, artworkSnapshotId: snapshot.id, status: "queued" }
          });
        }
        await tx.customisationSession.update({ where: { id: revision.sessionId }, data: { status: "ordered" } });
      }
    }

    if (event.event_type !== "order.cancelled" && event.event_type !== "order.refunded") {
      const removedRevisionIds = [...previousRevisionSessions.keys()].filter((id) => !incomingRevisionIds.has(id));
      if (removedRevisionIds.length > 0) {
        const removedPrintJobs = await tx.printJob.findMany({
          where: {
            orderId: externalOrder.id,
            artworkSnapshot: { customisationRevisionId: { in: removedRevisionIds } }
          },
          select: {
            id: true,
            status: true,
            artworkSnapshot: { select: { customisationRevisionId: true } }
          }
        });
        const reviewSessionIds = new Set<string>();
        for (const printJob of removedPrintJobs) {
          const nextStatus = printJobLifecycleTransition("order.cancelled", printJob.status);
          if (!nextStatus) continue;
          await tx.printJob.update({
            where: { id: printJob.id },
            data: {
              status: nextStatus,
              lastError: nextStatus === "needs_review"
                ? "Personalised order line was removed after production started"
                : "Personalised order line was removed before production completed"
            }
          });
          if (nextStatus === "needs_review") {
            const sessionId = previousRevisionSessions.get(printJob.artworkSnapshot.customisationRevisionId);
            if (sessionId) reviewSessionIds.add(sessionId);
          }
        }

        const removedSessionIds = new Set(removedRevisionIds.flatMap((revisionId) => {
          const sessionId = previousRevisionSessions.get(revisionId);
          return sessionId && !incomingSessionIds.has(sessionId) ? [sessionId] : [];
        }));
        for (const sessionId of removedSessionIds) {
          await tx.customisationSession.updateMany({
            where: { id: sessionId, status: { in: ["ordered", "needs_review", "cancelled"] } },
            data: { status: reviewSessionIds.has(sessionId) ? "needs_review" : "cancelled" }
          });
        }
        await tx.auditEvent.create({
          data: {
            merchantId: store.merchantId,
            action: "order.line_items_reconciled",
            targetType: "ExternalOrder",
            targetId: externalOrder.id,
            metadata: toInputJson({
              eventType: event.event_type,
              removedRevisions: removedRevisionIds.length,
              affectedPrintJobs: removedPrintJobs.length,
              affectedSessions: removedSessionIds.size
            })
          }
        });
      }
    }

    if (event.event_type === "order.cancelled" || event.event_type === "order.refunded") {
      const printJobs = await tx.printJob.findMany({ where: { orderId: externalOrder.id }, select: { id: true, status: true } });
      for (const printJob of printJobs) {
        const nextStatus = printJobLifecycleTransition(event.event_type, printJob.status);
        if (!nextStatus) continue;
        await tx.printJob.update({
          where: { id: printJob.id },
          data: {
            status: nextStatus,
            lastError: nextStatus === "needs_review"
              ? `${event.event_type} received after production started`
              : `${event.event_type} received before production completed`
          }
        });
      }
      const sessionStatus = event.event_type === "order.cancelled" || event.payload.order_status === "refunded"
        ? "cancelled"
        : "needs_review";
      if (affectedSessionIds.size > 0) {
        await tx.customisationSession.updateMany({
          where: { id: { in: [...affectedSessionIds] } },
          data: { status: sessionStatus }
        });
      }
      await tx.auditEvent.create({
        data: {
          merchantId: store.merchantId,
          action: "order.lifecycle_sync",
          targetType: "ExternalOrder",
          targetId: externalOrder.id,
          metadata: toInputJson({
            eventType: event.event_type,
            orderStatus: event.payload.order_status,
            affectedPrintJobs: printJobs.length,
            affectedSessions: affectedSessionIds.size
          })
        }
      });
    }

    await tx.outboxEvent.create({
      data: {
        merchantId: store.merchantId,
        eventType: connectorOutboxEventType(event),
        aggregateType: "ExternalOrder",
        aggregateId: externalOrder.id,
        payload: toInputJson({ externalOrderId: externalOrder.id, eventId: event.event_id }),
        correlationId
      }
    });
    await completeConnectorDelivery(tx, delivery.id, claimToken);
    return { status: "processed" as const, deliveryId: delivery.id, orderId: externalOrder.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function completeConnectorDelivery(tx: Prisma.TransactionClient, deliveryId: string, claimToken: string) {
  const completed = await tx.webhookDelivery.updateMany({
    where: { id: deliveryId, status: "processing", claimToken },
    data: {
      status: "processed",
      processedAt: new Date(),
      processingStartedAt: null,
      claimedAt: null,
      claimToken: null,
      failedAt: null,
      error: null
    }
  });
  if (completed.count !== 1) throw new ConnectorClaimLostError();
}

export function connectorOutboxEventType(event: Pick<ConnectorEventEnvelope, "event_type" | "payload">) {
  if (event.event_type === "order.paid" && !["cancelled", "refunded"].includes(event.payload.order_status)) {
    return "print_jobs.requested" as const;
  }
  if (event.event_type === "order.cancelled" || event.event_type === "order.refunded") {
    return "print_jobs.lifecycle_review" as const;
  }
  return "order.synced" as const;
}

export function printJobLifecycleTransition(
  eventType: "order.cancelled" | "order.refunded",
  currentStatus: "queued" | "running" | "ready" | "needs_review" | "failed" | "cancelled"
) {
  if (currentStatus === "cancelled") return null;
  if (currentStatus === "queued" || currentStatus === "failed") return "cancelled" as const;
  return "needs_review" as const;
}

export function isStaleOrderEvent(
  existing: { lastEventAt: Date | null; lastEventType: string | null },
  incomingEventType: ConnectorEventEnvelope["event_type"],
  incomingEventAt: Date
) {
  if (!existing.lastEventAt) return false;
  if (incomingEventAt < existing.lastEventAt) return true;
  if (incomingEventAt > existing.lastEventAt) return false;
  return lifecyclePriority(incomingEventType) < lifecyclePriority(existing.lastEventType);
}

function lifecyclePriority(eventType: string | null) {
  if (eventType === "order.cancelled") return 3;
  if (eventType === "order.refunded") return 2;
  if (eventType === "order.paid") return 1;
  return 0;
}

export class InvalidCustomisationReferenceError extends Error {
  constructor(readonly lineItemId: string) {
    super(`Invalid customisation reference for line item ${lineItemId}`);
  }
}

export class InvalidStoredConnectorEventError extends Error {
  constructor() {
    super("Stored connector event failed schema validation");
  }
}

export class ConnectorClaimLostError extends Error {
  constructor() {
    super("Connector inbox claim was lost");
  }
}

export class ConnectorStoreUnavailableError extends Error {
  constructor() {
    super("Connector store is not available for event processing");
  }
}
