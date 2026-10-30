# Changelog

## 0.1.1 — prepared, not published

- Add the automatically installed `@solcorp/layer-docs` package: versioned RU/EN articles, offline HTML, search, code highlighting and `layer guide [--lang ru|en] [--open]`.
- Explain the complete installation, first component, portable deployment and automatic HTTPS in the main README; identify every npm module as part of Layer-Engine.
- Point public source/issues metadata to `soluser010/layer-engine`; include the optional agent skill and VS Code extension instructions.
- Keep private GitVerse history and public GitHub snapshots in separate checkouts. Exclude application projects from the current framework tree and public source.
- Load server tooling only for commands that require it, so version/help/guide do not initialize passkey cryptography.

## 2026-10-29 — Remove bundled tutorial application

- Removed the bundled tutorial application and its documentation links.
- Preview and portable deployment CI now generate disposable projects, retaining hydration, signal, routing and Service Worker reload checks without depending on applications in the repository.

## 2026-10-29 — Unified framework installation

- `@solcorp/layer` now installs the CLI and all framework packages, including plugin SDK and testkit, and provides the `layer` executable for local/global installation.
- Removed the reverse CLI dependency to keep the package graph acyclic; browser exports remain unchanged.
- New applications declare a single pinned `@solcorp/layer` dependency. Updated RU/EN installation and quick-start instructions and isolated packed-consumer checks.

## Redis background recovery — 2026-10-29

- Managed hosts no longer wait for optional Redis during startup. SQL fallback remains available while cache recovery and pub/sub connect asynchronously.
- Redis pub/sub recreates publisher/subscriber pairs after exhausted native retries, restores the subscription, and uses capped jittered backoff until shutdown. Stopping cancels pending connections and timers.
- Redis publishing has a bounded asynchronous acknowledgement wait while durable fallback remains authoritative. Cache reads still wait for invalidation catch-up.
- Added real Redis fault-proxy regressions for startup outages, disconnect/reconnect, resubscription and socket cleanup; documented managed/manual lifecycle contracts in RU/EN.

## Audit documentation corrections — 2026-10-28

- Corrected operation/CSRF error names, managed session-data access and revision-check guarantees in RU/EN application guides.
- Added runnable CRUD, IndexedDB, outbox, query-cache, PWA and event-authorization examples; documented shallow stores, error boundaries, trusted plugins and advanced Auth lifecycle.
- Added a checked catalog of 234 root callable exports and a configuration reference generated from strict validator profiles. Documentation checks compare required API sections/methods and execute selected examples; they do not certify every prose example or native browser capability.
- Moved historical framework performance measurements to dated reports and kept application guidance independent of framework fixtures/release procedures. Native Safari remains an optional best-effort target.

All notable changes follow Keep a Changelog structure. Versions follow Semantic Versioning after `1.0.0`; pre-1.0 compatibility is still reviewed and documented.

## [Unreleased]

### Added

- Real isolated tarball consumers cover every publishable package and export, strict declaration resolution, LICENSE payloads, and global/project-local CLI create/build/dev. CLI resolves its declared authoring dependency and derives generated versions from installed package metadata.

- Optional same-origin Web Push notification badge, with server/worker validation, generated declarations and RU/EN examples.

- Lifecycle-owned context.keyboard and window.layer.keyboard with synchronous show(field), hide(), immutable geometry, immediate subscriptions and capability detection; shared viewport ownership, browser-controlled visibility, and RU/EN application examples.

- Focused iPhone/iPad WebKit viewport projects with synthetic keyboard traces, real responsive layout checks, and a documented final BrowserStack device gate.

- Deterministic `css.targets` browser floors and pinned Lightning CSS transformation/minification for component, framework and public styles in both dev and production; final-byte offline integrity, safe build diagnostics and RU/EN documentation.

- Bounded per-subscriber SSE event/frame queues, write deadlines and drain termination, with slow-client and concurrent-open regressions.

- Observable build-aware application updates with manifest-branded non-modal card, verified resource progress, explicit activation and multi-window save/force confirmation.
- Validated `security.permissionsPolicy` device permissions with deny-by-default production headers, explicit same-origin grants, and mirrored RU/EN configuration guidance.
- Default bounded PWA app shell with safe-area, keyboard resize/preserve input policies, scoped viewport regions, focus-retain actions, and item-relative scroll anchors.
- Lifecycle-owned reactive `context.viewport`, public runtime declarations, embedded HTML completions, and mirrored RU/EN viewport examples.
- Additive `security.csp.sources` application permissions shared by the development HTTP host and generated production Caddyfile, with strict origin validation and bounded source lists.
- Full component composition with props, emits, slots, context, lifecycle hooks, form models, and template refs.
- Declared server-driven regions with revisioned structured `view.patch` operations and exclusive DOM ownership.
- Executable browser ESM bundles and linked source maps for `.layer` scripts and local imports.
- Generated route bootstrap, PWA version manifest, verified offline precache, and single application Service Worker.
- Browser-tested component `mount`, `hydrate`, and server `renderToString` entries in generated page modules.
- Bounded browser POST client with `query`, `command`, and `sync` facades in generated applications.
- Durable browser command handles backed by the user-isolated IndexedDB outbox, including retry, cancellation, and explicit conflict replacement.
- Dynamic `layer.events.subscribe` facade over POST Fetch Stream, durable cursors, replay recovery, and multi-tab coordination.
- Stable release policies, security response process, production runbooks, and manual signed-release pipeline.

### Security

