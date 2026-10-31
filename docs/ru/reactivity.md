---
title: Signals, stores и частичный DOM
description: Реактивные примитивы Layer, batching, computed/effect и обновление только зависимых DOM-привязок.
audience: beginner
order: 80
status: documented
updated: 2026-09-24
---

# Signals, stores и частичный DOM

## Цель

Изменять состояние компонента без ручного поиска DOM-узлов и без полной перерисовки страницы.

## Signal

```js
import {
    html,
    layerComponentCreate,
    layerSignalCreate
} from '@solcorp/layer';

export default layerComponentCreate(function Counter(){
    //Creating component-owned reactive state
    const countSignal = layerSignalCreate( Number( 0 ) );

    //Creating the user action as an explicit state transition
    const countIncrease = function(){
        //Updating the current count atomically
        countSignal.update(function countUpdate( countData ){
            //CallBack THE NUMBER
            return Number( countData ) + Number( 1 );

        });

    };

    //Rendering only the button text binding when count changes
    return html`<button @click=${countIncrease}>Count: ${countSignal}</button>`;

});
```

get() участвует в dependency tracking. peek() читает значение без зависимости. set(value) заменяет состояние, update(callback) безопасно строит новое значение из текущего.

## Computed, effect и batch

- layerComputedCreate вычисляет read-only значение лениво и кэширует его до изменения зависимости.
- layerEffectCreate предназначен для внешнего side effect; callback может вернуть cleanup.
- layerBatch группирует несколько записей в один reactive commit.

```js
const totalSignal = layerComputedCreate(function totalCalculate(){
    //Calculating the value from tracked dependencies
    return Number( priceSignal.get() ) * Number( quantitySignal.get() );

});

layerBatch(function cartUpdate(){
    //Publishing related state changes as one visible commit
    priceSignal.set( Number( 100 ) );
    quantitySignal.set( Number( 2 ) );

});
```

Не используйте effect для значения, которое можно выразить computed. Effect касается внешнего мира: title, analytics adapter, observer или другой явно освобождаемый ресурс.

## Store

layerStoreCreate создаёт reactive proxy обычного объекта. Чтение поля отслеживает именно это поле. Store подходит для нескольких связанных значений, но не для DOM nodes, database adapters или глобального mutable singleton.

## Условия и списки

when принимает signal/condition и lazy renderer. repeat требует стабильный string/number key и один корневой элемент item template. Key сохраняет DOM identity при перестановке и не должен зависеть от позиции массива.

## Почему нет общего Virtual DOM

Compiler знает каждую динамическую точку заранее. Runtime подписывает конкретный text/attribute/property/list binding. Это уменьшает объём сравнений и позволяет тестировать реальное число DOM mutations.

## Типовые ошибки

Исключение в computed, DOM-привязке, effect или cleanup не блокирует остальные подписки: независимые обновления завершаются, а обработчик может повториться после следующего изменения зависимости. Ошибка остаётся наблюдаемой; исправляйте её причину, не используйте исключения для обычного состояния «загрузка». Cleanup вызывается один раз для своего экземпляра ресурса. Ожидание текущего commit через `layerCommitWait` из `@solcorp/layer-render` отклоняется при ошибке, а не сообщает об успешном частичном рендере. Необработанная ошибка автоматического commit передаётся браузеру; при нескольких ошибках используется `AggregateError`.

- Изменение вложенного plain object внутри signal без set/update.
- Index массива как key для редактируемого списка.
- Побочный эффект внутри computed.
- Создание signal в повторном обработчике без lifecycle owner.

## Failure contract

Duplicate repeat key, non-array source, несовместимый template shape и запись в read-only computed завершаются явной ошибкой. Ошибка рендера ограничивается ErrorBoundary; stack/cause не попадает в SSR HTML.

Далее: [компоненты](components.md), [синтаксис](authoring-layer-js.md).
