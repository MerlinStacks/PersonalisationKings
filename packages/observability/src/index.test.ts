import { describe, expect, it, vi } from "vitest";
import { getOrCreateCorrelationId, logEvent, serializeError } from "./index";

describe("correlation IDs", () => {
  it("keeps bounded printable identifiers and replaces unsafe values", () => {
    expect(getOrCreateCorrelationId(new Headers({ "x-correlation-id": "store-request-123" }))).toBe("store-request-123");
    expect(getOrCreateCorrelationId({ get: () => "bad\nvalue" } as unknown as Headers)).toMatch(/^[0-9a-f-]{36}$/);
    expect(getOrCreateCorrelationId(new Headers({ "x-correlation-id": "x".repeat(129) }))).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("structured logging", () => {
  it("writes one bounded JSON line and serializes errors", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logEvent("error", "worker.failed", { error: new Error("failure\nwith newline"), count: 2n, level: "info", event: "forged" });
    const line = String(output.mock.calls[0]?.[0]);
    const parsed = JSON.parse(line) as { event: string; count: string; error: { message: string } };
    expect(line).not.toContain("\n");
    expect(parsed.event).toBe("worker.failed");
    expect(parsed.count).toBe("2");
    expect(parsed.error.message).toBe("failure?with newline");
    output.mockRestore();
  });

  it("bounds non-error values", () => {
    expect(serializeError("x".repeat(2000)).message).toHaveLength(1000);
  });
});
