import { signEmbedToken, verifyEmbedToken } from "@personalise-kings/auth";
import { prisma } from "@personalise-kings/db";
import {
  customiserConfigMatchesScene,
  customiserConfigSchema,
  defaultCustomiserConfig,
  sceneGraphSchema,
  type CustomiserConfig,
  type SceneGraph
} from "@personalise-kings/render-schema";
import { createObjectStorageFromEnv, objectKey, validateRasterUpload, type ObjectKey } from "@personalise-kings/storage";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import * as z from "zod";
import { toInputJson } from "./json";
import { authenticateStoreRequest } from "./connector-auth";
import { generateRevisionPreview } from "./preview";

const commitSchema = z.object({
  embed_token: z.string().min(1),
  base_customisation_reference: z.string().min(1).max(100).optional(),
  customer_inputs: z.record(z.string(), z.unknown()).default({}),
  render_spec: sceneGraphSchema
});

const uploadIntentSchema = z.object({
  embed_token: z.string().min(1),
  layer_id: z.string().min(1),
  name: z.string().trim().min(1).max(180),
  content_type: z.enum(["image/png", "image/jpeg", "image/webp"]),
  byte_size: z.number().int().positive().max(50 * 1024 * 1024)
});

const promoteUploadSchema = z.object({
  embed_token: z.string().min(1)
});

const createEmbedTokenSchema = z.object({
  store_id: z.string().min(1),
  parent_origin: z.string().url().refine((value) => new URL(value).origin === value, "Must be an exact origin"),
  external_product_id: z.string().min(1),
  external_variant_id: z.string().optional()
});

const mappingLookupSchema = z.object({
  store_id: z.string().min(1),
  external_product_id: z.string().min(1),
  external_variant_id: z.string().min(1).optional()
});

export async function handleCreateEmbedToken(request: Request, rawBody: string, correlationId: string) {
  const parsedBody = createEmbedTokenSchema.safeParse(parseJson(rawBody));
  if (!parsedBody.success) {
    return Response.json({ error: "invalid_body", correlationId }, { status: 400 });
  }

  const authentication = await authenticateStoreRequest(
    parsedBody.data.store_id,
    request.headers.get("x-pk-key-id") ?? "",
    request.headers.get("x-pk-signature") ?? "",
    rawBody
  );
  if (authentication.status === "not_configured") {
    return Response.json({ error: "connector_secret_not_configured", correlationId }, { status: 503 });
  }
  if (authentication.status !== "authenticated") {
    return Response.json({ error: authentication.status, correlationId }, { status: 401 });
  }

  if (storeOrigin(authentication.store.url) !== parsedBody.data.parent_origin) {
    return Response.json({ error: "invalid_parent_origin", correlationId }, { status: 403 });
  }

  const mapping = await findProductMapping(
    parsedBody.data.store_id,
    parsedBody.data.external_product_id,
    parsedBody.data.external_variant_id
  );

  if (!mapping || mapping.store.connectionStatus !== "connected" || !mapping.design.currentVersion) {
    return Response.json({ error: "mapping_not_found", correlationId }, { status: 404 });
  }

  const secret = embedTokenSecret();
  if (!secret) return Response.json({ error: "embed_secret_not_configured", correlationId }, { status: 503 });
  const token = signEmbedToken({
    storeId: mapping.storeId,
    allowedOrigin: parsedBody.data.parent_origin,
    externalProductId: parsedBody.data.external_product_id,
    externalVariantId: parsedBody.data.external_variant_id,
    designId: mapping.designId,
    designVersionId: mapping.design.currentVersion.id,
    expiresAt: Math.floor(Date.now() / 1000) + 15 * 60
  }, secret);

  return Response.json({
    embed_token: token,
    expires_in_seconds: 900,
    price_modifier_minor: mapping.priceModifierMinor,
    correlationId
  });
}

