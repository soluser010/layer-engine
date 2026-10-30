# @solcorp/layer-database

**Part of [Layer-Engine](https://www.npmjs.com/package/@solcorp/layer), a JavaScript framework for full PWA applications.** System storage, PostgreSQL repositories and scoped structured data access.

Start with `npm install @solcorp/layer`; this module is installed automatically. You do not need to assemble the framework package by package.

[Quick start](https://github.com/soluser010/layer-engine/blob/main/README.md#quick-start) · [API guide EN](https://github.com/soluser010/layer-engine/blob/main/docs/en/database-runtime.md) · [Документация RU](https://github.com/soluser010/layer-engine/blob/main/docs/ru/database-runtime.md) · [Source](https://github.com/soluser010/layer-engine/tree/main/packages/database)

Часть фреймворка **Layer-Engine**. Для разработки приложения установите основной пакет `@solcorp/layer`; этот модуль входит в его зависимости. Ссылки выше ведут к назначению, API, примерам и ограничениям модуля.

SQL-first PostgreSQL foundation for Layer-Engine. Queries always use `{ text, values }`; transaction callbacks receive a restricted query client rather than the raw pool connection.

```js
import {
    layerApiKeyRepositoryCreate,
    layerAuditRepositoryCreate,
    layerDatabaseMigrate,
    layerPostgresDatabaseCreate
} from '@solcorp/layer-database';

const database = layerPostgresDatabaseCreate({
    connectionString: process.env.LAYER_DATABASE_URL
});

await database.connect();
await layerDatabaseMigrate(database);

const apiKeys = layerApiKeyRepositoryCreate({database});
const issuedKey = await apiKeys.issue({
    keyId: 'integration-1',
    userId: 'service-user-1',
    tenantId: 'tenant-1',
    permissions: ['chat.message.send'],
    expiresAt: '2027-01-01T00:00:00.000Z'
});

// `issuedKey.secret` is returned once; persist only its SHA-256 hash server-side.
const auditTrail = layerAuditRepositoryCreate({
    database,
    auditPepper: process.env.LAYER_AUDIT_PEPPER
});
```

The migrations create schema metadata, hashed browser sessions and API keys,
metadata-only audit records, idempotent command results, immutable domain events,
and the transactional outbox. Outbox rows include bounded publisher leases so
multiple workers can claim work with `FOR UPDATE SKIP LOCKED`. A checksum
mismatch or non-sequential migration fails startup.

API-key resolution accepts only a SHA-256 hash produced at the authentication
boundary, so raw credentials never enter SQL lookups. Revocation is read from
PostgreSQL on every request. Audit records exclude payloads and headers and use
a keyed HMAC for remote-address pseudonymization.

## Failure contract

Configuration and SQL contract violations throw `TypeError` before driver execution. Queries and transactions reject before successful `connect()` and after `close()`. Transaction failures trigger rollback and preserve the primary error. Migration lock, checksum, schema, or connection failures reject startup; callers must keep readiness closed.
