# PersonaliseKings Webapp Plan

## Build Status

### Done

- Created the standalone monorepo structure with `apps/*` and `packages/*` workspaces.
- Added `apps/web-admin` as the merchant/admin Next.js app.
- Added `apps/customiser` as the hosted iframe-first customer customiser.
- Added `apps/api` as the platform-neutral connector/customiser API service.
- Added `apps/worker-maintenance` for durable outbox dispatch scaffolding.
- Added `apps/worker-render` for print-job attempt scaffolding.
- Added `apps/woocommerce-connector` as a new lightweight WooCommerce connector plugin scaffold.
- Added local development services for PostgreSQL and Redis through `docker-compose.yml`.
- Added Prisma schema covering merchants, merchant settings, staff users, stores, product mappings, designs, design versions, assets, asset versions, output profiles, customisation sessions, customisation revisions, external orders, line items, artwork snapshots, print jobs, print attempts, generated artifacts, webhook deliveries, outbox events, audit events, and deletion requests.
- Added seed data for a demo merchant, WooCommerce store, design, design version, product mapping, and placeholder UV output profile/version.
- Added shared packages for auth/RBAC, connector contracts, render schema, object storage, observability, and database access.
- Added MVP staff role definitions for owner/admin, designer, production operator, support, and read-only auditor.
- Added merchant login with scrypt password hashing and signed HTTP-only session cookies.
- Added RBAC permission enforcement helpers and protected staff/settings/deletion routes.
- Added staff management APIs and admin page for the MVP roles.
- Added audit event helper and audit page.
- Added audit logging for login, logout, staff create/update, asset promotion, deletion-request creation, settings changes, and manual print job creation.
- Added the first canonical scene graph schema using physical micrometre coordinates.
- Added platform-neutral connector order/event schemas.
- Added signed embed-token helpers binding store, origin, product, variant, design, and expiry.
- Added local filesystem-backed object storage behind an object-storage interface.
- Added asset upload intent and promotion API routes.
- Added HMAC-signed local object `PUT`/`GET` URLs and API object serving for the local storage backend.
- Added customer upload promotion validation using magic-byte raster detection for PNG, JPEG, and WebP.
- Added byte-size, dimension, and decoded pixel-count guardrails for customer upload promotion.
- Added quarantine/rejection handling and audit events for invalid customer uploads.
- Added Vitest workspace test scripts and initial automated tests for auth/session tokens, embed tokens, scene graph validation, and raster upload validation.
- Added configurable cleanup retention settings for temporary uploads, previews, and production artifacts.
- Added deletion request APIs and admin page for privacy/erasure tracking.
- Added product mapping admin page for WooCommerce product/variant to design links.
- Added output profile admin page and APIs for immutable output profile versions.
- Added print job regeneration API with guarded status transitions, outbox event creation, and audit logging.
- Added generated artifact listing and audited signed download URL API.
- Added artifacts admin page for production files and preflight status.
- Added admin pages for dashboard, stores, designs, output profiles, product mappings, assets, orders, print jobs, artifacts, staff, audit, deletion requests, and settings.
- Added admin API routes for auth, staff, stores, designs, output profiles, product mappings, customisations, orders, print jobs, generated artifacts, assets, settings, deletion requests, and embed-token creation.
- Added connector API ingestion for signed events, payload digest validation, webhook inbox persistence, duplicate-event handling, order upsert, line item refresh, and outbox creation.
- Added connector replay protection with sent-at timestamp window checks, store/nonce uniqueness, and nonce reuse rejection.
- Added production guard requiring connector signing secret configuration before accepting signed connector events.
- Added customiser commit API that validates embed tokens, creates customisation sessions, and creates immutable customisation revisions.
- Added paid-order ingestion logic that links line items to committed customisation revisions, creates order artwork snapshots, and queues print jobs.
- Added hosted customiser `postMessage` protocol schemas for ready, resize, committed, add-to-cart, cancel, error, variant-change, and save events.
- Updated the customiser UI to call the commit API when an embed token is present and return an opaque customisation reference.
- Added WooCommerce connector settings for webapp URL, API URL, store ID, signing key ID, and signing secret.
- Added WooCommerce product-page iframe embed that requests a short-lived embed token before rendering.
- Added WooCommerce cart/order metadata handling for customisation references.
- Added WooCommerce paid-order webhook delivery with HMAC signature and canonical payload digest.
- Added WooCommerce asynchronous paid-order delivery using Action Scheduler where available, with WP-Cron fallback.
- Added WooCommerce delivery retries and connector health state for last success/failure/error.
- Added WooCommerce manual order resync action and admin notice.
- Added WooCommerce cart/order item display of the PersonaliseKings customisation reference.
- Declared WooCommerce HPOS and Cart/Checkout Blocks compatibility in the connector scaffold.
- Added basic worker scaffolds that keep PostgreSQL as the authority rather than Redis.
- Added maintenance worker cleanup pass for expired temporary uploads, including asset deletion marking and audit events.
- Verified the current code with Prisma validation, TypeScript type checks, production builds, and PHP syntax checks.
- Added a token-authenticated customiser configuration endpoint that loads the mapped immutable design version and short-lived private asset URLs.
- Replaced the hard-coded customiser demo with a responsive constrained scene editor for template text and image layers, colour selection, live physical-coordinate preview, and numeric position, scale, rotation, and text-size controls.
- Added customer raster upload intents, bounded streaming uploads, quarantine validation, promotion to draft customisation storage, and non-blocking low-resolution warnings.
- Corrected customiser API origin validation so browser requests are bound to the hosted iframe origin while embed tokens remain bound to the parent shop origin.
- Tightened customiser commit validation so customers cannot change template-controlled layer order, names, fonts, dimensions, opacity, or geometry safety bounds.
- Added tests for constrained scene matching and customer image quality warnings, and moved raster validation into the shared storage package.
- Added `customiser-config.v1` as the shared schema for design-authored text, colour, image-upload, quality, and transform permissions.
- Added a responsive admin design builder that creates designs and publishes later immutable versions using accepted tenant-owned font and image assets.
- Added an audited design-version publication endpoint and server-side checks binding every editable rule and asset to the merchant's scene graph.
- Updated the customiser and commit API to enforce each immutable design version's approved colours, text limits, upload types/sizes, font-size range, and transform locks.
- Added the initial PostgreSQL migration baseline, including immutable design customiser configuration storage.
- Added pointer and touch positioning for editable customiser layers with physical-coordinate conversion, server-aligned bounds, and design-policy locks.
- Added keyboard layer nudging with documented 0.1 mm, 0.5 mm, and 2.5 mm steps plus live accessible position feedback and numeric alternatives.
- Added two-pointer pinch scaling and rotation using canonical permille and milli-degree transforms, with design-policy locks and server-aligned bounds.
- Added secure customisation resume checks binding the latest unexpired, un-ordered revision to the embed token's merchant, store, product, variant, design, and design version.
- Added serializable append-only recommits that update the mutable session while preserving every previous immutable customisation revision.
- Added WooCommerce cart edit links that resolve references from the customer's cart session without placing opaque references in URLs.
- Added nonce-protected cart-line reference replacement, edit-mode duplicate-add prevention, return-to-cart handling, and variant-change invalidation.
- Updated the WooCommerce connector scaffold to version 0.2.0 for the cart editing release.
- Added a responsive product/variant mapping manager with create, design reassignment, activation, deactivation, tenant isolation, uniqueness handling, and audit events.
- Fixed variant mapping persistence to populate the canonical external variant lookup key and added a data migration for mappings created by the earlier API.
- Added exact-variant override and all-variants fallback resolution, including explicit inactive-variant blocking semantics.
- Added an HMAC-authenticated connector mapping lookup so unmapped variable products do not render an empty customiser iframe.
- Updated the WooCommerce connector scaffold to version 0.3.0 for conditional mapping-aware embeds.
- Added optional positive or negative mapping-level price modifiers stored in currency minor units, with migration, admin controls, API responses, and audit history.
- Added signed mapping-detail caching and authoritative WooCommerce price application from an immutable base product price rather than browser-supplied amounts.
- Added storefront and cart price-adjustment display plus modifier and final line-total preservation in order-sync metadata.
- Replaced random cart identity keys with deterministic customisation-reference identity so identical references merge into quantity and different customisations remain separate.
- Added safe cart re-keying and quantity merging when an edited customisation receives a new immutable reference.
- Updated the WooCommerce connector scaffold to version 0.4.0 for price modifiers and deterministic cart behavior.
- Expanded the platform-neutral connector contract to cover signed `order.paid`, `order.updated`, `order.cancelled`, and `order.refunded` events with retry-stable event identities and RFC 3339 timestamps.
- Added WooCommerce status and refund hooks, partial-refund metadata, asynchronous retry delivery, and compatibility for paid-order actions queued by older connector versions.
- Added transactional order lifecycle reconciliation with order-scoped advisory locks, persisted event watermarks, stale-event suppression, idempotent print-job creation, and audited cancellation/refund transitions.
- Added lifecycle context to the Orders and Print Jobs admin pages and updated the WooCommerce connector scaffold to version 0.5.0.
- Added a recurring HPOS-compatible WooCommerce modified-order scan with stable ID snapshots, bounded processing batches, a persisted overlapping watermark, an owner-safe option lock, durable local queue checks, and reconciliation health details.
- Added fingerprinted modification events, fresh manual-resync identities, indefinite transient-delivery retries, and partial-refund recovery when WooCommerce leaves an order in a paid status.
- Added parent-order, product-line, payload metadata, and refund-deletion hooks so legacy-storage and item-only changes receive fresh occurrence timestamps.
- Added safe removed/replaced-line reconciliation, post-edit-expiry lifecycle handling, and empty-line order events so stale production work cannot survive an ecommerce edit.
- Updated the WooCommerce connector scaffold to version 0.6.0 for scheduled eventual-consistency reconciliation.
- Added a versioned WooCommerce `pkc_outbox` table as the local event authority, with immutable store and connector binding, frozen signed-event data, identity deduplication, atomic claims, scheduler generations, stale-claim recovery, and bounded retention.
- Replaced direct scheduler delivery with five-minute Action Scheduler/WP-Cron wake-up repair, indefinite transient retries, inspectable permanent failures, and database-first reconciliation watermark safety.
- Added a filtered and paginated Delivery Queue to Connector Health with per-event attempts, timing, HTTP/error context, and capability/nonce-protected run, retry, and cancel controls.
- Added conservative migration for draft outbox schemas and quarantine adoption for connector 0.5/0.6 scheduler actions whose original store binding cannot be proven.
- Updated the WooCommerce connector scaffold to version 0.7.0 and local outbox DB schema version 1.3.0.
- Added the native WooCommerce `wc-auth/v1/authorize` handshake with read-only scope, public-HTTPS store validation, random 15-minute single-use attempts, tenant/session-bound browser returns, and replay-safe credential callbacks.
- Added tenant-bound AES-256-GCM REST credential storage, verified manual-key fallback, atomic credential replacement, definitive-auth-failure detection, stale-check-safe health history, local revocation, and audit events for every connection change.
- Added SSRF-resistant WooCommerce health requests with public DNS validation, address pinning, TLS hostname verification, redirect refusal, response timeouts, and a development-only private-store override that cannot weaken production.
- Replaced the read-only Stores table with responsive native approval, manual fallback, health, re-authorization, and revocation controls without returning encrypted credential material to the browser.
- Added automated coverage for WooCommerce URL normalization, private/reserved IP blocking, native authorization parameters, and encrypted credential round trips.
- Added selectable WooCommerce placement adapters for classic hooks, mapped-product gallery replacement, a native modal, a dynamic block, shortcode, and manual theme rendering with duplicate-output protection.
- Updated the WooCommerce connector scaffold to version 0.8.0 for product-template placement compatibility.
- Added a deterministic shared SVG design engine that renders canonical physical-coordinate scenes with embedded tenant-owned fonts and raster assets, bounded output dimensions, print-area clipping, XML escaping, and reproducible transforms.
- Added best-effort preview generation for every immutable customisation revision, stored as an accepted preview asset with checksum and dimensions and returned through a short-lived signed URL on commit.
- Added revision preview relations and migration, audited tenant-scoped admin preview URL issuance, preview retention cleanup, and artwork-view permissions for owner/admin and production roles.
- Added a separate Playwright proof worker with PostgreSQL-authoritative revision jobs, atomic claims, stale-worker recovery, capped exponential retries, blocked browser networking, bounded generated-SVG validation, and immutable PNG proof assets.
- Added proof status to customisation/order APIs and audited tenant-scoped signed proof URL issuance for staff.
- Pinned the proof worker to Playwright `1.61.1` and documented build-time Chromium plus Linux dependency installation so production workers never download browsers at runtime.
- Replaced the live customiser's separate visual layer renderer with the shared canonical SVG output while preserving transparent pointer, touch, keyboard, focus, and selection overlays plus a missing-asset fallback.
- Added cross-pipeline geometric fixtures covering physical view boxes, clipping, edge placement, layer order, multiline text, image fit, opacity, transforms, source-type safety, and proof-record dimension matching.
- Added byte-counted streaming JSON limits with 413/415 responses, bounded per-process API rate limiting, upload intent size/type enforcement at PUT and promotion, malformed object-key handling, and production fail-closed object URL signing.
- Added nonce-based CSP and browser security policies for the admin and customiser, dynamic exact-origin `frame-ancestors`, token-to-parent-origin binding, a sandboxed/permission-restricted WooCommerce iframe, and the remaining same-origin checks on privileged admin actions.
- Updated the WooCommerce connector scaffold to version 0.9.0 for iframe isolation and referrer/feature restrictions.
- Added executable customer-upload deletion requests with constrained lifecycle states, atomic worker claims, exact JSON reference discovery, ordered/design usage blocking, persisted retry plans, monotonic live-storage deletion, derivative/session metadata erasure, and audit summaries.
- Added admin controls to queue upload assets or versions, recheck blocked/failed requests, distinguish live deletion from backup completion, and record explicit backup-purge evidence.
- Added a serializable commit-time asset recheck so a concurrent deletion cannot be followed by a new immutable revision using the erased upload.
- Replaced stateless admin cookies with opaque, SHA-256-hashed PostgreSQL sessions supporting pending MFA state, token rotation on elevation, server-side revocation, bounded device metadata, expiry cleanup, and self-service session revocation.
- Added mandatory authenticator-app TOTP enrollment with AES-256-GCM purpose-bound secret encryption, atomic time-step replay prevention, ten high-entropy one-time recovery codes stored as peppered hashes, and dedicated enrollment/verification UI.
- Removed arbitrary MFA flag changes from staff administration, revoke sessions on role changes, protect the final owner/admin, and hide development seed credentials in production.
- Added versioned per-store connector signing keys with active, retired-overlap, and revoked states; store/key-bound authenticated encryption; one-time rotation secrets; tenant-scoped rotation/revocation APIs; full-store key revocation; and legacy-key migration.
- Replaced torn WooCommerce key/secret options with one non-autoloaded atomic credential bundle while preserving late-bound outbox signing so existing durable events automatically use the newly installed key.
- Updated the WooCommerce connector scaffold to version 0.10.0 and removed the remaining production embed-token development-secret fallback.
- Added a PostgreSQL-backed GitHub Actions correctness gate covering frozen dependency installation, Prisma generation/validation, clean-database migration deployment, Compose validation, connector syntax, workspace typechecks/tests, and production builds.
- Added SHA-pinned dependency review, Bun vulnerability auditing, full-history secret scanning, Trivy configuration scanning, SPDX JSON SBOM generation, weekly GitHub Actions updates, and a documented runtime/update/exception policy.
- Added digest-pinned multi-stage production images for the Bun application surface and Playwright proof worker, with non-root runtime execution and build-time installation of the exact Chromium revision.
- Added single-host production orchestration with a migration gate, PostgreSQL health dependency, loopback-only HTTP bindings, service health checks, hardened application containers, and shared durable object storage.
- Added mandatory application, proof-worker, and PostgreSQL image vulnerability scans and per-image SPDX SBOM artifacts.
- Documented TLS reverse-proxy boundaries, cache/rate-limit constraints, secret handling, rollout/rollback rules, persistent-volume requirements, PostgreSQL PITR/WAL coverage, object backups, erasure replay, and quarterly isolated restore drills.
- Added bounded PostgreSQL queue reconciliation with claim-fenced deletion preparation, stale/null/exhausted proof and deletion repair, conflict-safe missing-proof recreation from valid immutable previews, audit events, queue anomaly reporting, and claim lookup indexes.
- Added CI-only migrated-PostgreSQL integration coverage for proof/deletion repair, concurrent compare-and-set fencing, audit creation, missing-proof idempotency, malformed preview rejection, and preservation of backup-erasure boundaries.
- Added retention-driven generated-artifact byte cleanup with durable stale-recoverable claims, indefinite bounded retries, signed-download leases, tenant-bound storage keys and relation chains, retained immutable metadata, explicit availability UI/API state, and backup-safe audit evidence.
- Added tenant-scoped legal/operational artifact retention holds with optional expiry, dedicated owner/production permissions, atomic cleanup exclusion, reasoned audit events, expiry-aware replacement, and admin controls.
- Added collector-independent operational monitoring with validated correlations, bounded one-line JSON logging, independent artifact-cleanup checks, capped SQL metrics, PostgreSQL check history, deduplicated alert lifecycle, audited acknowledgement, role-scoped Operations UI, and 30-day history pruning.
- Added durable signed operational-alert webhook delivery for immutable open/escalate/acknowledge/resolve/reopen transitions, with versioned idempotency, public-DNS validation and address pinning, TLS hostname verification, replay-bound signatures, database-clock claims, stale recovery, bounded retries, and terminal permanent-failure visibility.
- Added optional OpenTelemetry OTLP/HTTP tracing and metrics for API, admin, connector inbox/outbox, artifact download, maintenance, proof, and render boundaries, including W3C server-context propagation, low-cardinality route/task/job/outcome instruments, serialized SDK startup, active-claim draining, graceful flush, and no-op operation when no collector is configured.
- Closed privileged admin mutation audit gaps, enforced design-management RBAC before asset promotion, added capability-issuance audits, and made database mutation/audit pairs atomic for assets, customisations, order sync, output profiles, print jobs, and connector signing keys.
- Added centralized fail-closed production configuration validation across API, admin, customiser, and workers; blocked demonstration seeding in production, stopped seed reruns resetting owner passwords, gated insecure development behavior explicitly, rejected weak/placeholder/reused secrets and invalid origins/keys, and reduced per-container secret exposure.
- Updated the WooCommerce connector to `0.11.0` with public-HTTPS endpoint validation, local-only HTTP exceptions, bounded signing credential validation, safe outbound requests, redirect refusal, and response-size limits.
- Updated the WooCommerce connector to `0.12.0` with durable product/variant mapping requirement snapshots and fail-closed add-to-cart validation for previously confirmed personalised products during connector or API outages.
- Added versioned connector wrapping-key keyrings, tenant/store/purpose-bound `v3` ciphertext, strict legacy-key reads, new-write key selection, and an explicit tenant-scoped or all-tenant resumable re-encryption CLI with compare-and-swap updates and atomic audits.
- Added tenant-bound discoverable WebAuthn passkeys with required device user verification, five-minute single-use database challenges, counter fencing, passwordless MFA-complete session creation, audited registration/login/revocation, and self-service Settings controls.
- Added an explicit S3-compatible object-storage backend with bounded server-side transfers, API-proxied signed browser capabilities, backend-neutral readiness checks, IAM/provider-chain credentials, endpoint/path-style support, fail-closed production configuration, strict tenant key segments, and ownership/class validation at persisted-key consumers and erasure plans.
- Replaced raster header sniffing with an isolated Sharp/libvips sanitizer that fully decodes one static PNG/JPEG/WebP under input, pixel, dimension, frame, output, concurrency, CPU, memory, PID, timeout, and private-network limits; normalizes EXIF orientation and sRGB; strips metadata through canonical re-encoding; and stores only sanitized bytes for customer and admin raster promotions.
- Split connector webhook receipt from business processing: authenticated requests now commit a deduplicated PostgreSQL inbox row before returning, while the maintenance worker uses random claim tokens, `SKIP LOCKED`, database-time stale recovery, capped retries, deterministic terminal failures, and token-fenced serializable transactions that atomically apply order/print lifecycle effects, create platform outbox rows, and complete the inbox delivery.
- Added BullMQ/Redis connector-inbox wake-ups with stable database-derived job IDs, best-effort post-commit enqueueing, targeted PostgreSQL claims, bounded due-work reconciliation, queue reconstruction after Redis loss, disposable one-attempt jobs, graceful worker shutdown, an internal non-persistent Redis service, and continued unconditional PostgreSQL polling as the durability fallback.
- Updated the WooCommerce connector to `0.13.0` with privacy-bounded local telemetry: compare-and-swap 14-day fixed counters, live payload-free queue aggregates, scheduler/reconciliation/delivery/mapping/token instrumentation, WordPress Site Health tests, redacted debug information, API liveness probing without credentials, admin diagnostics/reset controls, and cached schema integrity checks.
- Added scan-gated GitHub Release publication for protected semantic-version tags, attaching source and image SPDX JSON SBOMs plus checksums only after dependency, secret, configuration, and container security jobs pass and the tagged commit is verified on `main`.

