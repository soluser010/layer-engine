---
title: Build-time prerender and hydration
description: Build-time prerender and hydration.
audience: intermediate
order: 100
status: documented
updated: 2026-10-31
---

# Build-time prerender and hydration

[Capability map](capabilities.md) · [Complete signatures and types](api-reference-router.md)

## Purpose

Create public HTML for a static route before client JavaScript loads. Alternatives: [routing](routing.md); complete contract: [page options](page-configuration.md).

## Complete example

Create `src/pages/about.layer.js`:

```js
import {html, layerComponentCreate, layerPageCreate} from '@solcorp/layer';

export const page = layerPageCreate({
    render: 'ssr',
    auth: 'none',
    offline: 'shell',
    metadata: {
        title: 'About the application'
    }
});

export default layerComponentCreate(function AboutPage(){
    //Rendering public content without browser or private server dependencies
    return html`
        <main>
            <h1>About the application</h1>
            <a href="/">Home</a>
        </main>
    `;

});
```

Run `npm run build`. Page HTML appears in `dist/about/index.html`. A direct visit to `/about` receives that document; the client attaches bindings to compatible markup. Incompatible markers may trigger a controlled remount.

## What runs and when

| Stage | Behavior |
| --- | --- |
| Build | Synchronous renderer runs without a user session or browser APIs |
| HTTP request | Host serves prepared HTML; this mode does not enable request-time SSR |
| Hydration | Browser connects interactivity to existing nodes |
| Signal change | Dependent DOM bindings update |
| SPA navigation | Router installs the target page instead of downloading a new document |

Routes containing `:parameter` or a wildcard are skipped by this pass. `/chats/[roomId]` does not promise prerendered HTML for every roomId; it uses the shell and client rendering. There is no dynamic URL enumeration option for prerender here.

A layout with `data-layer-layout-outlet` participates in static rendering. Browser lifecycle, API transport and IndexedDB cannot supply user data at build time. `preload` belongs to client navigation and does not turn the build into a personalized server request.

## Security and failures

`auth: 'session'` does not protect a published HTML file. Load private values through protected operations after session checks. `cache: 'private'` is not data protection: see [caching](caching.md).

Component errors or a missing unique layout outlet fail the build with `CLI_BUILD_SSR_FAILED`. Do not rely on random values, current time or browser dimensions producing identical build and hydration markup.

Next: [CSR](routing-csr.md), [complete page configuration](page-configuration.md).
