import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { created, ok, parseJson } from "../../../lib/api";
import { writeAuditEvent } from "../../../lib/audit";
import { requirePermission } from "../../../lib/rbac";
import { requireSameOrigin } from "../../../lib/same-origin";

const createDeletionRequestSchema = z.object({
  subjectType: z.enum(["Asset", "AssetVersion", "CustomisationSession", "ExternalOrder", "CustomerReference"]),
  subjectId: z.string().min(1),
  backupExpiryNote: z.string().max(500).optional()
});

export async function GET() {
  const access = await requirePermission("delete_asset");
  if (access.error) return access.error;

  const requests = await prisma.deletionRequest.findMany({
    where: { merchantId: access.session.merchantId },
    orderBy: { createdAt: "desc" },
    take: 100
  });

  return ok({ items: requests });
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("delete_asset");
  if (access.error) return access.error;

  const parsed = await parseJson(request, createDeletionRequestSchema);
  if (parsed.error) return parsed.error;

  const deletionRequest = await prisma.$transaction(async (tx) => {
    const createdRequest = await tx.deletionRequest.create({
      data: {
        merchantId: access.session.merchantId,
        subjectType: parsed.data.subjectType,
        subjectId: parsed.data.subjectId,
        status: "pending",
        backupExpiryNote: parsed.data.backupExpiryNote
      }
    });
    await writeAuditEvent({
      merchantId: access.session.merchantId,
      actorUserId: access.session.userId,
      action: "deletion_request.create",
      targetType: parsed.data.subjectType,
      targetId: parsed.data.subjectId,
      metadata: { deletionRequestId: createdRequest.id }
    }, tx);
    return createdRequest;
  });

  return created(deletionRequest);
}
