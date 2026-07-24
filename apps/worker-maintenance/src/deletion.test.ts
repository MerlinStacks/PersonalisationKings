import { describe, expect, it } from "vitest";
import { deletionPlanKeysAreSafe, jsonContainsExact } from "./deletion";

describe("jsonContainsExact", () => {
  const targets = new Set(["asset-version-123"]);

  it("finds exact scene, customer input, and snapshot references", () => {
    expect(jsonContainsExact({ layers: [{ assetVersionId: "asset-version-123" }] }, targets)).toBe(true);
    expect(jsonContainsExact({ image_asset_version_id: "asset-version-123" }, targets)).toBe(true);
    expect(jsonContainsExact({ renderSpec: { layers: [{ assetVersionId: "asset-version-123" }] } }, targets)).toBe(true);
  });

  it("does not match IDs by substring or object keys", () => {
    expect(jsonContainsExact({ value: "asset-version-1234" }, targets)).toBe(false);
    expect(jsonContainsExact({ "asset-version-123": "unrelated" }, targets)).toBe(false);
  });
});

describe("deletionPlanKeysAreSafe", () => {
  it("allows only customer-erasure classes belonging to the claimed merchant", () => {
    expect(deletionPlanKeysAreSafe([
      "draft_customisation_asset/merchant-1/upload-1",
      "preview_derivative/merchant-1/preview-1"
    ], "merchant-1")).toBe(true);
    expect(deletionPlanKeysAreSafe(["draft_customisation_asset/merchant-2/upload-1"], "merchant-1")).toBe(false);
    expect(deletionPlanKeysAreSafe(["production_artifact/merchant-1/artifact-1"], "merchant-1")).toBe(false);
    expect(deletionPlanKeysAreSafe(["draft_customisation_asset/merchant-1/folder/upload-1"], "merchant-1")).toBe(false);
  });
});