### Still To Do

- Confirm Phase 0 production details: exact printer model, RIP product/version, accepted PDF format, plate names, mask policies, print order, overprint/knockout behaviour, colour management, and dimensional tolerances.
- Build and physically validate the Phase 0 production exporter fixtures before claiming UV print-file readiness.
- Replace placeholder/demo output profile settings with confirmed printer/RIP values after Phase 0.
- Add verified forgotten-password/support recovery; WebAuthn passkeys, TOTP MFA, one-time recovery codes, and revocable database sessions are now implemented.
- Complete live theme/browser compatibility testing for the WooCommerce block, classic-hook, gallery-replacement, modal, shortcode, and manual placement adapters.
- Complete full touch workflow and browser accessibility testing for the constrained customiser.
- Add pinned Chromium golden-image comparisons for the PNG proof and later production output; geometric live-preview/proof fixtures are now covered.
- Add visual/geometric fixture tests comparing preview/proof/production output.
- Add malware scanning or equivalent isolated media processing where required.
- Extend erasure to ordered artwork only after retention eligibility is modelled, and integrate external replica/backup systems with automatic purge evidence; unordered live storage and metadata execution is now implemented.
- Deploy the documented external worker-heartbeat alert before Phase 0 generated artifacts are enabled; WordPress-compatible local connector telemetry plus API/admin/inbox/outbox/artifact/maintenance/proof/render OTLP coverage, bounded worker heartbeat metrics, and durable cleanup alerting are implemented.
- Execute the clean PostgreSQL migration gate in GitHub Actions and repeat it against production-like restored data before deployment; the CI service and migration command are implemented, while local execution remains blocked by the unavailable Docker daemon.
- Configure the selected production backup tool/provider, then execute and record the first isolated PITR/object restore drill; required coverage and the drill procedure are documented.
- Extend real BullMQ/Redis dispatch beyond the connector inbox only after platform outbox and print-render destinations, immutable payloads, and acknowledgment semantics are defined; PostgreSQL remains authoritative.
- Add claim tokens and safe mutation rules for real print rendering and platform outbox dispatch; asynchronous webhook processing now uses token-fenced PostgreSQL claims, while proof/deletion stale, missing, and exhausted work is reconciled and incomplete platform dispatch contracts remain observation-only.
- Build the real render/production exporter after Phase 0 is validated.
- Add preflight validation for spot names, output profile, colour space, dimensions, masks, layer order, and artifact checksums.
- Add generated artifact creation from the real production exporter after Phase 0.
- Expand failed print job review workflows and production operator controls beyond the current regeneration endpoint.
- Complete OpenTelemetry log correlation and add dispatch/creation telemetry when the real platform outbox dispatcher and Phase 0 production artifact exporter are implemented; current API, admin, inbox/outbox creation/backlog, artifact download/cleanup, and worker boundaries are covered.
- Replace the bounded per-process API limiter with coordinated Redis/edge limits after trusted-proxy topology is configured, and complete browser CSP/sandbox compatibility tests.
- Expand automated tests for tenant isolation, connector signatures, duplicate events, customiser commit validation, order ingestion, print job creation, upload validation edge cases, and WooCommerce cart/order behaviour; manual print-job creation now verifies that the selected snapshot belongs to the selected tenant and order, and commit validation prevents cross-layer upload-size policy bypasses.
- Deploy and smoke-test the documented production topology on the target host; production Compose, reverse proxy guidance, cache coordination boundaries, persistence, and rollout procedures are implemented.
- Add accessibility testing against WCAG 2.2 AA for admin and customiser.
- Add private beta operational runbooks, failure simulations, monitoring, and load tests.
- Add Shopify only after the WooCommerce flow and core production pipeline are proven.

