import { STAFF_ROLES } from "@personalise-kings/auth";
import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { badRequest, notFound, ok, parseJson } from "../../../../lib/api";
import { writeAuditEvent } from "../../../../lib/audit";
import { requirePermission } from "../../../../lib/rbac";
import { requireSameOrigin } from "../../../../lib/same-origin";

const updateStaffSchema = z.object({
  role: z.enum(STAFF_ROLES).optional(),
  mfaEnabled: z.boolean().optional()
});

export async function PATCH(request: Request, { params }: Readonly<{ params: Promise<{ staffUserId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_staff");
  if (access.error) return access.error;

  const parsed = await parseJson(request, updateStaffSchema);
  if (parsed.error) return parsed.error;

  const { staffUserId } = await params;
  const existing = await prisma.staffUser.findFirst({
    where: { id: staffUserId, merchantId: access.session.merchantId }
  });

  if (!existing) return notFound("Staff user not found");

  if (existing.id === access.session.userId && parsed.data.role && parsed.data.role !== existing.role) {
    return badRequest("You cannot change your own role");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.staffUser.update({
      where: { id: existing.id },
      data: {
        role: parsed.data.role,
        mfaEnabled: parsed.data.mfaEnabled
      },
      select: {
        id: true,
        email: true,
        role: true,
        mfaEnabled: true,
        createdAt: true,
        updatedAt: true
      }
    });
    await writeAuditEvent({
      merchantId: access.session.merchantId,
      actorUserId: access.session.userId,
      action: "staff.update",
      targetType: "StaffUser",
      targetId: updatedUser.id,
      metadata: { role: updatedUser.role, mfaEnabled: updatedUser.mfaEnabled }
    }, tx);
    return updatedUser;
  });

  return ok(updated);
}
