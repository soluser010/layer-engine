---
title: PWA, Service Worker, and updates
description: Capabilities, offline cache, background sync, and safe updates.
audience: intermediate
order: 180
status: documented
updated: 2026-09-28
---

# PWA, Service Worker, and updates

Card, progress, buildId and multi-window saving: [application updates](application-updates.md).

Server delivery, VAPID and the durable queue: [Web Push](web-push.md).
Incoming URLs, external viewer and platform associations: [navigation](links-navigation.md).
Sending and receiving text, links and files: [Sharing and Share Target](sharing.md).

## Goal

Check a capability, request installation only after a user action, and apply an update safely.

## Example

Call `installHandle()` from a button handler after the application starts. Do not call it during SSR or automatically when opening the page.

```js
const installHandle = async function(){
    //Checking current availability inside the application's install button handler
    const installCapabilityData = window.layer.pwa.install.getCapability();

    if ( installCapabilityData.availability === 'available' ){
        //Leaving the installation decision to the user and browser
        await window.layer.pwa.install.prompt();

    }

};
```

## Expected result

The browser decides whether an install prompt is available. Layer does not invoke it automatically or suppress native UI without a reason.

## Explanation

One generated Service Worker owns hashed precache, navigation fallback, GET cache, outbox sync, push, and two-phase updates. API/state is not stored in Cache Storage. Non-GET requests and `/_layer/dev/*` pass directly from the document without `respondWith`: long API and development streams cannot pin worker activation, and cancellation stays with the browser. The exact declared Share Target POST route is the exception. Layer applies builds only after an explicit action; minVersion marks criticality without hidden startup activation.

At build time, files under `public/assets` enter the required precache with SHA-256 integrity checks. The limits are 2048 files, 2 MiB per file, and 16 MiB in total. Links, unsafe names, and exceeded limits fail the build instead of publishing an incomplete offline bundle. Other `public` files are not included automatically.

## Common errors

- Expecting a Service Worker on production HTTP; use HTTPS or localhost.
- Caching `/_layer/dev/*`; development endpoints always bypass cache.
- Calling `prompt()` without a user gesture; the browser rejects it.

## Failure contract

An unavailable capability returns an explicit status/reason rather than a fake polyfill. A failed update preserves the active working version. Logout purges user-scoped IndexedDB/cache/subscription state.

Next: [Browser support](browser-support.md), [Offline and realtime](offline-realtime.md).
