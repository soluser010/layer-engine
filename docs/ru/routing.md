---
title: Маршрутизация — возможности и выбор режима
description: Маршрутизация — возможности и выбор режима.
audience: intermediate
order: 99
status: documented
updated: 2026-10-31
---

# Маршрутизация — возможности и выбор режима

[Карта возможностей](capabilities.md) · [Полные сигнатуры и типы](api-reference-router.md)

## Выберите задачу

| Задача | Решение | Подробности |
| --- | --- | --- |
| Публичная статическая страница с HTML до запуска JavaScript | `render: 'ssr'`, статический путь | [Пререндер и hydration](routing-ssr.md) |
| Интерфейс, зависящий от браузера и текущего пользователя | `render: 'csr'` | [Клиентский рендер](routing-csr.md) |
| Настроить страницу, доступ, metadata, preload | `export const page = layerPageCreate({...})` | [Все параметры страницы](page-configuration.md) |
| Ускорить повторное получение данных | Query cache, при необходимости серверный cache | [Кэширование](caching.md) |
| Входящие ссылки, query/hash, внешний viewer | `window.layer.navigate` и links API | [Ссылки и навигация](links-navigation.md) |

`ssr` и `csr` — два принимаемых значения `render`. Штатный `ssr` создаёт HTML **при сборке**, а не персональный HTML на каждый запрос. ISR, streaming SSR и selective hydration не являются переключателями страницы этой версии. Не добавляйте вымышленные `render: 'isr'`, `revalidate` или `keepAlive`.

## Файлы и URL

| Файл | Маршрут |
| --- | --- |
| `src/pages/index.layer.js` | `/` |
| `src/pages/about.layer.js` | `/about` |
| `src/pages/chats/[roomId].layer.js` | `/chats/:roomId` |
| `src/pages/files/[...segments].layer.js` | `/files/*segments` |

Маршрут выбирается по pathname; query и hash сохраняются в адресе, но не создают отдельный файловый маршрут. Статические сегменты имеют приоритет над динамическими. Не создавайте неоднозначные маршруты с одинаковым шаблоном и разными именами параметров.

## Переход

```js
const chatOpen = async function(){
    //Preserving query and hash while navigating through the application router
    const navigationResult = await window.layer.navigate( '/chats/room-1?tab=files#latest' );

    //Handling a rejected navigation without forcing a document reload
    if ( navigationResult.status !== 'ready' ){
        console.info( navigationResult.status );

    }

};
```

Вызывайте обработчик после запуска приложения, например по кнопке. Обычные внутренние `<a href="/about">` также обрабатываются router. Явные targets, включая `_self`, download и модификаторы клика сохраняют стандартное поведение браузера.

## Порядок выполнения

Поиск маршрута → проверка offline → identity → permissions → guard → preload → установка страницы. Более новый переход отменяет применение устаревшего результата. Layout может сохранить внешнюю оболочку; это не обещание сохранения всех локальных переменных размонтированной страницы. Долговечный черновик храните в store/IndexedDB.

`src/app.js` может экспортировать `identityGet`, `onlineGet`, `guardRun`, `preload`. Managed Auth предоставляет стандартную identity, но пользовательские guard/preload runners автоматически не создаются. Контракты: [параметры страницы](page-configuration.md).

## Ошибки и границы защиты

Результат может содержать `not-found`, `offline`, `auth-required`, `forbidden`, `redirect` или `superseded` вместо `ready`. Наличие объявления guard/preload без runner приводит к `ROUTE_GUARD_UNAVAILABLE` / `ROUTE_PRELOAD_UNAVAILABLE`.

Browser guard управляет навигацией, **не защищает статический HTML и API**. Не помещайте секреты в разметку, создаваемую build. Авторизацию данных проверяет серверная операция независимо от страницы.

Далее: [справочник страницы](page-configuration.md), [компоненты](components.md), [операции](operations.md).

## Layout

Создайте `src/layouts/application.layer.js` и задайте странице `layout: 'application'`. Layout должен содержать ровно один outlet. Catch-all `[...segments]` допускается только в последнем сегменте и захватывает непустой остаток пути.

```js
import {html, layerComponentCreate} from '@solcorp/layer';

export default layerComponentCreate(function ApplicationLayout(){
    //Keeping the shared navigation outside the route-owned outlet
    return html`
        <div>
            <nav><a href="/">Home</a></nav>
            <section data-layer-layout-outlet></section>
        </div>
    `;

});
```

## Экспериментальный прогрев экранов

