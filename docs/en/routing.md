---
title: Routing — capabilities and rendering choices
description: Routing — capabilities and rendering choices.
audience: intermediate
order: 99
status: documented
updated: 2026-10-31
---

# Routing — capabilities and rendering choices

[Capability map](capabilities.md) · [Complete signatures and types](api-reference-router.md)

## Choose a task

| Task | Solution | Details |
| --- | --- | --- |
| Public static page with HTML before JavaScript starts | `render: 'ssr'`, static path | [Prerender and hydration](routing-ssr.md) |
| UI depending on browser APIs and the current user | `render: 'csr'` | [Client rendering](routing-csr.md) |
| Configure page access, metadata and preload | `export const page = layerPageCreate({...})` | [All page options](page-configuration.md) |
| Accelerate repeated data reads | Query cache, optionally server cache | [Caching](caching.md) |
| Incoming URLs, query/hash and external viewer | `window.layer.navigate` and links API | [Links and navigation](links-navigation.md) |

`ssr` and `csr` are the two accepted `render` values. Standard `ssr` creates HTML **at build time**, not personalized HTML for every request. ISR, streaming SSR and selective hydration are not page switches in this version. Do not add invented `render: 'isr'`, `revalidate` or `keepAlive` options.

## Files and URLs

| File | Route |
| --- | --- |
| `src/pages/index.layer.js` | `/` |
| `src/pages/about.layer.js` | `/about` |
| `src/pages/chats/[roomId].layer.js` | `/chats/:roomId` |
| `src/pages/files/[...segments].layer.js` | `/files/*segments` |

Pathname selects the route; query and hash remain in the address but do not create another file route. Static segments take priority over dynamic segments. Avoid ambiguous routes with identical patterns and differently named parameters.

## Navigate

```js
const chatOpen = async function(){
    //Preserving query and hash while navigating through the application router
    const navigationResult = await window.layer.navigate( '/chats/room-1?tab=files#latest' );

    //Handling a rejected navigation without forcing a document reload
    if ( navigationResult.status !== 'ready' ){
        console.info( navigationResult.status );

    }

};
```

Invoke the handler after startup, for example from a button. Ordinary internal `<a href="/about">` links also use the router. Explicit targets, including `_self`, downloads and modified clicks preserve browser behavior.

## Execution order

Route matching → offline check → identity → permissions → guard → preload → page installation. A newer navigation prevents an obsolete result from being applied. A layout may retain the outer shell; this does not promise preservation of every local variable in an unmounted page. Keep durable drafts in a store/IndexedDB.

`src/app.js` can export `identityGet`, `onlineGet`, `guardRun`, `preload`. Managed Auth supplies the default identity, but custom guard/preload runners are not created automatically. See [page options](page-configuration.md).

## Errors and security boundaries

A result may contain `not-found`, `offline`, `auth-required`, `forbidden`, `redirect` or `superseded` instead of `ready`. Declaring guard/preload without a runner causes `ROUTE_GUARD_UNAVAILABLE` / `ROUTE_PRELOAD_UNAVAILABLE`.

A browser guard controls navigation; it **does not protect static HTML or API access**. Never put secrets into build-generated markup. Server operations authorize data independently of the page.

Next: [page reference](page-configuration.md), [components](components.md), [operations](operations.md).

## Layout

Create `src/layouts/application.layer.js` and set the page to `layout: 'application'`. A layout must contain exactly one outlet. Catch-all `[...segments]` is allowed only as the final segment and captures a nonempty path remainder.

```js
import {html, layerComponentCreate} from '@solcorp/layer';

export default layerComponentCreate(function ApplicationLayout(){
    //Keeping the shared navigation outside the route-owned outlet
    return html`
        <div>
            <nav><a href="/">Home</a></nav>
            <section data-layer-layout-outlet></section>
        </div>
    `;

});
```

## Experimental screen warmup

