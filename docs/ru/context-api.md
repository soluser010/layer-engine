---
title: Context API компонентов
description: Высокоуровневые query, command, events и lifecycle handles.
audience: intermediate
order: 120
status: documented
updated: 2026-09-30
---

# Context API компонентов

Viewport, input policies, scroll anchors, lifecycle-owned `context.viewport` и `context.keyboard` (show/hide/state/subscribe/capability): [оболочка приложения](viewport.md).

`context.api` — высокоуровневый клиентский API для `*.layer.js`. Компонент не создаёт protocol envelope и не вызывает `fetch('/api')` вручную. Application runtime владеет транспортом, IndexedDB query cache и transactional outbox; component bundle преобразует snapshots runtime в локальные read-only signals.

Низкоуровневые `window.layer.query(operation, payload, options)` и `window.layer.command(operation, payload, options)` сохраняются для инфраструктуры и совместимости. В компонентах следует использовать объектный контракт `context.api`.

## Query

Фрагмент ниже размещается внутри функции компонента `(properties, context)`. `properties.conversationId` — идентификатор открытого диалога; операция `chat.messages.list` должна быть объявлена в вашем приложении.

```js
const messagesQuery = context.api.query({
    operation: 'chat.messages.list',
    payload: function(){
        //Reading the current conversation when the query runs
        return {
            conversationId: properties.conversationId,
            limit: 50
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
```

Read-only signals:

- `data` — `data` из success envelope либо последнее допустимое cache value;
- `pending` — выполняется чтение cache или network request;
- `error` — безопасная ошибка runtime либо `null`;
- `updatedAt` — локальное время последнего применённого snapshot;
- `stale` — данные нельзя считать свежими;
- `status` — `loading`, `success`, `stale` или `error`;
- `source` — `cache`, `network`, `local` либо `null`.

Методы: `refresh()`, `cancel()`, `settled()`, `cacheUpdate(updater)`, `cacheInsert(value)`, `cacheRemove(predicate)`, `dispose()`.

Политики cache:

- `cache-and-network` — сначала допустимый cache snapshot, затем сеть;
- `cache-first` — свежий cache завершает запрос, stale cache обновляется из сети;
- `network-only` — cache не читается, успешный результат сохраняется;
- `no-store` — cache не читается и не записывается.

При `offline.fallback: 'cache'` stale data используется только при отсутствии сети или retryable transport failure. Ошибки авторизации, прав и валидации никогда не маскируются cache-данными. Для больших или чувствительных payload следует указать короткий безопасный `cache.key`; секреты не должны входить в ключ.

## Command

```js
const messageSendCommand = context.api.command({
    operation: 'chat.message.send',
    offline: {
        strategy: 'outbox'
    },
    optimistic: {
        apply: async function( commandPayload, queryCache ){
            //Displaying a pending message until the server confirms the command
            await queryCache.insert( 'chat.messages.list', {
                commandId: commandPayload.commandId,
                text: commandPayload.text,
                state: 'pending'
            });

            return commandPayload.commandId;

        },
        rollback: async function( _commandError, queryCache, optimisticCommandId ){
            //Removing the optimistic message after a rejected command
            await queryCache.removeByCommandId( optimisticCommandId );

        }
    }
});

await messageSendCommand.execute({
    conversationId: properties.conversationId,
    text: messageDraft.peek(),
    baseRevision: conversationRevision.peek()
});
```

Read-only signals: `pending`, `error`, `lastResult`, `commandId`, `state`. Методы: `execute(payload, options)`, `cancel()`, `settled()`, `dispose()`.

`baseRevision` разрешён как shorthand в payload, но runtime удаляет его из domain payload и передаёт как protocol metadata. Команда сначала фиксируется в user-isolated IndexedDB outbox. Только после durable commit разрешён optimistic update и сетевой drain. При terminal failure вызывается declared rollback; скрытого last-write-wins нет.

Одновременно один command controller выполняет одну операцию. Повторный `execute` во время активной команды завершается `COMMAND_ACTIVE`.

Необязательный `conflictDomain` группирует команды, порядок которых нельзя менять. Если он не указан, runtime безопасно выводит домен из имени операции: `chat.message.send` → `chat:message:send`.

## CommandOnline

