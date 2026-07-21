import { hashPassword, verifyPassword } from "@personalise-kings/auth";
import { prisma } from "@personalise-kings/db";
import { NextResponse } from "next/server";
import { writeAuditEvent } from "../../../../lib/audit";
import { createPendingAdminSession } from "../../../../lib/session";
import { requireSameOrigin } from "../../../../lib/same-origin";
import { BodyTooLargeError, readBoundedText } from "../../../../lib/api";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    return NextResponse.json({ error: "unsupported_media_type" }, { status: 415 });
  }
  let formData: URLSearchParams;
  try {
    formData = new URLSearchParams(await readBoundedText(request, 16 * 1024));
  } catch (error) {
    if (error instanceof BodyTooLargeError) return NextResponse.json({ error: "body_too_large" }, { status: 413 });
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const merchantId = String(formData.get("merchantId") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (merchantId.length > 191 || email.length > 320 || password.length > 256) {
    return NextResponse.redirect(new URL("/login?error=invalid", request.url), { status: 303 });
  }

  const user = await prisma.staffUser.findUnique({
    where: { merchantId_email: { merchantId, email } }
  });

  const passwordValid = user
    ? await verifyPassword(password, user.passwordHash)
    : (await hashPassword(password || "invalid-password"), false);
  if (!user || !passwordValid) {
    return NextResponse.redirect(new URL("/login?error=invalid", request.url), { status: 303 });
  }

  await prisma.adminSession.updateMany({ where: { staffUserId: user.id, mfaVerifiedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  const pendingSession = await createPendingAdminSession(user, request);

  await writeAuditEvent({
    merchantId: user.merchantId,
    actorUserId: user.id,
    action: "auth.password_verified",
    targetType: "AdminSession",
    targetId: pendingSession.id,
    metadata: { staffUserId: user.id }
  });

  return NextResponse.redirect(new URL(user.mfaEnabled ? "/login/mfa" : "/login/mfa/setup", request.url), { status: 303 });
}
