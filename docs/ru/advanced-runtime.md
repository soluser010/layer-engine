---
title: Реактивные ошибки и расширение runtime
description: Store, ErrorBoundary, manual host и границы доверенных plugins.
audience: advanced
order: 265
status: documented
updated: 2026-10-31
---

# Реактивные ошибки и расширение runtime

[Карта возможностей](capabilities.md) · [Полные сигнатуры и типы](api-reference-render.md)

Эта глава нужна при нестандартном host или сложном жизненном цикле. Обычное приложение начинает с компонентов и Context API, а не с ручного создания runtime.

<!-- contract: store -->
## Store и освобождение ресурсов

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

Store отслеживает свойства первого уровня. `state.profile.name = ...` не заменяет profile и не вызывает обновление; замените объект целиком. Чтение отсутствующего свойства также подписывается на него: последующее добавление/удаление меняет значение. Перечисление Object.keys само по себе не является структурной реактивной подпиской; для динамического списка ключей используйте отдельный signal/заменяемый массив. В компоненте зарегистрируйте disposer через `context.onDestroy(dispose)`.

Ошибка одного effect не останавливает независимые наблюдатели навсегда. Ошибка сообщается текущему commit; advanced host может ждать `layerCommitWait()` из layer-render и обработать rejection. Это не проглатывание ошибок: последующая запись может снова вызвать ошибочный callback. Cleanup вызывается перед повтором и при dispose.

<!-- contract: boundaries -->
## ErrorBoundary и повтор

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

Вставьте `${guardedView}` в html компонента. `readValidatedLabel` — синхронная функция приложения. Boundary ловит синхронную ошибку построения/установки своего content; ошибка fallback выходит наружу. Он не заменяет try/catch для fetch, Promise, event handler и поздних reactive callbacks. У boundary нет reset/retry метода: приложение исправляет причину и размонтирует/создаёт этот регион заново (например, меняет ключ в repeat). Не повторяйте автоматически необратимую команду.

## Manual host и SSR

Compiler-generated компонент предоставляет `mount`, `hydrate`, `renderToString`; точные options смотрите в generated declarations конкретного build. Сохраняйте возвращённый controller и вызывайте `dispose()` при удалении host. Не передавайте исходный html template в mount вместо скомпилированного компонента.

В manual host без provider `context.api`, `context.events`, `context.viewport`, `context.keyboard`, `context.links` не получают штатную браузерную инфраструктуру; nullable facades нужно проверять. SSR не открывает IndexedDB, не вызывает keyboard.show и не подписывается на realtime; browser-работа выполняется в lifecycle после mount. Проверка типов не создаёт provider автоматически.

<!-- contract: plugins -->
## Plugin SDK: advanced, доверенный server API

`@solcorp/layer-plugin-sdk` — advanced extension primitives release candidate, не автоматический marketplace/plugin loader. `layerPluginRegistryCreate({engineVersion})` поддерживает define/list/seal/isSealed/initialize. Define принимает manifest и setup; manifest проверяет name/version/engine, configSchema и allowlist capabilities. Initialize принимает services/configs, валидирует config и запускает setup последовательно, запечатывая registry.

Capabilities: config, events, logger, metrics, operations, repositories. Host передаёт только запрошенные сервисы; declared permissions не заменяют operation/object authorization. Установленный plugin выполняется в Node-процессе и может импортировать Node API: это **не sandbox**. Setup failure останавливает startup с `PLUGIN_SETUP_FAILED`; missing capability — `PLUGIN_CAPABILITY_UNAVAILABLE`. Registry не обещает автоматический rollback уже выполненных setup и stop hook: host владеет cleanup возвращённых ресурсов. Не запускайте непроверенный код.

Далее: [компоненты](components.md), [каталог API](api-catalog.md).
