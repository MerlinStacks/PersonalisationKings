"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface StoreItem {
  id: string;
  url: string;
  type: string;
  status: string;
  hasCredential: boolean;
  credentialSource: string | null;
  credentialPermissions: string | null;
  credentialUpdatedAt: string | null;
  activeSigningKeyId: string | null;
  signingKeys: Array<{ keyId: string; createdAt: string; retiredAt: string | null; revokedAt: string | null }>;
  lastCheckedAt: string | null;
  lastSuccessfulAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
  mappings: number;
  orders: number;
  createdAt: string;
}

interface ApiBody {
  authorizationUrl?: string;
  healthy?: boolean;
  message?: string;
  keyId?: string;
  secret?: string;
}

export function StoreConnectionManager({ stores, canManage, notice, noticeIsError = false }: Readonly<{
  stores: StoreItem[];
  canManage: boolean;
  notice?: string;
  noticeIsError?: boolean;
}>) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(noticeIsError ? notice ?? null : null);
  const [message, setMessage] = useState<string | null>(noticeIsError ? null : notice ?? null);
  const [issuedCredential, setIssuedCredential] = useState<{ keyId: string; secret: string } | null>(null);

  async function startAuthorization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await authorize({ url: url.trim() }, "new");
  }

  async function authorize(input: { storeId: string } | { url: string }, actionId: string) {
    setBusyAction(`authorize-${actionId}`);
    clearFeedback();
    try {
      const body = await apiRequest("/api/stores/woocommerce/authorize", input);
      if (!body.authorizationUrl) throw new Error("WooCommerce did not return an authorization URL");
      window.location.assign(body.authorizationUrl);
    } catch (caught) {
      setError(errorMessage(caught, "Unable to start WooCommerce authorization"));
      setBusyAction(null);
    }
  }

  async function checkHealth(store: StoreItem) {
    setBusyAction(`health-${store.id}`);
    clearFeedback();
    try {
      const body = await apiRequest(`/api/stores/${encodeURIComponent(store.id)}/woocommerce/health`, {});
      setMessage(body.healthy ? `${store.url} is connected.` : body.message ?? `${store.url} did not pass its health check.`);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught, "Unable to check the store connection"));
    } finally {
      setBusyAction(null);
    }
  }

  async function revoke(store: StoreItem) {
    if (!window.confirm(`Remove the stored WooCommerce REST credentials for ${store.url}?`)) return;
    setBusyAction(`revoke-${store.id}`);
    clearFeedback();
    try {
      await apiRequest(`/api/stores/${encodeURIComponent(store.id)}/woocommerce/revoke`, {});
      setMessage(`${store.url} credentials were removed. Revoke the matching key in WooCommerce if it is still present there.`);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught, "Unable to revoke the store credentials"));
    } finally {
      setBusyAction(null);
    }
  }

  async function rotateSigningKey(store: StoreItem) {
    setBusyAction(`signing-${store.id}`);
    clearFeedback();
    setIssuedCredential(null);
    try {
      const body = await apiRequest(`/api/stores/${encodeURIComponent(store.id)}/signing-keys`, {});
      if (!body.keyId || !body.secret) throw new Error("The signing credential response was incomplete");
      setIssuedCredential({ keyId: body.keyId, secret: body.secret });
      setMessage("Install this credential in WooCommerce before revoking the retired key. The secret is shown once.");
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught, "Unable to rotate the connector signing key"));
    } finally {
      setBusyAction(null);
    }
  }

  async function revokeSigningKey(store: StoreItem, keyId: string) {
    setBusyAction(`revoke-key-${keyId}`);
    clearFeedback();
    try {
      await apiRequest(`/api/stores/${encodeURIComponent(store.id)}/signing-keys/${encodeURIComponent(keyId)}/revoke`, {});
      setMessage(`Retired signing key ${keyId} was revoked.`);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught, "Unable to revoke the retired signing key"));
    } finally {
      setBusyAction(null);
    }
  }

  function clearFeedback() {
    setError(null);
    setMessage(null);
  }

  return (
    <div className="store-manager">
      {message ? <p className="success-box" role="status">{message}</p> : null}
      {error ? <p className="error-box" role="alert">{error}</p> : null}
      {issuedCredential ? <div className="credential-once" role="status"><strong>Signing key ID</strong><code>{issuedCredential.keyId}</code><strong>Signing secret</strong><code>{issuedCredential.secret}</code><button type="button" onClick={() => setIssuedCredential(null)}>I have stored this credential</button></div> : null}

      {canManage ? (
        <section className="store-connect-panel" aria-labelledby="connect-store-heading">
          <div className="store-connect-copy">
            <p className="eyebrow">Native approval</p>
            <h2 id="connect-store-heading">Connect WooCommerce</h2>
            <p>Enter the public HTTPS address for the WordPress site. You will approve read-only access inside WooCommerce and return here automatically.</p>
          </div>
          <form className="store-connect-form" onSubmit={startAuthorization}>
            <label htmlFor="woocommerce-store-url">Store URL</label>
            <div>
              <input
                id="woocommerce-store-url"
                type="url"
                required
                maxLength={2_048}
                placeholder="https://shop.example.com"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
              <button type="submit" disabled={!url.trim() || busyAction !== null}>
                {busyAction === "authorize-new" ? "Opening WooCommerce..." : "Connect read-only"}
              </button>
            </div>
          </form>
          <details className="manual-panel">
            <summary>Use REST API keys instead</summary>
            <p>Fallback only. Create a Read key under WooCommerce &gt; Settings &gt; Advanced &gt; REST API.</p>
            <ManualCredentialForm
              urlRequired
              disabled={busyAction !== null}
              onStart={() => { setBusyAction("manual-new"); clearFeedback(); }}
              onSuccess={() => { setBusyAction(null); setMessage("WooCommerce credentials verified and saved."); router.refresh(); }}
              onError={(value) => { setBusyAction(null); setError(value); }}
            />
          </details>
        </section>
      ) : <p className="empty-state">Your role can view stores but cannot change connections.</p>}

      <section className="store-list" aria-labelledby="connected-stores-heading">
        <div className="store-list-heading">
          <div>
            <p className="eyebrow">Connection registry</p>
            <h2 id="connected-stores-heading">{stores.length} store{stores.length === 1 ? "" : "s"}</h2>
          </div>
          <p>Health checks use the encrypted REST credentials without returning them to this browser.</p>
        </div>
        {stores.length === 0 ? <p className="empty-state">No stores are registered yet.</p> : null}
        <div className="store-cards">
          {stores.map((store) => (
            <article className="store-card" key={store.id}>
              <header className="store-card-heading">
                <div>
                  <span className={`status-pill status-${store.status}`}>{store.status.replace("_", " ")}</span>
                  <h3>{store.url}</h3>
                  <p>{store.type}</p>
                </div>
                <div className="store-counts" aria-label="Store records">
                  <span><strong>{store.mappings}</strong> mappings</span>
                  <span><strong>{store.orders}</strong> orders</span>
                </div>
              </header>

              <dl className="store-meta-grid">
                <div><dt>REST credential</dt><dd>{store.hasCredential ? sourceLabel(store.credentialSource) : "Not stored"}</dd></div>
                <div><dt>Permission</dt><dd>{store.credentialPermissions ?? "Not available"}</dd></div>
                <div><dt>Last healthy</dt><dd>{formatDate(store.lastSuccessfulAt)}</dd></div>
                <div><dt>Last checked</dt><dd>{formatDate(store.lastCheckedAt)}</dd></div>
                <div><dt>Connector signing</dt><dd>{store.activeSigningKeyId ?? "Not configured"}</dd></div>
              </dl>
              {store.lastError ? <p className="store-health-error"><strong>Latest check:</strong> {store.lastError}</p> : null}

              {canManage && store.type === "woocommerce" ? (
                <div className="store-controls">
                  <div className="store-actions">
                    <button
                      type="button"
                      disabled={!store.hasCredential || busyAction !== null}
                      onClick={() => void checkHealth(store)}
                    >{busyAction === `health-${store.id}` ? "Checking..." : "Check connection"}</button>
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => void authorize({ storeId: store.id }, store.id)}
                    >{busyAction === `authorize-${store.id}` ? "Opening..." : store.hasCredential ? "Re-authorize" : "Authorize"}</button>
                    <button
                      className="danger-action"
                      type="button"
                      disabled={busyAction !== null || (!store.hasCredential && store.status === "revoked")}
                      onClick={() => void revoke(store)}
                    >{busyAction === `revoke-${store.id}` ? "Revoking..." : "Revoke"}</button>
                    <button type="button" disabled={busyAction !== null} onClick={() => void rotateSigningKey(store)}>{busyAction === `signing-${store.id}` ? "Rotating..." : store.activeSigningKeyId ? "Rotate signing key" : "Create signing key"}</button>
                  </div>
                  {store.signingKeys.some((key) => key.retiredAt && !key.revokedAt) ? <div className="retired-keys">{store.signingKeys.filter((key) => key.retiredAt && !key.revokedAt).map((key) => <button type="button" key={key.keyId} disabled={busyAction !== null} onClick={() => void revokeSigningKey(store, key.keyId)}>Revoke retired {key.keyId}</button>)}</div> : null}
                  <details className="manual-panel compact">
                    <summary>{store.hasCredential ? "Replace with REST API keys" : "Enter REST API keys"}</summary>
                    <p>Use a dedicated read-only key. A successful connection test is required before replacement.</p>
                    <ManualCredentialForm
                      storeId={store.id}
                      disabled={busyAction !== null}
                      onStart={() => { setBusyAction(`manual-${store.id}`); clearFeedback(); }}
                      onSuccess={() => { setBusyAction(null); setMessage(`${store.url} credentials verified and saved.`); router.refresh(); }}
                      onError={(value) => { setBusyAction(null); setError(value); }}
                    />
                  </details>
                </div>
              ) : null}
              <footer>
                <span>Added {formatDate(store.createdAt)}</span>
                {store.credentialUpdatedAt ? <span>Credential updated {formatDate(store.credentialUpdatedAt)}</span> : null}
                {store.lastFailedAt ? <span>Last failed {formatDate(store.lastFailedAt)}</span> : null}
              </footer>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ManualCredentialForm({ storeId, urlRequired = false, disabled, onStart, onSuccess, onError }: Readonly<{
  storeId?: string;
  urlRequired?: boolean;
  disabled: boolean;
  onStart: () => void;
  onSuccess: () => void;
  onError: (message: string) => void;
}>) {
  const [url, setUrl] = useState("");
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onStart();
    try {
      await apiRequest("/api/stores/woocommerce/manual", {
        ...(storeId ? { storeId } : { url: url.trim() }),
        consumerKey: consumerKey.trim(),
        consumerSecret: consumerSecret.trim()
      });
      setConsumerKey("");
      setConsumerSecret("");
      onSuccess();
    } catch (caught) {
      onError(errorMessage(caught, "Unable to save the WooCommerce credentials"));
    }
  }

  return (
    <form className="manual-credential-form" onSubmit={submit}>
      {urlRequired ? <label>Store URL<input type="url" required maxLength={2_048} value={url} onChange={(event) => setUrl(event.target.value)} /></label> : null}
      <label>Consumer key<input required maxLength={200} autoComplete="off" placeholder="ck_..." value={consumerKey} onChange={(event) => setConsumerKey(event.target.value)} /></label>
      <label>Consumer secret<input type="password" required maxLength={200} autoComplete="new-password" placeholder="cs_..." value={consumerSecret} onChange={(event) => setConsumerSecret(event.target.value)} /></label>
      <button type="submit" disabled={disabled || (urlRequired && !url.trim()) || !consumerKey.trim() || !consumerSecret.trim()}>Verify and save</button>
    </form>
  );
}

async function apiRequest(url: string, body: object): Promise<ApiBody> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const responseBody = await response.json().catch(() => null) as ApiBody | null;
  if (!response.ok) throw new Error(responseBody?.message ?? "The request could not be completed");
  return responseBody ?? {};
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never";
}

function sourceLabel(source: string | null) {
  if (source === "woocommerce_auth") return "Native WooCommerce approval";
  if (source === "manual") return "Manual REST API key";
  return "Encrypted credential";
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
