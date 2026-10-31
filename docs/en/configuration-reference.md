---
title: Complete configuration reference
description: Strict configuration fields, defaults, disabled modes and applying changes.
audience: advanced
order: 252
status: documented
updated: 2026-10-31
---

# Complete configuration reference

[Capability map](capabilities.md)

`layer.config.js` exports one ESM object. Unknown fields are rejected. The table is generated from current `layerConfigValidate`: default means an omitted-field value; “enabled-block example” is a valid example, **not a feature enabled by default**. Array item fields use `[]`. No real secrets are read; REFERENCE_SECRET is a demonstration ENV-reference name.

## Disabling features, environment and application

| Block | Purpose / disabled mode | Environment and application |
| --- | --- | --- |
| appName, appVersion | Name required; semver version; never secrets | Dev/prod; rebuild. BuildId is calculated separately |
| sourceDirectory, publicDirectory, outputDirectory | Distinct relative directories inside the application; cannot disable | Build; restart dev |
| css.targets | Browser engine floors; default matrix below; empty object rejected | Dev/prod CSS compiler; rebuild/restart dev; not DOM/PWA polyfills |
| deployment | domain:null requires LAYER_DOMAIN; serverEntry:null means static PWA; dependencies:{} means no external runtime deps | Production build/start; ENV domain takes precedence; originPort is private loopback |
| development | Loopback host only; https:false; liveReload:false disables dev client/endpoints | Dev only; restart; dist is not edited |
| database.postgres | [] means system-only PGlite, one worker; one primary and optional replicas of one cluster | Server; rebuild/restart; application tables need external PostgreSQL |
| database.embedded | dataDirectory:null uses default persistent state directory | Server; outside dist; do not copy a running database as backup |
| database.schema | file declares application tables; synchronization only supports additive | Server startup; unsafe changes require schema plan/apply |
| database.replica, pool | Lag/connection limits; null budget disables auto-scale | Server startup; total budget, per-worker pool |
| redis | null disables; one connection object, not an array | Server; failure uses the documented durable fallback |
| runtime.workers | minimum=maximum is fixed; maximum:'auto' needs budget and external PostgreSQL | Launcher; rebuild/restart; only 1/1 without external database |
| auth | null disables; object needs enabled:true and secret ENV; registration.mode:'disabled' disables registration, not sign-in | Server; rebuild/restart; existing sessions retain their own lifetime policy |
| notifications | null disables; Web Push needs explicit serverEntry, VAPID and secret ENV | Server; rebuild/restart; keys are generated separately, not each build |
| security.csp.sources | {} keeps base policy; additional sources are resource-directive specific | Dev/prod headers; rebuild/restart; do not disable CSP to fix embedding |
| security.permissionsPolicy | camera/microphone/geolocation/payment: [] denies, ['self'] permits own origin | Headers; rebuild/restart; does not grant user permission |
| links | external.mode:'platform' disables viewer; allowedOrigins:[] permits no iframe; empty associations generate no documents | Build/browser; rebuild and SW update |
| updates | enabled:false disables Layer checks; ui:false only hides the card | Browser; rebuild; native SW lifecycle remains |

Literal passwords are limited to permitted local development; production secrets use `{env: 'NAME'}`. PostgreSQL password:null is loopback-only; remote plaintext is forbidden. Redis username/password may be null locally. TLS modes: verify-full checks CA/name, require uses TLS without full verification, disable is loopback-only. Prefer verify-full in production.

Config changes are not hot-applied: restart dev after editing; rebuild and redeploy production bundles. ENV secrets and LAYER_DOMAIN are read when the built application starts. Editing source does not change a running process.

## Field values

