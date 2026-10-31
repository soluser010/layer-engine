---
title: Полный справочник конфигурации
description: Поля строгого конфига, defaults, отключение подсистем и применение изменений.
audience: advanced
order: 252
status: documented
updated: 2026-10-28
---

# Полный справочник конфигурации

Файл `layer.config.js` экспортирует один ESM object. Неизвестные поля запрещены. Таблица ниже строится из результата действующего `layerConfigValidate`: default означает значение при пропуске поля, «пример включённого блока» — допустимый пример, **не включённую по умолчанию функцию**. Поля элементов массивов обозначены `[]`. Настоящие секреты не читаются; REFERENCE_SECRET — имя демонстрационной ENV-ссылки.

## Отключение, окружение и применение

| Блок | Назначение / отключение | Где действует и когда применяется |
| --- | --- | --- |
| appName, appVersion | Имя обязательно; version — semver. Не secrets | Dev/prod; новая сборка. BuildId вычисляется отдельно |
| sourceDirectory, publicDirectory, outputDirectory | Разные относительные каталоги внутри приложения; отключения нет | Build; dev требует restart |
| css.targets | Минимальные версии движков; default matrix ниже, пустой объект запрещён | CSS compiler в dev/prod; rebuild/restart dev. Не polyfill DOM/PWA |
| deployment | domain:null требует LAYER_DOMAIN; serverEntry:null — static PWA; dependencies:{} — без external runtime deps | Prod build; старт dist. ENV domain имеет приоритет; originPort приватный loopback |
| development | host только loopback; https:false; liveReload:false отключает dev client/endpoints | Только dev; restart, dist не редактируется |
| database.postgres | [] — system-only PGlite, один worker; один primary плюс optional replicas одного cluster | Server; rebuild/restart. Прикладные таблицы требуют внешний PostgreSQL |
| database.embedded | dataDirectory:null — persistent state directory по умолчанию | Server; каталог вне dist. Не переносите работающую БД копированием файлов |
| database.schema | file — прикладная декларация; synchronization: только additive | Server startup; unsafe changes требуют schema plan/apply |
| database.replica, pool | Lag/connection limits; null budget запрещает auto-scale | Server startup; budget общий, pool на worker |
| redis | null отключает; один объект подключения, не массив | Server; сбой переводит в предусмотренный durable fallback |
| runtime.workers | minimum=maximum — fixed; maximum:'auto' требует budget и внешний PostgreSQL | Launcher; rebuild/restart; без внешней БД только 1/1 |
| auth | null отключает. Объект требует enabled:true и secret ENV; registration.mode:'disabled' отключает регистрацию, не вход | Server; rebuild/restart. Уже выданные сессии имеют собственные сроки |
| notifications | null отключает; Web Push требует явный serverEntry, VAPID и secret ENV | Server; rebuild/restart. Генерация ключей отдельная, не при каждой сборке |
| security.csp.sources | {} — базовая политика; дополнительные sources строго по resource directive | Dev/prod headers; rebuild/restart. Не отключайте CSP для исправления embed |
| security.permissionsPolicy | camera/microphone/geolocation/payment: [] запрет, ['self'] свой origin | Headers; rebuild/restart. Политика не выдаёт user permission автоматически |
| links | external.mode:'platform' отключает viewer; allowedOrigins:[] не разрешает iframe; пустые associations не генерируют документы | Build/browser; rebuild, обновление SW |
| updates | enabled:false отключает Layer checks, ui:false только карточку | Browser; rebuild. Нативный lifecycle SW остаётся |

Строковый пароль допустим только в разрешённой локальной разработке; production secrets — `{env: 'NAME'}`. PostgreSQL password:null разрешён только loopback; remote plaintext запрещён. Redis username/password могут быть null для локального сервиса. TLS mode: verify-full (проверка CA/имени), require (TLS без полной проверки), disable только loopback. Для production выбирайте verify-full.

В source config нет горячего применения: после изменения config перезапустите dev; для production пересоберите и разверните bundle. ENV-секреты и LAYER_DOMAIN читаются при запуске уже собранного приложения. Не считайте изменение исходника изменением работающего процесса.

## Значения полей

