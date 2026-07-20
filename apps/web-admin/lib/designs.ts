import { prisma } from "@personalise-kings/db";
import { customiserConfigMatchesScene, customiserConfigSchema, sceneGraphSchema, type CustomiserConfig } from "@personalise-kings/render-schema";
import * as z from "zod";

export const designVersionInputSchema = z.object({
  sceneGraph: sceneGraphSchema,
  customiserConfig: customiserConfigSchema
}).superRefine((value, context) => {
  if (!customiserConfigMatchesScene(value.customiserConfig, value.sceneGraph)) {
    context.addIssue({
      code: "custom",
      message: "Every customiser rule must match its scene layer and include the layer defaults",
      path: ["customiserConfig"]
    });
  }
});

export async function designAssetValidationError(
  merchantId: string,
  scene: z.infer<typeof sceneGraphSchema>,
  customiserConfig: CustomiserConfig
) {
  const requirements = new Map<string, "font" | "image">();
  for (const layer of scene.layers) {
    const id = layer.type === "text" ? layer.fontAssetVersionId : layer.assetVersionId;
    const kind = layer.type === "text" ? "font" : "image";
    const existing = requirements.get(id);
    if (existing && existing !== kind) return "An asset version cannot be used as both a font and an image";
    requirements.set(id, kind);
  }

  const versions = await prisma.assetVersion.findMany({
    where: { id: { in: [...requirements.keys()] }, merchantId, validationStatus: "accepted", deletedAt: null },
    include: { asset: { select: { kind: true } } }
  });
  if (versions.length !== requirements.size) return "Every layer must reference an accepted asset owned by this merchant";

  const imageKinds = new Set(["artwork", "clipart", "upload", "mockup"]);
  const invalid = versions.some((version) => requirements.get(version.id) === "font"
    ? version.asset.kind !== "font"
    : !imageKinds.has(version.asset.kind));
  if (invalid) return "Layer assets do not match their required font or image type";

  const versionsById = new Map(versions.map((version) => [version.id, version]));
  const rulesById = new Map(customiserConfig.layers.map((rule) => [rule.layerId, rule]));
  const invalidImageType = scene.layers.some((layer) => {
    const rule = rulesById.get(layer.id);
    return layer.type === "image" && rule?.type === "image"
      && !rule.acceptedContentTypes.some((contentType) => contentType === versionsById.get(layer.assetVersionId)?.contentType);
  });
  return invalidImageType ? "A default image uses a content type not allowed by its customiser rule" : null;
}
