import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { created, ok, parseJson, toInputJson } from "../../../lib/api";
import { writeAuditEvent } from "../../../lib/audit";
import { requirePermission } from "../../../lib/rbac";

const createOutputProfileSchema = z.object({
  name: z.string().min(1).max(160),
  printerModel: z.string().min(1),
  ripName: z.string().min(1),
  ripVersion: z.string().min(1),
  widthUm: z.number().int().positive(),
  heightUm: z.number().int().positive(),
  bleedUm: z.number().int().nonnegative().default(0),
  processColourSpace: z.string().min(1).default("CMYK"),
  whiteSpotName: z.string().min(1).default("RDG_WHITE"),
  glossSpotName: z.string().min(1).default("RDG_Gloss"),
  inkSequence: z.array(z.string().min(1)).min(1).default(["process", "RDG_WHITE", "RDG_Gloss"]),
  overprintPolicy: z.record(z.string(), z.unknown()).default({ verified: false }),
  whiteMaskPolicy: z.record(z.string(), z.unknown()).default({ mode: "eligible_layer_alpha", verified: false }),
  glossMaskPolicy: z.record(z.string(), z.unknown()).default({ mode: "tagged_objects", verified: false }),
  preflightRuleVersion: z.string().min(1).default("uv-preflight.v0")
});

export async function GET() {
  const access = await requirePermission("manage_design");
  if (access.error) return access.error;

  const profiles = await prisma.outputProfile.findMany({
    where: { merchantId: access.session.merchantId },
    orderBy: { createdAt: "desc" },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } }
  });

  return ok({ items: profiles });
}

export async function POST(request: Request) {
  const access = await requirePermission("manage_design");
  if (access.error) return access.error;

  const parsed = await parseJson(request, createOutputProfileSchema);
  if (parsed.error) return parsed.error;

  const profile = await prisma.$transaction(async (tx) => {
    const outputProfile = await tx.outputProfile.create({
      data: { merchantId: access.session.merchantId, name: parsed.data.name }
    });

    const version = await tx.outputProfileVersion.create({
      data: {
        merchantId: access.session.merchantId,
        outputProfileId: outputProfile.id,
        version: 1,
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

    return tx.outputProfile.update({
      where: { id: outputProfile.id },
      data: { activeVersionId: version.id },
      include: { versions: true }
    });
  });

  await writeAuditEvent({
    merchantId: access.session.merchantId,
    actorUserId: access.session.userId,
    action: "output_profile.create",
    targetType: "OutputProfile",
    targetId: profile.id,
    metadata: { activeVersionId: profile.activeVersionId }
  });

  return created(profile);
}