`window.layer.api.commandOnline(operation, payload, options)` отправляет команду только онлайн, без записи payload в IndexedDB outbox. Используйте его для одноразовых кодов подтверждения и других чувствительных команд, которые нельзя сохранять для последующей отправки. В сгенерированном браузерном runtime доступен также alias `window.layer.commandOnline`. Это прямой Promise API с позиционными аргументами; отдельного `context.api.commandOnline` у component adapter нет.

### Аргументы и результат

| Аргумент | Контракт |
| --- | --- |
| `operation` | Строка с именем зарегистрированной command-операции. |
| `payload` | Объект данных операции; `null` и массивы не допускаются. |
| `options` | Необязательный объект, по умолчанию `{}`. Единственное допустимое поле — `baseRevision`: безопасное целое число не меньше нуля, по умолчанию `0`. Передавайте ревизию здесь, а не как shorthand в payload. |
| Результат | `Promise` с копией поля `data` успешного protocol response, без внешнего envelope. |

### Пример

Пример выполняется в браузерном обработчике формы после начала проверки телефона и получения `challengeId`. Приложение должно подключить телефонный Auth и провайдер `phoneChallenge`; `phoneSignal` содержит номер E.164, а `verificationCodeSignal` — введённый пользователем код. Хранение challenge и доставка кода принадлежат приложению.

```js
const phoneVerificationResult = await window.layer.api.commandOnline(
    'auth.phone.verify',
    {
        phone: phoneSignal.peek(),
        challengeId: phoneChallengeIdSignal.peek(),
        code: verificationCodeSignal.peek()
    },
    {baseRevision: 0}
);

const signedInUserId = phoneVerificationResult.user.id;
```

### Ожидаемый результат

После успешной проверки сервер устанавливает session/CSRF cookie и возвращает безопасные данные `user` и `session`. Код подтверждения не записывается этим методом в IndexedDB или offline outbox. Стандартный same-origin API client создаёт новый `commandId` для вызова и передаёт `baseRevision` как protocol metadata; вручную создавать envelope не требуется.

### Ошибки и повторная отправка

- Неверная форма аргументов, неизвестные поля options или отсутствие online transport у host приводят к `TypeError` до сетевого вызова. Схему payload, имя операции и доступ дополнительно проверяет стандартный protocol/server runtime.
- Если runtime считает браузер offline, Promise отклоняется с `COMMAND_OFFLINE` и `retryable: true`. Команда не ставится в очередь и не отправляется автоматически после reconnect.
- Сетевые и серверные ошибки передаются вызывающему коду. Наличие сети не гарантирует успешную доставку.
- Каждый новый вызов создаёт новый `commandId`. Не повторяйте чувствительную команду вслепую после неопределённого сетевого результата: сначала проверьте состояние операции согласно её контракту.

Метод не создаёт command controller, read-only signals, optimistic update или offline replay. Pending/error state формы и решение о повторном вызове принадлежат приложению. Для обычных durable commands используйте `context.api.command`; подробности — в [offline/outbox](offline-realtime.md).

## Lifecycle и lazy chunks

Query/command handles автоматически принадлежат компоненту. Component bundle регистрирует один owner cleanup синхронно во время setup, поэтому новые handles можно безопасно создавать и в event handlers. При destroy adapter отписывается от observable runtime state, отменяет активные query и освобождает command watchers. `dispose()` позволяет освободить динамический handle раньше. Application cache и outbox остаются общими для маршрутов.

Signals создаются внутри текущего component bundle. Это важно для lazy chunks: application runtime передаёт snapshots через `subscribe`, а локальный adapter подключает их к signal dependency graph текущего renderer. Поэтому изменение API state обновляет только зависимые DOM bindings.

## Ошибки

Если сигнал отменён до вызова низкоуровневого API или во время получения CSRF-токена, запрос не отправляется и возвращается `API_ABORTED`. Отмена после отправки не является гарантией отката серверной команды: её результат нужно выяснить через исходный `commandId`, а не повторять действие с новым идентификатором.

Публичная ошибка содержит стабильные поля `code`, `message`, `requestId`, `status`, `retryable`, `retryAfterMs`, `details`. UI не должен показывать stack/cause или сериализовать полный payload.

Типовые коды high-level API: `QUERY_OFFLINE`, `QUERY_DISPOSED`, `COMMAND_ACTIVE`, `COMMAND_DISPOSED`, `COMMAND_OFFLINE`; transport и server codes сохраняются из protocol runtime.

## Дальше

Lifecycle-owned context.links, open/closeViewer и viewer failure contracts: [ссылки приложения](links-navigation.md).
