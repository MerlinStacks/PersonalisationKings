"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface ArtifactHoldSummary {
  id: string;
  artifactType: string;
  bytesDeletedAt: Date | null;
  cleanupClaimedAt: Date | null;
  retentionHoldAt: Date | null;
  retentionHoldUntil: Date | null;
  retentionHoldReason: string | null;
}

export function ArtifactRetentionManager({ artifacts }: Readonly<{ artifacts: ArtifactHoldSummary[] }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function setHold(event: FormEvent<HTMLFormElement>, artifactId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rawExpiry = String(form.get("holdUntil") ?? "");
    await mutate(artifactId, "POST", {
      reason: String(form.get("reason") ?? "").trim(),
      holdUntil: rawExpiry ? new Date(rawExpiry).toISOString() : null
    });
  }

  async function mutate(artifactId: string, method: "POST" | "DELETE", body?: { reason: string; holdUntil: string | null }) {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/generated-artifacts/${encodeURIComponent(artifactId)}/retention-hold`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "The retention hold could not be updated.");
      setMessage(method === "POST" ? "Retention hold recorded." : "Retention hold released.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The retention hold could not be updated.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="deletion-manager" aria-labelledby="artifact-holds-heading">
      <div><p className="eyebrow">Retention controls</p><h2 id="artifact-holds-heading">Artifact holds</h2></div>
      <p>Use a reasoned hold for disputes, reprints, or legal retention. Leave expiry blank for an indefinite hold.</p>
      {message ? <p className="success-box" role="status">{message}</p> : null}
      <div className="deletion-actions">
        {artifacts.filter((artifact) => !artifact.bytesDeletedAt && !artifact.cleanupClaimedAt).map((artifact) => isActiveHold(artifact) ? (
          <div className="card" key={artifact.id}>
            <strong>{artifact.artifactType} {artifact.id}</strong>
            <p>{artifact.retentionHoldReason}</p>
            <small>{artifact.retentionHoldUntil ? `Until ${new Date(artifact.retentionHoldUntil).toLocaleString()}` : "Indefinite hold"}</small>
            <button className="button secondary" type="button" disabled={pending} onClick={() => void mutate(artifact.id, "DELETE")}>Release hold</button>
          </div>
        ) : (
          <form className="backup-confirm" key={artifact.id} onSubmit={(event) => void setHold(event, artifact.id)}>
            <label className="builder-field">Reason for {artifact.artifactType} {artifact.id}<input name="reason" required minLength={10} maxLength={500} /></label>
            <label className="builder-field">Optional expiry<input name="holdUntil" type="datetime-local" /></label>
            <button className="button secondary" type="submit" disabled={pending}>Place hold</button>
          </form>
        ))}
      </div>
    </section>
  );
}

function isActiveHold(artifact: ArtifactHoldSummary) {
  return Boolean(artifact.retentionHoldAt && (!artifact.retentionHoldUntil || new Date(artifact.retentionHoldUntil) > new Date()));
}
