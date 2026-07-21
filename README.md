# PersonaliseKings Webapp

Standalone personalisation platform for WooCommerce-first product customisation, preview, order ingestion, and UV print-file generation.

## Workspace

- `apps/web-admin` merchant/admin webapp
- `apps/customiser` hosted iframe-first customer customiser
- `apps/api` platform-neutral connector API
- `apps/worker-proof` isolated Playwright PNG proof worker
- `packages/db` Prisma schema and database client
- `packages/render-schema` canonical scene graph schema
- `packages/design-engine` deterministic canonical SVG preview renderer
- `packages/connector-contracts` signed connector event contracts
- `packages/auth` MVP roles and permission helpers
- `packages/storage` object-storage abstraction
- `packages/observability` correlation ID helpers

## First Run

```bash
bun install
cp .env.example .env
bun run dev:services
bun run prisma:migrate
bun run db:seed
bun run prisma:generate
bun run dev:web
```

Workers can be started separately:

```bash
bun run worker:maintenance
bun run worker:render
bun run worker:proof
```

Phase 0 production-export validation still needs the real printer/RIP details before production PDF work begins.

## Continuous Integration

`CI` is the merge and release correctness gate. It installs the committed Bun lockfile, generates and validates Prisma, deploys every migration to a clean PostgreSQL 16 service, validates Compose and connector syntax, then runs all workspace typechecks, tests, and production builds.

`Security` runs on pull requests, protected-branch pushes, a weekly schedule, and manual dispatch. It performs Bun and pull-request dependency audits, full-history secret scanning, Trivy infrastructure configuration scanning, and uploads an SPDX JSON software bill of materials. All third-party workflow actions are commit-SHA pinned; Dependabot proposes grouped weekly action updates.

Configure branch protection for `main` and `develop` to require `Validate workspace` plus every applicable `Security` job. GitHub secret scanning and push protection must also be enabled in repository settings. See [`docs/DEPENDENCY_POLICY.md`](docs/DEPENDENCY_POLICY.md) for supported runtimes, update cadence, vulnerability exceptions, and the container-image gate that activates with production Dockerfiles.

## Local Object Uploads

`POST /api/assets/upload-intents` returns a short-lived `signedPutUrl`. Upload the bytes with the returned `Content-Type` header, then call the promotion route to validate and move the object out of temporary storage.

The hosted customiser loads its token-bound design from `GET /v1/customiser/config`. Image layers use the equivalent `/v1/customiser/uploads` intent and promotion flow, restricted to PNG, JPEG, and WebP files. Set `PK_CUSTOMISER_URL` to the customiser's exact public origin so API CORS checks can distinguish the iframe from the parent shop.

The Designs page contains the first constrained builder. Publishing creates an immutable `DesignVersion` with a versioned `customiser-config.v1` policy for approved colours, text limits, image uploads, DPI guidance, and customer transform controls. Existing designs publish a new version rather than changing historical versions.

Editable customiser layers can be positioned by pointer or touch dragging. Keyboard focus on a layer provides arrow-key movement in 0.5 mm steps, with Shift for 2.5 mm and Alt for 0.1 mm; numeric millimetre inputs remain available as the precise accessible alternative.

The live customiser artwork, committed SVG preview, and Playwright proof input now use the same design engine. The editor keeps transparent accessible controls above that artwork for selection and gestures, avoiding a second visual transform/font implementation while retaining a safe DOM fallback if a referenced asset is temporarily unavailable.

Saving a customisation now generates a deterministic revision-bound SVG preview from the canonical micrometre scene. Referenced font and raster bytes are embedded from accepted tenant-owned asset versions, the preview is stored privately with a checksum, and clients receive only a short-lived signed URL. Preview failure does not invalidate an otherwise valid immutable commit; the correlated failure remains visible to operators for follow-up.

