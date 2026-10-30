---
title: Серверные события от транзакции до вкладки
description: Авторизация каналов, журнал, outbox, доставка и восстановление.
audience: advanced
order: 174
status: release-candidate
updated: 2026-10-28
---

# Серверные события от транзакции до вкладки

Цель — доставлять только подтверждённые изменения, изолированные по tenant. Это serverEntry-интеграция существующих primitives; её нельзя заменить публикацией в Redis из браузера.

<!-- contract: events -->
## Подключение и операция

<!-- example: application/events.mjs -->
```js
import {
    layerEventRepositoryCreate,
    layerOutboxRepositoryCreate,
    layerEventStreamManagerCreate,
    layerEventDistributionCreate,
    layerOutboxPublisherCreate,
    layerEventsOpenOperationDefinitionCreate
} from '@solcorp/layer-events';

/** @param {any} launcher @param {any} registry @param {any} diagnostics @returns {Record<string, any>} */
export function messageEventsCreate( launcher, registry, diagnostics ){
    //Keeping the system adapter inside trusted bootstrap, never in an operation payload
    const eventRepository = layerEventRepositoryCreate({database: launcher.databaseRuntime});
    const outboxRepository = layerOutboxRepositoryCreate({database: launcher.databaseRuntime});
    const eventStream = layerEventStreamManagerCreate({eventRepository, diagnostics});
    const eventDistribution = layerEventDistributionCreate({
        eventBus: launcher.eventBus,
        eventRepository,
        streamManager: eventStream,
        diagnostics
    });
    const publisher = layerOutboxPublisherCreate({
        outboxRepository,
        eventBus: launcher.eventBus,
        owner: launcher.workerId
    });

    //Authorizing the exact tenant channel using verified identity, not payload ownership
    registry.define( layerEventsOpenOperationDefinitionCreate({
        permissions: ['messages.read'],
        channelAuthorize: function( channel, security ){
            //Accepting only this verified tenant's exact application channel
            return typeof security.tenantId === 'string' &&
                channel === 'tenant:' + security.tenantId + ':messages';

        }
    }) );

    return {eventRepository, eventStream, eventDistribution, publisher};

}

/** @param {{text: string}} payload @param {any} context */
export async function messageSend( payload, context ){
    //Writing application data through the executor's transaction-bound facade
    const message = await context.database.table( 'messages' ).insert({
        values: {text: payload.text, revision: 1},
        returning: ['id', 'text', 'revision']
    });
    const tenantKey = context.security.tenantId;

    //Appending the domain event and delivery outbox before the same transaction commits
    await context.events.append({
        tenantKey,
        channel: 'tenant:' + tenantKey + ':messages',
        entityRevision: message.revision,
        type: 'message.created',
        payload: message
    });

    return message;

}
```

`launcher` — context фабрики `layerServerCreate`, `registry` — ваш operation registry, `diagnostics` — `layerDiagnosticsCreate(...)`. Таблица messages определена в [Structured CRUD](structured-data.md). Определение messageSend должно требовать session, messages.write, transaction:true и строгие schemas, включая служебные поля commandId/baseRevision в payload по [контракту команды](operations.md); tenantId обязателен в вашей серверной identity. Не используйте публичный auth:none для этой операции.

Передайте возвращённый `eventRepository` в `layerOperationExecutorCreate` вместе с `database: launcher.databaseRuntime` и `databaseSchema: launcher.databaseSchema`. В `layerHttpRuntimeCreate` передайте `eventStream` и `eventDistribution`, executor и прочие зависимости из [server runtime](server-runtime.md). HTTP lifecycle запускает distribution и выполняет stream drain при stop.

Вызывайте `publisher.runOnce()` в управляемом серверном цикле, например раз в секунду, без перекрывающихся запусков. На stop прекратите планирование, дождитесь текущего runOnce и HTTP drain, затем закрывайте БД. Outbox leases допускают publisher на каждом worker; отдельный необслуживаемый setInterval не является lifecycle. Ошибки фиксируются через безопасные diagnostics и повторяются после истечения lease/восстановления зависимости.

## Где проходит подтверждение

Штатный host запускает Redis pub/sub в фоне и восстанавливает его после длительного сбоя; резервный transport БД остаётся активным. Если вы вручную собираете host, передайте `backgroundConnect: true` в `layerRedisEventBusCreate` и используйте `layerHybridEventBusCreate` с durable fallback. `await bus.start(listener)` в этом режиме означает запуск lifecycle, а не готовую подписку; проверяйте `bus.isReady()` отдельно. По умолчанию низкоуровневый `start` ожидает первую ограниченную серию и может отклонить Promise, но фоновые повторы продолжаются до `stop()`. После отказа вызывайте `stop()`, если больше не используете объект. `layerCacheInvalidationSynchronizerCreate(...).start({background: true})` также не ожидает первый проход; `stop()` должен выполняться вместе с отменой ожидающего transport подключения.

| Шаг | Гарантия |
| --- | --- |
| Executor начинает command transaction | Replay identity проверяет actor/operation/payload |
| Handler изменяет message и вызывает events.append | sequence, journal и outbox записываются в ту же SQL-транзакцию |
| Executor сохраняет command result и commits | Ошибка до commit откатывает все записи |
| Publisher читает outbox и публикует routing metadata | Redis ускоряет; PostgreSQL остаётся источником payload |
| Distribution загружает event по tenant/eventId | Stream manager отправляет только авторизованным подписчикам |
| Runtime применяет event и сохраняет cursor | Повтор eventId/sequence не означает повтор бизнес-действия |

Outbox — at-least-once, не exactly-once транспорт. Отправка до markPublished может повториться. Нельзя ставить cursor вперёд до успешного применения события.

## Два tenant и восстановление

Для tenant A разрешён только `tenant:A:messages`, для B — `tenant:B:messages`. Проверка выше отклоняет попытку A подписаться на B, даже если клиент знает имя канала. Tenant key в events.append берётся из context.security; сам low-level append доверяет серверному коду и не исправляет ошибочный key разработчика.

На клиенте `context.events.subscribe(channel, handler)` использует общий POST Fetch Stream и multi-tab coordination. При разрыве — replay по cursor. Если журнал уже не хранит нужный диапазон, `eventSync` вызывает авторизованную sync-операцию приложения, получает согласованный snapshot/cursor, применяет данные и только потом возвращает cursor. Полный пример hook — в [offline/realtime](offline-realtime.md). Обычный SELECT данных и отдельное чтение более нового head не образуют согласованный snapshot.

## Failure contract

Нет доступа к каналу — `OBJECT_ACCESS_DENIED`; нет identity — `AUTH_REQUIRED`. Отсутствующий journal/transport — ошибка зависимости, а не пустой успешный stream. Медленный подписчик отключается в пределах queue/write limits и восстанавливается по cursor. На logout снимаются подписки и закрывается старый namespace; credentials разных tenants не объединяются.

Далее: [offline/realtime](offline-realtime.md), [cache](cache-outbox.md).
