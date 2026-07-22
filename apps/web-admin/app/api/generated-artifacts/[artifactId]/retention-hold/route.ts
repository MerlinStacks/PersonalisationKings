import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { badRequest, notFound, ok, parseJson } from "../../../../../lib/api";
import { requirePermission } from "../../../../../lib/rbac";
import { requireSameOrigin } from "../../../../../lib/same-origin";

const holdSchema = z.object({
  reason: z.string().trim().min(10).max(500),
  holdUntil: z.string().datetime({ offset: true }).nullable().optional()
});

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ artifactId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_artifact_retention");
  if (access.error) return access.error;
  const parsed = await parseJson(request, holdSchema);
  if (parsed.error) return parsed.error;
  const { artifactId } = await params;
  const now = new Date();
  const holdUntil = parsed.data.holdUntil ? new Date(parsed.data.holdUntil) : null;
  if (holdUntil && (holdUntil <= now || holdUntil.getTime() > now.getTime() + 10 * 365 * 24 * 60 * 60 * 1000)) {
    return badRequest("Hold expiry must be in the future and no more than ten years away");
  }

  const existing = await prisma.generatedArtifact.findFirst({
    where: { id: artifactId, merchantId: access.session.merchantId },
    select: { id: true, bytesDeletedAt: true }
  });
  if (!existing) return notFound("Generated artifact not found");
  if (existing.bytesDeletedAt) return badRequest("Artifact bytes have already expired; a hold cannot restore them");

  const held = await prisma.$transaction(async (tx) => {
    const updated = await tx.generatedArtifact.updateMany({
      where: { id: artifactId, merchantId: access.session.merchantId, bytesDeletedAt: null, cleanupClaimedAt: null },
      data: {
        retentionHoldAt: now,
        retentionHoldUntil: holdUntil,
        retentionHoldReason: parsed.data.reason,
        retentionHoldSetByUserId: access.session.userId
      }
    });
    if (updated.count !== 1) return false;
    await tx.auditEvent.create({
      data: {
        merchantId: access.session.merchantId,
        actorUserId: access.session.userId,
        action: "artifact.retention_hold_set",
        targetType: "GeneratedArtifact",
        targetId: artifactId,
        metadata: { reason: parsed.data.reason, holdUntil: holdUntil?.toISOString() ?? null }
      }
    });
    return true;
  });
  if (!held) return ok({ error: "artifact_cleanup_in_progress", message: "Artifact cleanup has already started" }, { status: 409 });
  return ok({ held: true, holdUntil });
}

export async function DELETE(request: Request, { params }: Readonly<{ params: Promise<{ artifactId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_artifact_retention");
  if (access.error) return access.error;
  const { artifactId } = await params;

  const released = await prisma.$transaction(async (tx) => {
    const updated = await tx.generatedArtifact.updateMany({
      where: { id: artifactId, merchantId: access.session.merchantId, retentionHoldAt: { not: null } },
      data: {
        retentionHoldAt: null,
        retentionHoldUntil: null,
        retentionHoldReason: null,
        retentionHoldSetByUserId: null,
        nextCleanupAttemptAt: new Date()
      }
    });
    if (updated.count !== 1) return false;
    await tx.auditEvent.create({
      data: {
        merchantId: access.session.merchantId,
        actorUserId: access.session.userId,
        action: "artifact.retention_hold_released",
        targetType: "GeneratedArtifact",
        targetId: artifactId,
        metadata: {}
      }
    });
    return true;
  });
  if (!released) return notFound("Active artifact retention hold not found");
  return ok({ held: false });
}
