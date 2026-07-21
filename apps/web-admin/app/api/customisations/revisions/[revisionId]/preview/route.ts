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
  const revision = await prisma.customisationRevision.findFirst({
    where: { id: revisionId, merchantId: access.session.merchantId },
    select: {
      id: true,
      previewAssetVersion: {
        select: { id: true, objectKey: true, checksumSha256: true, validationStatus: true, deletedAt: true }
      }
    }
  });
  const preview = revision?.previewAssetVersion;
  if (!revision || !preview || preview.validationStatus !== "accepted" || preview.deletedAt) {
    return notFound("Customisation preview not found");
  }
  if (!isObjectKey(preview.objectKey) || !preview.objectKey.startsWith(`preview_derivative/${access.session.merchantId}/`)) {
    return badRequest("Preview object key is invalid");
  }

  const signedGetUrl = await createObjectStorageFromEnv().createSignedGetUrl(preview.objectKey, 5 * 60);
  await writeAuditEvent({
    merchantId: access.session.merchantId,
    actorUserId: access.session.userId,
    action: "customisation.preview_url_create",
    targetType: "CustomisationRevision",
    targetId: revision.id,
    metadata: { previewAssetVersionId: preview.id, checksumSha256: preview.checksumSha256, expiresInSeconds: 300 }
  });
  return ok({ signedGetUrl, expiresInSeconds: 300 });
}
