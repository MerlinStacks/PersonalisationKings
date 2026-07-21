import { renderSceneSvg } from "@personalise-kings/design-engine";
import type { SceneGraph } from "@personalise-kings/render-schema";
import type { ConfigAsset } from "./customiser-api";

export function createLiveArtworkSvg(scene: SceneGraph, assets: Record<string, ConfigAsset>) {
  try {
    return renderSceneSvg(scene, Object.values(assets)).content;
  } catch {
    return null;
  }
}
