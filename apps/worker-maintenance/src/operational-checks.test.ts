import { describe, expect, it } from "vitest";
import { evaluateArtifactAlerts, type ArtifactOperationalMetrics } from "./operational-checks";

const healthy: ArtifactOperationalMetrics = {
  eligibleBacklog: 0,
  oldestOverdueSeconds: 0,
  staleClaims: 0,
  oldestClaimSeconds: 0,
  retryingThreePlus: 0,
  retryingFivePlus: 0,
  indefiniteHoldsOver90Days: 0,
  settingsPresent: true,
  sampleArtifactIds: []
};

describe("artifact operational alert rules", () => {
  it("does not alert for healthy metrics", () => {
    expect(evaluateArtifactAlerts(healthy)).toEqual([]);
  });

  it("uses warning thresholds without alert storms", () => {
    const alerts = evaluateArtifactAlerts({
      ...healthy,
      oldestOverdueSeconds: 901,
      staleClaims: 1,
      oldestClaimSeconds: 1201,
      retryingThreePlus: 1,
      indefiniteHoldsOver90Days: 1,
      sampleArtifactIds: ["artifact-1", "artifact-2"]
    });
    expect(alerts.map((alert) => [alert.rule, alert.severity])).toEqual([
      ["artifact.cleanup_backlog", "warning"],
      ["artifact.cleanup_stale_claim", "warning"],
      ["artifact.cleanup_retries", "warning"],
      ["artifact.indefinite_hold_review", "warning"]
    ]);
  });

  it("escalates critical thresholds", () => {
    const alerts = evaluateArtifactAlerts({
      ...healthy,
      oldestOverdueSeconds: 3601,
      staleClaims: 10,
      oldestClaimSeconds: 2701,
      retryingThreePlus: 1,
      retryingFivePlus: 1
    });
    expect(alerts.every((alert) => alert.severity === "critical")).toBe(true);
  });
});
