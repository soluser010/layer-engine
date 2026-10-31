---
title: Клиентский рендер страницы
description: Клиентский рендер страницы.
audience: intermediate
order: 101
status: documented
updated: 2026-10-31
---

# Клиентский рендер страницы

[Карта возможностей](capabilities.md) · [Полные сигнатуры и типы](api-reference-router.md)

## Назначение и пример

Используйте `csr`, когда HTML страницы должен строиться в браузере. В `src/pages/about.layer.js`:

```js
import {html, layerComponentCreate, layerPageCreate} from '@solcorp/layer';

export const page = layerPageCreate({
    render: 'csr',
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

Прямая загрузка получает application shell, затем JavaScript создаёт страницу. Ожидаемый результат — заголовок и ссылка после запуска runtime. Режим не меняет формат шаблонов и signals.

## Данные и lifecycle

Данные пользователя получайте через [Context API](context-api.md). Побочные эффекты браузера размещайте в `context.onMount`; освобождайте ресурсы через `context.onDestroy`. Само `csr` не делает API доступным до его подключения и не заменяет capability checks.

Чтобы запретить анонимный переход, используйте `auth: 'session'` и подключённую систему identity. На серверной операции независимо задайте auth/permissions. Для динамических путей параметры берутся из результата router; не считайте query-строку проверенной identity.

## Ограничения и ошибки

Без JavaScript пользователь увидит только оболочку. Первая интерактивность зависит от загрузки client bundle. Доступность offline определяется установленными ресурсами и данными; `offline: 'shell'` не обещает успешного API-запроса.

Неверная политика отклоняется на build; ошибки компонента обрабатываются boundary. Смена страницы не сохраняет автоматически локальные signals старого компонента.

Далее: [маршрутизация](routing.md), [параметры страницы](page-configuration.md), [SSR](routing-ssr.md).
