import { prisma } from "@personalise-kings/db";
import { ok } from "../../../lib/api";
import { requirePermission } from "../../../lib/rbac";

export async function GET() {
  const access = await requirePermission("download_artifact");
  if (access.error) return access.error;

  const artifacts = await prisma.generatedArtifact.findMany({
    where: { merchantId: access.session.merchantId },
    orderBy: { createdAt: "desc" },
    include: {
      printJobAttempt: { include: { printJob: { include: { order: true } } } },
      outputProfileVersion: true
    },
    take: 100
  });

  return ok({
    items: artifacts.map((artifact) => ({
      ...artifact,
      byteSize: artifact.byteSize.toString(),
      availability: artifact.bytesDeletedAt ? "expired" : artifact.cleanupClaimedAt ? "cleanup_pending" : "available",
      retentionHeld: Boolean(artifact.retentionHoldAt && (!artifact.retentionHoldUntil || artifact.retentionHoldUntil > new Date()))
    }))
  });
}
