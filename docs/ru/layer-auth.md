---
title: Layer Auth
description: Headless identities, sessions, MFA, OAuth 2.1 и OIDC.
audience: intermediate
order: 150
status: documented
updated: 2026-09-24
---

# Layer Auth

## Цель

Подключить headless-систему идентификации, сессий и многофакторной защиты, сохранив контроль приложения над страницами входа, регистрации, согласия и управления аккаунтом.

Layer хранит credential-данные, выдаёт opaque-сессии, проверяет CSRF, роли и permissions. Приложение самостоятельно рисует интерфейс и хранит прикладной профиль пользователя в собственных таблицах.

## Минимальная конфигурация

Layer Auth отключён по умолчанию. Для password sign-in включите его в `layer.config.js` и передайте секрет только через ENV:

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

`LAYER_AUTH_SECRET` должен содержать не менее 32 символов. Не коммитьте его и не помещайте в browser bundle.

## Серверный runtime

Создайте Auth один раз на worker, сначала зарегистрируйте прикладные операции, затем системные операции Auth до `registry.seal()` и передайте extension в operation executor:

```js
const authRuntime = context.auth.create({
    allowedOrigins: ['https://app.example.com'],
    oauthInteractionHandler
});

applicationOperationsRegister(operationRegistry);
authRuntime.register(operationRegistry);
```

Проверенная identity доступна обработчику через `context.auth`. Не берите `userId`, tenant, роли или permissions из payload.

Порядок регистрации важен для встроенного OAuth: каждый нестандартный scope, например `profile.read`, обязан совпадать хотя бы с одним permission зарегистрированной прикладной операции. Неизвестный scope останавливает запуск с `AUTH_OAUTH_SCOPE_UNREGISTERED`.

```js
const profileIdentifierData = context.auth.requireUser();
context.auth.requirePermission('profile.write');

const sessionData = context.auth.session;
const customSessionData = await context.auth.session.data.get();
```

Произвольные session data создаются только доверенным серверным кодом, имеют ограничение размера и не могут перезаписывать зарезервированные identity-поля.

## Регистрация и приглашения

Доступные режимы:

- `disabled` — регистрация отсутствует;
- `open` — публичная регистрация;
- `invite` — публичная операция принимает только действующий одноразовый invitation token;
- `admin-only` — аккаунты создаёт только доверенный серверный код.

Приглашение выдаётся сервером. Raw token возвращается один раз, а в базе хранится только HMAC-индекс:

```js
const invitationData = await authRuntime.service.invitations.issue({
    email: 'developer@example.com',
    roles: ['editor'],
    expiresAt: Date.now() + 86400000,
    createdBy: context.auth.requireUser()
});
```

Для `admin-only` используйте server-only facade:

```js
const accountData = await authRuntime.service.registration.createManaged({
    identifier: 'developer@example.com',
    password: 'a-long-application-password'
});
```

В браузере открытая регистрация или регистрация по приглашению выглядит так:

```js
await window.layer.auth.registration.create({
    identifier: 'developer@example.com',
    password: 'a-long-application-password',
    invitationToken
});
```

## Вход, состояние и сессии

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

Пароль никогда не попадает в offline outbox. Opaque session cookie имеет `Secure`, `HttpOnly`, `SameSite=Lax`; изменяющие POST требуют связанный CSRF token. `signOut()` очищает пользовательское IndexedDB-состояние даже если серверная сессия уже истекла.

### Неактивность и максимальный срок

`idleLifetimeMs` — скользящий срок неактивности, `absoluteLifetimeMs` — неизменный предел от момента входа. При `remember: true` используются `rememberIdleLifetimeMs` и `rememberAbsoluteLifetimeMs`. Например, 7/30 дней означает: ежедневная активность сохраняет вход после седьмого дня, но через 30 дней потребуется новая авторизация.

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

Активностью считается запрос с cookie-сессией, прошедший проверку Origin, срока сессии, CSRF и permissions операции. Layer обновляет `last_seen_at`, `idle_expires_at` и `expires_at` в системной БД; новая дата не превышает `absolute_expires_at`. Запись выполняется не чаще `touchIntervalMs` (по умолчанию 5 минут); интервал дополнительно ограничен половиной исходного idle-срока. Поэтому время последней активности и граница неактивности учитываются с точностью до этого интервала. Приложению не требуется собственный таймер продления.

Фоновый авторизованный API-запрос также считается активностью. Само отображение страницы, offline-работа, анонимные запросы и входящие SSE-события/heartbeat не продлевают сессию; открытие или переподключение авторизованного потока проходит обычную проверку. Не отправляйте искусственный heartbeat только ради бесконечного сохранения входа.

Политика сохраняется при выдаче сессии. Изменение конфигурации действует на новые входы, не переписывая сроки существующих сессий. Cookie живёт до абсолютного предела; выпускать новую cookie при каждом продлении не нужно. При отказе БД запрос завершается ошибкой, а при истечении или отзыве — `AUTH_REQUIRED`; кэш Redis не может восстановить такую сессию. SQL-блокировка и проверки срока защищают конкурентные обращения workers, включая истечение срока во время ожидания блокировки.

**Обновление старой установки:** миграция 9 добавляет `idle_lifetime_ms` и выводит исходный интервал старых managed-сессий из `idle_expires_at - last_seen_at`. Она не меняет даты истечения, статус или custom session data. Живые сессии начинают продлеваться при следующих проверенных запросах; уже истёкшим или отозванным нужен новый вход. После обновления фреймворка пересоберите приложение и разверните новый bundle; редактирование только конфига старого bundle не исправляет прежнюю ошибку продления.

