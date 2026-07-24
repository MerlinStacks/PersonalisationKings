import { describe, expect, it } from "vitest";
import { consumePasskeyRateLimit } from "./passkey-rate-limit";

describe("passkey rate limiting", () => {
  it("bounds registration ceremonies by source and user", () => {
    const request = new Request("https://admin.example.com", { headers: { "x-real-ip": "192.0.2.44" } });
    const now = 1_000_000;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(consumePasskeyRateLimit(request, "registration_options", "rate-test-user", now)).toBe(0);
    }
    expect(consumePasskeyRateLimit(request, "registration_options", "rate-test-user", now)).toBeGreaterThan(0);
    expect(consumePasskeyRateLimit(request, "registration_options", "rate-test-user", now + 60_001)).toBe(0);
  });
});
