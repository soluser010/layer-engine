---
title: Layer-Engine documentation
description: Complete English guide to developing, testing, and deploying Layer-Engine applications.
audience: all
order: 0
status: documented
updated: 2026-10-29
---

# Layer‑Engine documentation

Layer‑Engine is an S.O.L CORP JavaScript framework for secure, offline-capable PWAs, interactive applications, social networks, and messengers. Author and copyright holder: **S.O.L CORP**. Official website: [solcorp.ru](https://solcorp.ru).

Source and documentation: [GitHub](https://github.com/soluser010/layer-engine). The main [npm package](https://www.npmjs.com/package/@solcorp/layer) is published. The dedicated `layer.solcorp.ru` site is planned. The offline handbook `npx layer guide --lang en` is available starting with 0.1.1.

## How to read this guide

- **Beginner:** overview → installation → getting started → project structure → configuration → syntax → reactivity → components → operations → build.
- **Application developer:** routing/SSR → Context API → databases → Layer Auth → offline/realtime → PWA → recipes.
- **Backend/DevOps:** server runtime → security → deployment → testing → browser support → performance → reference.

Each article separates the smallest working path from the recommended production approach. “Simpler” means fewer settings for a limited use case, not disabling validation, permissions, or server-derived identity.

## Table of contents

### Introduction and installation

1. [What Layer‑Engine is](overview.md)
2. [Installation and CLI](installation-cli.md)
3. [Getting started](getting-started.md)
4. [Project structure](project-structure.md)
5. [Application configuration](configuration.md)
6. [VS Code, IntelliSense, and live reload](editor-tooling.md)

### Interface development

7. [Authoring *.layer.js](authoring-layer-js.md)
8. [Signals, stores, and partial DOM](reactivity.md)
9. [Components, props, events, slots, and context](components.md)
10. [Routing, layouts, SSR, and hydration](routing-ssr.md)
    - [Viewport, keyboard, and application shell](viewport.md)

### API and server

11. [Operations: complete and simplified approaches](operations.md)
12. [Component Context API](context-api.md)
13. [Server runtime and serverEntry](server-runtime.md)
14. [Databases, Redis, and workers](database-runtime.md)
15. [Layer Auth](layer-auth.md)
16. [Security and auth primitives](security-auth.md)

### Offline, PWA, and operations

17. [Offline, outbox, and realtime](offline-realtime.md)
18. [PWA, Service Worker, and updates](pwa-service-worker.md)
    - [Built-in application updates](application-updates.md)
    - [Server Web Push](web-push.md)
    - [Sharing: sending and receiving text and files](sharing.md)
    - [Links, incoming launches and viewer](links-navigation.md)
19. [Build, deployment, and diagnostics](deployment-diagnostics.md)
20. [Testing applications](testing.md)
21. [Browser support](browser-support.md)
22. [Performance report](performance-report.md)

### Practice and reference

23. [Errors and diagnostics](errors.md)
24. [Practical recipes](recipes.md)
25. [Configuration, CLI, and errors reference](reference.md)
26. [Glossary](glossary.md)

## Handbook version

Use the handbook matching your installed Layer-Engine version. Run `npx layer guide --lang en` to open the local documentation.

## Detailed APIs and contracts

- [Structured CRUD and revisions](structured-data.md)
- [Application IndexedDB](indexeddb.md)
- [Cache and command queue](cache-outbox.md)
- [Additional PWA APIs](pwa-capabilities.md)
- [Server events](server-events.md)
- [Stores, boundaries and extensions](advanced-runtime.md)
- [Permissions and session data](auth-advanced.md)
- [Public API catalog](api-catalog.md)
- [Complete configuration reference](configuration-reference.md)
