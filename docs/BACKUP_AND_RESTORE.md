# Backup And Restore

## Required Coverage

Production requires two coordinated backup streams:

- PostgreSQL base backups plus continuous WAL archiving for point-in-time recovery.
- Versioned or snapshot-based backups of the `object-storage` volume.

Use encrypted off-host storage with separate credentials, retention locks where appropriate, automated success alerts, and periodic integrity checks. A whole-server snapshot alone is not sufficient evidence of a recoverable database.

Choose and document an RPO and RTO before launch. The initial target should be no more than 15 minutes of database data loss and a four-hour restoration window unless the business accepts stricter or looser values explicitly.

## PostgreSQL

Use a PostgreSQL-aware tool such as pgBackRest, WAL-G, or the managed database provider's equivalent. Configure at least one daily full or differential backup and continuous WAL upload. The backup repository must not share a failure domain with the application host.

Monitor the timestamp of the latest successful base backup and WAL archive. Alert when either exceeds the selected RPO. Retain enough history to cover operational recovery and the documented privacy retention period.

## Object Storage

Snapshot or replicate the object volume only after quiescing writes or using storage that provides crash-consistent snapshots. Record the snapshot time alongside the PostgreSQL recovery point. Retain object checksums and periodically verify that sampled objects can be restored and read.

Deletion requests remain `live_deleted` until backup rotation is confirmed. Backup expiry evidence must identify the backup set or retention window that no longer contains the erased object.

Generated artifact `bytesDeletedAt` records live-storage expiry only. Restores must not make those bytes downloadable again: replay artifact byte-deletion audit records after restoring an older object snapshot, just as customer erasure records are replayed. Do not interpret the cleanup timestamp as proof that backup copies have expired.

## Restore Drill

Run and record this drill at least quarterly and before the first production launch:

1. Create an isolated network, empty PostgreSQL instance, and empty object volume.
2. Restore the latest base backup and replay WAL to a chosen timestamp.
3. Restore the corresponding object snapshot without connecting the environment to public ingress or WooCommerce stores.
4. Run `bun run prisma:deploy`, then `prisma migrate status`, against the restored database.
5. Reapply the external erasure ledger for every deletion completed after the restored backup point so deleted customer files cannot be resurrected.
6. Verify merchant, store, order, customisation, proof-job, and audit-event counts against recorded backup metadata.
7. Sample stored object checksums and confirm admin readiness reports writable storage and database connectivity.
8. Start workers with outbound connector delivery disabled and confirm queues can be inspected without duplicate external events.
9. Record elapsed recovery time, achieved recovery point, failed checks, operator, backup identifiers, and corrective actions.
10. Destroy the isolated restored environment and its temporary credentials after evidence is retained.

Never test a restore by overwriting the active production database. A backup is not considered valid until an isolated restore drill has succeeded.
