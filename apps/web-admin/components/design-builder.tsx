"use client";

import {
  customiserConfigMatchesScene,
  customiserConfigSchema,
  defaultCustomiserConfig,
  sceneGraphSchema,
  type CustomiserConfig,
  type SceneGraph
} from "@personalise-kings/render-schema";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface DesignSummary {
  id: string;
  name: string;
  currentVersion: {
    version: number;
    sceneGraph: unknown;
    customiserConfig: unknown;
  } | null;
}

interface AssetOption {
  id: string;
  name: string;
  kind: string;
  contentType: string;
}

interface BuilderState {
  designId: string;
  name: string;
  widthMm: number;
  heightMm: number;
  textLayerId: string;
  textName: string;
  defaultText: string;
  fontId: string;
  fontSizeMm: number;
  minimumFontSizeMm: number;
  maximumFontSizeMm: number;
  maxLength: number;
  colours: string;
  textXmm: number;
  textYmm: number;
  imageEnabled: boolean;
  imageLayerId: string;
  imageName: string;
  imageAssetId: string;
  imageXmm: number;
  imageYmm: number;
  imageWidthMm: number;
  imageHeightMm: number;
  maximumUploadMb: number;
  recommendedDpi: number;
  allowPosition: boolean;
  allowScale: boolean;
  allowRotation: boolean;
}

