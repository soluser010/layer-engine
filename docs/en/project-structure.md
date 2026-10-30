---
title: Project structure
description: Source directories, public assets, server code, and generated dist.
audience: beginner
order: 40
status: release-candidate
updated: 2026-09-24
---

# Project Structure

## Goal

Understand where application code lives and which directories are build-owned.

## Example

```text
apps/messenger-demo/
    layer.config.js
    package.json
    jsconfig.json
    public/
        index.html
        manifest.webmanifest
    src/
        app.js
        components/
        layouts/
        pages/
        operations.js
        server/
            database.js
            index.js
            operations.js
            services/
    test/
    dist/
```

`src/pages` creates file routes, `layouts` provides shared shells, `components` contains reusable units, and `server` is the trusted backend. `public` contains GET resources. `dist` is generated and must not be edited.

## File responsibilities

| Path | Responsibility |
| --- | --- |
| layer.config.js | strict development/database/runtime/deployment mode |
| src/app.js | bootstrap/router hooks, shared context, and boundary |
| src/pages | one file route per page component |
| src/layouts | persistent shell with one layout outlet |
| src/components | reusable UI components |
| src/operations.js | static browser/server operation contracts without handlers |
| src/server/operations.js | handlers, authorize, and server-only metadata |
| src/server/database.js | declarative application schema |
| src/server/index.js | optional layerServerCreate lifecycle |
| public | shell, manifest, icons, and direct GET assets |
| test | application-owned Node/browser tests |
| dist | atomic generated production bundle |

Keep page-only style/logic near the page. Extract a component only when it has a real reuse boundary. Browser components never import server modules.

## Generated dist

dist contains index/route documents, hashed JS/CSS/assets, manifest, layer-service-worker.js, and private _layer metadata/runtime. A full-stack build adds bundled application.mjs; package.json, package-lock.json, Caddyfile, and run.mjs make the directory portable.

Source maps, generated declarations, and build metadata are not publicly served by Caddy. Cache Storage contains only allowed GET assets; API/state belongs in IndexedDB.

## Expected result

Application imports remain under `src`; the browser never receives the server entry, secrets, or raw SQL.

## Explanation

Operation contracts live in `src/operations.js` so the compiler can create a browser facade and server registry from one source. The application schema lives in `src/server/database.js`.

## Common errors

- Editing `dist`: the next atomic build replaces it.
- Importing a server file from a component: the browser bundle fails its boundary check.
- Creating an app outside `apps`: `layer create` rejects it.

## Failure contract

Traversal, symlink escapes, and unknown configuration fields are rejected before reading or writing an external path.

Next: [Configuration](configuration.md), [Components](components.md), [Routing](routing-ssr.md).
