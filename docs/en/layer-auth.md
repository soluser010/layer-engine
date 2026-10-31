---
title: Layer Auth
description: Headless identities, sessions, MFA, OAuth 2.1, and OIDC.
audience: intermediate
order: 150
status: documented
updated: 2026-09-24
---

# Layer Auth

## Goal

Enable a headless identity, session, and multi-factor security system while the application keeps control over sign-in, registration, consent, and account-management pages.

Layer stores credentials, issues opaque sessions, and enforces CSRF, roles, and permissions. The application renders its own interface and stores its application profile in its own tables.

## Minimal configuration

Layer Auth is disabled by default. Enable password sign-in in `layer.config.js` and provide the secret only through ENV:

```js
export default {
    auth: {
        enabled: true,
        secret: {
            env: 'LAYER_AUTH_SECRET'
        },
        registration: {
            mode: 'open'
        },
        identifiers: {
            email: true,
            username: false
        },
        emailVerification: {
            required: false,
            lifetimeMs: 86400000
        },
        password: {
            minimumLength: 12,
            maximumLength: 128,
            commonPasswordBlocklist: true
        },
        passwordRecovery: {
            enabled: false,
            lifetimeMs: 1800000
        },
        session: {
            idleLifetimeMs: 1800000,
            absoluteLifetimeMs: 43200000,
            rememberIdleLifetimeMs: 604800000,
            rememberAbsoluteLifetimeMs: 2592000000,
            touchIntervalMs: 300000,
            maximumPerUser: 20,
            dataMaximumBytes: 16384
        },
        smtp: null,
        passkey: null,
        totp: null,
        oauth: null,
        oidc: []
    },
    deployment: {
        serverEntry: 'server/index.js'
    }
};
```

`LAYER_AUTH_SECRET` must contain at least 32 characters. Never commit it or place it in the browser bundle.

## Server runtime

Create Auth once per worker, register application operations first, then register Auth system operations before `registry.seal()`, and pass the extension to the operation executor:

```js
const authRuntime = context.auth.create({
    allowedOrigins: ['https://app.example.com'],
    oauthInteractionHandler
});

applicationOperationsRegister(operationRegistry);
authRuntime.register(operationRegistry);
```

Verified identity is available to a handler through `context.auth`. Do not read `userId`, tenant, roles, or permissions from the payload.

Registration order matters for the embedded OAuth provider: every custom scope, such as `profile.read`, must match a permission declared by at least one registered application operation. An unknown scope stops startup with `AUTH_OAUTH_SCOPE_UNREGISTERED`.

```js
const profileIdentifierData = context.auth.requireUser();
context.auth.requirePermission('profile.write');

const sessionData = context.auth.session;
const customSessionData = await context.auth.session.data.get();
```

Only trusted server code creates custom session data. It is size-bounded and cannot overwrite reserved identity fields.

## Registration and invitations

Available modes are:

- `disabled` — no registration;
- `open` — public registration;
- `invite` — the public operation accepts only a valid one-time invitation token;
- `admin-only` — only trusted server code creates accounts.

The server issues an invitation. Its raw token is returned once, while the database stores only an HMAC index:

```js
const invitationData = await authRuntime.service.invitations.issue({
    email: 'developer@example.com',
    roles: ['editor'],
    expiresAt: Date.now() + 86400000,
    createdBy: context.auth.requireUser()
});
```

Use the server-only facade in `admin-only` mode:

```js
const accountData = await authRuntime.service.registration.createManaged({
    identifier: 'developer@example.com',
    password: 'a-long-application-password'
});
```

Open or invitation registration in the browser looks like this:

```js
await window.layer.auth.registration.create({
    identifier: 'developer@example.com',
    password: 'a-long-application-password',
    invitationToken
});
```

## Sign-in, state, and sessions

```js
const signInResultData = await window.layer.auth.signIn.password({
    identifier: 'developer@example.com',
    password: 'a-long-application-password',
    remember: true
});

const authStateData = await window.layer.auth.state.get();
const sessionsData = await window.layer.auth.sessions.list();

await window.layer.auth.sessions.revoke(sessionsData.sessions[0].sessionId);
await window.layer.auth.signOut();
```

Passwords never enter the offline outbox. The opaque session cookie is `Secure`, `HttpOnly`, and `SameSite=Lax`; mutating POST requests require the bound CSRF token. `signOut()` clears user-isolated IndexedDB state even when the server session has already expired.

### Inactivity and maximum lifetime

