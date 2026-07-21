import { NextResponse } from "next/server";
import { writeAuditEvent } from "../../../../lib/audit";
import { clearAdminSessionCookie, getOptionalAdminSession, revokeCurrentAdminSession } from "../../../../lib/session";
import { requireSameOrigin } from "../../../../lib/same-origin";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const session = await getOptionalAdminSession();
  try {
    await revokeCurrentAdminSession();
    if (session) {
      await writeAuditEvent({
        merchantId: session.merchantId,
        actorUserId: session.userId,
        action: "auth.logout",
        targetType: "AdminSession",
        targetId: session.sessionId
      });
    }
  } finally {
    await clearAdminSessionCookie();
  }
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
