import * as z from "zod";

export const storeTypeSchema = z.enum(["woocommerce", "shopify"]);

export const ecommerceLineItemSchema = z.object({
  external_line_item_id: z.string().min(1),
  external_product_id: z.string().min(1),
  external_variant_id: z.string().min(1).optional(),
  quantity: z.number().int().positive(),
  customisation_reference: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const orderSyncPayloadSchema = z.object({
  store_type: storeTypeSchema,
  external_order_id: z.string().min(1),
  external_order_number: z.string().min(1).optional(),
  currency: z.string().length(3),
  order_status: z.string().min(1),
  customer_reference: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  line_items: z.array(ecommerceLineItemSchema),
  idempotency_key: z.string().min(1),
  event_timestamp: z.string().datetime({ offset: true })
});

export const connectorEventEnvelopeSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.enum(["order.paid", "order.updated", "order.cancelled", "order.refunded"]),
  event_version: z.literal("2026-07-14"),
  store_id: z.string().min(1),
  connector_instance_id: z.string().min(1),
  occurred_at: z.string().datetime({ offset: true }),
  sent_at: z.string().datetime({ offset: true }),
  key_id: z.string().min(1),
  nonce: z.string().min(16),
  content_digest: z.string().startsWith("sha256="),
  payload: orderSyncPayloadSchema
});

export type ConnectorEventEnvelope = z.infer<typeof connectorEventEnvelopeSchema>;
export type OrderSyncPayload = z.infer<typeof orderSyncPayloadSchema>;

export const EMBED_PROTOCOL_VERSION = "pk-embed.v1";

const embedBaseMessageSchema = z.object({
  protocol: z.literal(EMBED_PROTOCOL_VERSION),
  message_id: z.string().min(1),
  correlation_id: z.string().min(1),
  sent_at: z.string().datetime()
});

export const embedToParentMessageSchema = z.discriminatedUnion("event", [
  embedBaseMessageSchema.extend({
    event: z.literal("ready"),
    payload: z.object({ height: z.number().int().positive() })
  }),
  embedBaseMessageSchema.extend({
    event: z.literal("resize"),
    payload: z.object({ height: z.number().int().positive() })
  }),
  embedBaseMessageSchema.extend({
    event: z.literal("committed"),
    payload: z.object({
      customisation_reference: z.string().min(1),
      preview_url: z.string().url().optional(),
      summary: z.string().min(1)
    })
  }),
  embedBaseMessageSchema.extend({
    event: z.literal("add-to-cart"),
    payload: z.object({
      customisation_reference: z.string().min(1),
      price_delta_minor: z.number().int().default(0)
    })
  }),
  embedBaseMessageSchema.extend({
    event: z.literal("cancel"),
    payload: z.object({ reason: z.string().optional() })
  }),
  embedBaseMessageSchema.extend({
    event: z.literal("error"),
    payload: z.object({ code: z.string().min(1), message: z.string().min(1) })
  })
]);

export const parentToEmbedMessageSchema = z.discriminatedUnion("event", [
  embedBaseMessageSchema.extend({
    event: z.literal("variant-change"),
    payload: z.object({ external_variant_id: z.string().min(1) })
  }),
  embedBaseMessageSchema.extend({
    event: z.literal("save"),
    payload: z.object({})
  }),
  embedBaseMessageSchema.extend({
    event: z.literal("cancel"),
    payload: z.object({})
  })
]);

export type EmbedToParentMessage = z.infer<typeof embedToParentMessageSchema>;
export type ParentToEmbedMessage = z.infer<typeof parentToEmbedMessageSchema>;
