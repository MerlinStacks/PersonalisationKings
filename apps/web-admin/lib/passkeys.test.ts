import { describe, expect, it } from "vitest";
import { matchesPasskeyUserHandle, passkeyRelyingParty, passkeyUserId, webAuthnResponseSchema } from "./passkeys";

describe("passkey configuration", () => {
  it("derives the relying party from the exact admin origin", () => {
    expect(passkeyRelyingParty({ NODE_ENV: "production", PK_WEBAPP_URL: "https://admin.example.com" }))
      .toEqual({ rpID: "admin.example.com", origin: "https://admin.example.com", rpName: "PersonaliseKings" });
  });

  it.each(["http://admin.example.com", "https://user:pass@admin.example.com", "https://admin.example.com/path"])("rejects an unsafe origin: %s", (url) => {
    expect(() => passkeyRelyingParty({ NODE_ENV: "production", PK_WEBAPP_URL: url })).toThrow();
  });

  it("uses a tenant-bound WebAuthn user identity", () => {
    const userId = passkeyUserId("merchant-1", "user-1");
    expect(new TextDecoder().decode(userId)).toBe("merchant-1:user-1");
    expect(matchesPasskeyUserHandle(Buffer.from(userId).toString("base64url"), "merchant-1", "user-1")).toBe(true);
    expect(matchesPasskeyUserHandle(Buffer.from(userId).toString("base64url"), "merchant-2", "user-1")).toBe(false);
    expect(matchesPasskeyUserHandle(undefined, "merchant-1", "user-1")).toBe(true);
  });

  it("bounds credential identifiers before verification", () => {
    expect(webAuthnResponseSchema.safeParse({ id: "credential_1", rawId: "credential_1", type: "public-key", response: {}, clientExtensionResults: {} }).success).toBe(true);
    expect(webAuthnResponseSchema.safeParse({ id: "not valid", rawId: "x", type: "public-key", response: {} }).success).toBe(false);
  });
});
