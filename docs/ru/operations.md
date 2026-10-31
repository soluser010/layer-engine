---
title: Операции — полный и упрощённый подход
description: src/operations.js, server handlers, generated facade, permissions, limits, transactions и failure contracts.
audience: intermediate
order: 110
status: documented
updated: 2026-09-24
---

# Операции: полный и упрощённый подход

## Цель

Создать query или command один раз, получить одинаковый schema-контракт в browser/server и выбрать подходящий уровень удобства клиента.

Операция — именованное действие единого POST /api. query читает данные, command изменяет состояние, sync восстанавливает snapshot. events.open является системным transport contract и не объявляется в клиентском src/operations.js.

## Два файла, две зоны доверия

- src/operations.js содержит только static JSON-compatible metadata. Compiler разбирает AST без выполнения кода.
- src/server/operations.js присоединяет handler, authorize и server-only metadata. Этот код никогда не входит в browser bundle.

### Минимальный публичный query

```js
import {layerOperationContractsCreate} from '@solcorp/layer';

export const operations = layerOperationContractsCreate([
    {
        name: 'profile.public.read',
        type: 'query',
        auth: 'none',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['profileId'],
            properties: {
                profileId: {
                    type: 'string',
                    format: 'uuid'
                }
            }
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['profileId', 'displayName'],
            properties: {
                profileId: {
                    type: 'string',
                    format: 'uuid'
                },
                displayName: {
                    type: 'string',
                    maxLength: 120
                }
            }
        }
    }
]);
```

auth: none всегда пишется явно. Отсутствующий auth означает session. additionalProperties: false не позволяет незаметно принять лишнее поле.

### Подключение handler на сервере

```js
import {operations} from '../operations.js';

export function applicationOperationsRegister( operationRegistryData, servicesData ){
    //Getting the static contract shared with the browser build
    const profileReadOperationData = operations.find(function operationFind( operationData ){
        //CallBack THE BOOLEAN
        return String( operationData.name ) === String( 'profile.public.read' );

    });

    //Checking the contract and service before mutating the registry
    if (
        profileReadOperationData === undefined ||
        typeof servicesData.profileRead !== String( 'function' )
    ){
        //Passing the incomplete server module to startup
        throw new TypeError( String( 'The profile.public.read operation is incomplete.' ) );

    }

    //Registering trusted behavior separately from client-visible metadata
    operationRegistryData.define({
        ...profileReadOperationData,
        handler: servicesData.profileRead
    });

}
```

После регистрации всех прикладных и системных операций registry вызывается seal(). list() не раскрывает handler, schemas и compiled validators.

## Рекомендуемый клиент: generated facade

После layer build dotted name profile.public.read становится profilePublicReadQueryCreate. JSON Schema формирует input/output declarations и IntelliSense.

```js
import {profilePublicReadQueryCreate} from '#layer/operations';

export default layerComponentCreate(function ProfilePage( properties, context ){
    //Creating a lifecycle-owned typed query handle
    const profileQueryData = profilePublicReadQueryCreate( context, {
        payload: function payloadCreate(){
            //CallBack THE OBJECT
            return {
                profileId: String( properties.profileId )
            };

        },
        cache: {
            policy: 'cache-and-network',
            maxAgeMs: 30000
        },
        offline: {
            fallback: 'cache'
        }
    });

    //Rendering query state through direct signal bindings
    return html`<output>${profileQueryData.status}</output><p>${profileQueryData.data}</p>`;

});
```

Generated wrapper использует тот же context.api и не создаёт второй transport. Query handle содержит read-only signals data, pending, error, status, source и методы refresh/cancel/settled/dispose.

## Упрощённый клиент

Когда generated types не нужны или operation name выбирается инфраструктурой, используйте context.api напрямую:

```js
const profileQueryData = context.api.query({
    operation: 'profile.public.read',
    payload: {
        profileId: properties.profileId
    }
});
```

Это безопасно: envelope, requestId, CSRF, response validation, cache и lifecycle всё равно принадлежат runtime. Менее желательно вручную вызывать window.layer.query; этот low-level API оставлен для инфраструктуры и совместимости.

## Полный production command

