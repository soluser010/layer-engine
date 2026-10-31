---
title: Кэширование — выбор механизма
description: Кэширование — выбор механизма.
audience: intermediate
order: 103
status: documented
updated: 2026-10-31
---

# Кэширование — выбор механизма

[Карта возможностей](capabilities.md)

## Что именно сохраняется

| Механизм | Что хранит | Управление | Чего не делает |
| --- | --- | --- | --- |
| HTTP cache | Ответы GET | Generated host: HTML `no-cache`, content-hashed assets immutable | Не сохраняет состояние компонента |
| Service Worker | Проверенные ресурсы сборки и shell | Manifest/buildId и lifecycle обновления | Не превращает POST API в Cache Storage |
| Query cache | Результаты операций в namespace пользователя | `context.api.query({cache, offline})` | Не сохраняет DOM и не обновляет PostgreSQL |
| Redis query cache | Серверные результаты разрешённых операций | Server metadata `cache`, `cacheInvalidation` | Не является источником истины |
| Store / IndexedDB приложения | UI-состояние / долговечные черновики | Явные записи приложения | Не сохраняет произвольные компоненты автоматически |
| `page.cache` | Значение в описании маршрута | `private`, `public`, `no-store` | Пока не управляет HTTP/SW-кэшем по маршрутам |

`no-cache` разрешает хранение с проверкой свежести; `no-store` запрещает хранение соответствующим механизмом. Клиентский `cache.policy: 'no-store'` не отключает Redis server cache или precache ресурсов.

## Клиентский query

| Параметр | Default | Допустимые значения / эффект |
| --- | --- | --- |
| `cache.policy` | `cache-and-network` | `cache-and-network`, `cache-first`, `network-only`, `no-store` |
| `cache.maxAgeMs` | `30000` | Целое 0–86400000; критерий свежести, не таймер удаления |
| `cache.key` | Из operation и нормализованного payload | Строка 1–320; итоговый ключ до 512 символов |
| `offline.fallback` | `cache` | `cache` или `reject` |

`cache-and-network` показывает сохранённое значение и обновляет сетью; `cache-first` избегает сети при свежем значении; `network-only` читает сеть и сохраняет успех; `no-store` не читает/не пишет query cache. При пользовательском key включайте все параметры, различающие результаты. Авторизационные ошибки не заменяются старыми данными.

[Примеры query и refresh](context-api.md), [изменение cache и outbox](cache-outbox.md).

## Серверный query cache

Для query: `cache: {ttlMs: 30000, scope: 'tenant', tags: ['messages']}`. TTL 100–3600000 ms; scope `global`, `tenant`, `user`. Для анонимных операций разрешён только global scope. Не кэшируйте персональные ответы как global. Mutation инвалидирует tags через `cacheInvalidation` в транзакции; отсутствие Redis означает обход ускоряющего cache, а не потерю данных. [Контракт операций](operations-reference.md), [базы данных](database-runtime.md).

## Практический выбор

Для чата: shell/resources в SW, список сообщений в query cache, неотправленные сообщения в outbox, черновик в developer IndexedDB. После изменения сообщения перечитайте query или явно обновите его cache; само событие сервера не обязано знать структуру каждой коллекции UI.

Если требуется сохранить раскрытые панели при уходе со страницы, храните их состояние отдельно. `render: 'csr'`, `cache: 'private'` и `offline: 'snapshot'` не предоставляют page keep-alive.

## Ошибки

Неверная policy, maxAgeMs или слишком длинный ключ отклоняются. Quota/отсутствие IndexedDB требуют понятного UI fallback; нельзя объявлять durable запись успешной после потери данных. Подробности: [IndexedDB](indexeddb.md), [обновления](application-updates.md).
