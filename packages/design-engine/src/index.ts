import { sceneGraphSchema, type SceneGraph } from "@personalise-kings/render-schema";

export const PREVIEW_RENDERER_VERSION = "preview-svg.v1";

export interface SceneAssetSource {
  assetVersionId: string;
  contentType: string;
  url: string;
}

export interface RenderedSceneSvg {
  content: string;
  widthPx: number;
  heightPx: number;
}

export function renderSceneSvg(
  input: SceneGraph,
  sources: Iterable<SceneAssetSource>,
  maximumDimensionPx = 1200
): RenderedSceneSvg {
  const scene = sceneGraphSchema.parse(input);
  if (!Number.isSafeInteger(maximumDimensionPx) || maximumDimensionPx < 1 || maximumDimensionPx > 4096) {
    throw new TypeError("Maximum preview dimension must be an integer between 1 and 4096");
  }
  if (scene.layers.length > 100) throw new RangeError("Preview scenes cannot exceed 100 layers");

  const assets = new Map([...sources].map((source) => [source.assetVersionId, source]));
  const longestEdge = Math.max(scene.printArea.widthUm, scene.printArea.heightUm);
  const widthPx = Math.max(1, Math.round(scene.printArea.widthUm / longestEdge * maximumDimensionPx));
  const heightPx = Math.max(1, Math.round(scene.printArea.heightUm / longestEdge * maximumDimensionPx));
  const fontIds = [...new Set(scene.layers.filter((layer) => layer.type === "text").map((layer) => layer.fontAssetVersionId))];
  const fontFaces = fontIds.map((id) => {
    const source = requiredSource(assets, id, "font");
    return `@font-face{font-family:${fontFamily(id)};src:url("${escapeCssUrl(source.url)}") format("${fontFormat(source.contentType)}");font-display:block}`;
  }).join("");
  const layers = scene.layers.map((layer) => {
    const transform = layer.transform;
    const group = `data-layer-id="${escapeAttribute(layer.id)}" data-layer-type="${layer.type}" transform="translate(${transform.translateXUm} ${transform.translateYUm}) rotate(${formatNumber(transform.rotationMilliDegrees / 1000)}) scale(${formatNumber(transform.scaleXPermille / 1000)} ${formatNumber(transform.scaleYPermille / 1000)})" opacity="${formatNumber(layer.opacityPermille / 1000)}"`;
    if (layer.type === "image") {
      const source = requiredSource(assets, layer.assetVersionId, "image");
      return `<g ${group}><image width="${layer.widthUm}" height="${layer.heightUm}" href="${escapeAttribute(source.url)}" preserveAspectRatio="xMidYMid meet"/></g>`;
    }
    const lines = layer.text.split("\n");
    const text = lines.map((line, index) => `<tspan x="0" dy="${index === 0 ? "0" : layer.fontSizeUm}">${escapeText(line)}</tspan>`).join("");
    return `<g ${group}><text x="0" y="0" fill="${escapeAttribute(layer.fill)}" font-family="${fontFamily(layer.fontAssetVersionId)}" font-size="${layer.fontSizeUm}" dominant-baseline="hanging">${text}</text></g>`;
  }).join("");

  return {
    widthPx,
    heightPx,
    content: `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${scene.printArea.widthUm} ${scene.printArea.heightUm}" data-renderer="${PREVIEW_RENDERER_VERSION}"><defs><clipPath id="print-area"><rect width="${scene.printArea.widthUm}" height="${scene.printArea.heightUm}"/></clipPath><style>${fontFaces}</style></defs><rect width="100%" height="100%" fill="#ffffff"/><g clip-path="url(#print-area)">${layers}</g></svg>`
  };
}

function requiredSource(sources: Map<string, SceneAssetSource>, id: string, kind: "font" | "image") {
  const source = sources.get(id);
  if (!source) throw new TypeError(`Missing scene asset: ${id}`);
  if (!source.url.startsWith("data:") && !source.url.startsWith("https://") && !source.url.startsWith("http://")) {
    throw new TypeError(`Unsupported scene asset URL: ${id}`);
  }
  const validContentType = kind === "image"
    ? ["image/png", "image/jpeg", "image/webp"].includes(source.contentType)
    : source.contentType.startsWith("font/") || source.contentType === "application/font-woff" || source.contentType === "application/x-font-ttf";
  if (!validContentType) throw new TypeError(`Unsupported ${kind} content type: ${source.contentType}`);
  return source;
}

function fontFamily(id: string) {
  return `pk-font-${id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function fontFormat(contentType: string) {
  if (contentType === "font/woff2") return "woff2";
  if (contentType === "font/woff" || contentType === "application/font-woff") return "woff";
  if (contentType === "font/otf") return "opentype";
  return "truetype";
}

function formatNumber(value: number) {
  return Number(value.toFixed(6)).toString();
}

function escapeText(value: string) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string) {
  return escapeText(value).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function escapeCssUrl(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "");
}
