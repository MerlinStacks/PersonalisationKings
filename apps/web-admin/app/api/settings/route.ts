import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { ok, parseJson } from "../../../lib/api";
import { writeAuditEvent } from "../../../lib/audit";
import { requirePermission } from "../../../lib/rbac";
import { requireSameOrigin } from "../../../lib/same-origin";

const retentionDays = z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(90)]);

const updateSettingsSchema = z.object({
  temporaryUploadRetentionDays: retentionDays.optional(),
  previewRetentionDays: retentionDays.optional(),
  productionArtifactRetentionDays: retentionDays.optional()
});

export async function GET() {
  const access = await requirePermission("manage_store");
  if (access.error) return access.error;

  const settings = await getOrCreateSettings(access.session.merchantId);
  return ok(settings);
}

export async function PATCH(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_store");
  if (access.error) return access.error;

  const parsed = await parseJson(request, updateSettingsSchema);
  if (parsed.error) return parsed.error;

  const settings = await prisma.$transaction(async (tx) => {
    const updated = await tx.merchantSettings.upsert({
      where: { merchantId: access.session.merchantId },
      update: parsed.data,
      create: {
        merchantId: access.session.merchantId,
        temporaryUploadRetentionDays: parsed.data.temporaryUploadRetentionDays ?? 15,
        previewRetentionDays: parsed.data.previewRetentionDays ?? 30,
        productionArtifactRetentionDays: parsed.data.productionArtifactRetentionDays ?? 90
      }
    });
    await writeAuditEvent({
      merchantId: access.session.merchantId,
      actorUserId: access.session.userId,
      action: "settings.update_retention",
      targetType: "MerchantSettings",
      targetId: updated.id,
      metadata: parsed.data
    }, tx);
    return updated;
  });

  return ok(settings);
}

async function getOrCreateSettings(merchantId: string) {
  return prisma.merchantSettings.upsert({
    where: { merchantId },
    update: {},
    create: { merchantId }
  });
}
