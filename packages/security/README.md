# @solcorp/layer-security

**Part of [Layer-Engine](https://www.npmjs.com/package/@solcorp/layer), a JavaScript framework for full PWA applications.** Authentication primitives, permissions, validation and resource limits.

Start with `npm install @solcorp/layer`; this module is installed automatically. You do not need to assemble the framework package by package.

[Quick start](https://github.com/soluser010/layer-engine/blob/main/README.md#quick-start) · [API guide EN](https://github.com/soluser010/layer-engine/blob/main/docs/en/security-auth.md) · [Документация RU](https://github.com/soluser010/layer-engine/blob/main/docs/ru/security-auth.md) · [Source](https://github.com/soluser010/layer-engine/tree/main/packages/security)

Часть фреймворка **Layer-Engine**. Для разработки приложения установите основной пакет `@solcorp/layer`; этот модуль входит в его зависимости. Ссылки выше ведут к назначению, API, примерам и ограничениям модуля.

Security primitives for the Layer-Engine server runtime. The package provides opaque browser sessions, OIDC/OAuth bearer integration, hashed scoped API keys, operation permissions, a distributed Redis token bucket, and a bounded in-process limiter for explicitly degraded operation.

```js
import {layerAuthenticationCreate} from '@solcorp/layer-security';

const authentication = layerAuthenticationCreate({
    allowedOrigins: [
        'https://app.example.com'
    ],
    sessionResolve: async (sessionIdentifier) => sessionStore.get(sessionIdentifier),
    bearerResolve: async (bearerToken) => oidcVerifier.verify(bearerToken),
    apiKeyResolve: async (apiKeyHash) => apiKeyStore.getByHash(apiKeyHash)
});

const securityContext = await authentication.contextResolve({
    auth: 'session',
    permissions: [
        'profile.read'
    ],
    headers,
    remoteAddress
});
```

The bearer resolver owns cryptographic signature, issuer, audience, expiry and claim validation. Raw API keys are SHA-256 hashed before repository lookup. Authentication failures return stable `LayerError` codes; CSRF values, cookies, bearer tokens, raw API keys, and raw headers are never included in public errors or diagnostics.

`layerRedisRateLimiterCreate` executes one atomic Lua token bucket across IP, credential, session, user, tenant, and operation dimensions. Redis keys contain hashes rather than identity values. `layerInMemoryRateLimiterCreate` is the bounded degraded-mode fallback and is not a distributed production limiter.

`layerOutboundUrlPolicyCreate` is the mandatory boundary for server-side
outbound destinations. It requires an exact HTTPS origin allowlist, resolves all
DNS answers, rejects private, loopback, link-local, multicast, documentation,
and mixed public/private results, and returns immutable verified addresses.
Redirect targets must be authorized again; application code must not issue an
unrestricted fetch before this check. The outbound transport must connect to
one returned address while preserving the original hostname for TLS SNI and
certificate validation; resolving the hostname again would reopen a DNS
rebinding window.

## Failure contract

- Invalid or expired sessions return `AUTH_REQUIRED`.
- Rejected origins and tokens return `CSRF_INVALID`.
- Missing operation permissions return `PERMISSION_DENIED`.
- Missing, malformed, expired, revoked, or under-scoped external credentials fail closed.
- The in-process limiter returns `{allowed: false, retryAfterMs}` when any identity bucket is exhausted or its bounded store cannot accept a new identity.
