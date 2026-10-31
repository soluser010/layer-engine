---
title: Signature reference — @solcorp/layer-runtime
description: Parameters, return values and related types.
audience: advanced
order: 310
status: documented
updated: 2026-10-31
---

# Signature reference — @solcorp/layer-runtime

Start with the [guide and examples](context-api.md). Below are the exact public call shapes and nested options for this version. This is notation reference, **not code to paste into an application**: applications remain JavaScript ESM. `?` means optional, `|` alternatives, `Promise<T>` an asynchronous result; readonly prohibits mutation through that contract. Optional does not define a default: behavior and defaults belong to the topic guide.

A signature describes data shape, not browser availability or a connected provider. Do not import server APIs into browser code. Advanced factories are for custom hosts; ordinary components use context. Route/cache/offline limitations: [page options](page-configuration.md).

## Imports

| Import | Export |
| --- | --- |
| `@solcorp/layer-runtime` | `LayerViewportState` |
| `@solcorp/layer-runtime` | `LayerKeyboardState` |
| `@solcorp/layer-runtime` | `LayerKeyboardResult` |
| `@solcorp/layer-runtime` | `layerApiClientCreate` |
| `@solcorp/layer-runtime` | `layerApplicationApiCreate` |
| `@solcorp/layer-runtime` | `layerCommandRuntimeCreate` |
| `@solcorp/layer-runtime` | `layerDevtoolsCreate` |
| `@solcorp/layer-runtime` | `layerDevtoolsPanelCreate` |
| `@solcorp/layer-runtime` | `layerEventRuntimeCreate` |
| `@solcorp/layer-runtime` | `layerEventSubscriptionsCreate` |
| `@solcorp/layer-runtime` | `layerEventStreamParserCreate` |
| `@solcorp/layer-runtime` | `layerMultiTabEventsCreate` |
| `@solcorp/layer-runtime` | `layerPostEventStreamCreate` |
| `@solcorp/layer-runtime` | `LayerRuntimeError` |
| `@solcorp/layer-runtime` | `layerViewportCreate` |
| `@solcorp/layer-runtime` | `layerLinksCreate` |

## Parameters and results

Named types are expanded below; DOM and external-library types retain their standard names. A helper from another Layer package is included only when required by a public signature.

