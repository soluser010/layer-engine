---
title: Базы данных, Redis и workers
description: PGlite, PostgreSQL, Structured CRUD, Redis и multi-process runtime.
audience: advanced
order: 140
status: release-candidate
updated: 2026-09-24
---

# Базы данных, Redis и workers

Layer-Engine поддерживает embedded-режим для небольшого однопроцессного приложения и внешний PostgreSQL для прикладных таблиц, реплик и нескольких workers. Redis необязателен: он ускоряет операции, но не хранит единственную копию сессии, команды, события или прикладных данных.

## Режимы хранения

Если `database.postgres` пуст, full-stack приложение автоматически открывает PGlite `0.5.8` в `<LAYER_STATE_DIRECTORY>/database/system`. Этот режим хранит только системные таблицы Layer и допускает один worker. Static PWA без `deployment.serverEntry` не запускает Node, PGlite или Redis.

Прикладные таблицы и `runtime.workers` больше одного требуют внешний PostgreSQL. Все записи и strong queries идут в единственный primary. Только query с `consistency: 'eventual'` может быть направлен в здоровую replica, lag которой не превышает `database.replica.maximumLagMs`.

```js
export default {
    database: {
        embedded: {
            dataDirectory: null
        },
        postgres: [{
            name: 'primary',
            role: 'primary',
            host: '10.0.0.10',
            port: 5432,
            database: 'layer_application',
            username: 'layer_application',
            password: {
                env: 'LAYER_POSTGRES_PRIMARY_PASSWORD'
            },
            tls: {
                mode: 'verify-full',
                serverName: 'database.example.com',
                caFile: './certificates/postgres-ca.pem'
            }
        }],
        replica: {
            maximumLagMs: 2000
        },
        pool: {
            maximumConnectionsPerWorker: 5,
            connectionBudget: 40
        },
        schema: {
            file: 'src/server/database.js',
            synchronization: 'additive'
        }
    },
    redis: null,
    runtime: {
        workers: {
            minimum: 2,
            maximum: 8
        }
    }
};
```

В production строковые пароли отклоняются. Секреты задаются только как `{env: 'VARIABLE_NAME'}`. Plaintext-соединение разрешено только для loopback в development.

## Декларативная schema и CRUD

Файл schema экспортирует `databaseSchema`. Каждая таблица явно объявляет ownership scope.

```js
import {
    layerDatabaseSchemaDefine,
    layerTableDefine
} from '@solcorp/layer-database';

const messagesTable = layerTableDefine({
    name: 'messages',
    scope: 'tenant',
    primaryKey: 'id',
    columns: {
        id: {
            type: 'uuid',
            generated: 'uuid'
        },
        chatId: {
            type: 'string'
        },
        text: {
            type: 'string'
        },
        createdAt: {
            type: 'timestamp'
        }
    }
});

export const databaseSchema = layerDatabaseSchemaDefine([
    messagesTable
]);
```

Operation handler получает facade. Tenant/user ownership берётся из проверенного server context и не принимается из `payload`.

```js
const messageTable = context.database.table('messages');

const messages = await messageTable.findMany({
    select: ['id', 'text', 'createdAt'],
    where: context.database.where.equal('chatId', payload.chatId),
    orderBy: [{
        column: 'createdAt',
        direction: 'desc'
    }],
    limit: 50
});
```

Имена таблиц, колонок, сортировок и returning fields проверяются по schema. Значения параметризуются. `update` и `delete` без `where` запрещены; массовая mutation требует `allowMany: true` и bounded `limit`. Сложный trusted server code может использовать только tagged template `context.database.sql`.

`layer build` генерирует `dist/_layer/database.d.ts`. Additive изменения применяются автоматически. Разрушительные изменения сначала просматриваются и применяются явным подтверждением:

```text
layer database schema plan
layer database schema apply <checksum> --confirm-data-loss
```

Основные failure codes: `APPLICATION_DATABASE_REQUIRED`, `DATABASE_CLUSTER_REQUIRED`, `DATABASE_SCHEMA_APPROVAL_REQUIRED`, `DATABASE_DEPENDENCY_UNAVAILABLE`, `DATABASE_QUERY_INVALID` и `DATABASE_MASS_MUTATION_FORBIDDEN`.

