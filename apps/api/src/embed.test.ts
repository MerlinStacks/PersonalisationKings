import { defaultCustomiserConfig, type SceneGraph } from "@personalise-kings/render-schema";
import { describe, expect, it } from "vitest";
import { chooseProductMapping, revisionCanResume, sceneMatchesDesign } from "./embed";

const template: SceneGraph = {
  schemaVersion: "scene-graph.v1",
  coordinateSystem: "micrometres",
  printArea: { widthUm: 100_000, heightUm: 70_000 },
  layers: [
    {
      id: "text-1",
      type: "text",
      name: "Customer name",
      transform: { translateXUm: 10_000, translateYUm: 20_000, scaleXPermille: 1000, scaleYPermille: 1000, rotationMilliDegrees: 0 },
      text: "Your text",
      fontAssetVersionId: "font-1",
      fontSizeUm: 8_000,
      fill: "#17201a",
      opacityPermille: 1000
    },
    {
      id: "image-1",
      type: "image",
      name: "Customer photo",
      transform: { translateXUm: 40_000, translateYUm: 10_000, scaleXPermille: 1000, scaleYPermille: 1000, rotationMilliDegrees: 0 },
      assetVersionId: "placeholder-image",
      widthUm: 30_000,
      heightUm: 30_000,
      opacityPermille: 1000
    }
  ]
};

describe("sceneMatchesDesign", () => {
  it("allows constrained customer text, colour, geometry, and image replacement", () => {
    const scene: SceneGraph = structuredClone(template);
    const text = scene.layers[0];
    const image = scene.layers[1];
    if (text?.type !== "text" || image?.type !== "image") throw new Error("Invalid fixture");
    text.text = "Ada";
    text.fill = "#245f8f";
    text.fontSizeUm = 9_500;
    text.transform.translateXUm = 12_500;
    image.assetVersionId = "customer-upload";
    image.transform.rotationMilliDegrees = 15_000;

    const config = defaultCustomiserConfig(template);
    const textRule = config.layers[0];
    if (textRule?.type !== "text") throw new Error("Invalid fixture");
    textRule.allowedColours.push("#245f8f");
    expect(sceneMatchesDesign(scene, template, config)).toBe(true);
  });

  it("enforces design-authored colour and transform locks", () => {
    const config = defaultCustomiserConfig(template);
    const textRule = config.layers[0];
    if (textRule?.type !== "text") throw new Error("Invalid fixture");
    textRule.transform.position = false;
    const scene: SceneGraph = structuredClone(template);
    const text = scene.layers[0];
    if (text?.type !== "text") throw new Error("Invalid fixture");
    text.fill = "#ffffff";
    expect(sceneMatchesDesign(scene, template, config)).toBe(false);
    text.fill = template.layers[0]?.type === "text" ? template.layers[0].fill : "#17201a";
    text.transform.translateXUm += 1000;
    expect(sceneMatchesDesign(scene, template, config)).toBe(false);
  });

  it.each<[string, (scene: SceneGraph) => void]>([
    ["font", (scene: SceneGraph) => { const layer = scene.layers[0]; if (layer?.type === "text") layer.fontAssetVersionId = "unapproved-font"; }],
    ["layer name", (scene: SceneGraph) => { const layer = scene.layers[0]; if (layer) layer.name = "Changed"; }],
    ["image dimensions", (scene: SceneGraph) => { const layer = scene.layers[1]; if (layer?.type === "image") layer.widthUm += 1; }],
    ["opacity", (scene: SceneGraph) => { const layer = scene.layers[0]; if (layer) layer.opacityPermille = 500; }],
    ["layer order", (scene: SceneGraph) => { scene.layers.reverse(); }],
    ["oversized text", (scene: SceneGraph) => { const layer = scene.layers[0]; if (layer?.type === "text") layer.text = "x".repeat(201); }],
    ["out-of-bounds scale", (scene: SceneGraph) => { const layer = scene.layers[0]; if (layer) layer.transform.scaleXPermille = 5001; }]
  ])("rejects changes to template-controlled %s", (_name, mutate) => {
    const scene: SceneGraph = structuredClone(template);
    mutate(scene);
    expect(sceneMatchesDesign(scene, template)).toBe(false);
  });
});

describe("revisionCanResume", () => {
  const context = {
    token: {
      externalProductId: "product-1",
      externalVariantId: "variant-1",
      designId: "design-1",
      designVersionId: "design-version-1"
    },
    store: { id: "store-1", merchantId: "merchant-1" }
  };
  const revision = {
    merchantId: "merchant-1",
    designVersionId: "design-version-1",
    sessionStoreId: "store-1",
    sessionDesignId: "design-1",
    externalProductId: "product-1",
    externalVariantId: "variant-1",
    sessionStatus: "committed",
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    latestRevisionId: "revision-2",
    revisionId: "revision-2",
    hasLineItems: false
  };
  const now = new Date("2029-01-01T00:00:00.000Z");

  it("allows only the latest unexpired matching cart revision", () => {
    expect(revisionCanResume(revision, context, now)).toBe(true);
  });

  it.each([
    ["another merchant", { merchantId: "merchant-2" }],
    ["another product", { externalProductId: "product-2" }],
    ["another variant", { externalVariantId: "variant-2" }],
    ["an old design version", { designVersionId: "design-version-0" }],
    ["an older revision", { revisionId: "revision-1" }],
    ["an ordered session", { sessionStatus: "ordered" }],
    ["an order-linked revision", { hasLineItems: true }],
    ["an expired session", { expiresAt: new Date("2028-01-01T00:00:00.000Z") }]
  ])("rejects %s", (_name, override) => {
    expect(revisionCanResume({ ...revision, ...override }, context, now)).toBe(false);
  });
});

describe("chooseProductMapping", () => {
  const fallback = { id: "fallback", externalVariantId: null, active: true };
  const exact = { id: "exact", externalVariantId: "variant-1", active: true };

  it("prefers an exact variation over the all-variants fallback", () => {
    expect(chooseProductMapping([fallback, exact], "variant-1")?.id).toBe("exact");
  });

  it("uses the fallback for an otherwise unmapped variation", () => {
    expect(chooseProductMapping([fallback, exact], "variant-2")?.id).toBe("fallback");
  });

  it("lets an inactive exact mapping explicitly block the fallback", () => {
    expect(chooseProductMapping([fallback, { ...exact, active: false }], "variant-1")).toBeNull();
  });
});
