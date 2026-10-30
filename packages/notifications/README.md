# @solcorp/layer-notifications

**Part of [Layer-Engine](https://www.npmjs.com/package/@solcorp/layer), a JavaScript framework for full PWA applications.** Server Web Push with durable queues and bounded delivery retries.

Start with `npm install @solcorp/layer`; this module is installed automatically. You do not need to assemble the framework package by package.

[Quick start](https://github.com/soluser010/layer-engine/blob/main/README.md#quick-start) · [API guide EN](https://github.com/soluser010/layer-engine/blob/main/docs/en/web-push.md) · [Документация RU](https://github.com/soluser010/layer-engine/blob/main/docs/ru/web-push.md) · [Source](https://github.com/soluser010/layer-engine/tree/main/packages/notifications)

Часть фреймворка **Layer-Engine**. Для разработки приложения установите основной пакет `@solcorp/layer`; этот модуль входит в его зависимости. Ссылки выше ведут к назначению, API, примерам и ограничениям модуля.

Server-only encrypted Web Push delivery using PostgreSQL or single-worker PGlite.
SQL is authoritative; Redis is an optional wakeup accelerator.

See [RU](../../docs/ru/web-push.md) / [EN](../../docs/en/web-push.md) for configuration,
registration, transactional sends, browser permission and failure contracts.
