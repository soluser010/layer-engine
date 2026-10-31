---
title: Offline, outbox, and realtime without WebSocket
description: Durable commands, conflicts, cursor replay, and POST Fetch Stream.
audience: intermediate
order: 170
status: documented
updated: 2026-10-20
---

# Offline, outbox, and realtime without WebSocket

## Slow subscribers and memory bounds

Server-side `layerEventStreamManagerCreate` bounds pending events and frames per subscriber: `maxQueuedEvents` defaults to 256, `maxQueuedBytes` to 1048576 bytes independently for the event/write queue, and `writeTimeoutMs` to 10000 ms. Maximum accepted values are 4096 events, 16 MiB and 60000 ms; values must be positive integers. The byte limit measures serialized data, not the entire process heap.

Overflow or an expired write deadline closes only the slow stream. The client recovers from its last applied cursor using the PostgreSQL journal; disconnecting neither deletes events nor acknowledges their application. Expired cursors use the existing `eventSync` hook. Delivery of a control frame cannot be guaranteed on an already blocked socket. Total server drain is also bounded by `writeTimeoutMs`; closed subscribers must not accumulate new replay requests. SQL already in flight finishes according to the database deadline.

Outbox delivery is at least once: if publication succeeds but `markPublished` fails, an event can be sent again. EventId/sequence deduplication is required. If releaseFailed fails, its lease remains until expiry; the next successful publisher run must reclaim it. Check oldest pending and queue recovery rather than treating a single database error as proof of lost events.

## Goal

Submit an idempotent command while offline and recover the event stream from a cursor.

## Example

```js
const messageSendCommandData = context.api.command({
    operation: 'chat.message.send',
    offline: {
        strategy: 'outbox'
    }
});

const messageSendResultData = await messageSendCommandData.execute({
    baseRevision: Number( room.revision ),
    roomId: String( room.id ),
    text: String( draftSignal.peek() )
});
```

```js
const eventSubscriptionDispose = context.events.subscribe(
    String( 'chat:' + room.id ),
    async function roomEventReceive( eventData ){
        //Applying the committed domain event to application state
        await roomEventApply( eventData );

    }
);

context.onDestroy(function roomEventDispose(){
    //Removing this component listener and closing an unused channel
    eventSubscriptionDispose();

});
```

## Expected result

The command enters the IndexedDB outbox first, redelivery returns the previous command result, and the event stream continues its sequence after reconnect.

## Explanation

Realtime uses a long `POST /api` Fetch Stream with `text/event-stream`. One tab becomes the leader through Web Locks/BroadcastChannel. The Service Worker never owns the persistent stream.

## Online-only commands

For sensitive payloads such as a one-time phone verification code, use `window.layer.api.commandOnline(operation, payload, {baseRevision: 0})` or the `window.layer.commandOnline` alias. This call does not write a command to the IndexedDB outbox or perform offline replay. Without a network connection it fails with `COMMAND_OFFLINE`; reconnecting does not trigger deferred delivery. Ordinary `context.api.command` persists commands in the outbox, so it is unsuitable for such a code. See [CommandOnline](context-api.md#commandonline) for the contract, example, and resubmission rules.

## Snapshot and cursor recovery

Export `eventSync(gap, context)` from `src/app.js`. Layer calls it for sequence gaps, `snapshot-required` records, and pre-open HTTP `CURSOR_EXPIRED/409`. Context contains `api`, `storage`, and `signal`. The application obtains an authorized snapshot through its own `sync` operation; this does not replay a command.

```js
import {domainSnapshotApply} from './domain/snapshot.js';

export async function eventSync( gap, {api, storage, signal} ){
    //Getting an authorized snapshot and its cursor from the same consistent server-side point
    const snapshotResult = await api.sync( 'application.state.sync', {channel: gap.channel}, {signal} );
    signal?.throwIfAborted();

    //Installing application state before acknowledging the associated event sequence
    await domainSnapshotApply( snapshotResult.data, {signal} );
    signal?.throwIfAborted();
    await storage.eventCursors.write( gap.channel, snapshotResult.data.cursor );

    //Returning this tab's exact applied position rather than another tab's newer shared cursor
    return {cursor: snapshotResult.data.cursor};

}
```

`application.state.sync` and `domainSnapshotApply` belong to your application; they are not built-in Layer functions. The operation checks identity, permissions, and channel access. Snapshot data and cursor must describe one consistent state: do not load data and then attach a newer event head without coordination. Apply the snapshot to the data source/UI before advancing its cursor.

The recommended hook result is `{cursor: nonNegativeSafeInteger}`. Layer validates the position and reopens the stream through normal authorization. Legacy hooks returning `undefined` remain supported: Layer rereads the durable cursor. With concurrent tabs, return an explicit `{cursor}` because the shared IndexedDB cursor may already be ahead of the snapshot applied in this tab.

The leader uses the minimum peer position for initial replay and then advances a separate wire cursor. After a snapshot it broadcasts channel metadata only; each follower invokes its own `eventSync`. Snapshot hooks and events are serialized, and duplicates are not applied again. A shared IndexedDB cursor is not a substitute for each tab's applied-state position.

A subscription allows at most three consecutive snapshot recoveries per channel without a newly applied event. `STREAM_RECOVERY_STALLED` stops the loop; `STREAM_RECOVERY_INVALID` means invalid channels or cursor; a missing hook produces `EVENT_SYNC_REQUIRED`. `eventFailure` cannot turn `401/403` into endless retries. The `eventFailure({error, attempt, retryDelayMs})` hook returns a boolean for ordinary transport retries. Lifecycle failures are delivered to `onError`.

On logout/dispose/subscription replacement, Layer cancels its hook wait and does not reopen the stream. The hook must honor `signal`: the framework cannot cancel arbitrary application writes that ignore cancellation. Never reset the cursor or choose the current sequence without applying its corresponding snapshot.

## Common errors

- Creating a new `commandId` for a retry creates a new command.
- Ignoring `baseRevision` hides a conflict.
- Keeping the cursor only in memory prevents replay after restart.

## Failure contract

A sequence gap moves the runtime to `sync`/snapshot. A conflict is returned to the application or an explicit merge policy; there is no hidden last-write-wins. Backoff uses jitter and avoids reconnect storms.

Next: [PWA and Service Worker](pwa-service-worker.md), [Context API](context-api.md).
