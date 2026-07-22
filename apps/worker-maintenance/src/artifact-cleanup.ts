import { randomUUID } from "node:crypto";
import { prisma } from "@personalise-kings/db";
import { createObjectStorageFromEnv, isProductionArtifactKey, type ObjectKey, type ObjectStorage } from "@personalise-kings/storage";
import { addCounter, recordHistogram } from "@personalise-kings/observability/telemetry";

const staleClaimMs = 15 * 60 * 1000;

export async function cleanupExpiredGeneratedArtifacts(options: {
  now?: Date;
  batchSize?: number;
  merchantId?: string;
  storage?: ObjectStorage;
} = {}) {
  const now = options.now ?? new Date();
  const startedAt = performance.now();
  const batchSize = options.batchSize ?? 100;
  const storage = options.storage ?? createObjectStorageFromEnv();
  const settings = await prisma.merchantSettings.findMany({
    where: { merchantId: options.merchantId },
    select: { merchantId: true, productionArtifactRetentionDays: true }
  });
  let deleted = 0;
  let failures = 0;
  let bytesDeleted = 0;

  for (const setting of settings) {
    if (!Number.isSafeInteger(setting.productionArtifactRetentionDays) || setting.productionArtifactRetentionDays < 1) continue;
    const cutoff = new Date(now.getTime() - setting.productionArtifactRetentionDays * 24 * 60 * 60 * 1000);
    const staleBefore = new Date(now.getTime() - staleClaimMs);
    const candidates = await prisma.generatedArtifact.findMany({
      where: {
        merchantId: setting.merchantId,
        bytesDeletedAt: null,
        createdAt: { lt: cutoff },
        nextCleanupAttemptAt: { lte: now },
        objectKey: { startsWith: `production_artifact/${setting.merchantId}/` },
        OR: [{ cleanupClaimedAt: null }, { cleanupClaimedAt: { lt: staleBefore } }],
        AND: [{ OR: [{ downloadLeaseUntil: null }, { downloadLeaseUntil: { lt: now } }] }],
        NOT: { retentionHoldAt: { not: null }, OR: [{ retentionHoldUntil: null }, { retentionHoldUntil: { gt: now } }] },
        printJobAttempt: {
          finishedAt: { not: null },
          printJob: { status: { notIn: ["queued", "running"] } }
        }
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: batchSize
    });

    for (const candidate of candidates) {
      const token = randomUUID();
      const claimed = await prisma.generatedArtifact.updateMany({
        where: {
          id: candidate.id,
          merchantId: setting.merchantId,
          bytesDeletedAt: null,
          createdAt: { lt: cutoff },
          nextCleanupAttemptAt: { lte: now },
          objectKey: { startsWith: `production_artifact/${setting.merchantId}/` },
          OR: [{ cleanupClaimedAt: null }, { cleanupClaimedAt: { lt: staleBefore } }],
          AND: [{ OR: [{ downloadLeaseUntil: null }, { downloadLeaseUntil: { lt: now } }] }],
          NOT: { retentionHoldAt: { not: null }, OR: [{ retentionHoldUntil: null }, { retentionHoldUntil: { gt: now } }] },
          printJobAttempt: { finishedAt: { not: null }, printJob: { status: { notIn: ["queued", "running"] } } }
        },
        data: { cleanupClaimedAt: now, cleanupClaimToken: token, cleanupAttempts: { increment: 1 }, lastCleanupError: null }
      });
      if (claimed.count !== 1) continue;
      const artifact = await prisma.generatedArtifact.findFirst({
        where: { id: candidate.id, merchantId: setting.merchantId, cleanupClaimToken: token },
        select: { id: true, merchantId: true, objectKey: true, cleanupAttempts: true, byteSize: true }
      });
      if (!artifact || !isProductionArtifactKey(artifact.objectKey, artifact.merchantId)) continue;

      try {
        await storage.deleteObject(artifact.objectKey as ObjectKey);
        bytesDeleted += Number(artifact.byteSize);
        deleted += await prisma.$transaction(async (tx) => {
          const completed = await tx.generatedArtifact.updateMany({
            where: { id: artifact.id, merchantId: artifact.merchantId, bytesDeletedAt: null, cleanupClaimToken: token },
            data: {
              bytesDeletedAt: new Date(),
              cleanupClaimedAt: null,
              cleanupClaimToken: null,
              lastCleanupError: null,
              downloadLeaseUntil: null
            }
          });
          if (completed.count !== 1) return 0;
          await tx.auditEvent.create({
            data: {
              merchantId: artifact.merchantId,
              action: "artifact.cleanup_production_bytes",
              targetType: "GeneratedArtifact",
              targetId: artifact.id,
              metadata: { objectKey: artifact.objectKey, cleanupAttempts: artifact.cleanupAttempts, backupDeletionConfirmed: false }
            }
          });
          return 1;
        });
      } catch (error) {
        failures += 1;
        const message = (error instanceof Error ? error.message : "Unknown artifact cleanup error").slice(0, 1000);
        const delayMs = Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, artifact.cleanupAttempts - 1));
        await prisma.generatedArtifact.updateMany({
          where: { id: artifact.id, merchantId: artifact.merchantId, bytesDeletedAt: null, cleanupClaimToken: token },
          data: {
            nextCleanupAttemptAt: new Date(Date.now() + delayMs),
            lastCleanupError: message
          }
        });
        console.error(`Generated artifact ${artifact.id} cleanup remains unavailable until stale-claim retry: ${message}`);
      }
    }
  }
  addCounter("pk.artifact.cleanup.runs", 1, { kind: "production_artifact", outcome: failures > 0 ? "degraded" : "succeeded" });
  if (deleted > 0) addCounter("pk.artifact.cleanup.attempts", deleted, { kind: "production_artifact", outcome: "succeeded" });
  if (failures > 0) addCounter("pk.artifact.cleanup.attempts", failures, { kind: "production_artifact", outcome: "failed" });
  if (bytesDeleted > 0) addCounter("pk.artifact.cleanup.bytes_deleted", bytesDeleted, { kind: "production_artifact" });
  recordHistogram("pk.artifact.cleanup.duration", (performance.now() - startedAt) / 1000, { kind: "production_artifact" });
  return deleted;
}

export function artifactBytesAvailable(value: { bytesDeletedAt: Date | null; cleanupClaimedAt: Date | null }) {
  return value.bytesDeletedAt === null && value.cleanupClaimedAt === null;
}

export function artifactRetentionHeld(value: { retentionHoldAt: Date | null; retentionHoldUntil: Date | null }, now = new Date()) {
  return value.retentionHoldAt !== null && (value.retentionHoldUntil === null || value.retentionHoldUntil > now);
}
