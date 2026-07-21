import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedParentOrigin } from "./proxy";

afterEach(() => vi.unstubAllEnvs());

describe("allowedParentOrigin", () => {
  it("accepts exact HTTPS origins", () => {
    expect(allowedParentOrigin("https://shop.example:8443")).toBe("https://shop.example:8443");
  });

  it.each([
    "https://user:pass@shop.example",
    "https://shop.example/path",
    "https://shop.example?query=1",
    "not-a-url"
  ])("rejects a non-origin value: %s", (value) => {
    expect(allowedParentOrigin(value)).toBeNull();
  });

  it("allows HTTP localhost only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(allowedParentOrigin("http://localhost:8080")).toBe("http://localhost:8080");
    vi.stubEnv("NODE_ENV", "production");
    expect(allowedParentOrigin("http://localhost:8080")).toBeNull();
  });
});