## Redis acceleration и cache

### Подключение и восстановление

При штатном `layerServerCreate` Redis подключается в фоне: готовность приложения зависит от основной БД и HTTP runtime, но не от Redis. Во время сбоя кэш обходится, limiter использует durable fallback, а события продолжают доставляться через журнал/опрос БД. `redis: null` полностью отключает Redis; дополнительных параметров для автоматического восстановления не требуется.

Publisher и subscriber восстанавливаются парой, с повторной подпиской. Три повтора относятся к одной короткой серии подключения, а не ко всему времени работы приложения. После неудачной серии следующая запускается автоматически: задержка с jitter растёт примерно от секунды до 30 секунд. Пока подключение ожидается, event loop продолжает обслуживать запросы. Ожидание Redis publish ограничено одной секундой; оно асинхронное и не блокирует event loop, а отказ ускорения не отменяет durable delivery.

После восстановления основной Redis-клиент сначала воспроизводит журнал invalidation; только затем разрешается чтение кэша. Готовность pub/sub проверяется отдельно и требует обоих соединений и подтверждённой подписки. Остановка приложения отменяет фоновые подключения и retry timers. Изменение адреса, credentials или TLS требует перезапуска с новым конфигом; автоматические повторы не исправляют ошибочный пароль.

Redis задаётся одним объектом с `host`, `port`, `username`, `password`, `database` и `tls`. При недоступности Redis distributed token bucket переключается на durable PostgreSQL/PGlite limiter, а события используют журнал и polling fallback.

Query cache включается только явно:

```js
{
    name: 'chat.messages.read',
    type: 'query',
    cache: {
        ttlMs: 30000,
        scope: 'tenant',
        tags: ['chat-messages']
    }
}
```

Transactional command объявляет invalidation отдельно:

```js
{
    name: 'chat.message.send',
    type: 'command',
    transaction: true,
    cacheInvalidation: {
        scope: 'tenant',
        tags: ['chat-messages']
    }
}
```

Invalidation сначала записывается в `sys_cache_invalidations` в транзакции команды. После commit она применяется к Redis. При сбое Redis cursor остаётся на последнем подтверждённом событии; после reconnect Layer повторяет журнал и только затем продвигает Redis cursor.

Server factory получает `context.rateLimiter`, `context.queryCache`, `context.eventBus`, `context.leases`, `context.coordination` и безопасный статус `context.redis`. Чтобы operation executor использовал cache, передайте `context.queryCache` в `layerOperationExecutorCreate`.

Redis coordination доступен только при настроенном Redis. Он не раскрывает raw client и разделяет краткоживущие locks/presence от durable PostgreSQL leases.

```js
const lock = await context.coordination.locks?.acquire('chat:compact', 5000);

if (lock !== null && lock !== undefined) {
    try {
        await messagesCompact();
        await lock.renew(5000);
    } finally {
        await lock.release();
    }
}

await context.coordination.presence?.touch('chat:42', 'user:17', 30000);
const onlineUserIds = await context.coordination.presence?.list('chat:42', 100);
await context.coordination.presence?.remove('chat:42', 'user:17');
```

Lock освобождается и продлевается только владельцем по непредсказуемому token через атомарный Lua compare-and-delete/expire. Presence хранится как bounded TTL lease и очищает истёкшие записи перед чтением. При потере Redis эти ephemeral возможности недоступны явно; singleton jobs продолжают использовать `context.leases` в PostgreSQL/PGlite, что не создаёт split-brain между двумя lock backends.

### Сессии и API-ключи

Системные repositories остаются источником истины. Server factory может обернуть их через `context.identity.create`: при наличии Redis активные identity кэшируются максимум на 30 секунд, а без Redis facade напрямую обращается к PostgreSQL/PGlite.

```js
import {
    layerApiKeyRepositoryCreate,
    layerSessionRepositoryCreate
} from '@solcorp/layer-database';

const identities = context.identity.create({
    sessions: layerSessionRepositoryCreate({
        database: context.databaseRuntime,
        sessionPepper: process.env.LAYER_SESSION_PEPPER
    }),
    apiKeys: layerApiKeyRepositoryCreate({
        database: context.databaseRuntime
    })
});
```

