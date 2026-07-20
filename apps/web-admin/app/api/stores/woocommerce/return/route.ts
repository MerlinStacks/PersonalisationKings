import { prisma } from "@personalise-kings/db";
import { NextResponse } from "next/server";
import { writeAuditEvent } from "../../../../../lib/audit";
import { getOptionalAdminSession } from "../../../../../lib/session";
import { webAppUrl } from "../../../../../lib/woocommerce";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const attemptId = requestUrl.searchParams.get("user_id");
  const approved = requestUrl.searchParams.get("success");
  const session = await getOptionalAdminSession();
  const applicationUrl = webAppUrl();
  if (!session) return NextResponse.redirect(new URL("/login", applicationUrl), { status: 303 });

  const attempt = attemptId ? await prisma.wooCommerceAuthAttempt.findFirst({
    where: { id: attemptId, merchantId: session.merchantId, actorUserId: session.userId }
  }) : null;
  if (!attempt || (approved !== "0" && approved !== "1")) {
    return NextResponse.redirect(new URL("/stores?connection=invalid", applicationUrl), { status: 303 });
  }

  const now = new Date();
  if (approved === "0" && !attempt.callbackReceivedAt && !attempt.cancelledAt) {
    const denied = await prisma.$transaction(async (tx) => {
      const cancelled = await tx.wooCommerceAuthAttempt.updateMany({
        where: { id: attempt.id, callbackReceivedAt: null, cancelledAt: null },
        data: { cancelledAt: now, returnedAt: now, returnSucceeded: false }
      });
      if (cancelled.count !== 1) return false;
      const currentStore = await tx.store.findUnique({
        where: { id_merchantId: { id: attempt.storeId, merchantId: session.merchantId } },
        select: { credentialReference: true }
      });
      if (!currentStore?.credentialReference) {
        await tx.store.update({
          where: { id_merchantId: { id: attempt.storeId, merchantId: session.merchantId } },
          data: {
            connectionStatus: "failed",
            connectionLastFailedAt: now,
            connectionLastError: "WooCommerce authorization was denied"
          }
        });
      }
      await writeAuditEvent({
        merchantId: session.merchantId,
        actorUserId: session.userId,
        action: "store.connection_authorization_denied",
        targetType: "Store",
        targetId: attempt.storeId,
        metadata: { provider: "woocommerce" }
      }, tx);
      return true;
    });
    if (denied) return NextResponse.redirect(new URL("/stores?connection=denied", applicationUrl), { status: 303 });
    const current = await prisma.wooCommerceAuthAttempt.findUnique({
      where: { id: attempt.id },
      select: { callbackReceivedAt: true }
    });
    return NextResponse.redirect(new URL(`/stores?connection=${current?.callbackReceivedAt ? "connected" : "invalid"}`, applicationUrl), { status: 303 });
  }

  if (attempt.cancelledAt || (attempt.expiresAt <= now && !attempt.callbackReceivedAt)) {
    return NextResponse.redirect(new URL("/stores?connection=invalid", applicationUrl), { status: 303 });
  }

  await prisma.wooCommerceAuthAttempt.updateMany({
    where: { id: attempt.id, cancelledAt: null },
    data: { returnedAt: now, returnSucceeded: true }
  });
  const current = await prisma.wooCommerceAuthAttempt.findUnique({
    where: { id: attempt.id },
    select: { callbackReceivedAt: true }
  });
  const connection = current?.callbackReceivedAt ? "connected" : "approved";
  return NextResponse.redirect(new URL(`/stores?connection=${connection}`, applicationUrl), { status: 303 });
}
