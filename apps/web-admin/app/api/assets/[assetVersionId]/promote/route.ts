import { prisma } from "@personalise-kings/db";
import { createObjectStorageFromEnv, objectKey, validateRasterUpload, type StorageClass } from "@personalise-kings/storage";
import { badRequest, ok } from "../../../../../lib/api";
import { writeAuditEvent } from "../../../../../lib/audit";
import { getAdminSession } from "../../../../../lib/session";

const assetStorageClass: Record<string, StorageClass> = {
  font: "merchant_design_asset",
  artwork: "merchant_design_asset",
  clipart: "merchant_design_asset",
  upload: "order_bound_customer_asset",
  mockup: "merchant_design_asset",
  preview: "preview_derivative",
  production_artifact: "production_artifact"
};

export async function POST(_request: Request, { params }: Readonly<{ params: Promise<{ assetVersionId: string }> }>) {
  const session = await getAdminSession();
  const { assetVersionId } = await params;

  const assetVersion = await prisma.assetVersion.findFirst({
    where: { id: assetVersionId, merchantId: session.merchantId },
    include: { asset: true }
  });

  if (!assetVersion) {
    return badRequest("Asset version not found");
  }

  const storage = createObjectStorageFromEnv();
  const bytes = await storage.getObject(assetVersion.objectKey as never);
  const uploadValidation = assetVersion.asset.kind === "upload" ? validateRasterUpload(bytes) : null;

  if (uploadValidation) {
    if (!uploadValidation.accepted) {
      const quarantinedKey = objectKey("quarantined_file", session.merchantId, assetVersion.id);
      await storage.putObject(quarantinedKey, bytes, assetVersion.contentType);
      await storage.deleteObject(assetVersion.objectKey as never);

      await prisma.assetVersion.update({
        where: { id: assetVersion.id },
        data: {
          objectKey: quarantinedKey,
          validationStatus: "rejected"
        }
      });

      await writeAuditEvent({
        merchantId: session.merchantId,
        actorUserId: session.userId,
        action: "asset.reject_upload",
        targetType: "AssetVersion",
        targetId: assetVersion.id,
        metadata: { reason: uploadValidation.reason, objectKey: quarantinedKey }
      });

      return badRequest(uploadValidation.reason ?? "Upload validation failed");
    }
  }

  const destinationKey = objectKey(assetStorageClass[assetVersion.asset.kind], session.merchantId, assetVersion.id);
  const metadata = await storage.putObject(destinationKey, bytes, uploadValidation?.detectedContentType ?? assetVersion.contentType);
  await storage.deleteObject(assetVersion.objectKey as never);

  const updated = await prisma.assetVersion.update({
    where: { id: assetVersion.id },
    data: {
      objectKey: metadata.objectKey,
      checksumSha256: metadata.checksumSha256,
      byteSize: BigInt(metadata.byteSize),
      contentType: uploadValidation?.detectedContentType ?? metadata.contentType,
      widthPx: uploadValidation?.widthPx ?? assetVersion.widthPx,
      heightPx: uploadValidation?.heightPx ?? assetVersion.heightPx,
      validationStatus: "accepted"
    }
  });

  await writeAuditEvent({
    merchantId: session.merchantId,
    actorUserId: session.userId,
    action: "asset.promote",
    targetType: "AssetVersion",
    targetId: assetVersion.id,
    metadata: { objectKey: metadata.objectKey, checksumSha256: metadata.checksumSha256 }
  });

  return ok(updated);
}
