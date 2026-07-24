import { getOptionalAdminSession } from "../../lib/session";
import { redirect } from "next/navigation";
import { PasskeyLogin } from "../../components/passkey-login";

export default async function LoginPage({ searchParams }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const session = await getOptionalAdminSession();
  if (session) redirect("/");

  const params = await searchParams;
  const hasError = params.error === "invalid";
  const development = process.env.NODE_ENV === "development" && process.env.PK_ALLOW_DEMO_SEED === "true";

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <p className="eyebrow">Merchant access</p>
        <h1 id="login-title">Log in to PersonaliseKings</h1>
        {development ? <p>Development seed credentials: <strong>seed-merchant</strong> / <strong>owner@example.test</strong> / <strong>password123</strong></p> : null}
        {hasError ? <p className="error-box" role="alert">Merchant, email, or password is incorrect.</p> : null}
        <form action="/api/auth/login" method="post" className="login-form">
          <label>
            Merchant ID
            <input name="merchantId" autoComplete="organization" required defaultValue={development ? "seed-merchant" : undefined} />
          </label>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required defaultValue={development ? "owner@example.test" : undefined} />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required defaultValue={development ? "password123" : undefined} />
          </label>
          <button type="submit">Log in</button>
        </form>
        <PasskeyLogin />
      </section>
    </main>
  );
}
