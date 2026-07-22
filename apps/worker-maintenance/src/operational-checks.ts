import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@personalise-kings/db";
import { logEvent, serializeError } from "@personalise-kings/observability";
import { addCounter, recordHistogram } from "@personalise-kings/observability/telemetry";
import { Prisma } from "@prisma/client";

const artifactRules = [
  "artifact.cleanup_backlog",
  "artifact.cleanup_stale_claim",
  "artifact.cleanup_retries",
  "artifact.indefinite_hold_review",
  "merchant.settings_missing",
  "operations.check_failed"
] as const;

export interface ArtifactOperationalMetrics {
  eligibleBacklog: number | string;
  oldestOverdueSeconds: number;
  staleClaims: number | string;
  oldestClaimSeconds: number;
  retryingThreePlus: number | string;
  retryingFivePlus: number | string;
  indefiniteHoldsOver90Days: number | string;
  settingsPresent: boolean;
  sampleArtifactIds: string[];
}

interface AlertEvaluation {
  rule: (typeof artifactRules)[number];
  severity: "warning" | "critical";
  summary: string;
  details: Record<string, unknown>;
}

export async function runOperationalChecks(options: { now?: Date; merchantId?: string } = {}) {
  const runId = randomUUID();
  const merchants = await prisma.merchant.findMany({
    where: { id: options.merchantId },
    select: { id: true, settings: { select: { productionArtifactRetentionDays: true } } }
  });
  let degraded = 0;
  let failed = 0;

  for (const merchant of merchants) {
    const startedAt = new Date();
    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`operations:${merchant.id}`}))`);
        const evaluationNow = options.now ?? new Date();
        const metrics = await collectArtifactMetrics(tx, merchant.id, merchant.settings?.productionArtifactRetentionDays ?? 90, Boolean(merchant.settings), evaluationNow);
        const alerts = evaluateArtifactAlerts(metrics);
        const completedAt = options.now ?? new Date();
        await tx.operationalCheckRun.create({
          data: {
            merchantId: merchant.id,
            runId,
            checkType: "artifact_cleanup",
            status: alerts.length > 0 ? "degraded" : "succeeded",
            metrics: metrics as unknown as Prisma.InputJsonValue,
            startedAt,
            completedAt,
            correlationId: runId
          }
        });
        await synchronizeAlerts(tx, merchant.id, alerts, evaluationNow);
        return { metrics, alerts };
      });
      if (result.alerts.length > 0) degraded += 1;
      const outcome = result.alerts.length > 0 ? "degraded" : "succeeded";
      addCounter("pk.operations.checks", 1, { check: "artifact_cleanup", outcome });
      recordHistogram("pk.operations.check.duration", (Date.now() - startedAt.getTime()) / 1000, { check: "artifact_cleanup", outcome });
      logEvent(result.alerts.length > 0 ? "warn" : "info", "operations.artifact_cleanup_check", {
        service: "worker-maintenance",
        runId,
        merchantId: merchant.id,
        outcome: result.alerts.length > 0 ? "degraded" : "succeeded",
        durationMs: Date.now() - startedAt.getTime(),
        metrics: result.metrics
      });
    } catch (error) {
      failed += 1;
      addCounter("pk.operations.checks", 1, { check: "artifact_cleanup", outcome: "failed" });
      recordHistogram("pk.operations.check.duration", (Date.now() - startedAt.getTime()) / 1000, { check: "artifact_cleanup", outcome: "failed" });
      const message = (error instanceof Error ? error.message : "Unknown operational check error").slice(0, 1000);
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`operations:${merchant.id}`}))`);
        const failureNow = options.now ?? new Date();
        await tx.operationalCheckRun.create({
          data: {
            merchantId: merchant.id,
            runId,
            checkType: "artifact_cleanup",
            status: "failed",
            metrics: {},
            error: message,
            startedAt,
            completedAt: failureNow,
            correlationId: runId
          }
        });
        await synchronizeAlerts(tx, merchant.id, [{
          rule: "operations.check_failed",
          severity: "critical",
          summary: "Artifact operational check failed",
          details: { message }
        }], failureNow, false);
      }).catch(() => undefined);
      logEvent("error", "operations.artifact_cleanup_check", {
        service: "worker-maintenance",
        runId,
        merchantId: merchant.id,
        outcome: "failed",
        error: serializeError(error)
      });
    }
  }

  await pruneOperationalCheckRuns(options.now ?? new Date());
  return { runId, checked: merchants.length, degraded, failed };
}

