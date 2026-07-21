import type { SceneGraph } from "@personalise-kings/render-schema";
import { describe, expect, it } from "vitest";
import { PREVIEW_RENDERER_VERSION, renderSceneSvg } from "./index";

const scene: SceneGraph = {
  schemaVersion: "scene-graph.v1",
  coordinateSystem: "micrometres",
  printArea: { widthUm: 100_000, heightUm: 50_000 },
  layers: [
    {
      id: "text-1", type: "text", name: "Name", text: "A&B <Kings>", fontAssetVersionId: "font-1", fontSizeUm: 8_000, fill: "#123456", opacityPermille: 900,
      transform: { translateXUm: 10_000, translateYUm: 5_000, scaleXPermille: 1200, scaleYPermille: 800, rotationMilliDegrees: 12_500 }
    },
    {
      id: "image-1", type: "image", name: "Photo", assetVersionId: "image-1", widthUm: 20_000, heightUm: 15_000, opacityPermille: 1000,
      transform: { translateXUm: 30_000, translateYUm: 10_000, scaleXPermille: 1000, scaleYPermille: 1000, rotationMilliDegrees: 0 }
    }
  ]
};
const sources = [
  { assetVersionId: "font-1", contentType: "font/woff2", url: "data:font/woff2;base64,Zm9udA==" },
  { assetVersionId: "image-1", contentType: "image/png", url: "data:image/png;base64,aW1hZ2U=" }
];

describe("renderSceneSvg", () => {
  it("renders deterministic physical geometry and escaped customer content", () => {
    const rendered = renderSceneSvg(scene, sources);
    expect(rendered).toMatchObject({ widthPx: 1200, heightPx: 600 });
    expect(rendered.content).toContain(`data-renderer="${PREVIEW_RENDERER_VERSION}"`);
    expect(rendered.content).toContain('viewBox="0 0 100000 50000"');
    expect(rendered.content).toContain('translate(10000 5000) rotate(12.5) scale(1.2 0.8)');
    expect(rendered.content).toContain("A&amp;B &lt;Kings&gt;");
    expect(rendered.content).toBe(renderSceneSvg(scene, sources).content);
  });

  it("rejects unresolved or unsafe asset sources", () => {
    expect(() => renderSceneSvg(scene, sources.filter((source) => source.assetVersionId !== "image-1"))).toThrow("Missing scene asset");
    expect(() => renderSceneSvg(scene, sources.map((source) => source.assetVersionId === "image-1" ? { ...source, url: "javascript:alert(1)" } : source))).toThrow("Unsupported scene asset URL");
  });

  it("preserves clipping, layer order, image fit, opacity, and multiline text", () => {
    const fixture: SceneGraph = structuredClone(scene);
    const text = fixture.layers[0];
    const image = fixture.layers[1];
    if (text?.type !== "text" || image?.type !== "image") throw new Error("Invalid fixture");
    text.text = "First\nSecond";
    text.transform.translateXUm = -2_000;
    image.transform.translateXUm = 95_000;
    image.opacityPermille = 450;

    const svg = renderSceneSvg(fixture, sources).content;
    const textIndex = svg.indexOf('data-layer-id="text-1"');
    const imageIndex = svg.indexOf('data-layer-id="image-1"');
    expect(svg).toContain('<g clip-path="url(#print-area)">');
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(svg).toContain('data-layer-id="image-1" data-layer-type="image" transform="translate(95000 10000)');
    expect(svg).toContain('opacity="0.45"');
    expect(svg).toContain('<tspan x="0" dy="0">First</tspan><tspan x="0" dy="8000">Second</tspan>');
    expect(textIndex).toBeGreaterThan(-1);
    expect(imageIndex).toBeGreaterThan(textIndex);
  });

  it("rejects source content types that do not match the scene layer", () => {
    expect(() => renderSceneSvg(scene, sources.map((source) => source.assetVersionId === "image-1"
      ? { ...source, contentType: "image/svg+xml" }
      : source))).toThrow("Unsupported image content type");
  });
});
