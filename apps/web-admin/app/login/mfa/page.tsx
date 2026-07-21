import { redirect } from "next/navigation";
import { MfaFlow } from "../../../components/mfa-flow";
import { getOptionalAdminSession, getPendingAdminSession } from "../../../lib/session";

export default async function MfaPage() {
  if (await getOptionalAdminSession()) redirect("/");
  const pending = await getPendingAdminSession();
  if (!pending) redirect("/login");
  if (!pending.staffUser.mfaEnabled) redirect("/login/mfa/setup");
  return <main className="login-shell"><MfaFlow mode="verify" /></main>;
}
