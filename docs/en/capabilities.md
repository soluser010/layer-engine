---
title: Capability and reference map
description: Capability and reference map.
audience: intermediate
order: 5
status: documented
updated: 2026-10-31
---

# Capability and reference map

This is the entry map for the main application areas. Choose a task, then read its workflow and reference. Reference types expose nested parameters; working examples live in the guides.

| Area | Capabilities | Guide | More detail | Signatures |
| --- | --- | --- | --- | --- |
| Pages and navigation | SSR/CSR, layouts, guard, preload, metadata | [Guide](routing.md) | [Details](page-configuration.md) | [API](api-reference-router.md) |
| Templates and components | html, css, props, events, slots, context | [Guide](authoring-layer-js.md) | [Details](components.md) | [API](api-reference-layer.md) |
| Reactivity | signal, computed, effect, batch, store, boundaries | [Guide](reactivity.md) | [Details](advanced-runtime.md) | [API](api-reference-render.md) |
| API calls | query, command, commandOnline, cache, cancellation | [Guide](context-api.md) | [Details](operations-reference.md) | [API](api-reference-runtime.md) |
| Server | registry, handler context, lifecycle, HTTP runtime | [Guide](server-runtime.md) | [Details](operations.md) | [API](api-reference-server.md) |
| PostgreSQL data | schema, CRUD, transactions, filters, replicas | [Guide](database-runtime.md) | [Details](structured-data.md) | [API](api-reference-database.md) |
| Local data | stores, indexes, migrations, watch, quota, outbox | [Guide](indexeddb.md) | [Details](cache-outbox.md) | [API](api-reference-storage.md) |
| Realtime | POST stream, channels, cursor, replay, multi-tab | [Guide](offline-realtime.md) | [Details](server-events.md) | [API](api-reference-events.md) |
| Authentication | identity, sessions, roles, OAuth, providers | [Guide](layer-auth.md) | [Details](auth-advanced.md) | [API](api-reference-auth.md) |
| Security | CSRF, permissions, limits, trusted proxy | [Guide](security-auth.md) | [Details](configuration-reference.md) | [API](api-reference-security.md) |
| PWA | install, share, notifications, storage, launch, update | [Guide](pwa-service-worker.md) | [Details](pwa-capabilities.md) | [API](api-reference-pwa.md) |
| Web Push | subscription, delivery, retries, VAPID | [Guide](web-push.md) | [Details](pwa-capabilities.md) | [API](api-reference-notifications.md) |
| Protocol | envelopes, versions, safe errors | [Guide](operations.md) | [Details](errors.md) | [API](api-reference-protocol.md) |
| Extensions | trusted plugins, capabilities, setup | [Guide](advanced-runtime.md) | [Details](server-runtime.md) | [API](api-reference-plugin-sdk.md) |

## Reading contracts

- An **overview** explains available capabilities and which mechanism to choose.
- A **reference** lists shapes, alternatives, required fields, defaults and limits. If no default is stated, do not infer one from a name or `?`.
- An **example** identifies its file, imports, call and expected result. An in-component fragment requires an existing context; this is stated before the block.
- A **failure contract** explains rejection, fallback and application responsibilities.

Complete [app configuration](configuration-reference.md), [CLI](installation-cli.md), [CSS](authoring-layer-js.md), [keyboard/viewport](viewport.md), [sharing](sharing.md), [links](links-navigation.md), [updates](application-updates.md), [deployment](deployment-diagnostics.md).

## Current limitations

An accepted value does not always enable a distinct strategy. Cases involving `page.cache`, `offline: snapshot/local`, layout inheritance and build-time SSR are explained in [page options](page-configuration.md). OS capabilities are checked through capability APIs; these are not polyfills or guarantees for every platform.

Server integrations and manual hosts are advanced. Ordinary applications should use the standard launcher and component context. Internal framework release procedures are outside this handbook.
