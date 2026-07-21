import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { badRequest, created, ok, parseJson } from "../../../lib/api";
import { writeAuditEvent } from "../../../lib/audit";
import { requirePermission } from "../../../lib/rbac";
import { requireSameOrigin } from "../../../lib/same-origin";

const createDeletionRequestSchema = z.object({
  subjectType: z.enum(["Asset", "AssetVersion"]),
  subjectId: z.string().min(1).max(191)
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

  const target = parsed.data.subjectType === "Asset"
    ? await prisma.asset.findFirst({
      where: { id: parsed.data.subjectId, merchantId: access.session.merchantId, kind: "upload" },
      include: { versions: { where: { deletedAt: null }, take: 1 } }
    })
    : await prisma.assetVersion.findFirst({
      where: { id: parsed.data.subjectId, merchantId: access.session.merchantId, deletedAt: null, asset: { kind: "upload" } },
      include: { asset: true }
    });
  if (!target || (parsed.data.subjectType === "Asset" && "versions" in target && target.versions.length === 0)) {
    return badRequest("An active customer upload belonging to this merchant is required");
  }
  const existing = await prisma.deletionRequest.findFirst({
    where: {
      merchantId: access.session.merchantId,
      subjectType: parsed.data.subjectType,
      subjectId: parsed.data.subjectId,
      status: { not: "completed" }
    }
  });
  if (existing) return badRequest("An active deletion request already exists for this subject");

  const deletionRequest = await prisma.$transaction(async (tx) => {
    const createdRequest = await tx.deletionRequest.create({
      data: {
        merchantId: access.session.merchantId,
        subjectType: parsed.data.subjectType,
        subjectId: parsed.data.subjectId,
        status: "pending",
        backupExpiryNote: "Live deletion does not remove external backups. Completion requires explicit backup-rotation confirmation."
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
