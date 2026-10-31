---
title: Справочник сигнатур — @solcorp/layer-pwa
description: Параметры, возвращаемые значения и связанные типы.
audience: advanced
order: 310
status: documented
updated: 2026-10-31
---

# Справочник сигнатур — @solcorp/layer-pwa

Начните с [руководства и примеров](pwa-capabilities.md). Ниже — точные формы публичных вызовов и вложенных options текущей версии. Это справочник обозначений, **не код для вставки в приложение**: приложение остаётся JavaScript ESM. `?` означает необязательность, `|` — варианты, `Promise<T>` — асинхронный результат; readonly запрещает изменение через этот контракт. Необязательность не задаёт default: поведение и значения по умолчанию описаны в тематической статье.

Подпись описывает форму данных, а не доступность браузерной функции и не гарантию подключения provider. Server API нельзя переносить в браузер. Advanced factories нужны для собственного host; обычный компонент использует context. Ограничения route/cache/offline: [настройки страницы](page-configuration.md).

## Импорты

| Import | Export |
| --- | --- |
| `@solcorp/layer-pwa` | `LayerLinksConfiguration` |
| `@solcorp/layer-pwa` | `LayerAndroidAssociation` |
| `@solcorp/layer-pwa` | `LayerAppleAssociation` |
| `@solcorp/layer-pwa` | `LayerWindowsAssociation` |
| `@solcorp/layer-pwa` | `LayerWebAssociation` |
| `@solcorp/layer-pwa` | `LayerApplicationUpdateState` |
| `@solcorp/layer-pwa` | `layerPwaCapabilitiesCreate` |
| `@solcorp/layer-pwa` | `layerLinksConfigurationCreate` |
| `@solcorp/layer-pwa` | `layerLinkAssociationDocumentsCreate` |
| `@solcorp/layer-pwa` | `layerLinkAssociationPathCheck` |
| `@solcorp/layer-pwa` | `LayerPwaError` |
| `@solcorp/layer-pwa` | `layerServiceWorkerRegister` |
| `@solcorp/layer-pwa` | `layerServiceWorkerRuntimeCreate` |
| `@solcorp/layer-pwa` | `layerUpdateCoordinatorCreate` |
| `@solcorp/layer-pwa` | `layerApplicationUpdatesCreate` |
| `@solcorp/layer-pwa` | `layerUpdateCardCreate` |
| `@solcorp/layer-pwa` | `LAYER_UPDATE_BUILD_PLACEHOLDER` |
| `@solcorp/layer-pwa` | `layerUpdateDescriptorValidate` |
| `@solcorp/layer-pwa` | `layerUpdatesConfigurationCreate` |
| `@solcorp/layer-pwa` | `layerUpdateMetadataPathCheck` |
| `@solcorp/layer-pwa` | `layerVersionCompare` |
| `@solcorp/layer-pwa` | `layerVersionManifestValidate` |
| `@solcorp/layer-pwa` | `layerWebAppManifestCreate` |
| `@solcorp/layer-pwa` | `layerWebAppManifestValidate` |

## Параметры и результаты

Именованные типы раскрываются ниже; типы DOM и внешних библиотек сохраняют свои стандартные имена. Одинаковый helper из другого Layer-пакета включён только если нужен для публичной подписи.

