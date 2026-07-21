"use client";

import { EMBED_PROTOCOL_VERSION, parentToEmbedMessageSchema, type EmbedToParentMessage } from "@personalise-kings/connector-contracts";
import { SCENE_GRAPH_SCHEMA_VERSION, type CustomiserConfig, type SceneGraph } from "@personalise-kings/render-schema";
import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { commitScene, loadCustomiserConfig, uploadRaster, type ConfigAsset, type CustomiserInitialization as Initialization } from "../lib/customiser-api";
import { imageQualityWarning, sceneSummary } from "../lib/scene-utils";
import { createLiveArtworkSvg } from "../lib/live-artwork";
import { ScenePreviewLayer } from "./scene-preview";
import { SceneArtwork } from "./scene-artwork";

interface CustomiserClientProps {
  parentOrigin: string;
  correlationId: string;
}

type SceneLayer = SceneGraph["layers"][number];
type ImageLayer = Extract<SceneLayer, { type: "image" }>;

const acceptedUploadTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export function CustomiserClient({ parentOrigin, correlationId }: Readonly<CustomiserClientProps>) {
  const [scene, setScene] = useState<SceneGraph | null>(null);
  const [customiserConfig, setCustomiserConfig] = useState<CustomiserConfig | null>(null);
  const [assets, setAssets] = useState<Record<string, ConfigAsset>>({});
  const [designName, setDesignName] = useState("Personalised item");
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingLayerId, setUploadingLayerId] = useState<string | null>(null);
  const [initialization, setInitialization] = useState<Initialization | null>(null);
  const [variantWarning, setVariantWarning] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editingRevision, setEditingRevision] = useState<number | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<SceneGraph | null>(scene);
  const initializationRef = useRef<Initialization | null>(null);
  sceneRef.current = scene;

  useEffect(() => {
    postToParent(parentOrigin, {
      event: "ready",
      payload: { height: rootRef.current?.scrollHeight ?? 640 },
      correlation_id: correlationId
    });

    const resizeObserver = new ResizeObserver(([entry]) => {
      postToParent(parentOrigin, {
        event: "resize",
        payload: { height: Math.ceil(entry.contentRect.height) },
        correlation_id: correlationId
      });
    });

    if (rootRef.current) resizeObserver.observe(rootRef.current);

    function onMessage(event: MessageEvent) {
      if (event.origin !== parentOrigin || event.source !== window.parent) return;

      const initialized = parseInitializeMessage(event.data, correlationId);
      if (initialized) {
        initializationRef.current = initialized;
        setInitialization(initialized);
        setVariantWarning(null);
        setErrorMessage(null);
        setEditingRevision(null);
        return;
      }

      const parsed = parentToEmbedMessageSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.correlation_id !== correlationId) return;

      if (parsed.data.event === "variant-change") {
        initializationRef.current = null;
        setInitialization(null);
        setScene(null);
        setCustomiserConfig(null);
        setAssets({});
        setVariantWarning("The product variant changed, so this customisation must be reviewed before checkout.");
      }

      if (parsed.data.event === "save") {
        const current = initializationRef.current;
        const currentScene = sceneRef.current;
        if (current && currentScene) {
          void commitCustomisation(currentScene, parentOrigin, correlationId, current, () => initializationRef.current === current, setIsSaving, setErrorMessage, rememberReference);
        }
      }
    }

    window.addEventListener("message", onMessage);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("message", onMessage);
    };
  }, [correlationId, parentOrigin]);

  useEffect(() => {
    if (!initialization) {
      setIsLoading(false);
      return;
    }
    const controller = new AbortController();
    setIsLoading(true);
    setScene(null);
    setCustomiserConfig(null);
    setAssets({});
    setErrorMessage(null);

    void loadCustomiserConfig(initialization, correlationId, controller.signal)
      .then((config) => {
        if (config.allowedParentOrigin !== parentOrigin) {
          throw new Error("This customiser link is not authorized for the embedding shop.");
        }
        setDesignName(config.designName);
        setScene(config.scene);
        setCustomiserConfig(config.rules);
        setAssets(config.assets);
        setSelectedLayerId(config.rules.layers[0]?.layerId ?? null);
        setEditingRevision(config.resumedRevision ?? null);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setErrorMessage(error instanceof Error ? error.message : "Unable to load this design");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [correlationId, initialization]);

  const selectedLayer = scene?.layers.find((layer) => layer.id === selectedLayerId) ?? null;
  const selectedRule = customiserConfig?.layers.find((rule) => rule.layerId === selectedLayerId) ?? null;
  const editableLayers = scene?.layers.filter((layer) => customiserConfig?.layers.some((rule) => rule.layerId === layer.id)) ?? [];
  const liveArtworkSvg = scene ? createLiveArtworkSvg(scene, assets) : null;

  function updateLayer(layerId: string, update: (layer: SceneLayer) => SceneLayer) {
    setScene((current) => current ? {
      ...current,
      layers: current.layers.map((layer) => layer.id === layerId ? update(layer) : layer)
    } : current);
  }

  function updateTransform(field: keyof SceneLayer["transform"], value: number) {
    if (!selectedLayer || !scene || !Number.isFinite(value)) return;
    const maximumTranslation = field === "translateXUm" ? scene.printArea.widthUm : scene.printArea.heightUm;
    const constrained = field === "rotationMilliDegrees"
      ? clamp(value, -360_000, 360_000)
      : field === "translateXUm" || field === "translateYUm"
        ? clamp(value, -maximumTranslation, maximumTranslation * 2)
        : clamp(value, 100, 5000);
    updateLayer(selectedLayer.id, (layer) => ({
      ...layer,
      transform: { ...layer.transform, [field]: Math.round(constrained) }
    }));
  }

  async function handleImageUpload(event: ChangeEvent<HTMLInputElement>, layer: ImageLayer) {
    const file = event.target.files?.[0];
    event.target.value = "";
    const rule = customiserConfig?.layers.find((candidate) => candidate.layerId === layer.id);
    if (!file || !initialization || rule?.type !== "image") return;
    if (!acceptedUploadTypes.has(file.type) || !rule.acceptedContentTypes.some((contentType) => contentType === file.type)) {
      setErrorMessage("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > rule.maximumUploadBytes) {
      setErrorMessage(`The image must be smaller than ${Math.floor(rule.maximumUploadBytes / 1024 / 1024)} MB.`);
      return;
    }

    setUploadingLayerId(layer.id);
    setErrorMessage(null);
    try {
      const uploaded = await uploadRaster(file, layer.id, initialization, correlationId);
      if (initializationRef.current !== initialization) return;
      setAssets((current) => ({ ...current, [uploaded.assetVersionId]: uploaded }));
      updateLayer(layer.id, (current) => current.type === "image"
        ? { ...current, assetVersionId: uploaded.assetVersionId }
        : current);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to upload the image");
    } finally {
      setUploadingLayerId(null);
    }
  }

  return (
    <main className="customiser-shell" ref={rootRef}>
      <section className="preview-panel" aria-label="Product preview">
        <div className="preview-heading">
          <span>Live proof</span>
          <strong>{designName}</strong>
        </div>
        {scene ? (
          <div className="canvas-wrap">
            <div
              className={`print-area${liveArtworkSvg ? " artwork-backed" : ""}`}
              style={{ aspectRatio: `${scene.printArea.widthUm} / ${scene.printArea.heightUm}` }}
              aria-label={sceneSummary(scene)}
            >
              {liveArtworkSvg ? <SceneArtwork svg={liveArtworkSvg} /> : null}
              {scene.layers.map((layer) => {
                const rule = customiserConfig?.layers.find((candidate) => candidate.layerId === layer.id);
                return (
                  <ScenePreviewLayer
                    key={layer.id}
                    layer={layer}
                    scene={scene}
                    asset={layer.type === "image" ? assets[layer.assetVersionId] : undefined}
                    selected={layer.id === selectedLayerId}
                    allowPosition={rule?.transform.position ?? false}
                    allowScale={rule?.transform.scale ?? false}
                    allowRotation={rule?.transform.rotation ?? false}
                    onSelect={() => rule && setSelectedLayerId(layer.id)}
                    onMove={(xUm, yUm) => rule?.transform.position && updateLayer(layer.id, (current) => ({
                      ...current,
                      transform: { ...current.transform, translateXUm: xUm, translateYUm: yUm }
                    }))}
                    onTransform={(scaleXPermille, scaleYPermille, rotationMilliDegrees) => rule && updateLayer(layer.id, (current) => ({
                      ...current,
                      transform: { ...current.transform, scaleXPermille, scaleYPermille, rotationMilliDegrees }
                    }))}
                  />
                );
              })}
            </div>
          </div>
        ) : (
          <div className="preview-placeholder" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            {isLoading ? "Loading your design..." : "Waiting for a product design"}
          </div>
        )}
        {scene ? (
          <div className="preview-notes">
            {customiserConfig?.layers.some((rule) => rule.transform.position || rule.transform.scale || rule.transform.rotation) ? (
              <p className="interaction-hint" id="movement-instructions">
                {customiserConfig.layers.some((rule) => rule.transform.position) ? "Drag to position. Arrow keys move by 0.5 mm; Shift uses 2.5 mm and Alt uses 0.1 mm. " : ""}
                {customiserConfig.layers.some((rule) => rule.transform.scale || rule.transform.rotation) ? "On touch screens, use two fingers to scale or rotate." : ""}
              </p>
            ) : null}
            <p className="preview-summary">{sceneSummary(scene)}</p>
          </div>
        ) : null}
      </section>
      <aside className="controls" aria-label="Personalisation controls">
        <header className="controls-heading">
          <p className="eyebrow">Scene graph {SCENE_GRAPH_SCHEMA_VERSION}</p>
          <h1>Make it yours</h1>
          <p>Choose a layer, then use the precise controls below. Every adjustment is saved in real print dimensions.</p>
        </header>
        {variantWarning ? <p className="warning-text" role="status">{variantWarning}</p> : null}
        {errorMessage ? <p className="error-text" role="alert">{errorMessage}</p> : null}
        {editingRevision ? <p className="resume-text" role="status">Editing saved customisation revision {editingRevision}. Saving will create a new immutable revision.</p> : null}
        {!initialization ? <p className="warning-text" role="status">Waiting for the shop to initialize this product.</p> : null}

        {scene ? (
          <>
            <nav className="layer-picker" aria-label="Editable layers">
              {editableLayers.map((layer, index) => (
                <button
                  type="button"
                  className={layer.id === selectedLayerId ? "layer-pill selected" : "layer-pill"}
                  aria-pressed={layer.id === selectedLayerId}
                  key={layer.id}
                  onClick={() => setSelectedLayerId(layer.id)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {layer.name}
                </button>
              ))}
            </nav>

            {selectedLayer?.type === "text" && selectedRule?.type === "text" ? (
              <section className="control-section" aria-labelledby="content-heading">
                <div className="section-title"><span>01</span><h2 id="content-heading">Content</h2></div>
                <label className="field-label">
                  Text
                  <input
                    type="text"
                    maxLength={selectedRule.maxLength}
                    value={selectedLayer.text}
                    onChange={(event) => updateLayer(selectedLayer.id, (layer) => layer.type === "text" ? { ...layer, text: event.target.value } : layer)}
                  />
                </label>
                <fieldset className="colour-fieldset">
                  <legend>Colour</legend>
                  <div className="swatches">
                    {selectedRule.allowedColours.map((colour) => (
                      <button
                        type="button"
                        key={colour}
                        className={selectedLayer.fill.toLowerCase() === colour.toLowerCase() ? "swatch selected" : "swatch"}
                        style={{ "--swatch-colour": colour } as CSSProperties}
                        aria-label={`Use colour ${colour}`}
                        aria-pressed={selectedLayer.fill.toLowerCase() === colour.toLowerCase()}
                        onClick={() => updateLayer(selectedLayer.id, (layer) => layer.type === "text" ? { ...layer, fill: colour } : layer)}
                      />
                    ))}
                  </div>
                </fieldset>
                <label className="field-label compact-field" hidden={!selectedRule.allowFontSize}>
                  Text size <span>mm</span>
                  <input
                    type="number"
                    min={selectedRule.minimumFontSizeUm / 1000}
                    max={selectedRule.maximumFontSizeUm / 1000}
                    step="0.5"
                    value={selectedLayer.fontSizeUm / 1000}
                    onChange={(event) => {
                      const fontSizeUm = Number(event.target.value) * 1000;
                      if (fontSizeUm > 0) updateLayer(selectedLayer.id, (layer) => layer.type === "text" ? { ...layer, fontSizeUm: Math.round(clamp(fontSizeUm, selectedRule.minimumFontSizeUm, selectedRule.maximumFontSizeUm)) } : layer);
                    }}
                  />
                </label>
              </section>
            ) : null}

            {selectedLayer?.type === "image" && selectedRule?.type === "image" ? (
              <section className="control-section" aria-labelledby="image-heading">
                <div className="section-title"><span>01</span><h2 id="image-heading">Artwork</h2></div>
                <label className={uploadingLayerId === selectedLayer.id ? "upload-dropzone loading" : "upload-dropzone"}>
                  <strong>{uploadingLayerId === selectedLayer.id ? "Checking image..." : "Choose an image"}</strong>
                  <span>{selectedRule.acceptedContentTypes.map(formatContentType).join(", ")} up to {Math.floor(selectedRule.maximumUploadBytes / 1024 / 1024)} MB</span>
                  <input
                    type="file"
                    accept={selectedRule.acceptedContentTypes.join(",")}
                    disabled={uploadingLayerId !== null}
                    onChange={(event) => void handleImageUpload(event, selectedLayer)}
                  />
                </label>
                {imageQualityWarning(selectedLayer, assets[selectedLayer.assetVersionId], selectedRule.recommendedDpi) ? (
                  <p className="quality-warning" role="status">{imageQualityWarning(selectedLayer, assets[selectedLayer.assetVersionId], selectedRule.recommendedDpi)}</p>
                ) : null}
              </section>
            ) : null}

            {selectedLayer && selectedRule && (selectedRule.transform.position || selectedRule.transform.scale || selectedRule.transform.rotation) ? (
              <section className="control-section" aria-labelledby="position-heading">
                <div className="section-title"><span>02</span><h2 id="position-heading">Position</h2></div>
                <output className="position-readout" aria-live="polite">
                  X {formatMillimetres(selectedLayer.transform.translateXUm)} mm, Y {formatMillimetres(selectedLayer.transform.translateYUm)} mm, scale {(selectedLayer.transform.scaleXPermille / 10).toFixed(0)}%, rotation {(selectedLayer.transform.rotationMilliDegrees / 1000).toFixed(1)} degrees
                </output>
                <div className="number-grid">
                  <label className="field-label compact-field" hidden={!selectedRule.transform.position}>
                    Horizontal <span>mm</span>
                    <input type="number" step="0.5" value={selectedLayer.transform.translateXUm / 1000} onChange={(event) => updateTransform("translateXUm", Number(event.target.value) * 1000)} />
                  </label>
                  <label className="field-label compact-field" hidden={!selectedRule.transform.position}>
                    Vertical <span>mm</span>
                    <input type="number" step="0.5" value={selectedLayer.transform.translateYUm / 1000} onChange={(event) => updateTransform("translateYUm", Number(event.target.value) * 1000)} />
                  </label>
                  <label className="field-label compact-field" hidden={!selectedRule.transform.scale}>
                    Scale <span>%</span>
                    <input type="number" min="10" max="500" step="1" value={selectedLayer.transform.scaleXPermille / 10} onChange={(event) => {
                      const scale = Number(event.target.value) * 10;
                      if (scale > 0) {
                        const constrainedScale = Math.round(clamp(scale, 100, 5000));
                        updateLayer(selectedLayer.id, (layer) => ({ ...layer, transform: { ...layer.transform, scaleXPermille: constrainedScale, scaleYPermille: constrainedScale } }));
                      }
                    }} />
                  </label>
                  <label className="field-label compact-field" hidden={!selectedRule.transform.rotation}>
                    Rotation <span>deg</span>
                    <input type="number" min="-360" max="360" step="1" value={selectedLayer.transform.rotationMilliDegrees / 1000} onChange={(event) => updateTransform("rotationMilliDegrees", Number(event.target.value) * 1000)} />
                  </label>
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        <div className="action-bar">
          <button
            type="button"
            className="primary-button"
            disabled={isSaving || isLoading || uploadingLayerId !== null || !initialization || !scene}
            onClick={() => {
              const current = initializationRef.current;
              if (current && scene) void commitCustomisation(scene, parentOrigin, correlationId, current, () => initializationRef.current === current, setIsSaving, setErrorMessage, rememberReference);
            }}
          >
            {isSaving ? "Saving artwork..." : editingRevision ? "Update customisation" : "Save customisation"}
          </button>
          <button type="button" className="secondary-button" onClick={() => postToParent(parentOrigin, { event: "cancel", payload: {}, correlation_id: correlationId })}>Cancel</button>
        </div>
      </aside>
    </main>
  );

  function rememberReference(customisationReference: string, revision: number) {
    const current = initializationRef.current;
    if (current) initializationRef.current = { ...current, customisationReference };
    setEditingRevision(revision);
  }
}

async function commitCustomisation(
  scene: SceneGraph,
  parentOrigin: string,
  correlationId: string,
  initialization: Initialization,
  isCurrent: () => boolean,
  setIsSaving: (value: boolean) => void,
  setErrorMessage: (value: string | null) => void,
  onReference?: (customisationReference: string, revision: number) => void
) {
  setIsSaving(true);
  setErrorMessage(null);

  try {
    const result = await commitScene(scene, initialization, correlationId);
    if (!isCurrent()) return;
    onReference?.(result.customisationReference, result.revision);

    postToParent(parentOrigin, {
      event: "committed",
      payload: {
        customisation_reference: result.customisationReference,
        summary: sceneSummary(scene),
        preview_url: result.previewUrl
      },
      correlation_id: correlationId
    });
    postToParent(parentOrigin, {
      event: "add-to-cart",
      payload: {
        customisation_reference: result.customisationReference,
        price_delta_minor: initialization.priceModifierMinor ?? 0
      },
      correlation_id: correlationId
    });
  } catch (error) {
    if (!isCurrent()) return;
    const message = error instanceof Error ? error.message : "Unable to commit customisation";
    setErrorMessage(message);
    postToParent(parentOrigin, {
      event: "error",
      payload: {
        code: "commit_failed",
        message
      },
      correlation_id: correlationId
    });
  } finally {
    setIsSaving(false);
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatContentType(contentType: string) {
  return contentType.split("/")[1]?.toUpperCase() ?? contentType;
}

function formatMillimetres(micrometres: number) {
  return (micrometres / 1000).toFixed(1);
}

function postToParent(
  parentOrigin: string,
  message: Omit<EmbedToParentMessage, "protocol" | "message_id" | "sent_at">
) {
  window.parent.postMessage({
    protocol: EMBED_PROTOCOL_VERSION,
    message_id: randomUUID(),
    sent_at: new Date().toISOString(),
    ...message
  }, parentOrigin);
}

function randomUUID() {
  return crypto.randomUUID();
}

function parseInitializeMessage(value: unknown, correlationId: string): Initialization | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  const payload = message.payload;
  if (
    message.protocol !== EMBED_PROTOCOL_VERSION || message.event !== "initialize" ||
    typeof message.message_id !== "string" || !message.message_id ||
    typeof message.sent_at !== "string" || Number.isNaN(Date.parse(message.sent_at)) ||
    message.correlation_id !== correlationId || !payload || typeof payload !== "object"
  ) return null;

  const config = payload as Record<string, unknown>;
  if (typeof config.api_url !== "string" || typeof config.embed_token !== "string" || !config.embed_token) return null;

  try {
    const apiUrl = new URL(config.api_url);
    if (apiUrl.protocol !== "http:" && apiUrl.protocol !== "https:") return null;
    return {
      apiUrl: apiUrl.href.replace(/\/$/, ""),
      embedToken: config.embed_token,
      externalVariantId: typeof config.external_variant_id === "string" ? config.external_variant_id : undefined,
      customisationReference: typeof config.customisation_reference === "string" && isCustomisationReference(config.customisation_reference)
        ? config.customisation_reference
        : undefined,
      priceModifierMinor: typeof config.price_modifier_minor === "number" && Number.isSafeInteger(config.price_modifier_minor)
        ? config.price_modifier_minor
        : 0
    };
  } catch {
    return null;
  }
}

function isCustomisationReference(value: string) {
  return /^pk_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
