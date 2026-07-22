import { prisma } from "@personalise-kings/db";
import { validateServiceEnvironment } from "@personalise-kings/config/server";
import { addCounter, initializeTelemetry, recordHistogram, shutdownTelemetry, SpanStatusCode, withSpan } from "@personalise-kings/observability/telemetry";
import { createObjectStorageFromEnv, objectKey, type ObjectKey } from "@personalise-kings/storage";
import { Prisma } from "@prisma/client";
import { chromium, type Browser } from "playwright";
import { renderProofPng } from "./render-proof";

const pollIntervalMs = positiveIntegerFromEnv("PROOF_JOB_POLL_INTERVAL_MS", 5000);
const maximumAttempts = positiveIntegerFromEnv("PROOF_JOB_MAX_ATTEMPTS", 5);
const staleClaimMs = 15 * 60 * 1000;
let browser: Browser | null = null;
let stopping = false;
let activeJob: Promise<boolean> | null = null;
let shutdownPromise: Promise<void> | null = null;

async function processNextProofJob() {
  const job = await claimProofJob();
  if (!job) return false;

  const startedAt = performance.now();
  let outcome = "failed";
  addCounter("pk.worker.jobs.claimed", 1, { worker: "proof" });
  await withSpan("worker.job", { "pk.worker": "proof" }, async (span) => {
    let writtenKey: ObjectKey | null = null;
    try {
      const record = await prisma.proofJob.findFirst({
        where: { id: job.id, merchantId: job.merchantId, status: "running" },
        include: {
          customisationRevision: {
            include: { previewAssetVersion: true }
          }
        }
      });
      const preview = record?.customisationRevision.previewAssetVersion;
      if (!record || !preview || preview.validationStatus !== "accepted" || preview.deletedAt
        || preview.contentType !== "image/svg+xml" || !preview.widthPx || !preview.heightPx
        || !preview.objectKey.startsWith(`preview_derivative/${job.merchantId}/`)) {
        throw new Error("The revision preview is unavailable or invalid");
      }

      const storage = createObjectStorageFromEnv();
      const svgBytes = await storage.getObject(preview.objectKey as ObjectKey);
      const pngBytes = await renderProofPng(await proofBrowser(), {
        bytes: svgBytes,
        widthPx: preview.widthPx,
        heightPx: preview.heightPx
      });
      writtenKey = objectKey("preview_derivative", job.merchantId, `${record.customisationRevisionId}-${record.rendererVersion}-${job.claimedAt.getTime()}.png`);
      const stored = await storage.putObject(writtenKey, pngBytes, "image/png");

      await prisma.$transaction(async (tx) => {
        const asset = await tx.asset.create({
          data: {
            merchantId: job.merchantId,
            kind: "preview",
            name: `Customisation proof ${record.customisationRevisionId}`,
            versions: {
              create: {
                version: 1,
                objectKey: stored.objectKey,
                checksumSha256: stored.checksumSha256,
                byteSize: stored.byteSize,
                contentType: stored.contentType,
                widthPx: preview.widthPx,
                heightPx: preview.heightPx,
                validationStatus: "accepted"
              }
            }
          },
          include: { versions: true }
        });
        const proof = asset.versions[0];
        if (!proof) throw new Error("Proof asset version was not created");
        const completed = await tx.proofJob.updateMany({
          where: { id: job.id, merchantId: job.merchantId, status: "running", claimedAt: job.claimedAt },
          data: { status: "ready", proofAssetVersionId: proof.id, claimedAt: null, lastError: null }
        });
        if (completed.count !== 1) throw new Error("Proof job claim was lost before completion");
        await tx.auditEvent.create({
          data: {
            merchantId: job.merchantId,
            action: "customisation.proof_generated",
            targetType: "CustomisationRevision",
            targetId: record.customisationRevisionId,
            metadata: { proofAssetVersionId: proof.id, rendererVersion: record.rendererVersion, checksumSha256: proof.checksumSha256 }
          }
        });
      });
      outcome = "ready";
      console.log(`Generated proof for revision ${record.customisationRevisionId}`);
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      if (writtenKey) await createObjectStorageFromEnv().deleteObject(writtenKey).catch(() => undefined);
      outcome = await failProofJob(job, error);
    } finally {
      span.setAttribute("pk.worker.outcome", outcome);
      addCounter("pk.worker.jobs.completed", 1, { worker: "proof", outcome });
      recordHistogram("pk.worker.job.duration", (performance.now() - startedAt) / 1000, { worker: "proof", outcome });
    }
  });
  return true;
}

