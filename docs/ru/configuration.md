---
title: Конфигурация приложения
description: Строгий layer.config.js, безопасные режимы отключения, инфраструктура и production-секреты.
audience: beginner
order: 50
status: documented
updated: 2026-10-31
---

# Конфигурация приложения

[Карта возможностей](capabilities.md)

## CSS: целевые браузеры

`css.targets` задаёт минимальные версии браузеров **для преобразования CSS**. При отсутствии блока используются значения ниже; новые приложения получают их явно. Собственный объект `targets` полностью заменяет defaults.

```js
export default {
    appName: 'css-example',
    css: {
        targets: {
            chrome: '109',
            edge: '109',
            firefox: '115',
            safari: '16.4',
            ios_saf: '16.4'
        }
    }
};
```

В `layer dev` и `layer build` автоматически включены префиксы, поддерживаемое преобразование современного синтаксиса и минификация через закреплённый Lightning CSS. Поддерживаемые ключи: `chrome`, `edge`, `firefox`, `safari`, `ios_saf`, `opera`, `samsung`, `android`. Версии — строки `major`, `major.minor` или `major.minor.patch`; компоненты 0–255, major от 1. `null`, пустой объект targets, неизвестные поля, `latest` и диапазоны запрещены (`CLI_CONFIG_INVALID` с путём ошибки). Для Safari на iOS используйте `ios_saf`, для macOS — `safari`.

Неявное чтение Browserslist, package.json targets и ENV отключено: один конфиг даёт одинаковую обработку CSS в dev и production. Изменение `layer.config.js` требует перезапуска dev-сервера. Исходные стили не меняются, сборка не загружает внешние `@import`. Обычные локальные public CSS обрабатываются отдельно, пути URL сохраняются. Для воспроизводимости устанавливайте зависимости по lockfile, включая optional native-пакет Lightning CSS своей платформы; install scripts не требуются.

Targets не означают сертификацию всего runtime для старого браузера и не являются рекомендацией использовать устаревший браузер. JavaScript/PWA capabilities и действующая [browser matrix](browser-support.md) остаются отдельным контрактом. Преобразования не эмулируют неподдерживаемые layout/API: динамический `color-mix()` с CSS-переменными, некоторые селекторы и новые layout-возможности могут требовать авторского fallback/`@supports`.

