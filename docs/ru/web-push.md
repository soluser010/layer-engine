---
title: Серверный Web Push
description: VAPID, устройства пользователя, transactional SQL-очередь и Redis wakeups.
audience: intermediate
order: 185
status: release-candidate
updated: 2026-10-06
---

# Серверный Web Push

## Цель

Отправлять уведомления устройствам авторизованного пользователя, в том числе при закрытой вкладке. Layer управляет очередью и sender; конечную доставку выполняет push service браузера. Это не realtime, email, SMS или in-app inbox.

## Подготовка и конфигурация

Нужны serverEntry, HTTPS/localhost, проверенные sessions/bearer и системная БД. PostgreSQL поддерживает несколько workers; PGlite — один. Redis необязателен.

```bash
layer notifications vapid generate
```

Команда явно печатает **секретный private key**. Не сохраняйте вывод в CI logs/Git. Пару генерируют один раз и сохраняют. Дополнительно создайте случайный LAYER_NOTIFICATIONS_SECRET длиной минимум 32 символа. Он шифрует queue: потеря/замена секрета делает существующие записи нечитаемыми. Автогенерации/ротации нет, включая dev.

```js
export default {
    deployment: {serverEntry: 'server/index.js'},
    notifications: {
        secret: {env: 'LAYER_NOTIFICATIONS_SECRET'},
        webPush: {
            vapid: {
                subject: 'mailto:notifications@example.com',
                publicKey: {env: 'LAYER_PUSH_PUBLIC_KEY'},
                privateKey: {env: 'LAYER_PUSH_PRIVATE_KEY'}
            },
            delivery: {
                concurrencyPerWorker: 8,
                batchSize: 50,
                pollIntervalMs: 5000,
                maximumAttempts: 8,
                defaultTtlSeconds: 3600,
                maximumTtlSeconds: 86400
            }
        }
    }
};
```

ENV задаются до запуска процесса через shell или supervisor. `.env.example` — только образец: launcher не загружает `.env` автоматически. Для локальной проверки из `dist` можно вызвать `node --env-file=.env _layer/deployment/run.mjs`. Храните секреты вне Git с ограниченными правами. `notifications: null` выключает подсистему.

## Server operations

В layerServerCreate(context), перед seal:

```js
//Register before sealing the operation registry
context.notifications.register(operationRegistry);

const executor = layerOperationExecutorCreate({
    operationRegistry,
    security,
    rateLimiter: context.rateLimiter,
    diagnostics,
    database: context.databaseRuntime,
    databaseSchema: context.databaseSchema,
    notifications: context.notifications.executor
});
```

Это дополнение к [server runtime](server-runtime.md), а не второй HTTP-сервер. Managed launcher запускает delivery после migrations/readiness и останавливает перед закрытием БД. Managed instance не нужно запускать вручную.

| Operation | Тип | Payload / результат |
| --- | --- | --- |
| notifications.webpush.configuration | query | {} → {publicKey} |
| notifications.webpush.subscription.register | command | {subscription: pushSubscription.toJSON()} → {subscriptionId} |
| notifications.webpush.subscription.revoke | command | {subscriptionId} либо {endpoint} → {revoked} |

Wire names lowercase согласно протоколу; JS property — webPush. auth: authenticated выбирает bearer при наличии Authorization, иначе session с CSRF/Origin checks. Anonymous, API key и server-to-server OAuth identities не принимаются как устройства пользователя.

## Browser API и ожидаемый результат

```js
async function notificationsEnableHandle(){
    //Call from a user action, never automatically during startup
    const result = await window.layer.pwa.push.enable();
    console.log(result.subscriptionId);
}

async function notificationsDisableHandle(){
    await window.layer.pwa.push.disable();
}
```

Браузер запросит permission, создаст subscription и зарегистрирует online. enable/disable не используют offline outbox. Низкоуровневые subscribe/getSubscription/permissionState/unsubscribe сохранены; unsubscribe сам по себе не отзывает серверную запись. После отказа не повторяйте prompt: предложите настройки браузера.

Logout Auth отзывает credential; delivery проверяет его непосредственно перед отправкой, локальный purge unsubscribes endpoint. Смена аккаунта перепривязывает endpoint, но старые queued messages не доставляются новой identity. После истечения сессии/token нужно enable после нового входа.

## Отправка на сервере

```js
await context.notifications.webPush.send({
    recipients: {users: [message.recipientId]},
    notification: {
        title: 'New message',
        body: 'Open the application to read it.',
        url: `/chats/${message.chatId}`,
        icon: '/assets/icon-192.png',
        badge: '/assets/badge-96.png',
        tag: `chat-${message.chatId}`
    },
    ttlSeconds: 3600,
    urgency: 'normal',
    deduplicationKey: `message-${message.id}`
});
```

