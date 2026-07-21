"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface ManagedRequest {
  id: string;
  status: string;
}

export function DeletionRequestManager({ requests }: Readonly<{ requests: ManagedRequest[] }>) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate("/api/deletion-requests", {
      subjectType: String(form.get("subjectType") ?? "AssetVersion"),
      subjectId: String(form.get("subjectId") ?? "").trim()
    }, "Deletion request queued.");
    event.currentTarget.reset();
  }

  async function confirmBackup(event: FormEvent<HTMLFormElement>, requestId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate(`/api/deletion-requests/${encodeURIComponent(requestId)}/complete`, {
      backupExpiryNote: String(form.get("backupExpiryNote") ?? "").trim()
    }, "Backup purge confirmation recorded.");
  }

  async function mutate(url: string, body: Record<string, string> | null, successMessage: string) {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "The deletion request could not be updated.");
      setMessage(successMessage);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The deletion request could not be updated.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="deletion-manager" aria-labelledby="new-deletion-heading">
      <form className="deletion-create" onSubmit={(event) => void createRequest(event)}>
        <div>
          <p className="eyebrow">New live erasure</p>
          <h2 id="new-deletion-heading">Queue a customer upload</h2>
        </div>
        <label className="builder-field">Subject type
          <select name="subjectType" defaultValue="AssetVersion"><option value="AssetVersion">Asset version</option><option value="Asset">Entire upload asset</option></select>
        </label>
        <label className="builder-field">Subject ID<input name="subjectId" required maxLength={191} /></label>
        <button className="builder-submit" type="submit" disabled={pending}>Queue deletion</button>
      </form>
      {message ? <p className="success-box" role="status">{message}</p> : null}
      <div className="deletion-actions">
        {requests.filter((request) => request.status === "failed" || request.status === "blocked_ordered").map((request) => (
          <button className="button secondary" type="button" disabled={pending} key={request.id} onClick={() => void mutate(`/api/deletion-requests/${encodeURIComponent(request.id)}/retry`, null, "Deletion eligibility recheck queued.")}>Recheck {request.id}</button>
        ))}
        {requests.filter((request) => request.status === "live_deleted").map((request) => (
          <form className="backup-confirm" key={request.id} onSubmit={(event) => void confirmBackup(event, request.id)}>
            <label className="builder-field">Backup purge evidence for {request.id}<input name="backupExpiryNote" required minLength={10} maxLength={500} /></label>
            <button className="button secondary" type="submit" disabled={pending}>Confirm backup purge</button>
          </form>
        ))}
      </div>
    </section>
  );
}
