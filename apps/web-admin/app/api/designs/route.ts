import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { badRequest, created, ok, parseJson, toInputJson } from "../../../lib/api";
import { writeAuditEvent } from "../../../lib/audit";
import { designAssetValidationError, designVersionInputSchema } from "../../../lib/designs";
import { requirePermission } from "../../../lib/rbac";
import { requireSameOrigin } from "../../../lib/same-origin";

const createDesignSchema = z.object({
  name: z.string().min(1).max(160),
}).and(designVersionInputSchema);

export async function GET() {
  const access = await requirePermission("manage_design");
  if (access.error) return access.error;
  const session = access.session;
  const designs = await prisma.design.findMany({
    where: { merchantId: session.merchantId, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } }
  });

  return ok({ items: designs });
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_design");
  if (access.error) return access.error;
  const session = access.session;
  const parsed = await parseJson(request, createDesignSchema);
  if (parsed.error) return parsed.error;
  const assetError = await designAssetValidationError(session.merchantId, parsed.data.sceneGraph, parsed.data.customiserConfig);
  if (assetError) return badRequest(assetError);

  const design = await prisma.$transaction(async (tx) => {
    const createdDesign = await tx.design.create({
      data: {
        merchantId: session.merchantId,
        name: parsed.data.name
      }
    });

    const version = await tx.designVersion.create({
      data: {
        merchantId: session.merchantId,
        designId: createdDesign.id,
        version: 1,
        sceneGraph: toInputJson(parsed.data.sceneGraph),
        customiserConfig: toInputJson(parsed.data.customiserConfig)
      }
    });

    const updated = await tx.design.update({
      where: { id: createdDesign.id },
      data: { currentVersionId: version.id },
      include: { versions: true }
    });
    await writeAuditEvent({
      merchantId: session.merchantId,
      actorUserId: session.userId,
      action: "design.create",
      targetType: "Design",
      targetId: createdDesign.id,
      metadata: { versionId: version.id, version: 1 }
    }, tx);
    return updated;
  });

  return created(design);
}
