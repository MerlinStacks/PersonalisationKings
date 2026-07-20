import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { badRequest, created, parseJson, toInputJson } from "../../../../../lib/api";
import { writeAuditEvent } from "../../../../../lib/audit";
import { requirePermission } from "../../../../../lib/rbac";

const createVersionSchema = z.object({
  printerModel: z.string().min(1),
  ripName: z.string().min(1),
  ripVersion: z.string().min(1),
  widthUm: z.number().int().positive(),
  heightUm: z.number().int().positive(),
  bleedUm: z.number().int().nonnegative().default(0),
  processColourSpace: z.string().min(1).default("CMYK"),
  whiteSpotName: z.string().min(1).default("RDG_WHITE"),
  glossSpotName: z.string().min(1).default("RDG_Gloss"),
  inkSequence: z.array(z.string().min(1)).min(1),
  overprintPolicy: z.record(z.string(), z.unknown()).default({ verified: false }),
  whiteMaskPolicy: z.record(z.string(), z.unknown()).default({ mode: "eligible_layer_alpha", verified: false }),
  glossMaskPolicy: z.record(z.string(), z.unknown()).default({ mode: "tagged_objects", verified: false }),
  preflightRuleVersion: z.string().min(1)
});

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ outputProfileId: string }> }>) {
  const access = await requirePermission("manage_design");
  if (access.error) return access.error;

  const parsed = await parseJson(request, createVersionSchema);
  if (parsed.error) return parsed.error;

  const { outputProfileId } = await params;
  const profile = await prisma.outputProfile.findFirst({
    where: { id: outputProfileId, merchantId: access.session.merchantId },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } }
  });

  if (!profile) return badRequest("Output profile not found");

  const versionNumber = (profile.versions[0]?.version ?? 0) + 1;
  const version = await prisma.outputProfileVersion.create({
    data: {
      merchantId: access.session.merchantId,
      outputProfileId,
      version: versionNumber,
      printerModel: parsed.data.printerModel,
      ripName: parsed.data.ripName,
      ripVersion: parsed.data.ripVersion,
      widthUm: parsed.data.widthUm,
      heightUm: parsed.data.heightUm,
      bleedUm: parsed.data.bleedUm,
      processColourSpace: parsed.data.processColourSpace,
      whiteSpotName: parsed.data.whiteSpotName,
      glossSpotName: parsed.data.glossSpotName,
      inkSequence: toInputJson(parsed.data.inkSequence),
      overprintPolicy: toInputJson(parsed.data.overprintPolicy),
      whiteMaskPolicy: toInputJson(parsed.data.whiteMaskPolicy),
      glossMaskPolicy: toInputJson(parsed.data.glossMaskPolicy),
      preflightRuleVersion: parsed.data.preflightRuleVersion
    }
  });

  await prisma.outputProfile.update({
    where: { id: outputProfileId },
    data: { activeVersionId: version.id }
  });

  await writeAuditEvent({
    merchantId: access.session.merchantId,
    actorUserId: access.session.userId,
    action: "output_profile.version_create",
    targetType: "OutputProfileVersion",
    targetId: version.id,
    metadata: { outputProfileId, version: version.version }
  });

  return created(version);
}