<!-- generated-contract:start -->
| Field | Default or example | Contract |
| --- | --- | --- |
| `appName` | default: `"reference"` | [appName](configuration.md) |
| `appVersion` | default: `"0.1.0"` | [appVersion](configuration.md) |
| `css.targets.chrome` | default: `"109"` | [css](configuration.md) |
| `css.targets.edge` | default: `"109"` | [css](configuration.md) |
| `css.targets.firefox` | default: `"115"` | [css](configuration.md) |
| `css.targets.safari` | default: `"16.4"` | [css](configuration.md) |
| `css.targets.ios_saf` | default: `"16.4"` | [css](configuration.md) |
| `auth.enabled` | default with auth.enabled: `true` | [auth](layer-auth.md) |
| `auth.secret.env` | default with auth.enabled: `"REFERENCE_SECRET"` | [auth](layer-auth.md) |
| `auth.registration.mode` | default with auth.enabled: `"disabled"` | [auth](layer-auth.md) |
| `auth.identifiers.email` | default with auth.enabled: `true` | [auth](layer-auth.md) |
| `auth.identifiers.username` | default with auth.enabled: `false` | [auth](layer-auth.md) |
| `auth.identifiers.phone` | default with auth.enabled: `false` | [auth](layer-auth.md) |
| `auth.emailVerification.required` | default with auth.enabled: `false` | [auth](layer-auth.md) |
| `auth.emailVerification.lifetimeMs` | default with auth.enabled: `86400000` | [auth](layer-auth.md) |
| `auth.password.minimumLength` | default with auth.enabled: `12` | [auth](layer-auth.md) |
| `auth.password.maximumLength` | default with auth.enabled: `128` | [auth](layer-auth.md) |
| `auth.password.commonPasswordBlocklist` | default with auth.enabled: `true` | [auth](layer-auth.md) |
| `auth.passwordRecovery.enabled` | default with auth.enabled: `false` | [auth](layer-auth.md) |
| `auth.passwordRecovery.lifetimeMs` | default with auth.enabled: `1800000` | [auth](layer-auth.md) |
| `auth.session.idleLifetimeMs` | default with auth.enabled: `1800000` | [auth](layer-auth.md) |
| `auth.session.absoluteLifetimeMs` | default with auth.enabled: `43200000` | [auth](layer-auth.md) |
| `auth.session.rememberIdleLifetimeMs` | default with auth.enabled: `604800000` | [auth](layer-auth.md) |
| `auth.session.rememberAbsoluteLifetimeMs` | default with auth.enabled: `2592000000` | [auth](layer-auth.md) |
| `auth.session.touchIntervalMs` | default with auth.enabled: `300000` | [auth](layer-auth.md) |
| `auth.session.maximumPerUser` | default with auth.enabled: `20` | [auth](layer-auth.md) |
| `auth.session.dataMaximumBytes` | default with auth.enabled: `16384` | [auth](layer-auth.md) |
| `auth.smtp.host` | enabled-block example: `"mail.example.com"` | [auth](layer-auth.md) |
| `auth.smtp.port` | enabled-block example: `465` | [auth](layer-auth.md) |
| `auth.smtp.secure` | enabled-block example: `true` | [auth](layer-auth.md) |
| `auth.smtp.username` | enabled-block example: `"app"` | [auth](layer-auth.md) |
| `auth.smtp.password.env` | enabled-block example: `"REFERENCE_SECRET"` | [auth](layer-auth.md) |
| `auth.smtp.from` | enabled-block example: `"app@example.com"` | [auth](layer-auth.md) |
| `auth.passkey.rpId` | enabled-block example: `"app.example.com"` | [auth](layer-auth.md) |
| `auth.passkey.rpName` | enabled-block example: `"Example"` | [auth](layer-auth.md) |
| `auth.passkey.origins` | enabled-block example: `["https://app.example.com"]` | [auth](layer-auth.md) |
| `auth.passkey.userVerification` | enabled-block example: `"required"` | [auth](layer-auth.md) |
| `auth.passkey.timeoutMs` | enabled-block example: `60000` | [auth](layer-auth.md) |
| `auth.totp.issuer` | enabled-block example: `"Example"` | [auth](layer-auth.md) |
| `auth.totp.algorithm` | enabled-block example: `"SHA1"` | [auth](layer-auth.md) |
| `auth.totp.digits` | enabled-block example: `6` | [auth](layer-auth.md) |
| `auth.totp.period` | enabled-block example: `30` | [auth](layer-auth.md) |
| `auth.totp.window` | enabled-block example: `1` | [auth](layer-auth.md) |
| `auth.totp.recoveryCodeCount` | enabled-block example: `10` | [auth](layer-auth.md) |
| `auth.oauth.issuer` | enabled-block example: `"https://app.example.com"` | [auth](layer-auth.md) |
| `auth.oauth.interactionUrl` | enabled-block example: `"/authorize"` | [auth](layer-auth.md) |
| `auth.oauth.scopes` | enabled-block example: `["offline_access","openid"]` | [auth](layer-auth.md) |
| `auth.oauth.clients` | enabled-block example: `[{"id":"example-client","type":"confidential","secret":{"env":"REFERENCE_SECRET"},"displayName":"Example client","redirectUris":["https://client.example.com/callback"],"grantTypes":["authorization_code","refresh_token"],"scopes":["offline_access","openid"],"dpop":"optional"}]` | [auth](layer-auth.md) |
| `auth.oauth.clients[].id` | enabled-block example: `"example-client"` | [auth](layer-auth.md) |
| `auth.oauth.clients[].type` | enabled-block example: `"confidential"` | [auth](layer-auth.md) |
| `auth.oauth.clients[].secret.env` | enabled-block example: `"REFERENCE_SECRET"` | [auth](layer-auth.md) |
| `auth.oauth.clients[].displayName` | enabled-block example: `"Example client"` | [auth](layer-auth.md) |
| `auth.oauth.clients[].redirectUris` | enabled-block example: `["https://client.example.com/callback"]` | [auth](layer-auth.md) |
| `auth.oauth.clients[].grantTypes` | enabled-block example: `["authorization_code","refresh_token"]` | [auth](layer-auth.md) |
| `auth.oauth.clients[].scopes` | enabled-block example: `["offline_access","openid"]` | [auth](layer-auth.md) |
| `auth.oauth.clients[].dpop` | enabled-block example: `"optional"` | [auth](layer-auth.md) |
| `auth.oidc` | default with auth.enabled: `[]` | [auth](layer-auth.md) |
| `auth.oidc[].id` | enabled-block example: `"example-provider"` | [auth](layer-auth.md) |
| `auth.oidc[].issuer` | enabled-block example: `"https://identity.example.com"` | [auth](layer-auth.md) |
| `auth.oidc[].clientId` | enabled-block example: `"example"` | [auth](layer-auth.md) |
| `auth.oidc[].clientSecret.env` | enabled-block example: `"REFERENCE_SECRET"` | [auth](layer-auth.md) |
| `auth.oidc[].redirectUri` | enabled-block example: `"https://app.example.com/oauth/callback"` | [auth](layer-auth.md) |
| `auth.oidc[].scopes` | enabled-block example: `["email","openid","profile"]` | [auth](layer-auth.md) |
| `auth.authorizationResolve` | default with auth.enabled: `null` | [auth](layer-auth.md) |
| `auth.anonymization` | default with auth.enabled: `null` | [auth](layer-auth.md) |
| `notifications.secret.env` | enabled-block example: `"REFERENCE_SECRET"` | [notifications](web-push.md) |
| `notifications.webPush.vapid.subject` | enabled-block example: `"mailto:app@example.com"` | [notifications](web-push.md) |
| `notifications.webPush.vapid.publicKey.env` | enabled-block example: `"REFERENCE_SECRET"` | [notifications](web-push.md) |
| `notifications.webPush.vapid.privateKey.env` | enabled-block example: `"REFERENCE_SECRET"` | [notifications](web-push.md) |
| `notifications.webPush.delivery.concurrencyPerWorker` | enabled-block example: `8` | [notifications](web-push.md) |
| `notifications.webPush.delivery.batchSize` | enabled-block example: `50` | [notifications](web-push.md) |
| `notifications.webPush.delivery.pollIntervalMs` | enabled-block example: `5000` | [notifications](web-push.md) |
| `notifications.webPush.delivery.maximumAttempts` | enabled-block example: `8` | [notifications](web-push.md) |
| `notifications.webPush.delivery.defaultTtlSeconds` | enabled-block example: `3600` | [notifications](web-push.md) |
| `notifications.webPush.delivery.maximumTtlSeconds` | enabled-block example: `86400` | [notifications](web-push.md) |
| `notifications.webPush.allowedOrigins` | enabled-block example: `[]` | [notifications](web-push.md) |
| `sourceDirectory` | default: `"src"` | [sourceDirectory](configuration.md) |
| `publicDirectory` | default: `"public"` | [publicDirectory](configuration.md) |
| `outputDirectory` | default: `"dist"` | [outputDirectory](configuration.md) |
| `deployment.domain` | default: `null` | [deployment](configuration.md) |
| `deployment.serverEntry` | default: `null` | [deployment](configuration.md) |
| `deployment.originPort` | default: `8787` | [deployment](configuration.md) |
| `deployment.dependencies` | default: `{}` | [deployment](configuration.md) |
| `database.embedded.dataDirectory` | default: `null` | [database](database-runtime.md) |
| `database.postgres` | default: `[]` | [database](database-runtime.md) |
| `database.postgres[].name` | enabled-block example: `"primary"` | [database](database-runtime.md) |
| `database.postgres[].role` | enabled-block example: `"primary"` | [database](database-runtime.md) |
| `database.postgres[].host` | enabled-block example: `"database.example.com"` | [database](database-runtime.md) |
| `database.postgres[].port` | enabled-block example: `5432` | [database](database-runtime.md) |
| `database.postgres[].database` | enabled-block example: `"application"` | [database](database-runtime.md) |
| `database.postgres[].username` | enabled-block example: `"application"` | [database](database-runtime.md) |
| `database.postgres[].password.env` | enabled-block example: `"REFERENCE_SECRET"` | [database](database-runtime.md) |
| `database.postgres[].tls.mode` | enabled-block example: `"verify-full"` | [database](database-runtime.md) |
| `database.postgres[].tls.serverName` | enabled-block example: `null` | [database](database-runtime.md) |
| `database.postgres[].tls.caFile` | enabled-block example: `null` | [database](database-runtime.md) |
| `database.schema.file` | default: `"src/server/database.js"` | [database](database-runtime.md) |
| `database.schema.synchronization` | default: `"additive"` | [database](database-runtime.md) |
| `database.replica.maximumLagMs` | default: `2000` | [database](database-runtime.md) |
| `database.pool.maximumConnectionsPerWorker` | default: `5` | [database](database-runtime.md) |
| `database.pool.connectionBudget` | default: `null` | [database](database-runtime.md) |
| `redis.host` | enabled-block example: `"cache.example.com"` | [redis](database-runtime.md) |
| `redis.port` | enabled-block example: `6379` | [redis](database-runtime.md) |
| `redis.username` | enabled-block example: `"application"` | [redis](database-runtime.md) |
| `redis.password.env` | enabled-block example: `"REFERENCE_SECRET"` | [redis](database-runtime.md) |
| `redis.database` | enabled-block example: `0` | [redis](database-runtime.md) |
| `redis.tls.mode` | enabled-block example: `"verify-full"` | [redis](database-runtime.md) |
| `redis.tls.serverName` | enabled-block example: `null` | [redis](database-runtime.md) |
| `redis.tls.caFile` | enabled-block example: `null` | [redis](database-runtime.md) |
| `runtime.workers.minimum` | default: `1` | [runtime](database-runtime.md) |
| `runtime.workers.maximum` | default: `1` | [runtime](database-runtime.md) |
| `security.csp.sources.script-src` | enabled-block example: `[]` | [security](configuration.md) |
| `security.csp.sources.style-src` | enabled-block example: `[]` | [security](configuration.md) |
| `security.csp.sources.connect-src` | enabled-block example: `[]` | [security](configuration.md) |
| `security.csp.sources.img-src` | enabled-block example: `[]` | [security](configuration.md) |
| `security.csp.sources.media-src` | enabled-block example: `[]` | [security](configuration.md) |
| `security.csp.sources.font-src` | enabled-block example: `[]` | [security](configuration.md) |
| `security.csp.sources.frame-src` | enabled-block example: `[]` | [security](configuration.md) |
| `security.csp.sources.child-src` | enabled-block example: `[]` | [security](configuration.md) |
| `security.csp.sources.worker-src` | enabled-block example: `[]` | [security](configuration.md) |
| `security.csp.sources.manifest-src` | enabled-block example: `[]` | [security](configuration.md) |
| `security.permissionsPolicy.camera` | enabled-block example: `[]` | [security](configuration.md) |
| `security.permissionsPolicy.microphone` | enabled-block example: `[]` | [security](configuration.md) |
| `security.permissionsPolicy.geolocation` | enabled-block example: `[]` | [security](configuration.md) |
| `security.permissionsPolicy.payment` | enabled-block example: `[]` | [security](configuration.md) |
| `links.external.mode` | default: `"viewer"` | [links](links-navigation.md) |
| `links.external.allowedOrigins` | default: `[]` | [links](links-navigation.md) |
| `links.scopeExtensions` | default: `[]` | [links](links-navigation.md) |
| `links.associations.android` | default: `[]` | [links](links-navigation.md) |
| `links.associations.android[].packageName` | enabled-block example: `"com.example.app"` | [links](links-navigation.md) |
| `links.associations.android[].sha256CertFingerprints` | enabled-block example: `["AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA"]` | [links](links-navigation.md) |
| `links.associations.apple` | default: `[]` | [links](links-navigation.md) |
| `links.associations.apple[].appId` | enabled-block example: `"ABCDEFGHIJ.com.example.app"` | [links](links-navigation.md) |
| `links.associations.apple[].paths` | enabled-block example: `["/*"]` | [links](links-navigation.md) |
| `links.associations.windows` | default: `[]` | [links](links-navigation.md) |
| `links.associations.windows[].packageFamilyName` | enabled-block example: `"Example.App_123456789abcd"` | [links](links-navigation.md) |
| `links.associations.windows[].paths` | enabled-block example: `["*"]` | [links](links-navigation.md) |
| `links.associations.windows[].excludePaths` | enabled-block example: `[]` | [links](links-navigation.md) |
| `links.associations.web` | default: `[]` | [links](links-navigation.md) |
| `links.associations.web[].appId` | enabled-block example: `"https://related.example.com/app"` | [links](links-navigation.md) |
| `links.associations.web[].scope` | enabled-block example: `"/"` | [links](links-navigation.md) |
| `updates.enabled` | default: `true` | [updates](application-updates.md) |
| `updates.ui` | default: `true` | [updates](application-updates.md) |
| `updates.checkIntervalMs` | default: `300000` | [updates](application-updates.md) |
| `development.host` | default: `"127.0.0.1"` | [development](configuration.md) |
| `development.port` | default: `5173` | [development](configuration.md) |
| `development.https.keyFile` | enabled-block example: `"certificates/key.pem"` | [development](configuration.md) |
| `development.https.certificateFile` | enabled-block example: `"certificates/certificate.pem"` | [development](configuration.md) |
| `development.liveReload` | default: `true` | [development](configuration.md) |
<!-- generated-contract:end -->

