# Production Deployment

## Topology

`compose.production.yml` provides the initial single-host topology:

- PostgreSQL 16 with a private persistent volume.
- A one-shot Prisma migration service that must complete before application services start.
- Admin, customiser, and API HTTP services bound to loopback for an external TLS reverse proxy.
- Maintenance, render, and proof workers with PostgreSQL-authoritative work queues.
- An unexposed media-sanitizer service on a dedicated internal network for bounded raster decoding and re-encoding.
- An unexposed, non-persistent Redis instance used only for disposable connector-inbox BullMQ wake-ups.
- Local mode uses one durable object volume shared by admin, API, maintenance, render, and proof services. S3-compatible mode uses a shared remote bucket instead.

Redis accelerates connector-inbox processing only; it is not a source of truth and is not yet used for coordinated API rate limiting or platform outbox dispatch. Run one API replica until a coordinated edge or Redis-backed limiter replaces the in-process limiter. S3-compatible storage removes the shared-filesystem constraint, but does not make the in-process API rate limiter safe for multiple API replicas.

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
OBJECT_STORAGE_BACKEND=local
OBJECT_STORAGE_MAX_BYTES=26214400
PK_MEDIA_SANITIZER_TIMEOUT_MS=20000
PK_WEBAPP_URL=https://admin.example.com
PK_CUSTOMISER_URL=https://customiser.example.com
PK_API_URL=https://api.example.com
PK_ADMIN_MFA_ENCRYPTION_KEY=<openssl rand -base64 32>
PK_ADMIN_RECOVERY_CODE_PEPPER=<openssl rand -base64 48>
PK_CONNECTOR_SECRET_ENCRYPTION_ACTIVE_KEY_ID=wk_2026_07
PK_CONNECTOR_SECRET_ENCRYPTION_KEYS={"legacy":"<current base64 key>","wk_2026_07":"<new openssl rand -base64 32 key>"}
# Keep this equal to the keyring's legacy entry during the compatibility rollout.
PK_CONNECTOR_SECRET_ENCRYPTION_KEY=<current base64 key>
PK_EMBED_TOKEN_SECRET=<openssl rand -base64 48>
PK_OBJECT_URL_SECRET=<openssl rand -base64 48>
```

Use three distinct exact HTTPS origins on port 443 and generate every secret independently. Production startup rejects absent or unknown `NODE_ENV` values, HTTP/path-bearing origins, invalid storage backend settings, malformed AES keys, secrets shorter than 32 bytes, common placeholder values, and reused secrets. Keep encryption keys recoverable through the secrets backup process; losing them makes encrypted TOTP and connector credentials unreadable.

`PK_WEBAPP_URL` is also the WebAuthn origin and relying-party source. Changing its hostname invalidates passkey authentication until users enroll credentials for the new relying party. TLS termination must preserve the configured public origin, and reverse-proxy rewrites must not expose the admin on additional origins.

The demonstration seed requires both `NODE_ENV=development` and `PK_ALLOW_DEMO_SEED=true`, refuses to run in production, and does not reset an existing owner's password. Never put either demonstration flag in a production environment file. `PK_ENABLE_INSECURE_DEVELOPMENT=true` is an additional explicit gate for development-only bypass behavior and is also forbidden operationally in production.

Production Compose provides secrets only to services that use them. Proof, render, and maintenance workers must not receive admin MFA, connector-encryption, embed-token, or object-URL signing secrets unless a reviewed feature creates a concrete need.

### Media Sanitizer

API and admin raster promotion depends on the private `media-sanitizer` service. Compose sets `PK_MEDIA_SANITIZER_URL=http://media-sanitizer:3003`; production validation permits cleartext HTTP only for that exact isolated service hostname. Do not publish port 3003 or attach the sanitizer container to the default/external network.

The service has no database, object-storage, connector, or application secrets. It runs read-only as the unprivileged application user with dropped capabilities, a bounded temporary filesystem, one CPU, a 768 MiB memory ceiling, a PID ceiling, Sharp concurrency of one, and one active request. The caller enforces a 20-second timeout. Sanitization fully decodes one static PNG, JPEG, or WebP, rejects malformed/animated/oversized input, applies EXIF orientation, converts to sRGB, and re-encodes without source metadata. Only the re-encoded bytes enter trusted asset storage; rejected originals remain in the existing quarantine flow.

For local development, run `bun run dev:media-sanitizer` alongside API and admin. Keep `PK_MEDIA_SANITIZER_URL=http://127.0.0.1:3003` in the development environment only.

### Connector Wrapping-Key Rotation

Connector and WooCommerce REST credentials use authenticated `v3` envelopes containing a wrapping-key ID and tenant/store/purpose-bound associated data. Existing unversioned REST ciphertext and `v2` webhook ciphertext remain readable only through the keyring entry named `legacy`.

1. Deploy keyring-aware code with the current singular key still configured.
2. Configure `PK_CONNECTOR_SECRET_ENCRYPTION_KEYS` with `legacy` and a newly generated key, set `PK_CONNECTOR_SECRET_ENCRYPTION_ACTIVE_KEY_ID` to the new key ID, and restart API and admin together.
3. Preview one tenant without writes:

```bash
docker compose --env-file /etc/personalise-kings/production.env -f compose.production.yml run --rm web-admin \
  bun run db:reencrypt-connector-secrets --merchant-id <merchant-id> --to-key-id wk_2026_07 --dry-run
```

