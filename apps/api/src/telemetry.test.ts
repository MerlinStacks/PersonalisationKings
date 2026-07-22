import { describe, expect, it } from "vitest";
import { apiRouteName, normalizedHttpMethod } from "./telemetry";

describe("API telemetry route names", () => {
  it("removes object and upload identifiers from metric dimensions", () => {
    expect(apiRouteName("/objects/production_artifact/merchant/file.pdf")).toBe("/objects/:key");
    expect(apiRouteName("/v1/customiser/uploads/upload-123/promote")).toBe("/v1/customiser/uploads/:id/promote");
  });

  it("uses stable names for known and unmatched routes", () => {
    expect(apiRouteName("/v1/customiser/config")).toBe("/v1/customiser/config");
    expect(apiRouteName("/v1/customiser/customer-controlled-id")).toBe("unmatched");
    expect(apiRouteName("/unknown/identifier")).toBe("unmatched");
  });

  it("bounds unknown HTTP methods", () => {
    expect(normalizedHttpMethod("post")).toBe("POST");
    expect(normalizedHttpMethod("connect")).toBe("CONNECT");
    expect(normalizedHttpMethod("trace")).toBe("TRACE");
    expect(normalizedHttpMethod("ATTACKER-CONTROLLED")).toBe("_OTHER");
  });
});
