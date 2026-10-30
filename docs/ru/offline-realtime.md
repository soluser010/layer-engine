---
title: Offline, outbox и realtime без WebSocket
description: Durable commands, conflicts, cursor replay и POST Fetch Stream.
audience: intermediate
order: 170
status: release-candidate
updated: 2026-10-20
---

# Offline, outbox и realtime без WebSocket

## Медленные подписчики и ограничение памяти

Серверный `layerEventStreamManagerCreate` ограничивает pending events и frames на подписчика: `maxQueuedEvents` по умолчанию 256, `maxQueuedBytes` — 1048576 байт отдельно для event/write очереди, `writeTimeoutMs` — 10000 мс. Допустимые верхние границы: 4096 событий, 16 MiB и 60000 мс; значения должны быть положительными целыми. Лимит байтов относится к сериализованным данным, а не к полному объёму heap процесса.

Переполнение или истечение write deadline закрывает только медленный stream. Клиент восстанавливается по последнему применённому cursor из PostgreSQL journal; сам disconnect не удаляет события и не подтверждает их применение. При истёкшем cursor используется существующий `eventSync`. Нельзя гарантировать доставку control-frame в уже заблокированный сокет. Общий server drain также ограничен `writeTimeoutMs`; закрытые подписчики не должны накапливать новые replay-запросы. Уже выполняющийся SQL завершается по database deadline.

Outbox обеспечивает at-least-once delivery: если публикация прошла, а запись `markPublished` не удалась, событие может быть отправлено повторно. Дедупликация eventId/sequence обязательна. При сбое releaseFailed lease остаётся до истечения; следующий успешный запуск publisher должен подобрать его. Проверяйте oldest pending и восстановление очереди, а не только единичное сообщение об ошибке БД.

## Цель

Отправлять идемпотентную команду offline и восстанавливать поток событий по cursor.

## Пример

```js
const messageSendCommandData = context.api.command({
    operation: 'chat.message.send',
    offline: {
        strategy: 'outbox'
    }
});

const messageSendResultData = await messageSendCommandData.execute({
    baseRevision: Number( room.revision ),
    roomId: String( room.id ),
    text: String( draftSignal.peek() )
});
```

```js
const eventSubscriptionDispose = context.events.subscribe(
    String( 'chat:' + room.id ),
    async function roomEventReceive( eventData ){
        //Applying the committed domain event to application state
        await roomEventApply( eventData );

    }
);

context.onDestroy(function roomEventDispose(){
    //Removing this component listener and closing an unused channel
    eventSubscriptionDispose();

});
```

## Ожидаемый результат

Команда сначала попадает в IndexedDB outbox, повторная доставка возвращает прежний command result, а event stream продолжает последовательность после reconnect.

## Объяснение

Realtime использует долгий `POST /api` Fetch Stream с `text/event-stream`. Одна вкладка становится лидером через Web Locks/BroadcastChannel. Service Worker постоянным потоком не владеет.

## Команды только онлайн

Для чувствительных payload, например одноразового кода подтверждения телефона, используйте `window.layer.api.commandOnline(operation, payload, {baseRevision: 0})` или alias `window.layer.commandOnline`. Этот вызов не записывает команду в IndexedDB outbox и не выполняет offline replay. При отсутствии сети он завершается `COMMAND_OFFLINE`; восстановление соединения не запускает отложенную отправку. Обычный `context.api.command` сохраняет команду в outbox, поэтому для такого кода он не подходит. Контракт, пример и правила повторного вызова — в [CommandOnline](context-api.md#commandonline).

## Восстановление снимка и cursor

В `src/app.js` экспортируйте `eventSync(gap, context)`. Layer вызывает его при разрыве sequence, сообщении `snapshot-required` и HTTP `CURSOR_EXPIRED/409` до открытия потока. Контекст содержит `api`, `storage` и `signal`. Приложение получает разрешённый снимок через свою `sync`-операцию; это не повтор команды.

```js
import {domainSnapshotApply} from './domain/snapshot.js';

export async function eventSync( gap, {api, storage, signal} ){
    //Getting an authorized snapshot and its cursor from the same consistent server-side point
    const snapshotResult = await api.sync( 'application.state.sync', {channel: gap.channel}, {signal} );
    signal?.throwIfAborted();

    //Installing application state before acknowledging the associated event sequence
    await domainSnapshotApply( snapshotResult.data, {signal} );
    signal?.throwIfAborted();
    await storage.eventCursors.write( gap.channel, snapshotResult.data.cursor );

    //Returning this tab's exact applied position rather than another tab's newer shared cursor
    return {cursor: snapshotResult.data.cursor};

}
```

`application.state.sync` и `domainSnapshotApply` — части приложения, не готовые функции Layer. Операция проверяет identity, permissions и доступ к каналу. Данные снимка и cursor должны соответствовать одному согласованному состоянию: нельзя загрузить данные, затем без согласования подставить более новый event head. Примените снимок к источнику данных/UI до продвижения cursor.

Рекомендуемый результат hook — `{cursor: nonNegativeSafeInteger}`. Layer валидирует позицию и повторно открывает поток с обычной авторизацией. Старый hook, возвращающий `undefined`, поддерживается: Layer перечитывает durable cursor. При конкурентной работе вкладок возвращайте явный `{cursor}`, иначе общий IndexedDB cursor может уже опережать снимок конкретной вкладки.

Лидер использует минимальную позицию вкладок для первоначального replay, затем продвигает отдельный сетевой cursor. После снимка он уведомляет followers только о каналах: каждая вкладка вызывает собственный `eventSync`. Снимки и события обрабатываются последовательно; дубли не применяются снова. Общий IndexedDB cursor не подменяет позицию применённого состояния каждой вкладки.

Не более трёх последовательных snapshot recovery на канал допускается без нового применённого события. `STREAM_RECOVERY_STALLED` прекращает цикл; `STREAM_RECOVERY_INVALID` означает некорректные каналы или cursor; отсутствие hook даёт `EVENT_SYNC_REQUIRED`. Отказы `401/403` нельзя превратить в бесконечный retry через `eventFailure`. Hook `eventFailure({error, attempt, retryDelayMs})` возвращает boolean для обычных транспортных повторов. Lifecycle failures передаются в `onError`.

При logout/dispose/замене подписки Layer отменяет ожидание hook и не открывает новый поток. Сам hook обязан учитывать `signal`: framework не может отменить произвольную пользовательскую запись, игнорирующую отмену. Не обнуляйте cursor и не выбирайте текущую последовательность без применения соответствующего снимка.

## Типовые ошибки

- Новый `commandId` при retry создаёт новую команду.
- Игнорирование `baseRevision` скрывает конфликт.
- Хранение cursor только в памяти теряет возможность replay после перезапуска.

## Failure contract

Разрыв sequence переводит runtime в `sync`/snapshot. Конфликт возвращается приложению или объявленной merge-policy; скрытого last-write-wins нет. Backoff использует jitter и не создаёт reconnect storm.

Далее: [PWA и Service Worker](pwa-service-worker.md), [Context API](context-api.md).
