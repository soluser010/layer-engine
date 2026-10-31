---
title: Справочник сигнатур — @solcorp/layer-security
description: Параметры, возвращаемые значения и связанные типы.
audience: advanced
order: 310
status: documented
updated: 2026-10-31
---

# Справочник сигнатур — @solcorp/layer-security

Начните с [руководства и примеров](security-auth.md). Ниже — точные формы публичных вызовов и вложенных options текущей версии. Это справочник обозначений, **не код для вставки в приложение**: приложение остаётся JavaScript ESM. `?` означает необязательность, `|` — варианты, `Promise<T>` — асинхронный результат; readonly запрещает изменение через этот контракт. Необязательность не задаёт default: поведение и значения по умолчанию описаны в тематической статье.

Подпись описывает форму данных, а не доступность браузерной функции и не гарантию подключения provider. Server API нельзя переносить в браузер. Advanced factories нужны для собственного host; обычный компонент использует context. Ограничения route/cache/offline: [настройки страницы](page-configuration.md).

## Импорты

| Import | Export |
| --- | --- |
| `@solcorp/layer-security` | `LayerSecurityContext` |
| `@solcorp/layer-security` | `layerCookieValueGet` |
| `@solcorp/layer-security` | `layerHeaderValueGet` |
| `@solcorp/layer-security` | `layerAuthenticationCreate` |
| `@solcorp/layer-security` | `layerIdentityCacheCreate` |
| `@solcorp/layer-security` | `layerInMemoryRateLimiterCreate` |
| `@solcorp/layer-security` | `layerRateLimiterFailoverCreate` |
| `@solcorp/layer-security` | `layerOutboundUrlPolicyCreate` |
| `@solcorp/layer-security` | `layerRedisRateLimiterCreate` |
| `@solcorp/layer-security` | `layerSessionSecurityCreate` |

## Параметры и результаты

Именованные типы раскрываются ниже; типы DOM и внешних библиотек сохраняют свои стандартные имена. Одинаковый helper из другого Layer-пакета включён только если нужен для публичной подписи.