<!-- generated-contract:start -->
| Поле | Default или пример | Контракт |
| --- | --- | --- |
| `appName` | default: `"reference"` | [appName](configuration.md) |
| `appVersion` | default: `"0.1.0"` | [appVersion](configuration.md) |
| `css.targets.chrome` | default: `"109"` | [css](configuration.md) |
| `css.targets.edge` | default: `"109"` | [css](configuration.md) |
| `css.targets.firefox` | default: `"115"` | [css](configuration.md) |
| `css.targets.safari` | default: `"16.4"` | [css](configuration.md) |
| `css.targets.ios_saf` | default: `"16.4"` | [css](configuration.md) |
| `auth.enabled` | default при auth.enabled: `true` | [auth](layer-auth.md) |
| `auth.secret.env` | default при auth.enabled: `"REFERENCE_SECRET"` | [auth](layer-auth.md) |
| `auth.registration.mode` | default при auth.enabled: `"disabled"` | [auth](layer-auth.md) |
| `auth.identifiers.email` | default при auth.enabled: `true` | [auth](layer-auth.md) |
| `auth.identifiers.username` | default при auth.enabled: `false` | [auth](layer-auth.md) |
| `auth.identifiers.phone` | default при auth.enabled: `false` | [auth](layer-auth.md) |
| `auth.emailVerification.required` | default при auth.enabled: `false` | [auth](layer-auth.md) |
| `auth.emailVerification.lifetimeMs` | default при auth.enabled: `86400000` | [auth](layer-auth.md) |
| `auth.password.minimumLength` | default при auth.enabled: `12` | [auth](layer-auth.md) |
| `auth.password.maximumLength` | default при auth.enabled: `128` | [auth](layer-auth.md) |
| `auth.password.commonPasswordBlocklist` | default при auth.enabled: `true` | [auth](layer-auth.md) |
| `auth.passwordRecovery.enabled` | default при auth.enabled: `false` | [auth](layer-auth.md) |
| `auth.passwordRecovery.lifetimeMs` | default при auth.enabled: `1800000` | [auth](layer-auth.md) |
| `auth.session.idleLifetimeMs` | default при auth.enabled: `1800000` | [auth](layer-auth.md) |
| `auth.session.absoluteLifetimeMs` | default при auth.enabled: `43200000` | [auth](layer-auth.md) |
| `auth.session.rememberIdleLifetimeMs` | default при auth.enabled: `604800000` | [auth](layer-auth.md) |
| `auth.session.rememberAbsoluteLifetimeMs` | default при auth.enabled: `2592000000` | [auth](layer-auth.md) |
| `auth.session.touchIntervalMs` | default при auth.enabled: `300000` | [auth](layer-auth.md) |
| `auth.session.maximumPerUser` | default при auth.enabled: `20` | [auth](layer-auth.md) |
| `auth.session.dataMaximumBytes` | default при auth.enabled: `16384` | [auth](layer-auth.md) |
| `auth.smtp.host` | пример включённого блока: `"mail.example.com"` | [auth](layer-auth.md) |
| `auth.smtp.port` | пример включённого блока: `465` | [auth](layer-auth.md) |
| `auth.smtp.secure` | пример включённого блока: `true` | [auth](layer-auth.md) |
| `auth.smtp.username` | пример включённого блока: `"app"` | [auth](layer-auth.md) |
| `auth.smtp.password.env` | пример включённого блока: `"REFERENCE_SECRET"` | [auth](layer-auth.md) |
| `auth.smtp.from` | пример включённого блока: `"app@example.com"` | [auth](layer-auth.md) |
| `auth.passkey.rpId` | пример включённого блока: `"app.example.com"` | [auth](layer-auth.md) |
| `auth.passkey.rpName` | пример включённого блока: `"Example"` | [auth](layer-auth.md) |
| `auth.passkey.origins` | пример включённого блока: `["https://app.example.com"]` | [auth](layer-auth.md) |
| `auth.passkey.userVerification` | пример включённого блока: `"required"` | [auth](layer-auth.md) |
| `auth.passkey.timeoutMs` | пример включённого блока: `60000` | [auth](layer-auth.md) |
| `auth.totp.issuer` | пример включённого блока: `"Example"` | [auth](layer-auth.md) |
| `auth.totp.algorithm` | пример включённого блока: `"SHA1"` | [auth](layer-auth.md) |
| `auth.totp.digits` | пример включённого блока: `6` | [auth](layer-auth.md) |
| `auth.totp.period` | пример включённого блока: `30` | [auth](layer-auth.md) |
| `auth.totp.window` | пример включённого блока: `1` | [auth](layer-auth.md) |
| `auth.totp.recoveryCodeCount` | пример включённого блока: `10` | [auth](layer-auth.md) |
| `auth.oauth.issuer` | пример включённого блока: `"https://app.example.com"` | [auth](layer-auth.md) |
| `auth.oauth.interactionUrl` | пример включённого блока: `"/authorize"` | [auth](layer-auth.md) |
| `auth.oauth.scopes` | пример включённого блока: `["offline_access","openid"]` | [auth](layer-auth.md) |
| `auth.oauth.clients` | пример включённого блока: `[{"id":"example-client","type":"confidential","secret":{"env":"REFERENCE_SECRET"},"displayName":"Example client","redirectUris":["https://client.example.com/callback"],"grantTypes":["authorization_code","refresh_token"],"scopes":["offline_access","openid"],"dpop":"optional"}]` | [auth](layer-auth.md) |
| `auth.oauth.clients[].id` | пример включённого блока: `"example-client"` | [auth](layer-auth.md) |
| `auth.oauth.clients[].type` | пример включённого блока: `"confidential"` | [auth](layer-auth.md) |
| `auth.oauth.clients[].secret.env` | пример включённого блока: `"REFERENCE_SECRET"` | [auth](layer-auth.md) |
| `auth.oauth.clients[].displayName` | пример включённого блока: `"Example client"` | [auth](layer-auth.md) |
| `auth.oauth.clients[].redirectUris` | пример включённого блока: `["https://client.example.com/callback"]` | [auth](layer-auth.md) |
| `auth.oauth.clients[].grantTypes` | пример включённого блока: `["authorization_code","refresh_token"]` | [auth](layer-auth.md) |
| `auth.oauth.clients[].scopes` | пример включённого блока: `["offline_access","openid"]` | [auth](layer-auth.md) |
| `auth.oauth.clients[].dpop` | пример включённого блока: `"optional"` | [auth](layer-auth.md) |
| `auth.oidc` | default при auth.enabled: `[]` | [auth](layer-auth.md) |
| `auth.oidc[].id` | пример включённого блока: `"example-provider"` | [auth](layer-auth.md) |
| `auth.oidc[].issuer` | пример включённого блока: `"https://identity.example.com"` | [auth](layer-auth.md) |
| `auth.oidc[].clientId` | пример включённого блока: `"example"` | [auth](layer-auth.md) |
| `auth.oidc[].clientSecret.env` | пример включённого блока: `"REFERENCE_SECRET"` | [auth](layer-auth.md) |
| `auth.oidc[].redirectUri` | пример включённого блока: `"https://app.example.com/oauth/callback"` | [auth](layer-auth.md) |
| `auth.oidc[].scopes` | пример включённого блока: `["email","openid","profile"]` | [auth](layer-auth.md) |
| `auth.authorizationResolve` | default при auth.enabled: `null` | [auth](layer-auth.md) |
| `auth.anonymization` | default при auth.enabled: `null` | [auth](layer-auth.md) |
| `notifications.secret.env` | пример включённого блока: `"REFERENCE_SECRET"` | [notifications](web-push.md) |
| `notifications.webPush.vapid.subject` | пример включённого блока: `"mailto:app@example.com"` | [notifications](web-push.md) |
| `notifications.webPush.vapid.publicKey.env` | пример включённого блока: `"REFERENCE_SECRET"` | [notifications](web-push.md) |
| `notifications.webPush.vapid.privateKey.env` | пример включённого блока: `"REFERENCE_SECRET"` | [notifications](web-push.md) |
| `notifications.webPush.delivery.concurrencyPerWorker` | пример включённого блока: `8` | [notifications](web-push.md) |
| `notifications.webPush.delivery.batchSize` | пример включённого блока: `50` | [notifications](web-push.md) |
| `notifications.webPush.delivery.pollIntervalMs` | пример включённого блока: `5000` | [notifications](web-push.md) |
| `notifications.webPush.delivery.maximumAttempts` | пример включённого блока: `8` | [notifications](web-push.md) |
| `notifications.webPush.delivery.defaultTtlSeconds` | пример включённого блока: `3600` | [notifications](web-push.md) |
| `notifications.webPush.delivery.maximumTtlSeconds` | пример включённого блока: `86400` | [notifications](web-push.md) |
| `notifications.webPush.allowedOrigins` | пример включённого блока: `[]` | [notifications](web-push.md) |
| `sourceDirectory` | default: `"src"` | [sourceDirectory](configuration.md) |
| `publicDirectory` | default: `"public"` | [publicDirectory](configuration.md) |
| `outputDirectory` | default: `"dist"` | [outputDirectory](configuration.md) |
| `deployment.domain` | default: `null` | [deployment](configuration.md) |
| `deployment.serverEntry` | default: `null` | [deployment](configuration.md) |
| `deployment.originPort` | default: `8787` | [deployment](configuration.md) |
| `deployment.dependencies` | default: `{}` | [deployment](configuration.md) |
| `database.embedded.dataDirectory` | default: `null` | [database](database-runtime.md) |
| `database.postgres` | default: `[]` | [database](database-runtime.md) |
| `database.postgres[].name` | пример включённого блока: `"primary"` | [database](database-runtime.md) |
| `database.postgres[].role` | пример включённого блока: `"primary"` | [database](database-runtime.md) |
| `database.postgres[].host` | пример включённого блока: `"database.example.com"` | [database](database-runtime.md) |
| `database.postgres[].port` | пример включённого блока: `5432` | [database](database-runtime.md) |
| `database.postgres[].database` | пример включённого блока: `"application"` | [database](database-runtime.md) |
| `database.postgres[].username` | пример включённого блока: `"application"` | [database](database-runtime.md) |
| `database.postgres[].password.env` | пример включённого блока: `"REFERENCE_SECRET"` | [database](database-runtime.md) |
| `database.postgres[].tls.mode` | пример включённого блока: `"verify-full"` | [database](database-runtime.md) |
| `database.postgres[].tls.serverName` | пример включённого блока: `null` | [database](database-runtime.md) |
| `database.postgres[].tls.caFile` | пример включённого блока: `null` | [database](database-runtime.md) |
| `database.schema.file` | default: `"src/server/database.js"` | [database](database-runtime.md) |
| `database.schema.synchronization` | default: `"additive"` | [database](database-runtime.md) |
| `database.replica.maximumLagMs` | default: `2000` | [database](database-runtime.md) |
| `database.pool.maximumConnectionsPerWorker` | default: `5` | [database](database-runtime.md) |
| `database.pool.connectionBudget` | default: `null` | [database](database-runtime.md) |
| `redis.host` | пример включённого блока: `"cache.example.com"` | [redis](database-runtime.md) |
| `redis.port` | пример включённого блока: `6379` | [redis](database-runtime.md) |
| `redis.username` | пример включённого блока: `"application"` | [redis](database-runtime.md) |
| `redis.password.env` | пример включённого блока: `"REFERENCE_SECRET"` | [redis](database-runtime.md) |
| `redis.database` | пример включённого блока: `0` | [redis](database-runtime.md) |
| `redis.tls.mode` | пример включённого блока: `"verify-full"` | [redis](database-runtime.md) |
| `redis.tls.serverName` | пример включённого блока: `null` | [redis](database-runtime.md) |
| `redis.tls.caFile` | пример включённого блока: `null` | [redis](database-runtime.md) |
| `runtime.workers.minimum` | default: `1` | [runtime](database-runtime.md) |
| `runtime.workers.maximum` | default: `1` | [runtime](database-runtime.md) |
| `security.csp.sources.script-src` | пример включённого блока: `[]` | [security](configuration.md) |
| `security.csp.sources.style-src` | пример включённого блока: `[]` | [security](configuration.md) |
| `security.csp.sources.connect-src` | пример включённого блока: `[]` | [security](configuration.md) |
| `security.csp.sources.img-src` | пример включённого блока: `[]` | [security](configuration.md) |
| `security.csp.sources.media-src` | пример включённого блока: `[]` | [security](configuration.md) |
| `security.csp.sources.font-src` | пример включённого блока: `[]` | [security](configuration.md) |
| `security.csp.sources.frame-src` | пример включённого блока: `[]` | [security](configuration.md) |
| `security.csp.sources.child-src` | пример включённого блока: `[]` | [security](configuration.md) |
| `security.csp.sources.worker-src` | пример включённого блока: `[]` | [security](configuration.md) |
| `security.csp.sources.manifest-src` | пример включённого блока: `[]` | [security](configuration.md) |
| `security.permissionsPolicy.camera` | пример включённого блока: `[]` | [security](configuration.md) |
| `security.permissionsPolicy.microphone` | пример включённого блока: `[]` | [security](configuration.md) |
| `security.permissionsPolicy.geolocation` | пример включённого блока: `[]` | [security](configuration.md) |
| `security.permissionsPolicy.payment` | пример включённого блока: `[]` | [security](configuration.md) |
| `links.external.mode` | default: `"viewer"` | [links](links-navigation.md) |
| `links.external.allowedOrigins` | default: `[]` | [links](links-navigation.md) |
| `links.scopeExtensions` | default: `[]` | [links](links-navigation.md) |
| `links.associations.android` | default: `[]` | [links](links-navigation.md) |
| `links.associations.android[].packageName` | пример включённого блока: `"com.example.app"` | [links](links-navigation.md) |
| `links.associations.android[].sha256CertFingerprints` | пример включённого блока: `["AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA"]` | [links](links-navigation.md) |
| `links.associations.apple` | default: `[]` | [links](links-navigation.md) |
| `links.associations.apple[].appId` | пример включённого блока: `"ABCDEFGHIJ.com.example.app"` | [links](links-navigation.md) |
| `links.associations.apple[].paths` | пример включённого блока: `["/*"]` | [links](links-navigation.md) |
| `links.associations.windows` | default: `[]` | [links](links-navigation.md) |
| `links.associations.windows[].packageFamilyName` | пример включённого блока: `"Example.App_123456789abcd"` | [links](links-navigation.md) |
| `links.associations.windows[].paths` | пример включённого блока: `["*"]` | [links](links-navigation.md) |
| `links.associations.windows[].excludePaths` | пример включённого блока: `[]` | [links](links-navigation.md) |
| `links.associations.web` | default: `[]` | [links](links-navigation.md) |
| `links.associations.web[].appId` | пример включённого блока: `"https://related.example.com/app"` | [links](links-navigation.md) |
| `links.associations.web[].scope` | пример включённого блока: `"/"` | [links](links-navigation.md) |
| `updates.enabled` | default: `true` | [updates](application-updates.md) |
| `updates.ui` | default: `true` | [updates](application-updates.md) |
| `updates.checkIntervalMs` | default: `300000` | [updates](application-updates.md) |
| `development.host` | default: `"127.0.0.1"` | [development](configuration.md) |
| `development.port` | default: `5173` | [development](configuration.md) |
| `development.https.keyFile` | пример включённого блока: `"certificates/key.pem"` | [development](configuration.md) |
| `development.https.certificateFile` | пример включённого блока: `"certificates/certificate.pem"` | [development](configuration.md) |
| `development.liveReload` | default: `true` | [development](configuration.md) |
<!-- generated-contract:end -->

