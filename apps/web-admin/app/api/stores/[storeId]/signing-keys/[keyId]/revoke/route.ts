import { badRequest, ok } from "../../../../../../../lib/api";
import { writeAuditEvent } from "../../../../../../../lib/audit";
import { requirePermission } from "../../../../../../../lib/rbac";
import { requireSameOrigin } from "../../../../../../../lib/same-origin";
import { revokeRetiredSigningKey } from "../../../../../../../lib/store-signing-keys";

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ storeId: string; keyId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_store");
  if (access.error) return access.error;
  const { storeId, keyId } = await params;
  if (!await revokeRetiredSigningKey(storeId, access.session.merchantId, keyId)) {
    return badRequest("Only a tenant-owned retired key can be revoked");
  }
  await writeAuditEvent({
    merchantId: access.session.merchantId,
    actorUserId: access.session.userId,
    action: "store.signing_key_revoked",
    targetType: "Store",
    targetId: storeId,
    metadata: { keyId }
  });
  return ok({ revoked: true });
}
