import { prisma } from "@personalise-kings/db";
import { createObjectStorageFromEnv, type ObjectKey } from "@personalise-kings/storage";
import { Prisma, type DeletionRequest } from "@prisma/client";
import { addCounter } from "@personalise-kings/observability/telemetry";

const staleClaimMs = 15 * 60 * 1000;
const maximumAttempts = 10;

interface DeletionPlan {
  sourceVersionIds: string[];
  sourceAssetIds: string[];
  derivativeVersionIds: string[];
  derivativeAssetIds: string[];
  sessionIds: string[];
  objectKeys: string[];
}

interface DeletionTerminalOutcome {
  outcome: "blocked" | "already_deleted";
}

export async function processNextDeletionRequest() {
  const request = await claimDeletionRequest();
  if (!request?.claimedAt) return false;
  let outcome = "processed";
  try {
    const plan = parsePlan(request.executionPlan) ?? await prepareDeletion(request);
    if ("outcome" in plan) {
      addCounter("pk.deletion.attempts", 1, { outcome: plan.outcome });
      return true;
    }
    const storage = createObjectStorageFromEnv();
    for (const key of plan.objectKeys) {
      await renewDeletionClaim(request);
      await storage.deleteObject(key as ObjectKey);
    }
    await renewDeletionClaim(request);
    await finalizeDeletion(request, plan);
  } catch (error) {
    const terminal = request.attempts >= maximumAttempts;
    outcome = terminal ? "failed" : "retry";
    const message = (error instanceof Error ? error.message : "Unknown deletion error").slice(0, 1000);
    await prisma.deletionRequest.updateMany({
      where: { id: request.id, merchantId: request.merchantId, status: "processing", claimedAt: request.claimedAt },
      data: {
        status: terminal ? "failed" : "pending",
        claimedAt: null,
        nextAttemptAt: new Date(Date.now() + Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, request.attempts - 1))),
        lastError: message
      }
    });
    console.error(`Deletion request ${request.id} will retry: ${message}`);
  }
  addCounter("pk.deletion.attempts", 1, { outcome });
  return true;
}

async function renewDeletionClaim(request: DeletionRequest) {
  const claimedAt = new Date();
  const renewed = await prisma.deletionRequest.updateMany({
    where: { id: request.id, merchantId: request.merchantId, status: "processing", claimedAt: request.claimedAt },
    data: { claimedAt }
  });
  if (renewed.count !== 1) throw new Error("Deletion request claim was lost before storage deletion");
  request.claimedAt = claimedAt;
}

async function claimDeletionRequest() {
  return prisma.$transaction(async (tx) => {
    const [candidate] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "DeletionRequest"
      WHERE (
        ("status" IN ('pending'::"DeletionRequestStatus", 'failed'::"DeletionRequestStatus") AND "nextAttemptAt" <= NOW())
        OR ("status" = 'processing'::"DeletionRequestStatus" AND "claimedAt" < ${new Date(Date.now() - staleClaimMs)})
      )
        AND "attempts" < ${maximumAttempts}
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    if (!candidate) return null;
    const claimedAt = new Date();
    return tx.deletionRequest.update({
      where: { id: candidate.id },
      data: { status: "processing", claimedAt, attempts: { increment: 1 }, lastError: null }
    });
  });
}

