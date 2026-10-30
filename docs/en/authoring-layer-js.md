---
title: Authoring *.layer.js
description: Component syntax, generated operations, CSS matrix, and live reload.
audience: intermediate
order: 70
status: release-candidate
updated: 2026-09-24
---

# Authoring `*.layer.js`

## CSS build pipeline

Every build, including dev/live reload, first applies Layer scoping, CSS Modules and local asset handling. Lightning CSS then processes emitted stylesheets, framework shell styles and `.css` files from `public`: it adds required prefixes, lowers supported syntax for `css.targets`, and minifies the result. CSS Module class names are not renamed again; custom properties and cascade order are preserved.

For example, nested `& > .label`, static `color-mix()` and media ranges such as `(width >= 600px)` can become flat selectors, computed colors and `min-width` when targets require it. Syntax may remain modern when all configured targets support it. Minification shortens whitespace/values and combines compatible rules and shorthands; it does not heuristically remove potentially used application classes.

BuildId, integrity and Service Worker hashes use the final CSS bytes. `public/assets/*.css` offline hashes match the optimized files; other public CSS enters integrity without automatically becoming mandatory offline cache. Sources are not rewritten. Remote CSS loaded by the browser through links or `@import` is not fetched or optimized by the build.

`CLI_BUILD_CSS_INVALID` includes a safe file path and available line/column. Component coordinates refer to the intermediate combined stylesheet, while public CSS coordinates refer to its source file. Full CSS source maps back to `.layer.js` are not generated. A failed subsequent build preserves the previous `dist` and uses the existing dev error overlay. Public CSS limits are 2 MiB per file, 16 MiB total; discovery allows at most 10000 entries and does not traverse symlinks.

