---
title: Поддержка браузеров
description: Browser matrix и capability fallbacks, включая Safari policy.
audience: all
order: 210
status: documented
updated: 2026-10-31
---

# Поддержка браузеров

[Карта возможностей](capabilities.md)

## Цель

Проектировать приложение по capabilities, не предполагая одинаковый PWA API во всех браузерах.

## Выбор возможностей приложения

| Возможность | Подход разработчика |
| --- | --- |
| Установка, push, background sync, badging | Проверяйте capability конкретного API и предусматривайте fallback. |
| Экранная клавиатура и viewport | Используйте viewport API; точная геометрия доступна не во всех браузерах. |
| Safari на iPhone/iPad | Учитывайте различия вкладки и установленной PWA; поддержка остаётся best effort. |

## Пример

Вызывайте `notificationsEnable()` из обработчика кнопки после запуска приложения. Не запускайте эту функцию при SSR или автоматически при открытии страницы.

```js
const notificationsEnable = async function(){
    //Checking browser support when the user requests notifications
    const pushCapabilityData = await window.layer.pwa.push.getCapability();

    if ( pushCapabilityData.availability !== 'available' ){
        //Replace this message with your application's notification settings UI
        console.info( pushCapabilityData.reason );
        return;

    }

    //Requesting permission and registering this device with the configured server
    await window.layer.pwa.push.enable();

};
```

## Ожидаемый результат

Недоступные install UI, push, background sync, badging, file/protocol handlers и viewport-возможности получают явный fallback.

Подключение сервера и VAPID описано в [Web Push](web-push.md). Доступность API сама по себе не означает, что пользователь разрешил уведомления или система доставит их немедленно.

## Объяснение

Ориентируйтесь на доступность конкретной функции, а не только на название браузера. Если ваша аудитория использует iOS, проверяйте ключевые сценарии своего приложения на целевых устройствах.

## Типовые ошибки

- User-agent sniffing вместо capability check.
- Обещание background sync там, где браузер может остановить worker.
- Попытка унифицировать install UX фиктивным polyfill.

## Failure contract

Capability API всегда возвращает доступность и причину. Приложение обязано иметь UX для unavailable/denied/dismissed состояний.

Далее: [PWA](pwa-service-worker.md), [viewport и клавиатура](viewport.md).
