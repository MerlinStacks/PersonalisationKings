import { randomUUID } from "node:crypto";
import { prisma } from "@personalise-kings/db";
import { recordHistogram } from "@personalise-kings/observability/telemetry";
import { Prisma } from "@prisma/client";

const defaultBatchSize = 100;
const staleClaimMs = 15 * 60 * 1000;

interface LeasedJobState {
  status: string;
  attempts: number;
  claimedAt: Date | null;
}

interface RepairPlan {
  status: "queued" | "pending" | "failed";
  reason: string;
}

export async function reconcileQueues(options: {
  proofMaximumAttempts?: number;
  deletionMaximumAttempts?: number;
  batchSize?: number;
  merchantId?: string;
} = {}) {
  const now = new Date();
  const proofMaximumAttempts = options.proofMaximumAttempts ?? positiveIntegerFromEnv("PROOF_JOB_MAX_ATTEMPTS", 5);
  const deletionMaximumAttempts = options.deletionMaximumAttempts ?? 10;
  const batchSize = options.batchSize ?? defaultBatchSize;
  const [proofRepairs, missingProofJobs, deletionRepairs] = await Promise.all([
    repairProofJobs(now, proofMaximumAttempts, batchSize, options.merchantId),
    recreateMissingProofJobs(batchSize, options.merchantId),
    repairDeletionRequests(now, deletionMaximumAttempts, batchSize, options.merchantId)
  ]);
  const observations = await observeUnsupportedQueues(now, options.merchantId);
  const report = { proofRepairs, missingProofJobs, deletionRepairs, ...observations };
  console.log("Queue reconciliation completed", report);
  return report;
}

async function repairProofJobs(now: Date, maximumAttempts: number, batchSize: number, merchantId?: string) {
  const staleBefore = new Date(now.getTime() - staleClaimMs);
  const jobs = await prisma.proofJob.findMany({
    where: {
      merchantId,
      OR: [
        { status: "queued", attempts: { gte: maximumAttempts } },
        { status: "running", OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }] }
      ]
    },
    select: { id: true, merchantId: true, status: true, attempts: true, claimedAt: true },
    orderBy: { updatedAt: "asc" },
    take: batchSize
  });
  let repaired = 0;
  for (const job of jobs) {
    const plan = planProofRepair(job, now, maximumAttempts);
    if (!plan) continue;
    repaired += await applyRepair("ProofJob", job, plan, now);
  }
  return repaired;
}

async function repairDeletionRequests(now: Date, maximumAttempts: number, batchSize: number, merchantId?: string) {
  const staleBefore = new Date(now.getTime() - staleClaimMs);
  const requests = await prisma.deletionRequest.findMany({
    where: {
      merchantId,
      OR: [
        { status: "pending", attempts: { gte: maximumAttempts } },
        { status: "processing", OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }] }
      ]
    },
    select: { id: true, merchantId: true, status: true, attempts: true, claimedAt: true },
    orderBy: { updatedAt: "asc" },
    take: batchSize
  });
  let repaired = 0;
  for (const request of requests) {
    const plan = planDeletionRepair(request, now, maximumAttempts);
    if (!plan) continue;
    repaired += await applyRepair("DeletionRequest", request, plan, now);
  }
  return repaired;
}

async function applyRepair(
  targetType: "ProofJob" | "DeletionRequest",
  record: LeasedJobState & { id: string; merchantId: string },
  plan: RepairPlan,
  now: Date
) {
  return prisma.$transaction(async (tx) => {
    const where = {
      id: record.id,
      merchantId: record.merchantId,
      status: record.status as never,
      attempts: record.attempts,
      claimedAt: record.claimedAt
    };
    const data = {
      status: plan.status as never,
      claimedAt: null,
      nextAttemptAt: now,
      lastError: plan.reason
    };
    const result = targetType === "ProofJob"
      ? await tx.proofJob.updateMany({ where, data })
      : await tx.deletionRequest.updateMany({ where, data });
    if (result.count !== 1) return 0;
    await tx.auditEvent.create({
      data: {
        merchantId: record.merchantId,
        action: targetType === "ProofJob" ? "queue.proof_reconciled" : "queue.deletion_reconciled",
        targetType,
        targetId: record.id,
        metadata: { previousStatus: record.status, attempts: record.attempts, repairedStatus: plan.status, reason: plan.reason }
      }
    });
    return 1;
  });
}

