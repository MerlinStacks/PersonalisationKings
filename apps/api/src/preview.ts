import { PREVIEW_RENDERER_VERSION, renderSceneSvg } from "@personalise-kings/design-engine";
import { prisma } from "@personalise-kings/db";
import { sceneGraphSchema } from "@personalise-kings/render-schema";
import { createObjectStorageFromEnv, isObjectKeyForTenant, objectKey } from "@personalise-kings/storage";

interface PreviewAssetVersion {
  id: string;
  objectKey: string;
  contentType: string;
  byteSize: bigint;
}

export async function generateRevisionPreview(
  revisionId: string,
  merchantId: string,
  rawScene: unknown,
  versions: PreviewAssetVersion[]
) {
  const scene = sceneGraphSchema.parse(rawScene);
  const totalSourceBytes = versions.reduce((total, version) => total + version.byteSize, 0n);
  if (totalSourceBytes > 40n * 1024n * 1024n) {
    throw new RangeError("Preview source assets exceed the 40 MiB limit");
  }
  const storage = createObjectStorageFromEnv();
  const sources = await Promise.all(versions.map(async (version) => {
    if (!isObjectKeyForTenant(version.objectKey, merchantId, ["merchant_design_asset", "draft_customisation_asset", "order_bound_customer_asset"])) {
      throw new TypeError("Preview source object key does not belong to the merchant");
    }
    const bytes = await storage.getObject(version.objectKey);
    return {
      assetVersionId: version.id,
      contentType: version.contentType,
      url: `data:${version.contentType};base64,${Buffer.from(bytes).toString("base64")}`
    };
  }));
  const rendered = renderSceneSvg(scene, sources);
  const key = objectKey("preview_derivative", merchantId, `${revisionId}.svg`);
  const stored = await storage.putObject(key, new TextEncoder().encode(rendered.content), "image/svg+xml");

  try {
    return await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: {
          merchantId,
          kind: "preview",
          name: `Customisation preview ${revisionId}`,
          versions: {
            create: {
              version: 1,
              objectKey: stored.objectKey,
              checksumSha256: stored.checksumSha256,
              byteSize: stored.byteSize,
              contentType: stored.contentType,
              widthPx: rendered.widthPx,
              heightPx: rendered.heightPx,
              validationStatus: "accepted"
            }
          }
        },
        include: { versions: true }
      });
      const preview = asset.versions[0];
      if (!preview) throw new Error("Preview asset version was not created");
      await tx.customisationRevision.update({
        where: { id_merchantId: { id: revisionId, merchantId } },
        data: { previewAssetVersionId: preview.id }
      });
      await tx.proofJob.create({
        data: {
          merchantId,
          customisationRevisionId: revisionId,
          rendererVersion: "proof-playwright.v1"
        }
      });
      return { ...preview, rendererVersion: PREVIEW_RENDERER_VERSION };
    });
  } catch (error) {
    await storage.deleteObject(key).catch(() => undefined);
    throw error;
  }
}
