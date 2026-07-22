import { prisma } from "@personalise-kings/db";
import { validateServiceEnvironment } from "@personalise-kings/config/server";
import { addCounter, initializeTelemetry, recordHistogram, shutdownTelemetry, withSpan } from "@personalise-kings/observability/telemetry";
import { Prisma } from "@prisma/client";

const pollIntervalMs = positiveIntegerFromEnv("PRINT_JOB_POLL_INTERVAL_MS", 5000);
let stopping = false;
let activeJob: Promise<boolean | null> | null = null;
let shutdownPromise: Promise<void> | null = null;

async function processNextPrintJob() {
  return prisma.$transaction(async (tx) => {
    const [candidate] = await tx.$queryRaw<Array<{ id: string; merchantId: string }>>(Prisma.sql`
      SELECT "id", "merchantId"
      FROM "PrintJob"
      WHERE "status" = 'queued'::"PrintJobStatus"
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);

    if (!candidate) return null;

    const startedAt = performance.now();
    let outcome = "failed";
    return withSpan("worker.job", { "pk.worker": "render" }, async (span) => {
      const claimed = await tx.printJob.updateMany({
        where: { id: candidate.id, status: "queued" },
        data: { status: "running" }
      });
      if (claimed.count !== 1) return false;
      addCounter("pk.worker.jobs.claimed", 1, { worker: "render" });

      try {
        const latestAttempt = await tx.printJobAttempt.aggregate({
          where: { printJobId: candidate.id },
          _max: { attemptNumber: true }
        });
        const attemptNumber = (latestAttempt._max.attemptNumber ?? 0) + 1;

        await tx.printJobAttempt.create({
          data: {
            merchantId: candidate.merchantId,
            printJobId: candidate.id,
            attemptNumber,
            status: "needs_review",
            logs: {
              message: "Production exporter not enabled. Phase 0 RIP/printer validation is required before generating ready files."
            },
            finishedAt: new Date()
          }
        });

        await tx.printJob.update({
          where: { id: candidate.id },
          data: {
            status: "needs_review",
            lastError: "Production exporter gated by Phase 0 printer/RIP acceptance tests"
          }
        });
        outcome = "needs_review";
        console.log(`Marked print job ${candidate.id} as needs_review`);
        return true;
      } finally {
        span.setAttribute("pk.worker.outcome", outcome);
        addCounter("pk.worker.jobs.completed", 1, { worker: "render", outcome });
        recordHistogram("pk.worker.job.duration", (performance.now() - startedAt) / 1000, { worker: "render", outcome });
      }
    });
  });
}

async function loop() {
  if (stopping) return;
  const startedAt = performance.now();
  let outcome = "failed";
  try {
    const operation = processNextPrintJob();
    activeJob = operation;
    outcome = await operation ? "processed" : "idle";
  } catch (error) {
    addCounter("pk.worker.poll.errors", 1, { worker: "render" });
    console.error("Render worker polling cycle failed; retrying", error);
  } finally {
    addCounter("pk.worker.polls", 1, { worker: "render", outcome });
    recordHistogram("pk.worker.poll.duration", (performance.now() - startedAt) / 1000, { worker: "render", outcome });
    activeJob = null;
    if (!stopping) setTimeout(() => void loop(), pollIntervalMs);
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
    await shutdownTelemetry().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exitCode = 0;
  })();
  return shutdownPromise;
}

validateServiceEnvironment("worker-render");
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
await initializeTelemetry("personalise-kings-worker-render");
console.log("PersonaliseKings render worker started");
void loop();
