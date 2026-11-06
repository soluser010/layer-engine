---
title: Complete page configuration
description: layerPageCreate, defaults, metadata and limitations.
audience: intermediate
order: 102
status: documented
updated: 2026-10-31
---

# Complete page configuration

[Capability map](capabilities.md) · [Complete signatures and types](api-reference-router.md)

The `page` object is static and read by the compiler without executing arbitrary JavaScript. Unknown fields and unsupported values fail with `ROUTE_MANIFEST_INVALID`. The factory returns an immutable top-level object; it does not connect a router itself. Complete examples: [SSR](routing-ssr.md), [CSR](routing-csr.md).

## All options

| Field | Type / values | Default | Effect |
| --- | --- | --- | --- |
| `render` | `'ssr' / 'csr'` | `ssr` | Static URL prerender at build time or browser DOM creation. |
| `layout` | `string / null` | `inherited / null` | Name matching `[a-z][a-z0-9-]{0,79}`. Outer shell with one outlet. |
| `auth` | `'session' / 'none'` | `session` | Router authenticated check; not protection for published HTML. |
| `permissions` | `string[]` | `[]` | Unique dotted names; all must occur in identity.permissions. |
| `preload` | `string[]` | `[]` | Unique operation names; executed sequentially through the application runner. |
| `guard` | `string / null` | `null` | Dotted name; invoked through guardRun after permissions. |
| `offline` | `'deny' / 'shell' / 'snapshot' / 'local'` | `deny` | deny blocks offline navigation. Others allow it to continue; snapshots/local data are not created automatically. |
| `cache` | `'private' / 'public' / 'no-store'` | `private` | Metadata in the current pipeline: does not switch HTTP headers, SW behavior or DOM retention. |
| `warmup` | `auto / on-demand / off` | `auto` | Prepare on visibility, prepare on navigation, or exclude from preparation and retention. |
| `metadata` | `object` | `{}` | Only the string fields below; no secrets. |

## Choosing a page warmup policy

In the `*.layer.js` file, set `warmup` in the **named `page` export**. It applies to the whole page, including its child components. The default export defines what the page displays. Here is a complete public About page.

```js
// src/pages/about.layer.js
import {html, layerComponentCreate, layerPageCreate} from '@solcorp/layer';


export const page = layerPageCreate({
    render: 'ssr',
    auth: 'none',
    warmup: 'auto'
});

export default layerComponentCreate(function AboutPage(){
    //Render the public screen when the router opens it.
    return html`<main><h1>About</h1></main>`;

});
```

Change one field in `layerPageCreate` to select a different policy. Configure the **destination page**: to control opening a chat from a list, set the policy in the chat page file.

| `warmup` value | While the link is visible | On first navigation | On return in the same tab |
| --- | --- | --- | --- |
| `'auto'` (default) | An eligible link enters the queue after 250 ms of continuous visibility. Layer prepares resources and static elements. | Reuses the prepared parts and finishes the rest on navigation. Useful for main menu destinations. | Can restore the instance, local state and scroll position. |
| `'on-demand'` | Seeing the link starts no work. | Selecting a chat or calling `navigate()` starts preparation. Add an application hook to wait for the first messages. | The instance can be restored just as with `'auto'`. |
| `'off'` | No background preparation. | Creates the screen on opening. Useful for a checkout or a single-use form. | Leaving releases the instance. Opening it again creates a fresh one. |

**Example choices.** Keep `warmup: 'auto'` on an overview page linked from the main menu. Use `warmup: 'on-demand'` on a chat route if even a standalone link from the home screen should wait for the user to select it. Use `warmup: 'off'` on checkout if returning should start with a fresh form instance. Always verify payment status on the server.

**Why a visible link may wait for a click.** With `'auto'`, links in HTML and ARIA lists or in a nested container that actually scrolls vertically are prepared on demand. An ordinary `overflow-y: auto` container whose contents fit still allows background preparation. An explicit `target="_self"` delegates navigation to the browser.

**Application settings.** In `layer.config.js`, `navigation.warmup.enabled` defaults to `true`. Set it to `false` and rebuild to disable the queue and instance retention for every page, including pages with explicit `'auto'`. The data preparation hook still runs on opening. The separate `render` option selects SSR/CSR. Setting `cache: 'no-store'` alone does not release a page instance.

Retention uses the current tab's memory and requires a compatible access context. Reloading the document creates a new instance. Use [IndexedDB](indexeddb.md) for drafts that must survive an app restart. [Chat example, before-open hook and diagnostics](routing.md#experimental-screen-warmup).

## Metadata

| Metadata field | Maximum characters |
| --- | --- |
| `title` | 200 |
| `description` | 500 |
| `robots` | 200 |
| `canonical` | 2048 |
| `author` | 200 |
| `keywords` | 500 |
| `themeColor` | 100 |
| `colorScheme` | 100 |
| `applicationName` | 200 |
| `language` | 35 |
| `direction` | 4 |
| `openGraphTitle` | 200 |
| `openGraphDescription` | 500 |
| `openGraphType` | 100 |
| `openGraphUrl` | 2048 |
| `openGraphImage` | 2048 |
| `openGraphImageAlt` | 500 |
| `openGraphSiteName` | 200 |
| `openGraphLocale` | 35 |
| `twitterCard` | 30 |
| `twitterTitle` | 200 |
| `twitterDescription` | 500 |
| `twitterImage` | 2048 |
| `twitterImageAlt` | 500 |

All values are nonempty strings without C0/DEL characters. At most 24 fields. URL fields `canonical`, `openGraphUrl`, `openGraphImage`, `twitterImage`: HTTP(S) or root-relative paths, not `//host`. `direction`: `auto`, `ltr`, `rtl`; `twitterCard`: `app`, `player`, `summary`, `summary_large_image`; `language`: a language tag such as `en-US`. Values affect the document, not the PWA manifest.

## Connecting guard and preload

In `src/app.js`, declare `guardRun(name, {route, params, identity})` returning exactly `true` to allow navigation. `false`/an object produce `forbidden`; a string becomes the rejection status. A `{redirect: ...}` object does not navigate; the application implements any redirect. The server must independently authorize data. `preload(operationName, {params})` returns a value or Promise; the page receives it through `context.route.preload[operationName]`. This does not automatically populate query cache. Explicitly map params to the operation payload. A declared feature without its runner fails rather than being skipped.

## Compatibility

Do not treat `null` as a universal disable switch: layout uses `??` inheritance, so `null` does not clear an inherited layout. Select an explicit layout or a route structure without inheritance. Rebuild after changing options.

Next: [overview](routing.md), [caching](caching.md).
