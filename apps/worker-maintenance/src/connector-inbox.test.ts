import { describe, expect, it } from "vitest";
import { InvalidCustomisationReferenceError, InvalidStoredConnectorEventError } from "@personalise-kings/connector-processing";
import { connectorRetryDelayMs, isPermanentConnectorProcessingError } from "./connector-inbox";

describe("connector inbox retry policy", () => {
  it("uses capped exponential backoff", () => {
    expect(connectorRetryDelayMs(1)).toBe(15_000);
    expect(connectorRetryDelayMs(2)).toBe(30_000);
    expect(connectorRetryDelayMs(20)).toBe(15 * 60_000);
  });

  it("fails deterministic envelope and customisation errors permanently", () => {
    expect(isPermanentConnectorProcessingError(new InvalidStoredConnectorEventError())).toBe(true);
    expect(isPermanentConnectorProcessingError(new InvalidCustomisationReferenceError("line-1"))).toBe(true);
    expect(isPermanentConnectorProcessingError(new Error("database unavailable"))).toBe(false);
  });
});
