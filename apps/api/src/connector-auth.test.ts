import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isValidHmac } from "./connector-auth";

describe("raw-body HMAC", () => {
  it("accepts only a correctly formatted signature over the exact bytes", () => {
    const body = "{\"value\":1}";
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(isValidHmac(signature, body, "secret")).toBe(true);
    expect(isValidHmac(signature, `${body} `, "secret")).toBe(false);
    expect(isValidHmac("sha256=xyz", body, "secret")).toBe(false);
    expect(isValidHmac("", body, "secret")).toBe(false);
  });
});
