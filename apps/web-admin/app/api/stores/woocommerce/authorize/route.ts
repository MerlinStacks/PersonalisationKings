import { prisma } from "@personalise-kings/db";
import { randomBytes } from "node:crypto";
import * as z from "zod";
import { badRequest, notFound, ok, parseJson } from "../../../../../lib/api";
import { writeAuditEvent } from "../../../../../lib/audit";
import { requirePermission } from "../../../../../lib/rbac";
import { requireSameOrigin } from "../../../../../lib/same-origin";
import { buildWooCommerceAuthorizeUrl, resolveWooCommerceStore, webAppUrl, WOOCOMMERCE_AUTH_TTL_MS } from "../../../../../lib/woocommerce";

const authorizeSchema = z.object({
  storeId: z.string().min(1).max(200).optional(),
  url: z.string().min(1).max(2_048).optional()
}).strict().refine((value) => Boolean(value.storeId) !== Boolean(value.url), {
  message: "Provide either a store ID or a store URL"
});

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_store");
  if (access.error) return access.error;
  const parsed = await parseJson(request, authorizeSchema);
  if (parsed.error) return parsed.error;

  const requestedStore = parsed.data.storeId ? await prisma.store.findFirst({
    where: { id: parsed.data.storeId, merchantId: access.session.merchantId },
    select: { id: true, type: true, url: true }
  }) : null;
  if (parsed.data.storeId && !requestedStore) return notFound("Store not found");
  if (requestedStore?.type !== undefined && requestedStore.type !== "woocommerce") {
    return badRequest("Only WooCommerce stores support this authorization flow");
  }

  let resolvedStore;
  let applicationUrl;
  try {
    resolvedStore = await resolveWooCommerceStore(requestedStore?.url ?? parsed.data.url ?? "");
    applicationUrl = webAppUrl();
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "The store URL is invalid");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + WOOCOMMERCE_AUTH_TTL_MS);
  const attemptId = randomBytes(32).toString("base64url");
  const authorizationUrl = buildWooCommerceAuthorizeUrl(resolvedStore.url, attemptId, applicationUrl);
  const existingStore = requestedStore ?? await prisma.store.findUnique({
    where: {
      merchantId_type_url: {
        merchantId: access.session.merchantId,
        type: "woocommerce",
        url: resolvedStore.url
      }
    },
    select: { id: true, type: true, url: true }
  });

  const result = await prisma.$transaction(async (tx) => {
    if (existingStore) {
      await tx.wooCommerceAuthAttempt.updateMany({
        where: { storeId: existingStore.id, callbackReceivedAt: null, cancelledAt: null },
        data: { cancelledAt: now }
      });
    }
    const store = existingStore
      ? await tx.store.update({
        where: { id_merchantId: { id: existingStore.id, merchantId: access.session.merchantId } },
        data: { url: resolvedStore.url }
      })
      : await tx.store.upsert({
        where: {
          merchantId_type_url: {
            merchantId: access.session.merchantId,
            type: "woocommerce",
            url: resolvedStore.url
          }
        },
        update: {},
        create: {
          merchantId: access.session.merchantId,
          type: "woocommerce",
          url: resolvedStore.url,
          connectionStatus: "pending"
        }
      });
    if (!existingStore) {
      await tx.wooCommerceAuthAttempt.updateMany({
        where: { storeId: store.id, callbackReceivedAt: null, cancelledAt: null },
        data: { cancelledAt: now }
      });
    }
    const credential = await tx.storeCredential.findUnique({
      where: { storeId_merchantId: { storeId: store.id, merchantId: access.session.merchantId } },
      select: { id: true }
    });

    await tx.wooCommerceAuthAttempt.create({
      data: {
        id: attemptId,
        merchantId: access.session.merchantId,
        storeId: store.id,
        actorUserId: access.session.userId,
        expiresAt
      }
    });
    if (!credential) {
      await tx.store.update({
        where: { id: store.id },
        data: {
          connectionStatus: "pending",
          connectionLastError: null,
          connectionRevokedAt: null
        }
      });
    }
    await writeAuditEvent({
      merchantId: access.session.merchantId,
      actorUserId: access.session.userId,
      action: credential ? "store.credential_rotation_started" : "store.connection_authorization_started",
      targetType: "Store",
      targetId: store.id,
      metadata: { provider: "woocommerce", url: store.url, scope: "read", expiresAt: expiresAt.toISOString() }
    }, tx);
    return { storeId: store.id, rotated: Boolean(credential) };
  });

  return ok({ ...result, authorizationUrl, expiresAt: expiresAt.toISOString() });
}
