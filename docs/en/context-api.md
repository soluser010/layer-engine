---
title: Component Context API
description: High-level query, command, event, and lifecycle handles.
audience: intermediate
order: 120
status: documented
updated: 2026-10-31
---

# Component Context API

[Capability map](capabilities.md) · [Complete signatures and types](api-reference-runtime.md)

Viewport, input policies, scroll anchors, lifecycle-owned `context.viewport`, and `context.keyboard` (show/hide/state/subscribe/capability): [application shell](viewport.md).

`context.api` is the high-level client API for `*.layer.js`. A component does not create protocol envelopes or call `fetch('/api')` directly. The application runtime owns transport, the IndexedDB query cache, and the transactional outbox; each component bundle adapts runtime snapshots into local read-only signals.

Low-level `window.layer.query(operation, payload, options)` and `window.layer.command(operation, payload, options)` remain available for infrastructure and compatibility. Components should use the object-based `context.api` contract.


## Complete option set

| Call / field | Required / default | Contract |
| --- | --- | --- |
| `query.operation` | Required | Dotted operation name |
| `query.payload` | Required | Plain object or synchronous function returning an object; read for each request cycle |
| `query.cache` | `{}` | All policies, key and age: [caching](caching.md) |
| `query.offline.fallback` | `cache` | `cache` / `reject` |
| `query.timeoutMs` | Transport default | Integer 100–120000 ms; does not extend server timeout |
| `command.operation` | Required | Command name |
| `command.offline.strategy` | `outbox` | `outbox` / `reject`; reject is not commandOnline and does not promise absence of durable writes |
| `command.conflictDomain` | Derived from operation | String 1–240; conflict grouping |
| `command.optimistic.apply` | Absent | `(payload, queryCache)` → token / Promise; after durable enqueue |
| `command.optimistic.rollback` | Absent | `(error, queryCache, token)` → void / Promise |
| `execute(payload, options)` | Payload required, options `{}` | options: `baseRevision`, `conflictDomain`, `optimisticPatch`; exact types in the reference |

Unknown query/command definition fields fail with TypeError. Handle signals are read-only; `data.get()` reads a value, `data` in html binds reactively. `refresh()` starts a cycle with the current payload; `settled()` waits for completion; `cancel()` does not roll back a completed server write. `dispose()` releases a handle; reuse is prohibited.

## Component context inventory

| Field | Purpose |
| --- | --- |
| `environment` | Rendering environment |
| `slots`, `emit` | Component composition and events |
| `provide`, `consume` | Explicit dependencies; consume reads a provider |
| `api`, `command`, `events` | Application API and event subscription provider |
| `route` | `{route, params, preload}` of the current navigation |
| `navigate` | Navigation through the application router |
| `storage`, `capabilities`, `logger` | Connected host services |
| `viewport`, `keyboard`, `links` | Lifecycle-owned browser APIs |
| `onMount`, `onHydrate`, `onUpdate`, `onDestroy` | Lifecycle callback registration |

Do not assume browser providers exist during SSR or in manual hosts. Check nullable APIs and use lifecycle hooks rather than unconditional calls during render. `context.route.preload` is the application runner result, not automatically loaded query-handle data.

## Query

Place the following fragment inside a component function `(properties, context)`. `properties.conversationId` identifies the open conversation; declare `chat.messages.list` in your application.

```js
const messagesQuery = context.api.query({
    operation: 'chat.messages.list',
    payload: function(){
        //Reading the current conversation when the query runs
        return {
            conversationId: properties.conversationId,
            limit: 50
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
```

Read-only signals:

- `data` — `data` from the success envelope or the last valid cached value;
- `pending` — cache or network work is in progress;
- `error` — a safe runtime error or `null`;
- `updatedAt` — local time of the last applied snapshot;
- `stale` — the current value must not be treated as fresh;
- `status` — `loading`, `success`, `stale`, or `error`;
- `source` — `cache`, `network`, `local`, or `null`.

Methods: `refresh()`, `cancel()`, `settled()`, `cacheUpdate(updater)`, `cacheInsert(value)`, `cacheRemove(predicate)`, and `dispose()`.

Cache policies:

- `cache-and-network` publishes an available cache snapshot and then requests the network;
- `cache-first` completes from a fresh cache entry and refreshes stale data from the network;
- `network-only` skips the cache read but stores a successful result;
- `no-store` neither reads nor writes query cache data.

With `offline.fallback: 'cache'`, stale data is used only when the browser is offline or transport fails with a retryable error. Authorization, permission, and validation errors are never hidden behind cached data. Large or sensitive payloads should declare a short safe `cache.key`; secrets must not be included in that key.

## Command

```js
const messageSendCommand = context.api.command({
    operation: 'chat.message.send',
    offline: {
        strategy: 'outbox'
    },
    optimistic: {
        apply: async function( commandPayload, queryCache ){
            //Displaying a pending message until the server confirms the command
            await queryCache.insert( 'chat.messages.list', {
                commandId: commandPayload.commandId,
                text: commandPayload.text,
                state: 'pending'
            });

            return commandPayload.commandId;

        },
        rollback: async function( _commandError, queryCache, optimisticCommandId ){
            //Removing the optimistic message after a rejected command
            await queryCache.removeByCommandId( optimisticCommandId );

        }
    }
});

await messageSendCommand.execute({
    conversationId: properties.conversationId,
    text: messageDraft.peek(),
    baseRevision: conversationRevision.peek()
});
```

