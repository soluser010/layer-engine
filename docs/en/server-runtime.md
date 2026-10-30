---
title: Server runtime and serverEntry
description: Full-stack server entry contract, operation registry, private origin, readiness, drain, and Caddy.
audience: intermediate
order: 130
status: release-candidate
updated: 2026-10-20
---

# Server runtime and serverEntry

## Goal

Enable a Node backend only when the application needs operations, auth, a database, or an event stream.

A static PWA keeps deployment.serverEntry: null. A full-stack application sets serverEntry: 'server/index.js'. The CLI bundles that ESM graph into dist/_layer/server/application.mjs.

## Lifecycle contract

The server entry exports layerServerCreate(context). The factory returns start, stop, and isReady. The launcher always supplies a private loopback host/port; the application does not bind a public 0.0.0.0 listener itself.

```js
import {
    layerDiagnosticsCreate,
    layerHttpRuntimeCreate,
    layerOperationExecutorCreate
} from '@solcorp/layer-server';
import {applicationOperationRegistryCreate} from './operations.js';
import {applicationSecurityCreate} from './security.js';

export async function layerServerCreate( contextData ){
    //Checking infrastructure managed by the Layer launcher
    if (
        typeof contextData.databaseRuntime?.query !== String( 'function' ) ||
        typeof contextData.rateLimiter?.consume !== String( 'function' )
    ){
        //Passing the incomplete runtime context to startup
        throw new TypeError( String( 'The application server context is invalid.' ) );

    }

    //Creating the sealed operation, security, and diagnostics boundaries
    const operationRegistryData = applicationOperationRegistryCreate();
    const securityData = applicationSecurityCreate( contextData );
    const diagnosticsData = layerDiagnosticsCreate();
    const operationExecutorData = layerOperationExecutorCreate({
        operationRegistry: operationRegistryData,
        security: securityData,
        rateLimiter: contextData.rateLimiter,
        diagnostics: diagnosticsData,
        database: contextData.databaseRuntime,
        databaseSchema: contextData.databaseSchema,
        queryCache: contextData.queryCache
    });
    const httpRuntimeData = layerHttpRuntimeCreate({
        operationRegistry: operationRegistryData,
        operationExecutor: operationExecutorData,
        diagnostics: diagnosticsData,
        database: null,
        trustedProxy: contextData.trustedProxy
    });

    //Returning the lifecycle controlled by dev host or production launcher
    return Object.freeze({
        async start( listenOptionsData ){
            //Opening only the private loopback listener supplied by Layer
            await httpRuntimeData.start( listenOptionsData );

        },
        async stop( stopOptionsData = {} ){
            //Draining active requests before the worker exits
            await httpRuntimeData.stop( stopOptionsData );

        },
        isReady(){
            //CallBack THE BOOLEAN
            return httpRuntimeData.isReady();

        }
    });

}
```

This is an infrastructure-level example. In an application, keep operations.js, security.js, and services as focused modules so index.js shows startup/shutdown order instead of business logic.

## Managed context

Depending on configuration, the launcher supplies environment, workerId, trustedProxy, databaseRuntime, databaseSchema, rateLimiter, queryCache, eventBus, leases, coordination, Redis status, and a Layer Auth factory. Validate only dependencies you actually require and stop startup when a required dependency is unavailable.

Do not create a separate PostgreSQL pool or Redis client in every domain module: managed context already accounts for worker count, connection budget, fallback, and shutdown order.

## HTTP surface

The Layer HTTP runtime publishes:

- GET /health/live;
- GET /health/ready;
- POST /api;
- OAuth/OIDC interoperability endpoints only when the Layer Auth provider is enabled.

Caddy serves HTML, JS, CSS, manifest, and Service Worker as GET resources. The events.open operation opens the event stream through POST /api.

## Startup and shutdown

The production launcher follows integrity → dependencies → Caddy verification → database/migrations → workers/readiness → public Caddy. On SIGINT/SIGTERM, Caddy stops routing new requests, the worker drains HTTP/SSE, and adapters close last.

isReady means the worker can handle a real request, not merely that the process exists. Losing the PostgreSQL primary removes write readiness. Redis failure uses the designed fallback and never turns Redis into the source of truth.

## Trusted proxy

Pass context.trustedProxy to layerHttpRuntimeCreate. The runtime accepts a forwarded address only from the configured loopback Caddy boundary and walks right-to-left to the nearest untrusted hop. Never trust X-Forwarded-For on a public listener without an exact proxy allowlist.

## Safe HTTP diagnostics

`layerDiagnosticsCreate({sink})` forwards allowlisted scalar fields. `request.failed` includes `stage`, `errorType`, `errorCode`, `causeType`, `causeCode`, `requestComplete`, `responseDestroyed`, `responseEnded`, `responseHeadersSent`, and existing `requestId`, `operation`, `code`, `status`. Cause types/technical codes are restricted: message, stack, SQL, payload, headers, and credentials are not copied.

Stages are `readiness`, `body-read`, `protocol`, `envelope`, `client-address`, `stream-authorization`, `stream-open`, `operation`, `response`, and `extension`. Operation names are trusted only after envelope validation. Before body parsing, a server-generated UUID is used and returned in JSON errors when a response can still be sent. A failed sink does not break requests or leak through an unsafe console fallback.

A request-body disconnect is classified as `REQUEST_ABORTED`: the `request.aborted` event uses level `info`, is not a confirmed internal failure, and does not invent an HTTP 499 response. Closed connections receive no response; if still writable, the error uses HTTP 400. A dependency `ECONNRESET` during operation execution remains an internal failure, not client cancellation. Invalid JSON remains 400, oversized bodies 413, and body deadlines 408.

If application logging filters events/fields, explicitly forward `request.aborted` and the new technical fields or they will be discarded. Worker/build metadata may be added in a server-only sink from trusted launcher context; never include HTTP headers or an arbitrary error object. A client requestId is for correlation, not identity or permissions.

A disconnect after commit does not prove rollback: retry commands with their original `commandId`, using the existing idempotency contract.

## Common errors

- serverEntry is configured but does not export layerServerCreate;
- start binds a different host/port;
- the registry is sealed before Layer Auth/system operations register;
- readiness stays true after database loss;
- stop does not await event stream drain.

## Failure contract

A factory/start/readiness error prevents the public Caddy listener from starting. The launcher returns a bounded code without private stack/cause. Caddy termination always initiates worker stop; a partially started backend is never ready.

Next: [Operations](operations.md), [Databases](database-runtime.md), [Deployment](deployment-diagnostics.md).
