import { describe, expect, it } from "vitest";
import { connectorWakeupConnectionOptions, connectorWakeupJob, connectorWakeupJobName, connectorWakeupQueueName, connectorWakeupRedisUrl } from "./connector-wakeup";

describe("connector wake-up contract", () => {
  it("uses a versioned queue and deterministic disposable jobs", () => {
    expect(connectorWakeupQueueName).toBe("connector-inbox-v1");
    expect(connectorWakeupJobName).toBe("process-delivery");
    expect(connectorWakeupJob("delivery_1")).toEqual({
      name: "process-delivery",
      data: { deliveryId: "delivery_1" },
      opts: {
        attempts: 1,
        jobId: "webhook-delivery-delivery_1",
        removeOnComplete: true,
        removeOnFail: true
      }
    });
  });

  it("rejects unsafe IDs and treats absent configuration as disabled", () => {
    expect(() => connectorWakeupJob("invalid:id")).toThrow(TypeError);
    expect(connectorWakeupRedisUrl({})).toBeNull();
    expect(connectorWakeupRedisUrl({ PK_CONNECTOR_WAKEUP_REDIS_URL: " redis://localhost:6379/0 " })).toBe("redis://localhost:6379/0");
  });

  it("bounds producer failures while allowing worker reconnection", () => {
    expect(connectorWakeupConnectionOptions(false)).toMatchObject({
      connectTimeout: 1_000,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: expect.any(Function)
    });
    expect(connectorWakeupConnectionOptions(false).retryStrategy?.(1)).toBeNull();
    expect(connectorWakeupConnectionOptions(true)).toMatchObject({ enableOfflineQueue: true, maxRetriesPerRequest: null });
  });
});
