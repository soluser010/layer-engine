# @solcorp/layer-notifications

**Part of [Layer-Engine](https://www.npmjs.com/package/@solcorp/layer), a JavaScript framework for full PWA applications.** Server Web Push with durable queues and bounded delivery retries.

## What's new in 0.1.2

Layer-Engine now shows a branded first-install PWA screen with verified file progress, limits update-card descriptions to 47 characters, and includes RU/EN release history. A vulnerable development-tool dependency is fixed.

This package is part of the coordinated 0.1.2 release, prepared for publication. [Changes and upgrade steps](https://github.com/soluser010/layer-engine/blob/main/docs/en/updates/0.1.2.md) · [History](https://github.com/soluser010/layer-engine/blob/main/docs/en/updates/README.md) · [Что нового (RU)](https://github.com/soluser010/layer-engine/blob/main/docs/ru/updates/0.1.2.md).

Start with `npm install @solcorp/layer`; this module is installed automatically. You do not need to assemble the framework package by package.

[Quick start](https://github.com/soluser010/layer-engine/blob/main/README.md#quick-start) · [API guide EN](https://github.com/soluser010/layer-engine/blob/main/docs/en/web-push.md) · [Документация RU](https://github.com/soluser010/layer-engine/blob/main/docs/ru/web-push.md) · [Source](https://github.com/soluser010/layer-engine/tree/main/packages/notifications)

Часть фреймворка **Layer-Engine**. Для разработки приложения установите основной пакет `@solcorp/layer`; этот модуль входит в его зависимости. Ссылки выше ведут к назначению, API, примерам и ограничениям модуля.

Server-only encrypted Web Push delivery using PostgreSQL or single-worker PGlite.
SQL is authoritative; Redis is an optional wakeup accelerator.

See [RU](../../docs/ru/web-push.md) / [EN](../../docs/en/web-push.md) for configuration,
registration, transactional sends, browser permission and failure contracts.