export async function handleMappingLookup(request: Request, rawBody: string, correlationId: string) {
  const parsedBody = mappingLookupSchema.safeParse(parseJson(rawBody));
  if (!parsedBody.success) return Response.json({ error: "invalid_body", correlationId }, { status: 400 });
  const authentication = await authenticateStoreRequest(
    parsedBody.data.store_id,
    request.headers.get("x-pk-key-id") ?? "",
    request.headers.get("x-pk-signature") ?? "",
    rawBody
  );
  if (authentication.status === "not_configured") {
    return Response.json({ error: "connector_secret_not_configured", correlationId }, { status: 503 });
  }
  if (authentication.status !== "authenticated") {
    return Response.json({ error: authentication.status, correlationId }, { status: 401 });
  }

  const mapping = parsedBody.data.external_variant_id
    ? await findProductMapping(parsedBody.data.store_id, parsedBody.data.external_product_id, parsedBody.data.external_variant_id)
    : await findProductMapping(parsedBody.data.store_id, parsedBody.data.external_product_id)
      ?? await prisma.productMapping.findFirst({
      where: {
        storeId: parsedBody.data.store_id,
        externalProductId: parsedBody.data.external_product_id,
        active: true,
        design: { archivedAt: null, currentVersionId: { not: null } }
      },
      select: { externalVariantId: true, priceModifierMinor: true }
    });

  return Response.json({
    mapped: Boolean(mapping),
    scope: mapping ? (mapping.externalVariantId ? "variant" : "all_variants") : null,
    price_modifier_minor: mapping?.externalVariantId === null ? mapping.priceModifierMinor : null,
    correlationId
  });
}

export async function handleCustomiserConfig(request: Request, correlationId: string) {
  const embedToken = bearerToken(request);
  if (!embedToken) {
    return Response.json({ error: "missing_embed_token", correlationId }, { status: 401 });
  }

  const access = await resolveCustomiserContext(request, embedToken, correlationId);
  if (!access.ok) return access.response;

  const configuration = resolveDesignConfiguration(access.context.designVersion);
  if (!configuration) {
    return Response.json({ error: "invalid_design", correlationId }, { status: 503 });
  }

  const requestedReference = request.headers.get("x-pk-customisation-reference");
  const resumedRevision = requestedReference
    ? await findEditableRevision(prisma, access.context, requestedReference)
    : null;
  if (requestedReference && !resumedRevision) {
    return Response.json({ error: "customisation_not_editable", correlationId }, { status: 409 });
  }
  const resumedSceneResult = resumedRevision ? sceneGraphSchema.safeParse(resumedRevision.renderSpec) : null;
  const activeScene = resumedSceneResult?.success
    && sceneMatchesDesign(resumedSceneResult.data, configuration.scene, configuration.customiserConfig)
    ? resumedSceneResult.data
    : configuration.scene;
  if (resumedRevision && activeScene === configuration.scene) {
    return Response.json({ error: "saved_customisation_invalid", correlationId }, { status: 409 });
  }

  const versions = await referencedAssetVersions(access.context.store.merchantId, activeScene, configuration.customiserConfig);
  if (!versions) {
    return Response.json({ error: "design_assets_unavailable", correlationId }, { status: 503 });
  }

  const storage = createObjectStorageFromEnv();
  const assets = await Promise.all(versions.map(async (version) => ({
    asset_version_id: version.id,
    kind: version.asset.kind,
    content_type: version.contentType,
    width_px: version.widthPx,
    height_px: version.heightPx,
    url: await storage.createSignedGetUrl(version.objectKey as ObjectKey, 15 * 60)
  })));

  return Response.json({
    parent_origin: access.context.token.allowedOrigin,
    design: {
      id: access.context.mapping.designId,
      name: access.context.design.name,
      version_id: access.context.designVersion.id,
      version: access.context.designVersion.version,
      scene_graph: activeScene,
      customiser_config: configuration.customiserConfig
    },
    resumed_customisation: resumedRevision ? {
      customisation_reference: resumedRevision.opaqueReference,
      revision: resumedRevision.revision
    } : null,
    assets,
    upload_rules: {
      accepted_content_types: ["image/png", "image/jpeg", "image/webp"],
      maximum_bytes: 20 * 1024 * 1024,
      recommended_dpi: 300
    },
    correlationId
  });
}

