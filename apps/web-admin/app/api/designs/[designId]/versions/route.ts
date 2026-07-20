import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { badRequest, created, notFound, parseJson, toInputJson } from "../../../../../lib/api";
import { writeAuditEvent } from "../../../../../lib/audit";
import { designAssetValidationError, designVersionInputSchema } from "../../../../../lib/designs";
import { requirePermission } from "../../../../../lib/rbac";
import { requireSameOrigin } from "../../../../../lib/same-origin";

const publishVersionSchema = z.object({
  name: z.string().min(1).max(160).optional()
}).and(designVersionInputSchema);

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ designId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_design");
  if (access.error) return access.error;
  const parsed = await parseJson(request, publishVersionSchema);
  if (parsed.error) return parsed.error;
  const { designId } = await params;

  const design = await prisma.design.findFirst({
    where: { id: designId, merchantId: access.session.merchantId, archivedAt: null },
    include: { currentVersion: true }
  });
  if (!design) return notFound("Design not found");
  if (!design.currentVersion) return badRequest("The design has no current version");
  const assetError = await designAssetValidationError(access.session.merchantId, parsed.data.sceneGraph, parsed.data.customiserConfig);
  if (assetError) return badRequest(assetError);

  const version = await prisma.$transaction(async (tx) => {
    const createdVersion = await tx.designVersion.create({
      data: {
        merchantId: access.session.merchantId,
        designId: design.id,
        version: design.currentVersion!.version + 1,
        sceneGraph: toInputJson(parsed.data.sceneGraph),
        customiserConfig: toInputJson(parsed.data.customiserConfig)
      }
    });
    await tx.design.update({
      where: { id: design.id },
      data: {
        currentVersionId: createdVersion.id,
        ...(parsed.data.name ? { name: parsed.data.name } : {})
      }
    });
    await writeAuditEvent({
      merchantId: access.session.merchantId,
      actorUserId: access.session.userId,
      action: "design.publish_version",
      targetType: "Design",
      targetId: design.id,
      metadata: { versionId: createdVersion.id, version: createdVersion.version }
    }, tx);
    return createdVersion;
  });

  return created(version);
}
