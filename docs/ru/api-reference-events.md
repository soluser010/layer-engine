---
title: Справочник сигнатур — @solcorp/layer-events
description: Параметры, возвращаемые значения и связанные типы.
audience: advanced
order: 310
status: documented
updated: 2026-10-31
---

# Справочник сигнатур — @solcorp/layer-events

Начните с [руководства и примеров](server-events.md). Ниже — точные формы публичных вызовов и вложенных options текущей версии. Это справочник обозначений, **не код для вставки в приложение**: приложение остаётся JavaScript ESM. `?` означает необязательность, `|` — варианты, `Promise<T>` — асинхронный результат; readonly запрещает изменение через этот контракт. Необязательность не задаёт default: поведение и значения по умолчанию описаны в тематической статье.

Подпись описывает форму данных, а не доступность браузерной функции и не гарантию подключения provider. Server API нельзя переносить в браузер. Advanced factories нужны для собственного host; обычный компонент использует context. Ограничения route/cache/offline: [настройки страницы](page-configuration.md).

## Импорты

| Import | Export |
| --- | --- |
| `@solcorp/layer-events` | `layerDatabaseEventBusCreate` |
| `@solcorp/layer-events` | `layerCacheInvalidationSynchronizerCreate` |
| `@solcorp/layer-events` | `layerEventDistributionCreate` |
| `@solcorp/layer-events` | `layerEventRepositoryCreate` |
| `@solcorp/layer-events` | `layerEventStreamManagerCreate` |
| `@solcorp/layer-events` | `layerEventsOpenOperationDefinitionCreate` |
| `@solcorp/layer-events` | `layerOutboxPublisherCreate` |
| `@solcorp/layer-events` | `layerOutboxRepositoryCreate` |
| `@solcorp/layer-events` | `layerHybridEventBusCreate` |
| `@solcorp/layer-events` | `layerRedisEventBusCreate` |
| `@solcorp/layer-events` | `layerRedisCoordinationCreate` |
| `@solcorp/layer-events` | `layerRedisQueryCacheCreate` |
| `@solcorp/layer-events` | `layerControlFrameCreate` |
| `@solcorp/layer-events` | `layerEventFrameCreate` |
| `@solcorp/layer-events` | `layerHeartbeatFrameCreate` |

## Параметры и результаты

Именованные типы раскрываются ниже; типы DOM и внешних библиотек сохраняют свои стандартные имена. Одинаковый helper из другого Layer-пакета включён только если нужен для публичной подписи.

