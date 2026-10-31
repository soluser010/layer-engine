---
title: Glossary
description: Short definitions of the main Layer-Engine terms.
audience: beginner
order: 260
status: documented
updated: 2026-10-31
---

# Glossary

[Capability map](capabilities.md)

- **Application API** — recommended component and window.layer methods used by application developers.
- **Capability** — a browser feature with explicit supported/availability/permission/reason instead of a fake polyfill.
- **Command** — a mutating operation; it may be transactional, idempotent, and replayable through the outbox.
- **Context** — lifecycle-owned component dependencies or a trusted server operation context.
- **Cursor** — persisted event stream position used for replay after reconnect.
- **Direct DOM binding** — a signal connection to a specific text/attribute/property/list region without a global Virtual DOM.
- **Event stream** — a long-lived POST Fetch response encoded as text/event-stream; WebSocket is not used.
- **Generated facade** — functions from #layer/operations created from operation contracts and JSON Schema.
- **Hydration** — attaching client bindings to existing SSR DOM without replacing it completely.
- **Infrastructure API** — low-level packages for server runtime, adapter, and tooling authors.
- **Layer Auth** — a headless identity/session/MFA/OAuth subsystem; the application owns its UI.
- **Layout** — a persistent route shell with one data-layer-layout-outlet.
- **Operation** — a named query/command/sync contract of the unified POST /api.
- **Outbox** — a durable command/event queue enabling safe retry after offline periods or crashes.
- **PGlite** — embedded PostgreSQL-compatible system storage for one worker.
- **Query** — a read operation; it may use bounded cache and a replica with eventual consistency.
- **Readiness** — the ability of a worker to serve a real request with every required dependency.
- **Revision** — a domain entity/state version used to detect conflicts.
- **Scoped CSS** — selector transformation limiting a style to one component scope.
- **Server entry** — the ESM layerServerCreate(context) factory used to build a private Node origin.
- **Signal** — a writable reactive value with dependency tracking.
- **Snapshot** — complete recovery state used when cursor replay cannot continue.
- **SSR** — generating HTML on the server or at build time for first render and indexing.
- **Structured CRUD** — a schema-aware database facade with parameterization and tenant/user ownership.
- **System tables** — Layer internal tables prefixed with sys_.
- **Transactional outbox** — a domain change and event record in one PostgreSQL transaction.
- **Trusted Types** — a browser policy restricting dangerous DOM sinks.
- **Worker** — a separate Node process behind Caddy; not a Service Worker.

## API levels

Start with the Application API. Move to the Infrastructure API only when authoring a server entry, adapter, or tool. Internal generated files in dist are not stable imports.

Next: [Overview](overview.md), [Reference](reference.md).
