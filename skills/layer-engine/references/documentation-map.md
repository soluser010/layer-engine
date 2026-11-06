# Version-matched documentation map

Use this map after resolving the target installation as described in [SKILL.md](../SKILL.md). Article paths below are relative to the selected handbook language directory: `<framework-root>/docs/en` or `<layer-docs-package>/content/en`. Use the corresponding `ru` article when an English article is unavailable. These paths name installed documentation, not files bundled with this skill.

Start with the local `README.md` and `capabilities.md`. Select the rows relevant to the task, then read their guide and the necessary reference sections. The local table of contents takes precedence over this routing map; locate renamed topics through it or a targeted search. Verify the installation before interpreting a missing article as missing functionality.

## Capabilities and entry points

Names are search anchors, not complete signatures. Select exact imports, parameters, supported values and failures from the matching handbook and declarations. Distinguish component context, browser infrastructure and server context even when their methods have similar names.

| Task | Capabilities / key entry points | Local guides and references |
| --- | --- | --- |
| Identify the framework | Product scope, architecture, vocabulary, supported status | `overview.md`, `glossary.md`, `capabilities.md` |
| Install and create an app | `@solcorp/layer`, `layer create`, `layer dev`, local CLI, IDE support | `installation-cli.md`, `getting-started.md`, `editor-tooling.md` |
| Organize and configure | `layer.config.js`, `src/pages`, `src/components`, browser/server separation | `project-structure.md`, `configuration.md`, `configuration-reference.md` |
| Author templates and CSS | `html`, `css`, `layerComponentCreate`, bindings, scoped/global CSS, asset imports, target browsers | `authoring-layer-js.md`, `api-reference-layer.md`, `configuration-reference.md` |
| Compose reusable UI | Properties, events, slots, context, refs, lifecycle | `components.md`, `context-api.md`, `api-reference-layer.md` |
| Update live state | `layerSignalCreate`, `layerComputedCreate`, `layerEffectCreate`, `layerBatch`, `layerStoreCreate`, `when`, `repeat` | `reactivity.md`, `advanced-runtime.md`, `api-reference-render.md` |
| Route and render pages | `layerPageCreate`, layouts, guards, preload, metadata, SSR/CSR | `routing.md`, `page-configuration.md`, `routing-ssr.md`, `routing-csr.md`, `api-reference-router.md` |
| Prepare and retain screens | Experimental `warmup`, `navigation.warmup`, `onBeforeScreenOpen`, activation/deactivation, retained state | `routing.md`, `page-configuration.md`, `context-api.md`; first verify support in the installed version |
| Query and mutate | `context.api.query`, `context.api.command`, generated operation facade, cancellation, optimistic state | `context-api.md`, `operations.md`, `authoring-layer-js.md`, `api-reference-runtime.md` |
| Send an online-only command | `window.layer.api.commandOnline`, sensitive payloads, explicit retry; verify its host and positional signature | `context-api.md`, `offline-realtime.md` |
| Implement operations | Shared contracts, full/simplified definitions, registry, validation, permissions, idempotency | `operations.md`, `operations-reference.md`, `server-runtime.md`, `api-reference-server.md` |
| Choose cache behavior | HTTP/SW resources, query cache, Redis, route metadata, invalidation and ownership | `caching.md`, `cache-outbox.md`, `context-api.md`, `page-configuration.md` |
| Persist local data | `storageSchema`, `layerStorageSchemaDefine`, `layerStorageOpen`, transactions, watch, migrations, quota | `indexeddb.md`, `cache-outbox.md`, `api-reference-storage.md` |
| Queue offline work | Durable command outbox, pending status, idempotent replay, revisions and conflicts | `offline-realtime.md`, `cache-outbox.md`, `context-api.md` |
| Synchronize realtime data | `context.events.subscribe`, POST stream, `eventSync`, cursors, snapshots, multi-tab delivery | `offline-realtime.md`, `server-events.md`, `api-reference-events.md`, `api-reference-runtime.md` |
| Access server data | `layerDatabaseSchemaDefine`, `layerTableDefine`, server `context.database`, scoped CRUD, transactions, parameterized SQL | `database-runtime.md`, `structured-data.md`, `api-reference-database.md` |
| Configure server infrastructure | `layerServerCreate`, `serverEntry`, PostgreSQL primary/replicas, embedded PGlite, optional Redis, workers, readiness/drain | `server-runtime.md`, `database-runtime.md`, `configuration-reference.md`, `api-reference-server.md` |
| Authenticate and authorize | Layer Auth, identities, sessions, roles, providers, OAuth and session data; browser/server import boundaries | `layer-auth.md`, `auth-advanced.md`, `security-auth.md`, `api-reference-auth.md` |
| Secure application boundaries | CSRF, permissions, field/object checks, rate limits, CSP, trusted proxies | `security-auth.md`, `operations-reference.md`, `configuration-reference.md`, `api-reference-security.md` |
| Use protocol contracts | Query/command/sync envelopes, events, versions and safe errors | `operations.md`, `errors.md`, `api-reference-protocol.md` |
| Install and update PWA resources | Manifest, Service Worker, startup screen, verified cache, `window.layer.pwa.update`, `onBeforeUpdate` | `pwa-service-worker.md`, `application-updates.md`, `configuration-reference.md`, `api-reference-pwa.md` |
| Use optional PWA capabilities | Install UI, notifications, badge, persistent storage, background sync, launch and file handlers | `pwa-capabilities.md`, `browser-support.md`, `api-reference-pwa.md` |
| Deliver Web Push | VAPID, browser subscriptions, server notification API, durable delivery and retries | `web-push.md`, `api-reference-notifications.md` |
| Share text and files | Outgoing share, incoming share target, handoff, cancellation and platform support | `sharing.md`, `pwa-capabilities.md`, `api-reference-pwa.md` |
| Handle links and launches | `context.links`, `window.layer.links`, incoming URLs, launch consumers, associations and viewer | `links-navigation.md`, `configuration-reference.md`, `api-reference-runtime.md` |
| Manage viewport and keyboard | `context.viewport`, `context.keyboard`, input policies, safe-area, scroll anchors, user-initiated focus | `viewport.md`, `context-api.md`, `api-reference-runtime.md`, `browser-support.md` |
| Integrate advanced runtime | `ErrorBoundary`, manual hosts, nullable providers, trusted plugin registry and capabilities | `advanced-runtime.md`, `api-reference-render.md`, `api-reference-plugin-sdk.md` |
| Build and deploy | `layer build`, portable `dist`, deployment config, Caddy/automatic HTTPS, diagnostics | `deployment-diagnostics.md`, `installation-cli.md`, `configuration-reference.md`, `reference.md` |
| Verify and troubleshoot | Application tests, examples, safe errors, browser limitations, measurement context | `testing.md`, `recipes.md`, `errors.md`, `browser-support.md`, `performance-report.md` |

## Complete API lookup

Read `api-catalog.md` for the installed public export inventory and application/advanced/experimental classifications. Follow its package reference for full signatures, nested methods, defaults and failure contracts. Search the appropriate guide for a working example; example-only domain functions are application code, not built-in exports.

The current signature families are `api-reference-layer.md`, `api-reference-render.md`, `api-reference-router.md`, `api-reference-runtime.md`, `api-reference-storage.md`, `api-reference-pwa.md`, `api-reference-server.md`, `api-reference-database.md`, `api-reference-events.md`, `api-reference-auth.md`, `api-reference-security.md`, `api-reference-protocol.md`, `api-reference-notifications.md` and `api-reference-plugin-sdk.md`. Use the installation's inventory if this list changes. Obtain CLI/compiler/documentation-tool contracts through their guides and installed exports rather than importing build helpers into application components.

An export's existence does not make it browser-safe or suitable for ordinary components. A declared option does not prove a separate implementation strategy. Check documented limitations, especially page cache/offline metadata, build-time SSR, retained screens, embedded system storage and platform capabilities.

For explicitly requested framework maintenance, follow that repository's instructions and scripts. Operational runbooks belong only to the relevant deployment or incident task. Reading a runbook does not authorize its mutations.
