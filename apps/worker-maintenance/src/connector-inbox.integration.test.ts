import { ConnectorClaimLostError, processClaimedConnectorDelivery, receiveConnectorEvent } from "@personalise-kings/connector-processing";
import { prisma } from "@personalise-kings/db";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { processNextConnectorDelivery } from "./connector-inbox";

const integrationEnabled = process.env.PK_RUN_DATABASE_INTEGRATION_TESTS === "true";
const merchantIds = new Set<string>();

describe.skipIf(!integrationEnabled)("asynchronous connector inbox with PostgreSQL", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it("commits receipt before asynchronously applying business effects", async () => {
    const fixture = await createFixture();
    const event = connectorEvent(fixture.storeId);

    await expect(receiveConnectorEvent(event, "correlation-1")).resolves.toMatchObject({ status: "accepted" });
    const received = await prisma.webhookDelivery.findUniqueOrThrow({ where: { storeId_eventId: { storeId: fixture.storeId, eventId: event.event_id } } });
    expect(received).toMatchObject({ status: "pending", attempts: 0, processedAt: null });
    expect(await prisma.externalOrder.count({ where: { merchantId: fixture.merchantId } })).toBe(0);

    await expect(processNextConnectorDelivery()).resolves.toBe(true);
    const processed = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: received.id } });
    expect(processed).toMatchObject({ status: "processed", attempts: 1, claimToken: null });
    expect(processed.processedAt).not.toBeNull();
    expect(await prisma.externalOrder.count({ where: { merchantId: fixture.merchantId } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { merchantId: fixture.merchantId, eventType: "order.synced" } })).toBe(1);
  });

  it("deduplicates concurrent receipts before processing", async () => {
    const fixture = await createFixture();
    const event = connectorEvent(fixture.storeId);
    const results = await Promise.all([
      receiveConnectorEvent(event, "correlation-a"),
      receiveConnectorEvent(event, "correlation-b")
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["accepted", "duplicate"]);
    expect(await prisma.webhookDelivery.count({ where: { storeId: fixture.storeId } })).toBe(1);
  });

  it("rejects partial identity collisions", async () => {
    const fixture = await createFixture();
    const event = connectorEvent(fixture.storeId);
    await receiveConnectorEvent(event, "correlation-original");
    const conflicting = {
      ...event,
      nonce: randomUUID().replaceAll("-", ""),
      content_digest: "sha256=different",
      payload: { ...event.payload, idempotency_key: `different-${randomUUID()}` }
    };

    await expect(receiveConnectorEvent(conflicting, "correlation-conflict")).resolves.toEqual({ status: "identity_conflict" });
    expect(await prisma.webhookDelivery.count({ where: { storeId: fixture.storeId } })).toBe(1);
  });

  it("rejects a stale claim token after processing completes", async () => {
    const fixture = await createFixture();
    const event = connectorEvent(fixture.storeId);
    const delivery = await prisma.webhookDelivery.create({
      data: {
        merchantId: fixture.merchantId,
        storeId: fixture.storeId,
        eventId: event.event_id,
        eventType: event.event_type,
        eventVersion: event.event_version,
        connectorInstanceId: event.connector_instance_id,
        idempotencyKey: event.payload.idempotency_key,
        nonce: event.nonce,
        contentDigest: event.content_digest,
        rawPayload: event,
        correlationId: "correlation-stale"
      }
    });
    await processNextConnectorDelivery();

    await expect(processClaimedConnectorDelivery(delivery.id, "stale-token")).rejects.toBeInstanceOf(ConnectorClaimLostError);
    expect(await prisma.outboxEvent.count({ where: { merchantId: fixture.merchantId } })).toBe(1);
  });

  it("ignores legacy completed rows even when their status defaulted to pending", async () => {
    const fixture = await createFixture();
    const event = connectorEvent(fixture.storeId);
    await prisma.webhookDelivery.create({
      data: {
        merchantId: fixture.merchantId,
        storeId: fixture.storeId,
        eventId: event.event_id,
        eventType: event.event_type,
        eventVersion: event.event_version,
        connectorInstanceId: event.connector_instance_id,
        idempotencyKey: event.payload.idempotency_key,
        nonce: event.nonce,
        contentDigest: event.content_digest,
        rawPayload: event,
        processedAt: new Date()
      }
    });

    await expect(processNextConnectorDelivery()).resolves.toBe(false);
    expect(await prisma.externalOrder.count({ where: { merchantId: fixture.merchantId } })).toBe(0);
  });

  it("recovers a stale processing claim at the attempt limit", async () => {
    const fixture = await createFixture();
    const event = connectorEvent(fixture.storeId);
    const delivery = await prisma.webhookDelivery.create({
      data: {
        merchantId: fixture.merchantId,
        storeId: fixture.storeId,
        eventId: event.event_id,
        eventType: event.event_type,
        eventVersion: event.event_version,
        connectorInstanceId: event.connector_instance_id,
        idempotencyKey: event.payload.idempotency_key,
        nonce: event.nonce,
        contentDigest: event.content_digest,
        rawPayload: event,
        status: "processing",
        attempts: 10,
        claimToken: "abandoned-token",
        claimedAt: new Date(Date.now() - 20 * 60 * 1000)
      }
    });

    await expect(processNextConnectorDelivery()).resolves.toBe(true);
    await expect(prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).resolves.toMatchObject({
      status: "processed",
      attempts: 11,
      claimToken: null
    });
  });
});

async function createFixture() {
  const merchant = await prisma.merchant.create({ data: { name: `connector-inbox-test-${randomUUID()}` } });
  merchantIds.add(merchant.id);
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      type: "woocommerce",
      url: `https://${randomUUID()}.example.com`,
      connectionStatus: "connected"
    }
  });
  return { merchantId: merchant.id, storeId: store.id };
}

function connectorEvent(storeId: string) {
  const id = randomUUID();
  return {
    event_id: `event-${id}`,
    event_type: "order.updated" as const,
    event_version: "2026-07-14" as const,
    store_id: storeId,
    connector_instance_id: "https://shop.example.com",
    occurred_at: "2026-07-30T12:00:00.000Z",
    sent_at: "2026-07-30T12:00:01.000Z",
    key_id: "key-1",
    nonce: id.replaceAll("-", ""),
    content_digest: "sha256=test",
    payload: {
      store_type: "woocommerce" as const,
      external_order_id: `order-${id}`,
      external_order_number: "1001",
      currency: "GBP",
      order_status: "processing",
      metadata: {},
      line_items: [],
      idempotency_key: `idempotency-${id}`,
      event_timestamp: "2026-07-30T12:00:00.000Z"
    }
  };
}

async function cleanup() {
  if (!integrationEnabled || merchantIds.size === 0) return;
  const ids = [...merchantIds];
  await prisma.outboxEvent.deleteMany({ where: { merchantId: { in: ids } } });
  await prisma.merchant.deleteMany({ where: { id: { in: ids } } });
  merchantIds.clear();
}
