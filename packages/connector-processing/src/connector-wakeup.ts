import { Queue, Worker, type JobsOptions, type Processor } from "bullmq";
import Redis, { type RedisOptions } from "ioredis";

export const connectorWakeupQueueName = "connector-inbox-v1";
export const connectorWakeupJobName = "process-delivery";
export interface ConnectorWakeupData { deliveryId: string }

const jobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true
};
let producer: { queue: Queue<ConnectorWakeupData>; connection: Redis } | null = null;
let consumer: { worker: Worker<ConnectorWakeupData>; connection: Redis } | null = null;

export function connectorWakeupJob(deliveryId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(deliveryId)) throw new TypeError("Invalid connector delivery ID");
  return {
    name: connectorWakeupJobName,
    data: { deliveryId },
    opts: { ...jobOptions, jobId: `webhook-delivery-${deliveryId}` }
  };
}

export async function enqueueConnectorWakeup(deliveryId: string) {
  const runtime = producerRuntime();
  if (!runtime) return false;
  const job = connectorWakeupJob(deliveryId);
  await runProducerOperation(runtime, () => runtime.queue.add(job.name, job.data, job.opts));
  return true;
}

export async function enqueueConnectorWakeups(deliveryIds: readonly string[]) {
  const runtime = producerRuntime();
  if (!runtime || deliveryIds.length === 0) return 0;
  await runProducerOperation(runtime, () => runtime.queue.addBulk(deliveryIds.map(connectorWakeupJob)));
  return deliveryIds.length;
}

export function startConnectorWakeupWorker(processor: (deliveryId: string) => Promise<unknown>) {
  const url = connectorWakeupRedisUrl();
  if (!url || consumer) return Boolean(url);
  const connection = redisConnection(url, true);
  const jobProcessor: Processor<ConnectorWakeupData> = async (job) => {
    if (job.name !== connectorWakeupJobName || !job.data || typeof job.data.deliveryId !== "string") {
      throw new TypeError("Invalid connector wake-up job");
    }
    await processor(job.data.deliveryId);
  };
  const worker = new Worker(connectorWakeupQueueName, jobProcessor, { connection, concurrency: 4 });
  worker.on("error", () => undefined);
  consumer = { worker, connection };
  return true;
}

export async function closeConnectorWakeups() {
  const activeConsumer = consumer;
  const activeProducer = producer;
  consumer = null;
  producer = null;
  if (activeConsumer) await closeWorkerBounded(activeConsumer.worker, activeConsumer.connection);
  await activeProducer?.queue.close().catch(() => undefined);
  await Promise.allSettled([
    closeRedis(activeConsumer?.connection),
    closeRedis(activeProducer?.connection)
  ]);
}

export function connectorWakeupRedisUrl(env: Record<string, string | undefined> = process.env) {
  return env.PK_CONNECTOR_WAKEUP_REDIS_URL?.trim() || null;
}

function producerRuntime() {
  if (producer) return producer;
  const url = connectorWakeupRedisUrl();
  if (!url) return null;
  const connection = redisConnection(url, false);
  const queue = new Queue<ConnectorWakeupData>(connectorWakeupQueueName, {
    connection,
    defaultJobOptions: jobOptions
  });
  queue.on("error", () => undefined);
  producer = { queue, connection };
  return producer;
}

function redisConnection(url: string, worker: boolean) {
  const connection = new Redis(url, connectorWakeupConnectionOptions(worker));
  connection.on("error", () => undefined);
  return connection;
}

export function connectorWakeupConnectionOptions(worker: boolean): RedisOptions {
  return {
    connectTimeout: 1_000,
    enableOfflineQueue: worker,
    lazyConnect: false,
    maxRetriesPerRequest: worker ? null : 1,
    ...(worker ? {} : { retryStrategy: () => null })
  };
}

async function runProducerOperation<T>(runtime: NonNullable<typeof producer>, operation: () => Promise<T>) {
  try {
    return await withTimeout(operation(), 1_500, "Connector wake-up Redis operation timed out");
  } catch (error) {
    if (producer === runtime) producer = null;
    runtime.connection.disconnect(false);
    await runtime.queue.close().catch(() => undefined);
    throw error;
  }
}

async function closeWorkerBounded(worker: Worker<ConnectorWakeupData>, connection: Redis) {
  const graceful = worker.close();
  const completed = await Promise.race([
    graceful.then(() => true, () => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 30_000))
  ]);
  if (completed) return;
  connection.disconnect(false);
  await withTimeout(worker.close(true), 1_000, "Forced BullMQ worker close timed out").catch(() => undefined);
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function closeRedis(connection: Redis | undefined) {
  if (!connection) return;
  try {
    await connection.quit();
  } catch {
    connection.disconnect(false);
  }
}
