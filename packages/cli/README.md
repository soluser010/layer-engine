# @solcorp/layer-cli

**Part of [Layer-Engine](https://www.npmjs.com/package/@solcorp/layer), a JavaScript framework for full PWA applications.** Project creation, development, build, diagnostics and the local handbook.

Start with `npm install @solcorp/layer`; this module is installed automatically. You do not need to assemble the framework package by package.

[Quick start](https://github.com/soluser010/layer-engine/blob/main/README.md#quick-start) · [API guide EN](https://github.com/soluser010/layer-engine/blob/main/docs/en/installation-cli.md) · [Документация RU](https://github.com/soluser010/layer-engine/blob/main/docs/ru/installation-cli.md) · [Source](https://github.com/soluser010/layer-engine/tree/main/packages/cli)

Часть фреймворка **Layer-Engine**. Для разработки приложения установите основной пакет `@solcorp/layer`; этот модуль входит в его зависимости. Ссылки выше ведут к назначению, API, примерам и ограничениям модуля.

The ESM-only Layer-Engine project CLI for Node.js 24.

## Installation

This package implements the `layer` binary. Install `@solcorp/layer` for the complete supported framework, including this CLI and its authoring runtime. For the current unpublished source workspace, install the user-level command once from the repository root:

```text
npm install --cache .npm-cache
npm run cli:install
layer --version
```

This creates an npm link to the workspace package; it does not publish anything. After a future public release, `npm install --global @solcorp/layer@<version>` will provide the same command contract.

```text
layer create messenger --dry-run
layer create messenger
layer create "Team Messenger"
layer build --dry-run
layer build
layer dev
layer doctor
layer inspect
layer docs
```

`create` accepts only an application name and optional `--dry-run`. The CLI always owns the destination as `./apps/<normalized-name>` relative to the current directory. ASCII Latin case is lowered and groups of spaces or hyphens become one hyphen. Cyrillic, path separators, punctuation, a leading number, a trailing hyphen, names longer than 80 characters, unknown flags, and the legacy `--name` option fail before filesystem writes.

`create` refuses non-empty targets and supports a side-effect-free plan. Its PWA-ready scaffold includes a strict `manifest.webmanifest` and an installable maskable SVG icon. `build` compiles every page under `src/pages`, statically extracts `export const route`, links `<script>` and local imports into executable browser ESM, emits linked source maps and separate scoped CSS assets, creates the deterministic route manifest, copies `public`, records SHA-256 integrity metadata, and generates `_layer/API.md`. Static routes declared with `render: 'ssr'` also receive route-owned production HTML with component/layout markup, hydration markers, external CSS links, and route metadata. Dynamic routes and CSR fallbacks use the clean `_layer/shell.html`, so they never inherit another route's SSR content. Each route names both its module and CSS asset, so the production `style-src 'self'` policy does not require inline style injection. The loopback development host additionally permits inline styles for local visual tooling while continuing to block inline scripts. Component modules export `component`, `definition`, `css`, `mount`, `hydrate`, `renderToString`, and all non-conflicting author exports. The WASM bundler has no native postinstall and works with the repository's `npm ci --ignore-scripts` supply-chain policy.

Canonical `*.layer.js` builds also emit a `*.d.mts` declaration beside every hashed route module and source-mirrored declarations below `_layer/types`. These contracts infer required/defaulted props, `on<Event>` payload callbacks, and named slots from static compiler data. Declarations are recorded in build integrity, excluded from Service Worker precache, and denied by the generated production Caddyfile because they are developer metadata rather than browser assets.

A page may select a lowercase named layout through `layerPageCreate({layout: 'application'})`. The build resolves it only from `src/layouts/application.layer.js`, compiles a separate hashed module/CSS/declaration set, and records `_layer/layouts.json`. A layout must omit page metadata and contain exactly one always-present `data-layer-layout-outlet`; missing, duplicate, conditional, or symlinked layout files fail closed. Compatible route transitions preserve the active layout controller and DOM identity while replacing only the page mounted inside the outlet. Layout declarations stay private, layout chunks use immutable production caching, and the unhashed manifest uses `no-cache`.

The build also emits `_layer/application.mjs`, `_layer/version.json`, and one root `layer-service-worker.js`. The external bootstrap selects file routes, applies guards/preload hooks from `src/app.js`, loads route CSS, mounts or hydrates the component, resets the viewport to the route scroll position after every successful render (`0, 0` by default), handles same-origin navigation, registers the worker after the first successful render, and publishes the frozen `window.layer` facade. The facade exposes `query`, durable `command`, `sync`, `events.subscribe`, capability-first `pwa`, `storageReady`, `storagePurge`, `navigate`, `currentGet`, and `dispose`. Commands commit to the IndexedDB outbox before optimistic UI or POST transport and return live command handles. Every durable command registers a Background Sync fallback when supported; startup and the browser `online` event still drain the outbox when that capability is unavailable. The generated Service Worker claims leased commands directly from the current user database and uses the same strict `POST /api` protocol. Retryable worker results reject the sync event so the browser can schedule another attempt. `storagePurge()` stops event streams, removes the worker database pointer and deletes the complete user namespace for logout. Event subscriptions share the POST Fetch Stream through durable cursors and Web Locks/BroadcastChannel coordination. The version manifest contains browser-compatible SHA-256 hashes for the offline shell and mandatory runtime assets; source maps and generated developer documentation are not forced into the offline install.

Canonical `*.layer.js` components receive an object-based `context.api`. `query({...})` and `command({...})` return lifecycle-owned handles whose state fields are local read-only signals; query cache data remains application-owned and command intent remains outbox-owned. Generated adapters subscribe across lazy chunk boundaries and dispose watchers with the component, so API updates invalidate only dependent DOM bindings. Low-level `window.layer.query/command/sync` remain available for infrastructure and compatibility. See the [English](../../docs/en/context-api.md) and [Russian](../../docs/ru/context-api.md) contracts.

`src/operations.js` may export one static `operations = layerOperationContractsCreate([...])` value. The CLI parses it without execution, validates both JSON Schemas, bundles `#layer/operations` imports, and emits runtime, declaration, and private metadata artifacts. Command declarations omit engine-owned `commandId` from the author payload.

Component imports support scoped module `*.layer.css`/`*.layer.module.css`, compatibility `*.module.css`, and explicit global `*.global.layer.css`. Relative `url(...)` assets stay below `src`, are size-limited and content-addressed. The build emits `_layer/styles.json` and CSS import declarations; generated Caddy policies keep metadata private and cache hashed assets immutably.

`src/app.js` may export `identityGet`, `onlineGet`, `guardRun`, `preload`, `props`, `context`, `onEmit`, `boundaryRender`, `onReady`, `onError`, `serviceWorker`, `apiUrl`, `requestIdCreate`, `csrfTokenGet`, `storageNamespaceGet`, `storageSchema`, `optimisticApply`, `backgroundSyncRegister`, `eventSync`, `eventControl`, and `eventFailure`. `eventSync` is mandatory when a cursor gap or snapshot requirement occurs; the runtime fails closed instead of skipping data. If `csrfTokenGet` is absent, the bootstrap reads `<meta name="layer-csrf">`. Public anonymous applications use the isolated `anonymous` storage namespace; applications with an authenticated identity must export a tenant/user-safe `storageNamespaceGet` and fail closed otherwise. Missing security integrations fail through the router's explicit boundaries. Setting `serviceWorker` to `false` disables registration for an application that intentionally does not own the current scope. The optional `backgroundSyncRegister({storage, registration})` hook replaces only worker scheduling; it exists for an application-owned scheduler or a static test transport, while startup and `online` page drains remain active.

Application-relative imports are confined to the configured `src` tree. Nested `.layer` imports use the same compiler. Build failures publish bounded `CLI_BUILD_*` diagnostics and do not write a partial output directory.

The build treats `public/manifest.webmanifest` as an untrusted build input. It enforces a 256 KiB byte budget, strict JSON, known standard members, bounded same-origin URLs, and capability-specific contracts before writing a canonical manifest. Invalid input fails with `CLI_BUILD_MANIFEST_INVALID`; the build never copies a malformed manifest into `dist`.

When the canonical manifest declares a POST `share_target`, `build` connects that exact action to the generated Service Worker and browser facade. The worker uses the storage package's bounded temporary inbox and redirects with an opaque identifier; the application exposes it through `layer.pwa.shareTarget`. No Share Target interception code is enabled for applications that omit the declaration. `storagePurge()` deletes the temporary inbox as well as the active user namespace.
`dev` owns compiler watch, atomic complete rebuilds, and an application host bound only to `127.0.0.1`, `localhost`, or `::1`. When `deployment.serverEntry` is present, the same bundled server module used by production starts on the private `deployment.originPort`; `/api` and `/health/*` are streamed through the dev origin. A changed server bundle is restarted before the browser receives the new revision. Successful builds are announced through an internal GET SSE stream and reload the current browser URL. A failed rebuild keeps the last working `dist` and reports a bounded text-only overlay. `development.liveReload` defaults to `true`; setting it to `false` removes the injected client and makes its internal endpoints unavailable. The client asks the active Service Worker to bypass versioned caches during development without unregistering it. No WebSocket is used and no dev resource is written into production artifacts. HTTP is the default local development transport. HTTPS requires explicit relative `development.https.keyFile` and `development.https.certificateFile` paths. Production public hostnames remain behind Caddy automatic HTTPS.

```js
development: {
    host: '127.0.0.1',
    port: 5173,
    https: false,
    liveReload: true
}
```

## Deployment configuration

`layer.config.js` accepts one strict production block:

```js
deployment: {
    domain: null,
    serverEntry: null,
    originPort: 8787,
    dependencies: {}
}
```

- `domain` is `null`, `localhost`, or an ASCII hostname without scheme, path, or wildcard. `LAYER_DOMAIN` overrides it at startup; a missing production domain fails closed.
- `serverEntry` is an optional ESM file relative to `src`. It must export `layerServerCreate(context)`; `null` produces a static PWA with no Node origin.
- `originPort` is the private loopback port passed to the optional server lifecycle.
- `dependencies` contains only external runtime packages with exact versions. Application code and Layer packages imported by the server entry are bundled.

The server factory returns `start`, `stop`, and `isReady`. Its context contains
`appName`, `appVersion`, `environment`, and a frozen `trustedProxy` contract
for the generated loopback Caddy/dev proxy. Pass `context.trustedProxy` to
`layerHttpRuntimeCreate`; forwarded headers remain ignored without this explicit
option. The launcher always passes `127.0.0.1`; an application server must not
replace it with a public bind. An operations module does not implicitly enable a
backend.

## Generated production directory

`layer build` stages and validates the complete output before atomically replacing
the previous `dist`. The result contains browser assets plus:

```text
dist/
    package.json
    package-lock.json
    Caddyfile
    .env.example
    _layer/
        deployment.json
        deployment/run.mjs
        server/application.mjs  # only with serverEntry
```

After copying only `dist`, use `npm run check` for a no-listener preflight and
`npm start` for the foreground process. The launcher verifies integrity, checks
Node 24/npm 11, validates `npm ls`, installs missing locked dependencies, obtains
the pinned Caddy 2.11.4 binary with official SHA-512 verification, validates the
generated Caddyfile, starts the optional API, and then exposes HTTPS. Supported
Caddy assets are Linux x64/arm64 and Windows x64/arm64. Runtime state defaults to
the OS user-state directory and can be moved with `LAYER_STATE_DIRECTORY`.

`LAYER_HTTP_PORT` and `LAYER_HTTPS_PORT` default to `80` and `443`; they exist for
controlled local/staging checks. `LAYER_ORIGIN_PORT` overrides the private API
port. Production must retain an external supervisor and must configure DNS,
firewall, privileged-port access, and a CDN/WAF where volumetric DDoS is in scope.
