# @solcorp/layer-compiler

**Part of [Layer-Engine](https://www.npmjs.com/package/@solcorp/layer), a JavaScript framework for full PWA applications.** Ahead-of-time compilation of Layer components and template expressions.

Start with `npm install @solcorp/layer`; this module is installed automatically. You do not need to assemble the framework package by package.

[Quick start](https://github.com/soluser010/layer-engine/blob/main/README.md#quick-start) · [API guide EN](https://github.com/soluser010/layer-engine/blob/main/docs/en/authoring-layer-js.md) · [Документация RU](https://github.com/soluser010/layer-engine/blob/main/docs/ru/authoring-layer-js.md) · [Source](https://github.com/soluser010/layer-engine/tree/main/packages/compiler)

Часть фреймворка **Layer-Engine**. Для разработки приложения установите основной пакет `@solcorp/layer`; этот модуль входит в его зависимости. Ссылки выше ведут к назначению, API, примерам и ограничениям модуля.

Build-time compiler for canonical JavaScript ESM `*.layer.js` components and the temporary legacy `.layer` compatibility format. It parses module and template AST without executing author code, then emits one immutable serializable plan shared by SSR and browser rendering.

```js
import {layerComponentCompile} from '@solcorp/layer-compiler';

const componentData = layerComponentCompile(`
    <template>
        <h1 :data-state="state">{{ title }}</h1>
    </template>
    <style scoped>
    h1 { color: rebeccapurple; }
    </style>
`, {
    componentId: 'pages/home-title',
    file: 'src/components/home-title.layer'
});
```

The component syntax supports escaped interpolation, `:attribute`, known form-control properties, `@event`, `l-if`/`l-else-if`/`l-else`, keyed `l-for`, two-way `l-model`, `l-ref`, named slots with fallbacks, and declared `l-region` server-owned boundaries. A region subtree is static in the client plan by design: the compiler rejects signals, handlers, models, refs, nested regions, and structural ownership beneath it.

For `*.layer.js`, native `${expression}` owns text, attribute, property, boolean, event, ref, and model bindings. Imported `when` and `repeat` calls are recognized only in child position. Their lazy nested `html` callbacks are compiled recursively, namespaced, and fingerprinted; callback source never reaches an HTML parser at runtime. `repeat` requires one root element per item so SSR hydration can verify its stable key.

The CLI links the optional `<script>` as real ESM. Its `props`, `emits`, and `setup` exports form a component definition; static `route` metadata remains available to the router. Local ESM imports and nested `.layer` imports are bundled ahead of time with source maps. Dynamic imports remain prohibited.

Expressions are parsed to AST and interpreted against explicit local scope. Assignments, constructors, global lookup, dynamic imports, `eval`, `Function`, prototype traversal, inline HTML event attributes, raw `innerHTML`, and executable template elements are rejected. The package never invokes `eval` or `new Function`.

Page tooling can read a static route contract without executing component code:

```js
import {layerComponentRouteExtract} from '@solcorp/layer-compiler';

const routeData = layerComponentRouteExtract(`
    export const route = {
        render: 'ssr',
        auth: 'session',
        preload: ['chat.dialog.get']
    };
`);
```

The extractor accepts only JSON-compatible literals in `export const route`. Calls, computed properties, spreads, identifiers, and mutable exports fail compilation.

## Failure contract

Build failures throw `LayerCompilerError` with a stable code such as `LAYER_COMPONENT_INVALID`, `LAYER_TEMPLATE_INVALID`, `LAYER_TEMPLATE_UNSAFE`, `LAYER_EXPRESSION_INVALID`, `LAYER_SCRIPT_INVALID`, `LAYER_SCRIPT_UNSAFE`, or `LAYER_STYLE_INVALID`. Invalid model targets, competing conditional branches, unstable regions, duplicate region names, unsafe script constructs, and non-scoped styles fail before runtime. Internal parser causes are retained for build tooling but are not part of generated runtime data.
