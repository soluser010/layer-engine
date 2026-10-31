---
title: Components, props, events, slots, and context
description: Component composition and explicit data flow.
audience: beginner
order: 90
status: documented
updated: 2026-10-31
---

# Components, props, events, slots, and context

[Capability map](capabilities.md) · [Complete signatures and types](api-reference-layer.md)

## Goal

Build a component with explicit input, an event, and an infrastructure dependency.

## Example

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
            <button @click=${messageRemove}>Remove</button>
        </article>
    `;

});
```

## Expected result

Data flows down through props, actions travel up as events, a slot remains a composition point, and context exposes only declared infrastructure.

## Explanation

The component does not read hidden singleton state. DOM listeners and signal bindings belong to the component lifecycle and are released on unmount.

## Common errors

- Mutating a props object instead of emitting an event.
- Calling a browser API during SSR without a capability check.
- Treating a string as HTML; normal interpolation is always escaped.

## Failure contract

An unhandled component error is contained by an error boundary. Unsafe HTML requires a separate API and verified `TrustedHTML`.

Next: [`.layer.js` authoring](authoring-layer-js.md), [Context API](context-api.md).

## Component contracts

`layerComponentCreate(render)` takes a synchronous `(properties, context)` function returning an `html` template. Async render is not an API loading mechanism. `export const properties` describes props; `required: true` requires a value, `default` provides a fallback. `export const events` declares allowed emit names. The example expects message with id/text; the application validates its nested business structure.

Lifecycle: `onMount(callback)`, `onHydrate(callback)`, `onUpdate(callback)`, `onDestroy(callback)`. Pair external resource creation with cleanup. Signals do not dispose arbitrary DOM observers or timers. Infrastructure `provide(name, value)` and `consume(name)` use the component tree rather than a global variable.

Complete context inventory: [Context API](context-api.md). Return shapes, props/events/slots for manual hosts: [exact renderer contracts](api-reference-render.md).
