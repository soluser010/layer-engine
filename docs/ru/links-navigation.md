---
title: Ссылки, входящие запуски и viewer
description: Навигация PWA, безопасный внешний viewer и генерация platform associations.
audience: all
order: 185
status: documented
updated: 2026-10-16
---

# Ссылки, входящие запуски и viewer

## Цель

Оставлять свои маршруты внутри приложения, принимать входящие ссылки и показывать разрешённые внешние сайты без размонтирования страницы. ОС и браузер выбирают открытие установленной PWA с учётом пользовательских настроек; Layer не перехватывает всю навигацию устройства.

## Быстрый старт

В layer.config.js разрешите только нужные внешние origins:

```js
export default {
    appName: 'example-app',
    links: {
        external: {
            mode: 'viewer',
            allowedOrigins: ['https://docs.example.com']
        },
        scopeExtensions: [],
        associations: {android: [], apple: [], windows: [], web: []}
    }
};
```

Обычный anchor на https://docs.example.com/help откроет viewer. Пустой allowlist ничего не встраивает: другие внешние ссылки остаются платформенными. external.mode: 'platform' отключает автоматический viewer. Origins — точные HTTPS origins без wildcard, credentials и path; HTTP допускается только для loopback development.

Новый manifest содержит id, scope, start_url, standalone и launch_handler с client_mode focus-existing. Build сохраняет авторские значения; отсутствующий id получает прежний effective start_url. Для установленной PWA примените обычное обновление manifest/Service Worker. Смена id может создать другую установку.

## API и обычные ссылки

window.layer.links — shared controller. context.links — component owner; в SSR/manual host без провайдера он null. Действия вызываются в browser lifecycle или пользовательском handler:

```js
const helpOpen = async function( context ){
    //Keeping server rendering and isolated hosts free from browser side effects
    if ( !context.links ){
        return;

    }
    //Opening only an origin explicitly allowed in application configuration
    const result = await context.links.open( 'https://docs.example.com/help', {mode: 'viewer'} );
    if ( result.status === 'blocked' ){
        //Reporting the safe action reason rather than a stack or sensitive URL
        console.warn( result.reason );

    }

};
```

open(url, {mode}) возвращает Promise результата. Modes: auto (default), app, viewer, external. Auto использует router для своих маршрутов, browser navigation для связанных origins, viewer для allowlist, иначе платформу. App не выходит из разрешённого scope. Explicit viewer вне allowlist или для same-origin iframe запрещён. External запрашивает новое окно с noopener/noreferrer.

Результат содержит status, url, reason. Status: navigated, viewer-opened, external-requested, blocked. Viewer-opened не доказывает загрузку сайта; external-requested не доказывает запуск окна. Не вызывайте external без user gesture.

closeViewer() идемпотентен; component owner закрывает только свой viewer. getCapability() сообщает viewer/launchQueue primitives и ограничения, не проверяет установку или remote embedding. Owner dispose выполняется при unmount; shared controller не dispose из компонента.

data-layer-link="app|viewer|external|auto" задаёт режим anchor. Ctrl/Cmd/Shift/Alt-click, download и явный target сохраняют браузерную семантику. Маршрут определяется pathname, query/hash сохраняются. Guards, permissions, preload, offline и cancellation не обходятся.

## Первый клик и переход из уведомления

Сборка добавляет небольшой внешний /_layer/navigation.js в head перед отображением пререндера. Пока основной runtime загружается и запускается, обычный внутренний anchor сохраняет последний запрошенный URL вместо полной загрузки документа. После readiness адрес передаётся штатному router вместе с pathname/query/hash; auth, permissions, guards и preload остаются обязательными.

Это не универсальная блокировка интерфейса. Неизвестные маршруты, другие origins, download, модификаторы и явный target не удерживаются. В частности, target="_self" намеренно сохраняет обычный переход браузера. Если основной runtime не готов через 15 секунд после удержанного клика либо сообщает ошибку запуска, Layer возвращается к нативной загрузке последнего URL, чтобы не запереть пользователя на неработающей странице.

При клике по Push открытое окно своего origin/scope сначала получает защищённый handoff через Service Worker. Подтверждение означает принятие URL приложением, не успешную авторизацию. Готовый runtime использует router без перезагрузки; повтор текущего URL не размонтирует страницу. Старое или неответившее окно получает нативный fallback после ограниченного ожидания до 2 секунд. Если окна нет, открывается новое. Закрытое приложение и неподдерживаемый платформой launch capture не могут запускаться без первой загрузки документа.

