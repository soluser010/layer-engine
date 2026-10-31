---
title: PWA, Service Worker и обновления
description: Capabilities, offline cache, background sync и безопасные обновления.
audience: intermediate
order: 180
status: documented
updated: 2026-09-28
---

# PWA, Service Worker и обновления

Карточка, прогресс, buildId и многовкладочное сохранение: [обновления приложения](application-updates.md).

Серверная отправка, VAPID и очередь: [Web Push](web-push.md).
Входящие ссылки, внешний viewer и platform associations: [навигация](links-navigation.md).
Отправка наружу и приём текста, ссылок и файлов: [Поделиться и Share Target](sharing.md).

## Цель

Проверить capability, запросить установку только по действию пользователя и безопасно применить обновление.

## Пример

Вызывайте `installHandle()` из обработчика кнопки после запуска приложения. Не запускайте эту функцию при SSR или автоматически при открытии страницы.

```js
const installHandle = async function(){
    //Checking current availability inside the application's install button handler
    const installCapabilityData = window.layer.pwa.install.getCapability();

    if ( installCapabilityData.availability === 'available' ){
        //Leaving the installation decision to the user and browser
        await window.layer.pwa.install.prompt();

    }

};
```

## Ожидаемый результат

Браузер сам решает, доступен ли install prompt. Layer не вызывает его автоматически и не подавляет нативный UI без причины.

## Объяснение

Один generated Service Worker управляет hashed precache, navigation fallback, GET cache, outbox sync, push и двухфазным обновлением. API/state не кладутся в Cache Storage. Не-GET запросы и `/_layer/dev/*` проходят напрямую из документа, без `respondWith`: долгие API и dev streams не удерживают активацию worker, отмена запроса остаётся у браузера. Исключение — точный POST route объявленного Share Target. Layer применяет новую сборку только по кнопке; minVersion отмечает критичность без скрытой автоактивации.

При сборке файлы из `public/assets` включаются в обязательный precache с SHA-256-проверкой. Допускается до 2048 файлов, не более 2 МиБ на файл и 16 МиБ суммарно. Ссылки, небезопасные имена и превышение лимитов останавливают сборку; неполный офлайн-набор не публикуется. Другие файлы `public` не добавляются автоматически.

## Типовые ошибки

- Ожидание Service Worker на production HTTP: нужен HTTPS либо localhost.
- Кэширование `/_layer/dev/*`: dev endpoints всегда обходят cache.
- Принудительный `prompt()` без user gesture: браузер отклонит запрос.

## Failure contract

Недоступная capability возвращает явный status/reason, а не фиктивный polyfill. Неудачное обновление сохраняет активную рабочую версию. Logout очищает user-scoped IndexedDB/cache/subscription state.

Далее: [browser support](browser-support.md), [offline и realtime](offline-realtime.md).
