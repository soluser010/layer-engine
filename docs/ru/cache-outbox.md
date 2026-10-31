---
title: Локальный cache и очередь команд
description: Оптимистичный интерфейс, просмотр очереди и явное разрешение конфликтов.
audience: advanced
order: 172
status: documented
updated: 2026-10-28
---

# Локальный cache и очередь команд

В компонентах используйте [Context API](context-api.md). Ниже уточняется управление локальными данными; это отдельный слой от серверного Redis cache.

<!-- contract: cache -->
## Обновление активных query

```js
const query = window.layer.api.query({operation: 'chat.messages.list', payload: {roomId: 'room-1'}});
await query.settled();
const cache = window.layer.api.queryCache;
await cache.insert( query.cacheKey, {commandId: 'pending-1', text: 'Pending'} );
await cache.update( query.cacheKey, function( current ){
    //Returning a new collection instead of mutating a shared snapshot
    return {...current, items: current.items.slice( -50 )};

});
await cache.remove( query.cacheKey, function( item ){
    //Removing a particular optimistic record
    return item.commandId === 'pending-1';

});
await cache.removeByCommandId( 'pending-1' );
await query.refresh();
query.dispose();
```

Предполагается результат операции `{items: [...]}`; insert/remove также принимают простой массив, а для скаляра выбрасывают TypeError. Методы возвращают число выбранных активных query (не число строк). Selector — имя операции (все её активные query) либо точный `query.cacheKey`; для отдельных комнат выбирайте ключ. `removeByCommandId` ищет поле commandId во всех активных коллекциях и пропускает скаляры.

Ключ по умолчанию строится из operation/payload. Identity isolation обеспечивает namespace IndexedDB; секреты не должны быть частью payload/key. Custom `cache.key` обязан различать параметры, иначе вы сами объедините несовместимые query. Методы не обходят все исторические записи IndexedDB, не публикуют серверную invalidation и не меняют данные PostgreSQL.

После успеха optimistic command удалите временную запись по реальному commandId и перечитайте query или установите подтверждённый результат. В rollback удалите временную запись; не откатывайте весь старый список поверх более новых данных. Событие сервера и результат команды могут прийти в любом порядке: дедуплицируйте по доменному id/revision. Для invalidation клиентского чтения используйте `refresh()`; отдельного универсального `cache.invalidate()` здесь нет. Серверные cacheInvalidation tags описаны в [базах данных](database-runtime.md).

<!-- contract: outbox -->
## Просмотр очереди после перезапуска

Обычный `context.api.command(...).execute(...)` владеет жизненным циклом одной команды; низкоуровневый `window.layer.command` возвращает handle с result/retry/cancel/resolveConflict/snapshot. Persisted records остаются после reload, а JS handles — нет.

Следующий advanced helper работает с публичным `layerOfflineOutboxCreate`. Передайте уже открытое хранилище текущего пользователя (`await window.layer.storageReady()`) и авторизованный `layerApiClientCreate` вашей server integration. Он должен использовать тот же `/api`, cookie/CSRF источник и namespace, что основной runtime. Не создавайте вторую identity и не отключайте CSRF. В managed app не нужен второй постоянно работающий drain: вызывайте helper только для панели очереди/явного retry.

<!-- example: application/outbox.mjs -->
```js
import {layerOfflineOutboxCreate} from '@solcorp/layer-storage';

/** @param {Awaited<ReturnType<typeof import('@solcorp/layer-storage').layerStorageOpen>>} storage @param {any} apiClient */
export function pendingCommandsCreate( storage, apiClient ){
    //Sharing the existing identity namespace and authenticated protocol client
    const outbox = layerOfflineOutboxCreate({
        storage,
        ownerId: globalThis.crypto.randomUUID(),
        commandIdCreate: function(){
            //Creating a fresh identity only for a new intent or resolved conflict
            return globalThis.crypto.randomUUID();

        },
        commandSend: function( command ){
            //Preserving the original command identity during transport retries
            return apiClient.command( command.operation, command.payload, {
                commandId: command.commandId,
                baseRevision: command.baseRevision
            });

        }
    });

    return {
        list: function(){
            //Reading persisted records again after a document restart
            return outbox.list();

        },
        watch: outbox.watch,
        /** @param {string} commandId */
        async retry( commandId ){
            //Retrying existing failed intent without changing its identity
            await outbox.retry( commandId );
            await outbox.drain();
            return outbox.get( commandId );

        },
        /** @param {string} commandId @param {Parameters<ReturnType<typeof layerOfflineOutboxCreate>['resolveConflict']>[1]} resolution */
        async resolve( commandId, resolution ){
            //Replacing conflicted intent only after the user has reviewed current server data
            const replacementId = await outbox.resolveConflict( commandId, resolution );
            await outbox.drain();
            return outbox.get( replacementId );

        },
        cancel: outbox.cancel,
        drain: outbox.drain
    };

}
```

```js
const rows = await pending.list();
const conflict = rows.find( function( row ){
    //Selecting a command that requires an explicit conflict decision
    return row.status === 'conflict';

} );
//Resolving only an existing conflict after the user has confirmed the merged text
if ( conflict !== undefined ){
    const resolved = await pending.resolve( conflict.commandId, {
        operation: conflict.operation,
        payload: {id: latest.id, text: mergedText},
        baseRevision: latest.revision,
        conflictDomain: conflict.conflictDomain
    });

}

```

`pending` — созданный helper; latest — новый серверный снимок; mergedText — подтверждённый пользователем текст. UI обязан сначала проверить наличие conflict. Статусы: queued, sending, retryable, failed, conflict, confirmed, cancelled, resolved. `list({statuses})` есть у низкоуровневого outbox; helper выше показывает все. `watch(commandId, listener)` возвращает unsubscribe; повторите list при входе на экран после reload.

Retry разрешён для failed/retryable и сохраняет commandId. Resolve доступен только для conflict, создаёт новый commandId, старый record получает resolved/supersededBy. Обычная retry не снимает конфликт. Cancel разрешён до активной отправки и не отменяет уже совершённый серверный commit.

Подтверждение записывается как `confirmed` автоматически после ответа сервера; отдельного публичного acknowledge нет. `record.result` содержит сохранённый transport result. Ожидаемый результат панели — состояние команды и безопасная ошибка, не бесконечный spinner. Неразрешённый конфликт блокирует последующие команды того же conflictDomain, но не другие домены.

## Failure contract

`OUTBOX_STATE_INVALID` означает неподходящий статус; `OUTBOX_COMMAND_INVALID` — некорректную команду. Ошибка сети оставляет retryable intent; schema/auth/domain ошибки требуют явного решения. Не меняйте commandId при сетевом повторе, не пересылайте очередь другого пользователя после logout. Dispose наблюдателя не удаляет durable history.

Далее: [IndexedDB](indexeddb.md), [reconnect и snapshot](offline-realtime.md).
