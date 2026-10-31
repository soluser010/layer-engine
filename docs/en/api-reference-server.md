---
title: Signature reference — @solcorp/layer-server
description: Parameters, return values and related types.
audience: advanced
order: 310
status: documented
updated: 2026-10-31
---

# Signature reference — @solcorp/layer-server

Start with the [guide and examples](server-runtime.md). Below are the exact public call shapes and nested options for this version. This is notation reference, **not code to paste into an application**: applications remain JavaScript ESM. `?` means optional, `|` alternatives, `Promise<T>` an asynchronous result; readonly prohibits mutation through that contract. Optional does not define a default: behavior and defaults belong to the topic guide.

A signature describes data shape, not browser availability or a connected provider. Do not import server APIs into browser code. Advanced factories are for custom hosts; ordinary components use context. Route/cache/offline limitations: [page options](page-configuration.md).

## Imports

| Import | Export |
| --- | --- |
| `@solcorp/layer-server` | `layerOperationRegistryCreate` |
| `@solcorp/layer-server` | `layerClientAddressResolve` |
| `@solcorp/layer-server` | `layerTrustedProxyCreate` |
| `@solcorp/layer-server` | `layerDiagnosticsCreate` |
| `@solcorp/layer-server` | `layerHttpRuntimeCreate` |
| `@solcorp/layer-server` | `layerOperationExecutorCreate` |
| `@solcorp/layer-server` | `layerRequestBodyRead` |

## Parameters and results

Named types are expanded below; DOM and external-library types retain their standard names. A helper from another Layer package is included only when required by a public signature.

