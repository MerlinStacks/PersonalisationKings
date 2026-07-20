import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { badRequest, created, ok, parseJson } from "../../../lib/api";
import { writeAuditEvent } from "../../../lib/audit";
import { requirePermission } from "../../../lib/rbac";
import { requireSameOrigin } from "../../../lib/same-origin";
import { normalizeWooCommerceStoreUrl } from "../../../lib/woocommerce";

const createStoreSchema = z.object({
  type: z.enum(["woocommerce", "shopify"]),
  url: z.string().url(),
  externalStoreId: z.string().optional()
});

export async function GET() {
  const access = await requirePermission("manage_store");
  if (access.error) return access.error;
  const session = access.session;
  const stores = await prisma.store.findMany({
    where: { merchantId: session.merchantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      url: true,
      externalStoreId: true,
      connectionStatus: true,
      connectionLastCheckedAt: true,
      connectionLastSuccessfulAt: true,
      connectionLastFailedAt: true,
      connectionLastError: true,
      connectionRevokedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { productMappings: true, orders: true } }
    }
  });

  return ok({ items: stores });
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_store");
  if (access.error) return access.error;
  const session = access.session;
  const parsed = await parseJson(request, createStoreSchema);
  if (parsed.error) return parsed.error;
  let url = parsed.data.url;
  if (parsed.data.type === "woocommerce") {
    try {
      url = normalizeWooCommerceStoreUrl(url);
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : "The WooCommerce store URL is invalid");
    }
  }

  const store = await prisma.$transaction(async (tx) => {
    const createdStore = await tx.store.create({
      data: {
        merchantId: session.merchantId,
        type: parsed.data.type,
        url,
        externalStoreId: parsed.data.externalStoreId,
        connectionStatus: "pending"
      }
    });
    await writeAuditEvent({
      merchantId: session.merchantId,
      actorUserId: session.userId,
      action: "store.create",
      targetType: "Store",
      targetId: createdStore.id,
      metadata: { type: createdStore.type, url: createdStore.url }
    }, tx);
    return createdStore;
  });

  return created(store);
}
