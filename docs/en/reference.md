---
title: Configuration, CLI, and error reference
description: Concise command, configuration block, and error reference.
audience: all
order: 250
status: release-candidate
updated: 2026-10-06
---

# Configuration, CLI, and error reference

## Goal

Find a stable entry point and error-handling rule quickly.

## Main commands

```text
layer create <name>
layer dev
layer build
layer doctor
layer notifications vapid generate
layer database schema plan
layer database schema apply <checksum> --confirm-data-loss
```

## Main configuration blocks

- `development`: host, port, HTTPS, and live reload.
- `database`: embedded storage, PostgreSQL topology, schema, replica lag, and pool budget.
- `redis`: one optional accelerator.
- `notifications`: optional server [Web Push](web-push.md), VAPID ENV, and a bounded delivery queue.
- `runtime.workers`: minimum and fixed/auto maximum.
- `deployment`: domain, server entry, origin port, and exact dependencies.

## Error contract

```js
const failure = {
    code: 'RATE_LIMITED',
    message: 'Request rate is limited.',
    requestId: 'uuid',
    retryable: true,
    details: {retryAfterMs: 1000}
};
```

Stack/cause and sensitive values are never serialized. A client branches on `code`, logs `requestId`, and retries only when `retryable: true` after the supplied delay.

## Common errors

`INVALID_PAYLOAD`, `AUTH_REQUIRED`, `PERMISSION_DENIED`, `RATE_LIMITED`, `REVISION_CONFLICT`, `DATABASE_DEPENDENCY_UNAVAILABLE`, and `OPERATION_TIMEOUT`.

## Failure contract

An unknown code is handled as a non-retryable generic failure. The application does not expose internal details without its own allowlist.

Next: [CLI](installation-cli.md), [Security](security-auth.md), [Context API](context-api.md).
