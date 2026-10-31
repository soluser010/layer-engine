---
title: Operations — complete and simplified approaches
description: src/operations.js, server handlers, generated facade, permissions, limits, transactions, and failure contracts.
audience: intermediate
order: 110
status: documented
updated: 2026-10-31
---

# Operations: complete and simplified approaches

[Capability map](capabilities.md) · [Complete signatures and types](api-reference-server.md)

## Goal

Define a query or command once, share the same schema contract between browser and server, and select an appropriate client convenience level.

An operation is a named action on the unified POST /api endpoint. A query reads, a command changes state, and sync restores a snapshot. events.open is a system transport contract and is not declared in client src/operations.js.

## Two files, two trust zones

- src/operations.js contains static JSON-compatible metadata only. The compiler parses its AST without executing code.
- src/server/operations.js attaches handler, authorize, and server-only metadata. This code never enters the browser bundle.

### Minimal public query

```js
import {layerOperationContractsCreate} from '@solcorp/layer';

export const operations = layerOperationContractsCreate([
    {
        name: 'profile.public.read',
        type: 'query',
        auth: 'none',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['profileId'],
            properties: {
                profileId: {
                    type: 'string',
                    format: 'uuid'
                }
            }
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['profileId', 'displayName'],
            properties: {
                profileId: {
                    type: 'string',
                    format: 'uuid'
                },
                displayName: {
                    type: 'string',
                    maxLength: 120
                }
            }
        }
    }
]);
```

auth: none is always explicit. An omitted auth means session. additionalProperties: false prevents unnoticed extra input.

### Attaching the server handler

```js
import {operations} from '../operations.js';

export function applicationOperationsRegister( operationRegistryData, servicesData ){
    //Getting the static contract shared with the browser build
    const profileReadOperationData = operations.find(function operationFind( operationData ){
        //CallBack THE BOOLEAN
        return String( operationData.name ) === String( 'profile.public.read' );

    });

    //Checking the contract and service before mutating the registry
    if (
        profileReadOperationData === undefined ||
        typeof servicesData.profileRead !== String( 'function' )
    ){
        //Passing the incomplete server module to startup
        throw new TypeError( String( 'The profile.public.read operation is incomplete.' ) );

    }

    //Registering trusted behavior separately from client-visible metadata
    operationRegistryData.define({
        ...profileReadOperationData,
        handler: servicesData.profileRead
    });

}
```

After registering application and system operations, call registry.seal(). list() never exposes handlers, schemas, or compiled validators.

## Recommended client: generated facade

After layer build, the dotted profile.public.read name becomes profilePublicReadQueryCreate. JSON Schema produces input/output declarations and IntelliSense.

```js
import {html, layerComponentCreate} from '@solcorp/layer';
import {profilePublicReadQueryCreate} from '#layer/operations';

export default layerComponentCreate(function ProfilePage( properties, context ){
    //Creating a lifecycle-owned typed query handle
    const profileQueryData = profilePublicReadQueryCreate( context, {
        payload: function payloadCreate(){
            //CallBack THE OBJECT
            return {
                profileId: String( properties.profileId )
            };

        },
        cache: {
            policy: 'cache-and-network',
            maxAgeMs: 30000
        },
        offline: {
            fallback: 'cache'
        }
    });

    //Rendering query state through direct signal bindings
    return html`<output>${profileQueryData.status}</output><p>${profileQueryData.data}</p>`;

});
```

The generated wrapper delegates to the same context.api and does not create a second transport. A query handle exposes read-only data, pending, error, status, and source signals plus refresh/cancel/settled/dispose methods.

## Simplified client

When generated types are unnecessary or infrastructure chooses the operation name, call context.api directly:

```js
const profileQueryData = context.api.query({
    operation: 'profile.public.read',
    payload: {
        profileId: properties.profileId
    }
});
```

This remains safe: envelope, requestId, CSRF, response validation, cache, and lifecycle still belong to the runtime. Calling window.layer.query manually is less desirable; that low-level API remains for infrastructure and compatibility.

