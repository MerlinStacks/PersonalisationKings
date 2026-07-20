import { describe, expect, it } from "vitest";
import { createProductMappingSchema, externalVariantKey } from "./product-mappings";

describe("product mapping normalization", () => {
  it("persists the exact variant ID as its lookup key", () => {
    const parsed = createProductMappingSchema.parse({
      storeId: "store-1",
      externalProductId: " 123 ",
      externalVariantId: " 456 ",
      designId: "design-1"
    });
    expect(parsed.externalProductId).toBe("123");
    expect(externalVariantKey(parsed.externalVariantId)).toBe("456");
    expect(parsed.priceModifierMinor).toBe(0);
  });

  it("uses an empty lookup key for an all-variants fallback", () => {
    expect(externalVariantKey()).toBe("");
  });

  it("accepts positive and negative integer modifiers but rejects fractions", () => {
    const base = { storeId: "store-1", externalProductId: "123", designId: "design-1" };
    expect(createProductMappingSchema.safeParse({ ...base, priceModifierMinor: 250 }).success).toBe(true);
    expect(createProductMappingSchema.safeParse({ ...base, priceModifierMinor: -100 }).success).toBe(true);
    expect(createProductMappingSchema.safeParse({ ...base, priceModifierMinor: 1.5 }).success).toBe(false);
  });
});
