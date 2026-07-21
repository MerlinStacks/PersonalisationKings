import { prisma } from "@personalise-kings/db";
import { ok } from "../../../../../lib/api";
import { writeAuditEvent } from "../../../../../lib/audit";
import { clearAdminSessionCookie, getAdminSession } from "../../../../../lib/session";
import { requireSameOrigin } from "../../../../../lib/same-origin";

export async function DELETE(request: Request, { params }: Readonly<{ params: Promise<{ sessionId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const current = await getAdminSession();
  const { sessionId } = await params;
  const revoked = await prisma.adminSession.updateMany({
    where: { id: sessionId, staffUserId: current.userId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
  if (sessionId === current.sessionId && revoked.count === 1) await clearAdminSessionCookie();
  await writeAuditEvent({
    merchantId: current.merchantId,
    actorUserId: current.userId,
    action: "auth.session_revoked",
    targetType: "AdminSession",
    targetId: sessionId,
    metadata: { currentSession: sessionId === current.sessionId, revoked: revoked.count === 1 }
  });
  return ok({ revoked: revoked.count === 1 });
}
