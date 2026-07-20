import { prisma } from "@personalise-kings/db";
import { Prisma } from "@prisma/client";

const pollIntervalMs = positiveIntegerFromEnv("PRINT_JOB_POLL_INTERVAL_MS", 5000);

async function processNextPrintJob() {
  const job = await prisma.$transaction(async (tx) => {
    const [candidate] = await tx.$queryRaw<Array<{ id: string; merchantId: string }>>(Prisma.sql`
      SELECT "id", "merchantId"
      FROM "PrintJob"
      WHERE "status" = 'queued'::"PrintJobStatus"
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);

    if (!candidate) return null;

    const claimed = await tx.printJob.updateMany({
      where: { id: candidate.id, status: "queued" },
      data: { status: "running" }
    });
    if (claimed.count !== 1) return null;

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

    return candidate;
  });

  if (!job) return;
  console.log(`Marked print job ${job.id} as needs_review`);
}

async function loop() {
  try {
    await processNextPrintJob();
  } catch (error) {
    console.error("Render worker polling cycle failed; retrying", error);
  } finally {
    setTimeout(() => void loop(), pollIntervalMs);
  }
}

function positiveIntegerFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

console.log("PersonaliseKings render worker started");
void loop();
