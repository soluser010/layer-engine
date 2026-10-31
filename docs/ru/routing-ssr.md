---
title: Пререндер при сборке и hydration
description: Пререндер при сборке и hydration.
audience: intermediate
order: 100
status: documented
updated: 2026-10-31
---

# Пререндер при сборке и hydration

[Карта возможностей](capabilities.md) · [Полные сигнатуры и типы](api-reference-router.md)

## Назначение

Создать публичный HTML статического маршрута до загрузки клиентского JavaScript. Обзор альтернатив: [маршрутизация](routing.md); полный контракт: [настройки страницы](page-configuration.md).

## Полный пример

Создайте `src/pages/about.layer.js`:

```js
import {html, layerComponentCreate, layerPageCreate} from '@solcorp/layer';

export const page = layerPageCreate({
    render: 'ssr',
    auth: 'none',
    offline: 'shell',
    metadata: {
        title: 'About the application'
    }
});

export default layerComponentCreate(function AboutPage(){
    //Rendering public content without browser or private server dependencies
    return html`
        <main>
            <h1>About the application</h1>
            <a href="/">Home</a>
        </main>
    `;

});
```

Выполните `npm run build`. В `dist/about/index.html` появится HTML страницы. При прямом открытии `/about` браузер получает этот документ; клиент подключает bindings к совместимой разметке. При несовместимых markers допускается контролируемый повторный mount.

## Что выполняется и когда

| Этап | Поведение |
| --- | --- |
| Build | Синхронный renderer выполняется без пользовательской сессии и браузерных API |
| HTTP-запрос | Хост выдаёт готовый HTML; этот режим сам не запускает request-time SSR |
| Hydration | Браузер подключает интерактивность к готовым узлам |
| Изменение signal | Меняются зависимые DOM bindings |
| SPA-переход | Router устанавливает целевую страницу, а не скачивает её как новый документ |

Маршруты с `:parameter` или wildcard не генерируются этим проходом. Для `/chats/[roomId]` не обещается предварительный HTML каждого roomId; используется оболочка и клиентский рендер. Список динамических URL для prerender здесь не настраивается.

Layout с `data-layer-layout-outlet` участвует в статическом рендере. Browser lifecycle, API transport и IndexedDB нельзя использовать для получения пользовательских данных при build. `preload` принадлежит клиентской навигации и не превращает сборку в персонализированный серверный запрос.

## Безопасность и ошибки

`auth: 'session'` не закрывает опубликованный HTML-файл. Приватные значения загружайте защищёнными операциями после проверки сессии. `cache: 'private'` не является защитой данных: см. [кэширование](caching.md).

Ошибка компонента/отсутствие единственного layout outlet завершают build с `CLI_BUILD_SSR_FAILED`. Не используйте случайное значение, текущее время или браузерный размер как обязательную одинаковую разметку build и hydration.

Далее: [CSR](routing-csr.md), [полная конфигурация страницы](page-configuration.md).