export async function handleCreateCustomiserUpload(request: Request, rawBody: string, correlationId: string) {
  const parsedBody = uploadIntentSchema.safeParse(parseJson(rawBody));
  if (!parsedBody.success) {
    return Response.json({ error: "invalid_body", correlationId }, { status: 400 });
  }

  const access = await resolveCustomiserContext(request, parsedBody.data.embed_token, correlationId);
  if (!access.ok) return access.response;

  const configuration = resolveDesignConfiguration(access.context.designVersion);
  const candidateRule = configuration?.customiserConfig.layers.find((rule) => rule.layerId === parsedBody.data.layer_id);
  if (candidateRule?.type !== "image") {
    return Response.json({ error: "image_layer_not_editable", correlationId }, { status: 422 });
  }
  const imageRule = candidateRule;
  if (!imageRule.acceptedContentTypes.includes(parsedBody.data.content_type)
    || parsedBody.data.byte_size > imageRule.maximumUploadBytes) {
    return Response.json({ error: "upload_not_allowed", correlationId }, { status: 422 });
  }

  const storage = createObjectStorageFromEnv();
  const uploadId = randomUUID();
  const key = objectKey("temporary_upload", access.context.store.merchantId, uploadId);
  const signedPutUrl = await storage.createSignedPutUrl(key, 5 * 60);
  const asset = await prisma.asset.create({
    data: {
      merchantId: access.context.store.merchantId,
      kind: "upload",
      name: parsedBody.data.name,
      versions: {
        create: {
          version: 1,
          objectKey: key,
          checksumSha256: "pending",
          byteSize: BigInt(parsedBody.data.byte_size),
          contentType: parsedBody.data.content_type,
          validationStatus: "pending"
        }
      }
    },
    include: { versions: true }
  });

  return Response.json({
    asset_version_id: asset.versions[0].id,
    signed_put_url: signedPutUrl,
    expires_in_seconds: 300,
    required_headers: { "Content-Type": parsedBody.data.content_type },
    correlationId
  }, { status: 201 });
}

export async function handlePromoteCustomiserUpload(
  request: Request,
  assetVersionId: string,
  rawBody: string,
  correlationId: string
) {
  const parsedBody = promoteUploadSchema.safeParse(parseJson(rawBody));
  if (!parsedBody.success) {
    return Response.json({ error: "invalid_body", correlationId }, { status: 400 });
  }

  const access = await resolveCustomiserContext(request, parsedBody.data.embed_token, correlationId);
  if (!access.ok) return access.response;

  const merchantId = access.context.store.merchantId;
  const assetVersion = await prisma.assetVersion.findFirst({
    where: {
      id: assetVersionId,
      merchantId,
      validationStatus: "pending",
      deletedAt: null,
      asset: { kind: "upload" }
    },
    include: { asset: true }
  });
  if (!assetVersion || !assetVersion.objectKey.startsWith(`temporary_upload/${merchantId}/`)) {
    return Response.json({ error: "upload_not_found", correlationId }, { status: 404 });
  }

  const storage = createObjectStorageFromEnv();
  let bytes: Uint8Array;
  try {
    bytes = await storage.getObject(assetVersion.objectKey as ObjectKey);
  } catch {
    return Response.json({ error: "upload_incomplete", correlationId }, { status: 409 });
  }

  const validation = BigInt(bytes.byteLength) > assetVersion.byteSize
    ? { accepted: false as const, reason: "Uploaded file exceeds its approved size" }
    : validateRasterUpload(bytes);
  if (!validation.accepted || (validation.detectedContentType && validation.detectedContentType !== assetVersion.contentType)) {
    const quarantinedKey = objectKey("quarantined_file", merchantId, assetVersion.id);
    await storage.putObject(quarantinedKey, bytes, assetVersion.contentType);
    await storage.deleteObject(assetVersion.objectKey as ObjectKey);
    await prisma.$transaction([
      prisma.assetVersion.update({
        where: { id: assetVersion.id },
        data: { objectKey: quarantinedKey, validationStatus: "rejected" }
      }),
      prisma.auditEvent.create({
        data: {
          merchantId,
          action: "customiser.upload_rejected",
          targetType: "AssetVersion",
          targetId: assetVersion.id,
          metadata: {
            reason: validation.reason ?? "Detected file type does not match the approved upload type",
            correlationId
          }
        }
      })
    ]);
    return Response.json({
      error: "upload_rejected",
      message: validation.reason ?? "Detected file type does not match the approved upload type",
      correlationId
    }, { status: 422 });
  }

  const destinationKey = objectKey("draft_customisation_asset", merchantId, assetVersion.id);
  const contentType = validation.detectedContentType ?? assetVersion.contentType;
  const metadata = await storage.putObject(destinationKey, bytes, contentType);
  await storage.deleteObject(assetVersion.objectKey as ObjectKey);
  const updated = await prisma.assetVersion.update({
    where: { id: assetVersion.id },
    data: {
      objectKey: metadata.objectKey,
      checksumSha256: metadata.checksumSha256,
      byteSize: BigInt(metadata.byteSize),
      contentType,
      widthPx: validation.widthPx,
      heightPx: validation.heightPx,
      validationStatus: "accepted"
    }
  });

  return Response.json({
    asset_version_id: updated.id,
    content_type: updated.contentType,
    width_px: updated.widthPx,
    height_px: updated.heightPx,
    url: await storage.createSignedGetUrl(updated.objectKey as ObjectKey, 15 * 60),
    correlationId
  });
}

