import { describe, expect, it } from "vitest";
import { decryptConnectorSecret, encryptConnectorSecret, hashPassword, signAdminSession, signEmbedToken, verifyAdminSession, verifyEmbedToken, verifyPassword } from "./index";

describe("password hashing", () => {
  it("verifies the original password and rejects a different password", async () => {
    const hash = await hashPassword("password123");

    await expect(verifyPassword("password123", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });
});

describe("admin session tokens", () => {
  it("round-trips a valid signed session", () => {
    const token = signAdminSession({
      merchantId: "merchant-1",
      userId: "user-1",
      role: "owner_admin",
      expiresAt: Math.floor(Date.now() / 1000) + 60
    }, "secret");

    expect(verifyAdminSession(token, "secret")?.merchantId).toBe("merchant-1");
  });

  it("rejects tampered sessions", () => {
    const token = signAdminSession({
      merchantId: "merchant-1",
      userId: "user-1",
      role: "owner_admin",
      expiresAt: Math.floor(Date.now() / 1000) + 60
    }, "secret");

    expect(verifyAdminSession(`${token}tampered`, "secret")).toBeNull();
  });

  it("rejects malformed signed payloads without throwing", () => {
    expect(verifyAdminSession("not-json.signature", "secret")).toBeNull();
    expect(verifyAdminSession("a.b.c", "secret")).toBeNull();
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