Shared contract добавляет auth: session, permissions, rateLimitBucket, cost, timeoutMs, concurrency, transaction: true, offlineReplay: true, audit и строгие schemas. commandId и baseRevision находятся в schema, но generated facade не требует commandId от author payload: runtime создаёт его до записи в outbox.

Server definition дополнительно присоединяет:

- authorize(payload, context) для ownership и writable fields;
- handler(payload, context);
- cacheInvalidation только для transactional command;
- server-derived user/tenant из context.security;
- database facade/transaction из context.database.

Полный исполняемый пример находится в fixtures/documentation/full. Минимальный — в fixtures/documentation/minimal; оба запускаются через npm run docs:check.

## Как выбрать объём metadata

| Сценарий | Минимум | Добавить |
| --- | --- | --- |
| Публичный справочник | query, auth none, schemas, handler | global cache при реальной пользе |
| Личные данные | query, schemas, handler | permissions, authorize, user/tenant scope |
| Простая online mutation | command, schemas, handler | permissions, transaction |
| Offline mutation | command | transaction, offlineReplay, baseRevision, rollback UX |
| Дорогой запрос | query | cost, отдельный bucket, timeout, concurrency |
| Привилегированное действие | command | permissions, authorize, audit category |

Не копируйте максимальные metadata механически. Но validation, auth decision и bounded execution обязательны для любого публичного действия.

## JSON Schema

Используется Draft 2020-12 в strict mode. Запрещены dynamic JavaScript, spread, methods, prototype keys и неизвестные корневые поля contract. Schema должна ограничивать строки, массивы, вложенность и enumeration там, где домен это знает. Output тоже валидируется: неверный результат handler становится server error, а не недоверенными данными браузера.

## Identity, authorization и BOLA

Никогда не принимайте userId, tenantId, roles или permissions из payload как источник доступа. Проверка аутентификации формирует context.security. context.auth — отдельное optional расширение managed Layer Auth; минимальный server не получает его автоматически. permissions проверяются до handler, authorize — для конкретного объекта и полей. Отказ возвращает безопасный OBJECT_ACCESS_DENIED без раскрытия существования объекта.

## Idempotency, conflicts и offline

Offline command сначала записывается в IndexedDB outbox. Для `transaction: true` повтор `commandId` возвращает сохранённый результат только тому же проверенному пользователю (или тому же API key), в том же tenant, для той же операции и того же payload. Порядок ключей объекта не важен; значения, порядок элементов массивов и `baseRevision` важны. Повторная проверка `authorize` остаётся обязательной. Одновременные повторы сериализуются транзакционной блокировкой PostgreSQL; обработчик успешно зафиксированной команды не вызывается второй раз.

Другая identity, изменённый payload или операция получают `REVISION_CONFLICT`. Не обходите этот отказ автоматическим созданием нового `commandId`: сначала выясните результат исходной команды. Миграция 10 добавляет identity/digest без удаления результатов. Старые записи без этих полей не перепривязываются к первому повторившему запросу и возвращают `REVISION_CONFLICT`. Анонимная транзакционная команда может выполниться один раз, но её сохранённый результат повторно не раскрывается: для offline replay используйте аутентификацию.

`baseRevision` сам по себе не сравнивается движком с прикладной записью. Обработчик должен проверить текущую ревизию в транзакции и вернуть `REVISION_CONFLICT`, если она изменилась; приложение явно решает merge/retry. Скрытого last-write-wins нет. Внешние HTTP-вызовы обработчика не становятся частью SQL-транзакции: используйте outbox для внешних эффектов.

## Ошибки

INVALID_PAYLOAD означает неверный input. Неверный output handler даёт INTERNAL_ERROR без раскрытия внутреннего результата. AUTH_REQUIRED и PERMISSION_DENIED относятся к identity. RATE_LIMITED могут быть retryable. OPERATION_TIMEOUT ограничивает handler. Не повторяйте non-retryable command с новым commandId автоматически.

## Проверка

- unit test handler с поддельным server context;
- registry test на defaults/authorize/handler visibility;
- protocol test на schema boundaries;
- integration test на session, CSRF, permission и transaction rollback;
- offline test на replay/conflict;
- threat test на BOLA, injection, oversized payload и rate-limit bypass.

Далее: [Context API](context-api.md), [server runtime](server-runtime.md), [security](security-auth.md).
