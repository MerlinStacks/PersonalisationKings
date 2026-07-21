import { prisma } from "@personalise-kings/db";
import { ok } from "../../../../lib/api";
import { writeAuditEvent } from "../../../../lib/audit";
import { getAdminSession } from "../../../../lib/session";
import { requireSameOrigin } from "../../../../lib/same-origin";

export async function GET() {
  const session = await getAdminSession();
  const sessions = await prisma.adminSession.findMany({
    where: { staffUserId: session.userId, revokedAt: null, expiresAt: { gt: new Date() }, mfaVerifiedAt: { not: null } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, userAgent: true }
  });
  return ok({ currentSessionId: session.sessionId, sessions });
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const session = await getAdminSession();
  const revoked = await prisma.adminSession.updateMany({
    where: { staffUserId: session.userId, id: { not: session.sessionId }, revokedAt: null },
    data: { revokedAt: new Date() }
  });
  await writeAuditEvent({
    merchantId: session.merchantId,
    actorUserId: session.userId,
    action: "auth.sessions_revoked",
    targetType: "StaffUser",
    targetId: session.userId,
    metadata: { revokedCount: revoked.count }
  });
  return ok({ revokedCount: revoked.count });
}
