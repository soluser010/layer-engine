---
title: Server events from transaction to tab
description: Channel authorization, journal, outbox, delivery and recovery.
audience: advanced
order: 174
status: documented
updated: 2026-10-28
---

# Server events from transaction to tab

Deliver only committed changes, isolated by tenant. This is a serverEntry integration of existing primitives; browser-side Redis publication cannot replace it.

<!-- contract: events -->
## Wiring and operation

<!-- example: application/events.mjs -->
```js
import {
    layerEventRepositoryCreate,
    layerOutboxRepositoryCreate,
    layerEventStreamManagerCreate,
    layerEventDistributionCreate,
    layerOutboxPublisherCreate,
    layerEventsOpenOperationDefinitionCreate
} from '@solcorp/layer-events';

/** @param {any} launcher @param {any} registry @param {any} diagnostics @returns {Record<string, any>} */
export function messageEventsCreate( launcher, registry, diagnostics ){
    //Keeping the system adapter inside trusted bootstrap, never in an operation payload
    const eventRepository = layerEventRepositoryCreate({database: launcher.databaseRuntime});
    const outboxRepository = layerOutboxRepositoryCreate({database: launcher.databaseRuntime});
    const eventStream = layerEventStreamManagerCreate({eventRepository, diagnostics});
    const eventDistribution = layerEventDistributionCreate({
        eventBus: launcher.eventBus,
        eventRepository,
        streamManager: eventStream,
        diagnostics
    });
    const publisher = layerOutboxPublisherCreate({
        outboxRepository,
        eventBus: launcher.eventBus,
        owner: launcher.workerId
    });

    //Authorizing the exact tenant channel using verified identity, not payload ownership
    registry.define( layerEventsOpenOperationDefinitionCreate({
        permissions: ['messages.read'],
        channelAuthorize: function( channel, security ){
            //Accepting only this verified tenant's exact application channel
            return typeof security.tenantId === 'string' &&
                channel === 'tenant:' + security.tenantId + ':messages';

        }
    }) );

    return {eventRepository, eventStream, eventDistribution, publisher};

}

/** @param {{text: string}} payload @param {any} context */
export async function messageSend( payload, context ){
    //Writing application data through the executor's transaction-bound facade
    const message = await context.database.table( 'messages' ).insert({
        values: {text: payload.text, revision: 1},
        returning: ['id', 'text', 'revision']
    });
    const tenantKey = context.security.tenantId;

    //Appending the domain event and delivery outbox before the same transaction commits
    await context.events.append({
        tenantKey,
        channel: 'tenant:' + tenantKey + ':messages',
        entityRevision: message.revision,
        type: 'message.created',
        payload: message
    });

    return message;

}
```

`launcher` is the `layerServerCreate` factory context, `registry` your operation registry, and `diagnostics` a `layerDiagnosticsCreate(...)` instance. The messages table comes from [Structured CRUD](structured-data.md). Register messageSend with session auth, messages.write, transaction:true and strict schemas, including the commandId/baseRevision payload fields from the [command contract](operations.md). Your server identity must have a tenantId; do not use auth:none.

Pass the returned `eventRepository` into `layerOperationExecutorCreate`, together with `database: launcher.databaseRuntime` and `databaseSchema: launcher.databaseSchema`. Pass `eventStream` and `eventDistribution` into `layerHttpRuntimeCreate`, along with the executor and other [server runtime](server-runtime.md) dependencies. HTTP lifecycle starts distribution and drains streams during stop.

Call `publisher.runOnce()` from a managed server loop, for example once a second without overlapping runs. During stop, stop scheduling, await the current runOnce and HTTP drain, then close the database. Outbox leases permit a publisher on every worker; an unmanaged setInterval is not a lifecycle. Report failures through safe diagnostics and retry after lease expiry/dependency recovery.

## Where acknowledgement happens

The managed host starts Redis pub/sub in the background and recovers it after prolonged outages while durable database delivery remains active. For a manual host, pass `backgroundConnect: true` to `layerRedisEventBusCreate` and use `layerHybridEventBusCreate` with durable fallback. In this mode, `await bus.start(listener)` means the lifecycle has started, not that subscription is ready; check `bus.isReady()` separately. By default, low-level `start` awaits the first bounded series and may reject, but background retries continue until `stop()`. Call `stop()` after failure if you no longer use the object. `layerCacheInvalidationSynchronizerCreate(...).start({background: true})` likewise does not await its first pass; call `stop()` together with cancellation of any pending transport connection.

| Step | Guarantee |
| --- | --- |
| Executor begins command transaction | Replay identity checks actor/operation/payload |
| Handler changes message and calls events.append | Sequence, journal and outbox share the same SQL transaction |
| Executor saves command result and commits | A failure before commit rolls back all writes |
| Publisher reads outbox and publishes routing metadata | Redis accelerates; PostgreSQL retains payload authority |
| Distribution loads event by tenant/eventId | Stream manager sends only to authorized subscribers |
| Runtime applies event and persists cursor | Repeated eventId/sequence is not another business action |

Outbox transport is at-least-once, not exactly-once. Sending before markPublished can lead to repetition. Never advance the cursor before successful application.

## Two tenants and recovery

Tenant A may subscribe only to `tenant:A:messages`; B only to `tenant:B:messages`. The predicate rejects A requesting B even if the channel name is known. events.append takes its tenant key from context.security; low-level append trusts server code and cannot correct a developer's wrong key.

Client `context.events.subscribe(channel, handler)` uses the shared POST Fetch Stream and multi-tab coordination. Reconnect replays from cursor. If retention no longer covers that position, `eventSync` calls an authorized application sync operation, receives a consistent snapshot/cursor, applies state and only then returns cursor. See the complete hook in [offline/realtime](offline-realtime.md). A SELECT followed by an independently read newer head is not a consistent snapshot.

## Failure contract

Denied channels return `OBJECT_ACCESS_DENIED`; missing identity returns `AUTH_REQUIRED`. Missing journal/transport is a dependency error, not an empty successful stream. Slow subscribers disconnect under queue/write limits and recover from cursor. Logout removes subscriptions and closes the previous namespace; never share credentials across tenants.

Next: [offline/realtime](offline-realtime.md), [cache](cache-outbox.md).