export async function handleCustomiserCommit(request: Request, rawBody: string, correlationId: string) {
  const parsedBody = commitSchema.safeParse(parseJson(rawBody));
  if (!parsedBody.success) {
    return Response.json({ error: "invalid_body", correlationId }, { status: 400 });
  }

  const access = await resolveCustomiserContext(request, parsedBody.data.embed_token, correlationId);
  if (!access.ok) return access.response;
  const { token, store, mapping, designVersion } = access.context;

  const configuration = resolveDesignConfiguration(designVersion);
  if (!configuration || !sceneMatchesDesign(parsedBody.data.render_spec, configuration.scene, configuration.customiserConfig)) {
    return Response.json({ error: "render_spec_mismatch", correlationId }, { status: 422 });
  }

  const previewSources = await referencedAssetVersions(store.merchantId, parsedBody.data.render_spec, configuration.customiserConfig);
  if (!previewSources) {
    return Response.json({ error: "invalid_asset_reference", correlationId }, { status: 422 });
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const liveAssetCount = await tx.assetVersion.count({
        where: {
          id: { in: previewSources.map((version) => version.id) },
          merchantId: store.merchantId,
          validationStatus: "accepted",
          deletedAt: null
        }
      });
      if (liveAssetCount !== previewSources.length) throw new DeletedAssetReferenceError();
      const baseRevision = parsedBody.data.base_customisation_reference
        ? await findEditableRevision(tx, access.context, parsedBody.data.base_customisation_reference)
        : null;
      if (parsedBody.data.base_customisation_reference && !baseRevision) throw new StaleCustomisationError();

      const session = baseRevision
        ? await tx.customisationSession.update({
          where: { id: baseRevision.sessionId },
          data: {
            customerInputs: toInputJson(parsedBody.data.customer_inputs),
            renderSpec: toInputJson(parsedBody.data.render_spec),
            expiresAt: new Date(Date.now() + customisationTtlSeconds() * 1000)
          }
        })
        : await tx.customisationSession.create({
          data: {
            merchantId: store.merchantId,
            storeId: store.id,
            designId: mapping.designId,
            externalProductId: token.externalProductId,
            externalVariantId: token.externalVariantId,
            customerInputs: toInputJson(parsedBody.data.customer_inputs),
            renderSpec: toInputJson(parsedBody.data.render_spec),
            status: "committed",
            expiresAt: new Date(Date.now() + customisationTtlSeconds() * 1000)
          }
        });

      const revision = await tx.customisationRevision.create({
        data: {
          merchantId: store.merchantId,
          sessionId: session.id,
          designVersionId: token.designVersionId,
          revision: baseRevision ? baseRevision.revision + 1 : 1,
          opaqueReference: `pk_${randomUUID()}`,
          customerInputs: toInputJson(parsedBody.data.customer_inputs),
          renderSpec: toInputJson(parsedBody.data.render_spec)
        }
      });

      return { session, revision, resumed: Boolean(baseRevision) };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof DeletedAssetReferenceError) {
      return Response.json({ error: "invalid_asset_reference", correlationId }, { status: 422 });
    }
    if (error instanceof StaleCustomisationError || isPrismaTransactionConflict(error)) {
      return Response.json({ error: "stale_customisation", correlationId }, { status: 409 });
    }
    throw error;
  }

  let previewUrl: string | undefined;
  let previewAssetVersionId: string | undefined;
  try {
    const preview = await generateRevisionPreview(
      result.revision.id,
      store.merchantId,
      parsedBody.data.render_spec,
      previewSources
    );
    previewAssetVersionId = preview.id;
    previewUrl = await createObjectStorageFromEnv().createSignedGetUrl(preview.objectKey as ObjectKey, 15 * 60);
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "customisation_preview_failed",
      correlationId,
      merchantId: store.merchantId,
      revisionId: result.revision.id,
      message: error instanceof Error ? error.message : "Unknown preview generation error"
    }));
  }

  return Response.json({
    customisation_reference: result.revision.opaqueReference,
    customisation_session_id: result.session.id,
    revision: result.revision.revision,
    resumed: result.resumed,
    preview_asset_version_id: previewAssetVersionId,
    preview_url: previewUrl,
    proof_status: previewAssetVersionId ? "queued" : "unavailable",
    summary: summariseInputs(parsedBody.data.customer_inputs),
    correlationId
  });
}