Bootstrap входит в integrity/precache и не требует inline script, eval, ослабления CSP или изменения API приложения. После обновления движка пересоберите и разверните dist. Уже открытое старое окно без bootstrap продолжит использовать совместимый нативный fallback до перехода на новую сборку.

## Viewer и безопасность

Один native dialog внутри app root: iframe, requested origin, предупреждение, Close и постоянная Open separately. Escape и закрытие восстанавливают подключённый focus target. Основная страница и её черновик не размонтируются; компонент освобождает только свой viewer.

Sandbox: allow-scripts allow-forms allow-same-origin. Popups, downloads, top navigation и device permissions не выдаются. Allowlist расширяет только frame-src, не script-src/connect-src. DOM создаётся без innerHTML; внешний CSS входит в integrity/precache. Оформление допускает --layer-viewer-background и --layer-viewer-color.

X-Frame-Options/frame-ancestors чужого сайта не обходятся. Load и cross-origin redirect нельзя надёжно проверить: показывается исходный origin, не подтверждённый текущий адрес iframe. Нет HTML proxy или автоматического timeout redirect. OAuth/платежи открывайте платформенно: sandbox и third-party cookies могут нарушить их.

## Platform associations и связанные домены

| Список links.associations | Поля записи | Generated документ в .well-known |
| --- | --- | --- |
| android | packageName, sha256CertFingerprints | assetlinks.json |
| apple | appId, paths (default /*) | apple-app-site-association |
| windows | packageFamilyName, paths (default *), excludePaths (default []) | windows-app-web-link |
| web | абсолютный manifest appId, scope (default /) | web-app-origin-association |

Android требует реальный applicationId и SHA-256 signing certificate (не upload key, если Play подписывает другим ключом). Apple appId: App ID prefix плюс bundle ID. Windows: Package Family Name. Web: полный manifest ID с path, не просто origin. Fingerprint: 32 colon-separated bytes. Максимум 32 записи/список; неизвестные поля и duplicate identities запрещены.

Заполненный список генерирует файл, пустой — нет. Signing keys, wrappers, credential sharing, Handoff и App Clips не создаются. Нативное приложение отдельно настраивает intent filters, Associated Domains entitlement или package manifest. Если в public уже есть генерируемый файл, удалите его или отключите генератор: рабочий dist не перезаписывается при конфликте.

Документы отдаются публично по HTTPS с application/json; у Apple/Windows/Web нет .json suffix. Они входят в release integrity, но не SW cache; отсутствующий документ возвращает 404 даже при Accept text/html.

scopeExtensions — origins связанных сайтов, добавляемые в manifest scope_extensions. Принимающий сайт должен подтвердить связь через web-app-origin-association. associations.web публикует согласие текущего сайта, не размещает файл на чужом сервере. Другой origin открывается браузером, не локальным router; cookies/storage/API credentials не объединяются. Возможность экспериментальная, browser fallback обязателен. [Справочник](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/scope_extensions).

## Launch Queue

Один native broker делит очередь между router, pwa.launch.setConsumer и pwa.files.setConsumer. Они не перезаписывают друг друга. До readiness сохраняется последний URL; после onReady он идёт в существующий router. Повтор текущего URL не remount страницу.

Manual launch consumer имеет приоритет; регистрируйте его в onReady. Startup replay и queued file delivery сохраняют ранние launches. До 32 file envelopes удерживаются до регистрации; overflow сообщает PWA_LAUNCH_QUEUE_LIMIT. Ошибка callback не лишает другой consumer доставки. Native launchQueue.setConsumer напрямую не вызывайте.

Без Launch Queue работают initial URL и router. Пользователь может отключить link capture. [Chrome navigation management](https://developer.chrome.com/docs/capabilities/pwa-navigation-management).

## Ошибки и проверка

CLI_CONFIG_INVALID и PWA_LINKS_CONFIG_INVALID сообщают links path без отражения входного значения. CLI_BUILD_ASSOCIATION_CONFLICT требует выбрать generated/public файл. Blocked reasons: url-denied, viewer-origin-denied, viewer-unavailable, app-scope-denied и текущие router boundaries (auth-required, offline, superseded). Invalid options/disposed API дают TypeError. Auto допускает platform fallback при известной локальной недоступности viewer, не при предположении об ошибке iframe.

Проверяйте direct URL/query/hash, повторный launch, viewer, Escape/focus, modifiers и отказ embedding. Для открытия ссылок операционной системой нужны настройки соответствующего APK/Apple/Windows-пакета и association-файлы на HTTPS-домене. Проверяйте этот сценарий на устройствах своей аудитории.

Далее: [PWA](pwa-service-worker.md), [routing](routing-ssr.md), [configuration](configuration.md), [browser support](browser-support.md).