## Purpose

Build a new standalone personalisation webapp, similar in concept to Customily, that connects to WooCommerce and Shopify through lightweight plugins/apps.

This is not an edit or rewrite of the existing WooCommerce plugin. The existing plugin is useful as a reference for what the personalisation system needs to support, but the new product should be a separate software platform.

## Current Situation

We already have a WooCommerce plugin that handles product personalisation, previews, customer uploads, print file generation, and order data.

The plugin proves the personalisation workflow can work, but WooCommerce creates limitations around:

- Frontend page speed
- Plugin/theme conflicts
- Checkout and cart restrictions
- WooCommerce Blocks compatibility
- PHP request limits
- WordPress cron reliability
- Server memory limits
- Heavy print file generation inside WordPress
- Difficulty adding richer editor features
- Difficulty supporting other ecommerce platforms like Shopify

## Core Direction

The new system should move the personalisation engine out of WooCommerce and into a dedicated webapp.

WooCommerce and Shopify should only act as commerce connectors.

The webapp should own:

- Design setup
- Product personalisation rules
- Fonts
- Clipart
- Artwork uploads
- Customer customisation sessions
- Preview generation
- Render specs
- Print file generation
- Print queues
- Print file regeneration
- Admin management
- Asset storage

WooCommerce and Shopify should own:

