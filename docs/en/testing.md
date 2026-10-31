---
title: Testing applications
description: Unit, protocol, renderer, browser, security, integration, and load verification for Layer applications.
audience: intermediate
order: 200
status: documented
updated: 2026-10-31
---

# Testing applications

[Capability map](capabilities.md)

## Goal

Verify domain logic quickly while keeping real browser/database/PWA contracts in separate reproducible tests.

## Verification pyramid

1. Unit: pure services, merge policy, validators.
2. Contract: operation schemas, registry metadata, error codes.
3. Renderer: actual DOM mutations, keyed identity, cleanup.
4. Integration: POST /api, PostgreSQL transaction, Redis fallback, event replay.
5. Browser: SSR→hydration, navigation, IndexedDB, offline, Service Worker update.
6. Security: XSS, CSRF, BOLA/BFLA, injection, SSRF, deep/large body, replay, limits.
7. Load/soak: throughput, p50/p95/p99, CPU/RSS/ELU, pools, streams, and drain.

## Unit example

Use built-in node:test and pass dependencies explicitly.

Create `src/server/status.js` in your application. Assign this handler to a `system.status` operation with `auth: 'none'` and an output schema for `{status: string}`.

```js
export async function statusRead(){
    //Returning the application status without private infrastructure details
    return {status: 'ok'};

}
```

Then create `test/status.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {statusRead} from '../src/server/status.js';

test( 'public status handler returns the documented result', async function(){
    //Calling the application's own handler with validated input
    const operationResultData = await statusRead( {}, {} );

    //Checking the exact output contract
    assert.deepEqual( operationResultData, {
        status: String( 'ok' )
    });

});
```

Run `node --test test/status.test.js` from your application directory. Expect one passing test. A direct handler call tests business logic only; exercise HTTP/auth/schema separately in integration tests.

## What every operation should test

- valid/invalid input and output;
- auth none/session/bearer/api-key;
- permissions and object authorize;
- timeout, concurrency, and rate-limit cost;
- transaction commit/rollback;
- idempotent command replay;
- offline conflict and retryability;
- tenant/user isolation;
- handler absence from inspection.

## Renderer and browser

Test actual DOM mutation counts, not only HTML. For repeat, keep Element references, change one item, and confirm unrelated nodes were not replaced. A browser test should open a direct route, hydrate, navigate with query/hash, reload under Service Worker control, and exercise offline fallback.

## Infrastructure

A local fault proxy is safer than stopping a shared service: it models PostgreSQL or Redis disconnect/reconnect on separate test ports. Integration environments must use a dedicated database/schema and Redis database index; cleanup must not touch user data.

## Checks for your application

Add your own unit and integration test commands to the application package.json. They should exercise your operations, access policies, and user workflows. Before deployment, verify the built production bundle, data recovery, and version rollback in a separate environment.

## Load testing

Increase load gradually. Define acceptable latency and resource usage for your application. Separate successful 200 responses from protective 429 responses; total transport rate is not useful throughput.

## Safari

Choose browsers according to your application audience. For iPhone/iPad, check Safari in a tab and the installed PWA separately: input, keyboard, safe areas, navigation, and foreground return. Unavailable features should have a clear fallback.

## Failure contract

If latency exceeds your budget, data is lost or access control fails, fix the cause and repeat that scenario before deployment. Keep API protection enabled in public environments.

Next: [Errors](errors.md), [Browser support](browser-support.md), [Performance report](performance-report.md).
