"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";

interface SessionSummary {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
}

interface PasskeySummary {
  id: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export function SecuritySettings({ currentSessionId, sessions, passkeys, recoveryCodesRemaining, mfaEnabledAt }: Readonly<{
  currentSessionId: string;
  sessions: SessionSummary[];
  passkeys: PasskeySummary[];
  recoveryCodesRemaining: number;
  mfaEnabledAt: string | null;
}>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [passkeyName, setPasskeyName] = useState("");
  const [error, setError] = useState("");

  async function mutate(url: string, method: "POST" | "DELETE") {
    setPending(true);
    setError("");
    try {
      const response = await fetch(url, { method });
      if (!response.ok) throw new Error("The security setting could not be updated");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The security setting could not be updated");
    } finally {
      setPending(false);
    }
  }

  async function registerPasskey() {
    const name = passkeyName.trim();
    if (!name) return;
    if (!browserSupportsWebAuthn()) {
      setError("This browser does not support passkeys");
      return;
    }
    setPending(true);
    setError("");
    try {
      const optionsResponse = await fetch("/api/auth/passkeys/register/options", { method: "POST" });
      if (!optionsResponse.ok) throw new Error("Passkey registration is temporarily unavailable");
      const ceremony = await optionsResponse.json() as {
        challengeId: string;
        options: Parameters<typeof startRegistration>[0]["optionsJSON"];
      };
      const response = await startRegistration({ optionsJSON: ceremony.options });
      const verified = await fetch("/api/auth/passkeys/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: ceremony.challengeId, name, response })
      });
      if (!verified.ok) throw new Error("This passkey could not be registered");
      setPasskeyName("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Passkey registration failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="card security-card">
      <h2>Account security</h2>
      <p>MFA enabled: {mfaEnabledAt ? new Date(mfaEnabledAt).toLocaleString() : "Enrollment required"}</p>
      <p>Unused recovery codes: {recoveryCodesRemaining}</p>
      <h3>Passkeys</h3>
      <p>Passkeys use your device unlock and can replace password plus authenticator-code entry for login.</p>
      <div className="passkey-enroll">
        <label>Passkey name<input value={passkeyName} maxLength={100} placeholder="Work laptop" onChange={(event) => setPasskeyName(event.target.value)} /></label>
        <button className="button secondary" type="button" disabled={pending || !passkeyName.trim()} onClick={() => void registerPasskey()}>Add passkey</button>
      </div>
      {error ? <p className="error-box" role="alert">{error}</p> : null}
      <div className="session-list passkey-list">
        {passkeys.length === 0 ? <p>No passkeys registered.</p> : passkeys.map((passkey) => (
          <div key={passkey.id}>
            <strong>{passkey.name}</strong>
            <span>{passkey.backedUp ? "Synced passkey" : passkey.deviceType === "singleDevice" ? "Single device" : "Multi-device passkey"}</span>
            <small>{passkey.lastUsedAt ? `Last used ${new Date(passkey.lastUsedAt).toLocaleString()}` : `Added ${new Date(passkey.createdAt).toLocaleString()}`}</small>
            <button type="button" disabled={pending} onClick={() => void mutate(`/api/auth/passkeys/${encodeURIComponent(passkey.id)}`, "DELETE")}>Revoke</button>
          </div>
        ))}
      </div>
      <h3>Sessions</h3>
      <div className="actions"><button className="button secondary" type="button" disabled={pending} onClick={() => void mutate("/api/auth/sessions", "POST")}>Revoke other sessions</button></div>
      <div className="session-list">
        {sessions.map((session) => (
          <div key={session.id}>
            <strong>{session.id === currentSessionId ? "Current session" : "Active session"}</strong>
            <span>{session.userAgent ?? "Unknown device"}</span>
            <small>Last used {new Date(session.lastSeenAt).toLocaleString()}, expires {new Date(session.expiresAt).toLocaleString()}</small>
            <button type="button" disabled={pending} onClick={() => void mutate(`/api/auth/sessions/${encodeURIComponent(session.id)}`, "DELETE")}>Revoke</button>
          </div>
        ))}
      </div>
    </article>
  );
}
