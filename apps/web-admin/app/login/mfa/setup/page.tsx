import { redirect } from "next/navigation";
import { MfaFlow } from "../../../../components/mfa-flow";
import { getOptionalAdminSession, getPendingAdminSession } from "../../../../lib/session";

export default async function MfaSetupPage() {
  if (await getOptionalAdminSession()) redirect("/");
  const pending = await getPendingAdminSession();
  if (!pending) redirect("/login");
  if (pending.staffUser.mfaEnabled) redirect("/login/mfa");
  return <main className="login-shell"><MfaFlow mode="setup" /></main>;
}
