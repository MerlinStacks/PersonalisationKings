import { describe, expect, it } from "vitest";
import { isSameOrigin } from "./same-origin";

describe("isSameOrigin", () => {
  it("accepts matching origins regardless of path", () => {
    expect(isSameOrigin("https://admin.example.test/api/staff", "https://admin.example.test")).toBe(true);
  });

  it("rejects missing, malformed, and cross-origin values", () => {
    expect(isSameOrigin("https://admin.example.test/api/staff", null)).toBe(false);
    expect(isSameOrigin("https://admin.example.test/api/staff", "not a URL")).toBe(false);
    expect(isSameOrigin("https://admin.example.test/api/staff", "https://evil.example.test")).toBe(false);
  });
});
