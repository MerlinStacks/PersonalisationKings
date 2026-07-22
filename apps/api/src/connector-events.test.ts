import { describe, expect, it } from "vitest";
import { connectorOutboxEventType, isStaleOrderEvent, printJobLifecycleTransition } from "./connector-events";

describe("print job lifecycle transitions", () => {
  it.each(["queued", "failed"] as const)("cancels %s work before production completes", (status) => {
    expect(printJobLifecycleTransition("order.cancelled", status)).toBe("cancelled");
  });

  it.each(["running", "ready", "needs_review"] as const)("moves %s work to review", (status) => {
    expect(printJobLifecycleTransition("order.refunded", status)).toBe("needs_review");
  });

  it("leaves already-cancelled work unchanged", () => {
    expect(printJobLifecycleTransition("order.cancelled", "cancelled")).toBeNull();
  });
});

describe("order event watermark", () => {
  const timestamp = new Date("2026-07-18T12:00:00.000Z");

  it("rejects events older than the current order watermark", () => {
    expect(isStaleOrderEvent(
      { lastEventAt: timestamp, lastEventType: "order.updated" },
      "order.paid",
      new Date("2026-07-18T11:59:59.000Z")
    )).toBe(true);
  });

  it("lets terminal events win when timestamps are equal", () => {
    expect(isStaleOrderEvent({ lastEventAt: timestamp, lastEventType: "order.cancelled" }, "order.paid", timestamp)).toBe(true);
    expect(isStaleOrderEvent({ lastEventAt: timestamp, lastEventType: "order.paid" }, "order.cancelled", timestamp)).toBe(false);
  });

  it("accepts a newer reconciliation event", () => {
    expect(isStaleOrderEvent(
      { lastEventAt: timestamp, lastEventType: "order.cancelled" },
      "order.updated",
      new Date("2026-07-18T12:00:01.000Z")
    )).toBe(false);
  });
});

describe("connector outbox events", () => {
  const event = (event_type: "order.paid" | "order.updated" | "order.cancelled" | "order.refunded", order_status: string) => ({
    event_type,
    payload: { order_status }
  }) as Parameters<typeof connectorOutboxEventType>[0];

  it("normalizes lifecycle work to bounded event types", () => {
    expect(connectorOutboxEventType(event("order.paid", "processing"))).toBe("print_jobs.requested");
    expect(connectorOutboxEventType(event("order.paid", "refunded"))).toBe("order.synced");
    expect(connectorOutboxEventType(event("order.cancelled", "cancelled"))).toBe("print_jobs.lifecycle_review");
    expect(connectorOutboxEventType(event("order.refunded", "partially-refunded"))).toBe("print_jobs.lifecycle_review");
    expect(connectorOutboxEventType(event("order.updated", "processing"))).toBe("order.synced");
  });
});