`idleLifetimeMs` is a sliding inactivity timeout; `absoluteLifetimeMs` is a fixed limit measured from sign-in. With `remember: true`, Layer uses `rememberIdleLifetimeMs` and `rememberAbsoluteLifetimeMs`. For example, 7/30 days means daily activity keeps the session alive beyond day seven, but a new sign-in is required after 30 days.

```js
export default {
    auth: {
        enabled: true,
        session: {
            idleLifetimeMs: 604800000,
            absoluteLifetimeMs: 2592000000,
            rememberIdleLifetimeMs: 604800000,
            rememberAbsoluteLifetimeMs: 2592000000,
            touchIntervalMs: 300000
        }
    }
};
```

Activity means a cookie-session request that passes Origin, session expiry, CSRF, and operation permission checks. Layer updates `last_seen_at`, `idle_expires_at`, and `expires_at` in the system database; the new deadline never exceeds `absolute_expires_at`. Writes occur no more frequently than `touchIntervalMs` (five minutes by default), additionally capped at half the original idle lifetime. Last activity and the inactivity boundary therefore have this interval's granularity. Applications do not need a renewal timer.

An authenticated background API request also counts as activity. Merely displaying a page, offline work, anonymous requests, and incoming SSE events/heartbeats do not renew sessions; opening or reconnecting an authenticated stream goes through the normal checks. Do not send artificial heartbeats solely to keep a sign-in alive indefinitely.

The policy is persisted when a session is issued. Configuration changes affect new sign-ins without rewriting existing deadlines. Cookies live until the absolute limit; renewal does not need to issue a new cookie on every request. A database failure fails the request; expiry or revocation returns `AUTH_REQUIRED`, and Redis cache cannot revive that session. SQL locking and expiry checks protect concurrent workers, including expiration while waiting for a row lock.

**Upgrading an older installation:** migration 9 adds `idle_lifetime_ms` and derives the original interval of old managed sessions from `idle_expires_at - last_seen_at`. It does not change expiration deadlines, status, or custom session data. Live sessions start renewing on subsequent verified requests; expired or revoked sessions require a new sign-in. Rebuild the application with the updated framework and deploy the new bundle; editing only the old bundle's configuration does not fix its previous renewal defect.

For custom server integrations, `layerAuthServerRuntimeCreate` requires `sessions.touch(token, touchIntervalMs)` with a durable check and a `boolean` result; a missing method prevents startup. The lower-level `layerAuthenticationCreate` supports optional `sessionTouch(token)` after checks and before returning a security context. Do not call `touch` from an unverified handler or before CSRF validation. The standard runtime wires it automatically.

## Email verification and recovery

Configure SMTP for required email verification or password recovery:

```js
export default {
    auth: {
        smtp: {
            host: 'smtp.example.com',
            port: 465,
            secure: true,
            username: 'layer@example.com',
            password: {
                env: 'LAYER_SMTP_PASSWORD'
            },
            from: 'Layer <layer@example.com>'
        }
    }
};
```

The browser facade provides `emailVerification.request(identifier)`, `emailVerification.confirm(token)`, `passwordRecovery.request(identifier)`, and `passwordRecovery.complete({token, password})`. Requests return the same result for known and unknown accounts to avoid account enumeration.

## Passkey, TOTP, and recovery codes

```js
export default {
    auth: {
        passkey: {
            rpId: 'app.example.com',
            rpName: 'Example application',
            origins: ['https://app.example.com'],
            userVerification: 'required',
            timeoutMs: 60000
        },
        totp: {
            issuer: 'Example application',
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
            window: 1,
            recoveryCodeCount: 10
        }
    }
};
```

```js
await window.layer.auth.passkey.registration.create({
    displayName: 'Work laptop'
});

await window.layer.auth.signIn.passkey({remember: true});

const enrollmentData = await window.layer.auth.totp.enrollment.begin();
const confirmationData = await window.layer.auth.totp.enrollment.confirm('123456');

await window.layer.auth.mfa.verify({
    challenge: stagedChallenge,
    code: '123456'
});
```

Recovery codes are shown only at issue or rotation time. The database contains only protected representations and every code is single-use.

## External OIDC

An external provider uses Authorization Code, PKCE, state, and nonce. First sign-in creates an account only when `registration.mode` is `open` and the email is verified. Layer never links an existing account based only on a matching email.

```js
export default {
    auth: {
        oidc: [{
            id: 'company-identity',
            issuer: 'https://identity.example.com',
            clientId: 'layer-application',
            clientSecret: {
                env: 'LAYER_OIDC_COMPANY_SECRET'
            },
            redirectUri: 'https://app.example.com/auth/callback',
            scopes: ['openid', 'email', 'profile']
        }]
    }
};
```

