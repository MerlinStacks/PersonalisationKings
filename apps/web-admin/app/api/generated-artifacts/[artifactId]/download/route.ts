import { prisma } from "@personalise-kings/db";
import { createObjectStorageFromEnv, isObjectKey } from "@personalise-kings/storage";
import { badRequest, notFound, ok } from "../../../../../lib/api";
import { writeAuditEvent } from "../../../../../lib/audit";
import { requirePermission } from "../../../../../lib/rbac";
import { requireSameOrigin } from "../../../../../lib/same-origin";

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ artifactId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("download_artifact");
  if (access.error) return access.error;

  const { artifactId } = await params;
  const artifact = await prisma.generatedArtifact.findFirst({
    where: { id: artifactId, merchantId: access.session.merchantId }
  });

  if (!artifact) return notFound("Generated artifact not found");
  if (!isObjectKey(artifact.objectKey)) return badRequest("Artifact object key is invalid");

  const storage = createObjectStorageFromEnv();
  const signedGetUrl = await storage.createSignedGetUrl(artifact.objectKey, 300);

  await writeAuditEvent({
    merchantId: access.session.merchantId,
    actorUserId: access.session.userId,
    action: "artifact.download_url_create",
    targetType: "GeneratedArtifact",
    targetId: artifact.id,
    metadata: {
      artifactType: artifact.artifactType,
      checksumSha256: artifact.checksumSha256,
      expiresInSeconds: 300
    }
  });

  return ok({ signedGetUrl, expiresInSeconds: 300 });
}
