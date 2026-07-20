import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { badRequest, notFound, ok, parseJson } from "../../../../lib/api";
import { writeAuditEvent } from "../../../../lib/audit";
import { requirePermission } from "../../../../lib/rbac";
import { requireSameOrigin } from "../../../../lib/same-origin";

const updateMappingSchema = z.object({
  designId: z.string().min(1),
  priceModifierMinor: z.number().int().min(-10_000_000).max(10_000_000),
  active: z.boolean()
});

export async function PATCH(request: Request, { params }: Readonly<{ params: Promise<{ mappingId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_store");
  if (access.error) return access.error;
  const parsed = await parseJson(request, updateMappingSchema);
  if (parsed.error) return parsed.error;
  const { mappingId } = await params;

  const [mapping, design] = await Promise.all([
    prisma.productMapping.findFirst({ where: { id: mappingId, merchantId: access.session.merchantId } }),
    prisma.design.findFirst({
      where: {
        id: parsed.data.designId,
        merchantId: access.session.merchantId,
        archivedAt: null,
        currentVersionId: { not: null }
      }
    })
  ]);
  if (!mapping) return notFound("Product mapping not found");
  if (!design) return badRequest("Design must be active, published, and belong to the current merchant");

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.productMapping.update({
      where: { id: mapping.id },
      data: {
        designId: design.id,
        priceModifierMinor: parsed.data.priceModifierMinor,
        active: parsed.data.active
      }
    });
    await writeAuditEvent({
      merchantId: access.session.merchantId,
      actorUserId: access.session.userId,
      action: "product_mapping.update",
      targetType: "ProductMapping",
      targetId: mapping.id,
      metadata: {
        previousDesignId: mapping.designId,
        designId: result.designId,
        previousPriceModifierMinor: mapping.priceModifierMinor,
        priceModifierMinor: result.priceModifierMinor,
        previousActive: mapping.active,
        active: result.active
      }
    }, tx);
    return result;
  });

  return ok(updated);
}
