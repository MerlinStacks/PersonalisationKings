"use client";

import { useEffect, useState, type FormEvent } from "react";

export function MfaFlow({ mode }: Readonly<{ mode: "setup" | "verify" }>) {
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUri, setOtpauthUri] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(mode === "setup");

  useEffect(() => {
    if (mode !== "setup") return;
    void fetch("/api/auth/mfa/setup", { method: "POST" })
      .then(async (response) => {
        const body = await response.json() as { secret?: string; otpauthUri?: string };
        if (!response.ok || !body.secret || !body.otpauthUri) throw new Error("Unable to prepare MFA enrollment.");
        setSecret(body.secret);
        setOtpauthUri(body.otpauthUri);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to prepare MFA enrollment."))
      .finally(() => setPending(false));
  }, [mode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const response = await fetch(mode === "setup" ? "/api/auth/mfa/confirm" : "/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: String(form.get("code") ?? ""), recovery })
      });
      const body = await response.json() as { recoveryCodes?: string[] };
      if (!response.ok) throw new Error("The verification code was not accepted.");
      if (body.recoveryCodes) setRecoveryCodes(body.recoveryCodes);
      else window.location.assign("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The verification code was not accepted.");
    } finally {
      setPending(false);
    }
  }

  if (recoveryCodes) {
    return (
      <section className="login-card" aria-labelledby="recovery-title">
        <p className="eyebrow">One-time recovery</p>
        <h1 id="recovery-title">Store these codes safely</h1>
        <p>Each code works once. They will not be shown again.</p>
        <pre className="recovery-codes">{recoveryCodes.join("\n")}</pre>
        <button type="button" onClick={() => window.location.assign("/")}>I have stored the codes</button>
      </section>
    );
  }

  return (
    <section className="login-card" aria-labelledby="mfa-title">
      <p className="eyebrow">Account security</p>
      <h1 id="mfa-title">{mode === "setup" ? "Set up two-step verification" : "Verify it is you"}</h1>
      {mode === "setup" ? <p>Add this secret to your authenticator app, then enter its six-digit code.</p> : null}
      {secret ? <p className="mfa-secret"><strong>Setup secret:</strong> <code>{secret}</code></p> : null}
      {otpauthUri ? <details><summary>Authenticator URI</summary><code className="uri-code">{otpauthUri}</code></details> : null}
      {error ? <p className="error-box" role="alert">{error}</p> : null}
      <form className="login-form" onSubmit={(event) => void submit(event)}>
        <label>{recovery ? "Recovery code" : "Authenticator code"}
          <input name="code" required autoComplete="one-time-code" inputMode={recovery ? "text" : "numeric"} pattern={recovery ? undefined : "[0-9]{6}"} maxLength={recovery ? 40 : 6} />
        </label>
        <button type="submit" disabled={pending}>{pending ? "Checking..." : "Continue"}</button>
      </form>
      {mode === "verify" ? <button className="text-button" type="button" onClick={() => setRecovery((value) => !value)}>Use {recovery ? "an authenticator code" : "a recovery code"}</button> : null}
    </section>
  );
}
