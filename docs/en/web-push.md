---
title: Server Web Push
description: VAPID, user devices, transactional SQL delivery and Redis wakeups.
audience: intermediate
order: 185
status: documented
updated: 2026-10-31
---

# Server Web Push

[Capability map](capabilities.md) · [Complete signatures and types](api-reference-notifications.md)

## Goal

Send notifications to authenticated user devices, even when the application tab is closed. Layer owns the queue and sender; the browser's push service performs final delivery. This is not realtime, email, SMS or an in-app inbox.

## Preparation and configuration

You need serverEntry, HTTPS/localhost, verified sessions/bearer identities and system storage. PostgreSQL supports multiple workers; PGlite supports one. Redis is optional.

```bash
layer notifications vapid generate
```

The command explicitly prints a **secret private key**. Do not retain output in CI logs/Git. Generate the pair once and retain it. Separately create a random LAYER_NOTIFICATIONS_SECRET with at least 32 characters. It encrypts the queue: losing/replacing it makes existing records unreadable. Keys are not generated/rotated automatically, including in development.

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

Set ENV before starting the process through your shell or supervisor. `.env.example` is only a sample: the launcher does not automatically load `.env`. For a local check from `dist`, run `node --env-file=.env _layer/deployment/run.mjs`. Keep secrets out of Git with restricted permissions. `notifications: null` disables the subsystem.

## Server operations

Inside layerServerCreate(context), before seal:

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

This extends the [server runtime](server-runtime.md), not a separate HTTP server. The managed launcher starts delivery after migrations/readiness and stops it before closing storage. Do not start the managed instance yourself.

| Operation | Type | Payload / result |
| --- | --- | --- |
| notifications.webpush.configuration | query | {} → {publicKey} |
| notifications.webpush.subscription.register | command | {subscription: pushSubscription.toJSON()} → {subscriptionId} |
| notifications.webpush.subscription.revoke | command | {subscriptionId} or {endpoint} → {revoked} |

Wire names are lowercase to satisfy the protocol; the JS property is webPush. auth: authenticated selects bearer when Authorization is present, otherwise session with CSRF/Origin checks. Anonymous, API-key and server-to-server OAuth identities are not user devices.

## Browser API and expected result

```js
const notificationsEnableHandle = async function(){
    //Call from a user action, never automatically during startup
    const result = await window.layer.pwa.push.enable();
    console.log( result.subscriptionId );

}

const notificationsDisableHandle = async function(){
    //Removing this device subscription after an explicit user action
    await window.layer.pwa.push.disable();

}
```

The browser requests permission, creates a subscription and registers it online. enable/disable never use the offline outbox. Low-level subscribe/getSubscription/permissionState/unsubscribe remain available; unsubscribe alone does not revoke the server record. After denial, offer browser settings instead of repeatedly prompting.

Auth logout revokes the credential; delivery checks it immediately before sending and local purge unsubscribes the endpoint. Account switching rebinds the endpoint but prevents old queued messages from reaching the new identity. Enable again after signing in when session/token expires.

## Server sends

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

In transactional commands, notifications participate in the same SQL transaction: rollback cancels them and command replay does not rerun the handler. {notificationId, status: queued} means queued, **not displayed**. Trusted business logic selects recipient IDs after permission checks; there is no generic public send operation.

Server jobs use context.notifications.scope({tenantId}).webPush.send(...), explicitly setting tenant (null for non-tenant applications). This starts a separate transaction. Standalone runtimes using other identity providers must receive server-only identityActive(identity) with revocation/expiry checks. Built-in validation supports Layer system sessions/OAuth records and rejects unknown credentials.

`notification.badge` is an optional monochrome status-bar image for supporting Android browsers. Use a 96×96 PNG with a transparent background and an opaque silhouette. `icon` remains the larger notification image. The server accepts only same-origin paths; the Service Worker validates the origin and passes the badge to `showNotification`. Existing payloads without a badge keep their behavior; the OS and browser control the final appearance. See [Notification.badge](https://developer.mozilla.org/en-US/docs/Web/API/Notification/badge).

## Queue and Redis

Migration 008 creates sys_push_subscriptions, sys_push_notifications, sys_push_deliveries in the application schema. Endpoint/keys/payload are encrypted, lookup/dedup identifiers HMAC-indexed. Redis publishes wakeups after commit only; SQL polling always runs. Redis failure does not lose tasks. Payload/subscriptions never enter Redis.

Leases last 30 seconds; claims are bounded by per-worker concurrency. HTTP delivery has a 10-second deadline and 16-KiB response cap. 404/410 revoke the binding; network/429/5xx retry with backoff/jitter and TTL/attempt bounds; other 4xx are terminal. Redirects are forbidden. Cleanup is bounded, retaining history for seven days after expiration.

Limits: 100 users/send, 10 devices/user, title 160/body 500 characters, compact payload approximately 3 KiB, TTL ≤86400 seconds. URL/icon/badge must be same-origin paths; HTML is unsupported. `notification.tag` replaces a visible notification; optional `topic` in send options replaces pending messages at the provider (1–32 characters from `A–Z`, `a–z`, `0–9`, `_`, `-`). This is not SQL deduplication: `deduplicationKey` remains required. Never put secrets/sensitive content on a lock screen.

SSRF protection permits standard FCM/Mozilla/Apple/Windows providers, HTTPS:443, public DNS pinned to its verified address and normal TLS checks. Add other trusted providers through server-only webPush.allowedOrigins: ['https://push.example.com']; private IPs, redirects and TLS bypass remain forbidden.

await context.notifications.diagnostics() returns pending, oldestMs, running, coordination (sql/redis+sql), without personal data.

## Common errors and failure contract

- notifications with serverEntry: null: CLI_CONFIG_INVALID with path.
- Missing ENV/invalid VAPID pair: NOTIFICATIONS_SECRET_UNAVAILABLE, startup closes.
- Invalid payload/config: NOTIFICATIONS_INVALID with safe path.
- Device limit: NOTIFICATIONS_SUBSCRIPTION_LIMIT (429).
- Missing user identity: AUTH_REQUIRED.
- Missing capability/permission: PWA_CAPABILITY_UNAVAILABLE / PWA_PUSH_PERMISSION_DENIED.
- Offline/API faults propagate to the caller; temporary SQL/provider faults retain queued work.

Delivery is at least once, not exactly once. The SW retains dedup IDs in IndexedDB (256/24 hours), displays plain text and focuses/opens same-origin URLs on click. Logout cannot recall notifications already accepted by the push service. A browser crash between dedup claim and display may miss display: Push API offers no transactional display receipt.

Before enabling push in your application, check a user-triggered permission request, delivery with the window closed, notification navigation, expired subscriptions and sign-out. Permission denial is a normal path: keep the application usable without notifications. Actual delivery depends on the browser, OS and network.

A notification click hands its URL to an open Layer page within the app origin/scope through an acknowledged worker message, then uses the SPA router. A route guard refusal never forces reload. Legacy/unresponsive windows retain bounded native fallback; details and first-click behavior: [links and navigation](links-navigation.md#first-click-and-notification-navigation).

Standards: [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030), [VAPID](https://www.rfc-editor.org/rfc/rfc8292), [web-push](https://github.com/web-push-libs/web-push).

Next: [PWA](pwa-service-worker.md), [Layer Auth](layer-auth.md), [deployment](deployment-diagnostics.md).