function parseJson(rawBody: string): unknown {
  try { return JSON.parse(rawBody); } catch { return null; }
}

function storeOrigin(storeUrl: string) {
  try { return new URL(storeUrl).origin; } catch { return null; }
}

export function customiserOrigin() {
  const configured = process.env.PK_CUSTOMISER_URL;
  if (!configured) return process.env.NODE_ENV === "production" ? null : "http://localhost:3001";
  try { return new URL(configured).origin; } catch { return null; }
}

async function findProductMapping(storeId: string, externalProductId: string, externalVariantId?: string) {
  const mappings = await prisma.productMapping.findMany({
    where: {
      storeId,
      externalProductId,
      externalVariantKey: { in: externalVariantId ? [externalVariantId, ""] : [""] }
    },
    include: { store: true, design: { include: { currentVersion: true } } }
  });
  return chooseProductMapping(mappings, externalVariantId);
}

export function chooseProductMapping<T extends { externalVariantId: string | null; active: boolean }>(
  mappings: T[],
  externalVariantId?: string
) {
  const exact = externalVariantId
    ? mappings.find((mapping) => mapping.externalVariantId === externalVariantId)
    : mappings.find((mapping) => mapping.externalVariantId === null);
  const selected = exact ?? mappings.find((mapping) => mapping.externalVariantId === null);
  return selected?.active ? selected : null;
}

async function resolveCustomiserContext(request: Request, rawToken: string, correlationId: string) {
  const allowedRequestOrigin = customiserOrigin();
  if (!allowedRequestOrigin) {
    return { ok: false as const, response: Response.json({ error: "customiser_origin_not_configured", correlationId }, { status: 503 }) };
  }
  if (request.headers.get("origin") !== allowedRequestOrigin) {
    return { ok: false as const, response: Response.json({ error: "invalid_origin", correlationId }, { status: 403 }) };
  }

  const secret = embedTokenSecret();
  if (!secret) {
    return { ok: false as const, response: Response.json({ error: "embed_secret_not_configured", correlationId }, { status: 503 }) };
  }
  const token = verifyEmbedToken(rawToken, secret);
  if (!token) {
    return { ok: false as const, response: Response.json({ error: "invalid_embed_token", correlationId }, { status: 401 }) };
  }

  const mapping = await findProductMapping(token.storeId, token.externalProductId, token.externalVariantId);
  const designVersion = mapping?.design.currentVersion;
  if (!mapping || mapping.store.connectionStatus !== "connected"
    || mapping.designId !== token.designId || mapping.design.currentVersionId !== token.designVersionId
    || storeOrigin(mapping.store.url) !== token.allowedOrigin || !designVersion) {
    return { ok: false as const, response: Response.json({ error: "mapping_changed", correlationId }, { status: 409 }) };
  }

  return {
    ok: true as const,
    context: {
      token,
      store: mapping.store,
      mapping,
      design: mapping.design,
      designVersion
    }
  };
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
}

type RevisionClient = Pick<Prisma.TransactionClient, "customisationRevision">;

