---
title: Быстрый старт
description: Создание первого приложения, dev server и реактивная страница.
audience: beginner
order: 30
status: documented
updated: 2026-10-29
---

# Быстрый старт

## Цель

Создать приложение в обязательном каталоге `apps`, запустить dev-сервер и вывести реактивное значение.

## Пример

Установите полный фреймворк одной зависимостью. Создание приложения и установка его зависимостей выполняются отдельно:

```text
mkdir my-workspace
cd my-workspace
npm init -y
npm install @solcorp/layer
npx layer create hello-layer
cd apps/hello-layer
npm install
npm run dev
```

В странице используйте обычный JavaScript и tagged template. Полный файл остаётся ESM-модулем:

```js
import {
    html,
    layerComponentCreate,
    layerSignalCreate
} from '@solcorp/layer';

export default layerComponentCreate(function HomePage(){
    //Creating component-owned counter state
    const counterSignal = layerSignalCreate( Number( 0 ) );

    //Creating the user action for increasing the counter
    const counterIncrease = function(){
        //Updating the counter from its latest value
        counterSignal.update(function counterUpdate( counterData ){
            //CallBack THE NUMBER
            return Number( counterData ) + Number( 1 );

        });

    };

    //Rendering the button with one reactive text binding
    return html`<button @click=${counterIncrease}>Count: ${counterSignal}</button>`;

});
```

## Ожидаемый результат

CLI печатает локальный адрес. Изменение файла запускает атомарную пересборку, а dev-only SSE обновляет страницу без WebSocket.

## Объяснение

Файл остаётся JavaScript, поэтому внутри `${...}` работает штатный JS IntelliSense. `html``…``` компилируется заранее, а signal меняет только связанную DOM-область.

## Типовые ошибки

- `layer` не найден: используйте `npx layer` при локальной установке или npm scripts приложения.
- Имя содержит кириллицу: используйте латиницу, цифры и дефисы.
- Порт занят: измените `development.port` и перезапустите dev-сервер.

## Failure contract

Начальная ошибка сборки завершает `layer dev`. Последующая ошибка сохраняет последнюю рабочую `dist` и показывается text-only overlay.

Далее: [установка и CLI](installation-cli.md), [структура проекта](project-structure.md).
