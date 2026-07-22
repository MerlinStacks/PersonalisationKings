"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface ManagedAlert {
  id: string;
  rule: string;
  severity: string;
  status: string;
  summary: string;
  occurrences: number;
  lastObservedAt: Date;
}

export function OperationalAlertManager({ alerts, canAcknowledge }: Readonly<{ alerts: ManagedAlert[]; canAcknowledge: boolean }>) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function acknowledge(alertId: string) {
    setPending(alertId);
    setMessage(null);
    try {
      const response = await fetch(`/api/operations/alerts/${encodeURIComponent(alertId)}/acknowledge`, { method: "POST" });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "The alert could not be acknowledged.");
      setMessage("Alert acknowledged. It will resolve only after the condition recovers.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The alert could not be acknowledged.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="deletion-manager" aria-labelledby="operations-alerts-heading">
      <div><p className="eyebrow">Current conditions</p><h2 id="operations-alerts-heading">Operational alerts</h2></div>
      {message ? <p className="success-box" role="status">{message}</p> : null}
      <div className="session-list">
        {alerts.length === 0 ? <p>No operational alerts have been recorded.</p> : alerts.map((alert) => (
          <div key={alert.id}>
            <strong>{alert.severity}: {alert.summary}</strong>
            <span>{alert.rule} · {alert.status} · observed {alert.occurrences} times</span>
            <small>Last observed {new Date(alert.lastObservedAt).toLocaleString()}</small>
            {canAcknowledge && alert.status === "open" ? <button type="button" disabled={pending !== null} onClick={() => void acknowledge(alert.id)}>Acknowledge</button> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
