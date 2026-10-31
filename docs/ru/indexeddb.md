---
title: IndexedDB для данных приложения
description: Схемы, миграции, транзакции, watch и очистка локального хранилища.
audience: intermediate
order: 171
status: documented
updated: 2026-10-28
---

# IndexedDB для данных приложения

Храните черновики и локальные данные отдельно от серверного источника истины. В штатном приложении можно экспортировать `storageSchema` из `src/app.js`; runtime открывает её в своём пользовательском namespace. Для самостоятельного хранилища используйте `layerStorageOpen`, как ниже. Не открывайте вторую копию engine outbox без необходимости.

<!-- contract: storage -->
## Последовательные миграции

<!-- example: application/storage.mjs -->
```js
import {layerStorageOpen, layerStorageSchemaDefine} from '@solcorp/layer-storage';

export const draftSchema = layerStorageSchemaDefine({
    name: 'message-drafts',
    version: 2,
    stores: {
        drafts: {
            keyPath: 'id',
            indexes: {by_room: {keyPath: 'roomId'}}
        }
    },
    migrations: {
        1: function( /** @type {{createStore: (name: string) => void}} */ migration ){
            //Creating the store during the first synchronous upgrade
            migration.createStore( 'drafts' );

        },
        2: function( /** @type {{createIndex: (store: string, index: string) => void}} */ migration ){
            //Adding the declared index for existing version-one databases
            migration.createIndex( 'drafts', 'by_room' );

        }
    }
});

/** @param {string} namespace @param {IDBFactory} [indexedDb] @returns {ReturnType<typeof layerStorageOpen>} */
export async function draftStorageOpen( namespace, indexedDb = globalThis.indexedDB ){
    //Opening a separate identity namespace chosen from authenticated application state
    return layerStorageOpen({
        appId: 'chat',
        namespace,
        schema: draftSchema,
        indexedDb
    });

}

/** @param {Awaited<ReturnType<typeof layerStorageOpen>>} storage @param {{id: string, roomId: string, text: string}} draft */
export async function draftSave( storage, draft ){
    //Keeping all reads and writes inside one IndexedDB transaction
    return storage.transaction( ['drafts'], 'readwrite', async function( transaction ){
        //Reading back the value from the same write transaction
        await transaction.put( 'drafts', draft );
        return transaction.get( 'drafts', draft.id );

    });

}
```

`draftStorageOpen('user-123')` возвращает хранилище; namespace выбирайте по проверенной identity, не по URL. При первой установке выполняются миграции 1 и 2; при переходе с версии 1 — только 2. Функции миграций синхронные и возвращают undefined: нельзя делать fetch/await. Для удаления существуют `deleteStore` и `deleteIndex`, для проверки — `hasStore`. Они работают внутри upgrade и ограничены прикладными stores. Миграция должна привести физические stores/indexes в соответствие новой schema; удаление данных проектируется приложением.

## Чтение, наблюдение и транзакции

```js
const storage = await draftStorageOpen( 'user-123' );
await draftSave( storage, {id: 'draft-1', roomId: 'room-1', text: 'Hello'} );
const draft = await storage.get( 'drafts', 'draft-1' );
const roomDrafts = await storage.query( 'drafts', {index: 'by_room', query: 'room-1', count: 50} );
const stopWatching = storage.watch(
    ['drafts'],
    function(){
        //Reloading drafts after a committed storage change
        return storage.query( 'drafts' );

    },
    function( drafts ){
        //Replacing this output with the application's draft list
        console.log( drafts.length );

    }
);
await storage.delete( 'drafts', 'draft-1' );
stopWatching();
```

`put` заменяет запись с тем же key; `query` возвращает массив, принимает index/query/count. В transaction используйте только запросы этой транзакции: не ждите сеть или таймер, иначе браузер может её завершить. Ошибка откатывает изменения. `watch` делает initial query и перечитывает после успешных локальных транзакций; возвращает unsubscribe. Это не межвкладочная подписка developer stores. Для второй вкладки нужен ваш сигнал обновления и повторный query; engine event coordination не превращает каждую пользовательскую таблицу в realtime store.

## Жизненный цикл и место

`estimate()` возвращает usage/quota (или недоступные значения); `exportUserData()` — объект `{database, exportedAt, stores}`, включая пользовательские и разрешённые системные данные. Это чувствительный экспорт; не отправляйте его автоматически. `close()` закрывает handle, `purgeUserData()` закрывает и удаляет весь этот namespace. До logout/purge завершите операции, отпишитесь и закройте связанные handles во всех вкладках. Данные других namespace не удаляются.

При `layerStorageOpen` доступны `blockedHandle`, `versionChangeHandle` и `blockedTimeoutMs`: сообщите пользователю о старом окне, препятствующем upgrade/delete. На versionchange текущий handle закрывается; используйте новый после перезапуска. Не отключайте это ради вечного старого соединения.

## Failure contract

Недоступный IndexedDB, quota, blocked upgrade, ошибочная migration и закрытый handle завершают Promise ошибкой `LayerStorageError`. Не заменяйте durable outbox на «успешную» запись в память; предложите сохранить текст другим способом. Системные `eventCursors`, `queryCache`, `entities`, `drafts` имеют отдельные facade; пользовательские транзакции не получают произвольный доступ к `__layer_*`.

Далее: [outbox и realtime](offline-realtime.md), [Context API](context-api.md).