- Products
- Variations
- Cart
- Checkout
- Payments
- Taxes
- Shipping
- Order creation

## High-Level Architecture

### 1. PersonaliseKings Webapp

The central application where merchants manage personalisable products, designs, assets, orders, and print files.

Responsibilities:

- Merchant login and account management
- Store connections
- Design builder
- Print area setup
- Layer setup
- Font library
- Colour library
- Clipart library
- Upload rules
- Product-to-design mapping
- Hosted customiser frontend
- Saved customer customisations
- Preview images
- Print file generation
- Print queue management
- Order customisation dashboard
- Webhooks/API for ecommerce platforms

### 2. WooCommerce Connector Plugin

A new lightweight plugin, separate from the existing plugin.

Responsibilities:

- Connect WooCommerce store to PersonaliseKings
- Store revocable connector credentials
- Map WooCommerce products/variations to webapp designs
- Load the hosted customiser on product pages by replacing the product gallery area
- Use the WooCommerce Blocks Integration API and block-compatible extension points where possible
- Add customisation data to cart items
- Add customisation data to order items
- Send HMAC-signed order data to the webapp with idempotency keys
- Receive generated print file updates if needed
- Show customisation previews/links in WooCommerce admin

The WooCommerce plugin should not generate print files itself.

### 3. Shopify App

A Shopify app that provides the same role as the WooCommerce connector.

Responsibilities:

- Connect Shopify store to PersonaliseKings
- Map Shopify products/variants to webapp designs
- Load the hosted customiser on product pages
- Attach customisation data to cart/order line items
- Send order data to the webapp
- Show customisation previews and print file links in the webapp

### 4. Render/Print Worker Service

A background worker system responsible for generating production files.

Responsibilities:

- Generate print-ready files from saved render specs
- Process uploaded artwork
- Convert fonts where needed
- Generate approved production formats confirmed by the target output profile and RIP
- Generate production artifacts through a dedicated exporter, not by assuming browser PDF output is RIP-ready
- Retry failed print jobs
- Store generated files
- Log warnings and errors

This should run outside WordPress and outside Shopify.

### 5. Asset Storage

Use an object-storage abstraction from day one, even if the initial storage backend is hosted on our own server.

The application should work with object keys, asset IDs, versions, and checksums rather than absolute local filesystem paths.

Prefer an S3-compatible interface so lifecycle rules, multipart uploads, signed access, and future migration do not require rewriting the application.

Use scheduled cleanup rules to prevent old previews, temporary uploads, and generated files from growing without limit.

Cleanup retention periods should be configurable in the account admin settings.

The server is backed up remotely periodically as part of whole-server backups.

Customer uploads may include personal photos or other personal data, so cleanup rules should also support manual deletion and erasure requests.

Store:

- Customer uploads
- Preview images
- Print files
- Fonts
- Clipart
- Design assets
- Mockup images

Logical storage classes:

- Temporary/incomplete uploads
- Draft customisation assets
- Order-bound customer assets
- Merchant design assets and fonts
- Preview derivatives
- Production artifacts
- Quarantined or rejected files

Later, this can move to S3-compatible object storage if file volume, backup requirements, or scaling needs make server-local storage unsuitable.

### Upload Privacy And Erasure

The upload storage system should be designed with privacy and deletion requirements from the start.

Requirements:

- Customer uploads should be linked to customisation sessions and orders so they can be found later.
- Temporary uploads should expire automatically based on the selected cleanup period.
- Account admins should be able to delete customer uploads where legally or operationally required.
- Erasure requests should delete or anonymise customer-upload references where possible without breaking required order/production records.
- Deleted file records should retain enough audit information to explain what was removed and when.
- Cleanup jobs should handle missing files safely.
- Backups may retain deleted files until backup rotation removes them, so this should be documented in the privacy policy.

Customer upload flow:

- Create an upload intent.
- Issue a very short-lived signed upload URL.
- Upload into a quarantine location.
- Validate checksum, detected file type, dimensions, and decoding limits.
- Scan or safely re-encode the file.
- Strip metadata where appropriate.
- Promote accepted files to private permanent storage.
- Create an immutable AssetVersion.

Retention should be defined per data class. Temporary uploads may expire quickly, while paid-order assets may need to remain available for reprints, returns, or operational records.

Backups need explicit targets:

- PostgreSQL point-in-time recovery using WAL archiving.
- Separate object-storage backups or replication.
- Encrypted offsite copies.
- Documented recovery-point and recovery-time objectives.
- Scheduled restoration drills.
- A tested method for restoring the database and matching object versions together.

## Suggested Tech Stack

This can be changed, but the suggested starting point is:

- Frontend/webapp: Next.js
- Backend API: Next.js API routes or a separate API service
- Database: PostgreSQL
- ORM: Prisma
- Queue: Redis + BullMQ
- File storage: object-storage abstraction, initially backed by our own server storage, with automated cleanup
- Authentication: email/password for merchants, WooCommerce REST API authentication handshake for store connection, and signed REST API communication for connector-to-webapp events
- Workers: separate Node.js workers for render/proof, media processing, production export, and maintenance
- Connector plugins: PHP for WooCommerce, Shopify app for Shopify

Recommended application structure:

- apps/web-admin
- apps/customiser
- apps/api
- apps/worker-render
- apps/worker-media
- apps/worker-maintenance
- packages/render-schema
- packages/design-engine
- packages/production-export
- packages/connector-contracts
- packages/auth
- packages/observability

The system should be a modular monolith with separate deployment processes, not premature microservices and not one large Next.js server handling every concern.

For production runtime, use the current LTS runtime rather than the newest numbered release. As of July 2026, that means Node 24 LTS rather than Node 26 Current.

Use the current stable production major for framework dependencies, such as Next.js 16, and avoid preview-tag releases for production workloads.

### Database Choice

PostgreSQL is the preferred database for the MVP.

Reasons:

- Strong relational data model for merchants, stores, products, designs, orders, customisations, print jobs, and audit records.
- Reliable transactions for order sync, idempotency, queue state, and print job status changes.
- Good JSON support for render specs and flexible design/customisation data.
- Mature backup, restore, indexing, and operational tooling.
- Easy to host on our own server while still leaving a path to managed hosting later.

The render spec can use JSON/JSONB fields, but key searchable business records should remain relational rather than being stored as large unstructured blobs.

### Dependency Policy

Use current stable dependency versions at project creation time, not outdated versions and not unstable pre-release versions unless there is a specific reason.

Dependencies should be pinned through lockfiles and updated deliberately.

The executable policy, runtime baseline, exception process, and mandatory CI/security checks are documented in `docs/DEPENDENCY_POLICY.md`. GitHub Actions are pinned to immutable commits and updated through reviewed weekly pull requests.

Policy:

- Start with the latest stable releases available at build time.
- Avoid alpha, beta, release-candidate, or experimental dependencies for core systems unless explicitly approved.
- Use automated dependency monitoring where practical.
- Review dependency updates regularly.
- Apply security updates quickly.
- Test updates before deployment.
- Do not blindly auto-upgrade production dependencies without CI/tests passing.
- Define a supported runtime matrix.
- Use automated update pull requests, not automated production deployment.
- Generate an SBOM.
- Run container and dependency vulnerability scanning.
- Run secret scanning.
- Pin container images and renderer/browser versions.
- Test migrations against production-like database copies.
- Schedule quarterly dependency reviews.
- Define emergency patch rules for critical vulnerabilities.

Self-hosting requirements:

- Put a reverse proxy in front of HTTP services.
- Enforce body-size limits and rate limits at the proxy.
- Plan cache coordination before adding multiple web instances.
- Do not rely on an individual container's local filesystem for persistent data.

## Key Data Concepts

### Merchant

The business using the platform.

### Store

A connected WooCommerce or Shopify store.

The data model should allow one merchant to have multiple stores later, but the MVP only needs to support one connected WooCommerce store per merchant.

Store records should be platform-neutral from day one.

Example fields:

- Store ID
- Merchant ID
- Store type, such as woocommerce or shopify
- Store URL
- External store identifier where available
- Connection status
- Webhook signing secret
- API credential reference

### Product Mapping

Links an ecommerce product or variant to a PersonaliseKings design.

Example fields:

- Store ID
- Store type
- External product ID
- External variant ID
- PersonaliseKings design ID
- Active/inactive status

### Design

The personalisation template.

Includes:

- Print areas
- Layers
- Editable text
- Editable images
- Clipart options
- Font rules
- Colour rules
- Size/position rules
- Print method rules

### DesignVersion

An immutable version of a design.

Orders and committed customisations should reference a DesignVersion, not the mutable current design.

### Asset And AssetVersion

Assets include fonts, artwork, clipart, uploads, mockups, and generated derivatives.

AssetVersion records should be immutable and include checksums, storage object keys, file type, dimensions where applicable, and validation status.

External platform IDs should be stored as strings, not forced into numeric IDs.

### OutputProfile And OutputProfileVersion

Output profiles define device/RIP-specific production rules.

Example fields:

- Printer model
- RIP name
- RIP version
- Output format, with UV MVP using PDF
- Physical width and height
- Bleed
- Process colour space
- ICC profile asset ID
- White spot name
- Gloss spot name
- Ink sequence
- Overprint policy
- White mask policy
- Gloss mask policy
- Alpha threshold
- Choke or spread
- Minimum feature size
- Raster resolution
- Font policy
- Preflight rule version

Orders and generated artifacts should reference an OutputProfileVersion so later account setting changes do not silently alter historical regeneration.

Printer model, RIP name, RIP version, and output settings should be configurable in account admin settings through output profiles.

Even though these are configurable, Phase 0 still requires validating one initial real printer/RIP/output-profile combination before broader product development proceeds.

### Customisation Session

A saved customer personalisation.

CustomisationSession may remain mutable while the customer is editing.

Includes:

- Design ID
- Store ID
- Product ID
- Variant ID
- Customer inputs
- Uploaded files
- Preview image
- Render spec
- Status

### CustomisationRevision

An immutable committed revision of a customisation.

Cart and order flows should reference a committed CustomisationRevision, not a mutable editing session.

### Canonical Scene Graph

The canonical scene graph is the shared source of truth for preview, proof, and production export.

It should use a fixed physical coordinate system, such as integer micrometres or a fixed fraction of a millimetre, rather than CSS pixels and unconstrained floating-point values.

The browser should map physical coordinates onto its viewport.

The scene graph should include:

- Physical coordinates
- Transforms
- Text runs
- Text layout results where available
- Clipping paths
- Opacity
- Masks
- Layer order
- Asset references
- Font references
- Output intent references

For committed text, store the exact font asset and renderer version. Ideally preserve laid-out glyph positions or outlines so old orders regenerate consistently even after browser, font-engine, or dependency changes.

### Ecommerce Line Item

A platform-neutral representation of a WooCommerce or Shopify line item.

The line item should be treated as a structural container that can store standard ecommerce metadata properties.

This matters for future Shopify support because Shopify Checkout Extensibility requires customisation references to flow through supported cart/line item mechanisms, such as Cart Line Item Properties through the Cart API or GraphQL Storefront API.

Example fields:

- Store ID
- Store type
- External order ID
- External line item ID
- External product ID
- External variant ID
- Quantity
- Customisation ID
- Line item metadata
- Platform raw payload reference

### Render Spec

A canonical saved snapshot of the customer's final artwork choices.

This should be the source of truth for generating print files.

The render spec should not depend on the customer's browser, WooCommerce cart, or Shopify cart.

The JSON render spec and scene graph should be validated against a versioned JSON Schema or equivalent.

Old schema versions should be read through migration adapters rather than rewritten in place.

### OrderArtworkSnapshot

An immutable snapshot used for ordered artwork and regeneration.

A render spec alone is not enough.

The snapshot should preserve:

- Render-spec schema version
- DesignVersion ID
- OutputProfileVersion ID
- Physical print dimensions and coordinate system
- Exact font-file versions and hashes
- Exact artwork and clipart versions and hashes
- Colour-profile hash
- White/gloss mask policies
- Spot-colour names
- Renderer build and container image digest
- Browser build used for customer proof
- Preflight-rule version
- Original customer input values
- Generated artifact checksums

### Print Job

A queued background job to generate production files.

Includes:

- Customisation ID
- Order ID
- Print method
- Status
- Error logs
- Generated file URLs
- Retry count

### PrintJobAttempt

An immutable record of each worker attempt to generate or validate a print artifact.

Workers should create PrintJobAttempt records and update the authoritative PostgreSQL PrintJob state.

### GeneratedArtifact

An immutable generated output file or derivative.

Includes storage key, checksum, output profile version, print job attempt, preflight status, and artifact type.

### WebhookDelivery

A durable inbox record for signed events received from connectors.

### OutboxEvent

A durable outbox record for work that needs to be dispatched to queues or external systems.

### AuditEvent

Records sensitive actions such as downloads, regeneration, deletion, manual status changes, connection changes, and failed access attempts.

### DeletionRequest

Tracks privacy deletion or erasure requests and their status across live storage, metadata, replicas, and backup expiry notes.

## Connector API Design

The webapp API should be platform-neutral from day one, even though WooCommerce is the first connector.

Endpoint and payload names should avoid WooCommerce-specific assumptions where possible.

Use generic concepts such as:

- Store
- Store type
- External product ID
- External variant ID
- External order ID
- External line item ID
- Customisation ID
- Product mapping
- Order sync
- Print job

Example order sync fields:

- Store ID
- Store type
- External order ID
- External order number
- Currency
- Order status
- Customer reference, if needed
- Line items
- External product IDs
- External variant IDs
- Customisation IDs
- Idempotency key
- Event timestamp

This avoids rebuilding the API when Shopify is added later.

The signed event envelope should include:

- event_id
- event_type
- event_version
- store_id
- connector_instance_id
- occurred_at
- sent_at
- key_id
- nonce
- content_digest
- payload

## Connector Security

Connector-to-webapp communication must be authenticated and tamper-resistant.

Requirements:

- Order sync payloads must be HMAC-signed.
- Signatures should be verified over the raw payload.
- Each store should have its own webhook signing secret.
- Incoming webhook signatures must be verified before processing.
- Webhook timestamps should be checked to reduce replay risk.
- Order sync events must include idempotency keys.
- Duplicate webhook deliveries must be safe and should not create duplicate orders, customisations, or print jobs.
- Failed signature checks should be logged and rejected.
- Connector credentials must be revocable per store.

Either adopt HTTP Message Signatures or document an equally precise canonicalisation scheme covering method, path, timestamp, and raw-body digest. Avoid signing re-serialised JSON without strict canonicalisation.

Redis/BullMQ must not be the authority for orders or print jobs.

Durable event flow:

1. Receive the signed event.
2. Verify the signature over the raw payload.
3. Insert the delivery into a PostgreSQL WebhookDelivery/EventInbox table.
4. Enforce a unique constraint on store and event/delivery ID.
5. Commit the received event before returning success.
6. Process the event transactionally.
7. Create business records and an OutboxEvent in the same database transaction.
8. Dispatch or re-dispatch the matching BullMQ job from the outbox.
9. Reconcile database jobs that are not queued, are stale, or are stuck.
10. Workers create immutable PrintJobAttempt records and update authoritative PostgreSQL state.

WooCommerce connection setup should use the native WooCommerce REST API authentication handshake.

