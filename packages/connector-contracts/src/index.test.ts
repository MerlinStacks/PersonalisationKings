import { describe, expect, it } from "vitest";
import { connectorEventEnvelopeSchema } from "./index";

function event(eventType: "order.paid" | "order.updated" | "order.cancelled" | "order.refunded") {
  return {
    event_id: `event-${eventType}`,
    event_type: eventType,
    event_version: "2026-07-14",
    store_id: "store-1",
    connector_instance_id: "https://shop.example",
    occurred_at: "2026-07-18T12:00:00.000Z",
    sent_at: "2026-07-18T12:00:01.000Z",
    key_id: "key-1",
    nonce: "1234567890abcdef",
    content_digest: "sha256=digest",
    payload: {
      store_type: "woocommerce",
      external_order_id: "100",
      currency: "GBP",
      order_status: "processing",
      metadata: { lifecycle_key: "status-100" },
      line_items: [{
        external_line_item_id: "1",
        external_product_id: "10",
        quantity: 1,
        metadata: {}
      }],
      idempotency_key: `order-100-${eventType}`,
      event_timestamp: "2026-07-18T12:00:00.000Z"
    }
  };
}

describe("connector lifecycle contracts", () => {
  it.each(["order.paid", "order.updated", "order.cancelled", "order.refunded"] as const)("accepts %s", (eventType) => {
    expect(connectorEventEnvelopeSchema.safeParse(event(eventType)).success).toBe(true);
  });

  it("allows ordinary simple-product lines to omit variation and customisation references", () => {
    const parsed = connectorEventEnvelopeSchema.parse(event("order.updated"));
    expect(parsed.payload.line_items[0].external_variant_id).toBeUndefined();
    expect(parsed.payload.line_items[0].customisation_reference).toBeUndefined();
  });

  it("accepts the RFC 3339 offset timestamps emitted by the PHP connector", () => {
    const value = event("order.paid");
    value.occurred_at = "2026-07-18T12:00:00+00:00";
    value.sent_at = "2026-07-18T12:00:01+00:00";
    value.payload.event_timestamp = "2026-07-18T12:00:00+00:00";

    expect(connectorEventEnvelopeSchema.safeParse(value).success).toBe(true);
  });

  it("allows order-level lifecycle events after every product row is removed", () => {
    const value = event("order.cancelled");
    value.payload.line_items = [];

    expect(connectorEventEnvelopeSchema.safeParse(value).success).toBe(true);
  });
});
