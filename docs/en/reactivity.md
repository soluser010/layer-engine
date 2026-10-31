---
title: Signals, stores, and partial DOM
description: Layer reactive primitives, batching, computed/effect, and updates limited to dependent DOM bindings.
audience: beginner
order: 80
status: documented
updated: 2026-10-31
---

# Signals, stores, and partial DOM

[Capability map](capabilities.md) · [Complete signatures and types](api-reference-render.md)

## Goal

Change component state without manually finding DOM nodes and without re-rendering the entire page.

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

get() participates in dependency tracking. peek() reads without a dependency. set(value) replaces state; update(callback) derives a new value from the current one.

## Computed, effect, and batch

- layerComputedCreate creates a lazy read-only value and caches it until a dependency changes.
- layerEffectCreate is for an external side effect; its callback may return cleanup logic.
- layerBatch groups several writes into one reactive commit.

In-component fragment: import `layerComputedCreate` and `layerBatch` from `@solcorp/layer`. `priceSignal` and `quantitySignal` are previously created numeric signals.

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

Do not use an effect for a value that can be expressed as computed state. Effects touch the outside world: title, an analytics adapter, an observer, or another explicitly disposable resource.

## Store

layerStoreCreate returns a reactive proxy around an ordinary object. Reading one field tracks that field. A store is useful for related values, but not for DOM nodes, database adapters, or a global mutable singleton.

## Conditions and lists

when accepts a signal/condition and lazy renderer. repeat requires a stable string/number key and exactly one root element in each item template. A key preserves DOM identity during reordering and must not depend on the array index.

## Why there is no global Virtual DOM

The compiler knows each dynamic location ahead of time. The runtime subscribes the specific text, attribute, property, or list binding. This reduces diff work and makes actual DOM mutation counts testable.

## Common errors

An exception in a computed value, DOM binding, effect or cleanup does not block other subscriptions: independent updates complete, and the failed observer can retry after its next dependency change. The error remains observable; fix its cause rather than throwing for normal loading state. Cleanup runs once for its resource instance. Waiting for the current commit through `layerCommitWait` from `@solcorp/layer-render` rejects on failure instead of reporting a successful partial render. An unhandled automatic commit failure reaches the browser; multiple failures use `AggregateError`.

- Mutating a nested plain object inside a signal without set/update.
- Using an array index as the key of an editable list.
- Performing side effects inside a computed value.
- Creating a signal in a repeated handler without a lifecycle owner.

## Failure contract

A duplicate repeat key, non-array source, incompatible template shape, or write to a read-only computed value fails explicitly. ErrorBoundary contains render errors; stack/cause never enters SSR HTML.

Next: [Components](components.md), [Syntax](authoring-layer-js.md).

## Reactive primitive options

`layerSignalCreate(initialValue, {equal})` and `layerComputedCreate(compute, {equal})` accept a custom `(previous, next) => boolean` comparator; the default is `Object.is`. true means unchanged. Signals expose get/peek/set/update; computed values expose reading and disposal as shown in [signatures](api-reference-render.md). Ordinary signals have no public subscribe; observe them using an effect that reads signal.get(). Do not confuse this with subscribe on runtime controllers.

`layerEffectCreate(callback)` returns a disposer; the callback may return cleanup. `layerBatch(callback)` groups synchronous writes; an async callback does not turn several awaits into a DOM transaction. Stores observe top-level fields, not deep mutations. Use `layerCommitWait` from `@solcorp/layer-render` to await a reactive commit.
