import { describe, expect, it } from "vitest";
import { isEligibleMissingProof, planDeletionRepair, planProofRepair } from "./reconciliation";

const now = new Date("2026-07-21T12:00:00.000Z");
const stale = new Date("2026-07-21T11:30:00.000Z");
const active = new Date("2026-07-21T11:55:00.000Z");

describe("proof reconciliation planning", () => {
  it("requeues stale and missing claims while attempts remain", () => {
    expect(planProofRepair({ status: "running", attempts: 2, claimedAt: stale }, now, 5)?.status).toBe("queued");
    expect(planProofRepair({ status: "running", attempts: 2, claimedAt: null }, now, 5)?.status).toBe("queued");
  });

  it("fails exhausted work without disturbing active claims", () => {
    expect(planProofRepair({ status: "queued", attempts: 5, claimedAt: null }, now, 5)?.status).toBe("failed");
    expect(planProofRepair({ status: "running", attempts: 5, claimedAt: stale }, now, 5)?.status).toBe("failed");
    expect(planProofRepair({ status: "running", attempts: 2, claimedAt: active }, now, 5)).toBeNull();
  });
});

describe("deletion reconciliation planning", () => {
  it("returns stale processing work to pending without resetting attempts", () => {
    expect(planDeletionRepair({ status: "processing", attempts: 3, claimedAt: stale }, now, 10)).toEqual({
      status: "pending",
      reason: "Recovered stale or missing deletion worker claim"
    });
  });

  it("fails exhausted work and leaves active or terminal states unchanged", () => {
    expect(planDeletionRepair({ status: "pending", attempts: 10, claimedAt: null }, now, 10)?.status).toBe("failed");
    expect(planDeletionRepair({ status: "processing", attempts: 10, claimedAt: stale }, now, 10)?.status).toBe("failed");
    expect(planDeletionRepair({ status: "processing", attempts: 2, claimedAt: active }, now, 10)).toBeNull();
    expect(planDeletionRepair({ status: "live_deleted", attempts: 10, claimedAt: null }, now, 10)).toBeNull();
  });
});

describe("missing proof eligibility", () => {
  const eligible = {
    merchantId: "merchant-1",
    session: { status: "committed" },
    previewAssetVersion: {
      objectKey: "preview_derivative/merchant-1/revision.svg",
      validationStatus: "accepted",
      deletedAt: null,
      contentType: "image/svg+xml",
      widthPx: 1200,
      heightPx: 800
    }
  };

  it("requires a valid tenant-bound immutable SVG preview", () => {
    expect(isEligibleMissingProof(eligible)).toBe(true);
    expect(isEligibleMissingProof({ ...eligible, previewAssetVersion: { ...eligible.previewAssetVersion, objectKey: "preview_derivative/merchant-2/revision.svg" } })).toBe(false);
    expect(isEligibleMissingProof({ ...eligible, previewAssetVersion: { ...eligible.previewAssetVersion, contentType: "image/png" } })).toBe(false);
    expect(isEligibleMissingProof({ ...eligible, previewAssetVersion: { ...eligible.previewAssetVersion, deletedAt: new Date() } })).toBe(false);
  });

  it("does not recreate proof work for archived or cancelled sessions", () => {
    expect(isEligibleMissingProof({ ...eligible, session: { status: "archived" } })).toBe(false);
    expect(isEligibleMissingProof({ ...eligible, session: { status: "cancelled" } })).toBe(false);
  });
});
