import { prisma } from "@personalise-kings/db";
import { createObjectStorageFromEnv, isObjectKey } from "@personalise-kings/storage";
import { badRequest, notFound, ok } from "../../../../../../lib/api";
import { writeAuditEvent } from "../../../../../../lib/audit";
import { requirePermission } from "../../../../../../lib/rbac";
import { requireSameOrigin } from "../../../../../../lib/same-origin";

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ revisionId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("view_customisation");
  if (access.error) return access.error;

  const { revisionId } = await params;
  const job = await prisma.proofJob.findFirst({
    where: { customisationRevisionId: revisionId, merchantId: access.session.merchantId, status: "ready" },
    select: {
      id: true,
      rendererVersion: true,
      proofAssetVersion: {
        select: { id: true, objectKey: true, checksumSha256: true, validationStatus: true, deletedAt: true }
      }
    }
  });
  const proof = job?.proofAssetVersion;
  if (!job || !proof || proof.validationStatus !== "accepted" || proof.deletedAt) {
    return notFound("Customisation proof not found");
  }
  if (!isObjectKey(proof.objectKey) || !proof.objectKey.startsWith(`preview_derivative/${access.session.merchantId}/`)) {
    return badRequest("Proof object key is invalid");
  }

  const signedGetUrl = await createObjectStorageFromEnv().createSignedGetUrl(proof.objectKey, 5 * 60);
  await writeAuditEvent({
    merchantId: access.session.merchantId,
    actorUserId: access.session.userId,
    action: "customisation.proof_url_create",
    targetType: "CustomisationRevision",
    targetId: revisionId,
    metadata: {
      proofJobId: job.id,
      proofAssetVersionId: proof.id,
      rendererVersion: job.rendererVersion,
      checksumSha256: proof.checksumSha256,
      expiresInSeconds: 300
    }
  });
  return ok({ signedGetUrl, expiresInSeconds: 300 });
}