The separate proof worker claims PostgreSQL-backed jobs and renders those self-contained previews to PNG with pinned Playwright Chromium. Browser network access is blocked, dimensions and generated SVG structure are validated, interrupted claims recover after 15 minutes, and temporary failures retry with capped exponential backoff. Start it with `bun run worker:proof`.

Install the pinned proof browser and its Linux libraries on worker hosts with `bunx playwright install --with-deps chromium`. Container images should run that installation during the image build and keep the resulting Playwright browser revision aligned with `apps/worker-proof/package.json`; production should not download a browser at process startup.

On touch screens, two pointers can scale and rotate a selected layer when those controls are enabled by its immutable design policy. Gesture output uses the same bounded permille scale and milli-degree rotation stored in the canonical scene graph.

WooCommerce cart lines now expose an edit link that reopens the latest eligible customisation revision. Saving appends a new immutable revision and replaces only that cart line's opaque reference through a nonce-protected same-origin request. The reference is resolved from the WooCommerce cart session rather than exposed in the edit URL.

The Product Mappings page can create, reassign, activate, and deactivate WooCommerce product or variation mappings. A blank variation ID is an all-variants fallback; an exact variation mapping takes precedence, and an inactive exact mapping can explicitly disable the fallback. The connector performs a signed lookup before rendering a variable-product iframe.

WooCommerce connector `0.8.0` supports classic before-cart placement, mapped-product gallery replacement, a native full-screen modal, and template-controlled placement. Block themes can insert the PersonaliseKings Customiser block; classic templates can use `[personalise_kings_customiser]` or `personalise_kings_render_customiser()`. Rendering is deduplicated if a theme invokes more than one adapter.

Connector `0.9.0` sandboxes the hosted iframe to scripts and its distinct origin, sends no referrer, and disables camera, microphone, geolocation, and payment features. The customiser response binds the token-approved shop origin to the iframe query origin before assets or editing are enabled, while a per-request CSP restricts framing to that exact shop.

API JSON bodies are streamed through route-specific byte limits before parsing, object uploads cannot exceed or change the type approved by their database intent, and a bounded per-process limiter protects current single-instance development deployments. Production ingress must still provide coordinated edge or Redis limits after trusted proxy addresses are explicitly configured.

Deletion Requests execute live erasure for tenant-owned customer upload assets and versions. The maintenance worker scans canonical scenes and snapshots for exact references, blocks design- or order-bound artwork, archives affected unordered sessions, cancels proof work, removes embedded SVG/PNG derivatives and source objects, then deletes live metadata. Requests remain `live_deleted` until an operator separately confirms external backup rotation; backup restoration procedures must replay the external erasure ledger to prevent resurrection.

Admin authentication uses opaque database sessions rather than self-contained cookies. A valid password creates only a ten-minute pending session; users must enroll or verify a TOTP authenticator before the token is rotated into an eight-hour authenticated session. TOTP steps cannot be replayed, recovery codes are high-entropy and single-use, role changes revoke active sessions, and Settings lists sessions for individual or bulk revocation. Configure `PK_ADMIN_MFA_ENCRYPTION_KEY` and `PK_ADMIN_RECOVERY_CODE_PEPPER` before production deployment.

Store connector signing credentials are versioned independently from WooCommerce REST credentials. Creating or rotating a key returns its plaintext secret once, retires the previous key for a controlled overlap, and leaves durable outbox event identities unchanged because delivery signs with the plugin's current atomic credential snapshot. Install the replacement in WooCommerce before revoking the retired key. Connector `0.10.0` migrates a complete legacy key/secret pair into one non-autoloaded option and never renders the stored secret back into settings HTML.

Mappings can apply an integer price change in the store currency's minor units. WooCommerce resolves and briefly caches the signed mapping response, applies the modifier from the product's original price, displays it before and after adding to cart, and preserves it in order-sync metadata. Identical customisation references merge into quantity while different references remain separate cart lines.

## WooCommerce Store Connection

