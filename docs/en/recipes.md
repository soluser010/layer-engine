---
title: Practical recipes
description: Short verified patterns for common Layer application tasks.
audience: beginner
order: 240
status: documented
updated: 2026-09-24
---

# Practical recipes

## New SSR page

Create src/pages/about.layer.js:

```js
import {
    html,
    layerComponentCreate,
    layerPageCreate
} from '@solcorp/layer';

export const page = layerPageCreate({
    render: 'ssr',
    auth: 'none',
    offline: 'shell',
    cache: 'public',
    metadata: {
        title: 'About'
    }
});

export default layerComponentCreate(function AboutPage(){
    //Rendering a server-safe static page
    return html`<main><h1>About</h1></main>`;

});
```

The file automatically creates /about/. Use src/pages/users/[userId].layer.js for a dynamic segment.

## Scoped and global styles

A styles = css template and *.layer.css receive component scope. *.global.layer.css explicitly applies to the complete document. body/html styles must be global:

```css
:root {
    --page-background: #ffffff;
}

body {
    margin: 0;
    background: var(--page-background);
}
```

Import the global file once from a layout or page entry. Do not try to reach body from a scoped component selector.

## Query with cache fallback

```js
const roomQueryData = context.api.query({
    operation: 'chat.room.read',
    payload: function payloadCreate(){
        //CallBack THE OBJECT
        return {
            roomId: String( properties.roomId )
        };

    },
    cache: {
        policy: 'cache-and-network',
        maxAgeMs: 30000
    },
    offline: {
        fallback: 'cache'
    }
});
```

Never hide AUTH/PERMISSION/VALIDATION errors with cached data; the runtime uses fallback only for offline or retryable transport failures.

## Offline command

```js
const messageSendCommandData = context.api.command({
    operation: 'chat.message.send',
    offline: {
        strategy: 'outbox'
    }
});

const messageSendResultData = await messageSendCommandData.execute({
    roomId: String( properties.roomId ),
    text: String( draftSignal.peek() ),
    baseRevision: Number( roomRevisionSignal.peek() )
});
```

Do not create your own commandId. The generated/context runtime creates it before the durable outbox commit.

## Route navigation

Use an ordinary same-origin link in markup. The router intercepts eligible navigation and preserves a compatible layout:

```html
<a href="/settings/?tab=security#sessions">Security settings</a>
```

For an imperative flow, call window.layer.navigate(url). Do not mutate history in parallel with the router.

## PWA install button

```js
const applicationInstall = async function(){
    //Launching the browser-owned prompt only after a user gesture
    const installResultData = await window.layer.pwa.install.prompt();

    //CallBack THE OBJECT
    return installResultData;

};
```

Never call prompt automatically. The browser may display its own install UI.

## Logout and local data

Revoke the server session first, then call Layer Auth signOut or explicit storagePurge. The runtime stops event streams, clears the worker pointer, and deletes the user-scoped IndexedDB namespace. Do not delete every origin database manually.

## Production copy

```text
npm run build
cd dist
npm run check
npm start
```

Copy only dist. Set LAYER_DOMAIN and secrets on the server, configure DNS/firewall, and use an external supervisor.

## Failure contract

Every recipe uses public application API. Low-level package APIs are for infrastructure authors. If an example differs from the current build declarations, the generated declarations and compiler diagnostic are authoritative for that checkout.

Next: [Operations](operations.md), [PWA](pwa-service-worker.md), [Deployment](deployment-diagnostics.md).