## Complete production command

The shared contract adds auth: session, permissions, rateLimitBucket, cost, timeoutMs, concurrency, transaction: true, offlineReplay: true, audit, and strict schemas. commandId and baseRevision exist in the schema, but the generated facade removes commandId from author input because the runtime creates it before committing to the outbox.

The server definition additionally attaches:

- authorize(payload, context) for ownership and writable fields;
- handler(payload, context);
- cacheInvalidation for a transactional command only;
- server-derived user/tenant from context.security;
- database facade/transaction from context.database.

The complete executable example is in fixtures/documentation/full. The minimal example is in fixtures/documentation/minimal; npm run docs:check verifies both.

## Choosing metadata depth

| Scenario | Minimum | Add |
| --- | --- | --- |
| Public catalog | query, auth none, schemas, handler | global cache when measured useful |
| Private data | query, schemas, handler | permissions, authorize, user/tenant scope |
| Simple online mutation | command, schemas, handler | permissions, transaction |
| Offline mutation | command | transaction, offlineReplay, baseRevision, rollback UX |
| Expensive read | query | cost, dedicated bucket, timeout, concurrency |
| Privileged action | command | permissions, authorize, audit category |

Do not copy maximum metadata mechanically. Validation, an explicit auth decision, and bounded execution are mandatory for every public action.

## JSON Schema

Layer uses Draft 2020-12 in strict mode. Dynamic JavaScript, spread, methods, prototype keys, and unknown contract fields are rejected. Bound strings, arrays, nesting, and enumerations whenever the domain knows them. Output is validated too: an invalid handler result becomes a server error rather than untrusted browser data.

## Identity, authorization, and BOLA

Never trust userId, tenantId, roles, or permissions from payload as an access source. Authentication produces context.security. context.auth is a separate optional managed Layer Auth extension; a minimal server does not receive it automatically. Permissions run before the handler; authorize checks the concrete object and writable fields. Denial returns safe OBJECT_ACCESS_DENIED without revealing object existence.

## Idempotency, conflicts, and offline

An offline command is first committed to the IndexedDB outbox. With `transaction: true`, repeating `commandId` returns the saved result only to the same verified user (or the same API key), in the same tenant, for the same operation and payload. Object key order does not matter; values, array order and `baseRevision` do. The current `authorize` policy still runs. PostgreSQL transaction locks serialize concurrent retries; a successfully committed command does not execute its handler again.

A different identity, payload or operation receives `REVISION_CONFLICT`. Do not bypass this refusal by automatically creating another `commandId`: resolve the original command's outcome first. Migration 10 adds identity/digest without removing results. Legacy records without these fields are never rebound to the first retrying caller and return `REVISION_CONFLICT`. An anonymous transactional command can execute once, but its saved result is never disclosed on replay: use authentication for offline replay.

The engine does not compare `baseRevision` against application records automatically. The handler must check the current revision inside the transaction and return `REVISION_CONFLICT` on a mismatch; the application explicitly decides merge/retry. There is no hidden last-write-wins. External HTTP calls in a handler do not become part of the SQL transaction: use an outbox for external effects.

## Errors

INVALID_PAYLOAD indicates invalid input. Invalid handler output becomes INTERNAL_ERROR without exposing the internal result. AUTH_REQUIRED and PERMISSION_DENIED concern identity. RATE_LIMITED may be retryable. OPERATION_TIMEOUT bounds a handler. Do not automatically retry a non-retryable command with a new commandId.

## Verification

- unit-test the handler with a fake server context;
- registry-test defaults, authorize, and handler visibility;
- protocol-test schema boundaries;
- integration-test session, CSRF, permission, and transaction rollback;
- offline-test replay/conflict;
- threat-test BOLA, injection, oversized payload, and rate-limit bypass.

Next: [Context API](context-api.md), [Server runtime](server-runtime.md), [Security](security-auth.md).
