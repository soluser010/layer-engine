---
title: Structured CRUD и ревизии
description: Прикладная schema, изоляция владельцев, атомарное изменение и ошибки.
audience: intermediate
order: 145
status: documented
updated: 2026-10-28
---

# Structured CRUD и ревизии

Цель — работать с прикладными таблицами через `context.database` в серверной операции. Нужен внешний PostgreSQL; встроенный PGlite хранит системные данные. Подключение и синхронизация schema описаны в [database runtime](database-runtime.md).

<!-- contract: database -->
## Schema и атомарное редактирование

Schema из следующего примера экспортируется именованным `databaseSchema` из `src/server/database.js`; handler `messageEdit` размещается в серверном модуле операций. Здесь они показаны вместе для связи типов и проверки ревизии.

<!-- example: application/database.mjs -->
```js
import {layerDatabaseSchemaDefine, layerTableDefine} from '@solcorp/layer-database';
import {LayerError} from '@solcorp/layer-protocol';

export const databaseSchema = layerDatabaseSchemaDefine([
    layerTableDefine({
        name: 'messages',
        scope: 'tenant',
        primaryKey: 'id',
        columns: {
            id: {type: 'uuid', generated: 'uuid'},
            text: {type: 'string'},
            revision: {type: 'integer'}
        }
    })
]);

/**
 * @param {{id: string, text: string, baseRevision: number}} payload
 * @param {{database: ReturnType<typeof import('@solcorp/layer-database').layerDatabaseFacadeCreate>}} context
 */
export async function messageEdit( payload, context ){
    //Combining ownership and revision checks in the same atomic UPDATE
    const database = context.database;
    const messages = await database.table( 'messages' ).update({
        values: {text: payload.text, revision: payload.baseRevision + 1},
        where: database.where.and(
            database.where.equal( 'id', payload.id ),
            database.where.equal( 'revision', payload.baseRevision )
        ),
        returning: ['id', 'text', 'revision']
    });

    //Reporting the same safe conflict for missing, inaccessible or changed records
    if ( messages.length !== 1 ){
        throw new LayerError( 'REVISION_CONFLICT', 'Reload the message before editing.', {status: 409} );

    }

    return messages[0];

}
```

Сохраните именно именованный export `databaseSchema`; default export загрузчик не использует. Для операции задайте `type: 'command'`, `auth: 'session'`, `permissions: ['messages.edit']`, `transaction: true` и строгие input/output schemas. Вход: UUID `commandId`, UUID `id`, ограниченная строка `text`, целое `baseRevision >= 0`; результат: `id`, `text`, `revision`. Runtime создаёт `commandId`, но серверная input schema обязана разрешать и проверять это поле в payload. Для offline replay дополнительно требуется `offlineReplay: true`. См. [полную регистрацию](operations.md).

Результат: UPDATE изменяет не более одной доступной записи с ожидаемой ревизией. Tenant-фильтр добавляется из проверенного `context.security`. Нет совпадения — HTTP 409 / `REVISION_CONFLICT`. Это сознательно не раскрывает, существовала ли чужая запись. Клиент загружает свежие данные, предлагает пользователю сравнение и отправляет новое намерение с новой ревизией и новым commandId. Само наличие baseRevision в envelope не выполняет эту проверку.

## Чтение, вставка и удаление

```js
const table = context.database.table( 'messages' );
const where = context.database.where;
const created = await table.insert({
    values: {text: 'Hello', revision: 1},
    returning: ['id', 'text', 'revision']
});
const message = await table.findOne({
    where: where.equal( 'id', created.id ),
    select: ['id', 'text', 'revision']
});
const page = await table.findMany({
    where: where.greaterThan( 'revision', 0 ),
    orderBy: [{column: 'id', direction: 'asc'}],
    limit: 50,
    offset: 0
});
const total = await table.count({where: where.greaterThan( 'revision', 0 )});
const present = await table.exists({where: where.equal( 'id', created.id )});
const removed = await table.delete({
    where: where.equal( 'id', created.id ),
    returning: ['id']
});
```

| Метод | Результат и ограничения |
| --- | --- |
| `findOne` | Запись или null; читает максимум одну |
| `findMany` | Массив; limit по умолчанию 50, максимум 100; offset до 100000 |
| `count`, `exists` | Число и boolean; те же ownership-фильтры |
| `insert` | Одна запись; generated-поля не передаются в values |
| `update`, `delete` | Массив изменённых/удалённых записей; обязательный where; по умолчанию максимум одна |
| `returning`, `select` | Только разрешённые schema-поля; без списка — объявленные поля таблицы |

`delete` физический. Массовое изменение требует `allowMany: true, limit: 20` (до 100) и where. Ограничение количества не заменяет permissions и проверку бизнес-прав. Для полного обхода страниц задавайте стабильную сортировку; большие смещения заменяйте keyset-фильтром по ключу.

Filters: `equal`, `notEqual`, `greaterThan`, `lessThan`, `in`, `isNull`, `and`, `or`. Группы принимают 2–20 дескрипторов, `in` — до 100 значений; глубина до 8, всего до 50 узлов. Конструируйте фильтры на сервере: JSON из payload не является готовым SQL-фильтром.

## Типы и владение

Типы колонок: `boolean`, `integer` (safe integer), `number` (finite), `string`, `uuid`, `timestamp`, `json`. Timestamp передаётся ISO-строкой или Date и возвращается ISO-строкой; nullable разрешает null. JSON должен сериализоваться. Имена и значения проверяются отдельно, значения передаются SQL-параметрами.

`scope: 'global'` — общая таблица, права проверяет операция. `tenant` добавляет `sys_tenant_id`, `user` — `sys_user_id`; ownership берётся из server identity. User-scope использует userId: он должен быть глобально уникален. Для tenant-local user IDs выбирайте tenant-scope и дополнительный проверенный user-фильтр. Нельзя превратить payload.tenantId в security context.

## Транзакции и сложный SQL

```js
await context.database.transaction( async function( database ){
    //Rolling back both inserts if either validation or SQL execution fails
    await database.table( 'messages' ).insert({values: {text: 'First', revision: 1}});
    await database.table( 'messages' ).insert({values: {text: 'Second', revision: 1}});

});
```

Этот вариант нужен вне уже открытой транзакционной операции. При `transaction: true` facade уже привязан к транзакции executor; вложенный вызов запрещён (`DATABASE_TRANSACTION_INVALID`). Исключение откатывает её; не ловите ошибку с продолжением как будто запись успешна.

`database.sql` — server-only tagged template для доверенного кода:
```js
const result = await context.database.sql`SELECT ${Number( payload.value )}::integer AS value`;
```
Интерполяции — значения, не имена таблиц или SQL-фрагменты. Raw SQL не добавляет ownership-фильтры: для прикладной выборки разработчик сам задаёт проверенные tenant/user predicates и ограничение результата. Не передавайте этот интерфейс браузеру или плагину без доверия. Обычный CRUD предпочтительнее.

## Failure contract

`DATABASE_QUERY_INVALID` — неверный фильтр/поле/тип; `DATABASE_TABLE_NOT_FOUND` — имя вне schema; `APPLICATION_DATABASE_REQUIRED` — прикладные таблицы без внешнего PostgreSQL. Ошибка драйвера не должна раскрывать SQL/credentials клиенту. Strong reads идут на primary; `consistency: 'eventual'` явно разрешает здоровую replica с допустимым lag. Результат команды сразу перечитывайте strong.

Далее: [серверные события](server-events.md), [offline и конфликты](offline-realtime.md).
