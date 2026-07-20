import { verifyPassword } from "@personalise-kings/auth";
import { prisma } from "@personalise-kings/db";
import { NextResponse } from "next/server";
import { writeAuditEvent } from "../../../../lib/audit";
import { setAdminSessionCookie } from "../../../../lib/session";
import { requireSameOrigin } from "../../../../lib/same-origin";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const formData = await request.formData();
  const merchantId = String(formData.get("merchantId") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const user = await prisma.staffUser.findUnique({
    where: { merchantId_email: { merchantId, email } }
  });

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.redirect(new URL("/login?error=invalid", request.url), { status: 303 });
  }

  await setAdminSessionCookie({
    merchantId: user.merchantId,
    userId: user.id,
    role: user.role,
    expiresAt: Math.floor(Date.now() / 1000) + 60 * 60 * 8
  });

  await writeAuditEvent({
    merchantId: user.merchantId,
    actorUserId: user.id,
    action: "auth.login",
    targetType: "StaffUser",
    targetId: user.id,
    metadata: { email: user.email }
  });

  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
