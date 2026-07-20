import * as z from "zod";

export const createProductMappingSchema = z.object({
  storeId: z.string().min(1),
  externalProductId: z.string().trim().min(1).max(190),
  externalVariantId: z.string().trim().min(1).max(190).optional(),
  designId: z.string().min(1),
  priceModifierMinor: z.number().int().min(-10_000_000).max(10_000_000).default(0),
  active: z.boolean().default(true)
});

export function externalVariantKey(externalVariantId?: string) {
  return externalVariantId ?? "";
}
