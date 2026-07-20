import { defaultCustomiserConfig, type SceneGraph } from "@personalise-kings/render-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commitScene, loadCustomiserConfig } from "./customiser-api";

const scene: SceneGraph = {
  schemaVersion: "scene-graph.v1",
  coordinateSystem: "micrometres",
  printArea: { widthUm: 100000, heightUm: 70000 },
  layers: [{
    id: "text-1",
    type: "text",
    name: "Name",
    transform: { translateXUm: 0, translateYUm: 0, scaleXPermille: 1000, scaleYPermille: 1000, rotationMilliDegrees: 0 },
    text: "Your text",
    fontAssetVersionId: "font-1",
    fontSizeUm: 9000,
    fill: "#17201a",
    opacityPermille: 1000
  }]
};

afterEach(() => vi.unstubAllGlobals());

describe("loadCustomiserConfig", () => {
  it("parses design-authored customiser rules", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      design: {
        name: "Test design",
        scene_graph: scene,
        customiser_config: defaultCustomiserConfig(scene)
      },
      assets: [],
      upload_rules: { maximum_bytes: 20971520, recommended_dpi: 300 }
    })));

    const result = await loadCustomiserConfig(
      { apiUrl: "https://api.example", embedToken: "token" },
      "correlation",
      new AbortController().signal
    );
    expect(result.designName).toBe("Test design");
    expect(result.rules.layers[0]?.layerId).toBe("text-1");
  });

  it("rejects a response without customiser rules", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      design: { name: "Test design", scene_graph: scene },
      assets: []
    })));

    await expect(loadCustomiserConfig(
      { apiUrl: "https://api.example", embedToken: "token" },
      "correlation",
      new AbortController().signal
    )).rejects.toThrow("invalid");
  });

  it("requests and verifies a saved customisation revision", async () => {
    const reference = "pk_123e4567-e89b-42d3-a456-426614174000";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      design: { name: "Test design", scene_graph: scene, customiser_config: defaultCustomiserConfig(scene) },
      resumed_customisation: { customisation_reference: reference, revision: 2 },
      assets: []
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadCustomiserConfig(
      { apiUrl: "https://api.example", embedToken: "token", customisationReference: reference },
      "correlation",
      new AbortController().signal
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-pk-customisation-reference")).toBe(reference);
    expect(result.resumedRevision).toBe(2);
  });
});

describe("commitScene", () => {
  it("sends the base reference and accepts the next immutable revision", async () => {
    const reference = "pk_123e4567-e89b-42d3-a456-426614174000";
    const nextReference = "pk_123e4567-e89b-42d3-a456-426614174001";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      customisation_reference: nextReference,
      revision: 3,
      resumed: true
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await commitScene(scene, {
      apiUrl: "https://api.example",
      embedToken: "token",
      customisationReference: reference
    }, "correlation");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.base_customisation_reference).toBe(reference);
    expect(result).toEqual({ customisationReference: nextReference, revision: 3, resumed: true });
  });
});
