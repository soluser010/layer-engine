---
title: VS Code, IntelliSense и live reload
description: Установка Layer VS Code Extension, embedded HTML/CSS IntelliSense, snippets и автоматическое обновление браузера.
audience: beginner
order: 60
status: documented
updated: 2026-09-24
---

# VS Code, IntelliSense и live reload

## Цель

Получить HTML/CSS-подсветку, подсказки и диагностику внутри *.layer.js, сохранив штатный JavaScript IntelliSense в интерполяциях.

## Установка расширения

Расширение не устанавливается приложением автоматически: IDE требует отдельного доверенного действия пользователя. Соберите или возьмите локальный VSIX:

```text
npm run ide:test
npm run ide:package
```

В VS Code выберите Extensions: Install from VSIX, укажите artifacts/layer-engine-vscode-0.2.0.vsix и выполните Developer: Reload Window. Marketplace publication ещё не выполнялась.

## Почему Language Mode показывает JavaScript

Это правильно. *.layer.js остаётся настоящим JavaScript ESM. Extension внедряет HTML scopes только в html template и CSS scopes в css template. Внутри интерполяции управление возвращается JavaScript language service.

```js
import {css, html, layerComponentCreate} from '@solcorp/layer';

export const styles = css`
.card {
    display: grid;
}
`;

export default layerComponentCreate(function Card( properties ){
    //Rendering escaped application data inside an HTML template
    return html`<section class="card">${properties.title}</section>`;

});
```

## Подсказки

- HTML tags, attributes, values и ARIA;
- CSS selectors, properties, values и custom properties;
- Layer bindings @click, .value, ?disabled, l-model и ref;
- when/repeat, :global(...) и scoped-style snippets;
- hover и embedded diagnostics;
- file snippets layer-component, layer-page, layer-query, layer-command и layer-events.

HTML completion зависит от контекста: символ < открывает штатный tag provider. Layer completion также умеет заменить введённое имя элемента готовой парой тегов. Внутри ${...} embedded provider молчит, чтобы не скрывать JS completion.

## Иконка файла и formatter

Extension назначает *.layer.js собственную file icon theme contribution, но VS Code может показывать иконку текущей сторонней темы. Переключитесь на Layer Engine File Icons либо выберите тему, которая учитывает language/file association.

Layer не требует Prettier. Если VS Code сообщает, что esbenp.prettier-vscode отсутствует, удалите эту formatter association или установите Prettier осознанно. Рекомендуется оставить JavaScript formatter проекта и не позволять formatter менять tagged templates.

## Live reload

`layer dev` следит за `src` и `public`, объединяет частые файловые события и выполняет атомарную сборку. После успешной сборки dev-only GET SSE передаёт revision, а страница вызывает `location.reload()` с тем же pathname, query и hash.

Ошибка последующей сборки оставляет последнюю рабочую dist, не перезагружает страницу и показывает text-only overlay. После исправления overlay удаляется, выполняется новая сборка и reload. Production dist не содержит dev client.

## Типовые ошибки

- Есть только подсветка: проверьте, что VSIX 0.2.0 включён именно для workspace и перезагрузите окно.
- Нет HTML completion: курсор должен быть внутри канонического html template, а не обычной строки.
- Нет Layer snippets: убедитесь, что файл имеет имя *.layer.js.
- Изменение config не подхватилось: перезапустите layer dev.

## Failure contract

Scanner не выполняет пользовательский JavaScript, ограничивает размер документа и поддерживает cancellation. Compiler остаётся окончательной проверкой Layer-контракта; IDE diagnostics не заменяют layer build.

Далее: [синтаксис](authoring-layer-js.md), [быстрый старт](getting-started.md).