Read-only signals: `pending`, `error`, `lastResult`, `commandId`, and `state`. Methods: `execute(payload, options)`, `cancel()`, `settled()`, and `dispose()`.

`baseRevision` may be supplied as a payload shorthand, but the runtime removes it from the domain payload and sends it as protocol metadata. A command is committed to the user-isolated IndexedDB outbox first. Optimistic cache work and network draining can start only after that durable commit. A declared rollback runs after a terminal failure; hidden last-write-wins is not implemented.

One command controller permits one active execution. Calling `execute` again while it is pending fails with `COMMAND_ACTIVE`.

Optional `conflictDomain` groups commands whose order cannot change. When omitted, the runtime derives a valid domain from the operation name: `chat.message.send` becomes `chat:message:send`.

## CommandOnline

`window.layer.api.commandOnline(operation, payload, options)` sends a command only while online, without writing its payload to the IndexedDB outbox. Use it for one-time verification codes and other sensitive commands that must not be stored for later delivery. The generated browser runtime also exposes the `window.layer.commandOnline` alias. This is a direct Promise API with positional arguments; the component adapter does not expose a separate `context.api.commandOnline` method.

### Arguments and result

| Argument | Contract |
| --- | --- |
| `operation` | A string naming a registered command operation. |
| `payload` | An operation payload object; `null` and arrays are not accepted. |
| `options` | An optional object, defaulting to `{}`. Its only supported field is `baseRevision`: a non-negative safe integer, defaulting to `0`. Supply the revision here rather than as a payload shorthand. |
| Result | A `Promise` resolving to a copy of the successful protocol response's `data` field, without the outer envelope. |

### Example

This example runs in a browser form handler after starting phone verification and receiving a `challengeId`. The application must configure phone Auth and a `phoneChallenge` provider; `phoneSignal` holds an E.164 number and `verificationCodeSignal` holds the code entered by the user. The application owns challenge persistence and code delivery.

```js
const phoneVerificationResult = await window.layer.api.commandOnline(
    'auth.phone.verify',
    {
        phone: phoneSignal.peek(),
        challengeId: phoneChallengeIdSignal.peek(),
        code: verificationCodeSignal.peek()
    },
    {baseRevision: 0}
);

const signedInUserId = phoneVerificationResult.user.id;
```

### Expected result

After successful verification, the server sets session/CSRF cookies and returns safe `user` and `session` metadata. This method does not write the verification code to IndexedDB or the offline outbox. The standard same-origin API client creates a new `commandId` for the call and sends `baseRevision` as protocol metadata; no manual envelope construction is required.

### Errors and resubmission

- Invalid argument shapes, unknown option fields, or a host without an online transport cause a `TypeError` before a network call. The standard protocol/server runtime also validates the payload schema, operation name, and access.
- If the runtime considers the browser offline, the Promise rejects with `COMMAND_OFFLINE` and `retryable: true`. The command is neither queued nor automatically sent after reconnect.
- Network and server errors propagate to the caller. Being online does not guarantee successful delivery.
- Each new call creates a new `commandId`. Do not blindly resubmit a sensitive command after an uncertain network outcome: first check its state according to the operation's contract.

This method does not create a command controller, read-only signals, optimistic updates, or offline replay. The application owns the form's pending/error state and any decision to call again. Use `context.api.command` for ordinary durable commands; see [offline/outbox](offline-realtime.md).

## Lifecycle and lazy chunks

Query and command handles are owned by their component. The generated bundle registers one owner cleanup synchronously during setup, so event handlers may safely create additional handles later. On component destruction, the adapter unsubscribes from runtime state, cancels active queries, and releases command watchers. `dispose()` releases a dynamic handle earlier. The application cache and outbox remain shared across routes.

Signals are created inside the active component bundle. This matters for lazy chunks: the application runtime publishes framework-neutral snapshots through `subscribe`, and the local adapter connects them to the current renderer's dependency graph. An API state change therefore updates only dependent DOM bindings.

## Errors

If the signal is aborted before calling the low-level API or while obtaining a CSRF token, the request is not sent and returns `API_ABORTED`. Cancellation after transmission does not guarantee rollback of a server command: resolve its outcome using the original `commandId` instead of repeating the action with a new identifier.

A public error exposes stable `code`, `message`, `requestId`, `status`, `retryable`, `retryAfterMs`, and `details` fields. UI code must not display stack/cause data or serialize complete payloads.

High-level API codes include `QUERY_OFFLINE`, `QUERY_DISPOSED`, `COMMAND_ACTIVE`, `COMMAND_DISPOSED`, and `COMMAND_OFFLINE`; transport and server codes are preserved from the protocol runtime.

## Next

Lifecycle-owned context.links, open/closeViewer and viewer failure contracts: [application links](links-navigation.md).
