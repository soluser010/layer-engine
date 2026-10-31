---
title: Все настройки серверной операции
description: Все настройки серверной операции.
audience: intermediate
order: 111
status: documented
updated: 2026-10-31
---

# Все настройки серверной операции

[Карта возможностей](capabilities.md) · [Полные сигнатуры и типы](api-reference-server.md)

## Регистрация и границы

Этот справочник описывает server registry, а не только browser contracts. Рабочие файлы и полный/упрощённый вызов: [операции](operations.md). Регистрируйте handler/authorize/cache на сервере; shared `src/operations.js` не может содержать функции.

| Поле | Default | Форма / диапазон | Назначение |
| --- | --- | --- | --- |
| `name` | `required` | Dotted name, ≤160 | Имя операции |
| `type` | `required` | query / command / sync / events.open | events.open — системный stream; не shared browser declaration |
| `inputSchema / outputSchema` | `required` | JSON Schema object / boolean | Строгая компиляция схем при регистрации; используйте bounded objects |
| `handler` | `required` | (payload, context) => value / Promise | Только сервер; возвращает данные результата |
| `auth` | `session` | session / authenticated / bearer / api-key / none | Публичный доступ только явным none |
| `authorize` | `null` | function / null | Только server; true разрешает объектное действие |
| `permissions` | `[]` | unique dotted string[] | Все разрешения обязательны |
| `rateLimitBucket` | `operation.default` | lowercase identifier | Группа лимитов, не API key |
| `cost` | `1` | integer 1–1000 | Вес запроса для rate limiter |
| `timeoutMs` | `command: 15000; other: 10000` | integer 100–120000 | Миллисекунды; timeout не гарантирует откат внешнего side effect |
| `concurrency` | `32` | integer 1–10000 | Ограничение параллельных вызовов операции |
| `transaction` | `false` | boolean | true разрешён только command |
| `offlineReplay` | `false` | boolean | true требует command и transaction:true |
| `audit` | `enabled:true, category:metadata` | {enabled?: boolean, category?: string} | Без чувствительных payload |
| `cache` | `null` | {ttlMs, scope, tags?} | Только query; TTL 100–3600000; tags 0–16 |
| `cacheInvalidation` | `null` | {scope, tags} | Только transactional command; tags 1–16 |

## Cache и ошибки

Scope: `global`, `tenant`, `user`; auth:none допускает только global. Tags уникальны, соответствуют `[a-z][a-z0-9:_-]{0,79}`. Не размещайте в global cache ответы, зависящие от пользователя. Неизвестные поля, неверная схема, недопустимые сочетания или регистрация после seal не игнорируются. Ошибки регистрации — startup failures, а не ошибки payload пользователя.

`define` регистрирует определение, `get` возвращает внутреннюю запись для server executor, `has` проверяет имя, `list` отдаёт inspection metadata, `seal` закрывает регистрацию, `isSealed` проверяет состояние. Не отдавайте get() браузеру.

## Параметры handler

Payload уже проверен inputSchema. Identity, permissions, tenant и transaction context задаёт host; payload не определяет владельца данных. Возвращаемое значение проверяется outputSchema. Бизнес-отказ оформляйте безопасной ошибкой протокола; не передавайте stack, SQL или секреты.

Далее: [клиентские options](context-api.md), [кэширование](caching.md), [точные сигнатуры](api-reference-server.md).
