export {
  connectorOutboxEventType,
  InvalidCustomisationReferenceError,
  isStaleOrderEvent,
  printJobLifecycleTransition
} from "@personalise-kings/connector-processing";

import { closeConnectorWakeups, enqueueConnectorWakeup, receiveConnectorEvent } from "@personalise-kings/connector-processing";
import type { ConnectorEventEnvelope } from "@personalise-kings/connector-contracts";
import { addCounter, recordHistogram, withSpan } from "@personalise-kings/observability/telemetry";

export async function ingestConnectorEvent(event: ConnectorEventEnvelope, correlationId: string) {
  const startedAt = performance.now();
  let outcome = "failed";
  return withSpan("connector.inbox.receive", { "pk.connector.event_type": event.event_type }, async (span) => {
    try {
      const result = await receiveConnectorEvent(event, correlationId);
      outcome = result.status;
      const wakeup = await enqueueReceiptWakeup(result);
      if (wakeup.outcome !== "not_applicable") {
        addCounter("pk.connector.inbox.wakeups", 1, { outcome: wakeup.outcome, producer: "api" });
        if (wakeup.outcome === "failed") {
          console.warn("Connector inbox wake-up failed; PostgreSQL polling will recover", {
            deliveryId: "deliveryId" in result ? result.deliveryId : undefined,
            error: wakeup.error
          });
        }
      }
      return result;
    } finally {
      span.setAttribute("pk.connector.inbox.outcome", outcome);
      addCounter("pk.connector.inbox.events", 1, { event_type: event.event_type, outcome });
      recordHistogram("pk.connector.inbox.duration", (performance.now() - startedAt) / 1000, { event_type: event.event_type, outcome });
    }
  });
}

export async function enqueueReceiptWakeup(
  result: { status: string; deliveryId?: string },
  enqueue: (deliveryId: string) => Promise<boolean> = enqueueConnectorWakeup
) {
  if (!result.deliveryId || !["accepted", "duplicate"].includes(result.status)) return { outcome: "not_applicable" as const };
  try {
    return { outcome: await enqueue(result.deliveryId) ? "enqueued" as const : "disabled" as const };
  } catch (error) {
    return { outcome: "failed" as const, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function closeConnectorEventWakeups() {
  await closeConnectorWakeups();
}
