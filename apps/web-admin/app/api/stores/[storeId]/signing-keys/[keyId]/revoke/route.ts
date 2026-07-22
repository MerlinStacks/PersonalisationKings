import { badRequest, ok } from "../../../../../../../lib/api";
import { requirePermission } from "../../../../../../../lib/rbac";
import { requireSameOrigin } from "../../../../../../../lib/same-origin";
import { revokeRetiredSigningKey } from "../../../../../../../lib/store-signing-keys";

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ storeId: string; keyId: string }> }>) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const access = await requirePermission("manage_store");
  if (access.error) return access.error;
  const { storeId, keyId } = await params;
  if (!await revokeRetiredSigningKey(storeId, access.session.merchantId, keyId, access.session.userId)) {
    return badRequest("Only a tenant-owned retired key can be revoked");
  }
  return ok({ revoked: true });
}
