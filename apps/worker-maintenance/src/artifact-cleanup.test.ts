import { describe, expect, it } from "vitest";
import { artifactBytesAvailable, artifactRetentionHeld } from "./artifact-cleanup";

describe("artifact byte availability", () => {
  it("allows downloads only before cleanup claims or deletion", () => {
    expect(artifactBytesAvailable({ bytesDeletedAt: null, cleanupClaimedAt: null })).toBe(true);
    expect(artifactBytesAvailable({ bytesDeletedAt: null, cleanupClaimedAt: new Date() })).toBe(false);
    expect(artifactBytesAvailable({ bytesDeletedAt: new Date(), cleanupClaimedAt: null })).toBe(false);
  });
});

describe("artifact retention holds", () => {
  const now = new Date("2026-07-21T12:00:00.000Z");

  it("supports indefinite and future holds but expires time-bounded holds", () => {
    expect(artifactRetentionHeld({ retentionHoldAt: now, retentionHoldUntil: null }, now)).toBe(true);
    expect(artifactRetentionHeld({ retentionHoldAt: now, retentionHoldUntil: new Date("2026-07-22T12:00:00.000Z") }, now)).toBe(true);
    expect(artifactRetentionHeld({ retentionHoldAt: now, retentionHoldUntil: new Date("2026-07-20T12:00:00.000Z") }, now)).toBe(false);
    expect(artifactRetentionHeld({ retentionHoldAt: null, retentionHoldUntil: null }, now)).toBe(false);
  });
});
