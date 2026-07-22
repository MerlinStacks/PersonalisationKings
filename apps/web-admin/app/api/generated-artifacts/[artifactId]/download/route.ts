import { prisma } from "@personalise-kings/db";
import { addCounter, recordHistogram, withSpan } from "@personalise-kings/observability/telemetry";
import { createObjectStorageFromEnv, isObjectKey, isProductionArtifactKey } from "@personalise-kings/storage";
import { badRequest, notFound, ok } from "../../../../../lib/api";
import { requirePermission } from "../../../../../lib/rbac";
import { requireSameOrigin } from "../../../../../lib/same-origin";

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ artifactId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("download_artifact");
  if (access.error) return access.error;

  const startedAt = performance.now();
  let outcome = "failed";
  let artifactType = "_OTHER";
  return withSpan("artifact.download_url.issue", {}, async (span) => {
    try {
      const { artifactId } = await params;
      const artifact = await prisma.generatedArtifact.findFirst({
        where: { id: artifactId, merchantId: access.session.merchantId }
      });

      if (!artifact) {
        outcome = "not_found";
        return notFound("Generated artifact not found");
      }
      artifactType = artifact.artifactType === "print_pdf" ? "print_pdf" : "_OTHER";
      if (!isObjectKey(artifact.objectKey) || !isProductionArtifactKey(artifact.objectKey, access.session.merchantId)) {
        outcome = "invalid_key";
        return badRequest("Artifact object key is invalid");
      }

      const storage = createObjectStorageFromEnv();
      const signedGetUrl = await storage.createSignedGetUrl(artifact.objectKey, 300);
      const now = new Date();
      const leaseUntil = new Date(now.getTime() + 330_000);
      const leased = await prisma.$transaction(async (tx) => {
        const updated = await tx.$queryRaw<Array<{ id: string }>>`
          UPDATE "GeneratedArtifact"
          SET "downloadLeaseUntil" = GREATEST(COALESCE("downloadLeaseUntil", ${leaseUntil}), ${leaseUntil})
          WHERE "id" = ${artifact.id}
            AND "merchantId" = ${access.session.merchantId}
            AND "objectKey" = ${artifact.objectKey}
            AND "bytesDeletedAt" IS NULL
            AND "cleanupClaimedAt" IS NULL
          RETURNING "id"
        `;
        if (updated.length !== 1) return false;
        await tx.auditEvent.create({
          data: {
            merchantId: access.session.merchantId,
            actorUserId: access.session.userId,
            action: "artifact.download_url_create",
            targetType: "GeneratedArtifact",
            targetId: artifact.id,
            metadata: { artifactType: artifact.artifactType, checksumSha256: artifact.checksumSha256, expiresInSeconds: 300 }
          }
        });
        return true;
      });
      if (!leased) {
        outcome = "unavailable";
        return ok({ error: "artifact_bytes_unavailable", message: "Artifact bytes have expired or are being removed" }, { status: 410 });
      }

      outcome = "issued";
      return ok({ signedGetUrl, expiresInSeconds: 300 });
    } finally {
      span.setAttribute("pk.artifact.type", artifactType);
      span.setAttribute("pk.artifact.download_url.outcome", outcome);
      addCounter("pk.artifact.download_urls", 1, { artifact_type: artifactType, outcome });
      recordHistogram("pk.artifact.download_url.duration", (performance.now() - startedAt) / 1000, { artifact_type: artifactType, outcome });
    }
  });
}
