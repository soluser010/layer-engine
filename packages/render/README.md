# @solcorp/layer-render

**Part of [Layer-Engine](https://www.npmjs.com/package/@solcorp/layer), a JavaScript framework for full PWA applications.** Reactive signals, component composition, SSR and DOM bindings.

Start with `npm install @solcorp/layer`; this module is installed automatically. You do not need to assemble the framework package by package.

[Quick start](https://github.com/soluser010/layer-engine/blob/main/README.md#quick-start) · [API guide EN](https://github.com/soluser010/layer-engine/blob/main/docs/en/reactivity.md) · [Документация RU](https://github.com/soluser010/layer-engine/blob/main/docs/ru/reactivity.md) · [Source](https://github.com/soluser010/layer-engine/tree/main/packages/render)

Часть фреймворка **Layer-Engine**. Для разработки приложения установите основной пакет `@solcorp/layer`; этот модуль входит в его зависимости. Ссылки выше ведут к назначению, API, примерам и ограничениям модуля.

Fine-grained reactive renderer for Layer-Engine. It consumes compiler plans directly, without a general Virtual DOM, and provides signals, computed values, effects, batching, reactive stores, buffered SSR, CSR mount, and hydration.

```js
import {layerComponentCompile} from '@solcorp/layer-compiler';
import {
    layerComponentMount,
    signal
} from '@solcorp/layer-render';

const title = signal('Layer');
const componentData = layerComponentCompile(
    '<template><h1>{{ title }}</h1></template>',
    {
        componentId: 'examples/title'
    }
);
const controller = layerComponentMount(componentData, rootElement, {
    title
});

title.set('Layer-Engine');
```

`layerComponentRenderToString` emits escaped HTML and stable markers. `layerComponentHydrate` connects matching nodes without recreating them. A mismatch recovers only the supplied component root and reports `hydration-mismatch` through diagnostics.

`layerComponentDefinitionCreate` adds strict props, declared emits, slots, inherited context, and lifecycle hooks. `layerComponentInstanceMount`, `layerComponentInstanceHydrate`, and `layerComponentInstanceRenderToString` use the same setup contract in browser and SSR modes. Form models write only to signals or owned store fields; template refs are exposed through a read-only controller registry.

Declared `l-region` boundaries expose `controller.regions`. A revisioned patch accepts only `text.set`, `attribute.set`, `attribute.remove`, and `children.replace` with a bounded structured-node format. The runtime validates and simulates the complete patch against a clone before touching live DOM. Raw HTML, executable elements, inline events, style/srcdoc, internal `data-layer-*` attributes, stale revisions, and unknown fields fail closed.

Keyed lists reuse existing elements across value changes and moves. URL attributes reject unsupported schemes. Dynamic text uses text nodes; raw HTML is not a binding type. `layerRenderDiagnosticsCreate` counts create, remove, move, text, attribute, and property mutations for tests and future DevTools.

Canonical `.layer.js` structural regions use `when` and `repeat`. The compiler supplies nested plans and static template fingerprints; the runtime never parses author HTML. `when` replaces only its marker-bounded child branch. `repeat` updates captured item bindings, inserts and removes owned ranges, and moves retained DOM nodes by scalar key. SSR and hydration use the same `layer-when` and `layer-repeat` markers.

## Failure contract

Mount rejects a non-empty CSR root. Lists reject non-array sources, non-scalar keys, duplicate keys, changed nested static HTML, and malformed structural descriptors. Component definitions reject unknown props/events and asynchronous setup. Region patches reject unknown regions, revision conflicts, invalid paths, excessive depth/count/size, and unsafe nodes before live mutation. Invalid compiler plans and hydration markers throw internally; public hydration converts a mismatch into controlled component-boundary recovery and marks the returned controller with `recovered: true`. Errors in user event handlers or effects remain application errors and are not silently swallowed.
