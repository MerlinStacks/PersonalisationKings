import { afterEach, describe, expect, it, vi } from "vitest";
import { isSameOrigin } from "./same-origin";

describe("isSameOrigin", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("accepts matching origins regardless of path", () => {
    expect(isSameOrigin("https://admin.example.test/api/staff", "https://admin.example.test")).toBe(true);
  });

  it("uses the configured public webapp origin behind a proxy", () => {
    vi.stubEnv("PK_WEBAPP_URL", "https://admin.example.test");
    expect(isSameOrigin("http://web-admin:3000/api/staff", "https://admin.example.test")).toBe(true);
    expect(isSameOrigin("http://web-admin:3000/api/staff", "http://web-admin:3000")).toBe(false);
  });

  it("rejects missing, malformed, and cross-origin values", () => {
    expect(isSameOrigin("https://admin.example.test/api/staff", null)).toBe(false);
    expect(isSameOrigin("https://admin.example.test/api/staff", "not a URL")).toBe(false);
    expect(isSameOrigin("https://admin.example.test/api/staff", "https://evil.example.test")).toBe(false);
  });
});
