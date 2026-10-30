# @solcorp/layer-events

**Part of [Layer-Engine](https://www.npmjs.com/package/@solcorp/layer), a JavaScript framework for full PWA applications.** Durable events, realtime streams and optional Redis distribution.

Start with `npm install @solcorp/layer`; this module is installed automatically. You do not need to assemble the framework package by package.

[Quick start](https://github.com/soluser010/layer-engine/blob/main/README.md#quick-start) · [API guide EN](https://github.com/soluser010/layer-engine/blob/main/docs/en/server-events.md) · [Документация RU](https://github.com/soluser010/layer-engine/blob/main/docs/ru/server-events.md) · [Source](https://github.com/soluser010/layer-engine/tree/main/packages/events)

Часть фреймворка **Layer-Engine**. Для разработки приложения установите основной пакет `@solcorp/layer`; этот модуль входит в его зависимости. Ссылки выше ведут к назначению, API, примерам и ограничениям модуля.

Durable realtime infrastructure for Layer-Engine without WebSocket. PostgreSQL is the source of truth; Redis carries only small routing notifications after commit. Clients open a long-lived `POST /api` request and receive SSE-compatible records through Fetch Streams.

```js
import {
    layerEventRepositoryCreate,
    layerEventStreamManagerCreate,
    layerOutboxPublisherCreate,
    layerOutboxRepositoryCreate,
    layerRedisEventBusCreate
} from '@solcorp/layer-events';

const eventRepository = layerEventRepositoryCreate({database});
const outboxRepository = layerOutboxRepositoryCreate({database});
const eventBus = layerRedisEventBusCreate({
    url: process.env.LAYER_REDIS_URL
});
const streamManager = layerEventStreamManagerCreate({
    eventRepository,
    diagnostics
});
const outboxPublisher = layerOutboxPublisherCreate({
    outboxRepository,
    eventBus,
    owner: processIdentifier
});
```

Domain changes and `eventRepository.append(transactionClient, event)` must run in the same PostgreSQL transaction. The outbox publisher is deliberately exposed as `runOnce()` so the host controls scheduling, supervision, and shutdown.

Production deployments require a Redis release supported by the pinned `redis` client (currently Redis 7.2 or newer). The event bus deliberately uses RESP2 because its contract needs only portable publish/subscribe commands. Connection attempts use a five-second timeout and three bounded reconnects by default; `connectionTimeoutMs` and `reconnectAttempts` may be reduced for health-sensitive environments. Exhaustion rejects startup or removes readiness so the process supervisor can recover the instance instead of hanging indefinitely.

## Recovery and failure contract

- replay accepts a per-channel sequence cursor and fails with `CURSOR_EXPIRED` when retention no longer contains a complete continuation;
- stream gaps are recovered from PostgreSQL before live delivery; an oversized recovery emits `snapshot-required` and closes the stream;
- Redis loss cannot lose committed events, but it may delay live notification until replay/reconnect;
- each stream is bounded by channel, user, IP, replay, backpressure, and heartbeat limits;
- server drain emits `server-drain` before ending active responses.

Service Workers must not own this persistent stream because browsers may suspend them.