```js
const beginData = await window.layer.auth.oidc.begin('company-identity', {
    returnTo: '/account'
});

location.assign(beginData.authorizationUrl);

const completeData = await window.layer.auth.oidc.complete({
    callbackUrl: location.href,
    remember: true
});
```

`oidc.redirect()` combines begin with an explicit navigation. Upstream tokens are encrypted and never sent to the browser.

## Embedded OAuth 2.1 and OpenID Connect provider

```js
export default {
    auth: {
        oauth: {
            issuer: 'https://auth.example.com',
            interactionUrl: '/auth/oauth',
            scopes: ['openid', 'offline_access', 'profile.read'],
            clients: [{
                id: 'browser-application',
                type: 'public',
                displayName: 'Browser application',
                redirectUris: ['https://client.example.com/auth/callback'],
                grantTypes: ['authorization_code', 'refresh_token'],
                scopes: ['openid', 'offline_access', 'profile.read'],
                dpop: 'required'
            }]
        }
    }
};
```

The provider exposes discovery, authorization, token, revoke, and introspection endpoints. Public clients must use Authorization Code with PKCE. Confidential clients may use Client Credentials with an ENV-backed secret. Access and refresh tokens are opaque; refresh rotation detects reuse. DPoP verifies a signed proof and key binding.

The application owns the `interactionUrl` page: it performs sign-in, renders consent, and sends the result through `oauthInteractionHandler`. Do not render arbitrary redirect URIs or trust client/scopes values taken from unchecked DOM.

Use an access token that requires DPoP with the application API as follows:

```http
POST /api HTTP/1.1
Authorization: DPoP opaque-access-token
DPoP: signed-proof-jwt
Content-Type: application/json
```

The resource proof is signed with the same P-256 key that was bound during token issuance. Its `htm` is `POST`, `htu` is the absolute `/api` URL, and `ath` is the SHA-256 access-token hash. Layer verifies the signature, thumbprint, proof age, and atomically rejects a repeated `jti`.

## Roles, permissions, and account lifecycle

Global roles are managed through the trusted server facade. Assigning or revoking a role invalidates authorization caches immediately. Application operations still declare their required permissions in the registry.

Disabling an account revokes sessions, API keys, OAuth grants/tokens, and external links. Anonymization removes credential links and replaces identifiers without breaking application references. Run these actions only from a privileged server operation and record them in the audit trail.

## Expected result

The application receives secure primitives while retaining its own markup and routes. Identity is always server-derived; credential commands are online-only; secrets, hashes, and adapter objects never enter the browser API.

When Layer Auth is enabled, the router uses `window.layer.auth.state.get()` by default for `auth: 'session'` and permission guards. IndexedDB receives a separate `auth:<userId>` namespace. The application can override these defaults explicitly with `identityGet` and `storageNamespaceGet` exports.

## Common errors

- `AUTH_CONFIGURATION_INVALID` — an unknown field, short secret, or incompatible setting; use the path and suggestions in details.
- `AUTH_INVITATION_INVALID` — the invitation token expired, was consumed, or belongs to another email.
- `AUTH_REQUIRED` — there is no valid managed session.
- `CSRF_INVALID` — a mutating browser POST lacks the bound CSRF token.
- `AUTH_CREDENTIALS_INVALID` — the same response is used for an unknown identifier and a wrong password.
- `AUTH_MFA_REQUIRED` — sign-in created a staged challenge that requires `mfa.verify()`.
- `AUTH_EMAIL_VERIFICATION_REQUIRED` — the account has not verified its email.
- `AUTH_OIDC_INVALID` or `AUTH_OAUTH_INVALID_REQUEST` — callback, state, nonce, client, redirect URI, PKCE, or protocol request validation failed.
- Passkey on a non-loopback HTTP origin — WebAuthn requires a secure context.

## Failure contract

A public error contains a stable `code`, safe message, `requestId`, `retryable`, and bounded `details`. Stack, cause, password, token, SMTP/OIDC/OAuth secret, and credential hash are never serialized. Rate limiting covers registration, sign-in, recovery, MFA, and OAuth endpoints. Redis failure falls back to PostgreSQL-backed coordination without losing the source of truth.

Next: [Security](security-auth.md), [Context API](context-api.md), [Database runtime](database-runtime.md), [PWA and Service Worker](pwa-service-worker.md).
