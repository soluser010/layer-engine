# @solcorp/layer-auth

**Part of [Layer-Engine](https://www.npmjs.com/package/@solcorp/layer), a JavaScript framework for full PWA applications.** Authentication identities, sessions, passkeys and OAuth/OIDC providers.

Start with `npm install @solcorp/layer`; this module is installed automatically. You do not need to assemble the framework package by package.

[Quick start](https://github.com/soluser010/layer-engine/blob/main/README.md#quick-start) · [API guide EN](https://github.com/soluser010/layer-engine/blob/main/docs/en/layer-auth.md) · [Документация RU](https://github.com/soluser010/layer-engine/blob/main/docs/ru/layer-auth.md) · [Source](https://github.com/soluser010/layer-engine/tree/main/packages/auth)

Часть фреймворка **Layer-Engine**. Для разработки приложения установите основной пакет `@solcorp/layer`; этот модуль входит в его зависимости. Ссылки выше ведут к назначению, API, примерам и ограничениям модуля.

Headless identity, session, MFA, OAuth 2.1, and OpenID Connect runtime for
Layer-Engine. Applications own their login, registration, consent, and account
screens; Layer owns credential security and durable lifecycle state.

The package provides:

- normalized email/username identities and Argon2id password credentials;
- opaque managed sessions, CSRF binding, bounded server-only session data, and
  immediate authorization invalidation;
- open, invite, admin-only, and disabled registration policies;
- Passkey/WebAuthn, TOTP, single-use recovery codes, email verification, and
  password recovery;
- global roles/permissions and application authorization hooks;
- external OIDC sign-in with Authorization Code, PKCE, state, and nonce;
- an embedded OAuth 2.1/OpenID Connect provider with exact static clients,
  Authorization Code + PKCE, Client Credentials, opaque tokens, refresh
  rotation/reuse detection, DPoP, revocation, introspection, discovery, audit,
  and distributed rate limiting.

## Application configuration

Layer Auth is disabled by default:

```js
export default {
    auth: null
};
```

Enable it with an ENV-backed secret:

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
        }
    }
};
```

The layer create command writes complete commented recipes for SMTP, Passkey,
TOTP, embedded OAuth, and external OIDC into the generated configuration.

## Server runtime

Create Auth once per worker. Register application operations first, then its
system operations before sealing the registry, and pass its context extension
to the operation executor:

```js
const authRuntime = context.auth.create({
    allowedOrigins: ['https://app.example.com'],
    oauthInteractionHandler
});

applicationOperationsRegister(operationRegistry);
authRuntime.register(operationRegistry);
```

Every custom embedded OAuth scope must match a permission declared by a
registered application operation. Layer stops startup for an unbound scope.
DPoP-bound access tokens reach `POST /api` through
`Authorization: DPoP <token>` and the signed `DPoP` request header.

Trusted server code may use authRuntime.service.invitations,
authRuntime.service.registration.createManaged, authRuntime.roles, and
authRuntime.accounts. Raw credential hashes, signing keys, upstream OIDC
tokens, and database adapters are not exposed to browser code.

## Browser runtime

The application bundle installs the headless facade at `window.layer.auth`.
Credential commands are online-only and never enter the offline outbox:

```js
await window.layer.auth.registration.create({
    identifier: 'developer@example.com',
    password: 'a-long-application-password'
});

const authState = await window.layer.auth.state.get();
```

See docs/ru/layer-auth.md and docs/en/layer-auth.md in the repository for
configuration, complete flows, failure contracts, and production requirements.

Install this module through the main `@solcorp/layer` package; its browser and server entry points keep authentication credentials on the server.
