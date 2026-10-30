---
title: Additional PWA APIs
description: Badging, notifications, background sync, persistent storage and protocols.
audience: intermediate
order: 185
status: release-candidate
updated: 2026-10-28
---

# Additional PWA APIs

Use `window.layer.pwa` after browser runtime startup. A capability reports API availability, not OS permission or guaranteed success. Do not perform browser side effects during SSR.

<!-- contract: pwa -->
## Application badge

<!-- example: application/pwa.mjs -->
```js
/** @param {ReturnType<typeof import('@solcorp/layer-pwa').layerPwaCapabilitiesCreate>} pwa @param {number} unreadCount */
export async function unreadBadgeApply( pwa, unreadCount ){
    //Keeping the in-app counter usable when platform badging is unavailable
    if ( pwa.badge.getCapability().supported === false ){
        return {applied: false, reason: 'unavailable'};

    }

    try {
        //Clearing an empty badge instead of leaving a stale platform indicator
        if ( unreadCount === 0 ){
            await pwa.badge.clear();

        } else {
            await pwa.badge.set( unreadCount );

        }

        return {applied: true};

    } catch ( error ){
        //Handling platform refusal without losing the application's own counter
        let reason = 'platform-refused';
        if ( error instanceof Error && 'code' in error && typeof error.code === 'string' ){
            reason = error.code;

        }
        return {applied: false, reason};

    }

}
```

Call `await unreadBadgeApply(window.layer.pwa, 3)`. `badge.set()` without a count requests a dot; counts are nonnegative safe integers; `clear()` removes the badge. Keep an in-app counter regardless of the platform result.

## Notifications

```js
const pwa = window.layer.pwa;
const permission = await pwa.notifications.requestPermission();
if ( permission === 'granted' ){
    await pwa.notifications.show( 'Message saved', {body: 'Your draft is ready', tag: 'draft-ready'});

}
const visibleNotifications = await pwa.notifications.list( 'draft-ready' );
const closedCount = await pwa.notifications.close( 'draft-ready' );
```

Request permission only from an explicit user action; do not repeatedly prompt after denial. `show` requires permission and a ready Service Worker registration. `list()` without a tag returns notifications for this registration; `close(tag)` requires a nonempty tag and returns the number closed. This is local display, not server delivery: see [Web Push](web-push.md). NotificationOptions, including `badge`, remain platform-dependent.

## Background sync and storage

```js
const pwa = window.layer.pwa;
const syncCapability = await pwa.backgroundSync.getCapability();
if ( syncCapability.supported ){
    await pwa.backgroundSync.register( 'layer-outbox' );

}
const storageCapability = pwa.storage.getCapability();
if ( storageCapability.supported ){
    const alreadyPersistent = await pwa.storage.persisted();
    const persistent = alreadyPersistent || await pwa.storage.persist();
    const estimate = await pwa.storage.estimate();
    console.log( {persistent, usage: estimate.usage, quota: estimate.quota} );

}
```

Registering sync does not execute it immediately; the browser chooses when. Managed outbox also resumes on the next startup/network recovery. A custom tag needs a matching worker handler; register does not create business logic. Persistence can return false. An estimate does not reserve space and quota can change.

## Protocol handlers

```js
const protocols = window.layer.pwa.protocols;
if ( protocols.getCapability().supported ){
    protocols.register( 'web+chat', '/open/?uri=%s' );

}
```

Call register from a user action. `protocols.unregister('web+chat', '/open/?uri=%s')` removes registration where supported. The handler must be a same-origin relative path containing `%s`; a bounded set of standard schemes and letter-only `web+` schemes is allowed. This requests browser integration, not guaranteed default-app selection. Validate incoming uri again; never open an arbitrary query URL. Manifest protocol_handlers and OS associations are separate mechanisms.

## Failure contract

Unavailable methods throw `PWA_CAPABILITY_UNAVAILABLE`; malformed input is rejected before platform calls. Browser permission/platform rejection can still occur after supported=true: handle rejected promises and preserve the main user flow. Do not simulate background execution with an endless timer.

Next: [sharing](sharing.md), [updates](application-updates.md), [browser limitations](browser-support.md).