async function recreateMissingProofJobs(batchSize: number, merchantId?: string) {
  const merchantPredicate = merchantId ? Prisma.sql`AND revision."merchantId" = ${merchantId}` : Prisma.empty;
  const revisions = await prisma.$queryRaw<Array<{
    id: string;
    merchantId: string;
    sessionStatus: string;
    objectKey: string;
    validationStatus: string;
    deletedAt: Date | null;
    contentType: string;
    widthPx: number;
    heightPx: number;
  }>>(Prisma.sql`
    SELECT revision."id", revision."merchantId", session."status"::text AS "sessionStatus",
      preview."objectKey", preview."validationStatus"::text AS "validationStatus", preview."deletedAt",
      preview."contentType", preview."widthPx", preview."heightPx"
    FROM "CustomisationRevision" revision
    JOIN "CustomisationSession" session
      ON session."id" = revision."sessionId" AND session."merchantId" = revision."merchantId"
    JOIN "AssetVersion" preview
      ON preview."id" = revision."previewAssetVersionId" AND preview."merchantId" = revision."merchantId"
    LEFT JOIN "ProofJob" proof ON proof."customisationRevisionId" = revision."id"
    WHERE proof."id" IS NULL
      AND preview."validationStatus" = 'accepted'::"AssetValidationStatus"
      AND preview."deletedAt" IS NULL
      AND preview."contentType" = 'image/svg+xml'
      AND preview."widthPx" > 0
      AND preview."heightPx" > 0
      AND preview."objectKey" LIKE ('preview_derivative/' || revision."merchantId" || '/%')
      AND session."status" NOT IN ('cancelled'::"CustomisationStatus", 'archived'::"CustomisationStatus")
      ${merchantPredicate}
    ORDER BY revision."committedAt" ASC
    LIMIT ${batchSize}
  `);
  let created = 0;
  for (const revision of revisions) {
    if (!isEligibleMissingProof({
      merchantId: revision.merchantId,
      session: { status: revision.sessionStatus },
      previewAssetVersion: revision
    })) continue;
    created += await prisma.$transaction(async (tx) => {
      const inserted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        INSERT INTO "ProofJob" ("id", "merchantId", "customisationRevisionId", "rendererVersion", "updatedAt")
        SELECT ${randomUUID()}, revision."merchantId", revision."id", 'proof-playwright.v1', NOW()
        FROM "CustomisationRevision" revision
        JOIN "CustomisationSession" session
          ON session."id" = revision."sessionId" AND session."merchantId" = revision."merchantId"
        JOIN "AssetVersion" preview
          ON preview."id" = revision."previewAssetVersionId" AND preview."merchantId" = revision."merchantId"
        WHERE revision."id" = ${revision.id}
          AND revision."merchantId" = ${revision.merchantId}
          AND preview."validationStatus" = 'accepted'::"AssetValidationStatus"
          AND preview."deletedAt" IS NULL
          AND preview."contentType" = 'image/svg+xml'
          AND preview."widthPx" > 0
          AND preview."heightPx" > 0
          AND preview."objectKey" LIKE ('preview_derivative/' || revision."merchantId" || '/%')
          AND session."status" NOT IN ('cancelled'::"CustomisationStatus", 'archived'::"CustomisationStatus")
          AND NOT EXISTS (SELECT 1 FROM "ProofJob" proof WHERE proof."customisationRevisionId" = revision."id")
        ON CONFLICT ("customisationRevisionId") DO NOTHING
        RETURNING "id"
      `);
      if (inserted.length !== 1) return 0;
      await tx.auditEvent.create({
        data: {
          merchantId: revision.merchantId,
          action: "queue.proof_missing_recreated",
          targetType: "CustomisationRevision",
          targetId: revision.id,
          metadata: { rendererVersion: "proof-playwright.v1" }
        }
      });
      return 1;
    });
  }
  return created;
}

async function observeUnsupportedQueues(now: Date, merchantId?: string) {
  const oldWorkCutoff = new Date(now.getTime() - 15 * 60 * 1000);
  const cap = 1001;
  const printMerchant = merchantId ? Prisma.sql`AND "merchantId" = ${merchantId}` : Prisma.empty;
  const webhookMerchant = merchantId ? Prisma.sql`AND "merchantId" = ${merchantId}` : Prisma.empty;
  const outboxMerchant = merchantId ? Prisma.sql`AND "merchantId" = ${merchantId}` : Prisma.empty;
  const proofMerchant = merchantId ? Prisma.sql`AND proof."merchantId" = ${merchantId}` : Prisma.empty;
  const deletionMerchant = merchantId ? Prisma.sql`AND "merchantId" = ${merchantId}` : Prisma.empty;
  const [counts, oldestOutbox] = await Promise.all([
    prisma.$queryRaw<Array<{
      oldQueuedPrintJobs: bigint;
      runningPrintJobs: bigint;
      duplicatePrintJobs: bigint;
      unprocessedWebhooks: bigint;
      pendingOutbox: bigint;
      invalidReadyProofJobs: bigint;
      invalidDeletionTimestamps: bigint;
    }>>(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM (SELECT 1 FROM "PrintJob" WHERE "status" = 'queued'::"PrintJobStatus" AND "createdAt" < ${oldWorkCutoff} ${printMerchant} LIMIT ${cap}) rows) AS "oldQueuedPrintJobs",
        (SELECT COUNT(*) FROM (SELECT 1 FROM "PrintJob" WHERE "status" = 'running'::"PrintJobStatus" ${printMerchant} LIMIT ${cap}) rows) AS "runningPrintJobs",
        (SELECT COUNT(*) FROM (
          SELECT 1
          FROM (SELECT "orderId", "artworkSnapshotId" FROM "PrintJob" WHERE TRUE ${printMerchant} ORDER BY "createdAt" DESC LIMIT ${cap}) recent
          GROUP BY "orderId", "artworkSnapshotId"
          HAVING COUNT(*) > 1
        ) rows) AS "duplicatePrintJobs",
        (SELECT COUNT(*) FROM (SELECT 1 FROM "WebhookDelivery" WHERE "processedAt" IS NULL ${webhookMerchant} LIMIT ${cap}) rows) AS "unprocessedWebhooks",
        (SELECT COUNT(*) FROM (SELECT 1 FROM "OutboxEvent" WHERE "dispatchedAt" IS NULL AND "failedAt" IS NULL ${outboxMerchant} LIMIT ${cap}) rows) AS "pendingOutbox",
        (SELECT COUNT(*) FROM (
          SELECT 1 FROM "ProofJob" proof
          LEFT JOIN "AssetVersion" asset ON asset."id" = proof."proofAssetVersionId" AND asset."merchantId" = proof."merchantId"
          WHERE proof."status" = 'ready'::"ProofJobStatus"
            AND (asset."id" IS NULL OR asset."validationStatus" <> 'accepted'::"AssetValidationStatus" OR asset."deletedAt" IS NOT NULL OR asset."contentType" <> 'image/png')
          ${proofMerchant}
          LIMIT ${cap}
        ) rows) AS "invalidReadyProofJobs",
        (SELECT COUNT(*) FROM (
          SELECT 1 FROM "DeletionRequest"
          WHERE (("status" = 'live_deleted'::"DeletionRequestStatus" AND "liveDeletedAt" IS NULL)
            OR ("status" = 'completed'::"DeletionRequestStatus" AND ("liveDeletedAt" IS NULL OR "backupPurgedAt" IS NULL OR "completedAt" IS NULL)))
          ${deletionMerchant}
          LIMIT ${cap}
        ) rows) AS "invalidDeletionTimestamps"
    `),
    prisma.outboxEvent.findFirst({
      where: { merchantId, dispatchedAt: null, failedAt: null },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true }
    })
  ]);
  const observed = counts[0];
  recordHistogram("pk.connector.inbox.backlog.pending", boundedMetricCount(observed?.unprocessedWebhooks, cap));
  recordHistogram("pk.outbox.backlog.pending", boundedMetricCount(observed?.pendingOutbox, cap));
  if (oldestOutbox) {
    recordHistogram("pk.outbox.backlog.oldest_age", Math.max(0, (now.getTime() - oldestOutbox.createdAt.getTime()) / 1000));
  }
  return {
    observationCountCap: cap - 1,
    observedOldQueuedPrintJobs: cappedCount(observed?.oldQueuedPrintJobs, cap),
    observedRunningPrintJobs: cappedCount(observed?.runningPrintJobs, cap),
    observedDuplicateRecentPrintJobGroups: cappedCount(observed?.duplicatePrintJobs, cap),
    observedUnprocessedWebhooks: cappedCount(observed?.unprocessedWebhooks, cap),
    observedPendingOutbox: cappedCount(observed?.pendingOutbox, cap),
    observedOldestPendingOutboxAt: oldestOutbox?.createdAt.toISOString() ?? null,
    observedInvalidReadyProofJobs: cappedCount(observed?.invalidReadyProofJobs, cap),
    observedInvalidDeletionTimestamps: cappedCount(observed?.invalidDeletionTimestamps, cap)
  };
}