## Special fields and failures

- `css.targets` permits chrome, edge, firefox, safari, ios_saf, opera, samsung, android. Values are versions, not Browserslist expressions; names/types/ranges are checked.
- `deployment.dependencies` maps npm names to exact semver; Layer packages are bundled, arbitrary version ranges rejected.
- `auth.authorizationResolve` and `auth.anonymization` are server-only functions or null. See [Auth](layer-auth.md) and [lifecycle](auth-advanced.md) for results/idempotency.
- OAuth clients, OIDC providers and associations identify actual registered applications. Never use demonstration IDs/ENV names as production keys.
- Manifest remains `public/manifest.webmanifest`, not an arbitrary config block. name/icons/theme/start_url/scope/share_target/protocol_handlers are validated separately; see [PWA](pwa-service-worker.md).
- Wrong name/type produces `CLI_CONFIG_INVALID` with file/path and available suggestions; `DATABASE_CLUSTER_REQUIRED` means workers without PostgreSQL; `APPLICATION_DATABASE_REQUIRED` means an application schema in embedded mode. Fix the field instead of disabling auth/TLS.

Application commands: `layer create name`, `layer dev`, `layer build`, `layer doctor`, `layer database schema plan`, `layer database schema apply <checksum> --confirm-data-loss`. Start built dist with `npm start`.

Next: [configuration examples](configuration.md), [CLI](installation-cli.md), [deployment](deployment-diagnostics.md).
