import { customiserConfigSchema, sceneGraphSchema, type CustomiserConfig as SceneCustomiserConfig, type SceneGraph } from "@personalise-kings/render-schema";

export interface CustomiserInitialization {
  apiUrl: string;
  embedToken: string;
  externalVariantId?: string;
  customisationReference?: string;
  priceModifierMinor?: number;
}

export interface ConfigAsset {
  assetVersionId: string;
  kind: string;
  contentType: string;
  widthPx?: number;
  heightPx?: number;
  url: string;
}

export interface CustomiserConfig {
  designName: string;
  scene: SceneGraph;
  rules: SceneCustomiserConfig;
  assets: Record<string, ConfigAsset>;
  maximumUploadBytes: number;
  recommendedDpi: number;
  resumedCustomisationReference?: string;
  resumedRevision?: number;
}

export async function loadCustomiserConfig(
  initialization: CustomiserInitialization,
  correlationId: string,
  signal: AbortSignal
): Promise<CustomiserConfig> {
  const response = await fetch(`${initialization.apiUrl}/v1/customiser/config`, {
    headers: {
      Authorization: `Bearer ${initialization.embedToken}`,
      "x-correlation-id": correlationId,
      ...(initialization.customisationReference
        ? { "x-pk-customisation-reference": initialization.customisationReference }
        : {})
    },
    signal
  });
  const body = await responseRecord(response);
  if (!response.ok) throw new Error(apiError(body, "Unable to load this product design"));

  const design = record(body.design);
  const parsedScene = sceneGraphSchema.safeParse(design?.scene_graph);
  const parsedRules = customiserConfigSchema.safeParse(design?.customiser_config);
  if (!design || typeof design.name !== "string" || !parsedScene.success || !parsedRules.success) {
    throw new Error("The product design response is invalid");
  }

  const assets: Record<string, ConfigAsset> = {};
  if (!Array.isArray(body.assets)) throw new Error("The product assets response is invalid");
  for (const value of body.assets) {
    const asset = parseAsset(value);
    if (!asset) throw new Error("A product asset response is invalid");
    assets[asset.assetVersionId] = asset;
  }

  const uploadRules = record(body.upload_rules);
  const resumed = record(body.resumed_customisation);
  if (initialization.customisationReference
    && (typeof resumed?.customisation_reference !== "string"
      || resumed.customisation_reference !== initialization.customisationReference
      || typeof resumed.revision !== "number")) {
    throw new Error("The saved customisation response is invalid");
  }
  return {
    designName: design.name,
    scene: parsedScene.data,
    rules: parsedRules.data,
    assets,
    maximumUploadBytes: positiveNumber(uploadRules?.maximum_bytes) ?? 20 * 1024 * 1024,
    recommendedDpi: positiveNumber(uploadRules?.recommended_dpi) ?? 300,
    resumedCustomisationReference: typeof resumed?.customisation_reference === "string" ? resumed.customisation_reference : undefined,
    resumedRevision: positiveNumber(resumed?.revision)
  };
}

export async function uploadRaster(
  file: File,
  layerId: string,
  initialization: CustomiserInitialization,
  correlationId: string
): Promise<ConfigAsset> {
  const intentResponse = await fetch(`${initialization.apiUrl}/v1/customiser/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-correlation-id": correlationId },
    body: JSON.stringify({
      embed_token: initialization.embedToken,
      layer_id: layerId,
      name: file.name.slice(0, 180) || "Customer image",
      content_type: file.type,
      byte_size: file.size
    })
  });
  const intent = await responseRecord(intentResponse);
  if (!intentResponse.ok) throw new Error(apiError(intent, "Unable to prepare the image upload"));
  if (typeof intent.asset_version_id !== "string" || typeof intent.signed_put_url !== "string") {
    throw new Error("The image upload response is invalid");
  }

  const putResponse = await fetch(intent.signed_put_url, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file
  });
  if (!putResponse.ok) throw new Error("The image could not be uploaded");

  const promotionResponse = await fetch(
    `${initialization.apiUrl}/v1/customiser/uploads/${encodeURIComponent(intent.asset_version_id)}/promote`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-correlation-id": correlationId },
      body: JSON.stringify({ embed_token: initialization.embedToken })
    }
  );
  const promoted = await responseRecord(promotionResponse);
  if (!promotionResponse.ok) throw new Error(apiError(promoted, "The image failed its safety checks"));
  const asset = parseAsset({
    asset_version_id: promoted.asset_version_id,
    kind: "upload",
    content_type: promoted.content_type,
    width_px: promoted.width_px,
    height_px: promoted.height_px,
    url: promoted.url
  });
  if (!asset || asset.assetVersionId !== intent.asset_version_id) {
    throw new Error("The accepted image response is invalid");
  }
  return asset;
}

export async function commitScene(
  scene: SceneGraph,
  initialization: CustomiserInitialization,
  correlationId: string
) {
  const response = await fetch(`${initialization.apiUrl}/v1/customiser/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-correlation-id": correlationId },
    body: JSON.stringify({
      embed_token: initialization.embedToken,
      ...(initialization.customisationReference
        ? { base_customisation_reference: initialization.customisationReference }
        : {}),
      customer_inputs: customerInputs(scene),
      render_spec: scene
    })
  });
  const body = await responseRecord(response);
  if (!response.ok) throw new Error(apiError(body, "The customisation could not be saved"));
  if (typeof body.customisation_reference !== "string" || !body.customisation_reference) {
    throw new Error("The saved customisation response is invalid");
  }
  return {
    customisationReference: body.customisation_reference,
    revision: positiveNumber(body.revision) ?? 1,
    resumed: body.resumed === true
  };
}

function customerInputs(scene: SceneGraph) {
  return Object.fromEntries(scene.layers.map((layer) => layer.type === "text"
    ? [layer.id, layer.text]
    : [`${layer.id}_asset_version_id`, layer.assetVersionId]));
}

async function responseRecord(response: Response) {
  const value: unknown = await response.json().catch(() => null);
  return record(value) ?? {};
}

function parseAsset(value: unknown): ConfigAsset | null {
  const asset = record(value);
  if (!asset || typeof asset.asset_version_id !== "string" || typeof asset.kind !== "string"
    || typeof asset.content_type !== "string" || typeof asset.url !== "string") return null;

  try {
    const url = new URL(asset.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  } catch {
    return null;
  }

  return {
    assetVersionId: asset.asset_version_id,
    kind: asset.kind,
    contentType: asset.content_type,
    widthPx: positiveNumber(asset.width_px),
    heightPx: positiveNumber(asset.height_px),
    url: asset.url
  };
}

function apiError(body: Record<string, unknown>, fallback: string) {
  return typeof body.message === "string" && body.message ? body.message : fallback;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
