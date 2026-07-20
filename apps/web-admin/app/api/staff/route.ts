import { hashPassword, STAFF_ROLES } from "@personalise-kings/auth";
import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { badRequest, created, ok, parseJson } from "../../../lib/api";
import { writeAuditEvent } from "../../../lib/audit";
import { requirePermission } from "../../../lib/rbac";
import { requireSameOrigin } from "../../../lib/same-origin";

const createStaffSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
  role: z.enum(STAFF_ROLES)
});

export async function GET() {
  const access = await requirePermission("manage_staff");
  if (access.error) return access.error;

  const users = await prisma.staffUser.findMany({
    where: { merchantId: access.session.merchantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      mfaEnabled: true,
      createdAt: true,
      updatedAt: true
    }
  });

  return ok({ items: users });
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_staff");
  if (access.error) return access.error;

  const parsed = await parseJson(request, createStaffSchema);
  if (parsed.error) return parsed.error;

  const existing = await prisma.staffUser.findUnique({
    where: {
      merchantId_email: {
        merchantId: access.session.merchantId,
        email: parsed.data.email.toLowerCase()
      }
    }
  });

  if (existing) {
    return badRequest("A staff user with this email already exists");
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.staffUser.create({
      data: {
        merchantId: access.session.merchantId,
        email: parsed.data.email.toLowerCase(),
        passwordHash,
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
    await writeAuditEvent({
      merchantId: access.session.merchantId,
      actorUserId: access.session.userId,
      action: "staff.create",
      targetType: "StaffUser",
      targetId: createdUser.id,
      metadata: { email: createdUser.email, role: createdUser.role }
    }, tx);
    return createdUser;
  });

  return created(user);
}
