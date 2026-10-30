---
title: Компоненты, props, events, slots и context
description: Композиция компонентов и явный поток данных.
audience: beginner
order: 90
status: release-candidate
updated: 2026-09-24
---

# Компоненты, props, events, slots и context

## Цель

Собрать компонент с явным входом, событием и инфраструктурной зависимостью.

## Пример

```js
import {html, layerComponentCreate} from '@solcorp/layer';

export default layerComponentCreate(function MessageCard( properties, context ){
    //Creating the component event from server-validated message identity
    const messageRemove = function(){
        //Sending the declared event to the parent component
        context.emit( 'message.remove', {
            id: String( properties.message.id )
        });

    };

    //Rendering escaped text and one declared named slot
    return html`
        <article>
            <slot name="before"></slot>
            <p>${properties.message.text}</p>
            <button @click=${messageRemove}>Удалить</button>
        </article>
    `;

});
```

## Ожидаемый результат

Данные идут через props вниз, действие поднимается событием вверх, slot оставляет точку композиции, context предоставляет только объявленную инфраструктуру.

## Объяснение

Компонент не читает скрытые singleton-переменные. DOM listeners и signal bindings принадлежат lifecycle компонента и освобождаются при unmount.

## Типовые ошибки

- Изменение объекта props на месте вместо события.
- Выполнение browser API во время SSR без capability check.
- Вставка строки как HTML; обычная интерполяция всегда экранируется.

## Failure contract

Необработанная ошибка ограничивается error boundary. Unsafe HTML принимается только отдельным API с проверенным `TrustedHTML`.

Далее: [синтаксис `.layer.js`](authoring-layer-js.md), [Context API](context-api.md).
