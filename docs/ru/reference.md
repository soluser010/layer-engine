---
title: Configuration, CLI и errors reference
description: Краткий справочник команд, блоков конфигурации и ошибок.
audience: all
order: 250
status: documented
updated: 2026-10-06
---

# Configuration, CLI и errors reference

## Цель

Быстро найти стабильную точку входа и правило обработки ошибок.

## Основные команды

```text
layer create <name>
layer dev
layer build
layer doctor
layer notifications vapid generate
layer database schema plan
layer database schema apply <checksum> --confirm-data-loss
```

## Основные блоки конфигурации

- `development`: host, port, HTTPS, live reload.
- `database`: embedded, PostgreSQL topology, schema, replica lag, pool budget.
- `redis`: один optional accelerator.
- `notifications`: optional серверный [Web Push](web-push.md), VAPID ENV и bounded delivery queue.
- `runtime.workers`: minimum и fixed/auto maximum.
- `deployment`: domain, server entry, origin port, exact dependencies.

## Error contract

```js
const failure = {
    code: 'RATE_LIMITED',
    message: 'Request rate is limited.',
    requestId: 'uuid',
    retryable: true,
    details: {retryAfterMs: 1000}
};
```

Stack/cause и чувствительные значения не сериализуются. Клиент ветвится по `code`, логирует `requestId` и повторяет запрос только при `retryable: true` с указанной задержкой.

## Типовые ошибки

`INVALID_PAYLOAD`, `AUTH_REQUIRED`, `PERMISSION_DENIED`, `RATE_LIMITED`, `REVISION_CONFLICT`, `DATABASE_DEPENDENCY_UNAVAILABLE`, `OPERATION_TIMEOUT`.

## Failure contract

Незнакомый code обрабатывается как non-retryable generic failure. Приложение не показывает пользователю внутренние details без собственного allowlist.

Далее: [CLI](installation-cli.md), [security](security-auth.md), [Context API](context-api.md).
