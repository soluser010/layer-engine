---
title: Справочник сигнатур — @solcorp/layer-storage
description: Параметры, возвращаемые значения и связанные типы.
audience: advanced
order: 310
status: documented
updated: 2026-10-31
---

# Справочник сигнатур — @solcorp/layer-storage

Начните с [руководства и примеров](indexeddb.md). Ниже — точные формы публичных вызовов и вложенных options текущей версии. Это справочник обозначений, **не код для вставки в приложение**: приложение остаётся JavaScript ESM. `?` означает необязательность, `|` — варианты, `Promise<T>` — асинхронный результат; readonly запрещает изменение через этот контракт. Необязательность не задаёт default: поведение и значения по умолчанию описаны в тематической статье.

Подпись описывает форму данных, а не доступность браузерной функции и не гарантию подключения provider. Server API нельзя переносить в браузер. Advanced factories нужны для собственного host; обычный компонент использует context. Ограничения route/cache/offline: [настройки страницы](page-configuration.md).

## Импорты

| Import | Export |
| --- | --- |
| `@solcorp/layer-storage` | `LayerShareTargetFile` |
| `@solcorp/layer-storage` | `LayerShareTargetInbox` |
| `@solcorp/layer-storage` | `LayerShareTargetRecord` |
| `@solcorp/layer-storage` | `layerOfflineOutboxCreate` |
| `@solcorp/layer-storage` | `layerShareTargetInboxCreate` |
| `@solcorp/layer-storage` | `layerWorkerShareTargetCaptureCreate` |
| `@solcorp/layer-storage` | `layerStorageOpen` |
| `@solcorp/layer-storage` | `LayerStorageError` |
| `@solcorp/layer-storage` | `layerStorageSchemaDefine` |
| `@solcorp/layer-storage` | `layerWorkerOutboxConfigurationClear` |
| `@solcorp/layer-storage` | `layerWorkerOutboxConfigure` |
| `@solcorp/layer-storage` | `layerWorkerOutboxDrainCreate` |

## Параметры и результаты

Именованные типы раскрываются ниже; типы DOM и внешних библиотек сохраняют свои стандартные имена. Одинаковый helper из другого Layer-пакета включён только если нужен для публичной подписи.

