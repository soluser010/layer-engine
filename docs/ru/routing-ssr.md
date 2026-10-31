---
title: Маршрутизация, layouts, SSR и hydration
description: Файловые routes, metadata, layouts и режимы первого рендера.
audience: intermediate
order: 100
status: documented
updated: 2026-09-24
---

# Маршрутизация, layouts, SSR и hydration

## Цель

Создать файловый маршрут с metadata, layout и предсказуемым режимом рендера.

## Пример

```js
import {layerPageCreate} from '@solcorp/layer';

export const page = layerPageCreate({
    layout: 'application',
    render: 'ssr',
    auth: 'session',
    preload: ['chat.rooms.list'],
    offline: 'shell',
    cache: 'private',
    metadata: {
        title: 'Сообщения'
    }
});
```

Файл `src/pages/chats/[roomId].layer.js` создаёт динамический маршрут `/chats/:roomId`.

## Ожидаемый результат

Сервер возвращает HTML с hydration markers. Клиент связывает существующие узлы и обновляет только зависимые bindings; полный DOM не перестраивается.

## Объяснение

Layout владеет внешней оболочкой, страница — route region. При несовместимом marker runtime выполняет контролируемое восстановление и пишет безопасную диагностику.

## Типовые ошибки

- Browser-only side effect в setup SSR-компонента.
- Нестабильный key в repeat-списке.
- Ожидание API-данных в build-time SSR: transport там намеренно недоступен.

## Failure contract

Guard может вернуть redirect/forbidden до рендера. Hydration mismatch не исполняет серверный HTML как код и не раскрывает stack пользователю.

Далее: [operations и Context API](context-api.md), [offline и realtime](offline-realtime.md).
