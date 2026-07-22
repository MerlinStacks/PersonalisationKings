import { prisma } from "@personalise-kings/db";
import { sceneGraphSchema } from "@personalise-kings/render-schema";
import { randomUUID } from "node:crypto";
import * as z from "zod";
import { badRequest, created, ok, parseJson, toInputJson } from "../../../lib/api";
import { writeAuditEvent } from "../../../lib/audit";
import { requirePermission } from "../../../lib/rbac";
import { requireSameOrigin } from "../../../lib/same-origin";

const createCustomisationSchema = z.object({
  storeId: z.string().min(1),
  designId: z.string().min(1),
  externalProductId: z.string().min(1),
  externalVariantId: z.string().optional(),
  customerInputs: z.record(z.string(), z.unknown()).default({}),
  renderSpec: sceneGraphSchema.optional(),
  commit: z.boolean().default(false)
});

export async function GET() {
  const access = await requirePermission("view_customisation");
  if (access.error) return access.error;
  const session = access.session;
  const customisations = await prisma.customisationSession.findMany({
    where: { merchantId: session.merchantId },
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: {
      revisions: {
        orderBy: { committedAt: "desc" },
        take: 1,
        include: {
          previewAssetVersion: {
            select: { id: true, contentType: true, widthPx: true, heightPx: true, validationStatus: true, deletedAt: true }
          },
          proofJob: {
            select: {
              id: true, status: true, attempts: true, rendererVersion: true, lastError: true, updatedAt: true,
              proofAssetVersion: { select: { id: true, contentType: true, widthPx: true, heightPx: true, validationStatus: true, deletedAt: true } }
            }
          }
        }
      }
    }
  });

  return ok({ items: customisations });
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_design");
  if (access.error) return access.error;
  const session = access.session;
  const parsed = await parseJson(request, createCustomisationSchema);
  if (parsed.error) return parsed.error;

  const [design, store] = await Promise.all([
    prisma.design.findFirst({
      where: { id: parsed.data.designId, merchantId: session.merchantId },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } }
    }),
    prisma.store.findFirst({ where: { id: parsed.data.storeId, merchantId: session.merchantId } })
  ]);

  if (!store || !design || design.versions.length === 0) {
    return badRequest("Store and a design with at least one version must belong to the current merchant");
  }

  const customisation = await prisma.$transaction(async (tx) => {
    const sessionRow = await tx.customisationSession.create({
      data: {
        merchantId: session.merchantId,
        storeId: parsed.data.storeId,
        designId: parsed.data.designId,
        externalProductId: parsed.data.externalProductId,
        externalVariantId: parsed.data.externalVariantId,
        customerInputs: toInputJson(parsed.data.customerInputs),
        renderSpec: parsed.data.renderSpec ? toInputJson(parsed.data.renderSpec) : undefined,
        status: parsed.data.commit ? "committed" : "draft"
      }
    });

    const revision = !parsed.data.commit || !parsed.data.renderSpec
      ? null
      : await tx.customisationRevision.create({
        data: {
          merchantId: session.merchantId,
          sessionId: sessionRow.id,
          designVersionId: design.versions[0].id,
          revision: 1,
          opaqueReference: `pk_${randomUUID()}`,
          customerInputs: toInputJson(parsed.data.customerInputs),
          renderSpec: toInputJson(parsed.data.renderSpec)
        }
      });
    await writeAuditEvent({
      merchantId: session.merchantId,
      actorUserId: session.userId,
      action: "customisation.admin_create",
      targetType: "CustomisationSession",
      targetId: sessionRow.id,
      metadata: { storeId: store.id, designId: design.id, revisionId: revision?.id ?? null, status: sessionRow.status }
    }, tx);
    return { session: sessionRow, revision };
  });

  return created(customisation);
}