- Redis cache writes publish entries and tags atomically, preserve the longest tag lifetime and reject fills overtaken by invalidation. Query/identity caching waits for complete cursor catch-up after reconnect; PostgreSQL invalidation allocation follows commit order to prevent skipped records.

- Updated the development-only transitive `qs` dependency to locked 6.17.0, covering GHSA-6pq8-jhm2-2vcw; vulnerability audit reports no remaining advisories for this dependency snapshot.

- Transactional command replay binds the verified actor, tenant, operation and canonical payload; migration 10 rejects unbound legacy replay, and transaction-owned locks serialize concurrent delivery. User-scoped Redis entries and invalidation tags now include tenant identity.

- Development and production deny environment files at every path depth, including encoded/case variants, before backend forwarding or navigation fallback; public environment files never enter deployment copies or offline precache.
- Portable package/lock files, dependencies, Caddyfile and internal artifacts are private on both HTTP surfaces. The default Caddy error logger drops request headers and request URI queries.
- CSP resource exceptions preserve self sources, protected directives and production Trusted Types; unsafe script keywords, policy injection, unknown overrides and remote plaintext origins are rejected before startup.
- Development now explicitly limits workers and manifests to self, preventing configured frame/script sources from broadening those permissions through CSP fallback.
- View patches reject raw HTML, executable elements, inline handlers, unsafe URL schemes, internal ownership attributes, excessive structures, stale revisions, and unknown fields.
- Application imports are confined to the configured source tree before bundler resolution.
- Browser API responses require JSON contracts and matching request identifiers before application data is exposed.
- Authenticated applications fail closed unless they provide an explicit tenant/user storage namespace.

### Fixed

- Failed context extensions no longer leak operation concurrency slots; reactive callback failures preserve independent bindings and future retries, and pre-send cancellation prevents API transmission even during asynchronous CSRF lookup.

- Schema synchronization and system/legacy migrations now own one transaction connection and app lock through catalog checks, DDL and approval; failed statements no longer disable a healthy PostgreSQL primary, and unavailable optional replicas recover without blocking startup.

- Viewport offset-only panning no longer pulls focused fields back during manual scrolling. Focus changes reveal new fields even with unchanged geometry; scoped regions remeasure after window resizing, read-only controls are excluded from keyboard estimation, foreground return refreshes measurements, and scrolling stays inside the app root.

- Managed Auth sessions now renew their persisted idle deadline after verified session/CSRF/permission checks, with throttled writes and a fixed absolute limit. Migration 9 preserves existing deadlines and derives each issued idle policy; revoked/expired sessions cannot be revived, including concurrent worker and stale-cache cases. Custom Auth session repositories must implement durable `touch`.

- Require patched Node.js `>=24.22.1 <25` in package engines, generated apps/deployments, CLI and doctor; CI pins 24.22.1 and Node typings follow 24.x. Refresh vulnerable dependency locks, including Nodemailer and the VSIX packager's MSAL override (local packaging verified; Marketplace authentication/publication not exercised).
- Retire Caddy upstream keep-alive connections after four seconds before Node's five-second idle timeout; verify real POST connection reuse and replacement without enabling unsafe command retries.
- Release slow SSE subscribers after bounded backpressure and reserve connection capacity before replay; preserve safe Web Push field-path diagnostics without exposing subscription secrets.

- Pre-open `CURSOR_EXPIRED/409` restores an authorized snapshot before reopening POST streams; live snapshots update reconnect cursors, peer replay progresses, and follower snapshots/events are serialized with cancellation and access-denial guards.
- Optional `{cursor}` results from `eventSync` preserve each tab's exact applied snapshot position despite concurrent shared IndexedDB writes; legacy void hooks remain supported.
- Interrupted bodies are classified separately from internal failures; disconnected clients receive no duplicate response, deadlines release body readers, and allowlisted HTTP stage/cause diagnostics preserve technical context without secrets.
- Notification clicks hand URLs to the live app router before native fallback; an early CSP-safe bootstrap retains prerender clicks until runtime readiness. Explicit targets, including `_self`, keep their existing native behavior.

- App shells request a fixed 1x page scale and suppress cancellable page-zoom gestures while preserving scrolling, component photo gestures, and browser/accessibility override fallbacks.
- Permissions-Policy tests now satisfy checkJs and syntax-v1; documentation examples are complete executable configurations and device capabilities are documented in both languages.
- Mixed-case HTTPS/WSS scheme normalization retains subdomain wildcard permissions and deduplicates equivalent origins.
- Service Worker leaves application non-GET requests and development streams under document ownership while retaining exact POST Share Target interception.
- CSP/PWA regression fixtures now satisfy checkJs and repository lint rules; RU/EN CSP configuration examples are complete executable configurations.

## [0.1.0] - 2026-09-18

### Added

- Optional same-origin Web Push notification badge, with server/worker validation, generated declarations and RU/EN examples.

- Initial protocol, server, security, database, events, compiler, renderer, runtime, storage, PWA, router, CLI, plugin SDK, and testkit packages.
- Unified POST API, Fetch event stream without WebSocket, offline outbox, verified Service Worker lifecycle, SSR/hydration, public-preview applications, threat/load/browser gates, SBOM, and unsigned provenance generation.
- Strict links configuration, Android/Apple/Windows/Web association documents, experimental manifest scope extensions, and a sandboxed allowlisted external viewer.
- Lifecycle-owned context.links and a shared Launch Queue broker with independent file/app delivery, startup URL routing, and complete query/hash preservation.
