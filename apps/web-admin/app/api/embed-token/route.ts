import { signEmbedToken } from "@personalise-kings/auth";
import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { badRequest, ok, parseJson } from "../../../lib/api";
import { requirePermission } from "../../../lib/rbac";
import { requireSameOrigin } from "../../../lib/same-origin";

const embedTokenRequestSchema = z.object({
  storeId: z.string().min(1),
  externalProductId: z.string().min(1),
  externalVariantId: z.string().optional()
});

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_store");
  if (access.error) return access.error;
  const session = access.session;
  const parsed = await parseJson(request, embedTokenRequestSchema);
  if (parsed.error) return parsed.error;

  const mapping = await prisma.productMapping.findFirst({
    where: {
      merchantId: session.merchantId,
      storeId: parsed.data.storeId,
      externalProductId: parsed.data.externalProductId,
      externalVariantId: parsed.data.externalVariantId,
      active: true
    },
    include: { store: true, design: { select: { currentVersionId: true } } }
  });

  if (!mapping?.design.currentVersionId) {
    return badRequest("No active design mapping exists for this product and variant");
  }

  let allowedOrigin: string;
  try {
    allowedOrigin = new URL(mapping.store.url).origin;
  } catch {
    return badRequest("The mapped store URL is invalid");
  }

  const secret = process.env.PK_EMBED_TOKEN_SECRET
    ?? (process.env.NODE_ENV === "production" ? null : "dev-embed-secret-change-me");
  if (!secret) return ok({ error: "embed_secret_not_configured" }, { status: 503 });
  const token = signEmbedToken({
    storeId: mapping.storeId,
    allowedOrigin,
    externalProductId: parsed.data.externalProductId,
    externalVariantId: parsed.data.externalVariantId,
    designId: mapping.designId,
    designVersionId: mapping.design.currentVersionId,
    expiresAt: Math.floor(Date.now() / 1000) + 15 * 60
  }, secret);

  return ok({ embedToken: token, expiresInSeconds: 900 });
}
