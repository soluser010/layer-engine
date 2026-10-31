---
title: Errors and diagnostics
description: Reading Layer CLI, runtime, protocol, and browser errors and safely choosing retry or correction.
audience: beginner
order: 230
status: documented
updated: 2026-10-31
---

# Errors and diagnostics

[Capability map](capabilities.md) · [Complete signatures and types](api-reference-protocol.md)

## Goal

Find an error source from code/requestId without leaking a secret or creating an infinite retry loop.

## Public API error

```js
const operationErrorData = {
    code: 'RATE_LIMITED',
    message: 'Request rate is limited.',
    requestId: '01900000-0000-7000-8000-000000000001',
    retryable: true,
    details: {
        retryAfterMs: 1000
    }
};
```

UI branches on code, keeps requestId for support, and obeys retryable/retryAfterMs. message is safe for a general explanation, but an application may replace it with localized copy. Do not render complete details without an allowlist.

## Categories

| Category | Examples | Action |
| --- | --- | --- |
| Input | INVALID_PAYLOAD, CLI_CONFIG_INVALID | correct field/schema; do not retry |
| Identity | AUTH_REQUIRED, CSRF_INVALID | refresh auth state or show sign-in |
| Access | PERMISSION_DENIED, OBJECT_ACCESS_DENIED | do not retry automatically |
| Capacity | RATE_LIMITED | wait for retryAfterMs |
| Conflict | REVISION_CONFLICT | show merge/reload flow |
| Dependency | DEPENDENCY_UNAVAILABLE | retain offline intent and await recovery |
| Lifecycle | QUERY_DISPOSED, COMMAND_ACTIVE | fix component lifecycle |
| Build | LAYER_*_INVALID, CLI_DEV_BUILD_FAILED | correct the source diagnostic |

## CLI diagnostics

`INVALID_PAYLOAD` describes operation input; invalid handler output is hidden behind `INTERNAL_ERROR`. A low-level server adapter may throw `DATABASE_DEPENDENCY_UNAVAILABLE`, but this is not a universal browser error code. Follow the contract of the API you call: managed Auth has its own identity codes, while the basic security layer uses `AUTHENTICATION_REQUIRED`, `AUTHORIZATION_DENIED`, `CSRF_INVALID` and related protocol codes.

Run a command with --diagnostics=json or LAYER_CLI_DIAGNOSTICS=json for CI. A known config error contains file, path, line, column, and suggestions. Fix the earliest error first because later ones may be cascading symptoms.

```text
layer doctor --diagnostics=json
layer build --diagnostics=json
```

CLI_INTERNAL_ERROR means an unexpected boundary failure. Keep the code, safe message, command, Node/npm versions, and a minimal reproduction. Never publish .env, cookies, tokens, database URLs, or a full private stack.

## Browser diagnostics

Check:

1. Network: document, hashed JS/CSS, manifest, layer-service-worker.js.
2. Console: the first Layer code before cascading AbortError messages.
3. Application: active/waiting Service Worker, Cache Storage, IndexedDB.
4. layer doctor and server /health/ready.
5. requestId in server audit/diagnostics.

Fast route changes may cancel an old query. A cancelled request is expected when its stale result does not replace the new page. It becomes a defect when cancellation is shown as a user error or breaks the current handle.

## Service Worker

waiting is not necessarily an error: the two-phase update waits for a safe restart/activation. Use layer.pwa.update.getState(), check(), and activate() for application UX. Do not call skipWaiting blindly or delete cache/IndexedDB as a universal fix.

## Failure contract

For [Web Push](web-push.md): `NOTIFICATIONS_SECRET_UNAVAILABLE` means missing/invalid ENV secrets and failed-closed startup; `NOTIFICATIONS_INVALID` returns a safe invalid-field path; `NOTIFICATIONS_SUBSCRIPTION_LIMIT` is the user's device limit. Do not automatically retry denied permission (`PWA_PUSH_PERMISSION_DENIED`).

Stack/cause stays in trusted diagnostics. Redaction removes credentials and payload secrets. Treat an unknown code as a non-retryable generic failure. Every automatic retry must be bounded, respect idempotency, and stop when its lifecycle owner is cancelled.

Next: [Reference](reference.md), [Testing](testing.md), [Deployment diagnostics](deployment-diagnostics.md).