Подробнее о порядке обработки и диагностике: [CSS сборка](authoring-layer-js.md#css-build-pipeline).

## Цель

Штатный блок updates и оформление из manifest: [обновления приложения](application-updates.md).

Выбрать минимальный режим приложения, включить только нужные подсистемы и понять диагностические ошибки конфигурации.

Новый проект получает полный layer.config.js с активными безопасными defaults и закомментированными рецептами. Не копируйте все рецепты одновременно: начните с режима приложения и добавляйте инфраструктуру по мере необходимости.

## Минимальный статический PWA

```js
export default {
    appName: 'catalog',
    appVersion: '0.1.0',
    sourceDirectory: 'src',
    publicDirectory: 'public',
    outputDirectory: 'dist',
    auth: null,
    notifications: null,
    development: {
        host: '127.0.0.1',
        port: 5173,
        https: false,
        liveReload: true
    },
    database: {
        embedded: {
            dataDirectory: null
        },
        postgres: [],
        schema: {
            file: 'src/server/database.js',
            synchronization: 'additive'
        },
        replica: {
            maximumLagMs: 2000
        },
        pool: {
            maximumConnectionsPerWorker: 5,
            connectionBudget: null
        }
    },
    redis: null,
    runtime: {
        workers: {
            minimum: 1,
            maximum: 1
        }
    },
    deployment: {
        domain: null,
        serverEntry: null,
        originPort: 8787,
        dependencies: {}
    }
};
```

При serverEntry: null production bundle не запускает Node API, PGlite или Redis. Блоки database/runtime остаются валидными defaults, но не создают процессы.

## Full-stack без внешней БД

Укажите serverEntry: 'server/index.js', оставьте postgres: [] и workers 1/1. Layer откроет PGlite для системных таблиц. Прикладные SQL-таблицы, несколько workers и HA в этом режиме недоступны.

## Локальный PostgreSQL без пароля

```js
postgres: [{
    name: 'primary',
    role: 'primary',
    host: '127.0.0.1',
    port: 5432,
    database: 'layer_application',
    username: 'postgres',
    password: null,
    tls: {
        mode: 'disable'
    }
}]
```

password: null и plaintext разрешены только для loopback development. Удалённый PostgreSQL требует ENV secret и TLS verify-full. Redis отключается значением null; удалённый Redis подчиняется тем же правилам.

## Workers

- 1/1 — PGlite или внешний PostgreSQL;
- 2/2, 4/4 — фиксированные workers, только внешний PostgreSQL;
- 2/8 — диапазон autoscale;
- 2/auto — автоматический максимум, обязательно задайте connectionBudget.

Суммарный pool не должен превышать бюджет PostgreSQL. Caddy распределяет запросы через least_conn, sticky sessions не нужны.

## Секреты

```js
{
    password: {
        env: 'LAYER_POSTGRES_PRIMARY_PASSWORD'
    }
}
```

Production build отклоняет literal secrets. ENV-значения не записываются в dist, manifest, diagnostics или generated declarations. Файл .env не является частью deployment contract: передавайте переменные через supervisor/secret store.

## Web Push

Web Push выключен по умолчанию (`notifications: null`). Для включения нужны `deployment.serverEntry`, VAPID public/private ENV references и отдельный стабильный encryption secret. Redis необязателен: задания остаются в системной SQL-очереди. [Полная настройка и примеры](web-push.md).

## Разрешения сторонних ресурсов CSP

`security.csp.sources` добавляет источники к HTTP Content-Security-Policy. Настройка применяется одинаково к серверу разработки и `dist/Caddyfile`; существующие локальные источники сохраняются. Отсутствующая настройка, `security: null` или пустые `sources` сохраняют исходную политику.

```js
export default {
    appName: 'my-app',
    security: {
        csp: {
            sources: {
                'script-src': ['https://sdk.example.com'],
                'connect-src': ['https://api.example.com', 'wss://events.example.com'],
                'img-src': ['https://*.images.example.com'],
                'style-src': ['blob:'],
                'frame-src': ['https://widgets.example.com']
            }
        }
    }
};
```

Поддерживаются только ресурсные директивы `script-src`, `style-src`, `connect-src`, `img-src`, `media-src`, `font-src`, `frame-src`, `child-src`, `worker-src`, `manifest-src`. Новый список дополняет `'self'`, а не заменяет его. Разрешение `https://*.example.com` охватывает поддомены; для самого `https://example.com` нужна отдельная запись.

Для iframe карты добавьте только origin из его `src`, например:

```js
export default {
    appName: 'map-app',
    security: {
        csp: {
            sources: {
                'frame-src': ['https://api-maps.yandex.ru']
            }
        }
    }
};
```

Если код виджета использует `https://yandex.ru`, разрешите этот origin вместо него или дополнительно при необходимости. Не копируйте путь и query из URL iframe в список CSP. Для страницы внутри внешнего iframe действуют политики её сервера: разрешать все скрипты, картинки и подключения карты в родительском приложении не требуется. Встраивание через JavaScript SDK, напротив, требует разрешений для ресурсов, загружаемых непосредственно приложением, и совместимости SDK с Trusted Types.

`frame-src` управляет iframe, `script-src` — скриптами, `connect-src` — Fetch и другими соединениями, `worker-src` — workers. Используйте `frame-src` для встраивания вместо общего legacy `child-src`: `worker-src 'self'` и `manifest-src 'self'` заданы явно в обоих режимах, поэтому разрешения для frames или scripts не расширяют их через fallback. Исключения для workers добавляются только в `worker-src`. Development сохраняет прежнее исключение для inline styles инструментов; production его не получает.

Источники — HTTPS-origin без credentials, пути, query и fragment; `wss://` разрешён только для `connect-src`. HTTP/WS допускаются только для loopback (`localhost`, `127.0.0.1`, `[::1]`). Для локальных ресурсов допустимы `data:` в `img-src`/`font-src` и `blob:` в `style-src`/`img-src`/`media-src`/`worker-src`. На директиву допускаются 32 записи, суммарная нормализованная конфигурация — до 6000 символов. Дубликаты удаляются.

Регистр протокола и hostname нормализуется без потери wildcard: `HTTPS://*.EXAMPLE.COM` становится `https://*.example.com`. Имена директив остаются строго заданными lowercase-ключами. Разрешение WSS стороннему сервису не меняет транспорт Layer: прикладной API и realtime движка остаются HTTP/Fetch Stream без WebSocket.

Конфиг не разрешает `*`, произвольные protocol wildcards, `unsafe-inline`, `unsafe-eval`, отключение CSP или замену защитных директив. `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'` и production `require-trusted-types-for 'script'` сохраняются. Разрешённый сторонний SDK должен также быть совместим с Trusted Types; разрешение origin не снимает эту проверку. Разрешения браузера не меняют серверные права операций, CORS стороннего сервера, сетевой доступ или оффлайн-кеш.

Некорректные источники останавливают конфигурацию с `CLI_CONFIG_INVALID` и точным `security.csp.sources.<directive>[index]`, без вывода значения. После изменения перезапустите `layer dev`; для публикации пересоберите bundle. Секретные ключи в CSP не помещаются.

## Development

host принимает только loopback. Изменение host, port, HTTPS или layer.config.js требует перезапуска layer dev. liveReload: false отключает dev client и служебные SSE endpoints. HTTPS включается объектом с keyFile и certificateFile.

## Deployment

domain содержит hostname без схемы и пути. null требует LAYER_DOMAIN на сервере. serverEntry включает private Node origin; dependencies содержит только внешние runtime-пакеты с точными версиями. Layer-пакеты и обычные server imports собираются в bundle.

## Типовые ошибки и решения

- CLI_CONFIG_INVALID с path: удалите unknown field или исправьте тип по suggestion.
- DATABASE_CLUSTER_REQUIRED: верните workers в 1/1 либо настройте внешний PostgreSQL.
- APPLICATION_DATABASE_REQUIRED: удалите прикладные tables либо настройте PostgreSQL.
- Remote password: null: укажите password: {env: '...'}.
- Remote tls.mode: disable: настройте verify-full и CA.

## Failure contract

Конфигурация проверяется до сборки и открытия публичных портов. Диагностика содержит code, файл, field path, line/column при наличии и безопасные suggestions; секретное значение и stack не выводятся.

Далее: [server runtime](server-runtime.md), [базы данных](database-runtime.md), [deployment](deployment-diagnostics.md).

## Разрешения устройств браузера

`security.permissionsPolicy` принимает только `camera`, `microphone`, `geolocation`, `payment`. Для каждой возможности разрешены `[]` (запрет) и `['self']` (только собственный origin). Wildcard, сторонние origin и неизвестные возможности отклоняются.

```js
export default {
    appName: 'my-app',
    security: {
        permissionsPolicy: {
            camera: [],
            microphone: ['self'],
            geolocation: ['self'],
            payment: []
        }
    }
};
```

Production без настройки сохраняет запрет всех четырёх возможностей. Development выставляет Permissions-Policy только при явной настройке, сохраняя прежнее поведение остальных приложений. Заголовок не отменяет разрешение пользователя на микрофон/геолокацию и не изменяет CSP.

`self` — точный собственный origin, не все поддомены. Неуказанные возможности в явно заданном объекте запрещаются. После изменения конфигурации перезапустите dev-сервер; для production пересоберите `dist`. Поддержка директив зависит от браузера: Permissions-Policy не заменяет capability checks и пользовательское согласие.

## Закрытые файлы и журналы
Links, viewer allowlist и генераторы associations: [навигация](links-navigation.md). Они не отключают запрет служебных файлов.


Dev host и generated Caddyfile по умолчанию возвращают 404 для `.env`, `.env.*`, `*.env` и их вариантов на любой глубине, независимо от регистра. Запрет действует до backend forwarding, navigation fallback и HTTP→HTTPS redirect; URL-кодирование не разрешает открыть файл. Пользовательские environment-файлы в `public` не копируются в `dist` и не включаются в precache. Генерируемая `.env.example` остаётся служебным deployment-файлом без секретных значений и закрыта по HTTP.

Также закрыты package/lock, Caddyfile, node_modules, server/deployment metadata, declarations и source maps. Запрет не отключается через `security.csp` или `permissionsPolicy`. Секреты храните вне публичных каталогов даже при наличии этой защиты; она не защищает произвольную публичную копию секрета с другим именем.

Default Caddy error logger удаляет request headers и query из `request.uri`, сохраняя путь и диагностические поля ошибки. Это не универсальная redaction любых сообщений или прикладных журналов. Не помещайте секреты в URL path и текст ошибок; отдельный добавленный access logger должен иметь собственный безопасный filter.
