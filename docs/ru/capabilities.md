---
title: Карта возможностей и справочников
description: Карта возможностей и справочников.
audience: intermediate
order: 5
status: documented
updated: 2026-10-31
---

# Карта возможностей и справочников

Это входная карта всех основных областей приложения. Сначала выберите задачу, затем прочитайте сценарий и справочник. Типы в справочнике показывают полный набор вложенных параметров; рабочие примеры находятся в руководствах.

| Область | Возможности | Руководство | Дополнительно | Сигнатуры |
| --- | --- | --- | --- | --- |
| Страницы и навигация | SSR/CSR, layouts, guard, preload, metadata | [Guide](routing.md) | [Details](page-configuration.md) | [API](api-reference-router.md) |
| Шаблоны и компоненты | html, css, props, events, slots, context | [Guide](authoring-layer-js.md) | [Details](components.md) | [API](api-reference-layer.md) |
| Реактивность | signal, computed, effect, batch, store, boundaries | [Guide](reactivity.md) | [Details](advanced-runtime.md) | [API](api-reference-render.md) |
| Вызовы API | query, command, commandOnline, cache, cancellation | [Guide](context-api.md) | [Details](operations-reference.md) | [API](api-reference-runtime.md) |
| Сервер | registry, handler context, lifecycle, HTTP runtime | [Guide](server-runtime.md) | [Details](operations.md) | [API](api-reference-server.md) |
| Данные PostgreSQL | schema, CRUD, transactions, filters, replicas | [Guide](database-runtime.md) | [Details](structured-data.md) | [API](api-reference-database.md) |
| Локальные данные | stores, indexes, migrations, watch, quota, outbox | [Guide](indexeddb.md) | [Details](cache-outbox.md) | [API](api-reference-storage.md) |
| Realtime | POST stream, channels, cursor, replay, multi-tab | [Guide](offline-realtime.md) | [Details](server-events.md) | [API](api-reference-events.md) |
| Авторизация | identity, sessions, roles, OAuth, providers | [Guide](layer-auth.md) | [Details](auth-advanced.md) | [API](api-reference-auth.md) |
| Безопасность | CSRF, permissions, limits, trusted proxy | [Guide](security-auth.md) | [Details](configuration-reference.md) | [API](api-reference-security.md) |
| PWA | install, share, notifications, storage, launch, update | [Guide](pwa-service-worker.md) | [Details](pwa-capabilities.md) | [API](api-reference-pwa.md) |
| Web Push | subscription, delivery, retries, VAPID | [Guide](web-push.md) | [Details](pwa-capabilities.md) | [API](api-reference-notifications.md) |
| Протокол | envelopes, versions, safe errors | [Guide](operations.md) | [Details](errors.md) | [API](api-reference-protocol.md) |
| Расширения | trusted plugins, capabilities, setup | [Guide](advanced-runtime.md) | [Details](server-runtime.md) | [API](api-reference-plugin-sdk.md) |

## Как читать контракты

- **Обзор** отвечает, что доступно и какой механизм выбрать.
- **Справочник** перечисляет формы данных, допустимые варианты, обязательность, defaults и ограничения. Если default отдельно не заявлен, не выводите его из названия поля или знака `?`.
- **Пример** показывает место файла, импорты, вызов и ожидаемый результат. Фрагмент внутри компонента требует уже существующего context; это отмечается перед блоком.
- **Failure contract** объясняет отказ, fallback и ответственность приложения.

Полный [конфиг приложения](configuration-reference.md), [CLI](installation-cli.md), [CSS](authoring-layer-js.md), [клавиатура/viewport](viewport.md), [sharing](sharing.md), [ссылки](links-navigation.md), [обновления](application-updates.md), [deployment](deployment-diagnostics.md).

## Ограничения текущей версии

Принимаемое значение не всегда включает отдельную стратегию. Особые случаи `page.cache`, `offline: snapshot/local`, наследование layout и build-time SSR явно разобраны в [справочнике страницы](page-configuration.md). Возможности ОС проверяются через capability API; это не полифиллы и не обещание поддержки каждой платформой.

Server integrations и ручные hosts выделены как advanced. Для обычного приложения используйте штатный launcher и component context. Внутренние инструкции выпуска фреймворка в это руководство не входят.
