import { describe, expect, it } from "vitest";
import { assertDemoSeedAllowed, deploymentMode, insecureDevelopmentEnabled, validateServiceEnvironment } from "./server";

const keyA = Buffer.alloc(32, 1).toString("base64");
const keyB = Buffer.alloc(32, 2).toString("base64");
const production = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:secret@db:5432/personalise_kings",
  OBJECT_STORAGE_ROOT: "/data/objects",
  OBJECT_STORAGE_MAX_BYTES: "26214400",
  PK_WEBAPP_URL: "https://admin.example.com",
  PK_CUSTOMISER_URL: "https://customiser.example.com",
  PK_API_URL: "https://api.example.com",
  PK_ADMIN_MFA_ENCRYPTION_KEY: keyA,
  PK_ADMIN_RECOVERY_CODE_PEPPER: "recovery-pepper-with-at-least-32-random-bytes",
  PK_CONNECTOR_SECRET_ENCRYPTION_KEY: keyB,
  PK_EMBED_TOKEN_SECRET: "embed-secret-with-at-least-32-random-bytes",
  PK_OBJECT_URL_SECRET: "object-secret-with-at-least-32-random-bytes"
};

describe("server configuration", () => {
  it("requires an explicit deployment mode", () => {
    expect(() => deploymentMode({})).toThrow(/NODE_ENV/);
    expect(() => deploymentMode({ NODE_ENV: "prod" })).toThrow(/NODE_ENV/);
    expect(deploymentMode({ NODE_ENV: "test" })).toBe("test");
  });

  it("accepts complete service-specific production configuration", () => {
    expect(validateServiceEnvironment("api", production).mode).toBe("production");
    expect(validateServiceEnvironment("web-admin", production).mode).toBe("production");
    expect(validateServiceEnvironment("customiser", production).mode).toBe("production");
    expect(validateServiceEnvironment("worker-render", production).mode).toBe("production");
  });

  it.each([
    ["placeholder secret", { PK_EMBED_TOKEN_SECRET: "change-me-change-me-change-me-change-me" }],
    ["short secret", { PK_OBJECT_URL_SECRET: "short" }],
    ["malformed encryption key", { PK_CONNECTOR_SECRET_ENCRYPTION_KEY: "not-base64" }],
    ["insecure origin", { PK_API_URL: "http://api.example.com" }],
    ["origin path", { PK_CUSTOMISER_URL: "https://customiser.example.com/path" }],
    ["relative storage", { OBJECT_STORAGE_ROOT: "./objects" }],
    ["invalid storage bound", { OBJECT_STORAGE_MAX_BYTES: "0" }]
  ])("rejects %s", (_name, override) => {
    expect(() => validateServiceEnvironment("api", { ...production, ...override })).toThrow();
  });

  it("rejects reused production secrets", () => {
    expect(() => validateServiceEnvironment("api", {
      ...production,
      PK_OBJECT_URL_SECRET: production.PK_EMBED_TOKEN_SECRET
    })).toThrow(/distinct/);
  });

  it("rejects development bypass flags in production", () => {
    expect(() => validateServiceEnvironment("worker-render", {
      ...production,
      PK_ENABLE_INSECURE_DEVELOPMENT: "true"
    })).toThrow(/must not be enabled/);
  });

  it("makes demonstration behavior explicit and impossible in production", () => {
    expect(() => assertDemoSeedAllowed({ NODE_ENV: "production", PK_ALLOW_DEMO_SEED: "true" })).toThrow(/disabled/);
    expect(() => assertDemoSeedAllowed({ NODE_ENV: "development" })).toThrow(/PK_ALLOW_DEMO_SEED/);
    expect(() => assertDemoSeedAllowed({ NODE_ENV: "development", PK_ALLOW_DEMO_SEED: "true" })).not.toThrow();
    expect(insecureDevelopmentEnabled({ NODE_ENV: "development", PK_ENABLE_INSECURE_DEVELOPMENT: "true" })).toBe(true);
    expect(insecureDevelopmentEnabled({ NODE_ENV: "test", PK_ENABLE_INSECURE_DEVELOPMENT: "true" })).toBe(false);
  });
});
