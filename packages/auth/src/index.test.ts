import { describe, expect, it } from "vitest";
import { decryptConnectorSecret, decryptStoreWebhookSecret, decryptTotpSecret, encryptConnectorSecret, encryptStoreWebhookSecret, encryptTotpSecret, generateRecoveryCodes, generateSessionToken, hashPassword, hashRecoveryCode, hashSessionToken, normalizeRecoveryCode, roleCan, signEmbedToken, verifyEmbedToken, verifyPassword, verifyTotp } from "./index";

describe("password hashing", () => {
  it("verifies the original password and rejects a different password", async () => {
    const hash = await hashPassword("password123");

    await expect(verifyPassword("password123", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });
});

describe("staff permissions", () => {
  it("limits design and asset mutation to owners and designers", () => {
    expect(roleCan("owner_admin", "manage_design")).toBe(true);
    expect(roleCan("designer", "manage_design")).toBe(true);
    expect(roleCan("production_operator", "manage_design")).toBe(false);
    expect(roleCan("support", "manage_design")).toBe(false);
    expect(roleCan("auditor", "manage_design")).toBe(false);
  });

  it("allows owners and production operators to inspect order artwork", () => {
    expect(roleCan("owner_admin", "view_order")).toBe(true);
    expect(roleCan("owner_admin", "view_customisation")).toBe(true);
    expect(roleCan("production_operator", "view_customisation")).toBe(true);
  });

  it("limits artifact retention holds to owners and production operators", () => {
    expect(roleCan("owner_admin", "manage_artifact_retention")).toBe(true);
    expect(roleCan("production_operator", "manage_artifact_retention")).toBe(true);
    expect(roleCan("designer", "manage_artifact_retention")).toBe(false);
    expect(roleCan("support", "manage_artifact_retention")).toBe(false);
    expect(roleCan("auditor", "manage_artifact_retention")).toBe(false);
  });

  it("allows auditors to view but not acknowledge operational alerts", () => {
    expect(roleCan("owner_admin", "acknowledge_operational_alert")).toBe(true);
    expect(roleCan("production_operator", "acknowledge_operational_alert")).toBe(true);
    expect(roleCan("auditor", "view_operations")).toBe(true);
    expect(roleCan("auditor", "acknowledge_operational_alert")).toBe(false);
  });
});

describe("database session and MFA primitives", () => {
  it("generates opaque session tokens and deterministic hashes", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it("verifies RFC-compatible six-digit TOTP values and returns the replay step", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(verifyTotp("287082", secret, 59_000, 0)).toBe(1n);
    expect(verifyTotp("287082", secret, 90_000, 0)).toBeNull();
    expect(verifyTotp("not-six", secret, 59_000, 0)).toBeNull();
  });

  it("encrypts TOTP secrets for one staff identity only", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptTotpSecret("SECRET", key, "user-1");
    expect(encrypted).not.toContain("SECRET");
    expect(decryptTotpSecret(encrypted, key, "user-1")).toBe("SECRET");
    expect(decryptTotpSecret(encrypted, key, "user-2")).toBeNull();
  });

  it("creates high-entropy normalizable recovery codes with peppered hashes", () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(normalizeRecoveryCode(codes[0]!)).toMatch(/^[A-F0-9]{32}$/);
    expect(hashRecoveryCode(codes[0]!, "pepper")).toBe(hashRecoveryCode(normalizeRecoveryCode(codes[0]!), "pepper"));
  });

  it("binds webhook secrets to one store and key while reading legacy ciphertext", () => {
    const wrappingKey = Buffer.alloc(32, 9).toString("base64");
    const encrypted = encryptStoreWebhookSecret("webhook-secret", wrappingKey, "store-1", "key-1");
    expect(decryptStoreWebhookSecret(encrypted, wrappingKey, "store-1", "key-1")).toBe("webhook-secret");
    expect(decryptStoreWebhookSecret(encrypted, wrappingKey, "store-1", "key-2")).toBeNull();
    const legacy = encryptConnectorSecret("legacy-secret", wrappingKey);
    expect(decryptStoreWebhookSecret(legacy, wrappingKey, "store-1", "legacy-key")).toBe("legacy-secret");
  });
});

describe("embed tokens", () => {
  it("binds store, origin, product, variant, design, and expiry", () => {
    const token = signEmbedToken({
      storeId: "store-1",
      allowedOrigin: "https://shop.example",
      externalProductId: "product-1",
      externalVariantId: "variant-1",
      designId: "design-1",
      designVersionId: "design-version-1",
      expiresAt: Math.floor(Date.now() / 1000) + 60
    }, "secret");

    const payload = verifyEmbedToken(token, "secret");
    expect(payload).toMatchObject({ storeId: "store-1", externalVariantId: "variant-1", designId: "design-1" });
  });

  it("rejects expired tokens", () => {
    const token = signEmbedToken({
      storeId: "store-1",
      allowedOrigin: "https://shop.example",
      externalProductId: "product-1",
      designId: "design-1",
      designVersionId: "design-version-1",
      expiresAt: Math.floor(Date.now() / 1000) - 1
    }, "secret");

    expect(verifyEmbedToken(token, "secret")).toBeNull();
  });

  it("rejects malformed payloads and non-origin URLs", () => {
    const token = signEmbedToken({
      storeId: "store-1",
      allowedOrigin: "https://shop.example/path",
      externalProductId: "product-1",
      designId: "design-1",
      designVersionId: "design-version-1",
      expiresAt: Math.floor(Date.now() / 1000) + 60
    }, "secret");

    expect(verifyEmbedToken(token, "secret")).toBeNull();
    expect(verifyEmbedToken("a.b.c", "secret")).toBeNull();
  });
});

describe("connector secret encryption", () => {
  const key = Buffer.alloc(32, 7).toString("base64");

  it("round-trips an encrypted secret and rejects the wrong key", () => {
    const encrypted = encryptConnectorSecret("store-secret", key);
    expect(encrypted).not.toContain("store-secret");
    expect(decryptConnectorSecret(encrypted, key)).toBe("store-secret");
    expect(decryptConnectorSecret(encrypted, Buffer.alloc(32, 8).toString("base64"))).toBeNull();
  });
});