async function prepareDeletion(request: DeletionRequest): Promise<DeletionPlan | DeletionTerminalOutcome> {
  return prisma.$transaction(async (tx) => {
    await assertDeletionClaim(tx, request);
    const sourceVersions = request.subjectType === "Asset"
      ? await tx.assetVersion.findMany({
        where: { merchantId: request.merchantId, assetId: request.subjectId, deletedAt: null, asset: { kind: "upload" } },
        select: { id: true, assetId: true, objectKey: true }
      })
      : await tx.assetVersion.findMany({
        where: { merchantId: request.merchantId, id: request.subjectId, deletedAt: null, asset: { kind: "upload" } },
        select: { id: true, assetId: true, objectKey: true }
      });
    if (sourceVersions.length === 0) {
      const completed = await tx.deletionRequest.updateMany({
        where: { id: request.id, merchantId: request.merchantId, status: "processing", claimedAt: request.claimedAt },
        data: { status: "live_deleted", liveDeletedAt: new Date(), claimedAt: null, eligibilityReason: "No live customer upload remained" }
      });
      if (completed.count !== 1) throw new Error("Deletion request claim was lost during preparation");
      await tx.auditEvent.create({
        data: {
          merchantId: request.merchantId,
          action: "deletion_request.live_storage_deleted",
          targetType: "DeletionRequest",
          targetId: request.id,
          metadata: { sourceVersionsDeleted: 0, derivativesDeleted: 0, sessionsDeleted: 0, reason: "No live customer upload remained" }
        }
      });
      return { outcome: "already_deleted" };
    }

    const sourceIds = new Set(sourceVersions.map((version) => version.id));
    const [designVersions, sessions, snapshots] = await Promise.all([
      tx.designVersion.findMany({ where: { merchantId: request.merchantId }, select: { id: true, sceneGraph: true } }),
      tx.customisationSession.findMany({
        where: { merchantId: request.merchantId },
        select: {
          id: true, status: true, renderSpec: true, customerInputs: true,
          revisions: {
            select: {
              id: true, renderSpec: true, customerInputs: true,
              lineItems: { select: { id: true }, take: 1 },
              snapshots: { select: { id: true }, take: 1 },
              previewAssetVersion: { select: { id: true, assetId: true, objectKey: true } },
              proofJob: { select: { id: true, proofAssetVersion: { select: { id: true, assetId: true, objectKey: true } } } }
            }
          }
        }
      }),
      tx.orderArtworkSnapshot.findMany({ where: { merchantId: request.merchantId }, select: { id: true, snapshot: true } })
    ]);

    if (designVersions.some((version) => jsonContainsExact(version.sceneGraph, sourceIds))) {
      await blockRequest(tx, request, "Customer upload is referenced by an immutable design version");
      return { outcome: "blocked" };
    }
    if (snapshots.some((snapshot) => jsonContainsExact(snapshot.snapshot, sourceIds))) {
      await blockRequest(tx, request, "Customer upload is retained in an order artwork snapshot");
      return { outcome: "blocked" };
    }

    const affectedSessions = sessions.filter((session) => jsonContainsExact(session.renderSpec, sourceIds)
      || jsonContainsExact(session.customerInputs, sourceIds)
      || session.revisions.some((revision) => jsonContainsExact(revision.renderSpec, sourceIds) || jsonContainsExact(revision.customerInputs, sourceIds)));
    const ordered = affectedSessions.some((session) => ["ordered", "ready", "needs_review"].includes(session.status)
      || session.revisions.some((revision) => revision.lineItems.length > 0 || revision.snapshots.length > 0));
    if (ordered) {
      await blockRequest(tx, request, "Customer upload is linked to an order or production record");
      return { outcome: "blocked" };
    }

    const derivatives = affectedSessions.flatMap((session) => session.revisions.flatMap((revision) => [
      revision.previewAssetVersion,
      revision.proofJob?.proofAssetVersion
    ].filter((value): value is NonNullable<typeof value> => Boolean(value))));
    const plan: DeletionPlan = {
      sourceVersionIds: sourceVersions.map((version) => version.id),
      sourceAssetIds: [...new Set(sourceVersions.map((version) => version.assetId))],
      derivativeVersionIds: [...new Set(derivatives.map((version) => version.id))],
      derivativeAssetIds: [...new Set(derivatives.map((version) => version.assetId))],
      sessionIds: affectedSessions.map((session) => session.id),
      objectKeys: [...new Set([...sourceVersions, ...derivatives].map((version) => version.objectKey))]
    };
    const deletedAt = new Date();
    await tx.assetVersion.updateMany({
      where: { id: { in: [...plan.sourceVersionIds, ...plan.derivativeVersionIds] }, merchantId: request.merchantId },
      data: { validationStatus: "deleted", deletedAt }
    });
    await tx.customisationSession.updateMany({
      where: { id: { in: plan.sessionIds }, merchantId: request.merchantId },
      data: { status: "archived", expiresAt: deletedAt }
    });
    await tx.proofJob.updateMany({
      where: { merchantId: request.merchantId, customisationRevision: { sessionId: { in: plan.sessionIds } } },
      data: { status: "failed", claimedAt: null, lastError: "Cancelled by customer upload erasure" }
    });
    const persisted = await tx.deletionRequest.updateMany({
      where: { id: request.id, merchantId: request.merchantId, status: "processing", claimedAt: request.claimedAt },
      data: { executionPlan: plan as unknown as Prisma.InputJsonValue, eligibilityReason: "Eligible unordered customer upload", lastError: null }
    });
    if (persisted.count !== 1) throw new Error("Deletion request claim was lost during preparation");
    return plan;
  }, { isolationLevel: "Serializable" });
}

