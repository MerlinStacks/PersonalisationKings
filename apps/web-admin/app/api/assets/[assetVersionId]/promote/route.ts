import { prisma } from "@personalise-kings/db";
import { createObjectStorageFromEnv, objectKey, validateRasterUpload, type StorageClass } from "@personalise-kings/storage";
import { badRequest, ok } from "../../../../../lib/api";
import { writeAuditEvent } from "../../../../../lib/audit";
import { requirePermission } from "../../../../../lib/rbac";
import { requireSameOrigin } from "../../../../../lib/same-origin";

const assetStorageClass: Partial<Record<string, StorageClass>> = {
  font: "merchant_design_asset",
  artwork: "merchant_design_asset",
  clipart: "merchant_design_asset",
  upload: "order_bound_customer_asset",
  mockup: "merchant_design_asset",
  preview: "preview_derivative"
};

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ assetVersionId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_design");
  if (access.error) return access.error;
  const session = access.session;
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
  const uploadRejection = BigInt(bytes.byteLength) > assetVersion.byteSize
    ? "Uploaded file exceeds its approved size"
    : uploadValidation?.accepted && uploadValidation.detectedContentType !== assetVersion.contentType
      ? "Detected file type does not match the approved upload type"
      : uploadValidation?.accepted === false
        ? uploadValidation.reason ?? "Upload validation failed"
        : null;

  if (uploadValidation && uploadRejection) {
    const quarantinedKey = objectKey("quarantined_file", session.merchantId, assetVersion.id);
    await storage.putObject(quarantinedKey, bytes, assetVersion.contentType);
    await storage.deleteObject(assetVersion.objectKey as never);

    await prisma.$transaction(async (tx) => {
      await tx.assetVersion.update({
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
        metadata: { reason: uploadRejection, objectKey: quarantinedKey }
      }, tx);
    });

    return badRequest(uploadRejection);
  }

  const destinationClass = assetStorageClass[assetVersion.asset.kind];
  if (!destinationClass) return badRequest("This asset kind cannot be promoted through the generic upload flow");
  const destinationKey = objectKey(destinationClass, session.merchantId, assetVersion.id);
  const metadata = await storage.putObject(destinationKey, bytes, uploadValidation?.detectedContentType ?? assetVersion.contentType);
  await storage.deleteObject(assetVersion.objectKey as never);

  const updated = await prisma.$transaction(async (tx) => {
    const promoted = await tx.assetVersion.update({
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
    }, tx);
    return promoted;
  });

  return ok({ ...updated, byteSize: updated.byteSize.toString() });
}