[layerApiClientCreate](#layerapiclientcreate) · [layerApplicationApiCreate](#layerapplicationapicreate) · [LayerApplicationCommandExecutionOptions](#layerapplicationcommandexecutionoptions) · [LayerApplicationCommandOptions](#layerapplicationcommandoptions) · [LayerApplicationQueryCache](#layerapplicationquerycache) · [LayerApplicationQueryOptions](#layerapplicationqueryoptions) · [LayerBroadcastChannel](#layerbroadcastchannel) · [LayerCommandHandle](#layercommandhandle) · [layerCommandRuntimeCreate](#layercommandruntimecreate) · [LayerCommandSnapshot](#layercommandsnapshot) · [layerDevtoolsCreate](#layerdevtoolscreate) · [LayerDevtoolsOptions](#layerdevtoolsoptions) · [layerDevtoolsPanelCreate](#layerdevtoolspanelcreate) · [layerEventRuntimeCreate](#layereventruntimecreate) · [layerEventStreamParserCreate](#layereventstreamparsercreate) · [layerEventSubscriptionsCreate](#layereventsubscriptionscreate) · [LayerKeyboardResult](#layerkeyboardresult) · [LayerKeyboardState](#layerkeyboardstate) · [LayerLinkMode](#layerlinkmode) · [layerLinksCreate](#layerlinkscreate) · [LayerLinksOptions](#layerlinksoptions) · [LayerLockManager](#layerlockmanager) · [layerMultiTabEventsCreate](#layermultitabeventscreate) · [layerPostEventStreamCreate](#layerposteventstreamcreate) · [LayerQuerySnapshot](#layerquerysnapshot) · [LayerRuntimeError](#layerruntimeerror) · [LayerScrollAnchor](#layerscrollanchor) · [layerViewportCreate](#layerviewportcreate) · [LayerViewportState](#layerviewportstate) · [ViewportRectangle](#viewportrectangle)

### layerApiClientCreate

```typescript
export declare function layerApiClientCreate(clientOptions: {
    apiUrl?: string;
    fetchImplementation?: typeof fetch;
    requestIdCreate: () => string;
    csrfTokenGet?: () => string | null | Promise<string | null>;
    maximumResponseBytes?: number;
    timeoutMs?: number;
}): Readonly<{
    request: (requestOptions: {
        type: 'query' | 'command' | 'sync';
        operation: string;
        payload: Record<string, unknown>;
        cursor?: string | Record<string, number> | null;
        signal?: AbortSignal;
        timeoutMs?: number;
    }) => Promise<Readonly<{
        requestId: string;
        data: any;
        meta: any;
    }>>;

    query(operationName: string, payloadData: Record<string, unknown>, queryOptions?: {
        signal?: AbortSignal;
        timeoutMs?: number;
    }): Promise<Readonly<{
        requestId: string;
        data: any;
        meta: any;
        status: "network";
        stale: false;
    }>>;

    command(operationName: string, payloadData: Record<string, unknown>, commandOptions: {
        commandId: string;
        baseRevision: number;
        signal?: AbortSignal;
        timeoutMs?: number;
    }): Promise<Readonly<{
        requestId: string;
        data: any;
        meta: any;
    }>>;

    sync(operationName: string, payloadData: Record<string, unknown>, syncOptions?: {
        cursor?: string | Record<string, number> | null;
        signal?: AbortSignal;
        timeoutMs?: number;
    }): Promise<Readonly<{
        requestId: string;
        data: any;
        meta: any;
    }>>;
}>;
```

### layerApplicationApiCreate

```typescript
export declare function layerApplicationApiCreate(runtimeOptions: {
    queryRequest: (operationName: string, payloadData: Record<string, unknown>, queryOptions?: {
        signal?: AbortSignal;
        timeoutMs?: number;
    }) => Promise<Readonly<Record<string, any>>>;
    commandRun: (operationName: string, payloadData: Record<string, unknown>, commandOptions: Record<string, unknown>) => Promise<Readonly<Record<string, any>>>;
    commandOnlineRun?: (operationName: string, payloadData: Record<string, unknown>, commandOptions: {
        baseRevision: number;
    }) => Promise<Readonly<Record<string, any>>>;
    syncRun: (operationName: string, payloadData: Record<string, unknown>, syncOptions?: Record<string, unknown>) => Promise<Readonly<Record<string, any>>>;
    queryCacheGet: (cacheKey: string, timeData?: number) => Promise<Readonly<Record<string, any>>>;
    queryCachePut: (cacheKey: string, cacheData: unknown, cacheOptions: {
        revision?: number | null;
        expiresAt: number;
    }) => Promise<void>;
    onlineGet?: () => boolean;
    timeGet?: () => number;
    failureHandle?: (failureData: Readonly<{
        stage: string;
        error: unknown;
    }>) => void;
}): Readonly<{
    query(queryOptions: LayerApplicationQueryOptions): Readonly<{
        operation: string;
        readonly cacheKey: string | null;
        snapshot(): Readonly<{
            data: unknown;
            pending: boolean;
            error: unknown;
            updatedAt: number | null;
            stale: boolean;
            status: 'loading' | 'success' | 'stale' | 'error';
            source: 'cache' | 'network' | 'local' | null;
        }>;
        subscribe(listenerHandle: (snapshotData: LayerQuerySnapshot) => void): () => boolean;
        refresh(): Promise<unknown>;
        cancel(): boolean;
        cacheUpdate: (updateHandle: (currentData: unknown) => unknown) => Promise<unknown>;
        cacheInsert(insertedValue: unknown): Promise<unknown>;
        cacheRemove(predicateHandle: (itemData: unknown) => boolean): Promise<unknown>;
        settled(): Promise<unknown>;
        dispose(): boolean;
    }>;
    command(commandOptions: LayerApplicationCommandOptions): Readonly<{
        operation: string;
        snapshot(): Readonly<{
            pending: boolean;
            error: unknown;
            lastResult: unknown;
            commandId: string | null;
            state: string;
        }>;
        subscribe(listenerHandle: (snapshotData: LayerCommandSnapshot) => void): () => boolean;
        execute(payloadData: Record<string, unknown>, executeOptions?: LayerApplicationCommandExecutionOptions): Promise<unknown>;
        cancel(): Promise<boolean>;
        settled(): Promise<unknown>;
        dispose(): boolean;
    }>;
    commandOnline(operationName: string, payloadData: Record<string, unknown>, commandOptions?: {
        baseRevision?: number;
    }): Promise<any>;
    sync(operationName: string, payloadData: Record<string, unknown>, syncOptions?: Record<string, unknown>): Promise<Readonly<Record<string, any>>>;
    queryCache: Readonly<{
        update(selectorData: string, updateHandle: (currentData: unknown) => unknown): Promise<number>;
        insert(selectorData: string, insertedValue: unknown): Promise<number>;
        remove(selectorData: string, predicateHandle: (itemData: unknown) => boolean): Promise<number>;
        removeByCommandId(commandIdentifier: string): Promise<number>;
    }>;
    dispose(): void;
}>;
```

### LayerApplicationCommandExecutionOptions

```typescript
export type LayerApplicationCommandExecutionOptions = Readonly<{
    baseRevision?: number;
    conflictDomain?: string;
    optimisticPatch?: Record<string, unknown> | null;
}>;
```

### LayerApplicationCommandOptions

```typescript
export type LayerApplicationCommandOptions = Readonly<{
    operation: string;
    offline?: Readonly<{
        strategy?: 'outbox' | 'reject';
    }>;
    conflictDomain?: string;
    optimistic?: Readonly<{
        apply?: (commandPayload: Readonly<Record<string, unknown>>, queryCache: LayerApplicationQueryCache) => unknown | Promise<unknown>;
        rollback?: (commandError: unknown, queryCache: LayerApplicationQueryCache, optimisticToken: unknown) => void | Promise<void>;
    }>;
}>;
```

### LayerApplicationQueryCache

```typescript
export type LayerApplicationQueryCache = Readonly<{
    update: (selectorData: string, updateHandle: (currentData: unknown) => unknown) => Promise<number>;
    insert: (selectorData: string, insertedValue: unknown) => Promise<number>;
    remove: (selectorData: string, predicateHandle: (itemData: unknown) => boolean) => Promise<number>;
    removeByCommandId: (commandIdentifier: string) => Promise<number>;
}>;
```

### LayerApplicationQueryOptions

```typescript
export type LayerApplicationQueryOptions = Readonly<{
    operation: string;
    payload: Record<string, unknown> | (() => Record<string, unknown>);
    cache?: Readonly<{
        policy?: 'cache-and-network' | 'cache-first' | 'network-only' | 'no-store';
        maxAgeMs?: number;
        key?: string;
    }>;
    offline?: Readonly<{
        fallback?: 'cache' | 'reject';
    }>;
    timeoutMs?: number;
}>;
```

### LayerBroadcastChannel

```typescript
export type LayerBroadcastChannel = {
    postMessage: (messageData: unknown) => void;
    addEventListener: (eventName: 'message', handler: (eventData: MessageEvent) => void) => void;
    removeEventListener: (eventName: 'message', handler: (eventData: MessageEvent) => void) => void;
    close: () => void;
};
```

### LayerCommandHandle

```typescript
export type LayerCommandHandle = Readonly<{
    commandId: string;
    state: string;
    result: Promise<unknown>;
    conflict: Readonly<Record<string, unknown>> | null;
    snapshot: () => Readonly<Record<string, unknown>>;
    retry: () => Promise<void>;
    cancel: () => Promise<void>;
    resolveConflict: (resolutionData: Record<string, unknown>) => Promise<LayerCommandHandle>;
    dispose: () => boolean;
}>;
```

### layerCommandRuntimeCreate

```typescript
export declare function layerCommandRuntimeCreate(runtimeOptions: {
    outbox: {
        queue: (queueData: Record<string, unknown>) => Promise<Readonly<Record<string, unknown>>>;
        get: (commandId: string) => Promise<Readonly<Record<string, unknown>> | null>;
        watch: (commandId: string, listener: (record: Readonly<Record<string, unknown>> | null) => void, options?: {
            immediate?: boolean;
        }) => () => void;
        drain: () => Promise<Readonly<{
            claimed: number;
            confirmed: number;
            retryable: number;
            conflicted: number;
            failed: number;
        }>>;
        retry: (commandId: string) => Promise<void>;
        cancel: (commandId: string) => Promise<void>;
        resolveConflict: (commandId: string, resolutionData: Record<string, unknown>) => Promise<string>;
    };
    onlineGet?: () => boolean;
    optimisticApply?: (commandRecord: Readonly<Record<string, unknown>>) => void | Promise<void>;
    backgroundSyncRegister?: () => void | Promise<void>;
    failureHandle?: (failureData: Readonly<{
        stage: string;
        error: unknown;
    }>) => void;
}): Readonly<{

    command(operationName: string, payloadData: Record<string, unknown>, commandOptions: {
        offline?: 'queue' | 'reject';
        baseRevision: number;
        conflictDomain?: string;
        optimisticPatch?: Record<string, unknown> | null;
    }): Promise<Readonly<{
        commandId: string;
        state: string;
        result: Promise<unknown>;
        conflict: Readonly<Record<string, unknown>> | null;
        snapshot: () => Readonly<Record<string, unknown>>;
        retry: () => Promise<void>;
        cancel: () => Promise<void>;
        resolveConflict: (resolutionData: Record<string, unknown>) => Promise<LayerCommandHandle>;
        dispose: () => boolean;
    }>>;
    drain: () => Promise<Readonly<Record<string, number>>>;
}>;
```

### LayerCommandSnapshot

```typescript
export type LayerCommandSnapshot = Readonly<{
    pending: boolean;
    error: unknown;
    lastResult: unknown;
    commandId: string | null;
    state: string;
}>;
```

### layerDevtoolsCreate

```typescript
export declare function layerDevtoolsCreate(devtoolsOptions?: LayerDevtoolsOptions): Readonly<{

    register(providerName: string, providerLoad: () => unknown | Promise<unknown>): () => boolean;
    list(): readonly any[];

    snapshot(snapshotOptions?: {
        include?: readonly string[];
        export?: boolean;
        consent?: boolean;
    }): Promise<Readonly<{
        generatedAt: string;
        export: boolean;
        sections: Readonly<Record<string, unknown>>;
    }>>;
}>;
```

### LayerDevtoolsOptions

```typescript
export type LayerDevtoolsOptions = {
    enabled?: boolean;
    sensitiveFields?: readonly string[];
    maximumDepth?: number;
    maximumEntries?: number;
    maximumStringLength?: number;
    timeCreate?: () => string;
};
```

### layerDevtoolsPanelCreate

```typescript
export declare function layerDevtoolsPanelCreate(panelOptions: {
    devtools: {
        list: () => readonly string[];
        snapshot: (snapshotOptions?: {
            include?: readonly string[];
            export?: boolean;
            consent?: boolean;
        }) => Promise<unknown>;
    };
    document?: Document;
    exportConfirm?: () => boolean | Promise<boolean>;
    exportWrite?: (exportData: string) => void | Promise<void>;
}): Readonly<{
    element: HTMLElement;
    mount(mountTarget: Element): HTMLElement;
    refresh: () => Promise<unknown>;
    export: () => Promise<string | null>;
    destroy(): boolean;
}>;
```

### layerEventRuntimeCreate

```typescript
export declare function layerEventRuntimeCreate(runtimeOptions: {
    channels: readonly string[];
    stream: {
        open: Function;
    };
    cursorRead: () => Promise<Record<string, number>> | Record<string, number>;
    cursorWrite: (channelName: string, sequence: number) => Promise<void> | void;
    eventApply: (eventData: Record<string, unknown>) => Promise<void> | void;
    syncHandle: (gapData: {
        channel: string;
        cursor: number;
        receivedSequence: number;
        signal?: AbortSignal;
    }) => Promise<void | {
        cursor: number;
    }> | void | {
        cursor: number;
    };
    controlHandle?: (controlData: Record<string, unknown>) => Promise<void> | void;
    failureHandle?: (failureData: {
        error: unknown;
        attempt: number;
        retryDelayMs: number;
    }) => Promise<boolean> | boolean;
    random?: () => number;
}): Readonly<{

    run(runOptions: {
        signal: AbortSignal;
        initialCursor?: Readonly<Record<string, number>>;
        requestCursor?: Readonly<Record<string, number>>;
        eventObserve?: (eventData: Record<string, unknown>) => Promise<void> | void;
        snapshotObserve?: (channels: readonly string[], cursor?: Readonly<Record<string, number>>) => Promise<void> | void;
    }): Promise<void>;
}>;
```

### layerEventStreamParserCreate

```typescript
export declare function layerEventStreamParserCreate(parserOptions: {
    eventHandle: (eventData: Readonly<{
        id: string;
        event: string;
        data: string;
    }>) => void | Promise<void>;
    commentHandle?: (commentData: string) => void | Promise<void>;
    maximumBufferBytes?: number;
}): Readonly<{

    feed(chunkData: string): Promise<void>;
    finish(): Promise<void>;
}>;
```

### layerEventSubscriptionsCreate

```typescript
export declare function layerEventSubscriptionsCreate(subscriptionOptions: {
    runtimeCreate: (runtimeData: Readonly<{
        channels: readonly string[];
        eventReceive: (eventData: Record<string, unknown>) => Promise<void>;
    }>) => {
        start: () => void | Promise<void>;
        stop: () => void | Promise<void>;
    } | Promise<{
        start: () => void | Promise<void>;
        stop: () => void | Promise<void>;
    }>;
    failureHandle?: (errorData: unknown) => void;
}): Readonly<{

    subscribe(channelName: string, listenerHandle: (eventData: Readonly<Record<string, unknown>>) => void | Promise<void>): () => boolean;
    list(): readonly any[];
    ready(): Promise<void>;
    stop(): Promise<boolean>;
}>;
```

### LayerKeyboardResult

```typescript
export type LayerKeyboardResult = import('./keyboard.js').LayerKeyboardResult;
```

### LayerKeyboardState

```typescript
export type LayerKeyboardState = import('./keyboard.js').LayerKeyboardState;
```

### LayerLinkMode

```typescript
export type LayerLinkMode = 'auto' | 'app' | 'viewer' | 'external';
```

### layerLinksCreate

```typescript
export declare const layerLinksCreate: (linkOptions: LayerLinksOptions) => Readonly<{

    open: ( urlData: string,  openOptions?: {
        mode?: LayerLinkMode;
    }) => Promise<Readonly<{
        status: "blocked" | "external-requested" | "navigated" | "viewer-opened";
        url: string;
        reason: string;
    }>>;
    closeViewer: () => boolean;

    openAnchor: ( anchorNode: HTMLAnchorElement,  openOptions?: {
        mode?: LayerLinkMode;
    }) => Promise<Readonly<{
        status: "blocked" | "external-requested" | "navigated" | "viewer-opened";
        url: string;
        reason: string;
    }>>;
    getCapability: () => Readonly<{
        viewer: boolean;
        launchQueue: boolean;
        associationVerification: "platform-controlled";
        embeddingVerification: "unavailable";
    }>;
    launch: (urlData: string) => Promise<Readonly<{
        status: "blocked" | "external-requested" | "navigated" | "viewer-opened";
        url: string;
        reason: string;
    }>>;

    ready: (manualConsumerStatus?: boolean) => Promise<void>;
    createOwner: () => Readonly<{
        open: ( urlData: string,  openOptions?: {
            mode?: LayerLinkMode;
        }) => Promise<Readonly<{
            status: "blocked" | "external-requested" | "navigated" | "viewer-opened";
            url: string;
            reason: string;
        }>>;
        closeViewer: () => boolean;
        getCapability: () => Readonly<{
            viewer: boolean;
            launchQueue: boolean;
            associationVerification: "platform-controlled";
            embeddingVerification: "unavailable";
        }>;
        dispose: () => boolean;
    }>;
    dispose: () => boolean;
}>;
```

### LayerLinksOptions

```typescript
export type LayerLinksOptions = {
    root: HTMLElement;
    window: Window;
    scope?: string;
    configuration: Readonly<{
        external: Readonly<{
            mode: 'viewer' | 'platform';
            allowedOrigins: readonly string[];
        }>;
        scopeExtensions: readonly string[];
    }>;
    resolve: (pathnameData: string) => unknown;
    navigate: (urlData: string) => Promise<any>;
};
```

### LayerLockManager

```typescript
export type LayerLockManager = {
    request: (lockName: string, lockOptions: {
        mode: 'exclusive';
        signal: AbortSignal;
    }, callback: (lockData: unknown) => Promise<void>) => Promise<void>;
};
```

### layerMultiTabEventsCreate

```typescript
export declare function layerMultiTabEventsCreate(coordinatorOptions: {
    originKey: string;
    channels: readonly string[];
    cursorRead: () => Promise<Record<string, number>> | Record<string, number>;
    eventReceive: (eventData: Record<string, unknown>) => Promise<void> | void;
    syncHandle?: (gapData: {
        channel: string;
        cursor: number;
        receivedSequence: number;
        signal?: AbortSignal;
    }) => Promise<void | {
        cursor: number;
    }> | void | {
        cursor: number;
    };
    streamRun: (runData: {
        signal: AbortSignal;
        initialCursor: Readonly<Record<string, number>>;
        requestCursor?: Readonly<Record<string, number>>;
        eventObserve: (eventData: Record<string, unknown>) => Promise<void>;
        snapshotObserve?: (channels: readonly string[], cursor?: Readonly<Record<string, number>>) => Promise<void>;
    }) => Promise<void>;
    lockManager?: LayerLockManager;
    broadcastChannelCreate?: (channelName: string) => LayerBroadcastChannel;
    failureHandle?: (errorData: unknown) => void;
    tabIdCreate: () => string;
    peerCollectionMs?: number;
}): Readonly<{
    start(): Promise<void>;
    stop(): Promise<void>;
    isStarted(): boolean;
}>;
```

### layerPostEventStreamCreate

```typescript
export declare function layerPostEventStreamCreate(streamOptions: {
    apiUrl: string;
    fetchImplementation?: typeof fetch;
    requestIdCreate: () => string;
    csrfTokenGet?: () => string | Promise<string>;
    inactivityTimeoutMs?: number;
}): Readonly<{

    open(openData: {
        channels: readonly string[];
        cursor: Readonly<Record<string, number>>;
        signal: AbortSignal;
        eventHandle: (eventData: Record<string, unknown>) => void | Promise<void>;
        controlHandle: (controlData: Record<string, unknown>) => void | Promise<void>;
        heartbeatHandle?: () => void | Promise<void>;
    }): Promise<void>;
}>;
```

### LayerQuerySnapshot

```typescript
export type LayerQuerySnapshot = Readonly<{
    data: unknown;
    pending: boolean;
    error: unknown;
    updatedAt: number | null;
    stale: boolean;
    status: 'loading' | 'success' | 'stale' | 'error';
    source: 'cache' | 'network' | 'local' | null;
}>;
```

### LayerRuntimeError

```typescript
export declare class LayerRuntimeError extends Error {
    code: string;
    requestId: string | null;
    status: number;
    retryAfterMs: number;
    retryable: boolean;
    details: Readonly<Record<string, unknown>> | null;

    constructor(code: string, message: string, errorOptions?: {
        requestId?: string | null;
        status?: number;
        retryAfterMs?: number;
        retryable?: boolean;
        details?: Readonly<Record<string, unknown>> | null;
        cause?: unknown;
    });
}
```

### LayerScrollAnchor

```typescript
export type LayerScrollAnchor = Readonly<{
    region: HTMLElement;
    anchor: Element | null;
    offset: number;
    left: number;
    top: number;
}>;
```

### layerViewportCreate

```typescript
export declare const layerViewportCreate: (viewportOptions: {
    root: HTMLElement;
    window?: Window;
}) => Readonly<{
    getState: () => Readonly<{
        layout: ViewportRectangle;
        visual: ViewportRectangle;
        keyboard: Readonly<{
            source: 'native' | 'estimated' | 'unknown';
            visible: boolean | null;
            height: number;
            rect: Readonly<{
                x: number;
                y: number;
                width: number;
                height: number;
            }> | null;
        }>;
        policy: 'resize' | 'preserve';
        availableHeight: number;
    }>;
    subscribe: ( stateListener: (state: LayerViewportState) => void) => () => void;
    registerRegion: ( name: string,  elementNode: HTMLElement,  kind?: 'viewport' | 'scroll') => () => void;
    ensureVisible: ( elementNode: HTMLElement) => boolean;
    focus: ( elementNode: HTMLElement) => boolean;
    captureAnchor: ( name: string,  anchorNode?: Element | null) => Readonly<{
        region: HTMLElement;
        anchor: Element | null;
        offset: number;
        left: number;
        top: number;
    }>;
    restoreAnchor: ( anchorData: import('./viewport-scroll.js').LayerScrollAnchor) => boolean;
    keyboard: Readonly<{
        show: (fieldNode: HTMLElement) => Readonly<{
            status: "blocked" | "requested";
            focused: boolean;
            reason: string | null;
        }>;
        hide: () => Readonly<{
            status: "blocked" | "requested";
            focused: boolean;
            reason: string | null;
        }>;
        getState: () => Readonly<{
            source: 'native' | 'estimated' | 'unknown';
            visible: boolean | null;
            height: number;
            rect: Readonly<{
                x: number;
                y: number;
                width: number;
                height: number;
            }> | null;
        }>;
        subscribe: (listener: (state: import("./keyboard.js").LayerKeyboardState) => void) => () => void;
        getCapability: () => Readonly<{
            strategy: "focus" | "native";
            nativeControl: boolean;
            requiresUserInteraction: true;
            visibilitySource: "estimated" | "native" | "unknown";
        }>;
    }>;
    createOwner: () => Readonly<{
        getState: () => Readonly<{
            layout: ViewportRectangle;
            visual: ViewportRectangle;
            keyboard: Readonly<{
                source: 'native' | 'estimated' | 'unknown';
                visible: boolean | null;
                height: number;
                rect: Readonly<{
                    x: number;
                    y: number;
                    width: number;
                    height: number;
                }> | null;
            }>;
            policy: 'resize' | 'preserve';
            availableHeight: number;
        }>;
        subscribe: ( stateListener: (state: LayerViewportState) => void) => () => void;
        registerRegion: ( name: string,  elementNode: HTMLElement,  kind?: 'viewport' | 'scroll') => () => void;
        ensureVisible: ( elementNode: HTMLElement) => boolean;
        focus: ( elementNode: HTMLElement) => boolean;
        captureAnchor: ( name: string,  anchorNode?: Element | null) => Readonly<{
            region: HTMLElement;
            anchor: Element | null;
            offset: number;
            left: number;
            top: number;
        }>;
        restoreAnchor: ( anchorData: import('./viewport-scroll.js').LayerScrollAnchor) => boolean;
        dispose: () => boolean;
        keyboard: Readonly<{
            show: (fieldNode: HTMLElement) => Readonly<{
                status: "blocked" | "requested";
                focused: boolean;
                reason: string | null;
            }>;
            hide: () => Readonly<{
                status: "blocked" | "requested";
                focused: boolean;
                reason: string | null;
            }>;
            getState: () => Readonly<{
                source: 'native' | 'estimated' | 'unknown';
                visible: boolean | null;
                height: number;
                rect: Readonly<{
                    x: number;
                    y: number;
                    width: number;
                    height: number;
                }> | null;
            }>;
            subscribe: (listener: (state: import("./keyboard.js").LayerKeyboardState) => void) => () => void;
            getCapability: () => Readonly<{
                strategy: "focus" | "native";
                nativeControl: boolean;
                requiresUserInteraction: true;
                visibilitySource: "estimated" | "native" | "unknown";
            }>;
        }>;
    }>;
    refresh: () => void;
    resetScroll: () => void;
    dispose: () => boolean;
}>;
```

### LayerViewportState

```typescript
export type LayerViewportState = import('./viewport.js').LayerViewportState;
```

### ViewportRectangle

```typescript
export type ViewportRectangle = Readonly<{
    width: number;
    height: number;
    offsetTop: number;
    offsetLeft: number;
    scale: number;
}>;
```

Next: [capability map](capabilities.md), [API catalog](api-catalog.md).
