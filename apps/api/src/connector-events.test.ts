import { describe, expect, it } from "vitest";
import { isStaleOrderEvent, printJobLifecycleTransition } from "./connector-events";

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