Сначала выберите режим для страницы назначения. [Как выбрать режим прогрева страницы](page-configuration.md#как-выбрать-режим-прогрева-страницы).

На обычной странице достаточно внутренней ссылки `<a href="/about/">О проекте</a>`. Если она видна 250 мс, Layer готовит CSS, модуль и безопасные элементы будущего экрана. Это происходит по одной задаче в видимой вкладке, после запуска приложения. `setup`, проверки доступа и запросы данных выполняются только при переходе. Текущий экран остаётся доступным, пока следующий готовится.

**Откуда берутся стили.** Когда страницу контролирует Service Worker и CSS входит в готовый офлайн-кэш текущей сборки, браузер получает файл оттуда. Вкладка заранее подготавливает таблицы стилей страницы и layout, оставляя активный экран со своими стилями. При клике роутер использует те же таблицы. Если CSS ещё загружается, роутер дожидается его и переключает экран вместе со стилями. При промахе кэша может потребоваться сеть. Запросы API, необходимые для открытия, задаются отдельно через preload или `onBeforeScreenOpen`.

Внутри `ul`, `ol`, `select`, `option`, ARIA-списков и вложенной области с фактической вертикальной прокруткой переход запускает подготовку по требованию. Короткая область с `overflow-y: auto`, содержимое которой помещается, допускает прогрев. Явный `target="_self"` сохраняет обычный переход браузера.

Для чата задайте странице `warmup: 'on-demand'`. Ниже приложение записывает результат обязательного первого запроса в `props.messages` перед показом страницы. Операция `chat.messages.list` должна быть зарегистрирована сервером, а страница должна объявить свойство `messages`. Обработчик вызывается и при возврате. При ошибке запроса или по истечении 15 секунд остаётся предыдущий экран. `signal` позволяет отменить запрос при следующем переходе.

```js
// src/pages/chats/[chatId].layer.js
import {layerPageCreate} from '@solcorp/layer';

export const page = layerPageCreate({
    render: 'csr',
    warmup: 'on-demand'
});

export const properties = {
    messages: {type: 'array', required: true}
};
```

```js
// src/app.js
export function props({route}){
    //Supply the chat page with its declared input before loading messages.
    if (route.path === '/chats/:chatId/') {
        return {messages: []};
    }
    return {};
}

export async function onBeforeScreenOpen({route, params, props, signal}){
    //Keep the current page interactive until the selected conversation is ready.
    if (route.path === '/chats/:chatId/') {
        const response = await window.layer.query('chat.messages.list', {chatId: params.chatId}, {signal});
        props.messages = response.data;
    }
}
```

### Что получает `onBeforeScreenOpen`

Экспортируйте хук из `src/app.js`, если для открытия экрана нужны обязательные данные. Он работает и при `warmup: 'off'`, и при глобальном отключении прогрева. Код внутри запускается при реальном открытии после проверок маршрута. Возвращённый Promise задерживает показ до завершения.

| Аргумент | Как использовать |
| --- | --- |
| `route` | Описание маршрута. Сравните `route.path` с шаблоном, например `/chats/:chatId/`, чтобы хук выполнял запрос только для чатов. |
| `params` | Значения сегментов маршрута. Для `/chats/42/` значение `params.chatId` — строка `'42'`. |
| `url` | Полный целевой адрес в виде строки. Параметры запроса доступны через `new URL(url).searchParams`. |
| `props` | Входные данные для компонента. Запишите результат в объявленное свойство этого объекта перед показом страницы. |
| `preload` | Уже полученные результаты по именам операций. Если данные пришли через preload, используйте их повторно. |
| `restored` | `true`, когда для адреса уже есть экземпляр. Один только фоновый прогрев оставляет значение `false`. |
| `signal` | Передайте в запрос. Следующий переход отменяет ожидание, а сам хук ограничен 15 секундами. |

Для оплаты или одноразовой ссылки задайте `warmup: 'off'` в `layerPageCreate`. Для отключения прогрева, очереди и сохранения экземпляров во всём приложении пересоберите его со следующей настройкой.

```js
// layer.config.js
export default {
    appName: 'messenger',
    navigation: {warmup: {enabled: false}}
};
```

При возврате Layer повторяет проверки доступа, preload и получение props. Черновик, DOM и позиция прокрутки сохраняются в пределах вкладки. Ключ учитывает пользователя, tenant, права, маршрут и query. Для собственных таймеров, плееров и подписок используйте `context.onDeactivate` для паузы и `context.onActivate` для возобновления. `context.onDestroy` освобождает ресурсы окончательно. Эксперимент хранит экземпляры в RAM до очистки контекста безопасности или закрытия приложения, без ограничения количества. `window.layer.navigationDiagnostics()` показывает `active`, `saved`, `prepared`, `unopened`, `queued`, `hits`, `backgroundHits`, `cancellations` и `clickToReadyMs`.

При собственной авторизации возвращайте стабильные `userId`, `tenantId` и `permissions` из `identityGet()`. При выходе вызывайте `window.layer.storagePurge()`. Встроенная авторизация выполняет очистку сама. Смена прав проверяется при переходе и возвращении вкладки на передний план.