[layerOfflineOutboxCreate](#layerofflineoutboxcreate) · [LayerShareTargetFile](#layersharetargetfile) · [LayerShareTargetInbox](#layersharetargetinbox) · [layerShareTargetInboxCreate](#layersharetargetinboxcreate) · [LayerShareTargetRecord](#layersharetargetrecord) · [LayerStorage](#layerstorage) · [LayerStorageError](#layerstorageerror) · [layerStorageOpen](#layerstorageopen) · [LayerStorageSchema](#layerstorageschema) · [layerStorageSchemaDefine](#layerstorageschemadefine) · [LayerStorageTransactionFacade](#layerstoragetransactionfacade) · [layerWorkerOutboxConfigurationClear](#layerworkeroutboxconfigurationclear) · [layerWorkerOutboxConfigure](#layerworkeroutboxconfigure) · [layerWorkerOutboxDrainCreate](#layerworkeroutboxdraincreate) · [layerWorkerShareTargetCaptureCreate](#layerworkersharetargetcapturecreate)

### layerOfflineOutboxCreate

```typescript
export declare function layerOfflineOutboxCreate(outboxOptions: {
    storage: {
        watch: (storeNames: readonly string[], queryHandle: () => unknown | Promise<unknown>, listenerHandle: (resultData: any) => void | Promise<void>, watchOptions?: {
            immediate?: boolean;
        }) => () => void;
    };
    ownerId: string;
    commandIdCreate: () => string;
    commandSend: (commandData: Readonly<{
        commandId: string;
        operation: string;
        payload: Record<string, unknown>;
        baseRevision: number;
    }>) => Promise<unknown>;
    clock?: () => Date;
    concurrency?: number;
    leaseMs?: number;
}): Readonly<{
    queue: (queueOptions: {
        operation: string;
        payload: Record<string, unknown>;
        baseRevision: number;
        conflictDomain: string;
        optimisticPatch?: Record<string, unknown> | null;
    }) => Promise<Readonly<{
        commandId: string;
        operation: string;
        payload: Record<string, unknown>;
        baseRevision: number;
        conflictDomain: string;
        optimisticPatch: Record<string, unknown> | null;
        status: string;
        attempts: number;
        createdAt: string;
        updatedAt: string;
        leaseOwner: null;
        leaseUntil: null;
        result: null;
        failure: null;
        supersededBy: null;
    }>>;
    get: (commandIdentifier: string) => Promise<Readonly<Record<string, unknown>> | null>;

    watch(commandIdentifier: string, listenerHandle: (commandRecord: Readonly<Record<string, unknown>> | null) => void | Promise<void>, watchOptions?: {
        immediate?: boolean;
    }): () => void;

    list(listOptions?: {
        statuses?: readonly string[];
    }): Promise<readonly Readonly<Record<string, unknown>>[]>;
    drain(): Promise<Readonly<{
        claimed: number;
        confirmed: number;
        retryable: number;
        conflicted: number;
        failed: number;
    }>>;

    retry(commandIdentifier: string): Promise<void>;

    cancel(commandIdentifier: string): Promise<void>;

    resolveConflict(commandIdentifier: string, resolutionData: {
        operation: string;
        payload: Record<string, unknown>;
        baseRevision: number;
        conflictDomain: string;
        optimisticPatch?: Record<string, unknown> | null;
    }): Promise<string>;
}>;
```

### LayerShareTargetFile

```typescript
export type LayerShareTargetFile = import('./share-target-inbox.js').LayerShareTargetFile;
```

### LayerShareTargetInbox

```typescript
export type LayerShareTargetInbox = import('./share-target-inbox.js').LayerShareTargetInbox;
```

### layerShareTargetInboxCreate

```typescript
export declare function layerShareTargetInboxCreate(inboxOptions: {
    appId: string;
    indexedDb?: IDBFactory;
    clock?: () => number;
}): LayerShareTargetInbox;
```

### LayerShareTargetRecord

```typescript
export type LayerShareTargetRecord = import('./share-target-inbox.js').LayerShareTargetRecord;
```

### LayerStorage

```typescript
export type LayerStorage = {
    name: string;
    transaction: (storeNames: readonly string[], transactionMode: 'readonly' | 'readwrite', transactionHandle: (transactionData: LayerStorageTransactionFacade) => unknown | Promise<unknown>) => Promise<unknown>;
    get: (storeName: string, keyData: IDBValidKey) => Promise<unknown>;
    put: (storeName: string, valueData: unknown, keyData?: IDBValidKey) => Promise<unknown>;
    delete: (storeName: string, keyData: IDBValidKey) => Promise<unknown>;
    query: (storeName: string, queryData?: {
        index?: string;
        query?: IDBValidKey | IDBKeyRange | null;
        count?: number;
    }) => Promise<unknown>;
    watch: (storeNames: readonly string[], queryHandle: () => unknown | Promise<unknown>, listenerHandle: (resultData: unknown) => void | Promise<void>, watchOptions?: {
        immediate?: boolean;
    }) => () => void;
    eventCursors: Readonly<{
        read: (channelNames: readonly string[]) => Promise<Readonly<Record<string, number>>>;
        write: (channelName: string, sequenceData: number) => Promise<void>;
    }>;
    queryCache: Readonly<{
        get: (cacheKey: string, timeData?: number) => Promise<Readonly<Record<string, unknown>>>;
        put: (cacheKey: string, cacheData: unknown, cacheOptions: {
            revision?: number | null;
            expiresAt: number;
        }) => Promise<void>;
    }>;
    entities: Readonly<{
        get: (entityKey: string) => Promise<unknown>;
        put: (entityData: {
            key: string;
            entityType: string;
            revision: number;
            data: Record<string, unknown>;
        }) => Promise<void>;
    }>;
    drafts: Readonly<{
        get: (draftKey: string) => Promise<unknown>;
        put: (draftKey: string, draftData: unknown) => Promise<unknown>;
        delete: (draftKey: string) => Promise<unknown>;
    }>;
    estimate: () => Promise<Readonly<Record<string, unknown>>>;
    exportUserData: () => Promise<Readonly<Record<string, unknown>>>;
    close: () => void;
    purgeUserData: () => Promise<void>;
};
```

### LayerStorageError

```typescript
export declare class LayerStorageError extends Error {
    code: string;
    retryable: boolean;
    details: Readonly<Record<string, unknown>> | null;

    constructor(code: string, message: string, errorOptions?: {
        retryable?: boolean;
        details?: Readonly<Record<string, unknown>> | null;
        cause?: unknown;
    });
}
```

### layerStorageOpen

```typescript
export declare function layerStorageOpen(openOptions: {
    appId: string;
    namespace: string;
    schema: LayerStorageSchema;
    indexedDb?: IDBFactory;
    storageManager?: StorageManager;
    blockedTimeoutMs?: number;
    blockedHandle?: (blockedData: {
        databaseName: string;
        oldVersion: number;
        newVersion: number | null;
    }) => void;
    versionChangeHandle?: (versionData: {
        oldVersion: number;
        newVersion: number | null;
    }) => void;
    diagnostics?: {
        record: (diagnosticData: Record<string, unknown>) => void;
    };
}): Promise<LayerStorage>;
```

### LayerStorageSchema

```typescript
export type LayerStorageSchema = {
    name: string;
    version: number;
    stores: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    migrations: Readonly<Record<number, Function>>;
};
```

### layerStorageSchemaDefine

```typescript
export declare function layerStorageSchemaDefine(schemaData: unknown): Readonly<{
    name: string;
    version: number;
    stores: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    migrations: Readonly<Record<number, Function>>;
}>;
```

### LayerStorageTransactionFacade

```typescript
export type LayerStorageTransactionFacade = {
    get: (storeName: string, keyData: IDBValidKey) => Promise<unknown>;
    put: (storeName: string, valueData: unknown, keyData?: IDBValidKey) => Promise<unknown>;
    delete: (storeName: string, keyData: IDBValidKey) => Promise<unknown>;
    getAll: (storeName: string, queryData?: {
        index?: string;
        query?: IDBValidKey | IDBKeyRange | null;
        count?: number;
    }) => Promise<unknown>;
};
```

### layerWorkerOutboxConfigurationClear

```typescript
export declare function layerWorkerOutboxConfigurationClear(clearOptions: {
    appId: string;
    indexedDb?: IDBFactory;
}): Promise<void>;
```

### layerWorkerOutboxConfigure

```typescript
export declare function layerWorkerOutboxConfigure(configurationOptions: {
    appId: string;
    storageName: string;
    apiUrl: string;
    csrfToken: string | null;
    applicationOrigin: string;
    indexedDb?: IDBFactory;
}): Promise<void>;
```

### layerWorkerOutboxDrainCreate

```typescript
export declare function layerWorkerOutboxDrainCreate(drainOptions: {
    appId: string;
    applicationOrigin: string;
    fetchImplementation?: typeof fetch;
    indexedDb?: IDBFactory;
    requestIdCreate: () => string;
    ownerIdCreate: () => string;
    clock?: () => Date;
    concurrency?: number;
    timeoutMs?: number;
}): () => Promise<Readonly<{
    configured: false;
    claimed: 0;
    confirmed: 0;
    retryable: 0;
    conflicted: 0;
    failed: 0;
}> | Readonly<{
    configured: true;
    claimed: number;
    confirmed: number;
    retryable: number;
    conflicted: number;
    failed: number;
}>>;
```

### layerWorkerShareTargetCaptureCreate

```typescript
export declare function layerWorkerShareTargetCaptureCreate(captureOptions: {
    appId: string;
    applicationOrigin: string;
    shareTarget: unknown;
    shareIdCreate: () => string;
    indexedDb?: IDBFactory;
    clock?: () => number;
    maximumRequestBytes?: number;
    maximumFileBytes?: number;
    maximumFiles?: number;
    maximumTextBytes?: number;
    maximumRecords?: number;
    retentionMs?: number;
}): (requestData: Request) => Promise<string>;
```

Далее: [карта возможностей](capabilities.md), [каталог API](api-catalog.md).
