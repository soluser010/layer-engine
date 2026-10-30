---
title: IndexedDB for application data
description: Schemas, migrations, transactions, watch and local storage cleanup.
audience: intermediate
order: 171
status: release-candidate
updated: 2026-10-28
---

# IndexedDB for application data

Keep drafts and local data separate from the server source of truth. A managed application can export `storageSchema` from `src/app.js`; runtime opens it in its user namespace. Use `layerStorageOpen` below for an independent store. Do not create a second engine outbox unnecessarily.

<!-- contract: storage -->
## Sequential migrations

<!-- example: application/storage.mjs -->
```js
import {layerStorageOpen, layerStorageSchemaDefine} from '@solcorp/layer-storage';

export const draftSchema = layerStorageSchemaDefine({
    name: 'message-drafts',
    version: 2,
    stores: {
        drafts: {
            keyPath: 'id',
            indexes: {by_room: {keyPath: 'roomId'}}
        }
    },
    migrations: {
        1: function( /** @type {{createStore: (name: string) => void}} */ migration ){
            //Creating the store during the first synchronous upgrade
            migration.createStore( 'drafts' );

        },
        2: function( /** @type {{createIndex: (store: string, index: string) => void}} */ migration ){
            //Adding the declared index for existing version-one databases
            migration.createIndex( 'drafts', 'by_room' );

        }
    }
});

/** @param {string} namespace @param {IDBFactory} [indexedDb] @returns {ReturnType<typeof layerStorageOpen>} */
export async function draftStorageOpen( namespace, indexedDb = globalThis.indexedDB ){
    //Opening a separate identity namespace chosen from authenticated application state
    return layerStorageOpen({
        appId: 'chat',
        namespace,
        schema: draftSchema,
        indexedDb
    });

}

/** @param {Awaited<ReturnType<typeof layerStorageOpen>>} storage @param {{id: string, roomId: string, text: string}} draft */
export async function draftSave( storage, draft ){
    //Keeping all reads and writes inside one IndexedDB transaction
    return storage.transaction( ['drafts'], 'readwrite', async function( transaction ){
        //Reading back the value from the same write transaction
        await transaction.put( 'drafts', draft );
        return transaction.get( 'drafts', draft.id );

    });

}
```

`draftStorageOpen('user-123')` returns storage; choose namespace from verified identity, not a URL. First installation runs migrations 1 and 2; upgrading version 1 runs only 2. Migration callbacks are synchronous and return undefined: no fetch/await. `deleteStore`, `deleteIndex` and `hasStore` are also available during upgrade, limited to application stores. Migrations must bring physical stores/indexes into agreement with the new schema; application code owns destructive data changes.

## Reads, observation and transactions

```js
const storage = await draftStorageOpen( 'user-123' );
await draftSave( storage, {id: 'draft-1', roomId: 'room-1', text: 'Hello'} );
const draft = await storage.get( 'drafts', 'draft-1' );
const roomDrafts = await storage.query( 'drafts', {index: 'by_room', query: 'room-1', count: 50} );
const stopWatching = storage.watch(
    ['drafts'],
    function(){ return storage.query( 'drafts' ); },
    function( drafts ){ console.log( drafts.length ); }
);
await storage.delete( 'drafts', 'draft-1' );
stopWatching();
```

`put` replaces the same key; `query` returns an array and accepts index/query/count. Only await requests belonging to the transaction: waiting for network or a timer may let the browser finish it. Errors roll back writes. `watch` runs an initial query and refreshes after successful local transactions, returning unsubscribe. It is not a cross-tab subscription for developer stores. Notify other tabs and query again explicitly; engine event coordination does not make every user table a realtime store.

## Lifecycle and space

`estimate()` returns usage/quota (or unavailable values); `exportUserData()` returns `{database, exportedAt, stores}`, including user data and permitted system stores. Treat this as a sensitive export; do not upload automatically. `close()` closes the handle; `purgeUserData()` closes and deletes this entire namespace. Before logout/purge, finish work, unsubscribe and close associated handles in every tab. Other namespaces remain intact.

`layerStorageOpen` accepts `blockedHandle`, `versionChangeHandle` and `blockedTimeoutMs`. Tell users when an old window prevents upgrade/deletion. A versionchange closes the existing handle; obtain a new one after restarting. Do not disable this to keep an obsolete connection alive.

## Failure contract

Unavailable IndexedDB, quota, blocked upgrades, invalid migrations and closed handles reject with `LayerStorageError`. Do not pretend an in-memory write is durable outbox success; offer another way to save input. System `eventCursors`, `queryCache`, `entities` and `drafts` have dedicated facades; developer transactions cannot access arbitrary `__layer_*` stores.

Next: [outbox and realtime](offline-realtime.md), [Context API](context-api.md).
