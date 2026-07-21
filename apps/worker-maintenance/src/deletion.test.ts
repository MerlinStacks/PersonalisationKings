import { describe, expect, it } from "vitest";
import { jsonContainsExact } from "./deletion";

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
