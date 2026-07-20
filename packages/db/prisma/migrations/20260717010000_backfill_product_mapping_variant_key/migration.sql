-- Repair variant mappings created before the API persisted the normalized lookup key.
UPDATE "ProductMapping"
SET "externalVariantKey" = "externalVariantId"
WHERE "externalVariantId" IS NOT NULL
  AND "externalVariantKey" = '';
