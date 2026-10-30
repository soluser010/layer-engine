---
title: Browser support
description: Browser matrix and capability fallbacks, including Safari policy.
audience: all
order: 210
status: release-candidate
updated: 2026-10-27
---

# Browser support

## Goal

Design an application around capabilities rather than assuming identical PWA APIs in every browser.

## Selecting application capabilities

| Capability | Developer approach |
| --- | --- |
| Installation, push, background sync, badging | Check each API capability and provide a fallback. |
| On-screen keyboard and viewport | Use the viewport API; exact geometry is not available in every browser. |
| Safari on iPhone/iPad | Account for differences between a tab and an installed PWA; support remains best effort. |

## Example

```js
const pushState = await window.layer.pwa.push.getCapability();

if (pushState.availability === 'available') {
    //Call only from a user action; the server must have Web Push enabled
    await window.layer.pwa.push.enable();
} else {
    notificationsFallbackShow(pushState.reason);
}
```

## Expected result

Unavailable install UI, push, background sync, badging, file/protocol handlers, and viewport features receive an explicit fallback.

Server integration and VAPID are covered in [Web Push](web-push.md). API availability alone does not mean the user granted notification permission or that the system will deliver notifications immediately.

## Explanation

Rely on availability of the individual feature rather than only the browser name. Full certification of every Safari device and mode combination is not claimed. If your audience uses iOS, verify key application workflows on target devices.

## Common errors

- User-agent sniffing instead of a capability check.
- Promising background sync when the browser may terminate the worker.
- Trying to normalize install UX with a fake polyfill.

## Failure contract

The capability API always returns availability and a reason. The application must provide UX for unavailable, denied, and dismissed states.

Next: [PWA](pwa-service-worker.md), [Viewport and keyboard](viewport.md).
