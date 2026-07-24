import { prisma } from "@personalise-kings/db";
import { ok } from "../../../../lib/api";
import { getAdminSession } from "../../../../lib/session";

export async function GET() {
  const session = await getAdminSession();
  const passkeys = await prisma.staffPasskey.findMany({
    where: { merchantId: session.merchantId, staffUserId: session.userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, deviceType: true, backedUp: true, createdAt: true, lastUsedAt: true }
  });
  return ok({ items: passkeys }, { headers: { "cache-control": "no-store" } });
}
