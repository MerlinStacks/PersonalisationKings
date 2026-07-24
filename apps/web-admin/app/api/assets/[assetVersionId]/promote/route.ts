import { prisma } from "@personalise-kings/db";
import { createObjectStorageFromEnv, isObjectKeyForTenant, objectKey, sanitizeRasterUpload, type StorageClass } from "@personalise-kings/storage";
import { randomUUID } from "node:crypto";
import { badRequest, ok } from "../../../../../lib/api";
import { writeAuditEvent } from "../../../../../lib/audit";
import { requirePermission } from "../../../../../lib/rbac";
import { requireSameOrigin } from "../../../../../lib/same-origin";

const assetStorageClass: Partial<Record<string, StorageClass>> = {
  font: "merchant_design_asset",
  artwork: "merchant_design_asset",
  clipart: "merchant_design_asset",
  upload: "order_bound_customer_asset",
  mockup: "merchant_design_asset"
};
const rasterKinds = new Set(["artwork", "clipart", "upload", "mockup"]);

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ assetVersionId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_design");
  if (access.error) return access.error;
  const session = access.session;
  const { assetVersionId } = await params;

  const assetVersion = await prisma.assetVersion.findFirst({
    where: { id: assetVersionId, merchantId: session.merchantId, validationStatus: "pending", deletedAt: null },
    include: { asset: true }
  });

  if (!assetVersion || !isObjectKeyForTenant(assetVersion.objectKey, session.merchantId, ["temporary_upload"])) {
    return badRequest("Asset version not found");
  }

  const storage = createObjectStorageFromEnv();
  const bytes = await storage.getObject(assetVersion.objectKey);
  if (BigInt(bytes.byteLength) > assetVersion.byteSize) return badRequest("Uploaded file exceeds its approved size");
  const uploadValidation = rasterKinds.has(assetVersion.asset.kind) ? await sanitizeRasterUpload(bytes) : null;
  const uploadRejection = uploadValidation?.accepted === false
    ? uploadValidation.reason
    : uploadValidation?.accepted && uploadValidation.detectedContentType !== assetVersion.contentType
      ? "Detected file type does not match the approved upload type"
      : null;

  if (uploadValidation && uploadRejection) {
    const quarantinedKey = objectKey("quarantined_file", session.merchantId, `${assetVersion.id}-${randomUUID()}`);
    await storage.putObject(quarantinedKey, bytes, "application/octet-stream");
    let rejected = false;
    try {
      rejected = await prisma.$transaction(async (tx) => {
        const finalized = await tx.assetVersion.updateMany({
          where: { id: assetVersion.id, merchantId: session.merchantId, objectKey: assetVersion.objectKey, validationStatus: "pending", deletedAt: null },
          data: { objectKey: quarantinedKey, validationStatus: "rejected" }
        });
        if (finalized.count !== 1) return false;
        await writeAuditEvent({
          merchantId: session.merchantId,
          actorUserId: session.userId,
          action: "asset.reject_upload",
          targetType: "AssetVersion",
          targetId: assetVersion.id,
          metadata: { reason: uploadRejection, objectKey: quarantinedKey }
        }, tx);
        return true;
      });
    } catch (error) {
      await storage.deleteObject(quarantinedKey).catch(() => undefined);
      throw error;
    }
    if (!rejected) {
      await storage.deleteObject(quarantinedKey).catch(() => undefined);
      return Response.json({ error: "Asset version was already processed" }, { status: 409 });
    }
    await deletePromotedSource(storage, assetVersion.objectKey);

    return badRequest(uploadRejection);
  }

  const destinationClass = assetStorageClass[assetVersion.asset.kind];
  if (!destinationClass) return badRequest("This asset kind cannot be promoted through the generic upload flow");
  const destinationKey = objectKey(destinationClass, session.merchantId, `${assetVersion.id}-${randomUUID()}`);
  const acceptedRaster = uploadValidation?.accepted ? uploadValidation : null;
  const promotedBytes = acceptedRaster?.bytes ?? bytes;
  const promotedContentType = acceptedRaster?.detectedContentType ?? assetVersion.contentType;
  const metadata = await storage.putObject(destinationKey, promotedBytes, promotedContentType);
  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const finalized = await tx.assetVersion.updateMany({
        where: { id: assetVersion.id, merchantId: session.merchantId, objectKey: assetVersion.objectKey, validationStatus: "pending", deletedAt: null },
        data: {
          objectKey: metadata.objectKey,
          checksumSha256: metadata.checksumSha256,
          byteSize: BigInt(metadata.byteSize),
          contentType: acceptedRaster?.detectedContentType ?? metadata.contentType,
          widthPx: acceptedRaster?.widthPx ?? assetVersion.widthPx,
          heightPx: acceptedRaster?.heightPx ?? assetVersion.heightPx,
          validationStatus: "accepted"
        }
      });
      if (finalized.count !== 1) return null;
      await writeAuditEvent({
        merchantId: session.merchantId,
        actorUserId: session.userId,
        action: "asset.promote",
        targetType: "AssetVersion",
        targetId: assetVersion.id,
        metadata: { objectKey: metadata.objectKey, checksumSha256: metadata.checksumSha256 }
      }, tx);
      return tx.assetVersion.findUniqueOrThrow({ where: { id: assetVersion.id } });
    });
  } catch (error) {
    await storage.deleteObject(destinationKey).catch(() => undefined);
    throw error;
  }
  if (!updated) {
    await storage.deleteObject(destinationKey).catch(() => undefined);
    return Response.json({ error: "Asset version was already processed" }, { status: 409 });
  }
  await deletePromotedSource(storage, assetVersion.objectKey);

  return ok({ ...updated, byteSize: updated.byteSize.toString() });
}

async function deletePromotedSource(storage: ReturnType<typeof createObjectStorageFromEnv>, sourceKey: Parameters<typeof storage.deleteObject>[0]) {
  try {
    await storage.deleteObject(sourceKey);
  } catch (error) {
    console.error("Promoted upload source cleanup failed", {
      sourceKey,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}
