# @solcorp/layer-runtime

**Part of [Layer-Engine](https://www.npmjs.com/package/@solcorp/layer), a JavaScript framework for full PWA applications.** Browser requests, commands, realtime recovery and lifecycle services.

Start with `npm install @solcorp/layer`; this module is installed automatically. You do not need to assemble the framework package by package.

[Quick start](https://github.com/soluser010/layer-engine/blob/main/README.md#quick-start) · [API guide EN](https://github.com/soluser010/layer-engine/blob/main/docs/en/context-api.md) · [Документация RU](https://github.com/soluser010/layer-engine/blob/main/docs/ru/context-api.md) · [Source](https://github.com/soluser010/layer-engine/tree/main/packages/runtime)

Часть фреймворка **Layer-Engine**. Для разработки приложения установите основной пакет `@solcorp/layer`; этот модуль входит в его зависимости. Ссылки выше ведут к назначению, API, примерам и ограничениям модуля.

Browser realtime runtime for Layer-Engine. It opens `events.open` with `fetch`, parses `text/event-stream`, persists per-channel cursors through application callbacks, detects sequence gaps, and reconnects with exponential backoff and jitter.

The same package provides a bounded unified POST client. It validates request and response envelopes, requires matching request identifiers, applies CSRF credentials, limits buffered JSON, distinguishes server failures from transport failures, and exposes explicit network/stale state for queries.

```js
import {layerApiClientCreate} from '@solcorp/layer-runtime';

const api = layerApiClientCreate({
    apiUrl: '/api',
    requestIdCreate: crypto.randomUUID.bind(crypto),
    csrfTokenGet
});
const messagesResult = await api.query('chat.messages.list', {
    dialogId: 'dialog-42'
});
const commandResult = await api.command('chat.message.send', {
    dialogId: 'dialog-42',
    text: 'Hello'
}, {
    commandId: crypto.randomUUID(),
    baseRevision: 7
});
```

`layerCommandRuntimeCreate` connects that transport to a durable outbox. Its `command` method waits for the IndexedDB commit, then returns a live handle with `commandId`, `state`, `result`, `conflict`, `retry()`, `cancel()`, `resolveConflict()`, and `dispose()`. Retry creates a new completion cycle for the same immutable intent; conflict resolution creates a replacement intent and returns its own handle.

```js
const commands = layerCommandRuntimeCreate({
    outbox,
    onlineGet: () => navigator.onLine,
    optimisticApply
});
const handle = await commands.command('chat.message.send', payload, {
    offline: 'queue',
    baseRevision: 7,
    conflictDomain: 'dialog:42'
});

await handle.result;
```

`layerApplicationApiCreate` composes the strict query client, IndexedDB query cache adapter, and durable command runtime into the object-based API consumed by generated `context.api`. Query and command controllers expose framework-neutral immutable snapshots plus `subscribe`; the CLI adapts those snapshots to read-only signals inside each lazy component bundle. Cache fallback is limited to offline/retryable transport failures, so authorization and validation failures cannot be hidden by stale data. See the [English](../../docs/en/context-api.md) and [Russian](../../docs/ru/context-api.md) contracts.

```js
import {
    layerEventRuntimeCreate,
    layerMultiTabEventsCreate,
    layerPostEventStreamCreate
} from '@solcorp/layer-runtime';

const stream = layerPostEventStreamCreate({
    apiUrl: '/api',
    requestIdCreate: crypto.randomUUID.bind(crypto),
    csrfTokenGet
});
const eventRuntime = layerEventRuntimeCreate({
    channels,
    stream,
    cursorRead,
    cursorWrite,
    eventApply,
    syncHandle
});
const multiTabEvents = layerMultiTabEventsCreate({
    originKey: location.origin,
    channels,
    cursorRead,
    eventReceive,
    streamRun: (runData) => eventRuntime.run(runData),
    lockManager: navigator.locks,
    broadcastChannelCreate: (channelName) => new BroadcastChannel(channelName),
    tabIdCreate: crypto.randomUUID.bind(crypto)
});

await multiTabEvents.start();
```

When Web Locks or BroadcastChannel are unavailable, each tab opens its own bounded stream. With coordination enabled, one leader requests replay from the minimum peer cursor while retaining its own local application cursor; duplicate delivery is forwarded to lagging followers without being reapplied by the leader.

`layerEventSubscriptionsCreate` provides the application-facing dynamic channel registry. The first listener starts a runtime, adding or removing the first/last listener for a channel replaces the stream with the exact sorted channel set, and subscriber failures prevent cursor advancement so the event can be replayed.

## DevTools bridge

`layerDevtoolsCreate` registers named diagnostic providers for component/render, queries, outbox, event stream, storage, and PWA state. Snapshots are bounded and cloned, redact configured secret and personal fields, omit stack traces, and require explicit consent when created for export. DevTools are disabled unless the application enables them explicitly.

`layerDevtoolsPanelCreate` renders those snapshots inside an isolated Shadow DOM surface using text nodes only. Refresh is explicit, export calls the bridge with a separate consent callback, and applications control where the final JSON is written. The panel never receives raw provider functions or unsanitized state.

## Failure contract

HTTP and stream failures throw `LayerRuntimeError` with stable `code`, `requestId`, `status`, `retryable`, and `retryAfterMs` fields. Invalid media, JSON, event schemas, unknown channels, unresolved gaps, and heartbeat timeouts fail closed. A `snapshot-required` control record delegates recovery to the declared `syncHandle`; the runtime never performs hidden last-write-wins reconciliation.
