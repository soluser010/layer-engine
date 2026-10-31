---
title: Databases, Redis, and workers
description: PGlite, PostgreSQL, Structured CRUD, Redis, and multi-process runtime.
audience: advanced
order: 140
status: documented
updated: 2026-09-24
---

# Databases, Redis, and workers

## Goal

Choose the correct storage mode and use the safe database facade without exposing SQL identifiers or ownership fields to input.

## Storage modes

When `database.postgres` is empty, a full-stack application opens PGlite `0.5.8` under `<LAYER_STATE_DIRECTORY>/database/system`. Embedded mode stores Layer system tables and allows one worker. Application tables and multiple workers require an external PostgreSQL primary.

```js
export default {
    database: {
        postgres: [{
            name: 'primary',
            role: 'primary',
            host: '10.0.0.10',
            port: 5432,
            database: 'layer_application',
            username: 'layer_application',
            password: {env: 'LAYER_POSTGRES_PRIMARY_PASSWORD'},
            tls: {
                mode: 'verify-full',
                serverName: 'database.example.com',
                caFile: './certificates/postgres-ca.pem'
            }
        }],
        pool: {
            maximumConnectionsPerWorker: 5,
            connectionBudget: 40
        }
    },
    runtime: {
        workers: {minimum: 2, maximum: 8}
    }
};
```

Production rejects literal passwords. Remote connections require verified TLS. A null password and plaintext transport are accepted only on loopback under the documented local-development rules.

## Structured CRUD

Every table declares `scope: 'global' | 'tenant' | 'user'`. Layer derives ownership from authenticated server context and ignores ownership values in the payload.

```js
const messages = await context.database.table('messages').findMany({
    select: ['id', 'text', 'createdAt'],
    where: context.database.where.equal('chatId', payload.chatId),
    orderBy: [{column: 'createdAt', direction: 'desc'}],
    limit: 50
});
```

Identifiers are checked against the schema allowlist and values are parameterized. `update` and `delete` require a filter; mass mutation additionally requires `allowMany: true` and a bounded limit. Trusted server operations can use only the `context.database.sql``…``` tagged template for complex SQL.

Safe additive schema changes are applied automatically. Destructive changes require an inspected checksum:

```text
layer database schema plan
layer database schema apply <checksum> --confirm-data-loss
```

## Redis and workers

Use a schema module with the named `databaseSchema` export, not a default export. Complete CRUD, value types and transactional revision checks are covered in [Structured CRUD](structured-data.md). Build generates `dist/_layer/database.d.ts` from that schema.

Server operation definitions opt into query caching and transactional invalidation separately:

```js
const queryMetadata = {
    name: 'chat.messages.read',
    type: 'query',
    cache: {ttlMs: 30000, scope: 'tenant', tags: ['chat-messages']}
};
const commandMetadata = {
    name: 'chat.message.send',
    type: 'command',
    transaction: true,
    cacheInvalidation: {scope: 'tenant', tags: ['chat-messages']}
};
```

These are metadata fragments; supply schemas, auth/permissions and handlers in your complete definitions. Pass launcher `context.queryCache` to the operation executor. Invalidation is first persisted in `sys_cache_invalidations` in the command transaction, then applied after commit. A user-scoped key/tag includes both tenant and user; never use tenant scope for a user-specific response.

The server factory also receives `rateLimiter`, `eventBus`, `leases`, `coordination`, `identity` and safe Redis status. `context.identity.create({sessions, apiKeys})` wraps durable repositories with a short cache (at most 30 seconds); it does not negative-cache revoked/expired identities. Durable revocation plus invalidation remains authoritative and raw cookie/key secrets are not stored as cache keys.

Ephemeral Redis locks/presence are available only when Redis is configured and available:

```js
const lock = await context.coordination.locks?.acquire('messages:compact', 5000);
if ( lock !== null && lock !== undefined ){
    try {
        await messagesCompact();
        await lock.renew( 5000 );

    } finally {
        //Releasing the lock even when the application task fails
        await lock.release();

    }

}
await context.coordination.presence?.touch('chat:42', 'user:17', 30000);
const onlineUserIds = await context.coordination.presence?.list('chat:42', 100);
await context.coordination.presence?.remove('chat:42', 'user:17');
```

