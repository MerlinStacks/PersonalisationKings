import { describe, expect, it } from "vitest";
import { parseReencryptOptions } from "./reencrypt-connector-secrets";

describe("connector secret re-encryption options", () => {
  it("requires explicit tenant scope and target key", () => {
    expect(parseReencryptOptions(["--merchant-id", "merchant-1", "--to-key-id", "next", "--dry-run"])).toEqual({
      merchantId: "merchant-1",
      allTenants: false,
      dryRun: true,
      batchSize: 100,
      maxRecords: 100_000,
      targetKeyId: "next"
    });
    expect(() => parseReencryptOptions(["--to-key-id", "next"])).toThrow(/exactly one/);
    expect(() => parseReencryptOptions(["--all-tenants", "--merchant-id", "merchant-1", "--to-key-id", "next"])).toThrow(/exactly one/);
  });

  it("bounds operational batch and record limits", () => {
    expect(parseReencryptOptions(["--all-tenants", "--to-key-id", "next", "--batch-size", "25", "--max-records", "500"]))
      .toMatchObject({ allTenants: true, batchSize: 25, maxRecords: 500 });
    expect(() => parseReencryptOptions(["--all-tenants", "--to-key-id", "next", "--batch-size", "0"])).toThrow(/batch-size/);
    expect(() => parseReencryptOptions(["--all-tenants", "--to-key-id", "next", "--unknown"])).toThrow(/Unknown/);
  });
});
