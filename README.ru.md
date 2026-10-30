# Layer-Engine

[English](https://github.com/soluser010/layer-engine/blob/main/README.md) · [Руководство RU](https://github.com/soluser010/layer-engine/blob/main/docs/ru/README.md) · [English handbook](https://github.com/soluser010/layer-engine/blob/main/docs/en/README.md) · [npm](https://www.npmjs.com/package/@solcorp/layer)

**Layer-Engine — JavaScript-фреймворк для полноценных PWA-приложений, интерактивных сервисов и мессенджеров.** Создавайте компоненты на привычных JavaScript, HTML и CSS. Layer предоставляет реактивный DOM, маршрутизацию, серверные операции, авторизацию, offline-хранилище, realtime и обновления приложения.

Разрабатывайте приложение, собирайте переносимый `dist` и запускайте его на сервере. Встроенный launcher подготавливает runtime и Caddy; Caddy автоматически получает и продлевает HTTPS-сертификат настроенного публичного домена.

Автор — **S.O.L CORP** · [solcorp.ru](https://solcorp.ru) · Apache-2.0.

## Оглавление

- [Возможности](#возможности)
- [Быстрый старт](#быстрый-старт)
- [Первый компонент](#первый-компонент)
- [Production и HTTPS](#production-и-https)
- [Локальная документация](#локальная-документация)
- [Навык агента](#навык-агента)
- [Расширение VS Code](#расширение-vs-code)
- [Пакеты и участие](#пакеты-и-участие)

## Возможности

- Компоненты `.layer.js`: JavaScript ESM, шаблоны HTML/CSS и типизированные подсказки IDE.
- Signals, частичные изменения DOM, композиция компонентов, файловые маршруты, SSR и hydration.
- Валидируемые серверные операции, права доступа, сессии, провайдеры авторизации и лимиты ресурсов.
- PostgreSQL для прикладных данных; PGlite для системного хранилища одного worker; необязательный Redis.
- IndexedDB, offline outbox, обновления Service Worker, Web Push и PWA API с проверкой возможностей браузера.
- HTTP и Fetch event streams без WebSocket.
- Переносимая production-сборка с подготовкой зависимостей и автоматическим HTTPS.

Дизайн, формы и бизнес-правила остаются под контролем приложения. Native Safari — best effort, доступность функций зависит от браузера. [Поддержка браузеров](https://github.com/soluser010/layer-engine/blob/main/docs/ru/browser-support.md).

## Быстрый старт

Требования: **Node.js >=24.22.1 <25**, **npm 11**.

```sh
mkdir my-workspace
cd my-workspace
npm init -y
npm install @solcorp/layer
npx layer create my-app
cd apps/my-app
npm install
npm run dev
```

Откройте адрес из вывода `dev`. Первая установка предоставляет весь фреймворк и CLI. `create` создаёт `apps/my-app`; установка внутри приложения формирует его собственный lockfile. Отдельно устанавливать Layer-пакеты не нужно. Альтернатива: `npm install --global @solcorp/layer` добавляет команду `layer` в терминал, если каталог npm находится в PATH.

```text
apps/my-app/
├── layer.config.js        Настройки приложения и production
├── package.json           Команды dev / build / doctor
├── src/
│   ├── pages/             Страницы и файловые маршруты
│   ├── app.js             Жизненный цикл приложения
│   ├── operations.js      Контракты публичных операций
│   └── server/            Серверный код и схема БД
├── public/                Манифест, иконки и статические файлы
└── dist/                  Переносимая сборка после build
```

## Первый компонент

Замените содержимое `apps/my-app/src/pages/index.layer.js`:

```js
import {html, layerComponentCreate, layerSignalCreate} from '@solcorp/layer';

export default layerComponentCreate(function Counter(){
    //Keeping reactive state owned by this component
    const count = layerSignalCreate( 0 );
    const increase = function(){
        //Updating only the bindings that depend on this signal
        count.set( count.get() + 1 );

    };

    return html`<button @click=${increase}>Count: ${count}</button>`;

});
```

Сохраните файл при запущенном `npm run dev`: страница пересоберётся и обновится. Кнопка меняет только связанный с сигналом текст. Далее: [компоненты](https://github.com/soluser010/layer-engine/blob/main/docs/ru/components.md), [операции сервера](https://github.com/soluser010/layer-engine/blob/main/docs/ru/operations.md), [конфигурация](https://github.com/soluser010/layer-engine/blob/main/docs/ru/configuration.md). Backend включается явно через `deployment.serverEntry`; один файл `operations.js` его не запускает.

## Production и HTTPS

Соберите приложение локально:

```sh
npm run build
```

Скопируйте **содержимое `dist`** на сервер. Из этого каталога на Linux:

```sh
export LAYER_DOMAIN=app.example.com
export LAYER_STATE_DIRECTORY=/var/lib/my-app
npm start
```

На сервере нужны поддерживаемые Node/npm. Создайте доступный для записи постоянный каталог состояния, направьте DNS A/AAAA домена на сервер и обеспечьте Caddy доступ к портам 80/443. Для первой установки зависимостей, скачивания закреплённого Caddy и получения сертификата нужен интернет. Production-секреты передаются через ENV.

Caddy автоматически получает и продлевает публичный TLS-сертификат, перенаправляет HTTP на HTTPS. В стандартной схеме не требуется вручную устанавливать сертификат или писать конфиг прокси. Для localhost используются локальные сертификаты. DNS, firewall, существующий reverse proxy и права на порты остаются ответственностью развёртывания.

Запускайте `npm start` под systemd, PM2 или другим supervisor. Сохраняйте state directory между обновлениями: в нём сертификаты и системные данные embedded-режима. Статическая PWA не запускает лишний Node API worker. [Развёртывание](https://github.com/soluser010/layer-engine/blob/main/docs/ru/deployment-diagnostics.md), [автоматический HTTPS Caddy](https://caddyserver.com/docs/automatic-https).

## Локальная документация

Начиная с **0.1.1**, основной пакет автоматически устанавливает `@solcorp/layer-docs`:

```sh
npx layer guide --lang ru
npx layer guide --lang en --open
```

Руководство содержит RU/EN-статьи, примеры, подсветку кода и локальный поиск, соответствует установленной версии и доступно на `127.0.0.1` без интернета после установки. Ctrl+C останавливает сервер. `--open` открывает браузер по желанию. `layer docs` по-прежнему генерирует API самого приложения. До публикации 0.1.1 используйте онлайн-руководство по ссылкам выше.

## Навык агента

**[Навык Layer-Engine](https://github.com/soluser010/layer-engine/blob/main/skills/layer-engine/SKILL.md)** помогает совместимому агенту найти документацию установленной версии, работать с `.layer.js`, соблюдать границы браузера и сервера и использовать штатные API. [Установка и применение](https://github.com/soluser010/layer-engine/blob/main/skills/layer-engine/README.md).

Навык необязателен, не устанавливается автоматически и не предоставляет доступ к аккаунтам или production.

## Расширение VS Code

**[Layer-Engine для VS Code](https://github.com/soluser010/layer-engine/blob/main/extensions/layer-vscode/README.md)** добавляет HTML/CSS IntelliSense, подсветку, сниппеты, hover, диагностику и иконки файлов. Внутри `${...}` сохраняются штатные JavaScript-подсказки.

Marketplace-публикации пока нет. В checkout исходников фреймворка выполните `npm ci --ignore-scripts`, `npm run ide:test`, `npm run ide:package`. Затем **Extensions: Install from VSIX** → `artifacts/layer-engine-vscode-0.2.0.vsix`. Установка отдельная и требует вашего действия. [Настройка IDE](https://github.com/soluser010/layer-engine/blob/main/docs/ru/editor-tooling.md).

## Пакеты и участие

`@solcorp/layer` — единая точка установки. Остальные `@solcorp/layer-*` — автоматически устанавливаемые модули; выбирать их вручную не требуется. Документация не включается в production-сборку приложения.

- [Исходники и Issues](https://github.com/soluser010/layer-engine)
- [Участие](https://github.com/soluser010/layer-engine/blob/main/CONTRIBUTING.md)
- [Безопасность](https://github.com/soluser010/layer-engine/blob/main/SECURITY.md)
- [Изменения](https://github.com/soluser010/layer-engine/blob/main/CHANGELOG.md)
- [Лицензия Apache-2.0](https://github.com/soluser010/layer-engine/blob/main/LICENSE)

Сайт `layer.solcorp.ru` планируется; действующая документация размещена в GitHub. Версия 1.0.0 и native Safari certification не заявляются.
