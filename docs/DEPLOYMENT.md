# Production Deployment

## Topology

`compose.production.yml` provides the initial single-host topology:

- PostgreSQL 16 with a private persistent volume.
- A one-shot Prisma migration service that must complete before application services start.
- Admin, customiser, and API HTTP services bound to loopback for an external TLS reverse proxy.
- Maintenance, render, and proof workers with PostgreSQL-authoritative work queues.
- One durable object volume shared by admin, API, maintenance, render, and proof services.

Redis is intentionally absent because no production path currently consumes it. Run one API replica until a coordinated edge or Redis-backed limiter replaces the in-process limiter. The shared filesystem also prevents safe multi-host scaling until an S3-compatible storage backend is implemented.

The render worker remains Phase 0 gated and moves jobs to review rather than producing unvalidated UV output. Do not represent this deployment as print-production ready until the real printer and RIP acceptance fixtures pass.

## Host Preparation

1. Install a maintained Docker Engine and Compose plugin.
2. Put the host behind a firewall. Expose only SSH and the reverse proxy's HTTP/HTTPS ports.
3. Store deployment environment values in a root-readable file outside the repository, mode `0600`.
4. Configure remote PostgreSQL and object-volume backups before accepting customer data.
5. Enable GitHub branch protection and require all CI and Security checks before deploying a revision.

The Compose file pins Bun and PostgreSQL image indexes by digest. A reviewed dependency update must deliberately refresh those digests and pass container scans.

## Required Configuration

Set these values in the protected deployment environment file:

```dotenv
NODE_ENV=production
POSTGRES_PASSWORD=<random database password>
DATABASE_URL=postgresql://personalise_kings:<percent-encoded-password>@postgres:5432/personalise_kings?schema=public
OBJECT_STORAGE_MAX_BYTES=26214400
PK_WEBAPP_URL=https://admin.example.com
PK_CUSTOMISER_URL=https://customiser.example.com
PK_API_URL=https://api.example.com
PK_ADMIN_MFA_ENCRYPTION_KEY=<openssl rand -base64 32>
PK_ADMIN_RECOVERY_CODE_PEPPER=<openssl rand -base64 48>
PK_CONNECTOR_SECRET_ENCRYPTION_KEY=<openssl rand -base64 32>
PK_EMBED_TOKEN_SECRET=<openssl rand -base64 48>
PK_OBJECT_URL_SECRET=<openssl rand -base64 48>
```

Use three distinct exact HTTPS origins on port 443 and generate every secret independently. Production startup rejects absent or unknown `NODE_ENV` values, HTTP/path-bearing origins, relative storage roots, malformed AES keys, secrets shorter than 32 bytes, common placeholder values, and reused secrets. Keep encryption keys recoverable through the secrets backup process; losing them makes encrypted TOTP and connector credentials unreadable.

The demonstration seed requires both `NODE_ENV=development` and `PK_ALLOW_DEMO_SEED=true`, refuses to run in production, and does not reset an existing owner's password. Never put either demonstration flag in a production environment file. `PK_ENABLE_INSECURE_DEVELOPMENT=true` is an additional explicit gate for development-only bypass behavior and is also forbidden operationally in production.

Production Compose provides secrets only to services that use them. Proof, render, and maintenance workers must not receive admin MFA, connector-encryption, embed-token, or object-URL signing secrets unless a reviewed feature creates a concrete need.

## Build And Rollout

From the checked-out, reviewed release revision:

```bash
docker compose --env-file /etc/personalise-kings/production.env -f compose.production.yml build
docker compose --env-file /etc/personalise-kings/production.env -f compose.production.yml run --rm migrate
docker compose --env-file /etc/personalise-kings/production.env -f compose.production.yml up -d --no-deps web-admin customiser api worker-maintenance worker-render worker-proof
docker compose --env-file /etc/personalise-kings/production.env -f compose.production.yml ps
```

The normal `up -d` path also waits for the migration service. Running migration explicitly makes failure visible before replacing application containers. Take a verified database backup before migrations that alter existing production data. Roll application code back only when its schema remains compatible; database changes should use a reviewed forward migration rather than an ad hoc down migration.

## Reverse Proxy

Terminate TLS at a maintained reverse proxy and route each public origin to its loopback port:

| Origin | Upstream |
| --- | --- |
| Admin | `http://127.0.0.1:3000` |
| Customiser | `http://127.0.0.1:3001` |
| API | `http://127.0.0.1:3002` |

Forward `Host`, `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto`; replace rather than trust client-supplied forwarding headers. Enforce HTTPS redirects, modern TLS, request timeouts, and body limits at the proxy. The API already applies route-specific body limits, but the edge should reject unexpectedly large requests before they reach Bun.

Do not add shared caching to authenticated admin routes, signed object URLs, customiser configuration, commits, uploads, or connector events. Static Next.js assets may use immutable caching. Preserve the application's CSP and security headers rather than replacing them at the proxy.

Apply coordinated edge rate limits before exposing the API. Exempt orchestration health checks, and key connector limits by trusted store credentials rather than source IP alone. Configure trusted proxy addresses explicitly before deriving client identity from forwarded headers.

## Persistence

`postgres-data` and `object-storage` are the only application data volumes. They must not be removed during routine deployments. The object volume must be mounted at `/data/personalise-kings/objects` in every storage-consuming service.

The local object backend is suitable only for the initial single-host deployment. Do not run application containers on separate hosts against unsynchronised filesystems. Monitor free space, inode usage, PostgreSQL growth, failed proof jobs, and deletion requests awaiting backup purge confirmation.

