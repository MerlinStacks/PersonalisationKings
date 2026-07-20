import { prisma } from "@personalise-kings/db";
import type { ConnectorEventEnvelope } from "@personalise-kings/connector-contracts";
import { Prisma } from "@prisma/client";
import { toInputJson } from "./json";

export async function ingestConnectorEvent(event: ConnectorEventEnvelope, correlationId: string) {
  const store = await prisma.store.findUnique({ where: { id: event.store_id } });
  if (!store || store.connectionStatus !== "connected") return { status: "unknown_store" as const };

  return prisma.$transaction(async (tx) => {
    const lockKey = `${store.id}:${event.payload.external_order_id}`;
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const existing = await tx.webhookDelivery.findFirst({
      where: {
        storeId: store.id,
        OR: [
          { eventId: event.event_id },
          { idempotencyKey: event.payload.idempotency_key },
          { nonce: event.nonce }
        ]
      }
    });
    if (existing) {
      if (existing.nonce === event.nonce && existing.eventId !== event.event_id
        && existing.idempotencyKey !== event.payload.idempotency_key) {
        return { status: "replayed_nonce" as const };
      }
      return { status: "duplicate" as const, deliveryId: existing.id };
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
        processingStartedAt: new Date()
      }
    });

    const eventAt = new Date(event.payload.event_timestamp);
    const existingOrder = await tx.externalOrder.findUnique({
      where: { storeId_externalOrderId: { storeId: store.id, externalOrderId: event.payload.external_order_id } },
      select: { id: true, lastEventAt: true, lastEventType: true }
    });
    if (existingOrder && isStaleOrderEvent(existingOrder, event.event_type, eventAt)) {
      await tx.webhookDelivery.update({
        where: { id: delivery.id },
        data: { processedAt: new Date(), processingStartedAt: null }
      });
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
        eventType: event.event_type === "order.paid" && !["cancelled", "refunded"].includes(event.payload.order_status)
          ? "print_jobs.requested"
          : event.event_type === "order.cancelled" || event.event_type === "order.refunded"
            ? "print_jobs.lifecycle_review"
            : "order.synced",
        aggregateType: "ExternalOrder",
        aggregateId: externalOrder.id,
        payload: toInputJson({ externalOrderId: externalOrder.id, eventId: event.event_id }),
        correlationId
      }
    });
    await tx.webhookDelivery.update({
      where: { id: delivery.id },
      data: { processedAt: new Date(), processingStartedAt: null }
    });
    return { status: "accepted" as const, deliveryId: delivery.id, orderId: externalOrder.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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