The merchant should click a connect button in the webapp, be redirected to their WordPress/WooCommerce site, approve access, and have WooCommerce return REST API credentials to the webapp automatically.

This should be preferred over manual credential setup because it gives a better merchant onboarding experience.

Manual REST API credential entry can remain as a fallback for unusual store setups.

The WooCommerce connector maintains a versioned local outbox table as the authority for undelivered business events. Action Scheduler is the preferred execution mechanism, with WP-Cron fallback and a recurring repair sweep; scheduler records can be recreated from the outbox without losing an order event.

Once a valid customisation has been added to the cart, a temporary PersonaliseKings outage must not prevent WooCommerce checkout. The connector should store the signed customisation reference locally and deliver the order asynchronously through its outbox.

The connector rescans WooCommerce orders every 15 minutes from a persisted modified-time watermark. It snapshots matching IDs, uses a small overlap and fingerprinted modification keys, and writes every result to the existing local queue before advancing. Parent-order and item-level hooks provide low latency, while scheduled scans and indefinite transient retries provide eventual correctness.

## Customer Flow

1. Customer visits a WooCommerce or Shopify product page.
2. Connector checks whether the product/variant has a PersonaliseKings design assigned.
3. If assigned, the product page displays a customise button or embedded customiser.
4. The customiser loads from the PersonaliseKings webapp.
5. Customer enters text, uploads images, selects colours, selects clipart, or edits the design.
6. Webapp saves the customisation session.
7. Webapp returns a customisation ID, preview image, and summary to the store.
8. Connector adds the product to cart with the customisation ID attached.
9. Customer completes checkout in WooCommerce or Shopify.
10. Connector sends order data to the PersonaliseKings webapp.
11. Webapp creates print jobs.
12. Worker generates production files.
13. Merchant downloads files from the webapp or receives them through an integration.

## Admin Flow

1. Merchant creates or imports a design in the webapp.
2. Merchant defines print areas and layers.
3. Merchant uploads fonts, clipart, mockups, and design assets.
4. Merchant connects a WooCommerce or Shopify store.
5. Merchant maps store products/variants to webapp designs.
6. Orders appear in the webapp after checkout.
7. Print files are generated automatically.
8. Merchant can view, download, regenerate, or troubleshoot print files.

## MVP Scope

The first version should be deliberately small.

### Include In MVP

- Merchant account
- WooCommerce connector first
- Product-to-design mapping
- Basic design builder
- Basic staff roles: owner/admin, designer, production operator, support, and read-only auditor
- Text layers
- Image upload layers
- Basic colour choices
- Hosted frontend customiser
- Live preview
- Customer input capture
- Save customisation session
- Cart editing for saved customisations
- Generate preview image
- Add customisation ID to WooCommerce cart/order
- Send WooCommerce order to webapp
- Generate UV print-ready PDF files reliably after order payment
- Admin order/customisation dashboard
- Download generated print files
- Failed print job alerts/statuses for staff
- Production workflow managed in the webapp
- Optional price modifiers for personalisation choices

### Exclude From MVP

- Shopify, unless needed immediately
- Multi-store support
- Customer accounts
- Advanced VDP
- Engraving output, unless UV is complete and stable
- Complex embroidery output
- Multiple print areas
- Background removal
- Large clipart marketplace
- Full multi-user team management beyond the basic MVP staff roles
- Billing/subscriptions
- Public app marketplace listing
- Complex automation integrations
- AI design generation
- Full migration from the existing plugin

## Future Features

- Shopify app
- Engraving print file generation
- Embroidery print file generation
- Sublimation output rules
- VDP CSV upload and batch generation
- Background removal
- Artwork quality checks
- Proof approval workflow
- Production dashboard
- Advanced staff/team management
- Billing and plans
- Webhook integrations
- Zapier/Make integration
- API for external production systems
- Template marketplace
- White-label customiser

## Important Product Decisions

### The Webapp Should Be The Source Of Truth

The webapp should store the final customisation and render spec.

WooCommerce and Shopify should only store a reference to the customisation ID plus a lightweight preview/summary.

### Print Generation Should Not Happen In WooCommerce Or Shopify

Print generation should happen in background workers controlled by the webapp.

This avoids platform limits, checkout delays, and unreliable server environments.

### Preview And Production Must Share A Scene Graph

Preview-vs-print drift must be prevented by design, not handled later as a support issue.

The browser preview and production exporter must share one canonical, versioned scene graph and geometry model.

The browser preview and production exporter may use different rendering backends, provided they consume the same scene graph, fonts, assets, transforms, clipping rules, masks, layer order, and text-layout results.

Recommended structure:

- Canonical scene graph: physical coordinates, transforms, text runs, clipping paths, opacity, masks, layer order, asset references, and font references.
- Browser renderer: Canvas, SVG, or DOM for interactive editing.
- Proof renderer: Playwright screenshots and customer-facing previews.
- Production exporter: dedicated PDF/vector/raster exporter capable of creating required special-ink plates and production metadata.
- Preflight validator: independently verifies the generated production artifact before it is marked ready.

Playwright is preferred for proof screenshots, visual-regression tests, and customer-facing previews. Playwright PDF output should not be assumed to be a valid UV production file because professional print workflows may require PDF/X, live transparency handling, colour management, output intents, overprint behaviour, and spot-colour separations.

Avoid maintaining separate geometry logic for preview and production export. Any backend-specific renderer must consume the same scene graph and be tested against the same fixtures.

The MVP should include automated geometric and visual comparison tests using known fixtures so preview output and production output can be checked for positioning, scale, rotation, font, colour, clipping, masks, and layer-order drift.

### Connectors Should Stay Thin

The WooCommerce and Shopify connectors should be as small as possible.

This makes them easier to maintain and reduces platform-specific bugs.

### WooCommerce Comes First

The MVP should be built for WooCommerce first.

Shopify should remain TBA until the WooCommerce version proves the core webapp, customiser, order flow, and UV print generation pipeline.

### Products Should Be Mapped, Not Managed

Merchants should continue managing products, variations, pricing, stock, taxes, shipping, and checkout in WooCommerce.

The webapp should only map those ecommerce products/variations to PersonaliseKings designs.

### Commerce Behaviour

Print generation should trigger when the order is paid.

Quantity greater than one means multiple copies of the same customisation. If a customer wants five different customisations, they should add each customised item to cart separately.

Customers should be able to reopen and edit a customisation from cart.

Changing the product variant after customising should invalidate the existing customisation.

Low-resolution uploads should warn the customer rather than hard reject the upload.

Personalisation choices should be able to change the product price when configured to do so.

MVP should support one print area only. Multiple print areas can come later.

### Production Staff Should Work In The Webapp

WooCommerce should not be the production dashboard.

Production staff should use the PersonaliseKings webapp to view orders, check customisations, download files, regenerate files, and resolve failed print jobs.

### Customiser Embed Approach

The customiser should use the best expandable approach for July 2026 standards.

The preferred direction is a hosted customiser delivered as an isolated embed, likely iframe-first with a small script loader around it.

This gives the webapp control over performance, releases, styling, browser APIs, and security while keeping the WooCommerce connector lightweight.

The script loader can handle product-page integration, sizing, events, add-to-cart handoff, and future expansion without exposing the full customiser directly to WooCommerce themes.

For WooCommerce, product gallery replacement should be available as a tested placement adapter and maintain compatibility with existing product page/gallery plugins where practical, matching the behaviour of the existing plugin when that adapter is used.

### UV Print Output

UV print files are the first required production output.

UV files need two special-ink plates for gloss and white.

The names of these special-ink plates should be configurable in the account admin settings and stored in the active OutputProfileVersion.

Do not treat both white and gloss as generic under-layers until the actual printing sequence is confirmed. They should be treated as special-ink plates whose print order, overprint behaviour, and mask policies are defined by the output profile.

White and gloss should have separate mask policies. A gloss/varnish plate may not always be identical to the white underbase.

Masks should be generated according to the output profile from one of these policies:

- Union of eligible layer alpha
- Final composited alpha
- Specifically tagged objects

The profile should define behaviour for partial transparency, anti-aliased edges, shadows, clipping masks, blend modes, choke/spread, opacity thresholds, minimum printable feature sizes, and overprint/knockout policy.

The UV special-ink plates should be generated from actual artwork shapes, bounding boxes, alpha channels, or tagged vectors according to the output profile.