async function collectArtifactMetrics(
  tx: Prisma.TransactionClient,
  merchantId: string,
  retentionDays: number,
  settingsPresent: boolean,
  now: Date
): Promise<ArtifactOperationalMetrics> {
  const cap = 1001;
  const cutoff = new Date(now.getTime() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000);
  const staleBefore = new Date(now.getTime() - 20 * 60 * 1000);
  const cleanupStaleBefore = new Date(now.getTime() - 15 * 60 * 1000);
  const holdReviewBefore = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const [rows, samples] = await Promise.all([
    tx.$queryRaw<Array<{
      eligibleBacklog: bigint;
      oldestEligibleAt: Date | null;
      staleClaims: bigint;
      oldestClaimAt: Date | null;
      retryingThreePlus: bigint;
      retryingFivePlus: bigint;
      indefiniteHolds: bigint;
    }>>(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM (
          SELECT 1 FROM "GeneratedArtifact" artifact
          JOIN "PrintJobAttempt" attempt ON attempt."id" = artifact."printJobAttemptId" AND attempt."merchantId" = artifact."merchantId"
          JOIN "PrintJob" job ON job."id" = attempt."printJobId" AND job."merchantId" = artifact."merchantId"
          WHERE artifact."merchantId" = ${merchantId} AND artifact."bytesDeletedAt" IS NULL
            AND artifact."createdAt" < ${cutoff} AND artifact."nextCleanupAttemptAt" <= ${now}
            AND (artifact."cleanupClaimedAt" IS NULL OR artifact."cleanupClaimedAt" < ${cleanupStaleBefore})
            AND starts_with(artifact."objectKey", 'production_artifact/' || artifact."merchantId" || '/')
            AND (artifact."downloadLeaseUntil" IS NULL OR artifact."downloadLeaseUntil" < ${now})
            AND NOT (artifact."retentionHoldAt" IS NOT NULL AND (artifact."retentionHoldUntil" IS NULL OR artifact."retentionHoldUntil" > ${now}))
            AND attempt."finishedAt" IS NOT NULL AND job."status" NOT IN ('queued'::"PrintJobStatus", 'running'::"PrintJobStatus")
          LIMIT ${cap}
        ) rows) AS "eligibleBacklog",
        (SELECT MIN(artifact."createdAt") FROM "GeneratedArtifact" artifact
          JOIN "PrintJobAttempt" attempt ON attempt."id" = artifact."printJobAttemptId" AND attempt."merchantId" = artifact."merchantId"
          JOIN "PrintJob" job ON job."id" = attempt."printJobId" AND job."merchantId" = artifact."merchantId"
          WHERE artifact."merchantId" = ${merchantId} AND artifact."bytesDeletedAt" IS NULL
            AND artifact."createdAt" < ${cutoff} AND artifact."nextCleanupAttemptAt" <= ${now}
            AND (artifact."cleanupClaimedAt" IS NULL OR artifact."cleanupClaimedAt" < ${cleanupStaleBefore})
            AND starts_with(artifact."objectKey", 'production_artifact/' || artifact."merchantId" || '/')
            AND (artifact."downloadLeaseUntil" IS NULL OR artifact."downloadLeaseUntil" < ${now})
            AND NOT (artifact."retentionHoldAt" IS NOT NULL AND (artifact."retentionHoldUntil" IS NULL OR artifact."retentionHoldUntil" > ${now}))
            AND attempt."finishedAt" IS NOT NULL AND job."status" NOT IN ('queued'::"PrintJobStatus", 'running'::"PrintJobStatus")) AS "oldestEligibleAt",
        (SELECT COUNT(*) FROM (SELECT 1 FROM "GeneratedArtifact" WHERE "merchantId" = ${merchantId} AND "bytesDeletedAt" IS NULL AND "cleanupClaimedAt" < ${staleBefore} LIMIT ${cap}) rows) AS "staleClaims",
        (SELECT MIN("cleanupClaimedAt") FROM "GeneratedArtifact" WHERE "merchantId" = ${merchantId} AND "bytesDeletedAt" IS NULL AND "cleanupClaimedAt" < ${staleBefore}) AS "oldestClaimAt",
        (SELECT COUNT(*) FROM (SELECT 1 FROM "GeneratedArtifact" WHERE "merchantId" = ${merchantId} AND "bytesDeletedAt" IS NULL AND "cleanupAttempts" >= 3 LIMIT ${cap}) rows) AS "retryingThreePlus",
        (SELECT COUNT(*) FROM (SELECT 1 FROM "GeneratedArtifact" WHERE "merchantId" = ${merchantId} AND "bytesDeletedAt" IS NULL AND "cleanupAttempts" >= 5 LIMIT ${cap}) rows) AS "retryingFivePlus",
        (SELECT COUNT(*) FROM (SELECT 1 FROM "GeneratedArtifact" WHERE "merchantId" = ${merchantId} AND "retentionHoldAt" < ${holdReviewBefore} AND "retentionHoldUntil" IS NULL LIMIT ${cap}) rows) AS "indefiniteHolds"
    `),
    tx.generatedArtifact.findMany({
      where: {
        merchantId,
        bytesDeletedAt: null,
        OR: [
          { cleanupClaimedAt: { lt: staleBefore } },
          { cleanupAttempts: { gte: 3 } },
          { retentionHoldAt: { lt: holdReviewBefore }, retentionHoldUntil: null }
        ]
      },
      select: { id: true },
      take: 5
    })
  ]);
  const values = rows[0];
  return {
    eligibleBacklog: cappedCount(Number(values?.eligibleBacklog ?? 0n), cap),
    oldestOverdueSeconds: values?.oldestEligibleAt ? Math.max(0, Math.floor((cutoff.getTime() - values.oldestEligibleAt.getTime()) / 1000)) : 0,
    staleClaims: cappedCount(Number(values?.staleClaims ?? 0n), cap),
    oldestClaimSeconds: values?.oldestClaimAt ? Math.max(0, Math.floor((now.getTime() - values.oldestClaimAt.getTime()) / 1000)) : 0,
    retryingThreePlus: cappedCount(Number(values?.retryingThreePlus ?? 0n), cap),
    retryingFivePlus: cappedCount(Number(values?.retryingFivePlus ?? 0n), cap),
    indefiniteHoldsOver90Days: cappedCount(Number(values?.indefiniteHolds ?? 0n), cap),
    settingsPresent,
    sampleArtifactIds: samples.map((item) => item.id)
  };
}

export function evaluateArtifactAlerts(metrics: ArtifactOperationalMetrics): AlertEvaluation[] {
  const alerts: AlertEvaluation[] = [];
  if (metrics.oldestOverdueSeconds > 60 * 60) alerts.push(alert("artifact.cleanup_backlog", "critical", "Artifact cleanup backlog exceeds 60 minutes", metrics));
  else if (metrics.oldestOverdueSeconds > 15 * 60) alerts.push(alert("artifact.cleanup_backlog", "warning", "Artifact cleanup backlog exceeds 15 minutes", metrics));
  if (metrics.oldestClaimSeconds > 45 * 60 || numericCount(metrics.staleClaims) >= 10) alerts.push(alert("artifact.cleanup_stale_claim", "critical", "Artifact cleanup claims are critically stale", metrics));
  else if (numericCount(metrics.staleClaims) > 0) alerts.push(alert("artifact.cleanup_stale_claim", "warning", "Artifact cleanup has stale claims", metrics));
  if (numericCount(metrics.retryingFivePlus) > 0) alerts.push(alert("artifact.cleanup_retries", "critical", "Artifact cleanup has five-attempt failures", metrics));
  else if (numericCount(metrics.retryingThreePlus) > 0) alerts.push(alert("artifact.cleanup_retries", "warning", "Artifact cleanup has repeated failures", metrics));
  if (numericCount(metrics.indefiniteHoldsOver90Days) > 0) alerts.push(alert("artifact.indefinite_hold_review", "warning", "Indefinite artifact holds require review", metrics));
  if (!metrics.settingsPresent) alerts.push(alert("merchant.settings_missing", "warning", "Merchant retention settings are missing", metrics));
  return alerts;
}

async function synchronizeAlerts(
  tx: Prisma.TransactionClient,
  merchantId: string,
  evaluations: AlertEvaluation[],
  now: Date,
  resolveMissing = true
) {
  const activeRules = new Set(evaluations.map((item) => item.rule));
  for (const evaluation of evaluations) {
    const fingerprint = createHash("sha256").update(`${merchantId}|${evaluation.rule}`).digest("hex");
    const existing = await tx.operationalAlert.findUnique({ where: { fingerprint } });
    if (!existing) {
      const created = await tx.operationalAlert.create({
        data: {
          merchantId,
          fingerprint,
          rule: evaluation.rule,
          severity: evaluation.severity,
          summary: evaluation.summary,
          details: evaluation.details as Prisma.InputJsonValue,
          firstTriggeredAt: now,
          lastObservedAt: now
        }
      });
      await queueAlertDelivery(tx, created, now);
      continue;
    }
    const reopened = existing.status === "resolved";
    const escalated = existing.severity === "warning" && evaluation.severity === "critical";
    const updated = await tx.operationalAlert.update({
      where: { id: existing.id },
      data: {
        severity: evaluation.severity,
        status: reopened || escalated ? "open" : existing.status,
        summary: evaluation.summary,
        details: evaluation.details as Prisma.InputJsonValue,
        lastObservedAt: now,
        resolvedAt: null,
        acknowledgedAt: reopened || escalated ? null : existing.acknowledgedAt,
        acknowledgedByUserId: reopened || escalated ? null : existing.acknowledgedByUserId,
        occurrences: { increment: 1 },
        notificationVersion: reopened || escalated ? { increment: 1 } : undefined
      }
    });
    if (reopened || escalated) {
      await queueAlertDelivery(tx, updated, now);
    }
  }
  if (resolveMissing) {
    const resolved = await tx.operationalAlert.findMany({
      where: { merchantId, rule: { in: artifactRules.filter((rule) => !activeRules.has(rule)) }, status: { in: ["open", "acknowledged"] } },
      select: { id: true }
    });
    for (const alert of resolved) {
      const updated = await tx.operationalAlert.update({
        where: { id: alert.id },
        data: { status: "resolved", resolvedAt: now, lastObservedAt: now, notificationVersion: { increment: 1 } }
      });
      await queueAlertDelivery(tx, updated, now);
    }
  }
}

async function queueAlertDelivery(tx: Prisma.TransactionClient, alert: {
  id: string;
  merchantId: string;
  rule: string;
  severity: string;
  status: string;
  summary: string;
  details: Prisma.JsonValue;
  notificationVersion: number;
  lastObservedAt: Date;
}, transitionAt: Date) {
  await tx.operationalAlertDelivery.create({
    data: {
      alertId: alert.id,
      notificationVersion: alert.notificationVersion,
      payload: {
        schemaVersion: "operational-alert.v1",
        alertId: alert.id,
        merchantId: alert.merchantId,
        rule: alert.rule,
        severity: alert.severity,
        status: alert.status,
        summary: alert.summary,
        details: alert.details,
        notificationVersion: alert.notificationVersion,
        observedAt: alert.lastObservedAt.toISOString(),
        transitionAt: transitionAt.toISOString(),
        resolvedAt: alert.status === "resolved" ? transitionAt.toISOString() : null
      } as Prisma.InputJsonValue
    }
  });
}

async function pruneOperationalCheckRuns(now: Date) {
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  for (let batch = 0; batch < 100; batch += 1) {
    const deleted = await prisma.$executeRaw(Prisma.sql`
      DELETE FROM "OperationalCheckRun"
      WHERE "id" IN (
        SELECT "id" FROM "OperationalCheckRun"
        WHERE "completedAt" < ${cutoff}
        ORDER BY "completedAt" ASC
        LIMIT 1000
      )
    `);
    if (deleted < 1000) break;
    if (batch === 99) logEvent("warn", "operations.check_history_prune_capped", { deletedRows: 100_000 });
  }
}

function alert(rule: AlertEvaluation["rule"], severity: AlertEvaluation["severity"], summary: string, metrics: ArtifactOperationalMetrics): AlertEvaluation {
  return { rule, severity, summary, details: { ...metrics, sampleArtifactIds: metrics.sampleArtifactIds.slice(0, 5) } };
}

function cappedCount(count: number, cap: number) {
  return count >= cap ? `${cap - 1}+` : count;
}

function numericCount(value: number | string) {
  return typeof value === "number" ? value : Number.parseInt(value, 10);
}
