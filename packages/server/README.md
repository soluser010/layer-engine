# @solcorp/layer-server

Part of **[Layer-Engine](https://www.npmjs.com/package/@solcorp/layer)**, the JavaScript framework for PWA applications. This module provides validated server operations and the Node HTTP runtime.

Install the complete framework with `npm install @solcorp/layer`. See the [quick start](https://github.com/soluser010/layer-engine#quick-start), [server guide (EN)](https://github.com/soluser010/layer-engine/blob/main/docs/en/server-runtime.md) and [руководство по серверу (RU)](https://github.com/soluser010/layer-engine/blob/main/docs/ru/server-runtime.md). [Source](https://github.com/soluser010/layer-engine/tree/main/packages/server).

The server package provides a sealed operation registry, bounded operation executor, safe diagnostics, and Node HTTP lifecycle. The runtime exposes only `GET /health/live`, `GET /health/ready`, and the unified `POST /api` application endpoint.

```js
import {layerOperationRegistryCreate} from '@solcorp/layer-server';

const operationRegistry = layerOperationRegistryCreate();

operationRegistry.define({
    name: 'profile.current.read',
    type: 'query',
    inputSchema: {
        type: 'object',
        additionalProperties: false
    },
    outputSchema: {
        type: 'object'
    },
    handler: async () => ({
        id: 'user-1'
    })
});

operationRegistry.seal();
```

Operations require a session by default. A public operation must explicitly set `auth: 'none'`.

```js
import {
    layerHttpRuntimeCreate,
    layerOperationExecutorCreate
} from '@solcorp/layer-server';

const operationExecutor = layerOperationExecutorCreate({
    operationRegistry,
    security,
    rateLimiter,
    diagnostics,
    database
});
const httpRuntime = layerHttpRuntimeCreate({
    operationRegistry,
    operationExecutor,
    diagnostics,
    database,
    trustedProxy: {
        addresses: ['loopback'],
        header: 'x-forwarded-for',
        maximumHops: 8
    }
});

await httpRuntime.start({
    host: '127.0.0.1',
    port: 8787
});
```

`trustedProxy` is fail-closed and defaults to `null`: forwarded headers are
ignored and `request.socket.remoteAddress` is used. A configured contract
contains one or more exact IP/CIDR values (or the explicit `loopback` token), a
selected `x-forwarded-for` or `forwarded` header, and a bounded `maximumHops`.
Resolution walks right-to-left and returns the nearest untrusted hop, preventing a
client-supplied left prefix from spoofing rate-limit/audit identity. Generated
Caddy and `layer dev` publish their loopback contract through
`layerServerCreate(context)`; pass `context.trustedProxy` to this runtime and
never trust forwarded headers on a public bind.

Production runtimes should set `auditRequired: true` and provide a durable
`auditTrail` such as `layerAuditRepositoryCreate(...)`. Audit records contain
only operation metadata and pseudonymized network identity; payloads, headers,
cookies, tokens, and stack traces are never passed to the sink.

An operation may declare `authorize(payload, context)` for object ownership and
writable-field checks. The policy runs after authentication, permission checks,
and rate limiting. Transactional commands receive the same restricted database
client as their handler. A false result or policy failure becomes the stable
`OBJECT_ACCESS_DENIED` error without disclosing whether the object exists.

## Failure contract

`define` throws a safe `LayerError` with one of these stable codes:

- `INVALID_OPERATION_DEFINITION` for unknown metadata, invalid bounds, or unsafe type combinations;
- `INVALID_OPERATION_SCHEMA` when AJV cannot compile an input or output schema;
- `OPERATION_DUPLICATE` when a name is already registered;
- `OPERATION_REGISTRY_SEALED` after `seal()`.

`get` returns `undefined` for an unknown operation. `list` is inspection-only and excludes handlers, schemas, and compiled validators.

The executor returns stable protocol codes for missing operations, invalid input/output, authentication, rate limits, concurrency, idempotency conflicts, unavailable dependencies, and timeouts. Unexpected handler failures become `INTERNAL_ERROR`; causes and stack traces are never serialized. Startup fails closed when PostgreSQL connection, migrations, or event distribution fail. An `events.open` request is authorized through the ordinary operation executor before the dedicated event stream takes ownership of the response. Shutdown drains streams before closing event distribution and PostgreSQL.
