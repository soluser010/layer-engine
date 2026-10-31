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
