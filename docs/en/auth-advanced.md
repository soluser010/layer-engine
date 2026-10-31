---
title: Permissions, session data and account lifecycle
description: Application permissions and safe account administration beyond sign-in.
audience: advanced
order: 155
status: documented
updated: 2026-10-28
---

# Permissions, session data and account lifecycle

See [Layer Auth](layer-auth.md) for configuration and sign-in. This chapter assumes managed Auth created through `context.auth.create` in serverEntry. Normal operation context always contains security; the auth extension exists only when Auth runtime is connected.

<!-- contract: auth -->
## Roles and access checks

```js
await authRuntime.roles.define({name: 'editor', permissions: ['messages.read', 'messages.edit']});
await authRuntime.roles.assign( userId, 'editor' );
const assigned = await authRuntime.roles.listForUser( userId );
await authRuntime.roles.remove( userId, 'editor' );
```

This is trusted server administration, not browser API. `authRuntime` is the factory result from [server integration](layer-auth.md). Assign roles only from an operation with administrative permission and authorization for the target user. Never grant roles directly from payload.roles. Roles are global; enforce tenant-specific business access separately in authorize/repositories.

Declare `permissions: ['messages.edit']` on the operation. Handlers receive verified `context.security`; managed extensions provide `context.auth.user`, `permissions` and `assurance`. Page guards improve UI but cannot replace server checks. Role changes invalidate user authorization, including active sessions; handle reauthentication in the UI.

## Custom session data

```js
import {LayerError} from '@solcorp/layer-protocol';

export async function selectedWorkspaceSave( payload, context ){
    //Requiring a managed browser session rather than trusting a payload session ID
    const session = context.auth?.session;
    if ( !session ){
        throw new LayerError( 'AUTH_REQUIRED', 'Sign in to save this preference.', {status: 401} );

    }

    //Validating workspace membership belongs in operation authorize before this handler
    const current = await session.data.get();
    return session.data.merge( {workspaceId: payload.workspaceId}, current.revision );

}
```

Register this as a command with auth:session, bounded workspaceId and workspace membership authorization. `session.data.get()` returns `{value, revision}`; `set(value, revision)` replaces data, `merge(patch, revision)` merges top-level fields, and `delete(['field'], revision)` removes selected fields. Writes return new value/revision. There is no `context.auth.sessionData`; use `context.auth.session.data`.

`AUTH_SESSION_CONFLICT` / 409 means another operation changed data first. Reread and reconcile the patch; do not substitute a newer revision without checking intent. Data is limited by `auth.session.dataMaximumBytes`, JSON constraints and reserved identity/security fields. Use it for session preferences, not passwords, access tokens or authoritative permissions. Bearer/API-key identities may have no managed session.

## Revocation and account removal

Browsers manage only their own sessions through `window.layer.auth.sessions.list()` and `sessions.revoke(sessionId)`. Server `context.auth.authorization.invalidate()` invalidates the current user's authorization. Trusted `authRuntime.accounts.invalidate(userId, reason)` is also restricted to authorized administrative code.

`authRuntime.accounts.disable(userId)` prevents further use and revokes Layer-owned sessions/API keys/OAuth artifacts. `accounts.anonymize(userId)` invokes configured `auth.anonymization` and erases authentication identity. Handle application profiles/files separately in an idempotent hook. Failure leaves unfinished work available for a safe retry; it does not promise distributed rollback of external systems. Never perform destructive lifecycle actions through GET or without explicit application confirmation.

## Failure contract

Missing managed session produces `AUTH_REQUIRED`; session-data lost updates produce `AUTH_SESSION_CONFLICT`; invalid custom values fail validation. Never replace denial with local-store “successful sign-in”. Account removal, disabling and revocation are distinct user actions and business policies.

Next: [operations](operations.md), [security](security-auth.md).
