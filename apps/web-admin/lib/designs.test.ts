import { defaultCustomiserConfig, type SceneGraph } from "@personalise-kings/render-schema";
import { describe, expect, it } from "vitest";
import { designVersionInputSchema } from "./designs";

const scene: SceneGraph = {
  schemaVersion: "scene-graph.v1",
  coordinateSystem: "micrometres",
  printArea: { widthUm: 100000, heightUm: 70000 },
  layers: [{
    id: "text-1",
    type: "text",
    name: "Name",
    transform: { translateXUm: 10000, translateYUm: 20000, scaleXPermille: 1000, scaleYPermille: 1000, rotationMilliDegrees: 0 },
    text: "Your text",
    fontAssetVersionId: "font-1",
    fontSizeUm: 9000,
    fill: "#17201a",
    opacityPermille: 1000
  }]
};

describe("designVersionInputSchema", () => {
  it("accepts matching scene and customiser rules", () => {
    expect(designVersionInputSchema.safeParse({
      sceneGraph: scene,
      customiserConfig: defaultCustomiserConfig(scene)
    }).success).toBe(true);
  });

  it("rejects rules bound to a missing scene layer", () => {
    const config = defaultCustomiserConfig(scene);
    config.layers[0].layerId = "missing";
    expect(designVersionInputSchema.safeParse({ sceneGraph: scene, customiserConfig: config }).success).toBe(false);
  });
});
