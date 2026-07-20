import type { SceneGraph } from "@personalise-kings/render-schema";
import { describe, expect, it } from "vitest";
import type { ConfigAsset } from "../lib/customiser-api";
import { imageQualityWarning, nudgePosition, positionFromPointerDelta, sceneSummary, transformFromTwoPointers } from "../lib/scene-utils";

const imageLayer: Extract<SceneGraph["layers"][number], { type: "image" }> = {
  id: "image-1",
  type: "image",
  name: "Photo",
  transform: { translateXUm: 0, translateYUm: 0, scaleXPermille: 1000, scaleYPermille: 1000, rotationMilliDegrees: 0 },
  assetVersionId: "image-version-1",
  widthUm: 25_400,
  heightUm: 25_400,
  opacityPermille: 1000
};

function image(widthPx: number, heightPx: number): ConfigAsset {
  return {
    assetVersionId: "image-version-1",
    kind: "upload",
    contentType: "image/png",
    widthPx,
    heightPx,
    url: "https://assets.example/image.png"
  };
}

describe("imageQualityWarning", () => {
  it("warns without blocking a low-resolution image", () => {
    expect(imageQualityWarning(imageLayer, image(150, 150), 300)).toContain("150 DPI");
  });

  it("accepts an image at the recommended resolution", () => {
    expect(imageQualityWarning(imageLayer, image(300, 300), 300)).toBeNull();
  });
});

it("provides a text alternative for the scene", () => {
  const scene: SceneGraph = {
    schemaVersion: "scene-graph.v1",
    coordinateSystem: "micrometres",
    printArea: { widthUm: 100_000, heightUm: 70_000 },
    layers: [{
      id: "text-1",
      type: "text",
      name: "Name",
      transform: { translateXUm: 0, translateYUm: 0, scaleXPermille: 1000, scaleYPermille: 1000, rotationMilliDegrees: 0 },
      text: "Ada",
      fontAssetVersionId: "font-1",
      fontSizeUm: 8_000,
      fill: "#17201a",
      opacityPermille: 1000
    }, imageLayer]
  };

  expect(sceneSummary(scene)).toBe("Name: Ada. Photo: image selected");
});

describe("physical layer movement", () => {
  const printArea = { widthUm: 100_000, heightUm: 50_000 };

  it("maps viewport pointer movement into micrometres", () => {
    expect(positionFromPointerDelta({ xUm: 10_000, yUm: 5_000 }, 50, -25, 500, 250, printArea))
      .toEqual({ xUm: 20_000, yUm: 0 });
  });

  it("uses deterministic keyboard steps and clamps extreme movement", () => {
    expect(nudgePosition({ xUm: 0, yUm: 0 }, "right", 500, printArea)).toEqual({ xUm: 500, yUm: 0 });
    expect(positionFromPointerDelta({ xUm: 0, yUm: 0 }, 10_000, -10_000, 100, 100, printArea))
      .toEqual({ xUm: 200_000, yUm: -50_000 });
  });
});

describe("two-pointer transforms", () => {
  const initial = { scaleXPermille: 1000, scaleYPermille: 800, rotationMilliDegrees: 0 };

  it("derives uniform scale and rotation from pointer distance and angle", () => {
    expect(transformFromTwoPointers(
      { x: 0, y: 0 }, { x: 10, y: 0 },
      { x: 0, y: 0 }, { x: 0, y: 20 },
      initial, true, true
    )).toEqual({ scaleXPermille: 2000, scaleYPermille: 1600, rotationMilliDegrees: 90000 });
  });

  it("honours transform locks and clamps scale", () => {
    expect(transformFromTwoPointers(
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 0, y: 0 }, { x: 100, y: 0 },
      initial, false, false
    )).toEqual(initial);
    expect(transformFromTwoPointers(
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 0, y: 0 }, { x: 100, y: 0 },
      initial, true, false
    ).scaleXPermille).toBe(5000);
  });
});
