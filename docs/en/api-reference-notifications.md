---
title: Signature reference — @solcorp/layer-notifications
description: Parameters, return values and related types.
audience: advanced
order: 310
status: documented
updated: 2026-10-31
---

# Signature reference — @solcorp/layer-notifications

Start with the [guide and examples](web-push.md). Below are the exact public call shapes and nested options for this version. This is notation reference, **not code to paste into an application**: applications remain JavaScript ESM. `?` means optional, `|` alternatives, `Promise<T>` an asynchronous result; readonly prohibits mutation through that contract. Optional does not define a default: behavior and defaults belong to the topic guide.

A signature describes data shape, not browser availability or a connected provider. Do not import server APIs into browser code. Advanced factories are for custom hosts; ordinary components use context. Route/cache/offline limitations: [page options](page-configuration.md).

## Imports

| Import | Export |
| --- | --- |
| `@solcorp/layer-notifications` | `layerNotificationsConfigurationCreate` |
| `@solcorp/layer-notifications` | `layerNotificationsSecretsRead` |
| `@solcorp/layer-notifications` | `layerNotificationsVapidGenerate` |
| `@solcorp/layer-notifications` | `layerNotificationsRuntimeCreate` |

## Parameters and results

Named types are expanded below; DOM and external-library types retain their standard names. A helper from another Layer package is included only when required by a public signature.

[layerNotificationsConfigurationCreate](#layernotificationsconfigurationcreate) · [layerNotificationsRuntimeCreate](#layernotificationsruntimecreate) · [layerNotificationsSecretsRead](#layernotificationssecretsread) · [layerNotificationsVapidGenerate](#layernotificationsvapidgenerate) · [LayerPushNotification](#layerpushnotification) · [LayerPushSendOptions](#layerpushsendoptions) · [PushDatabase](#pushdatabase) · [PushIdentity](#pushidentity) · [PushTransactionalDatabase](#pushtransactionaldatabase)

### layerNotificationsConfigurationCreate

```typescript
export declare function layerNotificationsConfigurationCreate(configurationData: unknown): Readonly<{
    secret: Readonly<{
        env: string;
    }>;
    webPush: Readonly<{
        vapid: Readonly<{
            subject: string;
            publicKey: Readonly<{
                env: string;
            }>;
            privateKey: Readonly<{
                env: string;
            }>;
        }>;
        delivery: Readonly<{
            concurrencyPerWorker: number;
            batchSize: number;
            pollIntervalMs: number;
            maximumAttempts: number;
            defaultTtlSeconds: number;
            maximumTtlSeconds: number;
        }>;
        allowedOrigins: readonly any[];
    }>;
}> | null;
```

### layerNotificationsRuntimeCreate

```typescript
export declare function layerNotificationsRuntimeCreate(optionsData: {
    configuration: unknown;
    applicationName: string;
    database: import('./repository.js').PushTransactionalDatabase;
    environment?: Record<string, string | undefined>;
    workerId?: string;
    redis?: {
        client: any;
        isReady: () => boolean;
    } | null;
    transport?: {
        send: (subscription: any, notification: any, options: {
            ttlSeconds: number;
            urgency: string;
            topic?: string | null;
        }) => Promise<{
            status: number;
            retryAfter?: string | string[] | null;
        }>;
    };
    identityActive?: (identityData: import('./repository.js').PushIdentity) => Promise<boolean>;
    onError?: (diagnosticData: {
        code: string;
    }) => void;
}): Readonly<{
    executor: Readonly<{
        bind: (transactionData: import('./repository.js').PushDatabase | null, identityData: import('./repository.js').PushIdentity) => Readonly<{
            webPush: Readonly<{

                send(sendData: LayerPushSendOptions): Promise<{
                    notificationId: string;
                    status: string;
                }>;
            }>;
        }>;
        afterCommit: () => Promise<void>;
    }>;

    scope(scopeData: {
        tenantId: string | null;
    }): Readonly<{
        webPush: Readonly<{

            send(sendData: LayerPushSendOptions): Promise<{
                notificationId: string;
                status: string;
            }>;
        }>;
    }>;

    register(registryData: {
        define: (definitionData: any) => unknown;
    }): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    diagnostics(): Promise<{
        pending: number;
        oldestMs: number;
        running: boolean;
        coordination: string;
    }>;
    poll: () => Promise<void>;
}>;
```

### layerNotificationsSecretsRead

```typescript
export declare function layerNotificationsSecretsRead(configurationData: NonNullable<ReturnType<typeof layerNotificationsConfigurationCreate>>, environmentData: Record<string, string | undefined>): Readonly<{
    secret: string;
    publicKey: string;
    privateKey: string;
}>;
```

### layerNotificationsVapidGenerate

```typescript
export declare function layerNotificationsVapidGenerate(): {
    publicKey: string;
    privateKey: string;
};
```

### LayerPushNotification

```typescript
export type LayerPushNotification = {
    title: string;
    body: string;
    url: string;
    icon?: string;
    badge?: string;
    tag?: string;
};
```

### LayerPushSendOptions

```typescript
export type LayerPushSendOptions = {
    recipients: {
        users: string[];
    };
    notification: LayerPushNotification;
    deduplicationKey: string;
    ttlSeconds?: number;
    urgency?: 'very-low' | 'low' | 'normal' | 'high';
    topic?: string;
};
```

### PushDatabase

```typescript
export type PushDatabase = {
    query: (queryData: {
        text: string;
        values: readonly unknown[];
    }) => Promise<{
        rows: Record<string, any>[];
        rowCount: number | null;
    }>;
    systemSchema?: string;
    kind?: 'embedded' | 'postgres';
};
```

### PushIdentity

```typescript
export type PushIdentity = {
    tenantId?: string | null;
    userId?: string | null;
    credentialId?: string | null;
    credentialReference?: string;
    authenticationType?: string;
};
```

### PushTransactionalDatabase

```typescript
export type PushTransactionalDatabase = PushDatabase & {
    transaction: <Result>(handler: (databaseData: PushDatabase) => Promise<Result>) => Promise<Result>;
};
```

Next: [capability map](capabilities.md), [API catalog](api-catalog.md).
