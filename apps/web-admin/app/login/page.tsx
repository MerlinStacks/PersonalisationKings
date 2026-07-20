import { getOptionalAdminSession } from "../../lib/session";
import { redirect } from "next/navigation";

export default async function LoginPage({ searchParams }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const session = await getOptionalAdminSession();
  if (session) redirect("/");

  const params = await searchParams;
  const hasError = params.error === "invalid";

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <p className="eyebrow">Merchant access</p>
        <h1 id="login-title">Log in to PersonaliseKings</h1>
        <p>Demo credentials after seeding: <strong>seed-merchant</strong> / <strong>owner@example.test</strong> / <strong>password123</strong></p>
        {hasError ? <p className="error-box" role="alert">Merchant, email, or password is incorrect.</p> : null}
        <form action="/api/auth/login" method="post" className="login-form">
          <label>
            Merchant ID
            <input name="merchantId" autoComplete="organization" required defaultValue="seed-merchant" />
          </label>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required defaultValue="owner@example.test" />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required defaultValue="password123" />
          </label>
          <button type="submit">Log in</button>
        </form>
      </section>
    </main>
  );
}
