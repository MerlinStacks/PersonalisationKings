import { prisma } from "@personalise-kings/db";
import { badRequest, created, ok, parseJson } from "../../../lib/api";
import { writeAuditEvent } from "../../../lib/audit";
import { createProductMappingSchema, externalVariantKey } from "../../../lib/product-mappings";
import { requirePermission } from "../../../lib/rbac";
import { requireSameOrigin } from "../../../lib/same-origin";

export async function GET() {
  const access = await requirePermission("manage_store");
  if (access.error) return access.error;
  const session = access.session;
  const mappings = await prisma.productMapping.findMany({
    where: { merchantId: session.merchantId },
    orderBy: { createdAt: "desc" },
    include: {
      store: { select: { id: true, type: true, url: true, connectionStatus: true } },
      design: { select: { id: true, name: true, currentVersionId: true, archivedAt: true } }
    }
  });

  return ok({ items: mappings });
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_store");
  if (access.error) return access.error;
  const session = access.session;
  const parsed = await parseJson(request, createProductMappingSchema);
  if (parsed.error) return parsed.error;

  const [store, design] = await Promise.all([
    prisma.store.findFirst({ where: { id: parsed.data.storeId, merchantId: session.merchantId } }),
    prisma.design.findFirst({
      where: { id: parsed.data.designId, merchantId: session.merchantId, archivedAt: null, currentVersionId: { not: null } }
    })
  ]);

  if (!store || !design) {
    return badRequest("Store and design must belong to the current merchant");
  }

  let mapping;
  try {
    mapping = await prisma.$transaction(async (tx) => {
      const createdMapping = await tx.productMapping.create({
        data: {
          merchantId: session.merchantId,
          storeId: parsed.data.storeId,
          externalProductId: parsed.data.externalProductId,
          externalVariantId: parsed.data.externalVariantId,
          externalVariantKey: externalVariantKey(parsed.data.externalVariantId),
          designId: parsed.data.designId,
          priceModifierMinor: parsed.data.priceModifierMinor,
          active: parsed.data.active
        }
      });
      await writeAuditEvent({
        merchantId: session.merchantId,
        actorUserId: session.userId,
        action: "product_mapping.create",
        targetType: "ProductMapping",
        targetId: createdMapping.id,
        metadata: {
          storeId: createdMapping.storeId,
          externalProductId: createdMapping.externalProductId,
          externalVariantId: createdMapping.externalVariantId,
          designId: createdMapping.designId,
          priceModifierMinor: createdMapping.priceModifierMinor
        }
      }, tx);
      return createdMapping;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return ok({ error: "mapping_exists", message: "This store product and variant already has a mapping" }, { status: 409 });
    }
    throw error;
  }

  return created(mapping);
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002");
}
