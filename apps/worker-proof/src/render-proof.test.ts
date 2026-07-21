import { describe, expect, it } from "vitest";
import { renderSceneSvg } from "@personalise-kings/design-engine";
import type { SceneGraph } from "@personalise-kings/render-schema";
import { validateProofSource } from "./render-proof";

const validSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50" data-renderer="preview-svg.v1"><rect width="100" height="50" fill="#fff"/></svg>';

describe("validateProofSource", () => {
  it("accepts a bounded generated preview", () => {
    expect(validateProofSource({ bytes: new TextEncoder().encode(validSvg), widthPx: 100, heightPx: 50 })).toBe(validSvg);
  });

  it.each([
    ["scripts", validSvg.replace("<rect", "<script>alert(1)</script><rect")],
    ["foreign objects", validSvg.replace("<rect", "<foreignObject/><rect")],
    ["external references", validSvg.replace("<rect", '<image href="https://example.com/a.png"/><rect')]
  ])("rejects %s", (_name, svg) => {
    expect(() => validateProofSource({ bytes: new TextEncoder().encode(svg), widthPx: 100, heightPx: 50 })).toThrow("external or executable");
  });

  it("rejects unbounded dimensions", () => {
    expect(() => validateProofSource({ bytes: new TextEncoder().encode(validSvg), widthPx: 5000, heightPx: 50 })).toThrow("dimensions");
  });

  it("accepts the exact shared-renderer output used by committed previews", () => {
    const scene: SceneGraph = {
      schemaVersion: "scene-graph.v1",
      coordinateSystem: "micrometres",
      printArea: { widthUm: 60_000, heightUm: 30_000 },
      layers: [{
        id: "photo", type: "image", name: "Photo", assetVersionId: "image", widthUm: 20_000, heightUm: 15_000, opacityPermille: 800,
        transform: { translateXUm: 55_000, translateYUm: -1_000, scaleXPermille: 1200, scaleYPermille: 900, rotationMilliDegrees: 30_000 }
      }]
    };
    const rendered = renderSceneSvg(scene, [{ assetVersionId: "image", contentType: "image/png", url: "data:image/png;base64,aW1hZ2U=" }], 600);
    expect(validateProofSource({
      bytes: new TextEncoder().encode(rendered.content),
      widthPx: rendered.widthPx,
      heightPx: rendered.heightPx
    })).toBe(rendered.content);
  });

  it("rejects a recorded size that differs from the generated SVG", () => {
    expect(() => validateProofSource({ bytes: new TextEncoder().encode(validSvg), widthPx: 101, heightPx: 50 })).toThrow("recorded preview dimensions");
  });
});
