# @solcorp/layer-notifications

**Part of [Layer-Engine](https://www.npmjs.com/package/@solcorp/layer), a JavaScript framework for full PWA applications.** Server Web Push with durable queues and bounded delivery retries.

## What's new in 0.2.0

Experimental screen warmup is enabled by default. Layer prepares eligible visible destinations and can retain opened screens with their state and scroll position. Disable it with `navigation.warmup.enabled: false` in `layer.config.js`. This release also fixes CSS/font asset handling and updates the English agent skill.

[Changes and upgrade steps](https://github.com/soluser010/layer-engine/blob/main/docs/en/updates/0.2.0.md) · [History](https://github.com/soluser010/layer-engine/blob/main/docs/en/updates/README.md).

Start with `npm install @solcorp/layer`; this module is installed automatically. You do not need to assemble the framework package by package.

[Quick start](https://github.com/soluser010/layer-engine/blob/main/README.md#quick-start) · [API guide EN](https://github.com/soluser010/layer-engine/blob/main/docs/en/web-push.md) · [Документация RU](https://github.com/soluser010/layer-engine/blob/main/docs/ru/web-push.md) · [Source](https://github.com/soluser010/layer-engine/tree/main/packages/notifications)

Часть фреймворка **Layer-Engine**. Для разработки приложения установите основной пакет `@solcorp/layer`; этот модуль входит в его зависимости. Ссылки выше ведут к назначению, API, примерам и ограничениям модуля.

Server-only encrypted Web Push delivery using PostgreSQL or single-worker PGlite.
SQL is authoritative; Redis is an optional wakeup accelerator.

See [RU](../../docs/ru/web-push.md) / [EN](../../docs/en/web-push.md) for configuration,
registration, transactional sends, browser permission and failure contracts.