Для нестандартной серверной интеграции `layerAuthServerRuntimeCreate` требует `sessions.touch(token, touchIntervalMs)` с durable-проверкой и результатом `boolean`; отсутствие метода останавливает запуск. Низкоуровневый `layerAuthenticationCreate` поддерживает необязательный `sessionTouch(token)` после проверок и до выдачи security context. Не вызывайте `touch` из непроверенного обработчика или до проверки CSRF. Штатный runtime подключает его автоматически.

## Email verification и recovery

Для обязательной проверки email или восстановления пароля настройте SMTP:

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

Browser facade предоставляет `emailVerification.request(identifier)`, `emailVerification.confirm(token)`, `passwordRecovery.request(identifier)` и `passwordRecovery.complete({token, password})`. Запросы отвечают одинаково для существующих и неизвестных аккаунтов, чтобы не раскрывать наличие пользователя.

## Passkey, TOTP и recovery codes

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
    displayName: 'Рабочий ноутбук'
});

await window.layer.auth.signIn.passkey({remember: true});

const enrollmentData = await window.layer.auth.totp.enrollment.begin();
const confirmationData = await window.layer.auth.totp.enrollment.confirm('123456');

await window.layer.auth.mfa.verify({
    challenge: stagedChallenge,
    code: '123456'
});
```

Recovery codes показываются только при выдаче или ротации. В базе находятся только защищённые представления; каждый код одноразовый.

## Внешний OIDC

External provider использует Authorization Code, PKCE, state и nonce. Первый вход создаёт аккаунт только при `registration.mode: 'open'` и verified email. Layer не связывает существующий аккаунт только по совпавшему email.

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

`oidc.redirect()` объединяет begin и явный переход. Upstream tokens шифруются и никогда не отправляются в браузер.

## Встроенный OAuth 2.1 и OpenID Connect provider

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

Provider публикует discovery, authorization, token, revoke и introspection endpoints. Public clients обязаны использовать Authorization Code + PKCE. Confidential clients могут использовать Client Credentials с ENV-backed secret. Access и refresh tokens opaque; refresh rotation обнаруживает повторное использование. DPoP проверяет подписанный proof и привязку ключа.

Страница `interactionUrl` принадлежит приложению: она выполняет вход, показывает consent и передаёт результат в `oauthInteractionHandler`. Не рендерьте произвольные redirect URI и не принимайте client/scopes из непроверенного DOM.

Access token с обязательным DPoP используется для прикладного API так:

```http
POST /api HTTP/1.1
Authorization: DPoP opaque-access-token
DPoP: signed-proof-jwt
Content-Type: application/json
```

Resource proof подписывается тем же P-256 ключом, который привязан при выдаче token. Его `htm` равен `POST`, `htu` — абсолютному URL `/api`, а `ath` — SHA-256 access token. Layer проверяет подпись, thumbprint, возраст proof и атомарно отклоняет повторный `jti`.

## Роли, permissions и lifecycle аккаунта

Глобальные роли управляются через trusted server facade. При назначении и отзыве роли authorization cache инвалидируется немедленно. Операции приложения всё равно объявляют нужные permissions в registry.

Disable аккаунта отзывает сессии, API keys, OAuth grants/tokens и внешние связи. Anonymize удаляет credential-связи и заменяет идентификаторы, не разрушая прикладные ссылки. Эти действия должны выполняться только привилегированной server operation и записываться в audit trail.

## Ожидаемый результат

Приложение получает готовые безопасные примитивы, но сохраняет собственную верстку и маршруты. Identity всегда определяется сервером; credential-команды выполняются только online; секреты, хэши и adapter-объекты не входят в browser API.

При включённом Layer Auth router по умолчанию использует `window.layer.auth.state.get()` для `auth: 'session'` и permission guards. IndexedDB получает отдельное пространство `auth:<userId>`. Приложение может явно переопределить эти решения экспортами `identityGet` и `storageNamespaceGet`.

## Типовые ошибки

- `AUTH_CONFIGURATION_INVALID` — неизвестное поле, короткий secret или несовместимые настройки; используйте path и suggestions из details.
- `AUTH_INVITATION_INVALID` — invitation token истёк, уже использован или привязан к другому email.
- `AUTH_REQUIRED` — отсутствует действующая managed session.
- `CSRF_INVALID` — изменяющий browser POST не содержит связанный CSRF token.
- `AUTH_CREDENTIALS_INVALID` — единая ошибка для неизвестного identifier и неверного password.
- `AUTH_MFA_REQUIRED` — вход создан как staged challenge и требует `mfa.verify()`.
- `AUTH_EMAIL_VERIFICATION_REQUIRED` — аккаунт ещё не подтвердил email.
- `AUTH_OIDC_INVALID` или `AUTH_OAUTH_INVALID_REQUEST` — callback, state, nonce, client, redirect URI, PKCE или protocol request не прошли проверку.
- Passkey на HTTP origin вне loopback — WebAuthn требует secure context.

## Failure contract

Публичная ошибка содержит стабильный `code`, безопасное сообщение, `requestId`, `retryable` и ограниченные `details`. Stack, cause, password, token, SMTP/OIDC/OAuth secret и credential hash наружу не сериализуются. Rate limiting применяется к регистрации, входу, recovery, MFA и OAuth endpoints. Ошибка Redis переводит runtime на PostgreSQL-backed fallback; источник истины не теряется.

Далее: [Безопасность](security-auth.md), [Context API](context-api.md), [Database runtime](database-runtime.md), [PWA и Service Worker](pwa-service-worker.md).
