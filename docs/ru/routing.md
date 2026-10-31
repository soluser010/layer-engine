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
