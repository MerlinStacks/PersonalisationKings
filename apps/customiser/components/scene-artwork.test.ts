import type { SceneGraph } from "@personalise-kings/render-schema";
import { describe, expect, it } from "vitest";
import type { ConfigAsset } from "../lib/customiser-api";
import { createLiveArtworkSvg } from "../lib/live-artwork";

const scene: SceneGraph = {
  schemaVersion: "scene-graph.v1",
  coordinateSystem: "micrometres",
  printArea: { widthUm: 80_000, heightUm: 40_000 },
  layers: [{
    id: "text", type: "text", name: "Name", text: "Ada", fontAssetVersionId: "font", fontSizeUm: 8_000, fill: "#112233", opacityPermille: 1000,
    transform: { translateXUm: 5_000, translateYUm: 6_000, scaleXPermille: 1000, scaleYPermille: 1000, rotationMilliDegrees: 0 }
  }]
};
const assets: Record<string, ConfigAsset> = {
  font: { assetVersionId: "font", kind: "font", contentType: "font/woff2", url: "https://api.example/font" }
};

describe("createLiveArtworkSvg", () => {
  it("uses the canonical renderer for live scene updates", () => {
    const initial = createLiveArtworkSvg(scene, assets);
    const changed: SceneGraph = structuredClone(scene);
    const text = changed.layers[0];
    if (text?.type !== "text") throw new Error("Invalid fixture");
    text.text = "Grace";
    text.transform.rotationMilliDegrees = 15_000;

    expect(initial).toContain(">Ada</tspan>");
    expect(createLiveArtworkSvg(changed, assets)).toContain('rotate(15)');
    expect(createLiveArtworkSvg(changed, assets)).toContain(">Grace</tspan>");
  });

  it("falls back without breaking interaction when an asset is unavailable", () => {
    expect(createLiveArtworkSvg(scene, {})).toBeNull();
  });
});
