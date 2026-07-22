import { prisma } from "@personalise-kings/db";
import { addCounter } from "@personalise-kings/observability/telemetry";
import { badRequest, notFound, ok, toInputJson } from "../../../../../lib/api";
import { writeAuditEvent } from "../../../../../lib/audit";
import { requirePermission } from "../../../../../lib/rbac";
import { requireSameOrigin } from "../../../../../lib/same-origin";

const regeneratableStatuses = ["failed", "needs_review", "ready", "cancelled"] as const;

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ printJobId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("regenerate_artifact");
  if (access.error) return access.error;

  const { printJobId } = await params;
  const existing = await prisma.printJob.findFirst({
    where: { id: printJobId, merchantId: access.session.merchantId }
  });

  if (!existing) return notFound("Print job not found");

  if (!regeneratableStatuses.includes(existing.status as never)) {
    return badRequest("Only failed, needs-review, ready, or cancelled jobs can be regenerated");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const printJob = await tx.printJob.update({
      where: { id: existing.id },
      data: {
        status: "queued",
        retryCount: { increment: 1 },
        lastError: null
      }
    });

    await tx.outboxEvent.create({
      data: {
        merchantId: access.session.merchantId,
        eventType: "print_job.regeneration_requested",
        aggregateType: "PrintJob",
        aggregateId: printJob.id,
        payload: toInputJson({ printJobId: printJob.id }),
        correlationId: `manual-regenerate-${printJob.id}-${Date.now()}`
      }
    });
    await writeAuditEvent({
      merchantId: access.session.merchantId,
      actorUserId: access.session.userId,
      action: "print_job.regenerate",
      targetType: "PrintJob",
      targetId: printJob.id,
      metadata: { previousStatus: existing.status, retryCount: printJob.retryCount }
    }, tx);

    return printJob;
  });
  addCounter("pk.outbox.events.created", 1, {
    event_type: "print_job.regeneration_requested",
    producer: "admin_regeneration"
  });

  return ok(updated);
}
