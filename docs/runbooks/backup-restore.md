# PostgreSQL and state backup/restore

## Backup policy

Use encrypted PostgreSQL base backups plus continuous WAL archiving. Define RPO/RTO per product before production; the framework does not invent business requirements. Backups must include roles/schema ownership needed for restore but must not embed application secrets in documentation or logs.

Redis is not a source of truth. Back up Redis only when a deployment intentionally uses persistence for operational recovery; confirmed domain data must remain recoverable from PostgreSQL.

Client IndexedDB is device-local. Applications provide export where required, but server backup does not claim to preserve unsynchronized drafts or commands that never reached PostgreSQL.

## Restore rehearsal

1. Provision an isolated network and a clean PostgreSQL instance of a supported version.
2. Restore the latest base backup and replay WAL to the chosen recovery point.
3. Disable outbound notifications, integrations, and real user authentication.
4. Verify migration checksums, tenant counts, command idempotency rows, event sequence continuity, outbox state, session revocation state, and audit records.
5. Start one application instance with Redis empty and confirm that journal replay restores active delivery.
6. Record achieved RPO/RTO and securely destroy the rehearsal environment.

For a disposable staging database, the framework data-plane checks are reproducible with environment-only credentials:

```powershell
$env:LAYER_STAGING_DATABASE_URL = ''postgresql://...''
$env:LAYER_STAGING_REDIS_URL = ''redis://...''
npm run staging:data-check -- --mode=exercise
```

After `pg_dump` and `pg_restore` into a new isolated database, keep Redis empty and verify the durable state without rewriting it:

```powershell
$env:LAYER_STAGING_DATABASE_URL = ''postgresql://...restored...''
npm run staging:data-check -- --mode=verify-restore
```

The first mode checks migration idempotency, a transactional event/outbox write, Redis routing, outbox completion, and PostgreSQL replay. The restore mode requires the exact migration set, verifies migration checksums, requires no unpublished rehearsal rows, and replays the restored journal without Redis. The command never prints connection strings. Use only currently supported PostgreSQL and Redis releases for a production release gate; an older local binary may diagnose compatibility but cannot satisfy that gate.

## Production recovery

Declare an incident, freeze writes at the edge, capture the failed state for analysis, and select a recovery point with the product owner. Restore into new infrastructure rather than overwriting the failed cluster. Rotate database credentials, validate integrity, then reopen traffic in canary stages. Commands submitted after the recovery point may be replayed only by their original idempotency identifiers and business conflict policy.