Lock renewal/release uses the owning token; presence expires through bounded leases. Do not silently replace these Redis locks with another backend on disconnect. For singleton jobs use durable `context.leases.acquire(name, ttlMs)`, `renew(name, ttlMs)` and `release(name)` in a try/finally lifecycle, checking that acquire returned true before doing work. Renew before expiry during long jobs; the lease does not stop code that ignores its expiry.

Redis accelerates token buckets, event fan-out, short identity/query caches, locks, and presence. It never stores the only copy of durable data. On disconnect, Layer falls back to PostgreSQL/PGlite and replays invalidation events before reading Redis again.

The production launcher starts private Node processes and gives Caddy `least_conn` upstreams. Sticky sessions are not required. `maximum: 'auto'` is bounded by CPU, memory, and the PostgreSQL connection budget.

### Connection and recovery

With the managed `layerServerCreate` host, Redis connects in the background: application readiness depends on the primary database and HTTP runtime, not Redis. During an outage, cache reads are bypassed, the limiter uses durable fallback, and events continue through the database journal/polling path. `redis: null` disables Redis entirely; automatic recovery needs no extra configuration fields.

Publisher and subscriber recover as a pair, including resubscription. Three retries bound one short connection series, not the application's lifetime. Failed series restart automatically with jittered backoff growing from approximately one second to a 30-second cap. The event loop continues serving requests while connections are pending. Redis publish acknowledgement has a one-second timeout; this asynchronous wait does not block the event loop, and acceleration failure does not undo durable delivery.

After the main Redis client reconnects, invalidation replay must finish before cache reads resume. Pub/sub readiness is separate and requires both connections plus an acknowledged subscription. Application shutdown cancels background connection attempts and retry timers. Changing the endpoint, credentials or TLS requires restarting with new configuration; retries cannot repair an incorrect password.

### Cache consistency

Entries and their tags are written atomically; a short entry TTL never shortens another entry's tag lifetime. When invalidation overtakes a SQL loader, the already running request may receive its result, but that result cannot repopulate the cache. The same fence protects session/API-key cache fills during revocation. Requests already started before revocation are not automatically rolled back.

After reconnect, Layer bypasses the cache until the entire available journal has been replayed, rather than only its first batch. PostgreSQL serializes invalidation number allocation inside the transaction so a cursor cannot skip another worker's uncommitted record. Keep these transactions short; perform external HTTP calls after commit or through an outbox.

Operation caching is explicit metadata and does not replace SQL consistency. If Redis is unavailable, queries use the source of truth while background retries restore invalidation. When directly using the low-level cache adapter, prefer `execute(request, load)` for guarded fills. Manual `write` is for prepared, trusted values; it does not create a transaction with SQL.

## Expected result

Strong reads and writes use the primary, explicitly eventual reads may use a healthy replica, and a Redis outage degrades performance without losing confirmed state.

## Common errors

- `APPLICATION_DATABASE_REQUIRED`: application tables were declared without external PostgreSQL.
- `DATABASE_CLUSTER_REQUIRED`: more than one worker was requested in embedded mode.
- `DATABASE_SCHEMA_APPROVAL_REQUIRED`: an incompatible schema change needs operator approval.
- `DATABASE_MASS_MUTATION_FORBIDDEN`: a mutation was not safely bounded.

## Failure contract

System migrations and application schema synchronization share one application lock on the same PostgreSQL connection that reads the catalog and executes DDL. Each worker builds its current plan after acquiring the lock. Commit/rollback releases it automatically. An incompatible plan is retained for approval without partial application; `schema apply` rechecks its checksum under the lock. After `DATABASE_SCHEMA_CHECKSUM_MISMATCH`, obtain and review a fresh plan before approving again.

An unavailable optional replica does not prevent a healthy primary from starting: eventual reads temporarily use primary, and health checks return the replica to routing after recovery. SQL statement errors (such as a unique constraint, invalid type, syntax error or cancellation) propagate to the caller without disabling readiness for the entire application. Connection loss or primary shutdown still closes the write API until recovery. No automatic promotion occurs.

Primary loss makes write readiness fail until an operator/provider switches the topology. Layer does not promote replicas, configure WAL, or invent a backup. Secrets are redacted from diagnostics and generated bundles.

Next: [Context API](context-api.md), [Deployment](deployment-diagnostics.md), [backup/restore](../runbooks/backup-restore.md).
