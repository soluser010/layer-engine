# Layer-Engine for VS Code

Локальное расширение для канонических компонентов `*.layer.js`.

- JavaScript остаётся базовым языком файла.
- `html\`...\`` получает HTML TextMate scopes.
- `${...}` внутри HTML возвращается в JavaScript scopes.
- `css\`...\`` получает CSS scopes.
- HTML/ARIA и CSS language services предоставляют completion и hover.
- ввод имени HTML-тега без `<`, например `section`, раскрывается по Enter в `<section></section>`;
- embedded HTML/CSS diagnostics обновляются во время редактирования.
- Layer completions добавляют event/property/boolean bindings, `l-model`, `ref`, `when`, `repeat` и `:global`.
- файлы `*.layer.js` получают метку `L`, видимую поверх любой активной темы иконок;
- доступны snippets `layer-component`, `layer-page`, `layer-query`, `layer-command`;
- команды `Layer: Validate current component` и `Layer: Show compiled output` используют локальный compiler проекта и не исполняют код приложения.

Файл остаётся языком `javascript`, поэтому штатные IntelliSense, JSDoc, rename, references и TypeScript diagnostics не заменяются расширением. Внутри `${...}` embedded provider ничего не возвращает и управление остаётся у JavaScript language service.

CSS completion для `:global()` заменяет введённый префикс целиком (`:`, `:g`, `:global`) и не создаёт `::global`. Расширенные описания функций `layerPageCreate`, компонентов, шаблонов и signals поступают из JSDoc/declaration пакета `@solcorp/layer` и отображаются штатным JavaScript hover.

Локальная проверка и упаковка:

```text
npm run ide:test
npm run ide:package
```

VSIX создаётся как `artifacts/layer-engine-vscode-0.2.0.vsix`. Публикация в Marketplace не выполняется.

## English

Local tooling for canonical `*.layer.js` components: JavaScript host syntax, embedded HTML/CSS scopes and IntelliSense, bare HTML tag expansion, JavaScript interpolation ownership, Layer snippets, theme-independent file badges, live embedded validation, compiler diagnostics, and compiled-plan preview.

The diagnostics bridge requires Node.js 24 and a locally installed `@solcorp/layer-compiler` dependency in the opened project.

The `:global()` completion replaces the whole partial prefix and does not produce `::global`. Rich function guidance for page, component, template, and signal APIs is provided by the `@solcorp/layer` declarations and displayed by native JavaScript hover.
