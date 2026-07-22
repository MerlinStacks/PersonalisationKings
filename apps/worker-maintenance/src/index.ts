import { prisma } from "@personalise-kings/db";
import { validateServiceEnvironment } from "@personalise-kings/config/server";
import { createObjectStorageFromEnv } from "@personalise-kings/storage";
import { processNextDeletionRequest } from "./deletion";
import { reconcileQueues } from "./reconciliation";
import { cleanupExpiredGeneratedArtifacts } from "./artifact-cleanup";
import { runOperationalChecks } from "./operational-checks";
import { processOperationalAlertDeliveries } from "./alert-delivery";
import { logEvent, serializeError } from "@personalise-kings/observability";
import { addCounter, initializeTelemetry, recordHistogram, shutdownTelemetry, SpanStatusCode, withSpan } from "@personalise-kings/observability/telemetry";

const pollIntervalMs = positiveIntegerFromEnv("MAINTENANCE_POLL_INTERVAL_MS", 5000);
const cleanupIntervalMs = positiveIntegerFromEnv("CLEANUP_INTERVAL_MS", 60_000);
let lastCleanupAt = 0;
let stopping = false;
const activeOperations = new Set<Promise<unknown>>();

async function cleanupExpiredTemporaryUploads() {
  const storage = createObjectStorageFromEnv();
  const settings = await prisma.merchantSettings.findMany();

  for (const setting of settings) {
    const cutoff = new Date(Date.now() - setting.temporaryUploadRetentionDays * 24 * 60 * 60 * 1000);
    const expired = await prisma.assetVersion.findMany({
      where: {
        merchantId: setting.merchantId,
        validationStatus: "pending",
        objectKey: { startsWith: `temporary_upload/${setting.merchantId}/` },
        createdAt: { lt: cutoff },
        deletedAt: null
      },
      take: 100
    });

    for (const assetVersion of expired) {
      const claimedAt = new Date();
      const auditEventId = await prisma.$transaction(async (tx) => {
        const claimed = await tx.assetVersion.updateMany({
          where: {
            id: assetVersion.id,
            merchantId: setting.merchantId,
            validationStatus: "pending",
            objectKey: assetVersion.objectKey,
            createdAt: { lt: cutoff },
            deletedAt: null
          },
          data: { validationStatus: "deleted", deletedAt: claimedAt }
        });

        if (claimed.count !== 1) return null;

        const auditEvent = await tx.auditEvent.create({
          data: {
            merchantId: assetVersion.merchantId,
            action: "asset.cleanup_temporary_upload",
            targetType: "AssetVersion",
            targetId: assetVersion.id,
            metadata: { objectKey: assetVersion.objectKey }
          }
        });
        return auditEvent.id;
      });

      if (!auditEventId) continue;

      try {
        await storage.deleteObject(assetVersion.objectKey as never);
        console.log(`Cleaned expired temporary asset ${assetVersion.id}`);
      } catch (error) {
        console.error(`Failed cleaning asset ${assetVersion.id}`, error);
        try {
          await prisma.$transaction(async (tx) => {
            await tx.assetVersion.updateMany({
              where: {
                id: assetVersion.id,
                validationStatus: "deleted",
                objectKey: assetVersion.objectKey,
                deletedAt: claimedAt
              },
              data: { validationStatus: "pending", deletedAt: null }
            });
            await tx.auditEvent.deleteMany({ where: { id: auditEventId } });
          });
        } catch (compensationError) {
          console.error(`Failed compensating cleanup claim for asset ${assetVersion.id}`, compensationError);
        }
      }
    }
  }
}

async function cleanupExpiredPreviews() {
  const storage = createObjectStorageFromEnv();
  const settings = await prisma.merchantSettings.findMany();

  for (const setting of settings) {
    const cutoff = new Date(Date.now() - setting.previewRetentionDays * 24 * 60 * 60 * 1000);
    const expired = await prisma.assetVersion.findMany({
      where: {
        merchantId: setting.merchantId,
        validationStatus: "accepted",
        objectKey: { startsWith: `preview_derivative/${setting.merchantId}/` },
        createdAt: { lt: cutoff },
        deletedAt: null,
        asset: { kind: "preview" }
      },
      take: 100
    });

    for (const assetVersion of expired) {
      const claimedAt = new Date();
      const auditEventId = await prisma.$transaction(async (tx) => {
        const claimed = await tx.assetVersion.updateMany({
          where: {
            id: assetVersion.id,
            merchantId: setting.merchantId,
            validationStatus: "accepted",
            objectKey: assetVersion.objectKey,
            createdAt: { lt: cutoff },
            deletedAt: null
          },
          data: { validationStatus: "deleted", deletedAt: claimedAt }
        });
        if (claimed.count !== 1) return null;
        const auditEvent = await tx.auditEvent.create({
          data: {
            merchantId: assetVersion.merchantId,
            action: "asset.cleanup_preview",
            targetType: "AssetVersion",
            targetId: assetVersion.id,
            metadata: { objectKey: assetVersion.objectKey }
          }
        });
        return auditEvent.id;
      });
      if (!auditEventId) continue;

      try {
        await storage.deleteObject(assetVersion.objectKey as never);
        console.log(`Cleaned expired preview asset ${assetVersion.id}`);
      } catch (error) {
        console.error(`Failed cleaning preview asset ${assetVersion.id}`, error);
        try {
          await prisma.$transaction(async (tx) => {
            await tx.assetVersion.updateMany({
              where: {
                id: assetVersion.id,
                validationStatus: "deleted",
                objectKey: assetVersion.objectKey,
                deletedAt: claimedAt
              },
              data: { validationStatus: "accepted", deletedAt: null }
            });
            await tx.auditEvent.deleteMany({ where: { id: auditEventId } });
          });
        } catch (compensationError) {
          console.error(`Failed compensating preview cleanup claim for asset ${assetVersion.id}`, compensationError);
        }
      }
    }
  }
}