For transparent uploads, such as transparent PNGs, the white under-mask should follow the transparent boundary of the visible artwork rather than generating a large solid rectangle.

Default UV special-ink names for the initial target profile, pending verification against the actual RIP installation:

- RDG_Gloss
- RDG_WHITE

Any alternate white spot name should be treated as unverified unless the actual RIP installation proves otherwise.

PDF/X-4 should only be adopted as the production format after the target RIP accepts it in testing. Device/RIP acceptance is the deciding test.

Do not promise EPS for MVP unless the named printer/RIP actually requires it.

UV print generation is considered reliable only when it meets explicit acceptance criteria.

MVP acceptance criteria:

- Generated files contain the required UV special-ink plates.
- Default UV special-ink names are RDG_Gloss and RDG_WHITE unless changed in account admin settings or the active output profile.
- Ink sequence, overprint policy, and knockout policy match the active OutputProfileVersion.
- White and gloss masks are generated according to their separate output-profile policies.
- Special-ink plates are generated from artwork bounds/alpha/tagged-object data rather than as full rectangular fills.
- Transparent artwork generates matching masks based on visible pixels or vector shape according to the active policy.
- Layer order is validated before files are marked ready.
- Output dimensions match the configured print area.
- Position, scale, rotation, and clipping match the saved render spec.
- Text output uses the correct font and sizing.
- Uploaded artwork is placed and clipped correctly.
- Test fixtures exist for text-only, image-only, mixed text/image, rotated artwork, clipped artwork, transparent artwork, and edge-of-print-area placement.
- Test fixtures validate transparent PNG under-mask generation.
- Preflight validates spot-colour names, output profile, colour space, dimensions, masks, and artifact checksums.
- Failed validation keeps the print job in a failed or needs-review state rather than exposing the file as ready.

Dimension and positioning tolerances should be agreed before Phase 4 starts.

### Engraving Output

Engraving comes after UV printing is stable.

Engraving files should be black and white, excluding any red cut lines.

### Failed Print Jobs

Failed print jobs should be surfaced inside the webapp only.

Email, Slack, and browser notifications are not required for the MVP.

Infrastructure incidents still need out-of-band alerts for system operators. A worker fleet outage, storage failure, failed backup, or growing queue should not depend on someone opening the print dashboard.

### Staff Accounts And RBAC

The MVP excludes full multi-user team administration, but production staff working in the webapp requires authenticated users and basic roles.

Required MVP roles:

- Owner/admin
- Designer
- Production operator
- Support
- Read-only auditor

Every download, regeneration, deletion, manual status change, connection change, and privileged action should create an AuditEvent.

Privileged accounts should support MFA or passkeys, secure recovery, and session-management controls.

### Tenant Isolation

Every business record should include a tenant/merchant identifier.

Queries should always scope by tenant, and tests should cover cross-tenant access attempts.

PostgreSQL row-level security can be considered as defence in depth after the base schema and access patterns are clear.

### Upload Security

Use OWASP ASVS 5.0 as the application-security baseline and OWASP upload guidance for file handling.

MVP upload rules:

- Customer uploads should be raster-only at first: PNG, JPEG, and possibly WebP.
- Do not allow customer-provided SVG until sanitisation and isolated conversion are proven.
- Merchant SVG/clipart can be handled separately through a managed sanitisation pipeline.
- Validate magic bytes and decoder output, not just filename or MIME type.
- Enforce maximum file bytes, pixel dimensions, and decoded memory.
- Protect against decompression and XML expansion attacks.
- Strip metadata and re-encode images where appropriate.
- Store uploaded content outside the main web root or on a separate cookieless asset origin.
- Media-processing and render workers should have no outbound network access by default.
- Worker containers should have CPU, memory, and execution limits.
- Private files should be served through authorised endpoints or short-lived signed links.

### Iframe Embed Security

The iframe embed should use a versioned postMessage protocol.

Requirements:

- Exact parent and child origins.
- No wildcard target origins.
- Runtime schema validation.
- Message IDs and correlation IDs.
- Explicit protocol versions.
- Defined timeout and retry behaviour.
- Events for ready, resize, variant change, save, committed, add-to-cart, cancel, and error.
- Short-lived embed token bound to store, allowed domain, product, variant, and design.
- Content Security Policy with tightly scoped frame-ancestors.
- Restrictive iframe sandbox and Permissions Policy.
- No dependency on third-party cookies.

The webapp should return an opaque signed customisation reference, not a raw database ID.

Order ingestion must verify that the reference:

- Belongs to the sending store.
- Matches the product and variant.
- Points to a committed revision.
- Has not expired or been revoked.
- Has not already been substituted by a different store.

### WooCommerce Connector Details

Replacing the product gallery should be an integration option, not the connector's only contract.

Supported placement adapters:

- Block for block-based Single Product templates.
- Classic-theme hook integration.
- Optional tested gallery-replacement adapter.
- Modal/full-screen customiser fallback.
- Shortcode or manual-placement fallback for unusual themes.

For Cart and Checkout Blocks, use official JavaScript extensibility and Store API extension mechanisms. The Store API is public, so it must never expose secrets or privileged URLs.

WooCommerce requirements:

- HPOS compatibility using WooCommerce CRUD/order APIs.
- Declared Cart/Checkout Blocks compatibility.
- Tests for classic and block product templates.
- Tests ensuring two different customisations of one variant remain distinct cart lines.
- Tests for quantity greater than one.
- Cart editing and duplicate-line behaviour.
- Order updates, cancellations, and refunds.
- Manual resync order action.
- Connector health and last-successful-delivery status.
- Compatibility matrix covering supported WordPress, WooCommerce, and PHP versions.

The WooCommerce REST authentication endpoint is preferred for one-click setup. The generated API key is tied to a WordPress user and its permissions, so the connector needs connection-health detection and re-authorisation. Request read permission rather than read/write unless the webapp has a clear requirement to change WooCommerce data.

### Shopify Later

Shopify remains TBA, but the domain model should be ready for Shopify constraints.

Future Shopify connector guidance:

- Use Theme App Extensions through app blocks or app embeds.
- Pin a supported API version rather than using latest dynamically.
- Use cart-line custom attributes or line-item properties for the customisation reference.
- Consider a private property such as _pk_customisation_id while accounting for theme-display behaviour.
- Verify Shopify webhook HMACs on the raw request.
- Persist and deduplicate X-Shopify-Webhook-Id.
- Process webhooks asynchronously.
- Implement mandatory privacy/compliance webhooks before public distribution.
- Validate that a customisation exists before allowing the relevant product through checkout.
- Define separately how price-changing options work.

### Observability

Observability belongs in Foundation, not late hardening.

Propagate one correlation ID through:

- Woo connector
- Inbound event
- PostgreSQL inbox
- Outbox
- BullMQ
- Render/export worker
- Generated artifact

Capture:

- Event-ingestion success and signature failures
- Duplicate events
- Outbox age
- Queue age and depth
- Print-job duration
- Retry count and terminal failures
- Worker crashes and memory limits
- Upload rejection reasons
- Storage growth
- Regeneration frequency
- Preview and production comparison failures

OpenTelemetry is the preferred default for correlated traces, metrics, and logs.

### Accessibility And Mobile

Target WCAG 2.2 AA for the admin and customer customiser.

Requirements:

- Every drag operation needs a keyboard or form-based alternative.
- Position, scale, and rotation must be editable numerically.
- Controls need accessible labels and visible focus.
- Touch targets need adequate size.
- Colour choices cannot rely on colour alone.
- Validation errors need programmatic associations.
- The preview needs a meaningful text summary.
- The interface must work at mobile widths and browser zoom.

### Order-Time Snapshots Matter

When an order is placed, the webapp should preserve the exact render spec used at purchase time.

If the design template changes later, old orders must still regenerate the correct files.

## Risks And Questions

### Open Questions

- Confirm whether any additional WooCommerce gallery/product page plugins need support after True Product Gallery.
- Confirm exact UV dimension and positioning tolerances before Phase 4 starts.
- Confirm quality states: draft, committed, ordered, awaiting approval, ready, needs review, failed, cancelled, archived.
- Confirm reprint behaviour: original renderer/profile only, or new artifact revision.
- Confirm design deletion policy, likely archive versions rather than deleting order-referenced designs.
- Confirm expected capacity assumptions: sessions, uploads, orders, file sizes, and concurrent renders.
- Confirm tenant isolation approach, including tenant ID on every business record and whether PostgreSQL row-level security should be used as defence in depth.