[LayerAuthorizedStream](#layerauthorizedstream) · [layerCacheInvalidationSynchronizerCreate](#layercacheinvalidationsynchronizercreate) · [layerControlFrameCreate](#layercontrolframecreate) · [layerDatabaseEventBusCreate](#layerdatabaseeventbuscreate) · [LayerEventBus](#layereventbus) · [layerEventDistributionCreate](#layereventdistributioncreate) · [layerEventFrameCreate](#layereventframecreate) · [LayerEventQueryTarget](#layereventquerytarget) · [layerEventRepositoryCreate](#layereventrepositorycreate) · [layerEventsOpenOperationDefinitionCreate](#layereventsopenoperationdefinitioncreate) · [layerEventStreamManagerCreate](#layereventstreammanagercreate) · [layerHeartbeatFrameCreate](#layerheartbeatframecreate) · [layerHybridEventBusCreate](#layerhybrideventbuscreate) · [layerOutboxPublisherCreate](#layeroutboxpublishercreate) · [layerOutboxRepositoryCreate](#layeroutboxrepositorycreate) · [LayerRedisClient](#layerredisclient) · [layerRedisCoordinationCreate](#layerrediscoordinationcreate) · [layerRedisEventBusCreate](#layerrediseventbuscreate) · [layerRedisQueryCacheCreate](#layerredisquerycachecreate) · [LayerStreamEvent](#layerstreamevent)

### LayerAuthorizedStream

```typescript
export type LayerAuthorizedStream = {
    tenantKey: string;
    userId: string;
    channels: readonly string[];
};
```

### layerCacheInvalidationSynchronizerCreate

```typescript
export declare function layerCacheInvalidationSynchronizerCreate(synchronizerOptionsData: {
    repository: {
        readAfter: (replayData: {
            cursor: number;
            limit: number;
        }) => Promise<readonly Record<string, any>[]>;
    };
    cache: {
        invalidate: (invalidationData: Record<string, unknown>) => Promise<unknown>;
        invalidationCursorRead: () => Promise<number>;
        invalidationCursorWrite: (cursorData: number) => Promise<void>;
    };
    pollIntervalMs?: number;
    batchSize?: number;
    diagnostics?: {
        record: (diagnosticData: Record<string, unknown>) => void;
    };
    beforeSynchronize?: () => Promise<unknown>;
    connectionVersionRead?: () => number;
}): Readonly<{
    start({ background }?: {
        background?: boolean | undefined;
    }): Promise<void>;
    synchronize(): Promise<number>;
    stop(): Promise<void>;
    cursorGet(): number;
    isReady(): boolean;
}>;
```

### layerControlFrameCreate

```typescript
export declare function layerControlFrameCreate(controlType: string, controlData: Record<string, unknown>): string;
```

### layerDatabaseEventBusCreate

```typescript
export declare function layerDatabaseEventBusCreate(busOptionsData: {
    database: {
        systemSchema?: string;
        query: (queryData: {
            text: string;
            values: readonly unknown[];
        }) => Promise<{
            rows: Record<string, unknown>[];
            rowCount: number | null;
        }>;
    };
    cursor?: number | 'latest';
    pollIntervalMs?: number;
    batchSize?: number;
    diagnostics?: {
        record: (diagnosticData: Record<string, unknown>) => void;
    };
}): Readonly<{

    start(nextListenerData: (routingData: {
        eventId: string;
        tenantKey: string;
        channel: string;
    }) => void | Promise<void>): Promise<void>;

    publish(routingData: {
        eventId: string;
        tenantKey: string;
        channel: string;
    }): Promise<void>;
    synchronize(): Promise<number>;
    stop(): Promise<void>;
    isReady(): boolean;
    cursorGet(): number;
}>;
```

### LayerEventBus

```typescript
export type LayerEventBus = Readonly<{
    start: (listenerData: (routingData: {
        eventId: string;
        tenantKey: string;
        channel: string;
    }) => void | Promise<void>) => Promise<void>;
    publish: (routingData: {
        eventId: string;
        tenantKey: string;
        channel: string;
    }) => Promise<void>;
    stop: () => Promise<void>;
    isReady: () => boolean;
}>;
```

### layerEventDistributionCreate

```typescript
export declare function layerEventDistributionCreate(distributionOptions: {
    eventBus: {
        start: Function;
        stop: Function;
    };
    eventRepository: {
        findById: Function;
    };
    streamManager: {
        dispatch: Function;
    };
    diagnostics: {
        record: (diagnosticData: Record<string, unknown>) => void;
    };
}): Readonly<{
    start(): Promise<void>;
    stop(): Promise<void>;
    isReady(): boolean;
}>;
```

### layerEventFrameCreate

```typescript
export declare function layerEventFrameCreate(eventData: {
    eventId: string;
    channel: string;
    sequence: number;
    entityRevision: number;
    type: string;
    payload: Record<string, unknown>;
    occurredAt: string;
}): string;
```

### LayerEventQueryTarget

```typescript
export type LayerEventQueryTarget = {
    query: (queryData: {
        text: string;
        values: readonly unknown[];
    }) => Promise<{
        rows: Record<string, unknown>[];
        rowCount: number | null;
    }>;
};
```

### layerEventRepositoryCreate

```typescript
export declare function layerEventRepositoryCreate(repositoryOptions: {
    database: LayerEventQueryTarget;
    eventIdCreate?: () => string;
    clock?: () => Date;
}): Readonly<{

    append(transactionClient: LayerEventQueryTarget, eventData: {
        tenantKey: string;
        channel: string;
        entityRevision: number;
        type: string;
        payload: Record<string, unknown>;
    }): Promise<Readonly<{
        eventId: string;
        channel: string;
        sequence: number;
        entityRevision: number;
        type: string;
        payload: Record<string, unknown>;
        occurredAt: string;
    }>>;

    replay(replayData: {
        tenantKey: string;
        channels: readonly string[];
        cursor: Readonly<Record<string, number>>;
        limit: number;
    }): Promise<Readonly<{
        events: readonly Readonly<{
            eventId: string;
            channel: string;
            sequence: number;
            entityRevision: number;
            type: string;
            payload: Record<string, unknown>;
            occurredAt: string;
        }>[];
        hasMore: boolean;
    }>>;

    findById(tenantKey: string, eventIdentifier: string): Promise<Readonly<{
        eventId: string;
        channel: string;
        sequence: number;
        entityRevision: number;
        type: string;
        payload: Record<string, unknown>;
        occurredAt: string;
    }> | null>;
}>;
```

### layerEventsOpenOperationDefinitionCreate

```typescript
export declare function layerEventsOpenOperationDefinitionCreate(operationOptions: {
    channelAuthorize: (channelName: string, securityContext: Readonly<Record<string, unknown>>) => boolean | Promise<boolean>;
    permissions?: readonly string[];
}): {
    name: string;
    type: 'events.open';
    inputSchema: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            channels: {
                type: string;
                minItems: number;
                maxItems: number;
                uniqueItems: boolean;
                items: {
                    type: string;
                    minLength: number;
                    maxLength: number;
                    pattern: string;
                };
            };
        };
    };
    outputSchema: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            tenantKey: {
                type: string;
                minLength: number;
                maxLength: number;
            };
            userId: {
                type: string;
                minLength: number;
                maxLength: number;
            };
            channels: {
                type: string;
                minItems: number;
                maxItems: number;
                uniqueItems: boolean;
                items: {
                    type: string;
                };
            };
        };
    };
    auth: 'session';
    permissions: readonly string[];
    rateLimitBucket: string;
    cost: number;
    timeoutMs: number;
    concurrency: number;
    transaction: boolean;
    offlineReplay: boolean;
    audit: {
        enabled: boolean;
        category: string;
    };
    handler(
     payloadData: unknown,
     handlerContext: unknown): Promise<{
        tenantKey: string;
        userId: string;
        channels: string[];
    }>;
};
```

### layerEventStreamManagerCreate

```typescript
export declare function layerEventStreamManagerCreate(managerOptions: {
    eventRepository: {
        replay: Function;
    };
    diagnostics: {
        record: (diagnosticData: Record<string, unknown>) => void;
    };
    heartbeatMs?: number;
    maxChannels?: number;
    maxReplayEvents?: number;
    maxStreamsPerUser?: number;
    maxStreamsPerIp?: number;
    maxQueuedEvents?: number;
    maxQueuedBytes?: number;
    writeTimeoutMs?: number;
    clock?: () => Date;
}): Readonly<{

    open(openData: {
        response: import('node:http').ServerResponse;
        authorization: LayerAuthorizedStream;
        cursor: Readonly<Record<string, number>> | null;
        remoteAddress: string;
        requestId: string;
    }): Promise<void>;

    dispatch(tenantKey: string, eventData: LayerStreamEvent): void;
    drain(): Promise<void>;
    activeCount(): number;
}>;
```

### layerHeartbeatFrameCreate

```typescript
export declare function layerHeartbeatFrameCreate(heartbeatTime: Date): string;
```

### layerHybridEventBusCreate

```typescript
export declare function layerHybridEventBusCreate(busOptionsData: {
    fallback: LayerEventBus;
    primary?: LayerEventBus | null;
    diagnostics?: {
        record: (diagnosticData: Record<string, unknown>) => void;
    };
}): Readonly<{

    start(listenerData: (routingData: {
        eventId: string;
        tenantKey: string;
        channel: string;
    }) => void | Promise<void>): Promise<void>;

    publish(routingData: {
        eventId: string;
        tenantKey: string;
        channel: string;
    }): Promise<void>;
    stop(): Promise<void>;
    isReady(): boolean;
    isAccelerated(): boolean;
}>;
```

### layerOutboxPublisherCreate

```typescript
export declare function layerOutboxPublisherCreate(publisherOptions: {
    outboxRepository: {
        claim: Function;
        markPublished: Function;
        releaseFailed: Function;
    };
    eventBus: {
        publish: Function;
    };
    owner: string;
    batchSize?: number;
    leaseMs?: number;
}): Readonly<{
    runOnce(): Promise<Readonly<{
        claimed: any;
        published: number;
        failed: number;
    }>>;
}>;
```

### layerOutboxRepositoryCreate

```typescript
export declare function layerOutboxRepositoryCreate(repositoryOptions: {
    database: {
        query: Function;
        transaction: Function;
    };
}): Readonly<{

    claim(claimData: {
        owner: string;
        limit: number;
        leaseMs: number;
    }): Promise<any>;

    markPublished(owner: string, outboxIdentifier: number): Promise<void>;

    releaseFailed(owner: string, outboxIdentifier: number, publishError: unknown): Promise<void>;
}>;
```

### LayerRedisClient

```typescript
export type LayerRedisClient = {
    connect: () => Promise<unknown>;
    quit: () => Promise<unknown>;
    destroy?: () => void;
    readonly isOpen?: boolean;
    readonly isReady?: boolean;
    on: (eventName: string, handler: (...argumentItemsData: any[]) => void) => unknown;
    publish: (channelName: string, messageData: string) => Promise<number>;
    subscribe: (channelName: string, listener: (messageData: string) => void) => Promise<unknown>;
    unsubscribe: (channelName: string) => Promise<unknown>;
};
```

### layerRedisCoordinationCreate

```typescript
export declare function layerRedisCoordinationCreate(coordinationOptionsData: {
    redis: {
        set: (keyData: string, valueData: string, optionsData: Record<string, unknown>) => Promise<unknown>;
        eval: (scriptData: string, optionsData: {
            keys: string[];
            arguments: string[];
        }) => Promise<unknown>;
        zAdd: (keyData: string, valueData: {
            score: number;
            value: string;
        }) => Promise<unknown>;
        zRem: (keyData: string, valueData: string) => Promise<unknown>;
        zRemRangeByScore: (keyData: string, minimumData: number | string, maximumData: number | string) => Promise<unknown>;
        zRangeByScore: (keyData: string, minimumData: number | string, maximumData: number | string, optionsData: Record<string, unknown>) => Promise<unknown>;
        pExpire: (keyData: string, ttlData: number) => Promise<unknown>;
    };
    namespace: string;
    maximumPresenceMembers?: number;
    clock?: () => number;
    tokenCreate?: () => string;
}): Readonly<{
    locks: Readonly<{
        acquire(lockNameData: string, timeToLiveData: number): Promise<Readonly<{
            name: string;
            renew(timeToLiveData: number): Promise<boolean>;
            release(): Promise<boolean>;
        }> | null>;
    }>;
    presence: Readonly<{
        touch(scopeNameData: string, memberIdentifierData: string, timeToLiveData: number): Promise<void>;
        remove(scopeNameData: string, memberIdentifierData: string): Promise<boolean>;
        list(scopeNameData: string, limitData?: number): Promise<readonly any[]>;
    }>;
}>;
```

### layerRedisEventBusCreate

```typescript
export declare function layerRedisEventBusCreate(busOptions: {
    url?: string;
    clientOptions?: Record<string, unknown>;
    namespace?: string;
    connectionTimeoutMs?: number;
    reconnectAttempts?: number;
    backgroundConnect?: boolean;
    clientCreate?: (clientOptions: Record<string, unknown>) => LayerRedisClient;
    diagnostics?: {
        record: (diagnosticData: Record<string, unknown>) => void;
    };
}): Readonly<{
    start(callbackData: NonNullable<((routingData: {
        eventId: string;
        tenantKey: string;
        channel: string;
    }) => void | Promise<void>) | null>): Promise<void>;
    publish(routingData: {
        eventId: string;
        tenantKey: string;
        channel: string;
    }): Promise<void>;
    stop(): Promise<void>;
    isReady(): boolean;
}>;
```

### layerRedisQueryCacheCreate

```typescript
export declare function layerRedisQueryCacheCreate(cacheOptionsData: {
    redis: {
        get: Function;
        set: Function;
        sAdd: Function;
        pExpire: Function;
        eval: Function;
    };
    namespace: string;
    protocolVersion?: number;
    schemaVersion?: string;
    maximumEntryBytes?: number;
    leaseMs?: number;
    tokenCreate?: () => string;
    isReady?: () => boolean;
}): Readonly<{
    generationRead(): Promise<string>;

    read(cacheRequestData: any): Promise<Readonly<{
        hit: false;
        value: null;
    }> | Readonly<{
        hit: true;
        value: any;
    }>>;

    write(cacheRequestData: any, resultData: unknown, generationData?: string): Promise<boolean>;

    invalidate(invalidationData: any): Promise<number>;
    invalidationCursorRead(): Promise<number>;

    invalidationCursorWrite(cursorData: number): Promise<void>;

    execute(cacheRequestData: any, loadData: () => Promise<unknown>): Promise<any>;
}>;
```

### LayerStreamEvent

```typescript
export type LayerStreamEvent = {
    eventId: string;
    channel: string;
    sequence: number;
    entityRevision: number;
    type: string;
    payload: Record<string, unknown>;
    occurredAt: string;
};
```

Далее: [карта возможностей](capabilities.md), [каталог API](api-catalog.md).
