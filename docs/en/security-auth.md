---
title: Security and authentication primitives
description: Identity, permissions, CSRF, rate limits, and trust boundaries.
audience: intermediate
order: 160
status: documented
updated: 2026-10-31
---

# Security and authentication primitives

[Capability map](capabilities.md) · [Complete signatures and types](api-reference-security.md)

## Goal

Register an operation with least privilege and server-derived identity.

## Example

```js
registry.define({
    name: 'profile.rename',
    type: 'command',
    auth: 'session',
    permissions: ['profile.write'],
    transaction: true,
    inputSchema,
    outputSchema,
    handler
});
```

## Expected result

Session, user, and tenant come from verified server context. Identity values in the payload cannot affect ownership or permissions.

## Explanation

A browser session uses an opaque `Secure`, `HttpOnly`, `SameSite=Lax` cookie and CSRF for privileged POST requests. External clients use bearer tokens and integrations use scoped hashed API keys. Checks apply at operation, object, and field levels.

## Third-party resources and CSP

Applications can add explicit origins through [security.csp.sources](configuration.md#third-party-resource-permissions-in-csp). These permissions do not disable CSP: self sources, object/base/frame-ancestor restrictions and production Trusted Types remain. Validation rejects arbitrary policy text, unsafe script keywords and protected-directive overrides. Permit only services the application intentionally trusts for the selected resource types; server-side operation and data authorization remains independent.

## Common errors

- `auth: none` on an operation that reads private data.
- A secret literal in `layer.config.js` instead of an ENV reference.
- Remote plaintext PostgreSQL/Redis or an arbitrary URL without an SSRF allowlist.

## Failure contract

An external error contains a stable code, requestId, and retryable/details without stack/cause. Rate limits combine IP, identity, tenant, operation, and cost dimensions. Volumetric DDoS requires an external CDN/WAF.

Next: [Context API](context-api.md), [Deployment](deployment-diagnostics.md).
