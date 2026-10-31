---
title: Routing, layouts, SSR, and hydration
description: File routes, metadata, layouts, and first-render modes.
audience: intermediate
order: 100
status: documented
updated: 2026-09-24
---

# Routing, layouts, SSR, and hydration

## Goal

Create a file route with metadata, a layout, and a predictable render mode.

## Example

```js
import {layerPageCreate} from '@solcorp/layer';

export const page = layerPageCreate({
    layout: 'application',
    render: 'ssr',
    auth: 'session',
    preload: ['chat.rooms.list'],
    offline: 'shell',
    cache: 'private',
    metadata: {
        title: 'Messages'
    }
});
```

`src/pages/chats/[roomId].layer.js` creates the dynamic `/chats/:roomId` route.

## Expected result

The server returns HTML with hydration markers. The client binds existing nodes and updates only dependent bindings; it does not rebuild the complete DOM.

## Explanation

The layout owns the outer shell and the page owns the route region. If a marker is incompatible, the runtime performs controlled recovery and records a safe diagnostic.

## Common errors

- A browser-only side effect in SSR component setup.
- An unstable key in a repeated list.
- Expecting API data during build-time SSR; transport is deliberately unavailable there.

## Failure contract

A guard may return redirect/forbidden before render. A hydration mismatch does not execute server HTML as code and does not expose a stack trace to the user.

Next: [Operations and Context API](context-api.md), [Offline and realtime](offline-realtime.md).
