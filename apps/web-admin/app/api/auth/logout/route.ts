import { NextResponse } from "next/server";
import { writeAuditEvent } from "../../../../lib/audit";
import { clearAdminSessionCookie, getOptionalAdminSession } from "../../../../lib/session";
import { requireSameOrigin } from "../../../../lib/same-origin";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const session = await getOptionalAdminSession();
  if (session) {
    await writeAuditEvent({
      merchantId: session.merchantId,
      actorUserId: session.userId,
      action: "auth.logout",
      targetType: "StaffUser",
      targetId: session.userId
    });
  }

  await clearAdminSessionCookie();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
