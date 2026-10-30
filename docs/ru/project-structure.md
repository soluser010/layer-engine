---
title: Структура проекта
description: Каталоги исходников, public assets, server code и generated dist.
audience: beginner
order: 40
status: release-candidate
updated: 2026-09-24
---

# Структура проекта

## Цель

Понять, где хранится код приложения и какие каталоги принадлежат сборке.

## Пример

```text
apps/messenger-demo/
    layer.config.js
    package.json
    jsconfig.json
    public/
        index.html
        manifest.webmanifest
    src/
        app.js
        components/
        layouts/
        pages/
        operations.js
        server/
            database.js
            index.js
            operations.js
            services/
    test/
    dist/
```

`src/pages` создаёт файловые маршруты, `layouts` — общие оболочки, `components` — переиспользуемые части, `server` — доверенный backend. `public` содержит GET-ресурсы. `dist` генерируется и не редактируется.

## Ответственность файлов

| Путь | Ответственность |
| --- | --- |
| layer.config.js | строгий режим development/database/runtime/deployment |
| src/app.js | hooks bootstrap/router, shared context и boundary |
| src/pages | один файловый route на page component |
| src/layouts | сохраняемая оболочка с одним layout outlet |
| src/components | переиспользуемые UI-компоненты |
| src/operations.js | static browser/server operation contracts без handlers |
| src/server/operations.js | handlers, authorize и server-only metadata |
| src/server/database.js | declarative application schema |
| src/server/index.js | optional layerServerCreate lifecycle |
| public | shell, manifest, icons и другие прямые GET assets |
| test | application-owned Node/browser tests |
| dist | атомарный generated production bundle |

Page-only style/logic держите рядом со страницей. Выносите компонент только при реальном повторном использовании. Server modules не импортируются из browser components.

## Generated dist

Внутри dist находятся index/route documents, hashed JS/CSS/assets, manifest, layer-service-worker.js и private _layer metadata/runtime. При full-stack build добавляется bundled application.mjs; package.json, package-lock.json, Caddyfile и run.mjs делают каталог переносимым.

Source maps, generated declarations и build metadata не выдаются Caddy публично. Cache Storage хранит только разрешённые GET assets; API/state принадлежат IndexedDB.

## Ожидаемый результат

Импорты приложения остаются внутри `src`; браузер не получает server entry, секреты и raw SQL.

## Объяснение

Контракты операций лежат в `src/operations.js`, чтобы compiler создал browser facade и server registry из одного источника. Прикладная schema находится в `src/server/database.js`.

## Типовые ошибки

- Редактирование `dist`: следующая сборка атомарно заменит изменения.
- Импорт server-файла в компонент: browser bundle завершится ошибкой boundary.
- Размещение приложения вне `apps`: команда `layer create` это запрещает.

## Failure contract

Traversal, symlink escape и неизвестные конфигурационные поля отклоняются до чтения или записи внешнего пути.

Далее: [конфигурация](configuration.md), [компоненты](components.md), [маршрутизация](routing-ssr.md).
