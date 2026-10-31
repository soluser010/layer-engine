---
title: Все настройки страницы
description: layerPageCreate, defaults, metadata и ограничения.
audience: intermediate
order: 102
status: documented
updated: 2026-10-31
---

# Все настройки страницы

[Карта возможностей](capabilities.md) · [Полные сигнатуры и типы](api-reference-router.md)

Объект `page` статический и читается compiler без исполнения произвольного JavaScript. Неизвестные поля и неподдерживаемые значения отклоняются с `ROUTE_MANIFEST_INVALID`. Фабрика возвращает неизменяемый верхний объект, но сама не подключает router. Полные примеры: [SSR](routing-ssr.md), [CSR](routing-csr.md).

## Все параметры

| Поле | Тип / значения | Default | Действие |
| --- | --- | --- | --- |
| `render` | `'ssr' / 'csr'` | `ssr` | Пререндер статического URL при build либо создание DOM в браузере. |
| `layout` | `string / null` | `inherited / null` | Имя `[a-z][a-z0-9-]{0,79}`. Внешняя оболочка с одним outlet. |
| `auth` | `'session' / 'none'` | `session` | Проверка authenticated в router; не защита опубликованного HTML. |
| `permissions` | `string[]` | `[]` | Уникальные dotted names; все должны быть в identity.permissions. |
| `preload` | `string[]` | `[]` | Уникальные имена операций; вызываются последовательно через runner приложения. |
| `guard` | `string / null` | `null` | Dotted name; вызывается через guardRun после permissions. |
| `offline` | `'deny' / 'shell' / 'snapshot' / 'local'` | `deny` | deny блокирует offline-переход. Остальные разрешают продолжить; снимки/локальные данные не создаются автоматически. |
| `cache` | `'private' / 'public' / 'no-store'` | `private` | В текущем pipeline это metadata: не переключает HTTP headers, SW или сохранение DOM. |
| `metadata` | `object` | `{}` | Только перечисленные ниже строковые поля; без секретов. |

## Metadata

| Поле metadata | Максимум символов |
| --- | --- |
| `title` | 200 |
| `description` | 500 |
| `robots` | 200 |
| `canonical` | 2048 |
| `author` | 200 |
| `keywords` | 500 |
| `themeColor` | 100 |
| `colorScheme` | 100 |
| `applicationName` | 200 |
| `language` | 35 |
| `direction` | 4 |
| `openGraphTitle` | 200 |
| `openGraphDescription` | 500 |
| `openGraphType` | 100 |
| `openGraphUrl` | 2048 |
| `openGraphImage` | 2048 |
| `openGraphImageAlt` | 500 |
| `openGraphSiteName` | 200 |
| `openGraphLocale` | 35 |
| `twitterCard` | 30 |
| `twitterTitle` | 200 |
| `twitterDescription` | 500 |
| `twitterImage` | 2048 |
| `twitterImageAlt` | 500 |

Все значения — непустые строки без C0/DEL. Максимум 24 поля. URL-поля `canonical`, `openGraphUrl`, `openGraphImage`, `twitterImage`: HTTP(S) либо root-relative путь, не `//host`. `direction`: `auto`, `ltr`, `rtl`; `twitterCard`: `app`, `player`, `summary`, `summary_large_image`; `language`: языковой тег вида `ru-RU`. Значения применяются к документу, а не к manifest PWA.

## Подключение guard и preload

В `src/app.js` объявите `guardRun(name, {route, params, identity})`, возвращающий строго `true` для разрешения. `false`/объект дают `forbidden`; строка становится статусом отказа. Объект `{redirect: ...}` не выполняет переход; нужную навигацию реализует приложение. Проверку прав данных обязательно повторяет сервер. `preload(operationName, {params})` возвращает значение или Promise; результат доступен странице в `context.route.preload[operationName]`. Это не автоматическое заполнение query cache. Укажите собственное преобразование params в payload операции. Без runner заявленная возможность завершается ошибкой, а не пропускается.

## Совместимость

Нельзя считать `null` универсальным способом отключения: для layout применяется наследование через `??`; `null` не сбрасывает унаследованный layout. Выбирайте явный layout или структуру маршрутов без наследования. По изменению настроек выполните новую сборку.

Далее: [обзор](routing.md), [кэширование](caching.md).
