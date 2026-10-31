---
title: What Layer-Engine is
description: Purpose, architecture principles, and boundaries of the new Layer-Engine PWA framework.
audience: beginner
order: 10
status: documented
updated: 2026-09-24
---

# What Layer‑Engine is

## Goal

Understand which problems Layer‑Engine solves, how an application is divided, and which guarantees belong to the engine.

Layer‑Engine is developed by S.O.L CORP as an ESM-only JavaScript framework for PWAs, messengers, social networks, and other applications that need offline behavior, partial DOM updates, SSR, a protected API, and realtime events.

## Core model

```text
*.layer.js → compiler → SSR HTML + direct DOM bindings + scoped CSS
browser → POST /api → operation registry → handler → PostgreSQL
browser ← POST Fetch Stream ← event journal/outbox ← PostgreSQL
Service Worker ↔ Cache Storage
runtime ↔ IndexedDB query cache/outbox
```

- UI is ordinary JavaScript with html/css tagged templates.
- The compiler parses templates ahead of time. It does not use eval or new Function.
- Signals update only dependent text, attribute, property, and list bindings; there is no global Virtual DOM.
- All application query, command, and sync calls use one POST /api endpoint.
- Realtime uses a POST Fetch Stream encoded as text/event-stream, not WebSocket/WSS.
- PostgreSQL/PGlite is the source of truth. Redis is an optional accelerator.
- IndexedDB stores local cache, outbox, cursors, and user state.
- One Service Worker owns the offline shell, GET cache, background sync, and updates.
- The production bundle includes Caddy, which automatically obtains TLS certificates for a valid public domain.

## What the engine owns

- compiling and linking pages, layouts, and components;
- validating routes, metadata, manifests, configuration, and operation schemas;
- producing SSR/hydration and the PWA bootstrap;
- generating operation facades and type declarations;
- session, CSRF, permission, and rate-limit primitives;
- offline outbox, idempotency, event cursor, and Service Worker updates;
- a portable dist bundle and hardened Caddyfile.

## What the application owns

The application defines design, forms, dialogs, tables, domain permissions, operations, data tables, and conflict policy. Layer does not impose a visual library or guess business rules.

Uploads and server-side Web Push delivery are post-stable work. Browser PWA capabilities, push subscriptions, and notifications exist, but an application notification delivery server is not claimed as complete.

## Why these choices

A POST API provides one security pipeline, JSON Schema boundary, and rate-limit model. A PostgreSQL journal makes event recovery possible after disconnects. Avoiding a global Virtual DOM reduces unnecessary DOM mutations. Capability-first PWA APIs expose browser differences instead of pretending to polyfill them.

## Failure contract

The engine stops an unsafe build or startup with an explicit stable code. Public errors do not contain stack, cause, secrets, or raw SQL. Failure to obtain production HTTPS never enables an insecure HTTP API.

Next: [Installation and CLI](installation-cli.md), [Getting started](getting-started.md), [Glossary](glossary.md).