[layerClientAddressResolve](#layerclientaddressresolve) · [LayerCompiledValidator](#layercompiledvalidator) · [layerDiagnosticsCreate](#layerdiagnosticscreate) · [LayerExecutorDatabase](#layerexecutordatabase) · [LayerExecutorTransactionClient](#layerexecutortransactionclient) · [layerHttpRuntimeCreate](#layerhttpruntimecreate) · [LayerNormalizedOperation](#layernormalizedoperation) · [LayerOperationAuth](#layeroperationauth) · [LayerOperationDefinition](#layeroperationdefinition) · [layerOperationExecutorCreate](#layeroperationexecutorcreate) · [layerOperationRegistryCreate](#layeroperationregistrycreate) · [LayerOperationType](#layeroperationtype) · [LayerRegisteredOperation](#layerregisteredoperation) · [layerRequestBodyRead](#layerrequestbodyread) · [LayerRuntimeDatabase](#layerruntimedatabase) · [LayerRuntimeTransactionClient](#layerruntimetransactionclient) · [layerTrustedProxyCreate](#layertrustedproxycreate)

### layerClientAddressResolve

```typescript
export declare function layerClientAddressResolve(requestData: import('node:http').IncomingMessage, trustedProxyData: ReturnType<typeof layerTrustedProxyCreate>): string;
```

### LayerCompiledValidator

```typescript
export type LayerCompiledValidator = ((inputData: unknown) => boolean) & {
    errors?: readonly {
        instancePath: string;
        keyword: string;
    }[] | null;
};
```

### layerDiagnosticsCreate

```typescript
export declare function layerDiagnosticsCreate(diagnosticsOptions?: {
    sink?: (diagnosticData: Readonly<Record<string, string | number | boolean | null>>) => void;
    clock?: () => Date;
}): Readonly<{

    record(diagnosticData: Record<string, unknown>): void;
}>;
```

### LayerExecutorDatabase

```typescript
export type LayerExecutorDatabase = {
    kind?: 'embedded' | 'postgres';
    systemSchema?: string;
    query?: (queryData: {
        text: string;
        values: readonly unknown[];
    }) => Promise<{
        rows: Record<string, unknown>[];
        rowCount: number | null;
    }>;
    transaction: <ResultData>(handler: (transactionClient: LayerExecutorTransactionClient) => Promise<ResultData>) => Promise<ResultData>;
};
```

### LayerExecutorTransactionClient

```typescript
export type LayerExecutorTransactionClient = {
    query: (queryData: {
        text: string;
        values: readonly unknown[];
    }) => Promise<{
        rows: Record<string, unknown>[];
        rowCount: number | null;
    }>;
};
```

### layerHttpRuntimeCreate

```typescript
export declare function layerHttpRuntimeCreate(runtimeOptions: {
    operationRegistry: ReturnType<typeof import('../operation-registry.js').layerOperationRegistryCreate>;
    operationExecutor: {
        execute: Function;
    };
    diagnostics: {
        record: (diagnosticData: Record<string, unknown>) => void;
    };
    database?: LayerRuntimeDatabase | null;
    eventStream?: {
        open: Function;
        drain: Function;
    } | null;
    eventDistribution?: {
        start: Function;
        stop: Function;
        isReady: Function;
    } | null;
    readinessCheck?: () => boolean | Promise<boolean>;
    maximumBodyBytes?: number;
    maximumBodyDepth?: number;
    requestTimeoutMs?: number;
    secureCookies?: boolean;
    requestHandlers?: readonly ((request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => boolean | Promise<boolean>)[];
    trustedProxy?: null | {
        addresses: readonly string[];
        header?: 'forwarded' | 'x-forwarded-for';
        maximumHops?: number;
    };
}): Readonly<{

    start(listenOptions?: {
        host?: string;
        port?: number;
    }): Promise<void>;

    stop(shutdownOptions?: {
        deadlineMs?: number;
    }): Promise<void>;
    isReady(): boolean;
    address(): string | import("net").AddressInfo | null;
}>;
```

### LayerNormalizedOperation

```typescript
export type LayerNormalizedOperation = LayerOperationDefinition & {
    system: boolean;
    auth: LayerOperationAuth;
    authorize: ((inputData: unknown, contextData: unknown) => boolean | Promise<boolean>) | null;
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
    cache: {
        ttlMs: number;
        scope: 'global' | 'tenant' | 'user';
        tags: readonly string[];
    } | null;
    cacheInvalidation: {
        scope: 'global' | 'tenant' | 'user';
        tags: readonly string[];
    } | null;
};
```

### LayerOperationAuth

```typescript
export type LayerOperationAuth = 'session' | 'authenticated' | 'bearer' | 'api-key' | 'none';
```

### LayerOperationDefinition

```typescript
export type LayerOperationDefinition = {
    name: string;
    type: LayerOperationType;
    inputSchema: object | boolean;
    outputSchema: object | boolean;
    handler: (inputData: unknown, contextData: unknown) => unknown | Promise<unknown>;
    authorize?: ((inputData: unknown, contextData: unknown) => boolean | Promise<boolean>) | null;
    auth?: LayerOperationAuth;
    permissions?: readonly string[];
    rateLimitBucket?: string;
    cost?: number;
    timeoutMs?: number;
    concurrency?: number;
    transaction?: boolean;
    offlineReplay?: boolean;
    audit?: {
        enabled?: boolean;
        category?: string;
    };
    cache?: {
        ttlMs: number;
        scope: 'global' | 'tenant' | 'user';
        tags?: readonly string[];
    } | null;
    cacheInvalidation?: {
        scope: 'global' | 'tenant' | 'user';
        tags: readonly string[];
    } | null;
};
```

### layerOperationExecutorCreate

```typescript
export declare function layerOperationExecutorCreate(executorOptions: {
    operationRegistry: ReturnType<typeof import('../operation-registry.js').layerOperationRegistryCreate>;
    security: {
        contextResolve: Function;
    };
    rateLimiter: {
        consume: Function;
    };
    diagnostics: {
        record: (diagnosticData: Record<string, unknown>) => void;
    };
    database?: LayerExecutorDatabase | null;
    databaseSchema?: unknown;
    notifications?: {
        bind: (transactionData: LayerExecutorTransactionClient | null, identityData: any) => unknown;
        afterCommit: () => Promise<void>;
    } | null;
    queryCache?: {
        execute: (cacheRequestData: Record<string, unknown>, loadData: () => Promise<unknown>) => Promise<unknown>;
        invalidate?: (invalidationData: Record<string, unknown>) => Promise<unknown>;
    } | null;
    eventRepository?: {
        append: (transactionClientData: LayerExecutorTransactionClient, eventData: Record<string, unknown>) => Promise<unknown>;
    } | null;
    auditTrail?: {
        record: (auditData: Record<string, unknown>) => Promise<unknown> | unknown;
    } | null;
    auditRequired?: boolean;
    contextExtend?: (requestContextData: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;
    clock?: () => number;
}): Readonly<{

    execute(executionData: {
        request: {
            protocol?: number;
            requestId: string;
            type: string;
            operation: string;
            payload: unknown;
            cursor?: string | null;
        };
        headers: Record<string, string | string[] | undefined>;
        remoteAddress: string;
        responseEffects?: unknown;
    }): Promise<any>;
}>;
```

### layerOperationRegistryCreate

```typescript
export declare function layerOperationRegistryCreate(): Readonly<{

    define(definitionData: LayerOperationDefinition): Readonly<{
        name: string;
        type: LayerOperationType;
        auth: "api-key" | "authenticated" | "bearer" | "none" | "session";
        permissions: readonly string[];
        rateLimitBucket: string;
        cost: number;
        timeoutMs: number;
        concurrency: number;
        transaction: boolean;
        offlineReplay: boolean;
        audit: {
            enabled?: boolean;
            category?: string;
        } & {
            enabled: boolean;
            category: string;
        };
        cache: ({
            ttlMs: number;
            scope: 'global' | 'tenant' | 'user';
            tags?: readonly string[];
        } & {
            ttlMs: number;
            scope: 'global' | 'tenant' | 'user';
            tags: readonly string[];
        }) | null;
        cacheInvalidation: ({
            scope: 'global' | 'tenant' | 'user';
            tags: readonly string[];
        } & {
            scope: 'global' | 'tenant' | 'user';
            tags: readonly string[];
        }) | null;
    }>;

    get(operationName: string): LayerRegisteredOperation | undefined;

    has(operationName: string): boolean;
    list(): readonly Readonly<{
        name: string;
        type: LayerOperationType;
        auth: "api-key" | "authenticated" | "bearer" | "none" | "session";
        permissions: readonly string[];
        rateLimitBucket: string;
        cost: number;
        timeoutMs: number;
        concurrency: number;
        transaction: boolean;
        offlineReplay: boolean;
        audit: {
            enabled?: boolean;
            category?: string;
        } & {
            enabled: boolean;
            category: string;
        };
        cache: ({
            ttlMs: number;
            scope: 'global' | 'tenant' | 'user';
            tags?: readonly string[];
        } & {
            ttlMs: number;
            scope: 'global' | 'tenant' | 'user';
            tags: readonly string[];
        }) | null;
        cacheInvalidation: ({
            scope: 'global' | 'tenant' | 'user';
            tags: readonly string[];
        } & {
            scope: 'global' | 'tenant' | 'user';
            tags: readonly string[];
        }) | null;
    }>[];
    seal(): void;
    isSealed(): boolean;
}>;
```

### LayerOperationType

```typescript
export type LayerOperationType = 'query' | 'command' | 'sync' | 'events.open';
```

### LayerRegisteredOperation

```typescript
export type LayerRegisteredOperation = LayerNormalizedOperation & {
    inputValidate: LayerCompiledValidator;
    outputValidate: LayerCompiledValidator;
};
```

### layerRequestBodyRead

```typescript
export declare function layerRequestBodyRead(request: import('node:http').IncomingMessage, bodyOptions: {
    maximumBytes: number;
    maximumDepth: number;
}): Promise<any>;
```

### LayerRuntimeDatabase

```typescript
export type LayerRuntimeDatabase = {
    connect: () => Promise<void>;
    close: () => Promise<void>;
    query: (queryData: {
        text: string;
        values: readonly unknown[];
    }) => Promise<{
        rows: Record<string, unknown>[];
        rowCount: number | null;
    }>;
    transaction: <ResultData>(handler: (transactionClient: LayerRuntimeTransactionClient) => Promise<ResultData>) => Promise<ResultData>;
};
```

### LayerRuntimeTransactionClient

```typescript
export type LayerRuntimeTransactionClient = {
    query: (queryData: {
        text: string;
        values: readonly unknown[];
    }) => Promise<{
        rows: Record<string, unknown>[];
        rowCount: number | null;
    }>;
};
```

### layerTrustedProxyCreate

```typescript
export declare function layerTrustedProxyCreate(trustedProxyInput: unknown): Readonly<{
    addresses: readonly string[];
    header: 'forwarded' | 'x-forwarded-for';
    maximumHops: number;
    addressCheck(addressData: string): boolean;
}> | null;
```

Next: [capability map](capabilities.md), [API catalog](api-catalog.md).
