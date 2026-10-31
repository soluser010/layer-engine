---
title: Справочник сигнатур — @solcorp/layer-notifications
description: Параметры, возвращаемые значения и связанные типы.
audience: advanced
order: 310
status: documented
updated: 2026-10-31
---

# Справочник сигнатур — @solcorp/layer-notifications

Начните с [руководства и примеров](web-push.md). Ниже — точные формы публичных вызовов и вложенных options текущей версии. Это справочник обозначений, **не код для вставки в приложение**: приложение остаётся JavaScript ESM. `?` означает необязательность, `|` — варианты, `Promise<T>` — асинхронный результат; readonly запрещает изменение через этот контракт. Необязательность не задаёт default: поведение и значения по умолчанию описаны в тематической статье.

Подпись описывает форму данных, а не доступность браузерной функции и не гарантию подключения provider. Server API нельзя переносить в браузер. Advanced factories нужны для собственного host; обычный компонент использует context. Ограничения route/cache/offline: [настройки страницы](page-configuration.md).

## Импорты

| Import | Export |
| --- | --- |
| `@solcorp/layer-notifications` | `layerNotificationsConfigurationCreate` |
| `@solcorp/layer-notifications` | `layerNotificationsSecretsRead` |
| `@solcorp/layer-notifications` | `layerNotificationsVapidGenerate` |
| `@solcorp/layer-notifications` | `layerNotificationsRuntimeCreate` |

## Параметры и результаты

Именованные типы раскрываются ниже; типы DOM и внешних библиотек сохраняют свои стандартные имена. Одинаковый helper из другого Layer-пакета включён только если нужен для публичной подписи.

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

Далее: [карта возможностей](capabilities.md), [каталог API](api-catalog.md).
