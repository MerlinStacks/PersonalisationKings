import { beforeEach, describe, expect, it } from "vitest";
import { clearRateLimitsForTests, consumeRateLimit } from "./rate-limit";

describe("consumeRateLimit", () => {
  beforeEach(clearRateLimitsForTests);

  it("enforces a fixed window and resets after expiry", () => {
    expect(consumeRateLimit("client", 2, 1000, 100).allowed).toBe(true);
    expect(consumeRateLimit("client", 2, 1000, 200).allowed).toBe(true);
    expect(consumeRateLimit("client", 2, 1000, 300)).toMatchObject({ allowed: false, retryAfterSeconds: 1 });
    expect(consumeRateLimit("client", 2, 1000, 1100).allowed).toBe(true);
  });

  it("isolates independent client keys", () => {
    consumeRateLimit("one", 1, 1000, 0);
    expect(consumeRateLimit("one", 1, 1000, 1).allowed).toBe(false);
    expect(consumeRateLimit("two", 1, 1000, 1).allowed).toBe(true);
  });
});