[LAYER_UPDATE_BUILD_PLACEHOLDER](#layer_update_build_placeholder) · [LayerAndroidAssociation](#layerandroidassociation) · [LayerAppleAssociation](#layerappleassociation) · [layerApplicationUpdatesCreate](#layerapplicationupdatescreate) · [LayerApplicationUpdatesOptions](#layerapplicationupdatesoptions) · [LayerApplicationUpdateState](#layerapplicationupdatestate) · [LayerLaunchData](#layerlaunchdata) · [layerLinkAssociationDocumentsCreate](#layerlinkassociationdocumentscreate) · [layerLinkAssociationPathCheck](#layerlinkassociationpathcheck) · [LayerLinksConfiguration](#layerlinksconfiguration) · [layerLinksConfigurationCreate](#layerlinksconfigurationcreate) · [LayerManifestClientMode](#layermanifestclientmode) · [LayerManifestFileHandlerOptions](#layermanifestfilehandleroptions) · [LayerManifestIconOptions](#layermanifesticonoptions) · [LayerManifestLaunchHandlerOptions](#layermanifestlaunchhandleroptions) · [LayerManifestProtocolHandlerOptions](#layermanifestprotocolhandleroptions) · [LayerManifestShareFileOptions](#layermanifestsharefileoptions) · [LayerManifestShareTargetOptions](#layermanifestsharetargetoptions) · [LayerManifestShortcutOptions](#layermanifestshortcutoptions) · [layerPwaCapabilitiesCreate](#layerpwacapabilitiescreate) · [LayerPwaError](#layerpwaerror) · [layerServiceWorkerRegister](#layerserviceworkerregister) · [layerServiceWorkerRuntimeCreate](#layerserviceworkerruntimecreate) · [layerUpdateCardCreate](#layerupdatecardcreate) · [layerUpdateCoordinatorCreate](#layerupdatecoordinatorcreate) · [layerUpdateDescriptorValidate](#layerupdatedescriptorvalidate) · [layerUpdateMetadataPathCheck](#layerupdatemetadatapathcheck) · [LayerUpdatePhase](#layerupdatephase) · [layerUpdatesConfigurationCreate](#layerupdatesconfigurationcreate) · [layerVersionCompare](#layerversioncompare) · [layerVersionManifestValidate](#layerversionmanifestvalidate) · [layerWebAppManifestCreate](#layerwebappmanifestcreate) · [LayerWebAppManifestOptions](#layerwebappmanifestoptions) · [layerWebAppManifestValidate](#layerwebappmanifestvalidate) · [LayerWebAssociation](#layerwebassociation) · [LayerWindowsAssociation](#layerwindowsassociation)

### LAYER_UPDATE_BUILD_PLACEHOLDER

```typescript
export declare const LAYER_UPDATE_BUILD_PLACEHOLDER = "__LAYER_UPDATE_BUILD_ID__";
```

### LayerAndroidAssociation

```typescript
export type LayerAndroidAssociation = import('./links-configuration.js').LayerAndroidAssociation;
```

### LayerAppleAssociation

```typescript
export type LayerAppleAssociation = import('./links-configuration.js').LayerAppleAssociation;
```

### layerApplicationUpdatesCreate

```typescript
export declare const layerApplicationUpdatesCreate: (options: LayerApplicationUpdatesOptions) => Readonly<{
    check: () => Promise<Readonly<{
        updateAvailable: boolean;
        criticalUpdate: boolean;
        currentVersion: string;
        availableVersion: string;
        waiting: boolean;
        currentBuildId: string;
        availableBuildId: string | null;
        phase: LayerUpdatePhase;
        progress: Readonly<{
            completedFiles: number;
            totalFiles: number;
        }> | null;
        visible: boolean;
        error: Readonly<{
            code: string;
            retryable: boolean;
        }> | null;
    }>>;
    activate: (activationOptions?: {
        force?: boolean;
    }) => Promise<void>;
    getState: () => Readonly<{
        updateAvailable: boolean;
        criticalUpdate: boolean;
        currentVersion: string;
        availableVersion: string;
        waiting: boolean;
        currentBuildId: string;
        availableBuildId: string | null;
        phase: LayerUpdatePhase;
        progress: Readonly<{
            completedFiles: number;
            totalFiles: number;
        }> | null;
        visible: boolean;
        error: Readonly<{
            code: string;
            retryable: boolean;
        }> | null;
    }>;
    subscribe: ( listener: (state: LayerApplicationUpdateState) => void) => () => void;
    dismiss: () => void;
    show: () => void;
    start: () => void;
    dispose: () => boolean;
}>;
```

### LayerApplicationUpdatesOptions

```typescript
export type LayerApplicationUpdatesOptions = {
    window: Window;
    registration: ServiceWorkerRegistration;
    currentVersion: string;
    currentBuildId: string;
    appKey: string;
    configuration?: unknown;
    beforeUpdate?: (data: {
        buildId: string;
        force: boolean;
    }) => unknown;
    localStateSave: () => Promise<void>;
    onError?: (error: unknown) => void;
    fetchImplementation?: typeof fetch;
    rpcTimeoutMs?: number;
};
```

### LayerApplicationUpdateState

```typescript
export type LayerApplicationUpdateState = import('./application-updates.js').LayerApplicationUpdateState;
```

### LayerLaunchData

```typescript
export type LayerLaunchData = Readonly<{
    targetUrl: string | null;
    files: readonly FileSystemHandle[];
}>;
```

### layerLinkAssociationDocumentsCreate

```typescript
export declare const layerLinkAssociationDocumentsCreate: (configuration: import('./links-configuration.js').LayerLinksConfiguration) => Readonly<Record<string, string>>;
```

### layerLinkAssociationPathCheck

```typescript
export declare const layerLinkAssociationPathCheck: (pathnameData: string) => boolean;
```

### LayerLinksConfiguration

```typescript
export type LayerLinksConfiguration = import('./links-configuration.js').LayerLinksConfiguration;
```

### layerLinksConfigurationCreate

```typescript
export declare const layerLinksConfigurationCreate: (inputData: unknown, configurationOptions?: {
    development?: boolean;
}) => LayerLinksConfiguration;
```

### LayerManifestClientMode

```typescript
export type LayerManifestClientMode = 'auto' | 'focus-existing' | 'navigate-existing' | 'navigate-new';
```

### LayerManifestFileHandlerOptions

```typescript
export type LayerManifestFileHandlerOptions = Readonly<{
    action: string;
    accept: Readonly<Record<string, readonly string[]>>;
    name?: string;
    icons?: readonly LayerManifestIconOptions[];
    launchType?: 'single-client' | 'multiple-clients';
}>;
```

### LayerManifestIconOptions

```typescript
export type LayerManifestIconOptions = Readonly<{
    src: string;
    sizes?: string;
    type?: string;
    purpose?: string;
}>;
```

### LayerManifestLaunchHandlerOptions

```typescript
export type LayerManifestLaunchHandlerOptions = Readonly<{
    clientMode: LayerManifestClientMode | readonly LayerManifestClientMode[];
}>;
```

### LayerManifestProtocolHandlerOptions

```typescript
export type LayerManifestProtocolHandlerOptions = Readonly<{
    protocol: string;
    url: string;
}>;
```

### LayerManifestShareFileOptions

```typescript
export type LayerManifestShareFileOptions = Readonly<{
    name: string;
    accept: readonly string[];
}>;
```

### LayerManifestShareTargetOptions

```typescript
export type LayerManifestShareTargetOptions = Readonly<{
    action: string;
    method: 'GET' | 'POST' | 'get' | 'post';
    enctype: 'application/x-www-form-urlencoded' | 'multipart/form-data';
    params: Readonly<{
        title?: string;
        text?: string;
        url?: string;
        files?: readonly LayerManifestShareFileOptions[];
    }>;
}>;
```

### LayerManifestShortcutOptions

```typescript
export type LayerManifestShortcutOptions = Readonly<{
    name: string;
    url: string;
    shortName?: string;
    description?: string;
    icons?: readonly LayerManifestIconOptions[];
}>;
```

### layerPwaCapabilitiesCreate

```typescript
export declare function layerPwaCapabilitiesCreate(capabilityOptions?: {
    window?: Window;
    navigator?: Navigator;
    notificationApi?: typeof Notification;
    registrationGet?: () => Promise<ServiceWorkerRegistration>;
    pushRequest?: (requestData: {
        type: 'query' | 'command';
        operation: string;
        payload: Record<string, unknown>;
    }) => Promise<any>;
    shareTargetIdGet?: () => string | null;
    shareTargetConsume?: (shareIdentifier: string) => Promise<Readonly<Record<string, unknown>> | null>;
    shareTargetDiscard?: (shareIdentifier: string) => Promise<boolean>;
    shareTargetIdClear?: (shareIdentifier: string) => void;
    onError?: (errorData: unknown) => void;
}): Readonly<{
    install: Readonly<{
        getCapability(): Readonly<{
            supported: boolean;
            permission: string;
            availability: string;
            reason: string;
        }>;
        prompt(): Promise<Readonly<{
            outcome: any;
            platform: any;
        }>>;
    }>;
    notifications: Readonly<{
        getCapability(): Readonly<{
            supported: boolean;
            permission: string;
            availability: string;
            reason: string;
        }>;
        requestPermission(): Promise<NotificationPermission>;

        show(titleData: string, notificationOptions?: NotificationOptions): Promise<void>;

        list(tagData?: string): Promise<readonly Notification[]>;

        close(tagData: string): Promise<number>;
    }>;
    push: Readonly<{
        getCapability(): Promise<Readonly<{
            supported: boolean;
            permission: string;
            availability: string;
            reason: string;
        }>>;

        subscribe(applicationServerKey: BufferSource): Promise<PushSubscription>;
        getSubscription(): Promise<PushSubscription | null>;

        permissionState(applicationServerKey?: BufferSource): Promise<PermissionState>;

        enable(): Promise<any>;

        disable(): Promise<any>;
        unsubscribe(): Promise<boolean>;
    }>;
    backgroundSync: Readonly<{
        getCapability(): Promise<Readonly<{
            supported: boolean;
            permission: string;
            availability: string;
            reason: string;
        }>>;
        register(tagData?: string): Promise<void>;
    }>;
    badge: Readonly<{
        getCapability(): Readonly<{
            supported: boolean;
            permission: string;
            availability: string;
            reason: string;
        }>;
        set(countData?: number | undefined): Promise<void>;
        clear(): Promise<void>;
    }>;
    share: Readonly<{
        getCapability(): Readonly<{
            supported: boolean;
            permission: string;
            availability: string;
            reason: string;
        }>;
        canSend(shareData: ShareData): boolean;
        send(shareData: ShareData): Promise<void>;
    }>;
    shareTarget: Readonly<{
        getCapability(): Readonly<{
            supported: boolean;
            permission: string;
            availability: string;
            reason: string;
        }>;
        pendingIdGet(): string | null;

        consume(shareIdentifier?: string | null): Promise<Readonly<Record<string, unknown>> | null>;

        discard(shareIdentifier?: string | null): Promise<boolean>;
    }>;
    files: Readonly<{
        getCapability(): Readonly<{
            supported: boolean;
            permission: string;
            availability: string;
            reason: string;
        }>;

        setConsumer(fileConsumer: (files: readonly FileSystemHandle[], targetUrl: string | null) => unknown): void;
    }>;
    protocols: Readonly<{
        getCapability(): Readonly<{
            supported: boolean;
            permission: string;
            availability: string;
            reason: string;
        }>;

        register(schemeData: string, handlerUrl: string): void;

        unregister(schemeData: string, handlerUrl: string): void;
    }>;
    launch: Readonly<{
        getCapability(): Readonly<{
            supported: boolean;
            permission: string;
            availability: string;
            reason: string;
        }>;

        setConsumer(launchConsumer: (launchData: Readonly<{
            targetUrl: string | null;
            files: readonly FileSystemHandle[];
        }>) => unknown): void;
        setDefaultConsumer: (consumer: (data: import("./launch-broker.js").LayerLaunchData) => unknown) => void;
        hasConsumer: () => boolean;
        startupComplete: () => void;
        dispose: () => boolean;
    }>;
    storage: Readonly<{
        getCapability(): Readonly<{
            supported: boolean;
            permission: string;
            availability: string;
            reason: string;
        }>;
        persist(): Promise<boolean>;
        persisted(): Promise<boolean>;
        estimate(): Promise<Readonly<{
            usage: number | null;
            quota: number | null;
        }>>;
    }>;
    network: Readonly<{
        getCapability(): Readonly<{
            supported: boolean;
            permission: string;
            availability: string;
            reason: string;
        }>;
        isOnlineHint(): boolean;
    }>;
}>;
```

### LayerPwaError

```typescript
export declare class LayerPwaError extends Error {
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

### layerServiceWorkerRegister

```typescript
export declare function layerServiceWorkerRegister(registrationOptions?: {
    scriptUrl?: string;
    scope?: string;
    serviceWorkerContainer?: Pick<ServiceWorkerContainer, 'register'>;
    location?: Pick<Location, 'hostname'>;
    secureContext?: boolean;
}): Promise<ServiceWorkerRegistration>;
```

### layerServiceWorkerRuntimeCreate

```typescript
export declare function layerServiceWorkerRuntimeCreate(workerOptions: {
    manifest: unknown;
    cacheStorage: CacheStorage;
    fetchImplementation: typeof fetch;
    subtleCrypto: SubtleCrypto;
    base64Encode: (binaryData: string) => string;
    scope: {
        addEventListener?: (name: string, listener: (eventData: any) => void) => void;
        skipWaiting: () => Promise<void>;
        clients: {
            claim: () => Promise<void>;
            matchAll: (options?: Record<string, unknown>) => Promise<readonly any[]>;
            openWindow?: (url: string) => Promise<any>;
        };
        registration: {
            showNotification: (title: string, options?: NotificationOptions) => Promise<void>;
        };
    };
    outboxDrain?: () => Promise<unknown>;
    cachePrefix?: string;
    deployment?: {
        buildId: string;
        appKey: string;
        scope: string;
        development?: boolean;
    };
    syncTag?: string;
    applicationOrigin?: string;
    indexedDb?: IDBFactory;
    shareTarget?: Readonly<{
        action: string;
        method: string;
        enctype: string;
        params: Readonly<Record<string, unknown>>;
    }>;
    shareTargetCapture?: (requestData: Request) => Promise<string>;
}): Readonly<{
    manifest: Readonly<{
        appVersion: string;
        runtimeVersion: string;
        compilerVersion: string;
        protocolMin: number;
        protocolMax: number;
        schemaVersions: Readonly<Record<string, number>>;
        minVersion: string | null;
        rollbackVersion: string | null;
        offlineShellUrl: string;
        assets: readonly Readonly<{
            url: string;
            hash: string;
            required: boolean;
            policy: unknown;
        }>[];
    }>;
    cacheName: string;
    install(): Promise<void>;
    activate(): Promise<void>;

    fetch(requestData: Request, waitUntil?: (promiseData: Promise<unknown>) => void): Promise<Response>;

    message(messageData: unknown): Promise<boolean>;

    sync(tagData: string): Promise<boolean>;

    push(pushData: unknown): Promise<void>;

    notificationOpen(targetUrl: string): Promise<void>;
    attach(): void;
}>;
```

### layerUpdateCardCreate

```typescript
export declare const layerUpdateCardCreate: (options: any) => Readonly<{
    dispose: () => boolean;
}>;
```

### layerUpdateCoordinatorCreate

```typescript
export declare function layerUpdateCoordinatorCreate(coordinatorOptions: {
    currentVersion: string;
    protocolVersion: number;
    manifestLoad: () => Promise<unknown>;
    registrationGet: () => Promise<ServiceWorkerRegistration>;
    localStateSave: () => Promise<void>;
    reload: () => void;
    serviceWorkerContainer: ServiceWorkerContainer;
    sessionStorage?: Storage;
    activationTimeoutMs?: number;
    maximumBootAttempts?: number;
}): Readonly<{
    check(): Promise<Readonly<{
        updateAvailable: boolean;
        criticalUpdate: boolean;
        currentVersion: string;
        availableVersion: string;
        waiting: boolean;
    }>>;
    activate(): Promise<void>;
    bootStart(): Readonly<{
        attempts: number;
        safeMode: boolean;
    }>;
    bootSuccess(): void;
}>;
```

### layerUpdateDescriptorValidate

```typescript
export declare const layerUpdateDescriptorValidate: (inputData: unknown) => Readonly<{
    protocol: 1;
    buildId: string;
    versionManifestHash: string;
}>;
```

### layerUpdateMetadataPathCheck

```typescript
export declare const layerUpdateMetadataPathCheck: (pathnameData: string) => boolean;
```

### LayerUpdatePhase

```typescript
export type LayerUpdatePhase = 'idle' | 'checking' | 'downloading' | 'verifying' | 'ready' | 'preparing' | 'activating' | 'blocked' | 'error' | 'unsupported';
```

### layerUpdatesConfigurationCreate

```typescript
export declare const layerUpdatesConfigurationCreate: (inputData: unknown) => Readonly<{
    enabled: boolean;
    ui: boolean;
    checkIntervalMs: number;
}>;
```

### layerVersionCompare

```typescript
export declare function layerVersionCompare(firstVersion: string, secondVersion: string): number;
```

### layerVersionManifestValidate

```typescript
export declare function layerVersionManifestValidate(manifestData: unknown): Readonly<{
    appVersion: string;
    runtimeVersion: string;
    compilerVersion: string;
    protocolMin: number;
    protocolMax: number;
    schemaVersions: Readonly<Record<string, number>>;
    minVersion: string | null;
    rollbackVersion: string | null;
    offlineShellUrl: string;
    assets: readonly Readonly<{
        url: string;
        hash: string;
        required: boolean;
        policy: unknown;
    }>[];
}>;
```

### layerWebAppManifestCreate

```typescript
export declare function layerWebAppManifestCreate(manifestOptions: LayerWebAppManifestOptions): Readonly<Record<string, unknown>>;
```

### LayerWebAppManifestOptions

```typescript
export type LayerWebAppManifestOptions = Readonly<{
    name: string;
    shortName: string;
    startUrl: string;
    icons: readonly Readonly<{
        src: string;
        sizes: string;
        type: string;
        purpose?: string;
    }>[];
    description?: string;
    id?: string;
    lang?: string;
    dir?: 'auto' | 'ltr' | 'rtl';
    orientation?: 'any' | 'natural' | 'landscape' | 'portrait' | 'portrait-primary' | 'portrait-secondary' | 'landscape-primary' | 'landscape-secondary';
    scope?: string;
    scopeExtensions?: readonly string[];
    display?: 'browser' | 'fullscreen' | 'minimal-ui' | 'standalone' | 'window-controls-overlay';
    themeColor?: string;
    backgroundColor?: string;
    shortcuts?: readonly LayerManifestShortcutOptions[];
    fileHandlers?: readonly LayerManifestFileHandlerOptions[];
    protocolHandlers?: readonly LayerManifestProtocolHandlerOptions[];
    shareTarget?: LayerManifestShareTargetOptions;
    launchHandler?: LayerManifestLaunchHandlerOptions;
}>;
```

### layerWebAppManifestValidate

```typescript
export declare function layerWebAppManifestValidate(manifestData: unknown): Readonly<Record<string, unknown>>;
```

### LayerWebAssociation

```typescript
export type LayerWebAssociation = import('./links-configuration.js').LayerWebAssociation;
```

### LayerWindowsAssociation

```typescript
export type LayerWindowsAssociation = import('./links-configuration.js').LayerWindowsAssociation;
```

Далее: [карта возможностей](capabilities.md), [каталог API](api-catalog.md).