See [css.targets](configuration.md#css-browser-targets) for configuration and compatibility limits. Processing uses [Lightning CSS transpilation](https://lightningcss.dev/transpilation.html) and [minification](https://lightningcss.dev/minification.html), without arbitrary PostCSS plugins or runtime polyfills.

This page documents the implemented generated operation facade, CSS matrix, and local VS Code extension. No npm publication or stable release was performed.

## Generated operation facade

Operations are declared once in `src/operations.js`. The CLI parses this module through AST and never imports it during a build.

```js
import {layerOperationContractsCreate} from '@solcorp/layer';

export const operations = layerOperationContractsCreate([
    {
        name: 'chat.messages.list',
        type: 'query',
        auth: 'session',
        permissions: ['chat.read'],
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['conversationId'],
            properties: {
                conversationId: {
                    type: 'string'
                }
            }
        },
        outputSchema: {
            type: 'array',
            items: {
                type: 'string'
            }
        }
    }
]);
```

Components import schema-derived wrappers:

```js
import {chatMessagesListQueryCreate} from '#layer/operations';

export default layerComponentCreate(function ChatPage(properties, context) {
    const messagesQuery = chatMessagesListQueryCreate(context, {
        payload: {
            conversationId: properties.conversationId
        }
    });

    return html`<output>${messagesQuery.status}</output>`;
});
```

The wrapper calls the same `context.api`; it does not create a second transport. Command `commandId` is engine-owned and omitted from the author input type. A server imports the same `operations` value and adds only handlers/authorization.

The build emits `operations.mjs`, `operations.d.mts`, and private `operations.json` under `dist/_layer`. Ajv compiles both schemas during the build. Dynamic expressions, handlers, spreads, prototype keys, duplicate names, and generated export collisions fail closed.

## CSS matrix

| Source | Class map | Component scope |
|---|---:|---:|
| `css\`...\`` | no | yes |
| `*.layer.css` | yes | yes |
| `*.layer.module.css` | yes | yes |
| `*.module.css` | yes | no, compatibility mode |
| `*.global.layer.css` | empty | no |

```js
import {html, layerComponentCreate} from '@solcorp/layer';
import styles from './MessageCard.layer.css';
import './application.global.layer.css';

export default layerComponentCreate(function MessageCard() {
    return html`
        <article class=${styles.card}>...</article>
    `;
});
```

The compiler parses CSS with PostCSS, produces a stable module suffix, applies `data-layer-scope`, records source ranges, and extracts CSS into the route asset. Relative `url(...)` files must stay under `src`, are limited to 10 MiB, receive a content hash, and are copied into `dist/_layer/assets`. Executable, external, protocol-relative, data, blob, and file URLs fail closed.

`dist/_layer/styles.json` maps routes/layouts to CSS assets. Production Caddy keeps declarations and build metadata private while serving content-addressed assets with immutable caching. Runtime style injection and `unsafe-inline` are not required.

## VS Code

The local package is `artifacts/layer-engine-vscode-0.2.0.vsix`. Run `Developer: Reload Window` after installation.

`*.layer.js` remains JavaScript, preserving the built-in TypeScript/JavaScript language service. TextMate injection maps `html\`...\`` to HTML, `css\`...\`` to CSS, and `${...}` back to JavaScript. The HTML service provides tags, standard and ARIA attributes; the CSS service provides selectors, properties, values, and custom properties. Hover exposes reference documentation, and embedded validation runs while the document changes.

Layer completion items appear only inside the matching template: `@click=${handler}`, `.value=${value}`, `?disabled=${condition}`, `l-model`, `ref`, `when`, `repeat`, `:global(...)`, and a scoped CSS rule. Inside `${...}`, the embedded provider yields to native JavaScript IntelliSense.

When `:`, `:g`, or `:global` is entered, CSS completion replaces the entire unfinished token, so the result always contains one `:global(selector)` construct and never the invalid `::global`. In JavaScript context, hover `layerPageCreate`, `layerComponentCreate`, `html`, `css`, `when`, `repeat`, or a reactive API: the generated `.d.ts` explains the purpose, parameter shape, secure defaults, failure contract, and a short example. Compiled components also document props, callbacks, slots, `mount`, `hydrate`, `renderToString`, and controller lifecycle; the generated operation facade explains query/command/sync options, reactive state, cancel/settled/dispose, and conflict fields. Package/generated declarations supply this information while the extension keeps the built-in JavaScript language service in control.

The extension includes component/page/query/command/event file snippets, file icons, `Layer: Validate current component`, and `Layer: Show compiled output`. Its 1 MiB bounded scanner never executes application source and handles incomplete templates, escapes, and nested template literals.

```text
npm run ide:test
npm run ide:package
```

Marketplace publication is not performed.

## Dev live reload

`layer dev` watches `src` and `public`, coalesces rapid events, and runs one complete atomic build without overlapping compilers. `development.liveReload` defaults to `true`.

```js
export default {
    development: {
        host: '127.0.0.1',
        port: 5173,
        https: false,
        liveReload: true
    }
};
```

After a successful build, an internal GET SSE stream publishes the new revision and an external same-origin dev client calls `location.reload()`. The client is injected only into document navigation responses and is absent from `dist`; background Service Worker precache requests receive the original integrity-matching shell. The active worker is neither disabled nor unregistered: an acknowledged same-origin message enables network bypass only for the current development worker lifetime.

A later build failure keeps the last working `dist` and does not reload the page. The browser shows a bounded text-only code/message overlay; fixing the source produces the next build and a normal reload. `liveReload: false` disables the client and its internal endpoints. WebSocket/WSS is not used.

If `deployment.serverEntry` is configured, `layer dev` imports the generated
`dist/_layer/server/application.mjs`, calls `layerServerCreate` with
`environment: 'development'` and the loopback `trustedProxy` contract, and starts
it on `deployment.originPort`. The dev host streams `/api` and `/health/*`
through the same browser origin, including POST SSE responses. A server bundle
change restarts that lifecycle before a new live-reload revision is announced.

Static routes declared with `render: 'ssr'` receive build-time HTML documents.
The page and optional layout are rendered through their generated
`renderToString` entries; the document receives `data-layer-ssr`, external route
styles, and the complete validated metadata model. Dynamic/CSR navigation falls
back to `_layer/shell.html` rather than the root route document. Build-time SSR
does not execute query, command, or sync transport: query handles expose a
deterministic no-data snapshot so a component can render its declared fallback,
while mutations fail. Component setup must therefore be server-safe.

Route metadata supports title/description/robots/canonical, language/direction,
standard named metadata, Open Graph, and Twitter cards. URL fields are limited to
HTTP(S) or root-relative values. Client navigation updates the same model and
removes stale Layer-managed tags.

The diagnostics bridge invokes the project's local compiler without executing application modules. New projects include a `jsconfig.json`, the `#layer/operations` package import, and generated operation/CSS declarations. `checkJs` is off by default and may be enabled after application JSDoc contracts are ready.
