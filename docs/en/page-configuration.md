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
| `metadata` | `object` | `{}` | Only the string fields below; no secrets. |

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
