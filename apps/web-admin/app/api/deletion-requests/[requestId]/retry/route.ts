import { prisma } from "@personalise-kings/db";
import { badRequest, ok } from "../../../../../lib/api";
import { writeAuditEvent } from "../../../../../lib/audit";
import { requirePermission } from "../../../../../lib/rbac";
import { requireSameOrigin } from "../../../../../lib/same-origin";

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ requestId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("delete_asset");
  if (access.error) return access.error;
  const { requestId } = await params;
  const existing = await prisma.deletionRequest.findFirst({
    where: { id: requestId, merchantId: access.session.merchantId, status: { in: ["failed", "blocked_ordered"] } }
  });
  if (!existing) return badRequest("Only failed or blocked requests can be rechecked");

  const retried = await prisma.$transaction(async (tx) => {
    const updated = await tx.deletionRequest.update({
      where: { id: existing.id },
      data: {
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
        claimedAt: null,
        lastError: null,
        eligibilityReason: null,
        executionPlan: undefined
      }
    });
    await writeAuditEvent({
      merchantId: access.session.merchantId,
      actorUserId: access.session.userId,
      action: "deletion_request.retry",
      targetType: "DeletionRequest",
      targetId: existing.id,
      metadata: { previousStatus: existing.status }
    }, tx);
    return updated;
  });
  return ok(retried);
}