export function DesignBuilder({ designs, fonts, images }: Readonly<{
  designs: DesignSummary[];
  fonts: AssetOption[];
  images: AssetOption[];
}>) {
  const router = useRouter();
  const [state, setState] = useState(() => emptyState(fonts[0]?.id ?? "", images[0]?.id ?? ""));
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof BuilderState>(key: K, value: BuilderState[K]) {
    setState((current) => ({ ...current, [key]: value }));
  }

  function selectDesign(designId: string) {
    setError(null);
    setMessage(null);
    if (!designId) {
      setState(emptyState(fonts[0]?.id ?? "", images[0]?.id ?? ""));
      return;
    }

    const design = designs.find((candidate) => candidate.id === designId);
    const parsedScene = sceneGraphSchema.safeParse(design?.currentVersion?.sceneGraph);
    if (!design?.currentVersion || !parsedScene.success) {
      setError("This design version cannot be loaded by the constrained builder.");
      return;
    }
    const parsedConfig = customiserConfigSchema.safeParse(design.currentVersion.customiserConfig);
    const config = parsedConfig.success ? parsedConfig.data : defaultCustomiserConfig(parsedScene.data);
    const next = stateFromDesign(design, parsedScene.data, config, fonts, images);
    if (!next) {
      setError("This builder currently supports one text layer and one optional image layer.");
      return;
    }
    setState(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const payload = buildPayload(state);
    if (typeof payload === "string") {
      setError(payload);
      return;
    }

    setIsSaving(true);
    try {
      const endpoint = state.designId ? `/api/designs/${encodeURIComponent(state.designId)}/versions` : "/api/designs";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: state.name, ...payload })
      });
      const body = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? "The design could not be published");
      setMessage(state.designId ? "A new immutable design version was published." : "The design and its first version were created.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The design could not be published");
    } finally {
      setIsSaving(false);
    }
  }

  const selectedVersion = designs.find((design) => design.id === state.designId)?.currentVersion?.version;
  const canSubmit = Boolean(state.name.trim() && state.fontId && (!state.imageEnabled || state.imageAssetId));

  return (
    <section className="design-builder" aria-labelledby="design-builder-heading">
      <div className="builder-intro">
        <div>
          <p className="eyebrow">Constrained builder</p>
          <h2 id="design-builder-heading">Publish a customer-ready design</h2>
        </div>
        <label>
          Working design
          <select value={state.designId} onChange={(event) => selectDesign(event.target.value)}>
            <option value="">New design</option>
            {designs.map((design) => <option key={design.id} value={design.id}>{design.name} (v{design.currentVersion?.version ?? 0})</option>)}
          </select>
        </label>
      </div>

      <form className="builder-form" onSubmit={submit}>
        <fieldset>
          <legend>Template</legend>
          <div className="builder-grid three-columns">
            <Field label="Design name"><input required maxLength={160} value={state.name} onChange={(event) => update("name", event.target.value)} /></Field>
            <NumberField label="Print width" unit="mm" value={state.widthMm} minimum={10} maximum={1000} onChange={(value) => update("widthMm", value)} />
            <NumberField label="Print height" unit="mm" value={state.heightMm} minimum={10} maximum={1000} onChange={(value) => update("heightMm", value)} />
          </div>
        </fieldset>

        <fieldset>
          <legend>Text layer</legend>
          <div className="builder-grid two-columns">
            <Field label="Layer label"><input required maxLength={80} value={state.textName} onChange={(event) => update("textName", event.target.value)} /></Field>
            <Field label="Approved font">
              <select required value={state.fontId} onChange={(event) => update("fontId", event.target.value)}>
                <option value="">Select a font</option>
                {fonts.map((font) => <option key={font.id} value={font.id}>{font.name}</option>)}
              </select>
            </Field>
            <Field label="Default text"><input required maxLength={500} value={state.defaultText} onChange={(event) => update("defaultText", event.target.value)} /></Field>
            <NumberField label="Maximum characters" value={state.maxLength} minimum={1} maximum={500} onChange={(value) => update("maxLength", value)} />
            <NumberField label="Default size" unit="mm" value={state.fontSizeMm} minimum={1} maximum={500} step={0.5} onChange={(value) => update("fontSizeMm", value)} />
            <div className="builder-split">
              <NumberField label="Minimum size" unit="mm" value={state.minimumFontSizeMm} minimum={1} maximum={500} step={0.5} onChange={(value) => update("minimumFontSizeMm", value)} />
              <NumberField label="Maximum size" unit="mm" value={state.maximumFontSizeMm} minimum={1} maximum={500} step={0.5} onChange={(value) => update("maximumFontSizeMm", value)} />
            </div>
            <Field label="Approved colours" hint="Comma-separated six-digit hex values">
              <input value={state.colours} onChange={(event) => update("colours", event.target.value)} placeholder="#17201a, #145a42" />
            </Field>
            <div className="builder-split">
              <NumberField label="Horizontal" unit="mm" value={state.textXmm} minimum={-1000} maximum={2000} step={0.5} onChange={(value) => update("textXmm", value)} />
              <NumberField label="Vertical" unit="mm" value={state.textYmm} minimum={-1000} maximum={2000} step={0.5} onChange={(value) => update("textYmm", value)} />
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Image layer</legend>
          <label className="builder-check"><input type="checkbox" checked={state.imageEnabled} onChange={(event) => update("imageEnabled", event.target.checked)} /> Allow a customer image</label>
          {state.imageEnabled ? (
            <div className="builder-grid two-columns">
              <Field label="Layer label"><input required value={state.imageName} onChange={(event) => update("imageName", event.target.value)} /></Field>
              <Field label="Default image">
                <select required value={state.imageAssetId} onChange={(event) => update("imageAssetId", event.target.value)}>
                  <option value="">Select an accepted image asset</option>
                  {images.map((image) => <option key={image.id} value={image.id}>{image.name} ({image.kind})</option>)}
                </select>
              </Field>
              <div className="builder-split">
                <NumberField label="Width" unit="mm" value={state.imageWidthMm} minimum={1} maximum={1000} step={0.5} onChange={(value) => update("imageWidthMm", value)} />
                <NumberField label="Height" unit="mm" value={state.imageHeightMm} minimum={1} maximum={1000} step={0.5} onChange={(value) => update("imageHeightMm", value)} />
              </div>
              <div className="builder-split">
                <NumberField label="Horizontal" unit="mm" value={state.imageXmm} minimum={-1000} maximum={2000} step={0.5} onChange={(value) => update("imageXmm", value)} />
                <NumberField label="Vertical" unit="mm" value={state.imageYmm} minimum={-1000} maximum={2000} step={0.5} onChange={(value) => update("imageYmm", value)} />
              </div>
              <NumberField label="Maximum upload" unit="MB" value={state.maximumUploadMb} minimum={1} maximum={50} onChange={(value) => update("maximumUploadMb", value)} />
              <NumberField label="Recommended quality" unit="DPI" value={state.recommendedDpi} minimum={72} maximum={1200} onChange={(value) => update("recommendedDpi", value)} />
            </div>
          ) : null}
        </fieldset>

        <fieldset>
          <legend>Customer controls</legend>
          <div className="builder-check-row">
            <label className="builder-check"><input type="checkbox" checked={state.allowPosition} onChange={(event) => update("allowPosition", event.target.checked)} /> Position</label>
            <label className="builder-check"><input type="checkbox" checked={state.allowScale} onChange={(event) => update("allowScale", event.target.checked)} /> Scale</label>
            <label className="builder-check"><input type="checkbox" checked={state.allowRotation} onChange={(event) => update("allowRotation", event.target.checked)} /> Rotation</label>
          </div>
        </fieldset>

        {fonts.length === 0 ? <p className="error-box">Upload and accept at least one font asset before publishing a design.</p> : null}
        {error ? <p className="error-box" role="alert">{error}</p> : null}
        {message ? <p className="success-box" role="status">{message}</p> : null}
        <button className="builder-submit" type="submit" disabled={!canSubmit || isSaving}>
          {isSaving ? "Publishing..." : state.designId ? `Publish version ${(selectedVersion ?? 0) + 1}` : "Create design"}
        </button>
      </form>
    </section>
  );
}