The Stores page uses WooCommerce's native `wc-auth/v1/authorize` flow for one-click approval. Enter the store's public HTTPS base URL, approve the requested read-only key in WooCommerce, and WooCommerce sends the key to a separate callback before returning the browser to the admin. Authorization attempts are random, single-use, expire after 15 minutes, and are bound to the initiating merchant and staff user.

Set `PK_WEBAPP_URL` to the admin webapp's public HTTPS origin and configure `PK_CONNECTOR_SECRET_ENCRYPTION_KEY` as a base64-encoded 32-byte key. Consumer key/secret pairs are stored together under AES-256-GCM encryption in PostgreSQL and are never included in Store API or page props. Rotation creates a fresh encrypted credential record so an older in-flight health check cannot overwrite it.

Manual REST key entry remains available as a fallback. Create a dedicated Read key under WooCommerce > Settings > Advanced > REST API; the webapp must complete an authenticated API request before it saves the replacement. Health requests require HTTPS, reject private/reserved DNS results, pin the validated address for the TLS connection, refuse redirects, and time out. `PK_ALLOW_PRIVATE_STORE_URLS=true` permits local development stores only outside production.

Revoking a store deletes the locally encrypted REST credential and invalidates outstanding approval attempts. Because a read-only key cannot delete itself remotely, also revoke the matching key in WooCommerce if it remains listed there. Every approval start, successful connection or rotation, denial, health check, and revocation creates an audit event.

## Order Lifecycle Sync

WooCommerce connector `0.7.0` asynchronously sends signed paid, updated, cancelled, and refunded order events through a durable local outbox. Event IDs, nonces, idempotency keys, payloads, occurrence times, connector identity, and store binding remain frozen across retries, and refund events include partial-refund details when available.

The API serialises updates for each store/order pair and persists the latest event timestamp and type on the external order. Delayed events are retained in the webhook inbox but cannot overwrite a newer lifecycle state. Equal-time events are resolved conservatively in the order cancelled, refunded, paid, then updated.

Cancellation and refund events cancel queued or failed print jobs. Running, ready, or already review-required jobs move to `needs_review` for an operator decision. Full cancellation or refund cancels the affected customisation session, while a partial refund moves it to `needs_review`.

The connector also runs an HPOS-compatible modified-order reconciliation every 15 minutes. It scans from a persisted watermark with a five-minute overlap, snapshots matching order IDs before batching, and advances the watermark only after every result is present in the local queue. Parent-order, product-line, payload-relevant item metadata, and refund-deletion hooks cover updates that legacy order storage may not expose through the modified timestamp. Temporary transport and server failures remain in the capped retry loop until delivery succeeds.

Signed store lifecycle events remain valid after the customer editing window expires. Empty-line cancellation and refund snapshots are accepted, while removing or replacing a personalised line cancels its queued production work or moves started work to `needs_review`. The Connector Health table shows the last successful scan, order count, watermark, and scan error. Action Scheduler maintains the recurring scan when available; WP-Cron provides the fallback.

## Connector Outbox

The versioned `pkc_outbox` WordPress table is authoritative for local delivery. Action Scheduler and WP-Cron only provide replaceable wake-ups. Rows use atomic claim tokens and scheduler generations, recover interrupted processing after 15 minutes, retry temporary failures indefinitely with a 15-minute cap, and preserve permanent failures for merchant action. A five-minute sweep repairs missing wake-ups without risking duplicate logical events.

WooCommerce > PersonaliseKings lists active and historical events with status filtering, pagination, attempts, next-run time, HTTP/error context, and nonce-protected run, retry, and cancel controls. Delivered and superseded rows are retained for 30 days; cancelled and failed rows are retained for 90 days. Pending and processing rows are never removed by cleanup.

Pending or failed scheduler actions created before connector `0.7.0` are preserved as quarantined failed rows because those versions did not persist an immutable store binding. They are never guessed against the current connection. Use the order's Resync to PersonaliseKings action to create a fresh, safely bound event.
