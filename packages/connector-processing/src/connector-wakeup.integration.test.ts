import { Queue } from "bullmq";
import Redis from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeConnectorWakeups,
  connectorWakeupQueueName,
  connectorWakeupRedisUrl,
  enqueueConnectorWakeup,
  startConnectorWakeupWorker
} from "./connector-wakeup";

const integrationEnabled = process.env.PK_RUN_REDIS_INTEGRATION_TESTS === "true";
const redisUrl = connectorWakeupRedisUrl() ?? "redis://127.0.0.1:6379/0";

describe.skipIf(!integrationEnabled)("connector BullMQ wake-ups with Redis", () => {
  beforeEach(async () => {
    if (!redisUrl.endsWith("/15")) throw new Error("Redis integration tests require dedicated database 15");
    await closeConnectorWakeups();
    const redis = new Redis(redisUrl);
    await redis.flushdb();
    await redis.quit();
  });
  afterAll(closeConnectorWakeups);

  it("deduplicates disposable wake-ups by delivery ID", async () => {
    await enqueueConnectorWakeup("delivery_redis_1");
    await enqueueConnectorWakeup("delivery_redis_1");
    const connection = new Redis(redisUrl);
    const queue = new Queue(connectorWakeupQueueName, { connection });
    try {
      const jobs = await queue.getJobs(["waiting", "active", "delayed"]);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.data).toEqual({ deliveryId: "delivery_redis_1" });
    } finally {
      await queue.close();
      await connection.quit();
    }
  });

  it("delivers only the database identity to the worker", async () => {
    let resolveDelivery: ((deliveryId: string) => void) | undefined;
    const delivered = new Promise<string>((resolve) => { resolveDelivery = resolve; });
    expect(startConnectorWakeupWorker(async (deliveryId) => resolveDelivery?.(deliveryId))).toBe(true);

    await enqueueConnectorWakeup("delivery_redis_2");

    await expect(Promise.race([
      delivered,
      new Promise<string>((_resolve, reject) => setTimeout(() => reject(new Error("BullMQ wake-up timed out")), 5_000))
    ])).resolves.toBe("delivery_redis_2");
  });
});