async function claimProofJob() {
  return prisma.$transaction(async (tx) => {
    await tx.proofJob.updateMany({
      where: { status: "running", claimedAt: { lt: new Date(Date.now() - staleClaimMs) } },
      data: { status: "queued", claimedAt: null, lastError: "Recovered stale proof worker claim" }
    });
    const [candidate] = await tx.$queryRaw<Array<{ id: string; merchantId: string }>>(Prisma.sql`
      SELECT "id", "merchantId"
      FROM "ProofJob"
      WHERE "status" = 'queued'::"ProofJobStatus"
        AND "nextAttemptAt" <= NOW()
        AND "attempts" < ${maximumAttempts}
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    if (!candidate) return null;
    const claimedAt = new Date();
    const claimed = await tx.proofJob.updateMany({
      where: { id: candidate.id, merchantId: candidate.merchantId, status: "queued" },
      data: { status: "running", attempts: { increment: 1 }, claimedAt }
    });
    return claimed.count === 1 ? { ...candidate, claimedAt } : null;
  });
}

async function failProofJob(job: { id: string; merchantId: string; claimedAt: Date }, error: unknown) {
  const current = await prisma.proofJob.findFirst({
    where: { id: job.id, merchantId: job.merchantId },
    select: { attempts: true }
  });
  if (!current) return "claim_lost";
  const terminal = current.attempts >= maximumAttempts;
  const delaySeconds = Math.min(15 * 60, 15 * 2 ** Math.max(0, current.attempts - 1));
  const message = (error instanceof Error ? error.message : "Unknown proof generation error").slice(0, 1000);
  const updated = await prisma.proofJob.updateMany({
    where: { id: job.id, merchantId: job.merchantId, status: "running", claimedAt: job.claimedAt },
    data: {
      status: terminal ? "failed" : "queued",
      claimedAt: null,
      nextAttemptAt: terminal ? new Date() : new Date(Date.now() + delaySeconds * 1000),
      lastError: message
    }
  });
  if (updated.count !== 1) return "claim_lost";
  console.error(`Proof job ${job.id} ${terminal ? "failed" : "will retry"}: ${message}`);
  return terminal ? "failed" : "retry";
}

async function proofBrowser() {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PK_PROOF_CHROMIUM_EXECUTABLE_PATH || undefined
  });
  return browser;
}

async function loop() {
  if (stopping) return;
  const startedAt = performance.now();
  let outcome = "failed";
  try {
    const operation = processNextProofJob();
    activeJob = operation;
    const processed = await operation;
    outcome = processed ? "processed" : "idle";
    if (!stopping) setTimeout(() => void loop(), processed ? 0 : pollIntervalMs);
  } catch (error) {
    addCounter("pk.worker.poll.errors", 1, { worker: "proof" });
    console.error("Proof worker polling cycle failed; retrying", error);
    if (!stopping) setTimeout(() => void loop(), pollIntervalMs);
  } finally {
    addCounter("pk.worker.polls", 1, { worker: "proof", outcome });
    recordHistogram("pk.worker.poll.duration", (performance.now() - startedAt) / 1000, { worker: "proof", outcome });
    activeJob = null;
  }
}

function positiveIntegerFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

async function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    stopping = true;
    if (activeJob) await Promise.allSettled([activeJob]);
    await browser?.close().catch(() => undefined);
    await shutdownTelemetry().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exitCode = 0;
  })();
  return shutdownPromise;
}

validateServiceEnvironment("worker-proof");
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
await initializeTelemetry("personalise-kings-worker-proof");
console.log("PersonaliseKings proof worker started");
void loop();