4. Run that tenant without `--dry-run`, verify connector authentication and WooCommerce health, then migrate all tenants explicitly:

```bash
docker compose --env-file /etc/personalise-kings/production.env -f compose.production.yml run --rm web-admin \
  bun run db:reencrypt-connector-secrets --all-tenants --to-key-id wk_2026_07 --batch-size 100
```

The command scans REST credentials, active/retired/revoked webhook keys, and the legacy Store mirror. It skips completed `v3` rows, conditionally updates unchanged ciphertext only, and creates one atomic `connector_secret.reencrypted` audit event per mutation. Any decrypt failure or concurrent replacement leaves the row untouched and exits non-zero. Re-run until the candidate count reaches zero.

Keep `legacy` and historical wrapping keys until all live rows are migrated, the rollback window has passed, and backups containing old ciphertext have expired or have a documented restore-and-re-encrypt path. Removing a key earlier makes those records irrecoverable.

## Build And Rollout

From the checked-out, reviewed release revision:

```bash
docker compose --env-file /etc/personalise-kings/production.env -f compose.production.yml build
docker compose --env-file /etc/personalise-kings/production.env -f compose.production.yml up -d postgres redis media-sanitizer
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

In local mode, `postgres-data` and `object-storage` are the only application data volumes. They must not be removed during routine deployments. The object volume must be mounted at `/data/personalise-kings/objects` in every storage-consuming service.

The local object backend is suitable only for the initial single-host deployment. Do not run application containers on separate hosts against unsynchronised filesystems. Monitor free space, inode usage, PostgreSQL growth, failed proof jobs, and deletion requests awaiting backup purge confirmation.

For S3-compatible storage, set `OBJECT_STORAGE_BACKEND=s3`, `OBJECT_STORAGE_S3_BUCKET`, and `OBJECT_STORAGE_S3_REGION`. Set `OBJECT_STORAGE_S3_ENDPOINT` only for a compatible non-AWS endpoint; production requires HTTPS. Set `OBJECT_STORAGE_S3_FORCE_PATH_STYLE=true` only when the provider requires path-style addressing. Supply credentials through an IAM task/instance role where possible, or the standard `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optional `AWS_SESSION_TOKEN` variables. Every storage-consuming service needs the same backend settings and bucket access. Grant only `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, and `s3:ListBucket`/bucket-head access for the configured bucket, enforce encryption and block public access at the bucket policy, and configure versioning/lifecycle rules as part of the backup policy. Browser uploads and downloads continue through short-lived application-signed API URLs; the bucket does not require public access or browser CORS.

See [`BACKUP_AND_RESTORE.md`](BACKUP_AND_RESTORE.md) before storing production data.

## Health And Operations

- Admin readiness: `GET https://admin.example.com/api/health` checks PostgreSQL and writable object storage.
- Customiser liveness: `GET https://customiser.example.com/api/health`.
- API liveness: `GET https://api.example.com/health`.
- Workers emit bounded `pk.worker.polls` heartbeat metrics and also rely on process restart policy and queue-age monitoring; configure the external absence alert before deployment.

The maintenance worker emits capped structured reconciliation counts every cleanup interval. Alert on non-zero running print jobs, old queued print jobs, duplicate groups in the recent print-job sample, unprocessed webhooks, invalid ready proofs, invalid deletion timestamps, and sustained growth or age of the pending platform outbox. Pending platform outbox events are expected until a real dispatcher is implemented, so monitor trend and oldest age rather than treating every row as a delivery failure.

Connector event HTTP success means the authenticated envelope was durably committed to `WebhookDelivery`; it does not mean order processing completed in the request. The maintenance worker claims due inbox rows with random tokens and processes order, line-item, print lifecycle, audit, and platform-outbox changes in one serializable transaction. Failed transient attempts retry from 15 seconds up to 15 minutes and become terminal after ten attempts. Invalid stored envelopes and invalid customisation references fail immediately. Claims older than 15 minutes are reclaimed with a new token, and stale workers cannot complete or reschedule them.

Alert on `pk.connector.inbox.backlog.failed` above zero, sustained growth in `pk.connector.inbox.backlog.pending`, and repeated failed `pk.connector.inbox.wakeups`. Terminal rows retain a bounded error for operator investigation. BullMQ jobs contain only a `WebhookDelivery` ID, run once without broker retries, and are removed immediately. API enqueue failure never rolls back a receipt; the maintenance worker polls PostgreSQL unconditionally and republishes bounded due work, so Redis flushes, restarts, or prolonged outages cannot lose or alter inbox state or retry ownership.

The Redis container is digest-pinned, unexposed, attached only to the internal connector queue network, configured with `noeviction`, and has AOF and snapshots disabled. It has no persistent volume by design. Do not place business payloads, retry schedules, attempt counts, or completion state in Redis. Rebuilding it must be operationally safe at any time.

WooCommerce connector `0.13.0` keeps privacy-bounded diagnostics locally in WordPress. Review **WooCommerce > PersonaliseKings** and **Tools > Site Health** for queue backlog, stale claims, scheduler state, API liveness, and 14-day delivery/failure counters. Site Health sends only a credential-free `GET /health` with a neutral connector user agent. Debug information excludes endpoint hosts, store/key/order/product IDs, payloads, customisation references, response bodies, and credentials. Resetting diagnostics deletes counters only; it never alters the durable outbox or connector configuration. Delivered/superseded rows retain for 30 days, failed/cancelled rows retain for 90 days, and active rows do not expire.

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
