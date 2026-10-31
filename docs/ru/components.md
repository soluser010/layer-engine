---
title: Компоненты, props, events, slots и context
description: Композиция компонентов и явный поток данных.
audience: beginner
order: 90
status: documented
updated: 2026-10-31
---

# Компоненты, props, events, slots и context

[Карта возможностей](capabilities.md) · [Полные сигнатуры и типы](api-reference-layer.md)

## Цель

Собрать компонент с явным входом, событием и инфраструктурной зависимостью.

## Пример

```js
import {html, layerComponentCreate} from '@solcorp/layer';

export const properties = {
    message: {type: 'object', required: true}
};

export const events = {
    'message.remove': {id: 'string'}
};

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

## Контракты компонента

`layerComponentCreate(render)` принимает синхронную функцию `(properties, context)`, возвращающую `html` template. Async render не является способом загрузки API. `export const properties` описывает props; `required: true` требует значение, `default` задаёт fallback. `export const events` объявляет имена разрешённых emit. Пример ожидает message с id/text; вложенную бизнес-структуру проверяет приложение.

Lifecycle: `onMount(callback)`, `onHydrate(callback)`, `onUpdate(callback)`, `onDestroy(callback)`. Регистрируйте создание/освобождение внешнего ресурса парой. Signals сами не освобождают произвольный DOM observer или таймер. Для инфраструктурных зависимостей `provide(name, value)` и `consume(name)` используют дерево компонентов, а не глобальную переменную.

Полный список context: [Context API](context-api.md). Возвращаемые формы, props/events/slots для manual host: [точные контракты renderer](api-reference-render.md).
