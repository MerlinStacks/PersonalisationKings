import { describe, expect, it } from "vitest";
import {
  buildWooCommerceAuthorizeUrl,
  decryptWooCommerceCredentials,
  encryptWooCommerceCredentials,
  isPublicIpAddress,
  normalizeWooCommerceStoreUrl,
  resolveWooCommerceStore
} from "./woocommerce";

describe("WooCommerce store URL security", () => {
  it("normalizes a public HTTPS origin and preserves a WordPress subdirectory", () => {
    expect(normalizeWooCommerceStoreUrl(" https://Shop.Example.com/wordpress/// "))
      .toBe("https://shop.example.com/wordpress");
  });

  it("rejects insecure, credential-bearing, and local URLs", () => {
    expect(() => normalizeWooCommerceStoreUrl("http://shop.example.com")).toThrow("HTTPS");
    expect(() => normalizeWooCommerceStoreUrl("https://user:pass@shop.example.com")).toThrow("credentials");
    expect(() => normalizeWooCommerceStoreUrl("https://shop.example.com?target=internal")).toThrow("query string");
    expect(() => normalizeWooCommerceStoreUrl("https://127.0.0.1")).toThrow("public hostname");
    expect(() => normalizeWooCommerceStoreUrl("https://[::1]")).toThrow("public hostname");
    expect(() => normalizeWooCommerceStoreUrl("https://metadata.internal")).toThrow("public hostname");
  });

  it("rejects a hostname when any DNS result is private", async () => {
    await expect(resolveWooCommerceStore("https://shop.example.com", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.8", family: 4 }
    ])).rejects.toThrow("private or reserved");
  });

  it("returns a pinned public address for a safe hostname", async () => {
    await expect(resolveWooCommerceStore("https://shop.example.com", async () => [
      { address: "93.184.216.34", family: 4 }
    ])).resolves.toEqual({ url: "https://shop.example.com", address: "93.184.216.34", family: 4 });
  });

  it("classifies private, reserved, mapped, and public addresses", () => {
    expect(isPublicIpAddress("10.2.3.4")).toBe(false);
    expect(isPublicIpAddress("169.254.169.254")).toBe(false);
    expect(isPublicIpAddress("198.51.100.4")).toBe(false);
    expect(isPublicIpAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicIpAddress("fc00::1")).toBe(false);
    expect(isPublicIpAddress("2001::1")).toBe(false);
    expect(isPublicIpAddress("2001:db8::1")).toBe(false);
    expect(isPublicIpAddress("8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
  });
});

describe("WooCommerce native authorization", () => {
  it("builds a read-only wc-auth URL with separate return and callback endpoints", () => {
    const value = new URL(buildWooCommerceAuthorizeUrl(
      "https://shop.example.com/wordpress",
      "attempt-token",
      "https://admin.example.com"
    ));
    expect(value.origin + value.pathname).toBe("https://shop.example.com/wordpress/wc-auth/v1/authorize");
    expect(value.searchParams.get("scope")).toBe("read");
    expect(value.searchParams.get("user_id")).toBe("attempt-token");
    expect(value.searchParams.get("return_url")).toBe("https://admin.example.com/api/stores/woocommerce/return");
    expect(value.searchParams.get("callback_url")).toBe("https://admin.example.com/api/stores/woocommerce/callback");
  });
});

describe("WooCommerce credential encryption", () => {
  it("round-trips the credential pair without exposing it in ciphertext", () => {
    const key = Buffer.alloc(32, 9).toString("base64");
    const credentials = { consumerKey: "ck_1234567890", consumerSecret: "cs_1234567890" };
    const encrypted = encryptWooCommerceCredentials(credentials, key);
    expect(encrypted).not.toContain(credentials.consumerKey);
    expect(encrypted).not.toContain(credentials.consumerSecret);
    expect(decryptWooCommerceCredentials(encrypted, key)).toEqual(credentials);
    expect(decryptWooCommerceCredentials(encrypted, Buffer.alloc(32, 8).toString("base64"))).toBeNull();
  });
});
