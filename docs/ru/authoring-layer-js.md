---
title: Разработка на *.layer.js
description: Синтаксис компонентов, generated operations, CSS matrix и live reload.
audience: intermediate
order: 70
status: documented
updated: 2026-09-24
---

# Разработка на `*.layer.js`

## CSS build pipeline

Во всех сборках, включая dev/live reload, Layer сначала применяет собственные scoped-селекторы, CSS Modules и обработку локальных ресурсов. Затем Lightning CSS обрабатывает полученные CSS-файлы, системные стили оболочки и `.css` из `public`: добавляет необходимые префиксы, преобразует поддерживаемый синтаксис под `css.targets` и минифицирует результат. Имена классов CSS Modules повторно не переименовываются; CSS-переменные и порядок каскада сохраняются.

Например, вложенный `& > .label`, статический `color-mix()` и media range `(width >= 600px)` могут превратиться в обычные селекторы, вычисленный цвет и `min-width`, если этого требуют targets. Если целевые браузеры уже поддерживают синтаксис, он может остаться современным. Минификация сокращает пробелы/значения, объединяет совместимые правила и сокращения; она не удаляет потенциально используемые классы приложения по эвристике.

Хэши buildId, integrity и Service Worker рассчитываются по итоговому CSS. Для `public/assets/*.css` offline hash совпадает с оптимизированным файлом; остальные public CSS входят в integrity, но не становятся автоматически обязательным offline-кэшем. Исходники не переписываются. Remote CSS, загружаемый браузером через внешнюю ссылку или `@import`, не скачивается и не оптимизируется сборщиком.

`CLI_BUILD_CSS_INVALID` содержит безопасный путь и доступные line/column. Для компонентного CSS это координаты промежуточного объединённого stylesheet, для public — исходного файла. Полные source maps CSS к `.layer.js` не создаются. Неверная последующая сборка сохраняет предыдущий `dist`, а dev показывает существующий error overlay. Лимит public CSS — 2 MiB на файл, 16 MiB суммарно; discovery ограничен 10000 entries, symlinks не обходятся.

