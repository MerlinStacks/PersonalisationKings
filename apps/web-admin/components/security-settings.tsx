"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface SessionSummary {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
}

export function SecuritySettings({ currentSessionId, sessions, recoveryCodesRemaining, mfaEnabledAt }: Readonly<{
  currentSessionId: string;
  sessions: SessionSummary[];
  recoveryCodesRemaining: number;
  mfaEnabledAt: string | null;
}>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function mutate(url: string, method: "POST" | "DELETE") {
    setPending(true);
    try {
      await fetch(url, { method });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="card security-card">
      <h2>Account security</h2>
      <p>MFA enabled: {mfaEnabledAt ? new Date(mfaEnabledAt).toLocaleString() : "Enrollment required"}</p>
      <p>Unused recovery codes: {recoveryCodesRemaining}</p>
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
