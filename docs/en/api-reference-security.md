---
title: Signature reference — @solcorp/layer-security
description: Parameters, return values and related types.
audience: advanced
order: 310
status: documented
updated: 2026-10-31
---

# Signature reference — @solcorp/layer-security

Start with the [guide and examples](security-auth.md). Below are the exact public call shapes and nested options for this version. This is notation reference, **not code to paste into an application**: applications remain JavaScript ESM. `?` means optional, `|` alternatives, `Promise<T>` an asynchronous result; readonly prohibits mutation through that contract. Optional does not define a default: behavior and defaults belong to the topic guide.

A signature describes data shape, not browser availability or a connected provider. Do not import server APIs into browser code. Advanced factories are for custom hosts; ordinary components use context. Route/cache/offline limitations: [page options](page-configuration.md).

## Imports

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

## Parameters and results

Named types are expanded below; DOM and external-library types retain their standard names. A helper from another Layer package is included only when required by a public signature.

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

Next: [capability map](capabilities.md), [API catalog](api-catalog.md).
