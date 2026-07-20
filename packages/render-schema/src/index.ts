import * as z from "zod";

export const SCENE_GRAPH_SCHEMA_VERSION = "scene-graph.v1";
export const CUSTOMISER_CONFIG_SCHEMA_VERSION = "customiser-config.v1";

export const lengthMicrometresSchema = z.number().int().positive();
export const hexColourSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const transformSchema = z.object({
  translateXUm: z.number().int(),
  translateYUm: z.number().int(),
  scaleXPermille: z.number().int().positive().default(1000),
  scaleYPermille: z.number().int().positive().default(1000),
  rotationMilliDegrees: z.number().int().default(0)
});

export const sceneLayerSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("text"),
    name: z.string().min(1),
    transform: transformSchema,
    text: z.string(),
    fontAssetVersionId: z.string().min(1),
    fontSizeUm: lengthMicrometresSchema,
    fill: hexColourSchema,
    opacityPermille: z.number().int().min(0).max(1000).default(1000)
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("image"),
    name: z.string().min(1),
    transform: transformSchema,
    assetVersionId: z.string().min(1),
    widthUm: lengthMicrometresSchema,
    heightUm: lengthMicrometresSchema,
    opacityPermille: z.number().int().min(0).max(1000).default(1000)
  })
]);

export const sceneGraphSchema = z.object({
  schemaVersion: z.literal(SCENE_GRAPH_SCHEMA_VERSION),
  coordinateSystem: z.literal("micrometres"),
  printArea: z.object({
    widthUm: lengthMicrometresSchema,
    heightUm: lengthMicrometresSchema
  }),
  layers: z.array(sceneLayerSchema).min(1)
}).superRefine((scene, context) => {
  const layerIds = new Set<string>();
  scene.layers.forEach((layer, index) => {
    if (layerIds.has(layer.id)) {
      context.addIssue({
        code: "custom",
        message: `Layer ID must be unique: ${layer.id}`,
        path: ["layers", index, "id"]
      });
    }
    layerIds.add(layer.id);
  });
});

export type SceneGraph = z.infer<typeof sceneGraphSchema>;

const editableTransformSchema = z.object({
  position: z.boolean().default(true),
  scale: z.boolean().default(true),
  rotation: z.boolean().default(true)
});

export const customiserLayerConfigSchema = z.discriminatedUnion("type", [
  z.object({
    layerId: z.string().min(1),
    type: z.literal("text"),
    maxLength: z.number().int().min(1).max(500),
    allowedColours: z.array(hexColourSchema).min(1).max(16),
    allowFontSize: z.boolean().default(true),
    minimumFontSizeUm: lengthMicrometresSchema,
    maximumFontSizeUm: lengthMicrometresSchema,
    transform: editableTransformSchema
  }),
  z.object({
    layerId: z.string().min(1),
    type: z.literal("image"),
    acceptedContentTypes: z.array(z.enum(["image/png", "image/jpeg", "image/webp"])).min(1),
    maximumUploadBytes: z.number().int().positive().max(50 * 1024 * 1024),
    recommendedDpi: z.number().int().min(72).max(1200),
    transform: editableTransformSchema
  })
]);

export const customiserConfigSchema = z.object({
  schemaVersion: z.literal(CUSTOMISER_CONFIG_SCHEMA_VERSION),
  layers: z.array(customiserLayerConfigSchema).min(1)
}).superRefine((config, context) => {
  const layerIds = new Set<string>();
  config.layers.forEach((layer, index) => {
    if (layerIds.has(layer.layerId)) {
      context.addIssue({
        code: "custom",
        message: `Customiser layer ID must be unique: ${layer.layerId}`,
        path: ["layers", index, "layerId"]
      });
    }
    layerIds.add(layer.layerId);
    if (layer.type === "text" && layer.minimumFontSizeUm > layer.maximumFontSizeUm) {
      context.addIssue({
        code: "custom",
        message: "Minimum font size must not exceed maximum font size",
        path: ["layers", index, "minimumFontSizeUm"]
      });
    }
  });
});

export type CustomiserConfig = z.infer<typeof customiserConfigSchema>;
export type CustomiserLayerConfig = z.infer<typeof customiserLayerConfigSchema>;

export function customiserConfigMatchesScene(config: CustomiserConfig, scene: SceneGraph) {
  const layers = new Map(scene.layers.map((layer) => [layer.id, layer]));
  return config.layers.every((rule) => {
    const layer = layers.get(rule.layerId);
    if (!layer || layer.type !== rule.type) return false;
    if (rule.type === "text" && layer.type === "text") {
      return rule.allowedColours.some((colour) => colour.toLowerCase() === layer.fill.toLowerCase())
        && layer.fontSizeUm >= rule.minimumFontSizeUm
        && layer.fontSizeUm <= rule.maximumFontSizeUm;
    }
    return true;
  });
}

export function defaultCustomiserConfig(scene: SceneGraph): CustomiserConfig {
  return {
    schemaVersion: CUSTOMISER_CONFIG_SCHEMA_VERSION,
    layers: scene.layers.map((layer) => layer.type === "text" ? {
      layerId: layer.id,
      type: "text" as const,
      maxLength: 200,
      allowedColours: [layer.fill],
      allowFontSize: true,
      minimumFontSizeUm: Math.max(1000, Math.floor(layer.fontSizeUm / 2)),
      maximumFontSizeUm: Math.min(Math.max(scene.printArea.widthUm, scene.printArea.heightUm), layer.fontSizeUm * 2),
      transform: { position: true, scale: true, rotation: true }
    } : {
      layerId: layer.id,
      type: "image" as const,
      acceptedContentTypes: ["image/png" as const, "image/jpeg" as const, "image/webp" as const],
      maximumUploadBytes: 20 * 1024 * 1024,
      recommendedDpi: 300,
      transform: { position: true, scale: true, rotation: true }
    })
  };
}
