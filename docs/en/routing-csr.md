---
title: Client-side page rendering
description: Client-side page rendering.
audience: intermediate
order: 101
status: documented
updated: 2026-10-31
---

# Client-side page rendering

[Capability map](capabilities.md) · [Complete signatures and types](api-reference-router.md)

## Purpose and example

Use `csr` when page HTML should be built in the browser. In `src/pages/about.layer.js`:

```js
import {html, layerComponentCreate, layerPageCreate} from '@solcorp/layer';

export const page = layerPageCreate({
    render: 'csr',
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

A direct load receives the application shell, then JavaScript creates the page. Expect the heading and link after runtime startup. The mode does not change templates or signals.

## Data and lifecycle

Read user data through [Context API](context-api.md). Place browser side effects in `context.onMount`; release resources through `context.onDestroy`. `csr` itself neither connects an API provider nor replaces capability checks.

Use `auth: 'session'` with a connected identity system to prevent anonymous navigation. Independently set auth/permissions on the server operation. Dynamic path parameters come from the router result; a query string is not verified identity.

## Limits and failures

Without JavaScript, users see only the shell. First interactivity depends on client bundle loading. Offline availability depends on installed resources and stored data; `offline: 'shell'` does not promise a successful API request.

Invalid policies fail at build time; component errors use boundaries. Navigating away does not automatically retain local signals from the old component.

Next: [routing](routing.md), [page options](page-configuration.md), [SSR](routing-ssr.md).