### Decisions Made

- WooCommerce will be built first.
- Shopify is TBA.
- MVP print output will be UV printing first.
- UV MVP output format is PDF.
- UV print files need configurable white and gloss special-ink plates.
- Default UV special-ink names are RDG_Gloss and RDG_WHITE, pending verification against the actual RIP installation.
- Engraving comes after UV printing.
- Engraving files should be black and white, excluding red cut lines.
- Day-one customiser requirements are live preview and customer input capture.
- Print generation should trigger when the order is paid.
- Cancellation or refund events cancel queued and failed print jobs; jobs that have entered production or are already ready move to needs review rather than being destroyed automatically.
- Full cancellations and refunds cancel affected customisation sessions, while partial refunds move them to needs review.
- Quantity greater than one means multiple copies of the same customisation. Different customisations must be added to cart one by one.
- MVP supports one print area only. Multiple print areas can come later.
- Customers should be able to reopen and edit a customisation from cart.
- Changing product variant after customising should invalidate the existing customisation.
- Low-resolution uploads should warn the customer rather than hard reject.
- Price modifiers for personalisation choices should be available as an option.
- Launch roles should include owner/admin, designer, production operator, support, and read-only auditor.
- The WooCommerce customiser should support product gallery replacement as one placement adapter.
- True Product Gallery should be the first WooCommerce gallery plugin supported.
- The WooCommerce connector should use the WooCommerce Blocks Integration API and block-compatible extension points where possible.
- Merchants should only map ecommerce products in the webapp.
- Multi-store support is not required from the start.
- Customer accounts are not required from the start.
- Merchant accounts are required.
- Failed print jobs must be surfaced to staff in-app only.
- Production staff should work in the webapp, not WooCommerce admin.
- File storage should initially be backed by our server storage with cleanup.
- Storage should use an object-storage abstraction rather than direct local filesystem paths.
- Cleanup retention periods should be configurable in account admin settings.
- Default cleanup options should be 15 days, 30 days, 60 days, and 90 days.
- Whole-server backups are handled remotely periodically.
- Connector API contracts should be platform-neutral from day one.
- Order sync/webhook payloads must use HMAC signatures and idempotency keys.
- WooCommerce connection setup should use the native WooCommerce REST API authentication handshake, with manual REST API credential entry as a fallback.
- Preview and production export should share a canonical versioned scene graph. Playwright should be used for proofs and visual comparison, not assumed to be the production-file authority.
- Future Shopify support should treat customisation IDs as standard line item metadata compatible with Shopify Cart Line Item Properties.
- UV special-ink plates should be generated from output-profile mask policies and artwork bounds/alpha/tagged-object data, not simple rectangular fills.
- PostgreSQL inbox/outbox records should be the authority for events and jobs, not Redis.
- Basic staff accounts, RBAC, and audit events are required in MVP.
- Observability, backups/PITR, upload security, and accessibility belong in Foundation.
- Customer upload cleanup should support privacy deletion and erasure requests.

### Technical Risks

- Rendering accuracy between browser preview and final print file, mitigated by shared scene graph, proof renderer, production exporter, preflight, and automated fixture comparisons
- Font licensing and font conversion
- Large customer uploads
- SVG sanitisation and security
- Shopify checkout limitations
- WooCommerce theme/plugin conflicts around product page buttons
- Keeping cart/order state synced with saved customisations
- Webhook replay, duplicate delivery, or tampering if HMAC/idempotency checks are not correctly implemented
- Production exporter failing real RIP acceptance if Phase 0 is skipped or weakened
- Incorrect special-ink names, masks, overprint, colour management, or output profile assumptions
- Handling deleted products, variants, or designs
- Print file generation speed and reliability
- Backup retention may temporarily preserve files after an erasure request until backup rotation completes

## Suggested Build Phases

### Phase 0: Production Contract And Vertical Spike

No broader product development should proceed until one exporter can repeatedly produce files accepted by the target RIP and printer within agreed tolerances.

Tasks:

- Identify exact printer model.
- Identify exact RIP product and RIP version.
- Agree and verify PDF as the primary UV production file format.
- Build a small hard-coded scene graph without building the full editor.
- Export representative UV files.
- Open every file in the actual RIP and verify recognised colour plates.
- Physically print representative fixtures.
- Measure dimensional and positional accuracy.
- Confirm white/gloss naming, mask behaviour, print order, overprint, knockout, and colour management.
- Establish UV dimension and positioning tolerance values.
- Record approved output files and RIP screenshots as golden fixtures.

Fixtures should cover:

- Text
- Raster artwork
- Transparent PNGs
- Semitransparent edges
- Clipping
- Rotation
- Overlapping objects
- Very small features
- Edge-of-area artwork
- Multiple fonts

Phase 0 exit gate:

- Target RIP recognises the expected special-ink plates.
- Physical print output matches agreed tolerances.
- OutputProfileVersion fields are confirmed.
- Golden fixtures are stored for regression testing.

### Phase 1: Secure Foundation

- Create webapp project
- Add merchant auth
- Add basic staff accounts and RBAC
- Add database schema
- Add object-storage abstraction
- Add PostgreSQL PITR/WAL backup setup
- Add file cleanup strategy
- Add upload deletion/erasure support
- Add basic admin layout
- Add design data model
- Add platform-neutral connector API schema
- Add event inbox/outbox tables
- Add audit events
- Add telemetry/correlation IDs
- Add deletion request model
- Add security baseline and upload processing limits

### Phase 2: Rendering Kernel And Constrained Customiser

- Build hosted customiser
- Build canonical scene graph and versioned schema
- Use one print area for the first constrained version unless explicitly changed
- Support text layers
- Support image upload layers
- Warn customers about low-resolution uploads
- Use limited approved fonts initially
- Save customisation sessions
- Commit immutable customisation revisions
- Generate preview images
- Store render specs
- Add geometry and visual comparison fixtures

### Phase 3: WooCommerce Connector

- Build new lightweight WooCommerce plugin
- Connect store to webapp
- Map products/variants to designs
- Add block-based product template placement adapter
- Add classic-theme hook placement adapter
- Add optional gallery-replacement adapter
- Add modal/full-screen fallback
- Add shortcode/manual-placement fallback
- Add customisation ID to cart/order
- Add cart editing for customisations
- Invalidate customisation if the product variant changes
- Ensure quantity greater than one represents multiple copies of the same customisation
- Support optional price modifiers for personalisation choices
- Send HMAC-signed paid, updated, cancelled, and refunded order events to the webapp with idempotency keys
- Support WooCommerce REST API authentication handshake for one-click merchant approval
- Support manual REST API credential setup where needed
- Add durable local outbox with Action Scheduler and WP-Cron dispatch
- Add manual resync order action
- Add connector health and last-successful-delivery status
- Add scheduled modified-order reconciliation with a persisted watermark
- Add cart editing and duplicate-line behaviour tests

### Phase 4: Production Export

- Add print job queue
- Add worker service
- Add proof route for Playwright screenshots and comparison tests
- Generate UV production PDF files after order payment
- Validate UV special-ink names and output-profile rules
- Generate UV special-ink plates from output-profile mask policies
- Add UV output fixture tests and dimension tolerance checks
- Add output-profile snapshots
- Add automated preflight validation
- Add physical production acceptance checks
- Store generated files
- Add admin download/regenerate controls
- Add failed job visibility for staff

### Phase 5: Private Beta

- Add retries and error logging
- Add security review
- Add upload limits
- Add rate limiting
- Add monitoring
- Add backup strategy
- Add automated tests
- Add load testing
- Run restore drills
- Run accessibility testing
- Build Woo compatibility matrix
- Run failure simulations
- Write operational runbooks

### Phase 6: Shopify

Shopify is TBA and should only begin after the WooCommerce version proves the core system.

- Build Shopify app
- Add product/variant mapping
- Add customiser embed
- Attach customisation data to line items/orders
- Send Shopify orders to webapp

## Notes From Existing Plugin

The existing WooCommerce plugin shows several valuable concepts that should be carried into the new system:

- Canonical render specs
- Order-time print snapshots
- Print queue recovery
- Print file regeneration
- SVG sanitisation
- Font handling
- Customer upload handling
- Preview generation
- Linked layer inputs
- Print method-specific output

These ideas should be reused conceptually, but the new webapp should be built as a clean standalone platform.
