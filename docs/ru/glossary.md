---
title: Глоссарий
description: Краткие определения основных терминов Layer-Engine.
audience: beginner
order: 260
status: documented
updated: 2026-10-31
---

# Глоссарий

[Карта возможностей](capabilities.md)

- **Application API** — рекомендуемые методы компонента и window.layer, которыми пользуется разработчик приложения.
- **Capability** — браузерная возможность с явными supported/availability/permission/reason вместо фиктивного polyfill.
- **Command** — изменяющая операция; может быть transactional, idempotent и replayable через outbox.
- **Context** — lifecycle-owned зависимости компонента или trusted server operation.
- **Cursor** — сохранённая позиция event stream для replay после reconnect.
- **Direct DOM binding** — связь signal с конкретным text/attribute/property/list region без общего Virtual DOM.
- **Event stream** — долгий POST Fetch response в формате text/event-stream; WebSocket не используется.
- **Generated facade** — functions из #layer/operations, созданные из operation contracts и JSON Schema.
- **Hydration** — подключение client bindings к существующему SSR DOM без полной замены.
- **Infrastructure API** — низкоуровневые packages для авторов server runtime, adapters и tooling.
- **Layer Auth** — headless identity/session/MFA/OAuth subsystem; UI остаётся приложению.
- **Layout** — сохраняемая внешняя оболочка маршрутов с одним data-layer-layout-outlet.
- **Operation** — именованный query/command/sync contract единого POST /api.
- **Outbox** — durable очередь команд/событий, позволяющая безопасный retry после offline или crash.
- **PGlite** — embedded PostgreSQL-compatible system storage для одного worker.
- **Query** — операция чтения; может использовать bounded cache и replica при eventual consistency.
- **Readiness** — способность worker обслужить реальный запрос со всеми обязательными dependencies.
- **Revision** — версия domain entity/state для обнаружения конфликта.
- **Scoped CSS** — selector transformation, ограничивающая style конкретным component scope.
- **Server entry** — ESM factory layerServerCreate(context), из которой строится private Node origin.
- **Signal** — writable reactive value с dependency tracking.
- **Snapshot** — полное восстановительное состояние, используемое при невозможности продолжить cursor replay.
- **SSR** — получение HTML на сервере/во время build для первого отображения и индексации.
- **Structured CRUD** — schema-aware database facade с parameterization и tenant/user ownership.
- **System tables** — внутренние таблицы Layer с префиксом sys_.
- **Transactional outbox** — domain change и запись события в одной PostgreSQL transaction.
- **Trusted Types** — browser policy, ограничивающая опасные DOM sinks.
- **Worker** — отдельный Node process за Caddy; не путать с Service Worker.

## Уровни API

Сначала используйте Application API. Переходите к Infrastructure API только если создаёте server entry, adapter или tooling. Internal generated files в dist не являются стабильным импортом.

Далее: [обзор](overview.md), [reference](reference.md).
