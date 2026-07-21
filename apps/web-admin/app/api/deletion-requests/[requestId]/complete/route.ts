import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { badRequest, ok, parseJson } from "../../../../../lib/api";
import { writeAuditEvent } from "../../../../../lib/audit";
import { requirePermission } from "../../../../../lib/rbac";
import { requireSameOrigin } from "../../../../../lib/same-origin";

const confirmationSchema = z.object({
  backupExpiryNote: z.string().trim().min(10).max(500)
});

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ requestId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("delete_asset");
  if (access.error) return access.error;
  const parsed = await parseJson(request, confirmationSchema);
  if (parsed.error) return parsed.error;
  const { requestId } = await params;

  const existing = await prisma.deletionRequest.findFirst({
    where: { id: requestId, merchantId: access.session.merchantId, status: "live_deleted" }
  });
  if (!existing) return badRequest("Only a live-deleted request can confirm backup purge");
  const now = new Date();
  const completed = await prisma.$transaction(async (tx) => {
    const updated = await tx.deletionRequest.update({
      where: { id: existing.id },
      data: {
        status: "completed",
        completedAt: now,
        backupPurgedAt: now,
        backupExpiryNote: parsed.data.backupExpiryNote
      }
    });
    await writeAuditEvent({
      merchantId: access.session.merchantId,
      actorUserId: access.session.userId,
      action: "deletion_request.backup_purge_confirm",
      targetType: "DeletionRequest",
      targetId: existing.id,
      metadata: { liveDeletedAt: existing.liveDeletedAt?.toISOString(), confirmedAt: now.toISOString() }
    }, tx);
    return updated;
  });
  return ok(completed);
}