Choose the policy on the destination page first. [Choosing a page warmup policy](page-configuration.md#choosing-a-page-warmup-policy).

An ordinary page only needs an internal link such as `<a href="/about/">About</a>`. After 250 ms of continuous visibility, Layer prepares CSS, the module and safe elements for the destination. A visible tab processes one background task at a time after startup. Setup, access checks and data requests run when the user navigates. The current screen stays interactive while the destination gets ready.

**Where the styles come from.** When the Service Worker controls the page and the current build's offline cache contains the CSS, the browser reads the file from that cache. The tab prepares the page and layout stylesheets in advance while the current screen keeps its own styles. On click, the router reuses those same sheets. If the CSS is still loading, the router waits and switches the screen and its styles together. A cache miss may require a network request. Use preload or `onBeforeScreenOpen` for API data required to open a screen.

Inside `ul`, `ol`, `select`, `option`, ARIA lists and nested areas that actually scroll vertically, navigation prepares the destination on demand. A short `overflow-y: auto` container whose contents fit still allows warmup. An explicit `target="_self"` keeps native browser navigation.

For a chat, set `warmup: 'on-demand'` on the page. This example assigns the required first response to `props.messages` before showing the page. Register `chat.messages.list` on the server and declare the page's `messages` property. The hook also runs on return. If loading fails or the hook exceeds 15 seconds, the previous screen stays visible. Pass `signal` to cancel the request on superseding navigation.

```js
// src/pages/chats/[chatId].layer.js
import {layerPageCreate} from '@solcorp/layer';

export const page = layerPageCreate({
    render: 'csr',
    warmup: 'on-demand'
});

export const properties = {
    messages: {type: 'array', required: true}
};
```

```js
// src/app.js
export function props({route}){
    //Supply the chat page with its declared input before loading messages.
    if (route.path === '/chats/:chatId/') {
        return {messages: []};
    }
    return {};
}

export async function onBeforeScreenOpen({route, params, props, signal}){
    //Keep the current page interactive until the selected conversation is ready.
    if (route.path === '/chats/:chatId/') {
        const response = await window.layer.query('chat.messages.list', {chatId: params.chatId}, {signal});
        props.messages = response.data;
    }
}
```

### What `onBeforeScreenOpen` receives

Export this hook from `src/app.js` if a screen needs data before it opens. It also runs with `warmup: 'off'` and with global warmup disabled. It runs on actual navigation after route checks. Returning a promise delays display until it settles successfully.

| Argument | How to use it |
| --- | --- |
| `route` | Route definition. Compare `route.path` with a pattern such as `/chats/:chatId/` to fetch messages only for chat routes. |
| `params` | Route segment values. For `/chats/42/`, `params.chatId` is the string `'42'`. |
| `url` | Full destination URL as a string. Read query parameters with `new URL(url).searchParams`. |
| `props` | Component inputs. Assign results to a declared property on this object before display. |
| `preload` | Results already fetched, keyed by operation name. Reuse a preload result when it contains the data you need. |
| `restored` | `true` when an instance already exists for this destination. Background preparation alone leaves it `false`. |
| `signal` | Pass it to the request. Another navigation cancels the wait, and the hook itself has a 15-second deadline. |

Set `warmup: 'off'` in `layerPageCreate` for payments or one-time links. To turn off observation, background preparation and instance retention throughout an app, rebuild it with this configuration.

```js
// layer.config.js
export default {
    appName: 'messenger',
    navigation: {warmup: {enabled: false}}
};
```

On return, Layer checks access and reloads preload data and props. The tab retains its draft, DOM and scroll position. Keys account for identity, tenant, permissions, route and query. Pause custom timers, media and subscriptions in `context.onDeactivate`, resume in `context.onActivate`, and release them in `context.onDestroy`. The experiment keeps instances in tab RAM until the security context is cleared or the application closes, without a count limit. `window.layer.navigationDiagnostics()` reports `active`, `saved`, `prepared`, `unopened`, `queued`, `hits`, `backgroundHits`, `cancellations` and `clickToReadyMs`.

With custom authentication, return stable `userId`, `tenantId` and `permissions` from `identityGet()`. Call `window.layer.storagePurge()` on logout. Managed authentication performs this cleanup automatically. Permissions are rechecked on navigation and when the tab returns to the foreground.
