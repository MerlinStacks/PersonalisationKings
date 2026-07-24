"use client";

import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { useState } from "react";

export function PasskeyLogin() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function login() {
    if (!browserSupportsWebAuthn()) {
      setError("This browser does not support passkeys");
      return;
    }
    setPending(true);
    setError("");
    try {
      const optionsResponse = await fetch("/api/auth/passkeys/authenticate/options", { method: "POST" });
      if (!optionsResponse.ok) throw new Error("Passkey login is temporarily unavailable");
      const ceremony = await optionsResponse.json() as {
        challengeId: string;
        options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
      };
      const response = await startAuthentication({ optionsJSON: ceremony.options });
      const verified = await fetch("/api/auth/passkeys/authenticate/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: ceremony.challengeId, response })
      });
      if (!verified.ok) throw new Error("This passkey could not be verified");
      window.location.assign("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Passkey login failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="passkey-login">
      <div className="login-divider"><span>or</span></div>
      <button className="button secondary" type="button" disabled={pending} onClick={() => void login()}>
        {pending ? "Checking passkey..." : "Log in with a passkey"}
      </button>
      {error ? <p className="error-box" role="alert">{error}</p> : null}
    </div>
  );
}