Промахи, revoked и expired identity намеренно не negative-cache. Отзыв сначала изменяет durable запись и добавляет tag в `sys_cache_invalidations` в той же транзакции, затем немедленно очищает Redis. Если Redis недоступен при invalidation, текущий process временно обходит identity cache, а общий cursor replay доставляет пропущенный tag после reconnect. В кэш не записываются исходные session cookie и API-key secret: ключ строится из нормализованного hash, secret API-ключа показывается только при выпуске.

## Workers и leases

### Гарантии очистки Redis-кэша

Entry и его теги записываются атомарно; запись с коротким TTL не сокращает жизнь тега других записей. Если очистка пересеклась с загрузкой данных из SQL, уже начатый запрос может получить свой результат, но этот результат не попадёт обратно в кэш. Это относится и к кэшу сессий/API-ключей при отзыве. Начавшийся до отзыва запрос не откатывается автоматически.

При reconnect Layer обходит кэш до воспроизведения всего доступного журнала, а не только первой порции. PostgreSQL сериализует выделение номеров invalidation в транзакции: cursor не перескакивает через ещё не подтверждённую запись другого worker. Эти транзакции следует держать короткими; внешние HTTP-запросы выполняйте после commit либо через outbox.

Кэш включается явно через metadata операции и не заменяет SQL consistency. Если Redis недоступен, query читает источник данных, а фоновые повторы восстанавливают очистку. При прямом использовании низкоуровневого cache adapter применяйте `execute(request, load)` для защищённого заполнения. Ручной `write` предназначен для уже подготовленных доверенных значений; он не создаёт транзакцию с SQL.

Launcher создаёт отдельные Node child processes на loopback-портах. Caddy использует `least_conn`, active/passive health checks и динамический reload upstreams. Sticky sessions не требуются. Аварийно завершившийся worker удаляется из topology и восстанавливается с bounded exponential retry, пока не достигнут `workers.minimum`.

Singleton background job должен получить durable lease:

```js
const acquired = await context.leases.acquire('jobs:email-digest', 30000);

if (acquired === true) {
    try {
        await digestSend();
        await context.leases.renew('jobs:email-digest', 30000);
    } finally {
        await context.leases.release('jobs:email-digest');
    }
}
```

`maximum: 'auto'` требует внешний PostgreSQL и `connectionBudget`. Верхняя граница учитывает доступные CPU, память и `connectionBudget / maximumConnectionsPerWorker`. Реальную пропускную способность определяют только нагрузочные измерения конкретных Node, PostgreSQL, Redis, сети и запросов приложения.

## Эксплуатационные ограничения

Системные миграции и синхронизация прикладной схемы используют одну блокировку приложения на том же PostgreSQL-соединении, которое читает каталог и выполняет DDL. Каждый worker строит актуальный план после получения блокировки. Commit/rollback освобождает её автоматически. Несовместимый план сохраняется для подтверждения без частичного применения; `schema apply` повторно проверяет checksum под блокировкой. При `DATABASE_SCHEMA_CHECKSUM_MISMATCH` получите новый план и изучите его перед повторным подтверждением.

Недоступная replica не мешает запуску исправного primary: eventual reads временно идут на primary, а health checks возвращают replica в routing после восстановления. Ошибка SQL-запроса (например, unique constraint, неверный тип, syntax или отмена statement) передаётся вызывающему коду и сама по себе не выключает readiness всего приложения. Потеря соединения или остановка primary по-прежнему закрывает write API до восстановления. Автоматического promotion нет.

- Layer не настраивает streaming replication и не выполняет automatic primary promotion.
- PGlite не предоставляет HA и встроенный backup; state directory копируется только после остановки приложения.
- Redis не заменяет PostgreSQL и может быть полностью отключён.
- Caddy и Node не заменяют внешний CDN/WAF при объёмной DDoS-атаке.
- Поддержка 100 000 активных пользователей не объявляется гарантией до production-like load gate.

См. также [production deployment](../runbooks/production-deployment.md), [backup/restore](../runbooks/backup-restore.md) и [DDoS/capacity](../runbooks/ddos-and-capacity.md).
