import { prisma } from "@personalise-kings/db";
import { notFound, ok } from "../../../../../../lib/api";
import { requirePermission } from "../../../../../../lib/rbac";
import { requireSameOrigin } from "../../../../../../lib/same-origin";

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ alertId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("acknowledge_operational_alert");
  if (access.error) return access.error;
  const { alertId } = await params;
  const acknowledged = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`operations:${access.session.merchantId}`}))`;
    const now = new Date();
    const existing = await tx.operationalAlert.findFirst({
      where: { id: alertId, merchantId: access.session.merchantId, status: "open" },
      select: { id: true }
    });
    if (!existing) return false;
    const updated = await tx.operationalAlert.update({
      where: { id: existing.id },
      data: {
        status: "acknowledged",
        acknowledgedAt: now,
        acknowledgedByUserId: access.session.userId,
        notificationVersion: { increment: 1 }
      }
    });
    await tx.operationalAlertDelivery.create({
      data: {
        alertId: updated.id,
        notificationVersion: updated.notificationVersion,
        payload: {
          schemaVersion: "operational-alert.v1",
          alertId: updated.id,
          merchantId: updated.merchantId,
          rule: updated.rule,
          severity: updated.severity,
          status: updated.status,
          summary: updated.summary,
          details: updated.details,
          notificationVersion: updated.notificationVersion,
          observedAt: updated.lastObservedAt.toISOString(),
          transitionAt: now.toISOString(),
          acknowledgedAt: now.toISOString(),
          acknowledgedByUserId: access.session.userId
        }
      }
    });
    await tx.auditEvent.create({
      data: {
        merchantId: access.session.merchantId,
        actorUserId: access.session.userId,
        action: "operational_alert.acknowledge",
        targetType: "OperationalAlert",
        targetId: alertId,
        metadata: {}
      }
    });
    return now;
  });
  if (!acknowledged) return notFound("Open operational alert not found");
  return ok({ acknowledged: true, acknowledgedAt: acknowledged });
}
