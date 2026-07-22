import { prisma } from "@personalise-kings/db";
import * as z from "zod";
import { badRequest, created, ok, parseJson } from "../../../lib/api";
import { writeAuditEvent } from "../../../lib/audit";
import { requirePermission } from "../../../lib/rbac";
import { requireSameOrigin } from "../../../lib/same-origin";

const createPrintJobSchema = z.object({
  orderId: z.string().min(1),
  artworkSnapshotId: z.string().min(1)
});

export async function GET() {
  const access = await requirePermission("regenerate_artifact");
  if (access.error) return access.error;
  const session = access.session;
  const printJobs = await prisma.printJob.findMany({
    where: { merchantId: session.merchantId },
    orderBy: { createdAt: "desc" },
    include: { order: true, attempts: true },
    take: 50
  });

  return ok({ items: printJobs });
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("regenerate_artifact");
  if (access.error) return access.error;
  const session = access.session;
  const parsed = await parseJson(request, createPrintJobSchema);
  if (parsed.error) return parsed.error;

  const [order, snapshot] = await Promise.all([
    prisma.externalOrder.findFirst({ where: { id: parsed.data.orderId, merchantId: session.merchantId } }),
    prisma.orderArtworkSnapshot.findFirst({ where: { id: parsed.data.artworkSnapshotId, merchantId: session.merchantId } })
  ]);

  if (!order || !snapshot) {
    return badRequest("Order and artwork snapshot must belong to the current merchant");
  }

  const printJob = await prisma.$transaction(async (tx) => {
    const createdPrintJob = await tx.printJob.create({
      data: {
        merchantId: session.merchantId,
        orderId: parsed.data.orderId,
        artworkSnapshotId: parsed.data.artworkSnapshotId,
        status: "queued"
      }
    });
    await writeAuditEvent({
      merchantId: session.merchantId,
      actorUserId: session.userId,
      action: "print_job.create",
      targetType: "PrintJob",
      targetId: createdPrintJob.id,
      metadata: { orderId: parsed.data.orderId, artworkSnapshotId: parsed.data.artworkSnapshotId }
    }, tx);
    return createdPrintJob;
  });

  return created(printJob);
}
