import { roleCan, type Permission } from "@personalise-kings/auth";
import { ok } from "./api";
import { getAdminSession } from "./session";

export async function requirePermission(permission: Permission) {
  const session = await getAdminSession();

  if (!roleCan(session.role, permission)) {
    return {
      session,
      error: ok({ error: "forbidden", message: "Your role cannot perform this action" }, { status: 403 })
    } as const;
  }

  return { session, error: null } as const;
}
