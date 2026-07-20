import { prisma } from "@personalise-kings/db";
import type { Prisma } from "@prisma/client";
import { toInputJson } from "./api";

interface AuditEventInput {
  merchantId: string;
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

type AuditClient = Pick<Prisma.TransactionClient, "auditEvent">;

export async function writeAuditEvent(input: AuditEventInput, client: AuditClient = prisma) {
  await client.auditEvent.create({
    data: {
      merchantId: input.merchantId,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: toInputJson(input.metadata ?? {})
    }
  });
}