async function findEditableRevision(
  client: RevisionClient,
  context: {
    token: { externalProductId: string; externalVariantId?: string; designId: string; designVersionId: string };
    store: { id: string; merchantId: string };
  },
  opaqueReference: string
) {
  if (!isOpaqueCustomisationReference(opaqueReference)) return null;
  const revision = await client.customisationRevision.findUnique({
    where: { opaqueReference },
    include: {
      session: {
        include: {
          revisions: { orderBy: { revision: "desc" }, take: 1, select: { id: true } }
        }
      },
      lineItems: { take: 1, select: { id: true } }
    }
  });
  if (!revision || !revisionCanResume({
    merchantId: revision.merchantId,
    designVersionId: revision.designVersionId,
    sessionStoreId: revision.session.storeId,
    sessionDesignId: revision.session.designId,
    externalProductId: revision.session.externalProductId,
    externalVariantId: revision.session.externalVariantId,
    sessionStatus: revision.session.status,
    expiresAt: revision.session.expiresAt,
    latestRevisionId: revision.session.revisions[0]?.id,
    revisionId: revision.id,
    hasLineItems: revision.lineItems.length > 0
  }, context)) return null;
  return revision;
}

export function revisionCanResume(
  revision: {
    merchantId: string;
    designVersionId: string;
    sessionStoreId: string;
    sessionDesignId: string;
    externalProductId: string;
    externalVariantId: string | null;
    sessionStatus: string;
    expiresAt: Date | null;
    latestRevisionId?: string;
    revisionId: string;
    hasLineItems: boolean;
  },
  context: {
    token: { externalProductId: string; externalVariantId?: string; designId: string; designVersionId: string };
    store: { id: string; merchantId: string };
  },
  now = new Date()
) {
  return revision.merchantId === context.store.merchantId
    && revision.sessionStoreId === context.store.id
    && revision.sessionDesignId === context.token.designId
    && revision.designVersionId === context.token.designVersionId
    && revision.externalProductId === context.token.externalProductId
    && revision.externalVariantId === (context.token.externalVariantId ?? null)
    && revision.sessionStatus === "committed"
    && (!revision.expiresAt || revision.expiresAt > now)
    && revision.latestRevisionId === revision.revisionId
    && !revision.hasLineItems;
}

