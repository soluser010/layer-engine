# @solcorp/layer-storage

**Part of [Layer-Engine](https://www.npmjs.com/package/@solcorp/layer), a JavaScript framework for full PWA applications.** IndexedDB transactions, query caching and offline commands.

Start with `npm install @solcorp/layer`; this module is installed automatically. You do not need to assemble the framework package by package.

[Quick start](https://github.com/soluser010/layer-engine/blob/main/README.md#quick-start) · [API guide EN](https://github.com/soluser010/layer-engine/blob/main/docs/en/indexeddb.md) · [Документация RU](https://github.com/soluser010/layer-engine/blob/main/docs/ru/indexeddb.md) · [Source](https://github.com/soluser010/layer-engine/tree/main/packages/storage)

Часть фреймворка **Layer-Engine**. Для разработки приложения установите основной пакет `@solcorp/layer`; этот модуль входит в его зависимости. Ссылки выше ведут к назначению, API, примерам и ограничениям модуля.

Promise-based IndexedDB storage for Layer-Engine with declarative schemas, sequential upgrade migrations, committed transactions, post-commit watch queries, user export/purge, quota inspection, and a leased offline command outbox.

```js
import {
    layerStorageOpen,
    layerStorageSchemaDefine
} from '@solcorp/layer-storage';

const schema = layerStorageSchemaDefine({
    name: 'messenger',
    version: 1,
    stores: {
        drafts: {
            keyPath: 'dialogId',
            indexes: {
                updated_at: {
                    keyPath: 'updatedAt'
                }
            }
        }
    },
    migrations: {
        1(migration) {
            migration.createStore('drafts');
            migration.createIndex('drafts', 'updated_at');
        }
    }
});
const storage = await layerStorageOpen({
    appId: 'messenger',
    namespace: authenticatedNamespace,
    schema
});
```

Each app/user namespace receives a separate database. Engine stores use the reserved `__layer_` prefix and cannot be declared or accessed through developer transactions. Migrations are synchronous because IndexedDB upgrade transactions must not wait on unrelated asynchronous work.

The offline outbox persists `commandId`, `baseRevision`, conflict domain, optimistic patch, and intent before calling the network. Leases prevent page and Service Worker drains from claiming the same command. `get` and `watch` expose immutable committed command snapshots; `cancel` is allowed only before an active send owns the command. Revision conflicts pause their domain and require explicit `resolveConflict`; hidden last-write-wins is not implemented.

The generated application records the current isolated database through `layerWorkerOutboxConfigure()`. Its Service Worker creates a bounded drain with `layerWorkerOutboxDrainCreate()`, claims at most one command per conflict domain, uses the same `POST /api` command envelope, enforces a request timeout and validates the success/error response contract. Network, timeout, 408, 425, 429 and 5xx failures remain retryable; conflicts and permanent protocol failures are committed without hidden retries. `layerWorkerOutboxConfigurationClear()` removes the worker pointer during logout before user data is deleted.

The registry accepts only a database owned by the same app id and a same-origin HTTP(S) API URL. The worker never trusts identity, tenant or permissions from IndexedDB; those remain server-derived from the session cookie. Corrupted records are quarantined as failed and are never sent.

Incoming Web Share Target POST bodies use a separate app-scoped temporary inbox. The worker capture validates the exact same-origin manifest action, declared form fields, MIME/extension rules, request/file/text byte budgets, file count, record count, UUID and retention period before committing anything. Files are persisted as bounded bytes for WebKit compatibility and returned as standard immutable Blob records. `consume()` removes a share in the same transaction that reads it, so delivery is one-time; `discard()` rejects an unwanted share and `purge()` deletes the complete temporary inbox during logout.

```js
import {
    layerShareTargetInboxCreate,
    layerWorkerShareTargetCaptureCreate
} from '@solcorp/layer-storage';

const shareTarget = {
    action: '/share',
    method: 'POST',
    enctype: 'multipart/form-data',
    params: {
        text: 'text',
        files: [{
            name: 'files',
            accept: ['image/png', '.png']
        }]
    }
};
const capture = layerWorkerShareTargetCaptureCreate({
    appId: 'messenger',
    applicationOrigin: self.location.origin,
    shareTarget,
    shareIdCreate: () => crypto.randomUUID()
});
const shareId = await capture(request);
const inbox = layerShareTargetInboxCreate({appId: 'messenger'});
const sharedRecord = await inbox.consume(shareId);
```

## Failure contract

`LayerStorageError` distinguishes unavailable storage, blocked upgrade, migration failure, quota exhaustion, corruption, closed connections, invalid transactions, outbox state, invalid worker configuration, a missing worker outbox store, invalid Share Target requests/fields/files, exceeded size limits, a full temporary inbox, and blocked or failed temporary storage. Watch callbacks run only after transaction completion. `purgeUserData()` closes and deletes the entire current user namespace for logout; Share Target data is isolated and requires its own `purge()` call.
