---
title: Дополнительные PWA API
description: Badging, уведомления, фоновая синхронизация, persistent storage и протоколы.
audience: intermediate
order: 185
status: documented
updated: 2026-10-31
---

# Дополнительные PWA API

[Карта возможностей](capabilities.md) · [Полные сигнатуры и типы](api-reference-pwa.md)

Используйте `window.layer.pwa` после запуска браузерного runtime. Capability показывает наличие API, но не гарантирует разрешение ОС или успех последующего вызова. В SSR browser side effects не выполняются.

<!-- contract: pwa -->
## Счётчик приложения

<!-- example: application/pwa.mjs -->
```js
/** @param {ReturnType<typeof import('@solcorp/layer-pwa').layerPwaCapabilitiesCreate>} pwa @param {number} unreadCount */
export async function unreadBadgeApply( pwa, unreadCount ){
    //Keeping the in-app counter usable when platform badging is unavailable
    if ( pwa.badge.getCapability().supported === false ){
        return {applied: false, reason: 'unavailable'};

    }

    try {
        //Clearing an empty badge instead of leaving a stale platform indicator
        if ( unreadCount === 0 ){
            await pwa.badge.clear();

        } else {
            await pwa.badge.set( unreadCount );

        }

        return {applied: true};

    } catch ( error ){
        //Handling platform refusal without losing the application's own counter
        let reason = 'platform-refused';
        if ( error instanceof Error && 'code' in error && typeof error.code === 'string' ){
            reason = error.code;

        }
        return {applied: false, reason};

    }

}
```

Вызов: `await unreadBadgeApply(window.layer.pwa, 3)`. `badge.set()` без числа запрашивает точку; число — неотрицательный safe integer; `clear()` убирает badge. Сохраняйте видимый счётчик внутри приложения при любом результате.

## Уведомления

```js
const pwa = window.layer.pwa;
const permission = await pwa.notifications.requestPermission();
if ( permission === 'granted' ){
    await pwa.notifications.show( 'Message saved', {body: 'Your draft is ready', tag: 'draft-ready'});

}
const visibleNotifications = await pwa.notifications.list( 'draft-ready' );
const closedCount = await pwa.notifications.close( 'draft-ready' );
```

Запрос разрешения запускайте только явной кнопкой пользователя; отказ не повторяйте навязчиво. `show` требует permission и готовую регистрацию Service Worker. `list()` без tag возвращает уведомления текущей регистрации; `close(tag)` требует непустой tag и возвращает число закрытых. Это локальный показ, не серверная доставка: см. [Web Push](web-push.md). NotificationOptions, включая `badge`, ограничены возможностями платформы.

## Фоновая синхронизация и хранение

```js
const pwa = window.layer.pwa;
const syncCapability = await pwa.backgroundSync.getCapability();
if ( syncCapability.supported ){
    await pwa.backgroundSync.register( 'layer-outbox' );

}
const storageCapability = pwa.storage.getCapability();
if ( storageCapability.supported ){
    const alreadyPersistent = await pwa.storage.persisted();
    const persistent = alreadyPersistent || await pwa.storage.persist();
    const estimate = await pwa.storage.estimate();
    console.log( {persistent, usage: estimate.usage, quota: estimate.quota} );

}
```

Регистрация sync не означает немедленное выполнение; браузер выбирает время. Штатный outbox также отправляется при следующем запуске/возврате сети. Произвольный tag требует соответствующего worker handler; вызов register сам бизнес-обработчик не создаёт. Persistence может вернуть false; estimate не резервирует место, quota способна измениться.

## Обработчики протоколов

```js
const protocols = window.layer.pwa.protocols;
if ( protocols.getCapability().supported ){
    protocols.register( 'web+chat', '/open/?uri=%s' );

}
```

Вызывайте register по действию пользователя. `protocols.unregister('web+chat', '/open/?uri=%s')` снимает регистрацию, если браузер поддерживает метод. Handler URL должен быть same-origin относительным путём с `%s`; разрешены ограниченные стандартные schemes и `web+` с буквами. Это запрос браузеру, не гарантия выбора default-приложения. Полученный uri повторно валидирует приложение; не открывайте произвольный URL из query. Manifest protocol_handlers и OS association — отдельные механизмы.

## Failure contract

Недоступный метод даёт `PWA_CAPABILITY_UNAVAILABLE`; malformed input отклоняется до платформенного вызова. Возможен последующий browser permission/platform rejection даже после supported=true: обрабатывайте Promise rejection и оставляйте доступным основной сценарий. Нельзя эмулировать фоновую работу бесконечным таймером.

Далее: [sharing](sharing.md), [обновление](application-updates.md), [ограничения браузеров](browser-support.md).
