---
title: Что такое Layer-Engine
description: Назначение, архитектурные принципы и границы нового PWA-фреймворка Layer-Engine.
audience: beginner
order: 10
status: release-candidate
updated: 2026-09-24
---

# Что такое Layer‑Engine

## Цель

Понять, какие задачи решает Layer‑Engine, из каких частей состоит приложение и какие гарантии движок берёт на себя.

Layer‑Engine создаётся S.O.L CORP как ESM-only JavaScript-фреймворк для PWA, мессенджеров, социальных сетей и других приложений, где важны offline-работа, частичный DOM, SSR, защищённый API и события в реальном времени.

## Главная модель

```text
*.layer.js → compiler → SSR HTML + direct DOM bindings + scoped CSS
browser → POST /api → operation registry → handler → PostgreSQL
browser ← POST Fetch Stream ← event journal/outbox ← PostgreSQL
Service Worker ↔ Cache Storage
runtime ↔ IndexedDB query cache/outbox
```

- UI описывается обычным JavaScript и tagged templates html/css.
- Compiler заранее разбирает шаблон. eval и new Function не используются.
- Signals обновляют только зависимые text/attribute/property/list bindings; общего Virtual DOM нет.
- Все прикладные query, command и sync идут через единый POST /api.
- Realtime использует POST Fetch Stream с форматом text/event-stream, а не WebSocket/WSS.
- PostgreSQL/PGlite — источник истины. Redis — необязательное ускорение.
- IndexedDB хранит локальный cache, outbox, cursors и пользовательское состояние.
- Один Service Worker управляет offline shell, GET cache, background sync и обновлением.
- Production bundle содержит Caddy, который автоматически получает TLS-сертификат для корректного публичного домена.

## Что движок делает за разработчика

- компилирует и связывает страницы, layouts и компоненты;
- валидирует маршруты, metadata, manifests, конфигурацию и operation schemas;
- создаёт SSR/hydration и PWA bootstrap;
- формирует generated operation facade и декларации типов;
- обеспечивает session/CSRF/permissions/rate limits;
- управляет offline outbox, idempotency, event cursor и Service Worker update;
- собирает переносимый dist и защищённый Caddyfile.

## Что остаётся приложению

Приложение определяет дизайн, формы, диалоги, таблицы, прикладные permissions, операции, таблицы данных и конфликтную политику. Layer не навязывает визуальную библиотеку и не угадывает бизнес-правила.

Uploads и серверная Web Push-доставка находятся в post-stable плане. Browser PWA capabilities, push subscription и notifications уже доступны, но прикладной сервер отправки уведомлений не объявляется готовым.

## Почему такие решения

POST API упрощает единый security pipeline, JSON Schema и rate limits. PostgreSQL journal позволяет восстановить события после разрыва. Отказ от общего Virtual DOM уменьшает число лишних DOM mutations. Capability-first PWA API честно показывает различия браузеров вместо фиктивных polyfills.

## Failure contract

Движок завершает небезопасную сборку или запуск явным стабильным кодом. Публичные ошибки не содержат stack, cause, secrets или raw SQL. Невозможность HTTPS в production не включает небезопасный HTTP API.

Далее: [установка и CLI](installation-cli.md), [быстрый старт](getting-started.md), [глоссарий](glossary.md).
