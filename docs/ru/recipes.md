---
title: Практические рецепты
description: Короткие проверяемые шаблоны для типичных задач Layer-приложения.
audience: beginner
order: 240
status: documented
updated: 2026-10-31
---

# Практические рецепты

[Карта возможностей](capabilities.md)

## Новая SSR-страница

Создайте src/pages/about.layer.js:

```js
import {
    html,
    layerComponentCreate,
    layerPageCreate
} from '@solcorp/layer';

export const page = layerPageCreate({
    render: 'ssr',
    auth: 'none',
    offline: 'shell',
    cache: 'public',
    metadata: {
        title: 'About'
    }
});

export default layerComponentCreate(function AboutPage(){
    //Rendering a server-safe static page
    return html`<main><h1>About</h1></main>`;

});
```

Файл автоматически создаёт route /about/. Для динамического segment используйте src/pages/users/[userId].layer.js.

## Scoped и global styles

styles = css template и *.layer.css получают component scope. *.global.layer.css применяется явно ко всему документу. body/html styles должны быть global:

```css
:root {
    --page-background: #ffffff;
}

body {
    margin: 0;
    background: var(--page-background);
}
```

Импортируйте global file один раз в layout или page entry. Не пытайтесь достичь body из scoped component selector.

## Query с cache fallback

```js
const roomQueryData = context.api.query({
    operation: 'chat.room.read',
    payload: function payloadCreate(){
        //CallBack THE OBJECT
        return {
            roomId: String( properties.roomId )
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

Не маскируйте cache-данными AUTH/PERMISSION/VALIDATION ошибки; runtime использует fallback только для offline/retryable transport failure.

## Offline command

```js
const messageSendCommandData = context.api.command({
    operation: 'chat.message.send',
    offline: {
        strategy: 'outbox'
    }
});

const messageSendResultData = await messageSendCommandData.execute({
    roomId: String( properties.roomId ),
    text: String( draftSignal.peek() ),
    baseRevision: Number( roomRevisionSignal.peek() )
});
```

Не создавайте собственный commandId. Generated/context runtime делает его до durable outbox commit.

## Переход по маршруту

В markup используйте обычную same-origin ссылку. Router перехватывает подходящую navigation и сохраняет совместимый layout:

```html
<a href="/settings/?tab=security#sessions">Security settings</a>
```

Для imperative flow используйте window.layer.navigate(url). Не меняйте history вручную параллельно router.

## Установка PWA по кнопке

```js
const applicationInstall = async function(){
    //Launching the browser-owned prompt only after a user gesture
    const installResultData = await window.layer.pwa.install.prompt();

    //CallBack THE OBJECT
    return installResultData;

};
```

Не вызывайте prompt автоматически. Браузер может показать собственный install UI.

## Logout и локальные данные

Сначала отзовите server session, затем вызовите Layer Auth signOut или явный storagePurge. Runtime остановит event streams, очистит worker pointer и удалит user-scoped IndexedDB namespace. Не удаляйте все origin databases вручную.

## Production copy

```text
npm run build
cd dist
npm run check
npm start
```

Копируйте только dist. На server задайте LAYER_DOMAIN и secrets, настройте DNS/firewall и внешний supervisor.

## Failure contract

Каждый рецепт использует public application API. Low-level package APIs нужны только infrastructure authors. Если пример расходится с generated declarations текущей сборки, декларация и compiler diagnostic являются источником истины для этого checkout.

Далее: [operations](operations.md), [PWA](pwa-service-worker.md), [deployment](deployment-diagnostics.md).