[layerAuthenticationCreate](#layerauthenticationcreate) · [layerCookieValueGet](#layercookievalueget) · [layerHeaderValueGet](#layerheadervalueget) · [layerIdentityCacheCreate](#layeridentitycachecreate) · [LayerIdentityData](#layeridentitydata) · [layerInMemoryRateLimiterCreate](#layerinmemoryratelimitercreate) · [layerOutboundUrlPolicyCreate](#layeroutboundurlpolicycreate) · [LayerRateLimiter](#layerratelimiter) · [layerRateLimiterFailoverCreate](#layerratelimiterfailovercreate) · [LayerRateLimitResult](#layerratelimitresult) · [layerRedisRateLimiterCreate](#layerredisratelimitercreate) · [LayerSecurityContext](#layersecuritycontext) · [LayerSessionCompatibilityData](#layersessioncompatibilitydata) · [LayerSessionData](#layersessiondata) · [layerSessionSecurityCreate](#layersessionsecuritycreate)

### layerAuthenticationCreate

```typescript
export declare function layerAuthenticationCreate(authenticationOptions?: {
    allowedOrigins?: readonly string[];
    sessionResolve?: (sessionIdentifier: string) => Promise<LayerSessionData | null> | LayerSessionData | null;
    sessionTouch?: (sessionIdentifier: string) => Promise<boolean> | boolean;
    bearerResolve?: (bearerToken: string, requestContext?: Readonly<{
        scheme: 'bearer' | 'dpop';
        headers: Record<string, string | string[] | undefined>;
    }>) => Promise<LayerIdentityData | null> | LayerIdentityData | null;
    apiKeyResolve?: (apiKeyHash: string) => Promise<LayerIdentityData | null> | LayerIdentityData | null;
    sessionCookieName?: string;
    csrfHeaderName?: string;
    apiKeyHeaderName?: string;
    clock?: () => number;
}): Readonly<{

    contextResolve(requestSecurityData: {
        auth: 'session' | 'authenticated' | 'bearer' | 'api-key' | 'none';
        permissions: readonly string[];
        headers: Record<string, string | string[] | undefined>;
        remoteAddress: string;
    }): Promise<Readonly<{
        authenticationType: 'anonymous' | 'session' | 'bearer' | 'api-key';
        credentialId: string | null;
        sessionId: string | null;
        userId: string | null;
        tenantId: string | null;
        permissions: readonly string[];
        remoteAddress: string;
        assurance?: readonly string[];
        credentialReference?: string;
    }>>;
}>;
```

### layerCookieValueGet

```typescript
export declare function layerCookieValueGet(cookieHeader: string | undefined, cookieName: string): string | undefined;
```

### layerHeaderValueGet

```typescript
export declare function layerHeaderValueGet(headersData: Record<string, string | string[] | undefined>, headerName: string): string | undefined;
```

### layerIdentityCacheCreate

```typescript
export declare function layerIdentityCacheCreate(cacheOptionsData: {
    cache: {
        read: (requestData: any) => Promise<{
            hit: boolean;
            value: unknown;
        }>;
        write: (requestData: any, valueData: unknown, generationData?: string) => Promise<boolean>;
        generationRead?: () => Promise<string>;
        invalidate: (invalidationData: any) => Promise<number>;
    };
    sessions: {
        resolve: (sessionIdentifierData: string) => Promise<any>;
        revoke: (sessionIdentifierData: string) => Promise<boolean>;
        cacheTagCreate: (sessionIdentifierData: string) => string;
    };
    apiKeys: {
        resolve: (apiKeyHashData: string) => Promise<any>;
        revokeWithCacheTag: (keyIdentifierData: string) => Promise<{
            revoked: boolean;
            cacheTag: string | null;
        }>;
    };
    maximumTtlMs?: number;
    clock?: () => number;
    diagnostics?: {
        record: (diagnosticData: Record<string, unknown>) => void;
    };
}): Readonly<{
    sessions: Readonly<{
        resolve(sessionIdentifierData: string): Promise<any>;
        revoke(sessionIdentifierData: string): Promise<boolean>;
    }>;
    apiKeys: Readonly<{
        resolve(apiKeyHashData: string): Promise<any>;
        revoke(keyIdentifierData: string): Promise<boolean>;
    }>;
    isBypassing(): boolean;
}>;
```

### LayerIdentityData

```typescript
export type LayerIdentityData = {
    id: string;
    userId: string;
    tenantId: string | null;
    permissions: readonly string[];
    assurance?: readonly string[];
    credentialReference?: string;
    expiresAt: number;
    status: 'active' | 'revoked';
};
```

### layerInMemoryRateLimiterCreate

```typescript
export declare function layerInMemoryRateLimiterCreate(limiterOptions?: {
    clock?: () => number;
    maxEntries?: number;
    entryTtlMs?: number;
}): Readonly<{

    consume(rateRequestData: {
        profile: 'anonymous' | 'session' | 'bearer' | 'api-key';
        remoteAddress: string;
        credentialId?: string | null;
        sessionId: string | null;
        userId: string | null;
        tenantId: string | null;
        operation: string;
        cost: number;
    }): LayerRateLimitResult;
    sizeGet(): number;
}>;
```

### layerOutboundUrlPolicyCreate

```typescript
export declare function layerOutboundUrlPolicyCreate(policyOptions: {
    allowedOrigins: readonly string[];
    lookup?: (hostname: string, options: {
        all: true;
        verbatim: true;
    }) => Promise<readonly {
        address: string;
        family: number;
    }[]>;
}): Readonly<{

    authorize(requestUrl: string): Promise<Readonly<{
        url: string;
        origin: string;
        hostname: string;
        addresses: readonly any[];
    }>>;
}>;
```

### LayerRateLimiter

```typescript
export type LayerRateLimiter = Readonly<{
    consume: (requestData: any) => Promise<Readonly<{
        allowed: boolean;
        remaining: number;
        retryAfterMs: number;
    }>> | Readonly<{
        allowed: boolean;
        remaining: number;
        retryAfterMs: number;
    }>;
}>;
```

### layerRateLimiterFailoverCreate

```typescript
export declare function layerRateLimiterFailoverCreate(limiterOptionsData: {
    primary: LayerRateLimiter;
    fallback: LayerRateLimiter;
    primaryReady?: () => boolean;
    diagnostics?: {
        record: (diagnosticData: Record<string, unknown>) => void;
    };
    recoveryCooldownMs?: number;
    clock?: () => number;
}): Readonly<{

    consume(requestData: any): Promise<Readonly<{
        allowed: boolean;
        remaining: number;
        retryAfterMs: number;
    }> | Readonly<{
        allowed: boolean;
        remaining: number;
        retryAfterMs: number;
    }>>;
    isPrimaryAvailable(): boolean;
}>;
```

### LayerRateLimitResult

```typescript
export type LayerRateLimitResult = {
    allowed: boolean;
    remaining: number;
    retryAfterMs: number;
};
```

### layerRedisRateLimiterCreate

```typescript
export declare function layerRedisRateLimiterCreate(limiterOptions: {
    redis: {
        eval: (scriptData: string, commandData: {
            keys: readonly string[];
            arguments: readonly string[];
        }) => Promise<unknown>;
    };
    profiles?: Readonly<Record<'anonymous' | 'session' | 'bearer' | 'api-key', {
        capacity: number;
        refillPerMinute: number;
    }>>;
    keyPrefix?: string;
    entryTtlMs?: number;
}): Readonly<{

    consume(rateRequestData: {
        profile: 'anonymous' | 'session' | 'bearer' | 'api-key';
        remoteAddress: string;
        credentialId?: string | null;
        sessionId: string | null;
        userId: string | null;
        tenantId: string | null;
        operation: string;
        cost: number;
    }): Promise<Readonly<{
        allowed: boolean;
        remaining: number;
        retryAfterMs: number;
    }>>;
}>;
```

### LayerSecurityContext

```typescript
export type LayerSecurityContext = import('./authentication.js').LayerSecurityContext;
```

### LayerSessionCompatibilityData

```typescript
export type LayerSessionCompatibilityData = {
    id: string;
    userId: string;
    tenantId: string | null;
    permissions: readonly string[];
    csrfTokenHash: string;
    expiresAt: number;
    status: 'active' | 'revoked';
};
```

### LayerSessionData

```typescript
export type LayerSessionData = LayerIdentityData & {
    csrfTokenHash: string;
};
```

### layerSessionSecurityCreate

```typescript
export declare function layerSessionSecurityCreate(securityOptions: {
    allowedOrigins: readonly string[];
    sessionResolve: (sessionIdentifier: string) => Promise<LayerSessionCompatibilityData | null> | LayerSessionCompatibilityData | null;
    sessionCookieName?: string;
    csrfHeaderName?: string;
    clock?: () => number;
}): Readonly<{
    contextResolve(requestSecurityData: {
        auth: 'session' | 'authenticated' | 'bearer' | 'api-key' | 'none';
        permissions: readonly string[];
        headers: Record<string, string | string[] | undefined>;
        remoteAddress: string;
    }): Promise<Readonly<{
        authenticationType: 'anonymous' | 'session' | 'bearer' | 'api-key';
        credentialId: string | null;
        sessionId: string | null;
        userId: string | null;
        tenantId: string | null;
        permissions: readonly string[];
        remoteAddress: string;
        assurance?: readonly string[];
        credentialReference?: string;
    }>>;
}>;
```

Далее: [карта возможностей](capabilities.md), [каталог API](api-catalog.md).