See [`BACKUP_AND_RESTORE.md`](BACKUP_AND_RESTORE.md) before storing production data.

## Health And Operations

- Admin readiness: `GET https://admin.example.com/api/health` checks PostgreSQL and writable object storage.
- Customiser liveness: `GET https://customiser.example.com/api/health`.
- API liveness: `GET https://api.example.com/health`.
- Workers emit bounded `pk.worker.polls` heartbeat metrics and also rely on process restart policy and queue-age monitoring; configure the external absence alert before deployment.

The maintenance worker emits capped structured reconciliation counts every cleanup interval. Alert on non-zero running print jobs, old queued print jobs, duplicate groups in the recent print-job sample, unprocessed webhooks, invalid ready proofs, invalid deletion timestamps, and sustained growth or age of the pending platform outbox. Pending platform outbox events are expected until a real dispatcher is implemented, so monitor trend and oldest age rather than treating every row as a delivery failure.

Production artifact cleanup retains database metadata after deleting live object bytes. Alert on artifacts with old `cleanupClaimedAt` values or repeated `lastCleanupError` values. A failed or ambiguous delete remains unavailable to downloads until stale-claim recovery retries the idempotent object removal and finalizes metadata. Backup rotation remains a separate operational process.

Review indefinite and long-lived artifact retention holds on an operational schedule. Hold placement and release are restricted to owners and production operators and create audit events containing the reason and optional expiry. Do not release a legal hold without the corresponding external approval record.

Artifact operational checks run on an independent maintenance timer and are retained for 30 days. Configure log ingestion for one-line JSON events and alert on `operations.scheduler_failed` or `operations.artifact_cleanup_check` with a failed outcome. The database alert rules are:

| Condition | Warning | Critical |
| --- | --- | --- |
| Oldest eligible artifact overdue | More than 15 minutes | More than 60 minutes |
| Stale cleanup claim | Any claim older than 20 minutes | Older than 45 minutes or at least 10 stale claims |
| Cleanup retries | At least three attempts | At least five attempts |
| Indefinite hold review | Older than 90 days | Not paging |
| Operational check failure | Not applicable | Every failed check |

The Operations page is durable tenant-facing delivery, not an infrastructure paging channel. Before production launch, configure the signed alert webhook and an external worker-heartbeat alert so a worker or database outage does not depend on someone opening the admin app.

Set `PK_OPERATIONS_ALERT_WEBHOOK_URL` to a public HTTPS endpoint on port 443 and set `PK_OPERATIONS_ALERT_WEBHOOK_SECRET` to at least 32 random characters. The worker resolves every delivery, rejects any private/reserved answer, pins one validated address while retaining TLS hostname verification, refuses redirects, and defaults to a five-second timeout.

The receiver must reject timestamps outside a five-minute replay window and deduplicate `X-PK-Idempotency-Key`. Verify `X-PK-Signature` as base64url HMAC-SHA256 over this exact UTF-8 canonical value:

```text
<X-PK-Timestamp>\n<X-PK-Idempotency-Key>\n<X-PK-Delivery-ID>\n<raw request body>
```

Return any `2xx` only after durably accepting the event. `408`, `425`, `429`, network failures, timeouts, and `5xx` responses retry with exponential delay capped at 15 minutes. Other `4xx` responses become terminal failed deliveries and are visible on the Operations page. Rotate the secret by coordinating receiver acceptance before updating the worker environment; queued bodies and idempotency identities remain unchanged.

## OpenTelemetry

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to the OTLP/HTTP collector base URL, for example `http://otel-collector:4318` on a private deployment network. Use `OTEL_EXPORTER_OTLP_HEADERS` for collector authentication, set `OTEL_SERVICE_VERSION` to the deployed revision, and keep `OTEL_METRIC_EXPORT_INTERVAL_MS` between 5 and 300 seconds. The SDK appends `/v1/traces` and `/v1/metrics`, flushes during graceful shutdown, and is disabled when the endpoint is blank.

The API exports server request spans and metrics, and the admin initializes server-only Next.js telemetry. Connector inbox transactions, committed outbox creation, artifact URL issuance, and local object downloads emit domain spans or metrics. Maintenance, proof, and render workers export task or job spans plus bounded outcome and duration metrics. Worker shutdown stops new claims and waits for the active claim before flushing telemetry; keep the configured container stop grace period longer than the maximum expected claim duration.

Current instrumentation covers API server requests, admin server activity, connector inbox outcomes and backlog, committed outbox creation and backlog, artifact URL issuance and byte downloads, maintenance tasks, proof/render jobs, artifact cleanup, deletion processing, operational checks, and alert delivery. Metric attributes are limited to stable route, method, producer, event type, worker, task, kind, check, status class, and outcome values. Merchant, artifact, job, delivery, and correlation identifiers must remain trace/log fields rather than metric dimensions.

Alert on missing telemetry at the collector independently of in-process database checks. OpenTelemetry cannot report the complete failure of the process that should emit it.

Configure an external absence alert for `pk.worker.polls` grouped by the fixed `worker` attribute. With the default 60-second export interval, page when `maintenance`, `proof`, or `render` has produced no new poll samples for three minutes, and keep a separate collector-target/process availability alert so exporter or network failure is not misdiagnosed as queue failure. The `idle` outcome is a healthy heartbeat and must not alert; alert separately on sustained `failed` outcomes and queue-age thresholds.

Inspect failures with `docker compose --env-file /etc/personalise-kings/production.env -f compose.production.yml logs <service>`. Never include environment dumps or signing credentials in support logs.