В transactional command уведомление записывается в ту же SQL-транзакцию: rollback отменяет его, command replay не повторяет handler. Ответ {notificationId, status: queued} означает очередь, **не показ пользователю**. Recipient IDs выбирает доверенная бизнес-логика с проверкой permissions; публичной generic send операции нет.

Server jobs используют context.notifications.scope({tenantId}).webPush.send(...), явно задавая tenant (null для приложения без tenant). Это отдельная транзакция. Standalone runtime с другим identity provider должен получить server-only identityActive(identity), проверяющий отзыв/expiry. Встроенная проверка знает Layer system sessions/OAuth records; неизвестный credential отклоняется.

`notification.badge` — необязательный адрес монохромного значка для строки состояния поддерживающих браузеров Android. Рекомендуется PNG 96×96 с прозрачным фоном и непрозрачным силуэтом. `icon` сохраняется для крупного изображения уведомления. Сервер проверяет same-origin path, Service Worker проверяет origin и передаёт badge в `showNotification`. Старые payload без badge сохраняют прежнее поведение; ОС и браузер определяют фактический вид уведомления. Подробнее: [Notification.badge](https://developer.mozilla.org/en-US/docs/Web/API/Notification/badge).

## Очередь и Redis

Миграция 008: sys_push_subscriptions, sys_push_notifications, sys_push_deliveries в schema приложения. Endpoint/keys/payload зашифрованы, lookup/dedup IDs HMAC-indexed. Redis передаёт только wakeup после commit; SQL polling работает всегда. Redis failure не теряет задания. Payload/subscriptions в Redis не сохраняются.

Leases 30 секунд; claims ограничены concurrency worker. HTTP delivery deadline 10 секунд, response cap 16 KiB. 404/410 отзывают привязку; network/429/5xx повторяются с backoff/jitter и TTL/attempt bounds; другие 4xx terminal. Redirects запрещены. Cleanup bounded, история семь дней после expiration.

Лимиты: 100 users/send, 10 devices/user, title 160/body 500 символов, compact payload около 3 KiB, TTL ≤86400 секунд. URL/icon/badge — same-origin paths, HTML запрещён. `notification.tag` заменяет видимое уведомление; optional `topic` в параметрах send заменяет ещё не доставленные сообщения у провайдера (1–32 символа `A–Z`, `a–z`, `0–9`, `_`, `-`). Это не SQL-дедупликация: для неё обязателен `deduplicationKey`. Не отправляйте секреты/чувствительный текст на lock screen.

SSRF: стандартные FCM/Mozilla/Apple/Windows providers, HTTPS:443, public DNS, закреплённый адрес и обычная TLS-проверка. Другой доверенный provider можно добавить server-only webPush.allowedOrigins: ['https://push.example.com']; private IP/redirect/TLS bypass остаются запрещены.

await context.notifications.diagnostics() → pending, oldestMs, running, coordination (sql/redis+sql), без персональных данных.

## Типовые ошибки и failure contract

- notifications с serverEntry: null: CLI_CONFIG_INVALID с path.
- Нет ENV/неверная VAPID-пара: NOTIFICATIONS_SECRET_UNAVAILABLE, startup закрыт.
- Неверный payload/config: NOTIFICATIONS_INVALID с безопасным path.
- Лимит устройств: NOTIFICATIONS_SUBSCRIPTION_LIMIT (429).
- Нет user identity: AUTH_REQUIRED.
- Нет capability/permission: PWA_CAPABILITY_UNAVAILABLE / PWA_PUSH_PERMISSION_DENIED.
- Offline/API failure передаётся caller; очередь сохраняется при временной SQL/provider ошибке.

Гарантия at least once, не exactly once. SW хранит dedup IDs в IndexedDB (256/24 часа), показывает plain text, click фокусирует/открывает same-origin страницу. Уже принятое push service уведомление logout не отменит. Browser crash между dedup claim и display может пропустить отображение: Push API не имеет transactional display receipt.

Перед включением push в приложении проверьте запрос разрешения по действию пользователя, доставку при закрытом окне, переход по уведомлению, истёкшую подписку и выход из аккаунта. Отказ в разрешении — обычный сценарий: сохраните работоспособность приложения без уведомлений. Фактическая доставка зависит от браузера, ОС и сети.

Клик по уведомлению передаёт URL открытой Layer-странице своего origin/scope через подтверждаемый worker handoff, затем используется SPA-router. Отказ route guard не вызывает принудительный reload. Для старых/неответивших окон остаётся ограниченный нативный fallback; подробности и поведение первого клика: [ссылки и навигация](links-navigation.md#первый-клик-и-переход-из-уведомления).

Стандарты: [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030), [VAPID](https://www.rfc-editor.org/rfc/rfc8292), [web-push](https://github.com/web-push-libs/web-push).

Далее: [PWA](pwa-service-worker.md), [Layer Auth](layer-auth.md), [deployment](deployment-diagnostics.md).
