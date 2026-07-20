import { describe, expect, it } from "vitest";
import { customiserConfigMatchesScene, customiserConfigSchema, defaultCustomiserConfig, sceneGraphSchema, type SceneGraph } from "./index";

describe("sceneGraphSchema", () => {
  it("accepts a valid micrometre-based text scene", () => {
    const result = sceneGraphSchema.safeParse({
      schemaVersion: "scene-graph.v1",
      coordinateSystem: "micrometres",
      printArea: { widthUm: 100000, heightUm: 70000 },
      layers: [
        {
          id: "text-1",
          type: "text",
          name: "Name",
          transform: { translateXUm: 0, translateYUm: 0, scaleXPermille: 1000, scaleYPermille: 1000, rotationMilliDegrees: 0 },
          text: "Hello",
          fontAssetVersionId: "font-1",
          fontSizeUm: 8000,
          fill: "#17201a",
          opacityPermille: 1000
        }
      ]
    });

    expect(result.success).toBe(true);
  });

  it("rejects CSS pixel coordinate systems", () => {
    const result = sceneGraphSchema.safeParse({
      schemaVersion: "scene-graph.v1",
      coordinateSystem: "pixels",
      printArea: { widthUm: 100000, heightUm: 70000 },
      layers: []
    });

    expect(result.success).toBe(false);
  });

  it.each<[string, { printArea?: { widthUm: number; heightUm: number }; fontSizeUm?: number }]>([
    ["print width", { printArea: { widthUm: 0, heightUm: 70000 } }],
    ["print height", { printArea: { widthUm: 100000, heightUm: 0 } }],
    ["font size", { fontSizeUm: 0 }]
  ])("rejects non-positive %s", (_name, override) => {
    const layer = {
      id: "text-1",
      type: "text",
      name: "Name",
      transform: { translateXUm: 0, translateYUm: 0 },
      text: "Hello",
      fontAssetVersionId: "font-1",
      fontSizeUm: 8000,
      fill: "#17201a",
      ...(override.fontSizeUm === undefined ? {} : { fontSizeUm: override.fontSizeUm })
    };
    const result = sceneGraphSchema.safeParse({
      schemaVersion: "scene-graph.v1",
      coordinateSystem: "micrometres",
      printArea: override.printArea ?? { widthUm: 100000, heightUm: 70000 },
      layers: [layer]
    });

    expect(result.success).toBe(false);
  });

  it("rejects non-positive image dimensions", () => {
    const result = sceneGraphSchema.safeParse({
      schemaVersion: "scene-graph.v1",
      coordinateSystem: "micrometres",
      printArea: { widthUm: 100000, heightUm: 70000 },
      layers: [{
        id: "image-1",
        type: "image",
        name: "Photo",
        transform: { translateXUm: 0, translateYUm: 0 },
        assetVersionId: "asset-1",
        widthUm: 0,
        heightUm: -1
      }]
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate layer IDs", () => {
    const textLayer = {
      id: "duplicate",
      type: "text",
      name: "Name",
      transform: { translateXUm: 0, translateYUm: 0 },
      text: "Hello",
      fontAssetVersionId: "font-1",
      fontSizeUm: 8000,
      fill: "#17201a"
    };
    const result = sceneGraphSchema.safeParse({
      schemaVersion: "scene-graph.v1",
      coordinateSystem: "micrometres",
      printArea: { widthUm: 100000, heightUm: 70000 },
      layers: [textLayer, { ...textLayer, name: "Second name" }]
    });

    expect(result.success).toBe(false);
  });
});

describe("customiserConfigSchema", () => {
  const scene: SceneGraph = {
    schemaVersion: "scene-graph.v1",
    coordinateSystem: "micrometres",
    printArea: { widthUm: 100000, heightUm: 70000 },
    layers: [{
      id: "text-1",
      type: "text",
      name: "Name",
      transform: { translateXUm: 0, translateYUm: 0, scaleXPermille: 1000, scaleYPermille: 1000, rotationMilliDegrees: 0 },
      text: "Hello",
      fontAssetVersionId: "font-1",
      fontSizeUm: 8000,
      fill: "#17201a",
      opacityPermille: 1000
    }]
  };

  it("creates a valid legacy-compatible config from a scene", () => {
    const config = defaultCustomiserConfig(scene);
    expect(customiserConfigSchema.safeParse(config).success).toBe(true);
    expect(customiserConfigMatchesScene(config, scene)).toBe(true);
  });

  it("rejects rules for missing layers and defaults outside approved colours", () => {
    const config = defaultCustomiserConfig(scene);
    expect(customiserConfigMatchesScene({ ...config, layers: [{ ...config.layers[0], layerId: "missing" }] }, scene)).toBe(false);
    const textRule = config.layers[0];
    if (textRule?.type !== "text") throw new Error("Invalid fixture");
    expect(customiserConfigMatchesScene({ ...config, layers: [{ ...textRule, allowedColours: ["#ffffff"] }] }, scene)).toBe(false);
  });

  it("rejects duplicate layer rules and inverted font-size limits", () => {
    const rule = defaultCustomiserConfig(scene).layers[0];
    if (!rule || rule.type !== "text") throw new Error("Invalid fixture");
    expect(customiserConfigSchema.safeParse({
      schemaVersion: "customiser-config.v1",
      layers: [rule, { ...rule, minimumFontSizeUm: 9000, maximumFontSizeUm: 8000 }]
    }).success).toBe(false);
  });
});