Настройки и ограничения совместимости: [css.targets](configuration.md#css-целевые-браузеры). Реализация использует [Lightning CSS transpilation](https://lightningcss.dev/transpilation.html) и [minification](https://lightningcss.dev/minification.html), без произвольных PostCSS plugins и runtime polyfills.

Эта страница описывает реализованные контракты generated operation facade, CSS matrix и локального VS Code extension. Публикация пакетов в npm и stable release не выполнялись.

## Generated operation facade

Операции объявляются один раз в `src/operations.js`. CLI разбирает модуль через AST и не импортирует его во время сборки.

```js
import {layerOperationContractsCreate} from '@solcorp/layer';

export const operations = layerOperationContractsCreate([
    {
        name: 'chat.messages.list',
        type: 'query',
        auth: 'session',
        permissions: ['chat.read'],
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['conversationId'],
            properties: {
                conversationId: {
                    type: 'string'
                }
            }
        },
        outputSchema: {
            type: 'array',
            items: {
                type: 'string'
            }
        }
    }
]);
```

Компонент импортирует wrapper с типами, выведенными из JSON Schema:

```js
import {html, layerComponentCreate} from '@solcorp/layer';
import {chatMessagesListQueryCreate} from '#layer/operations';

export default layerComponentCreate(function ChatPage( properties, context ){
    //Creating a query owned by this page's lifecycle
    const messagesQuery = chatMessagesListQueryCreate(context, {
        payload: {
            conversationId: properties.conversationId
        }
    });

    return html`<output>${messagesQuery.status}</output>`;

});
```

Wrapper вызывает тот же `context.api`; второй transport не создаётся. Для команды `commandId` считается engine-owned полем и исключается из author input type. Сервер импортирует тот же `operations` и добавляет только handler/authorize.

Сборка создаёт:

```text
dist/_layer/operations.mjs
dist/_layer/operations.d.mts
dist/_layer/operations.json
```

Schema компилируются Ajv во время build. Dynamic expressions, handlers, spread, prototype keys, duplicate names и export collisions завершают сборку.

## CSS matrix

Поддерживаются следующие варианты подключения:

| Файл | Class map | Component scope |
|---|---:|---:|
| `css\`...\`` | нет | да |
| `*.layer.css` | да | да |
| `*.layer.module.css` | да | да |
| `*.module.css` | да | нет, compatibility mode |
| `*.global.layer.css` | пустой | нет |

```js
import {html, layerComponentCreate} from '@solcorp/layer';
import styles from './MessageCard.layer.css';
import './application.global.layer.css';

export default layerComponentCreate(function MessageCard(){
    //Applying the imported class map to this component
    return html`
        <article class=${styles.card}>Message preview</article>
    `;

});
```

Compiler разбирает CSS через PostCSS, создаёт стабильный module suffix, применяет `data-layer-scope`, сохраняет source ranges и извлекает CSS в route asset. Относительные `url(...)` остаются внутри `src`, ограничиваются 10 MiB, получают content hash и переносятся в `dist/_layer/assets`. `data:`, `blob:`, `file:`, `http:`, `https:`, protocol-relative и `javascript:` URL отклоняются.

`dist/_layer/styles.json` связывает routes/layouts с CSS assets. Production Caddy не выдаёт source/declaration/build metadata, но отдаёт хешированные CSS assets с immutable cache. Runtime не вставляет `<style>` и CSP не требует `unsafe-inline`.

## VS Code

Локальный VSIX находится в `artifacts/layer-engine-vscode-0.2.0.vsix`. После установки выполните `Developer: Reload Window`.

Файл остаётся языком JavaScript. TextMate injection добавляет:

```text
html`...` → HTML scopes
css`...`  → CSS scopes
${...}    → JavaScript scopes
```

HTML language service предлагает теги, стандартные и ARIA-атрибуты; CSS language service предлагает selectors, properties, values и custom properties. Hover показывает справочную документацию. Embedded validation работает во время редактирования, а compiler diagnostics остаются проверкой полного Layer-контракта при сохранении.

Layer completion items доступны только внутри соответствующего шаблона: `@click=${handler}`, `.value=${value}`, `?disabled=${condition}`, `l-model`, `ref`, `when`, `repeat`, `:global(...)` и scoped CSS rule. Внутри `${...}` embedded provider возвращает управление штатному JavaScript IntelliSense.

При вводе `:`, `:g` или `:global` CSS completion заменяет весь незавершённый токен, поэтому результат всегда содержит одну конструкцию `:global(selector)`, без ошибочного `::global`. В JavaScript-контексте наведите курсор на `layerPageCreate`, `layerComponentCreate`, `html`, `css`, `when`, `repeat` или реактивный API: generated `.d.ts` показывает назначение, формат параметров, безопасные defaults, failure contract и короткий пример. Скомпилированные компоненты дополнительно описывают props, callbacks, slots, `mount`, `hydrate`, `renderToString` и controller lifecycle; generated operation facade объясняет query/command/sync options, reactive state, cancel/settled/dispose и conflict fields. Эти сведения поставляют package/generated declarations, а расширение не подменяет штатный JavaScript language service.

Доступны file-level snippets `layer-component`, `layer-page`, `layer-query`, `layer-command`, `layer-events`, file icon, команды `Layer: Validate current component` и `Layer: Show compiled output`. Diagnostics bridge использует локальный `@solcorp/layer-compiler` и не выполняет application module. Scanner ограничен 1 MiB, не исполняет исходник, поддерживает незавершённые шаблоны, escapes и nested template literals.

```text
npm run ide:test
npm run ide:package
```

Marketplace publication не выполняется.

## Dev live reload

`layer dev` отслеживает `src` и `public`, объединяет частые события и выполняет полную атомарную сборку без overlapping compilers. `development.liveReload` по умолчанию равен `true`.

```js
export default {
    development: {
        host: '127.0.0.1',
        port: 5173,
        https: false,
        liveReload: true
    }
};
```

После успешной сборки internal GET SSE сообщает новую revision, а внешний same-origin dev client вызывает `location.reload()`. Dev client внедряется только в document navigation response и отсутствует в `dist`; фоновые Service Worker precache-запросы получают исходный файл с правильным integrity hash. Active worker не отключается и не unregister-ится: подтверждаемое same-origin сообщение включает network bypass только на время текущего development worker lifetime.

Ошибка следующей сборки не повреждает последнюю рабочую `dist` и не перезагружает страницу. Браузер показывает ограниченный text-only code/message overlay; исправление запускает следующую сборку и обычный reload. `liveReload: false` отключает client и internal endpoints. WebSocket/WSS не используется.

Если указан `deployment.serverEntry`, команда `layer dev` импортирует
сгенерированный `dist/_layer/server/application.mjs`, вызывает
`layerServerCreate` с `environment: 'development'` и loopback-контрактом
`trustedProxy`, затем запускает backend на `deployment.originPort`. Dev-host
потоково проксирует `/api` и `/health/*` через тот же browser origin, включая
POST SSE. Изменение server bundle перезапускает lifecycle до публикации новой
live-reload revision.

Статические маршруты с `render: 'ssr'` получают HTML-документы во время сборки.
Страница и optional layout рендерятся через сгенерированные `renderToString`;
документ получает `data-layer-ssr`, внешние route styles и полную валидированную
metadata-модель. Dynamic/CSR navigation использует чистый
`_layer/shell.html`, а не HTML корневого маршрута. Build-time SSR не выполняет
query/command/sync transport: query handle отдаёт детерминированный no-data
snapshot для явного fallback, а мутации запрещены. Setup компонента должен быть
server-safe.

Route metadata поддерживает title/description/robots/canonical,
language/direction, стандартные named metadata, Open Graph и Twitter cards.
URL-поля ограничены HTTP(S) и root-relative значениями. Клиентская навигация
обновляет ту же модель и удаляет устаревшие Layer-managed tags.

Новые проекты получают `jsconfig.json`, package import `#layer/operations` и generated declarations для operation/CSS imports. `checkJs` выключен по умолчанию, чтобы обычный JavaScript проект не получал шум implicit-any; разработчик может включить его после добавления собственных JSDoc contracts.