function Field({ label, hint, children }: Readonly<{ label: string; hint?: string; children: React.ReactNode }>) {
  return <label className="builder-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function NumberField({ label, unit, value, minimum, maximum, step = 1, onChange }: Readonly<{
  label: string;
  unit?: string;
  value: number;
  minimum: number;
  maximum: number;
  step?: number;
  onChange: (value: number) => void;
}>) {
  return <Field label={label} hint={unit}><input type="number" required min={minimum} max={maximum} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></Field>;
}

function emptyState(fontId: string, imageAssetId: string): BuilderState {
  return {
    designId: "", name: "", widthMm: 100, heightMm: 70,
    textLayerId: "text-1", textName: "Customer name", defaultText: "Your text", fontId,
    fontSizeMm: 9, minimumFontSizeMm: 5, maximumFontSizeMm: 14, maxLength: 40,
    colours: "#17201a, #145a42, #b8462c, #245f8f", textXmm: 12, textYmm: 32,
    imageEnabled: false, imageLayerId: "image-1", imageName: "Customer image", imageAssetId,
    imageXmm: 55, imageYmm: 20, imageWidthMm: 30, imageHeightMm: 30,
    maximumUploadMb: 20, recommendedDpi: 300,
    allowPosition: true, allowScale: true, allowRotation: true
  };
}

