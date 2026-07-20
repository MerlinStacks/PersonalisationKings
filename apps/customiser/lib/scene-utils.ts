import type { SceneGraph } from "@personalise-kings/render-schema";
import type { ConfigAsset } from "./customiser-api";

type ImageLayer = Extract<SceneGraph["layers"][number], { type: "image" }>;

export interface ScenePosition {
  xUm: number;
  yUm: number;
}

export interface GesturePoint {
  x: number;
  y: number;
}

export interface GestureTransform {
  scaleXPermille: number;
  scaleYPermille: number;
  rotationMilliDegrees: number;
}

export function sceneSummary(scene: SceneGraph) {
  const details = scene.layers.map((layer) => layer.type === "text"
    ? `${layer.name}: ${layer.text || "blank"}`
    : `${layer.name}: image selected`);
  return details.join(". ");
}

export function imageQualityWarning(layer: ImageLayer, asset: ConfigAsset | undefined, recommendedDpi: number) {
  if (!asset?.widthPx || !asset.heightPx) return null;
  const widthInches = layer.widthUm * layer.transform.scaleXPermille / 1000 / 25_400;
  const heightInches = layer.heightUm * layer.transform.scaleYPermille / 1000 / 25_400;
  const estimatedDpi = Math.floor(Math.min(asset.widthPx / widthInches, asset.heightPx / heightInches));
  return estimatedDpi < recommendedDpi
    ? `This image is approximately ${estimatedDpi} DPI at the selected size. ${recommendedDpi} DPI is recommended for best print quality.`
    : null;
}

export function positionFromPointerDelta(
  start: ScenePosition,
  deltaXpx: number,
  deltaYpx: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
  printArea: SceneGraph["printArea"]
) {
  if (viewportWidthPx <= 0 || viewportHeightPx <= 0) return start;
  return constrainPosition({
    xUm: start.xUm + Math.round(deltaXpx / viewportWidthPx * printArea.widthUm),
    yUm: start.yUm + Math.round(deltaYpx / viewportHeightPx * printArea.heightUm)
  }, printArea);
}

export function nudgePosition(
  position: ScenePosition,
  direction: "left" | "right" | "up" | "down",
  stepUm: number,
  printArea: SceneGraph["printArea"]
) {
  const delta = Math.max(1, Math.round(stepUm));
  return constrainPosition({
    xUm: position.xUm + (direction === "left" ? -delta : direction === "right" ? delta : 0),
    yUm: position.yUm + (direction === "up" ? -delta : direction === "down" ? delta : 0)
  }, printArea);
}

export function transformFromTwoPointers(
  startFirst: GesturePoint,
  startSecond: GesturePoint,
  currentFirst: GesturePoint,
  currentSecond: GesturePoint,
  initial: GestureTransform,
  allowScale: boolean,
  allowRotation: boolean
): GestureTransform {
  const startDistance = distance(startFirst, startSecond);
  const currentDistance = distance(currentFirst, currentSecond);
  const ratio = startDistance > 0 ? currentDistance / startDistance : 1;
  const angleDelta = normaliseDegrees(angle(currentFirst, currentSecond) - angle(startFirst, startSecond));

  return {
    scaleXPermille: allowScale ? clampScale(Math.round(initial.scaleXPermille * ratio)) : initial.scaleXPermille,
    scaleYPermille: allowScale ? clampScale(Math.round(initial.scaleYPermille * ratio)) : initial.scaleYPermille,
    rotationMilliDegrees: allowRotation
      ? Math.min(360_000, Math.max(-360_000, initial.rotationMilliDegrees + Math.round(angleDelta * 1000)))
      : initial.rotationMilliDegrees
  };
}

function constrainPosition(position: ScenePosition, printArea: SceneGraph["printArea"]): ScenePosition {
  return {
    xUm: Math.min(printArea.widthUm * 2, Math.max(-printArea.widthUm, position.xUm)),
    yUm: Math.min(printArea.heightUm * 2, Math.max(-printArea.heightUm, position.yUm))
  };
}

function distance(first: GesturePoint, second: GesturePoint) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function angle(first: GesturePoint, second: GesturePoint) {
  return Math.atan2(second.y - first.y, second.x - first.x) * 180 / Math.PI;
}

function normaliseDegrees(value: number) {
  return ((value + 540) % 360) - 180;
}

function clampScale(value: number) {
  return Math.min(5000, Math.max(100, value));
}
