import { ok } from "../../../../lib/api";
import { getOptionalAdminSession } from "../../../../lib/session";

export async function GET() {
  const session = await getOptionalAdminSession();
  return session ? ok({ session }) : ok({ error: "unauthorized" }, { status: 401 });
}