function buildPayload(state: BuilderState): { sceneGraph: SceneGraph; customiserConfig: CustomiserConfig } | string {
  const colours = [...new Set(state.colours.split(",").map((colour) => colour.trim().toLowerCase()).filter(Boolean))];
  if (colours.length === 0 || colours.some((colour) => !/^#[0-9a-f]{6}$/.test(colour))) return "Approved colours must be comma-separated six-digit hex values.";

  const transform = { scaleXPermille: 1000, scaleYPermille: 1000, rotationMilliDegrees: 0 };
  const layers: SceneGraph["layers"] = [{
    id: state.textLayerId,
    type: "text",
    name: state.textName.trim(),
    transform: { ...transform, translateXUm: um(state.textXmm), translateYUm: um(state.textYmm) },
    text: state.defaultText,
    fontAssetVersionId: state.fontId,
    fontSizeUm: um(state.fontSizeMm),
    fill: colours[0],
    opacityPermille: 1000
  }];
  const rules: CustomiserConfig["layers"] = [{
    layerId: state.textLayerId,
    type: "text",
    maxLength: state.maxLength,
    allowedColours: colours,
    allowFontSize: true,
    minimumFontSizeUm: um(state.minimumFontSizeMm),
    maximumFontSizeUm: um(state.maximumFontSizeMm),
    transform: { position: state.allowPosition, scale: state.allowScale, rotation: state.allowRotation }
  }];

  if (state.imageEnabled) {
    layers.push({
      id: state.imageLayerId,
      type: "image",
      name: state.imageName.trim(),
      transform: { ...transform, translateXUm: um(state.imageXmm), translateYUm: um(state.imageYmm) },
      assetVersionId: state.imageAssetId,
      widthUm: um(state.imageWidthMm),
      heightUm: um(state.imageHeightMm),
      opacityPermille: 1000
    });
    rules.push({
      layerId: state.imageLayerId,
      type: "image",
      acceptedContentTypes: ["image/png", "image/jpeg", "image/webp"],
      maximumUploadBytes: Math.round(state.maximumUploadMb * 1024 * 1024),
      recommendedDpi: Math.round(state.recommendedDpi),
      transform: { position: state.allowPosition, scale: state.allowScale, rotation: state.allowRotation }
    });
  }

  const sceneResult = sceneGraphSchema.safeParse({
    schemaVersion: "scene-graph.v1",
    coordinateSystem: "micrometres",
    printArea: { widthUm: um(state.widthMm), heightUm: um(state.heightMm) },
    layers
  });
  const configResult = customiserConfigSchema.safeParse({ schemaVersion: "customiser-config.v1", layers: rules });
  if (!sceneResult.success || !configResult.success || !customiserConfigMatchesScene(configResult.data, sceneResult.data)) {
    return "The layer defaults and customer limits are inconsistent. Check dimensions, font sizes, and layer fields.";
  }
  return { sceneGraph: sceneResult.data, customiserConfig: configResult.data };
}

function stateFromDesign(
  design: DesignSummary,
  scene: SceneGraph,
  config: CustomiserConfig,
  fonts: AssetOption[],
  images: AssetOption[]
): BuilderState | null {
  const textLayers = scene.layers.filter((layer) => layer.type === "text");
  const imageLayers = scene.layers.filter((layer) => layer.type === "image");
  if (textLayers.length !== 1 || imageLayers.length > 1 || scene.layers.length !== textLayers.length + imageLayers.length) return null;
  const text = textLayers[0];
  const image = imageLayers[0];
  if (text?.type !== "text" || (image && image.type !== "image")) return null;
  const textRule = config.layers.find((rule) => rule.layerId === text.id);
  const imageRule = image ? config.layers.find((rule) => rule.layerId === image.id) : null;
  if (textRule?.type !== "text" || (image && imageRule?.type !== "image")) return null;
  const fallback = emptyState(fonts[0]?.id ?? "", images[0]?.id ?? "");
  return {
    ...fallback,
    designId: design.id,
    name: design.name,
    widthMm: scene.printArea.widthUm / 1000,
    heightMm: scene.printArea.heightUm / 1000,
    textLayerId: text.id,
    textName: text.name,
    defaultText: text.text,
    fontId: text.fontAssetVersionId,
    fontSizeMm: text.fontSizeUm / 1000,
    minimumFontSizeMm: textRule.minimumFontSizeUm / 1000,
    maximumFontSizeMm: textRule.maximumFontSizeUm / 1000,
    maxLength: textRule.maxLength,
    colours: textRule.allowedColours.join(", "),
    textXmm: text.transform.translateXUm / 1000,
    textYmm: text.transform.translateYUm / 1000,
    imageEnabled: Boolean(image),
    imageLayerId: image?.id ?? fallback.imageLayerId,
    imageName: image?.name ?? fallback.imageName,
    imageAssetId: image?.assetVersionId ?? fallback.imageAssetId,
    imageXmm: image ? image.transform.translateXUm / 1000 : fallback.imageXmm,
    imageYmm: image ? image.transform.translateYUm / 1000 : fallback.imageYmm,
    imageWidthMm: image ? image.widthUm / 1000 : fallback.imageWidthMm,
    imageHeightMm: image ? image.heightUm / 1000 : fallback.imageHeightMm,
    maximumUploadMb: imageRule?.type === "image" ? imageRule.maximumUploadBytes / 1024 / 1024 : fallback.maximumUploadMb,
    recommendedDpi: imageRule?.type === "image" ? imageRule.recommendedDpi : fallback.recommendedDpi,
    allowPosition: textRule.transform.position,
    allowScale: textRule.transform.scale,
    allowRotation: textRule.transform.rotation
  };
}

function um(millimetres: number) {
  return Math.round(millimetres * 1000);
}