## Особые поля и ошибки

- `css.targets` допускает chrome, edge, firefox, safari, ios_saf, opera, samsung, android; значение — версия, а не Browserslist-выражение. Название/тип/диапазон проверяются.
- `deployment.dependencies` — map имя npm-пакета → точная semver; Layer-пакеты bundle-ятся, произвольные version ranges запрещены.
- `auth.authorizationResolve` и `auth.anonymization` — server-only функции либо null; обязательные результаты/идемпотентность описаны в [Auth](layer-auth.md) и [lifecycle](auth-advanced.md).
- Массивы OAuth clients, OIDC providers и associations — конкретные зарегистрированные идентичности. Демонстрационные IDs/ENV из таблицы нельзя использовать как production keys.
- Manifest остаётся отдельным `public/manifest.webmanifest`, не произвольным вложенным блоком config: name/icons/theme/start_url/scope/share_target/protocol_handlers валидируются в [PWA](pwa-service-worker.md).
- Ошибка имени/типа — `CLI_CONFIG_INVALID` с file/path и доступными suggestions; `DATABASE_CLUSTER_REQUIRED` — workers без PostgreSQL; `APPLICATION_DATABASE_REQUIRED` — прикладная schema в embedded. Не отключайте auth/TLS вместо исправления конкретного поля.

Команды приложения: `layer create name`, `layer dev`, `layer build`, `layer doctor`, `layer database schema plan`, `layer database schema apply <checksum> --confirm-data-loss`; запуск готового dist — `npm start`.

Далее: [конфигурация с примерами](configuration.md), [CLI](installation-cli.md), [deployment](deployment-diagnostics.md).