async function cleanupExpiredAdminSecurityRecords() {
  const now = new Date();
  const usedCodeCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.adminSession.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: usedCodeCutoff } }] }
    }),
    prisma.staffRecoveryCode.deleteMany({ where: { usedAt: { lt: usedCodeCutoff } } })
  ]);
}

async function loop() {
  if (stopping) return;
  const startedAt = performance.now();
  let outcome = "succeeded";
  try {
    await runMaintenanceTask("process_deletion_request", processNextDeletionRequest);
    if (Date.now() - lastCleanupAt > cleanupIntervalMs) {
      lastCleanupAt = Date.now();
      await runMaintenanceTask("cleanup_temporary_uploads", cleanupExpiredTemporaryUploads);
      await runMaintenanceTask("cleanup_previews", cleanupExpiredPreviews);
      await runMaintenanceTask("cleanup_generated_artifacts", cleanupExpiredGeneratedArtifacts);
      await runMaintenanceTask("cleanup_admin_security", cleanupExpiredAdminSecurityRecords);
      await runMaintenanceTask("reconcile_queues", reconcileQueues);
    }
  } catch (error) {
    outcome = "failed";
    console.error("Maintenance worker polling cycle failed; retrying", error);
  } finally {
    addCounter("pk.worker.polls", 1, { worker: "maintenance", outcome });
    recordHistogram("pk.worker.poll.duration", (performance.now() - startedAt) / 1000, { worker: "maintenance", outcome });
    if (!stopping) setTimeout(() => void loop(), pollIntervalMs);
  }
}

async function operationalLoop() {
  if (stopping) return;
  try {
    await trackOperation(runOperationalChecks());
  } catch (error) {
    logEvent("error", "operations.scheduler_failed", { service: "worker-maintenance", error: serializeError(error) });
  } finally {
    if (!stopping) setTimeout(() => void operationalLoop(), cleanupIntervalMs);
  }
}

async function alertDeliveryLoop() {
  if (stopping) return;
  try {
    await trackOperation(processOperationalAlertDeliveries());
  } catch (error) {
    logEvent("error", "operations.alert_delivery_scheduler_failed", { service: "worker-maintenance", error: serializeError(error) });
  } finally {
    if (!stopping) setTimeout(() => void alertDeliveryLoop(), pollIntervalMs);
  }
}

async function runMaintenanceTask(name: string, task: () => Promise<unknown>) {
  if (stopping) return;
  const startedAt = performance.now();
  await trackOperation(withSpan("maintenance.task", { "maintenance.task": name }, async (span) => {
    try {
      await task();
      addCounter("pk.maintenance.tasks", 1, { task: name, outcome: "succeeded" });
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      addCounter("pk.maintenance.tasks", 1, { task: name, outcome: "failed" });
      logEvent("error", "maintenance.task_failed", { service: "worker-maintenance", task: name, error: serializeError(error) });
    } finally {
      recordHistogram("pk.maintenance.task.duration", (performance.now() - startedAt) / 1000, { task: name });
    }
  }));
}

function trackOperation<T>(operation: Promise<T>) {
  activeOperations.add(operation);
  void operation.then(
    () => activeOperations.delete(operation),
    () => activeOperations.delete(operation)
  );
  return operation;
}

function positiveIntegerFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

validateServiceEnvironment("worker-maintenance");
await initializeTelemetry("personalise-kings-worker-maintenance");
console.log("PersonaliseKings maintenance worker started");
console.warn("Outbox dispatcher is not configured; events will remain pending");
async function shutdown() {
  stopping = true;
  await Promise.allSettled([...activeOperations]);
  await shutdownTelemetry().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
void loop();
void operationalLoop();
void alertDeliveryLoop();
