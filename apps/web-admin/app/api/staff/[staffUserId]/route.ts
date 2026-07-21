import { STAFF_ROLES } from "@personalise-kings/auth";
import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { badRequest, notFound, ok, parseJson } from "../../../../lib/api";
import { writeAuditEvent } from "../../../../lib/audit";
import { requirePermission } from "../../../../lib/rbac";
import { requireSameOrigin } from "../../../../lib/same-origin";

const updateStaffSchema = z.object({
  role: z.enum(STAFF_ROLES)
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
  if (existing.role === "owner_admin" && parsed.data.role !== "owner_admin") {
    const owners = await prisma.staffUser.count({ where: { merchantId: access.session.merchantId, role: "owner_admin" } });
    if (owners <= 1) return badRequest("The final owner/admin cannot be demoted");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.staffUser.update({
      where: { id: existing.id },
      data: {
        role: parsed.data.role
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
    await tx.adminSession.updateMany({ where: { staffUserId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await writeAuditEvent({
      merchantId: access.session.merchantId,
      actorUserId: access.session.userId,
      action: "staff.update",
      targetType: "StaffUser",
      targetId: updatedUser.id,
      metadata: { previousRole: existing.role, role: updatedUser.role, sessionsRevoked: true }
    }, tx);
    return updatedUser;
  });

  return ok(updated);
}
