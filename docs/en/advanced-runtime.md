---
title: Reactive errors and runtime extensions
description: Store, ErrorBoundary, manual hosts and trusted plugin boundaries.
audience: advanced
order: 265
status: documented
updated: 2026-10-31
---

# Reactive errors and runtime extensions

[Capability map](capabilities.md) · [Complete signatures and types](api-reference-render.md)

Use this chapter for custom hosts or complex lifecycles. Ordinary applications start with components and Context API rather than constructing runtime manually.

<!-- contract: store -->
## Store and resource cleanup

```js
import {layerStoreCreate, layerEffectCreate} from '@solcorp/layer';

const state = layerStoreCreate({profile: {name: 'Ada'}, notice: 'Ready'});
const dispose = layerEffectCreate(function(){
    //Reading concrete properties so their assignments invalidate this effect
    console.log( state.profile.name, state.notice );
    return function(){
        //Releasing the previous effect lifetime before rerun or final disposal
        console.log( 'Cleanup' );

    };

});
state.profile = {...state.profile, name: 'Grace'};
state.notice = 'Saved';
delete state.notice;
dispose();
```

Store tracks top-level properties. `state.profile.name = ...` does not replace profile and does not trigger updates; replace the object. Reading an absent property subscribes to it, so later assignment/deletion changes the value. Object.keys alone is not structural reactivity; use a separate signal/replaced array for dynamic keys. In components register the disposer with `context.onDestroy(dispose)`.

A failing effect does not permanently stop independent observers. Errors are reported for the current commit; an advanced host can await `layerCommitWait()` from layer-render and handle rejection. Errors are not swallowed: later writes may invoke the failing callback again. Cleanup runs before rerun and on disposal.

<!-- contract: boundaries -->
## ErrorBoundary and retry

```js
import {ErrorBoundary, html} from '@solcorp/layer';

const guardedView = ErrorBoundary({
    content: function(){
        //Evaluating the risky synchronous template only inside the boundary
        return html`<p>${readValidatedLabel()}</p>`;

    },
    fallback: function(){
        //Keeping the fallback independent of the failed value
        return html`<p role="alert">This section is unavailable.</p>`;

    }
});
```

Insert `${guardedView}` into component html. `readValidatedLabel` is your synchronous function. The boundary catches synchronous construction/installation errors in its content; fallback errors escape. It does not replace try/catch for fetch, promises, event handlers or later reactive callbacks. There is no reset/retry method: fix the cause and unmount/recreate the region, for example by changing its repeat key. Never automatically repeat an irreversible command.

## Manual hosts and SSR

Compiler-generated components provide `mount`, `hydrate` and `renderToString`; consult that build's generated declarations for exact options. Keep the returned controller and call `dispose()` when removing the host. Do not pass an uncompiled html template where a compiled component is required.

Without providers, manual hosts do not receive managed browser infrastructure for `context.api`, `context.events`, `context.viewport`, `context.keyboard` and `context.links`; check nullable facades. SSR does not open IndexedDB, call keyboard.show or subscribe to realtime; perform browser work in post-mount lifecycle. Type checking does not create providers.

<!-- contract: plugins -->
## Plugin SDK: advanced trusted server API

`@solcorp/layer-plugin-sdk` provides advanced release-candidate extension primitives, not an automatic marketplace/plugin loader. `layerPluginRegistryCreate({engineVersion})` offers define/list/seal/isSealed/initialize. Define accepts manifest and setup; manifest validates name/version/engine, configSchema and allowlisted capabilities. Initialize accepts services/configs, validates config and runs setup sequentially, sealing the registry.

Capabilities: config, events, logger, metrics, operations, repositories. Hosts expose only requested services; declared permissions do not replace operation/object authorization. Installed plugins run in the Node process and can import Node APIs: this is **not a sandbox**. Setup failure stops startup with `PLUGIN_SETUP_FAILED`; missing capabilities produce `PLUGIN_CAPABILITY_UNAVAILABLE`. Registry does not promise automatic rollback of previous setup or a stop hook: hosts own cleanup of returned resources. Do not run untrusted code.

Next: [components](components.md), [API catalog](api-catalog.md).
