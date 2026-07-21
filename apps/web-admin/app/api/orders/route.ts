import { prisma } from "@personalise-kings/db";
import { orderSyncPayloadSchema } from "@personalise-kings/connector-contracts";
import { badRequest, created, ok, parseJson, toInputJson } from "../../../lib/api";
import { requirePermission } from "../../../lib/rbac";
import { requireSameOrigin } from "../../../lib/same-origin";

const orderRequestSchema = orderSyncPayloadSchema.extend({
  storeId: orderSyncPayloadSchema.shape.external_order_id.min(1)
});

export async function GET() {
  const access = await requirePermission("view_order");
  if (access.error) return access.error;
  const session = access.session;
  const orders = await prisma.externalOrder.findMany({
    where: { merchantId: session.merchantId },
    orderBy: { createdAt: "desc" },
    include: {
      lineItems: {
        include: {
          customisationRevision: {
            include: {
              previewAssetVersion: {
                select: { id: true, contentType: true, widthPx: true, heightPx: true, validationStatus: true, deletedAt: true }
              },
              proofJob: {
                select: {
                  id: true, status: true, attempts: true, rendererVersion: true, lastError: true,
                  proofAssetVersion: { select: { id: true, contentType: true, widthPx: true, heightPx: true, validationStatus: true, deletedAt: true } }
                }
              }
            }
          }
        }
      },
      printJobs: true
    },
    take: 50
  });

  return ok({ items: orders });
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_store");
  if (access.error) return access.error;
  const session = access.session;
  const parsed = await parseJson(request, orderRequestSchema);
  if (parsed.error) return parsed.error;

  const store = await prisma.store.findFirst({
    where: { id: parsed.data.storeId, merchantId: session.merchantId }
  });

  if (!store) {
    return badRequest("Store must belong to the current merchant");
  }

  const order = await prisma.$transaction(async (tx) => {
    const externalOrder = await tx.externalOrder.upsert({
      where: { storeId_externalOrderId: { storeId: store.id, externalOrderId: parsed.data.external_order_id } },
      update: {
        status: parsed.data.order_status,
        rawPayload: toInputJson(parsed.data)
      },
      create: {
        merchantId: session.merchantId,
        storeId: store.id,
        externalOrderId: parsed.data.external_order_id,
        externalOrderNumber: parsed.data.external_order_number,
        currency: parsed.data.currency,
        status: parsed.data.order_status,
        rawPayload: toInputJson(parsed.data)
      }
    });

    await tx.ecommerceLineItem.deleteMany({ where: { orderId: externalOrder.id } });
    await tx.ecommerceLineItem.createMany({
      data: parsed.data.line_items.map((item) => ({
        merchantId: session.merchantId,
        orderId: externalOrder.id,
        externalLineItemId: item.external_line_item_id,
        externalProductId: item.external_product_id,
        externalVariantId: item.external_variant_id,
        quantity: item.quantity,
        metadata: toInputJson(item.metadata)
      }))
    });

    await tx.outboxEvent.create({
      data: {
        merchantId: session.merchantId,
        eventType: "order.synced",
        aggregateType: "ExternalOrder",
        aggregateId: externalOrder.id,
        payload: toInputJson({ externalOrderId: externalOrder.id }),
        correlationId: parsed.data.idempotency_key
      }
    });

    return externalOrder;
  });

  return created(order);
}