async function finalizeDeletion(request: DeletionRequest, plan: DeletionPlan) {
  await prisma.$transaction(async (tx) => {
    await tx.customisationSession.deleteMany({ where: { id: { in: plan.sessionIds }, merchantId: request.merchantId, status: "archived" } });
    await tx.assetVersion.deleteMany({
      where: { id: { in: [...plan.derivativeVersionIds, ...plan.sourceVersionIds] }, merchantId: request.merchantId, validationStatus: "deleted" }
    });
    await tx.asset.deleteMany({
      where: { id: { in: [...plan.derivativeAssetIds, ...plan.sourceAssetIds] }, merchantId: request.merchantId, versions: { none: {} } }
    });
    const completed = await tx.deletionRequest.updateMany({
      where: { id: request.id, merchantId: request.merchantId, status: "processing", claimedAt: request.claimedAt },
      data: {
        status: "live_deleted",
        liveDeletedAt: new Date(),
        claimedAt: null,
        lastError: null,
        executionPlan: {
          sourceVersionsDeleted: plan.sourceVersionIds.length,
          derivativesDeleted: plan.derivativeVersionIds.length,
          sessionsDeleted: plan.sessionIds.length
        }
      }
    });
    if (completed.count !== 1) throw new Error("Deletion request claim was lost before finalization");
    await tx.auditEvent.create({
      data: {
        merchantId: request.merchantId,
        action: "deletion_request.live_storage_deleted",
        targetType: "DeletionRequest",
        targetId: request.id,
        metadata: {
          sourceVersionsDeleted: plan.sourceVersionIds.length,
          derivativesDeleted: plan.derivativeVersionIds.length,
          sessionsDeleted: plan.sessionIds.length
        }
      }
    });
  });
  console.log(`Completed live deletion request ${request.id}`);
}

async function blockRequest(tx: Prisma.TransactionClient, request: DeletionRequest, reason: string) {
  const blocked = await tx.deletionRequest.updateMany({
    where: { id: request.id, merchantId: request.merchantId, status: "processing", claimedAt: request.claimedAt },
    data: { status: "blocked_ordered", claimedAt: null, eligibilityReason: reason, lastError: null }
  });
  if (blocked.count !== 1) throw new Error("Deletion request claim was lost before it could be blocked");
  await tx.auditEvent.create({
    data: {
      merchantId: request.merchantId,
      action: "deletion_request.blocked",
      targetType: "DeletionRequest",
      targetId: request.id,
      metadata: { reason }
    }
  });
}

async function assertDeletionClaim(tx: Prisma.TransactionClient, request: DeletionRequest) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "DeletionRequest"
    WHERE "id" = ${request.id}
      AND "merchantId" = ${request.merchantId}
      AND "status" = 'processing'::"DeletionRequestStatus"
      AND "claimedAt" = ${request.claimedAt}
    FOR UPDATE
  `);
  if (rows.length !== 1) throw new Error("Deletion request claim was lost before preparation");
}

export function jsonContainsExact(value: unknown, targets: ReadonlySet<string>): boolean {
  if (typeof value === "string") return targets.has(value);
  if (Array.isArray(value)) return value.some((item) => jsonContainsExact(item, targets));
  if (value && typeof value === "object") return Object.values(value).some((item) => jsonContainsExact(item, targets));
  return false;
}

function parsePlan(value: Prisma.JsonValue | null): DeletionPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys: Array<keyof DeletionPlan> = ["sourceVersionIds", "sourceAssetIds", "derivativeVersionIds", "derivativeAssetIds", "sessionIds", "objectKeys"];
  if (!keys.every((key) => Array.isArray(record[key]) && (record[key] as unknown[]).every((item) => typeof item === "string"))) return null;
  return Object.fromEntries(keys.map((key) => [key, record[key]])) as unknown as DeletionPlan;
}
