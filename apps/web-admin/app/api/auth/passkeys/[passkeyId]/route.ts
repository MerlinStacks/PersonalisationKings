import { prisma } from "@personalise-kings/db";
import { notFound, ok } from "../../../../../lib/api";
import { getAdminSession } from "../../../../../lib/session";
import { requireSameOrigin } from "../../../../../lib/same-origin";

export async function DELETE(request: Request, { params }: Readonly<{ params: Promise<{ passkeyId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const session = await getAdminSession();
  const { passkeyId } = await params;
  const removed = await prisma.$transaction(async (tx) => {
    const deleted = await tx.staffPasskey.deleteMany({
      where: { id: passkeyId, merchantId: session.merchantId, staffUserId: session.userId }
    });
    if (deleted.count !== 1) return false;
    await tx.auditEvent.create({
      data: {
        merchantId: session.merchantId,
        actorUserId: session.userId,
        action: "auth.passkey_revoked",
        targetType: "StaffPasskey",
        targetId: passkeyId,
        metadata: {}
      }
    });
    return true;
  });
  return removed ? ok({ revoked: true }) : notFound("Passkey not found");
}
