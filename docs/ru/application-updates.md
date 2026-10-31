---
title: Обновления приложения
description: Наблюдаемое обновление ресурсов, manifest-карточка и безопасная смена Service Worker.
audience: all
order: 183
status: documented
updated: 2026-10-31
---

# Обновления приложения

[Карта возможностей](capabilities.md) · [Полные сигнатуры и типы](api-reference-pwa.md)

## Цель

Получать готовое обновление PWA без собственной реализации worker events, прогресса и многовкладочного согласования. Это служебная карточка Layer, а не общая библиотека UI-компонентов.

## Пример

В layer.config.js новые приложения получают:

```js
export default {
    appName: 'example-app',
    updates: {
        enabled: true,
        ui: true,
        checkIntervalMs: 300000
    }
};
```

UI можно заменить собственным, установив ui: false. enabled: false отключает проверки Layer, но не регистрацию и нативный lifecycle Service Worker. Интервал — от 60000 до 86400000 миллисекунд.

```js
const unsubscribe = window.layer.pwa.update.subscribe(function(state) {
    //Displaying immutable lifecycle state in application-owned interface
    console.log(state.phase, state.progress);

});

//Removing the subscription when the owning UI is disposed
unsubscribe();
```

## Ожидаемый результат

Проверка версии и обнаружение обновления не показываются. Первая подготовка офлайн-кэша тоже скрыта. Карточка появляется при загрузке новой сборки, показывает количество полностью проверенных и записанных файлов, затем предлагает «Обновить» и «Позже». До нажатия приложение продолжает работать.

«Позже» скрывает эту сборку до нового полного запуска документа, включая reload. SPA-переход и возврат из фона не сбрасывают выбор. Повторное ручное открытие: window.layer.pwa.update.show().

## Объяснение

Проверки выполняются при запуске, возвращении видимого документа, восстановлении сети и раз в пять минут в активной online-вкладке. Автоматические события объединяются, чаще раза в минуту запрос не отправляется. При активном dev live reload обновлением страницы владеет dev-механизм: карточка и production-проверки отключены.

AppVersion — человекочитаемая версия. BuildId вычисляется автоматически из публичных ресурсов и worker-программы без времени, секретов и случайных UUID. Даже при одинаковом appVersion новая сборка получает другой изолированный кэш. Legacy version.json сохраняет форму; update.json содержит update protocol 1, buildId и SHA-256 version manifest. Несовпадение файлов deployment прекращает применение.

Ресурсы проверяются SHA-256 перед готовностью и активацией. Рабочий кэш не удаляется при установке кандидата. Предыдущая полная сборка и кэши живых клиентов сохраняются; сессии, IndexedDB, outbox и черновики не очищаются. Прогресс — доля готовых файлов, не байты загрузки. Для получения worker-скрипта точный процент не придумывается.

Карточка берёт name, short_name, description, icons, background_color и theme_color из уже проверенного manifest. Иконка 76 px, ширина до 420 px, нижний отступ 16 px с safe-area/viewport. Кнопки занимают весь нижний ряд, hover затемняет фон на 5%. Текст RU для ru, иначе EN; font наследуется от приложения. Карточка находится вне route mount-root, поэтому не мешает CSR/hydration и не исчезает при навигации.

Публичные CSS-переменные: --layer-update-background, --layer-update-accent, --layer-update-text, --layer-update-button-text, --layer-update-radius, --layer-update-shadow. Их можно определить на app root или карточке. Приложение отвечает за контраст при собственных overrides.

## API и сохранение данных

Существующие check(), getState(), activate() сохранены. Добавлены subscribe(listener), dismiss(), show(); activate({force: true}) предназначен только для отдельного подтверждённого действия пользователя.

Состояние сохраняет updateAvailable, criticalUpdate, currentVersion, availableVersion, waiting. Дополнительно: currentBuildId, availableBuildId, phase, progress, visible, error. Фазы: idle/checking/downloading/verifying/ready/preparing/activating/blocked/error/unsupported.

Перед применением каждое окно вызывает экспорт onBeforeUpdate из src/app.js:

```js
export async function onBeforeUpdate({buildId, force}) {
    //Persisting application-owned drafts before agreeing to a new document
    console.log('Preparing release', buildId, force);

    //Returning false blocks ordinary activation when a draft cannot be saved
    return true;

}
```

В настоящем приложении сохраните черновики в IndexedDB и дождитесь транзакции вместо console.log. Отсутствие hook означает готовность окна. Затем Layer сохраняет системное offline-состояние. Timeout согласования — 15 секунд. Отказ, ошибка или неответившее окно дают предупреждение; «Всё равно обновить» может потерять несохранённый ввод. Force не отменяет проверку ресурсов или совместимости.

Успешное применение перезагружает участвующие окна с полными pathname/query/hash. Автоактивация Layer при запуске удалена. Браузер всё же может естественно активировать worker, когда старых клиентов больше нет. minVersion помечает критичность, но не скрывает «Позже».

## Типовые ошибки

- Ожидать новый buildId после каждого запуска одинаковой сборки: идентификатор детерминированный.
- Считать 75% файлов процентом скачанных байтов.
- Не сохранять содержимое обычного input в onBeforeUpdate.
- Вызывать force автоматически либо до показа предупреждения.
- При первом переходе со старого runtime ожидать новую карточку в уже загруженном старом JS.

Для первого rollout повысьте версию своего приложения. Старые runtime ещё не знают новый protocol; может потребоваться полностью закрыть старые окна и открыть приложение заново. Не очищайте пользовательскую IndexedDB. Дальнейшие обновления управляются новой карточкой.

## Failure contract

PWA_UPDATE_DEPLOYMENT_MISMATCH — metadata не из одной сборки; повторите после завершения deployment. PWA_UPDATE_NOT_READY — cache ещё не готов либо потерян. PWA_UPDATE_CLIENTS_BUSY — окно не подтвердило сохранение. PWA_UPDATE_TIMEOUT — worker не ответил вовремя. PWA_PROTOCOL_INCOMPATIBLE — force не разрешён. Ошибки подготовки сохраняют рабочую версию; тихая ошибка проверки не открывает карточку. Публичная ошибка содержит безопасный code, не stack/cause.

Далее: [PWA](pwa-service-worker.md), [configuration](configuration.md), [offline](offline-realtime.md), [testing](testing.md).