function cappedCount(value: bigint | undefined, cap: number) {
  const count = Number(value ?? 0n);
  return count >= cap ? `${cap - 1}+` : count;
}

function boundedMetricCount(value: bigint | undefined, cap: number) {
  return Math.min(Number(value ?? 0n), cap - 1);
}

export function planProofRepair(job: LeasedJobState, now: Date, maximumAttempts: number): RepairPlan | null {
  if (job.status === "queued" && job.attempts >= maximumAttempts) {
    return { status: "failed", reason: "Proof job exhausted its configured attempts before completion" };
  }
  if (job.status !== "running" || (job.claimedAt && job.claimedAt.getTime() >= now.getTime() - staleClaimMs)) return null;
  return job.attempts >= maximumAttempts
    ? { status: "failed", reason: "Proof job exhausted its configured attempts after a stale claim" }
    : { status: "queued", reason: "Recovered stale or missing proof worker claim" };
}

export function planDeletionRepair(request: LeasedJobState, now: Date, maximumAttempts: number): RepairPlan | null {
  if (request.status === "pending" && request.attempts >= maximumAttempts) {
    return { status: "failed", reason: "Deletion request exhausted its configured attempts before completion" };
  }
  if (request.status !== "processing" || (request.claimedAt && request.claimedAt.getTime() >= now.getTime() - staleClaimMs)) return null;
  return request.attempts >= maximumAttempts
    ? { status: "failed", reason: "Deletion request exhausted its configured attempts after a stale claim" }
    : { status: "pending", reason: "Recovered stale or missing deletion worker claim" };
}

export function isEligibleMissingProof(revision: {
  merchantId: string;
  session: { status: string };
  previewAssetVersion: {
    objectKey: string;
    validationStatus: string;
    deletedAt: Date | null;
    contentType: string;
    widthPx: number | null;
    heightPx: number | null;
  } | null;
}) {
  const preview = revision.previewAssetVersion;
  return !["cancelled", "archived"].includes(revision.session.status)
    && preview?.validationStatus === "accepted"
    && preview.deletedAt === null
    && preview.contentType === "image/svg+xml"
    && Boolean(preview.widthPx && preview.widthPx > 0 && preview.heightPx && preview.heightPx > 0)
    && preview.objectKey.startsWith(`preview_derivative/${revision.merchantId}/`);
}

function positiveIntegerFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
