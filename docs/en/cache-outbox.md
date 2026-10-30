---
title: Local cache and command queue
description: Optimistic UI, queue inspection and explicit conflict resolution.
audience: advanced
order: 172
status: release-candidate
updated: 2026-10-28
---

# Local cache and command queue

Use [Context API](context-api.md) in components. This chapter covers local state, a separate layer from server Redis caching.

<!-- contract: cache -->
## Updating active queries

```js
const query = window.layer.api.query({operation: 'chat.messages.list', payload: {roomId: 'room-1'}});
await query.settled();
const cache = window.layer.api.queryCache;
await cache.insert( query.cacheKey, {commandId: 'pending-1', text: 'Pending'} );
await cache.update( query.cacheKey, function( current ){
    //Returning a new collection instead of mutating a shared snapshot
    return {...current, items: current.items.slice( -50 )};

});
await cache.remove( query.cacheKey, function( item ){
    //Removing a particular optimistic record
    return item.commandId === 'pending-1';

});
await cache.removeByCommandId( 'pending-1' );
await query.refresh();
query.dispose();
```

The operation above returns `{items: [...]}`. insert/remove also accept a plain array; scalar data throws TypeError. Methods return the number of selected active queries, not affected rows. A selector is an operation name (all its active queries) or the exact `query.cacheKey`; prefer a key for one room. `removeByCommandId` checks the commandId field across active collections, skipping scalars.

Default keys derive from operation/payload. IndexedDB namespaces isolate identities; never place secrets in keys/payload. A custom `cache.key` must distinguish parameters or it will merge unrelated queries. These methods do not scan historical IndexedDB entries, publish server invalidation or update PostgreSQL.

After optimistic command success, remove the temporary record using its actual commandId and refresh the query or install the confirmed result. Rollback should remove that record, not replace newer data with an old list. Server events and command responses can arrive in either order: deduplicate by domain id/revision. Use `refresh()` to invalidate a client read; there is no universal `cache.invalidate()` here. Server cacheInvalidation tags are covered in [database runtime](database-runtime.md).

<!-- contract: outbox -->
## Inspecting the queue after reload

A normal `context.api.command(...).execute(...)` owns one command lifecycle. Low-level `window.layer.command` returns a handle with result/retry/cancel/resolveConflict/snapshot. Persisted records survive reload; JavaScript handles do not.

The following advanced helper uses public `layerOfflineOutboxCreate`. Supply the current user's open storage (`await window.layer.storageReady()`) and an authenticated `layerApiClientCreate` from your server integration. It must use the same `/api`, cookie/CSRF source and namespace as the main runtime. Do not create another identity or disable CSRF. A managed app does not need a second continuous drain loop: use this helper for the queue panel and explicit retry.

<!-- example: application/outbox.mjs -->
```js
import {layerOfflineOutboxCreate} from '@solcorp/layer-storage';

/** @param {Awaited<ReturnType<typeof import('@solcorp/layer-storage').layerStorageOpen>>} storage @param {any} apiClient */
export function pendingCommandsCreate( storage, apiClient ){
    //Sharing the existing identity namespace and authenticated protocol client
    const outbox = layerOfflineOutboxCreate({
        storage,
        ownerId: globalThis.crypto.randomUUID(),
        commandIdCreate: function(){
            //Creating a fresh identity only for a new intent or resolved conflict
            return globalThis.crypto.randomUUID();

        },
        commandSend: function( command ){
            //Preserving the original command identity during transport retries
            return apiClient.command( command.operation, command.payload, {
                commandId: command.commandId,
                baseRevision: command.baseRevision
            });

        }
    });

    return {
        list: function(){
            //Reading persisted records again after a document restart
            return outbox.list();

        },
        watch: outbox.watch,
        /** @param {string} commandId */
        async retry( commandId ){
            //Retrying existing failed intent without changing its identity
            await outbox.retry( commandId );
            await outbox.drain();
            return outbox.get( commandId );

        },
        /** @param {string} commandId @param {Parameters<ReturnType<typeof layerOfflineOutboxCreate>['resolveConflict']>[1]} resolution */
        async resolve( commandId, resolution ){
            //Replacing conflicted intent only after the user has reviewed current server data
            const replacementId = await outbox.resolveConflict( commandId, resolution );
            await outbox.drain();
            return outbox.get( replacementId );

        },
        cancel: outbox.cancel,
        drain: outbox.drain
    };

}
```

```js
const rows = await pending.list();
const conflict = rows.find( function( row ){ return row.status === 'conflict'; } );
//Call only after loading the authorized latest record and receiving user confirmation.
const resolved = await pending.resolve( conflict.commandId, {
    operation: conflict.operation,
    payload: {id: latest.id, text: mergedText},
    baseRevision: latest.revision,
    conflictDomain: conflict.conflictDomain
});
```

`pending` is the helper; latest is a new server snapshot; mergedText is user-approved text. Check that a conflict exists before calling resolve. States: queued, sending, retryable, failed, conflict, confirmed, cancelled, resolved. Low-level outbox has `list({statuses})`; this helper shows all. `watch(commandId, listener)` returns unsubscribe. Run list again when entering the queue screen after reload.

Retry accepts failed/retryable and retains commandId. Resolve accepts only conflict, creates a new commandId and marks the old record resolved/supersededBy. Retry cannot clear a conflict. Cancel is allowed before an active send and cannot undo an already committed server change.

The response automatically records `confirmed`; there is no public acknowledge method. `record.result` contains the saved transport result. Show command state and safe errors rather than an endless spinner. An unresolved conflict blocks later commands in the same conflictDomain, not other domains.

## Failure contract

`OUTBOX_STATE_INVALID` means the action is not allowed in that state; `OUTBOX_COMMAND_INVALID` means malformed intent. Network failures retain retryable intent; schema/auth/domain failures require a decision. Never change commandId for network retries or send another user's queue after logout. Disposing observation does not delete durable history.

Next: [IndexedDB](indexeddb.md), [reconnect and snapshots](offline-realtime.md).