function isOpaqueCustomisationReference(value: string) {
  return /^pk_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

class StaleCustomisationError extends Error {}
class DeletedAssetReferenceError extends Error {}

function isPrismaTransactionConflict(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return (error as { code?: unknown }).code === "P2034" || (error as { code?: unknown }).code === "P2002";
}

function embedTokenSecret() {
  const configured = process.env.PK_EMBED_TOKEN_SECRET;
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? null : "dev-embed-secret-change-me";
}

function customisationTtlSeconds() {
  const configured = Number(process.env.PK_CUSTOMISATION_TTL_SECONDS ?? 86400);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 86400;
}

export function sceneMatchesDesign(
  scene: SceneGraph,
  design: SceneGraph,
  customiserConfig: CustomiserConfig = defaultCustomiserConfig(design)
) {
  if (scene.schemaVersion !== design.schemaVersion || scene.coordinateSystem !== design.coordinateSystem
    || scene.printArea.widthUm !== design.printArea.widthUm || scene.printArea.heightUm !== design.printArea.heightUm
    || scene.layers.length !== design.layers.length || !sceneValuesWithinBounds(scene)
    || !customiserConfigMatchesScene(customiserConfig, design)) return false;

  const rules = new Map(customiserConfig.layers.map((rule) => [rule.layerId, rule]));

  return scene.layers.every((layer, index) => {
    const template = design.layers[index];
    if (!template || layer.id !== template.id || layer.type !== template.type || layer.name !== template.name) return false;
    const rule = rules.get(layer.id);
    if (!rule) return layersEqual(layer, template);
    if (rule.type !== layer.type || !transformMatchesRule(layer.transform, template.transform, rule.transform)) return false;
    if (layer.type === "text" && template.type === "text" && rule.type === "text") {
      return layer.fontAssetVersionId === template.fontAssetVersionId
        && layer.opacityPermille === template.opacityPermille
        && layer.text.length <= rule.maxLength
        && rule.allowedColours.some((colour) => colour.toLowerCase() === layer.fill.toLowerCase())
        && (rule.allowFontSize
          ? layer.fontSizeUm >= rule.minimumFontSizeUm && layer.fontSizeUm <= rule.maximumFontSizeUm
          : layer.fontSizeUm === template.fontSizeUm);
    }
    if (layer.type === "image" && template.type === "image" && rule.type === "image") {
      return layer.widthUm === template.widthUm && layer.heightUm === template.heightUm
        && layer.opacityPermille === template.opacityPermille;
    }
    return false;
  });
}

function transformMatchesRule(
  transform: SceneGraph["layers"][number]["transform"],
  template: SceneGraph["layers"][number]["transform"],
  rule: CustomiserConfig["layers"][number]["transform"]
) {
  return (rule.position || (transform.translateXUm === template.translateXUm && transform.translateYUm === template.translateYUm))
    && (rule.scale || (transform.scaleXPermille === template.scaleXPermille && transform.scaleYPermille === template.scaleYPermille))
    && (rule.rotation || transform.rotationMilliDegrees === template.rotationMilliDegrees);
}

function layersEqual(left: SceneGraph["layers"][number], right: SceneGraph["layers"][number]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sceneValuesWithinBounds(scene: SceneGraph) {
  return scene.layers.every((layer) => {
    const transform = layer.transform;
    if (transform.translateXUm < -scene.printArea.widthUm || transform.translateXUm > scene.printArea.widthUm * 2
      || transform.translateYUm < -scene.printArea.heightUm || transform.translateYUm > scene.printArea.heightUm * 2
      || transform.scaleXPermille < 100 || transform.scaleXPermille > 5000
      || transform.scaleYPermille < 100 || transform.scaleYPermille > 5000
      || Math.abs(transform.rotationMilliDegrees) > 360_000) return false;
    return layer.type !== "text" || (layer.text.length <= 200
      && layer.fontSizeUm >= 1000
      && layer.fontSizeUm <= Math.max(scene.printArea.widthUm, scene.printArea.heightUm));
  });
}

async function referencedAssetVersions(merchantId: string, scene: SceneGraph, customiserConfig?: CustomiserConfig) {
  const references = new Map<string, "font" | "image">();
  for (const layer of scene.layers) {
    const id = layer.type === "text" ? layer.fontAssetVersionId : layer.assetVersionId;
    const kind = layer.type === "text" ? "font" : "image";
    const existing = references.get(id);
    if (existing && existing !== kind) return null;
    references.set(id, kind);
  }
  const versions = await prisma.assetVersion.findMany({
    where: { id: { in: [...references.keys()] }, merchantId, validationStatus: "accepted", deletedAt: null },
    include: { asset: true }
  });
  const imageKinds = new Set(["artwork", "clipart", "upload", "mockup"]);
  if (versions.length !== references.size || !versions.every((version) => {
    const expected = references.get(version.id);
    return expected === "font" ? version.asset.kind === "font" : imageKinds.has(version.asset.kind);
  })) return null;

  if (customiserConfig) {
    const versionsById = new Map(versions.map((version) => [version.id, version]));
    const rulesById = new Map(customiserConfig.layers.map((rule) => [rule.layerId, rule]));
    for (const layer of scene.layers) {
      const rule = rulesById.get(layer.id);
      if (layer.type === "image" && rule?.type === "image"
        && !rule.acceptedContentTypes.some((contentType) => contentType === versionsById.get(layer.assetVersionId)?.contentType)) return null;
    }
  }
  return versions;
}

function resolveDesignConfiguration(designVersion: { sceneGraph: unknown; customiserConfig: unknown }) {
  const sceneResult = sceneGraphSchema.safeParse(designVersion.sceneGraph);
  if (!sceneResult.success) return null;
  const customiserConfigResult = designVersion.customiserConfig === null || designVersion.customiserConfig === undefined
    ? { success: true as const, data: defaultCustomiserConfig(sceneResult.data) }
    : customiserConfigSchema.safeParse(designVersion.customiserConfig);
  if (!customiserConfigResult.success
    || !customiserConfigMatchesScene(customiserConfigResult.data, sceneResult.data)) return null;
  return { scene: sceneResult.data, customiserConfig: customiserConfigResult.data };
}

function summariseInputs(inputs: Record<string, unknown>) {
  const text = Object.entries(inputs).map(([key, value]) => `${key}: ${String(value)}`).join(", ");
  return text || "Customisation committed";
}
