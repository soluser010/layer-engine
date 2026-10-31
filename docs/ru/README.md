---
title: Документация Layer-Engine
description: Полное русскоязычное руководство по разработке, проверке и развёртыванию приложений Layer-Engine.
audience: all
order: 0
status: documented
updated: 2026-10-29
---

# Документация Layer‑Engine

Layer‑Engine — JavaScript-фреймворк S.O.L CORP для безопасных offline-capable PWA, интерактивных приложений, социальных сетей и мессенджеров. Автор и правообладатель: **S.O.L CORP**. Официальный сайт: [solcorp.ru](https://solcorp.ru).

Исходники и документация: [GitHub](https://github.com/soluser010/layer-engine). Основной [npm-пакет](https://www.npmjs.com/package/@solcorp/layer) опубликован. Сайт `layer.solcorp.ru` пока планируется. Локальное руководство `npx layer guide --lang ru` доступно с версии 0.1.1.

## Как читать руководство

- **Новичку:** обзор → установка → быстрый старт → структура проекта → конфигурация → синтаксис → реактивность → компоненты → операции → сборка.
- **Разработчику приложения:** routing/SSR → Context API → базы данных → Layer Auth → offline/realtime → PWA → recipes.
- **Backend/DevOps:** server runtime → security → deployment → testing → browser support → performance → reference.

Каждая статья разделяет минимальный рабочий путь и рекомендуемый production-подход. «Проще» означает меньше настроек для ограниченного сценария, а не отключение валидации, прав или server-derived identity.

## Оглавление

### Знакомство и установка

1. [Что такое Layer‑Engine](overview.md)
2. [Установка и CLI](installation-cli.md)
3. [Быстрый старт](getting-started.md)
4. [Структура проекта](project-structure.md)
5. [Конфигурация приложения](configuration.md)
6. [VS Code, IntelliSense и live reload](editor-tooling.md)

### Разработка интерфейса

7. [Разработка на *.layer.js](authoring-layer-js.md)
8. [Signals, stores и частичный DOM](reactivity.md)
9. [Компоненты, props, events, slots и context](components.md)
10. [Маршрутизация, layouts, SSR и hydration](routing-ssr.md)
    - [Viewport, клавиатура и оболочка приложения](viewport.md)

### API и сервер

11. [Операции: полный и упрощённый подход](operations.md)
12. [Context API компонентов](context-api.md)
13. [Server runtime и serverEntry](server-runtime.md)
14. [Базы данных, Redis и workers](database-runtime.md)
15. [Layer Auth](layer-auth.md)
16. [Безопасность и auth primitives](security-auth.md)

### Offline, PWA и эксплуатация

17. [Offline, outbox и realtime](offline-realtime.md)
18. [PWA, Service Worker и обновления](pwa-service-worker.md)
    - [Штатное обновление приложения](application-updates.md)
    - [Ссылки, входящие запуски и viewer](links-navigation.md)
    - [Серверный Web Push](web-push.md)
    - [Поделиться: отправка и приём текста и файлов](sharing.md)
19. [Build, deployment и diagnostics](deployment-diagnostics.md)
20. [Тестирование приложений](testing.md)
21. [Поддержка браузеров](browser-support.md)
22. [Отчёт по производительности](performance-report.md)

### Практика и справочник

23. [Ошибки и диагностика](errors.md)
24. [Практические рецепты](recipes.md)
25. [Configuration, CLI и errors reference](reference.md)
26. [Глоссарий](glossary.md)

## Версия руководства

Используйте руководство, соответствующее установленной версии Layer-Engine. Команда `npx layer guide --lang ru` открывает локальную документацию.

## Подробные API и контракты

- [Structured CRUD и ревизии](structured-data.md)
- [IndexedDB приложения](indexeddb.md)
- [Cache и очередь команд](cache-outbox.md)
- [Дополнительные PWA API](pwa-capabilities.md)
- [Серверные события](server-events.md)
- [Store, boundaries и расширения](advanced-runtime.md)
- [Права и данные сессий](auth-advanced.md)
- [Каталог публичных API](api-catalog.md)
- [Полный справочник конфигурации](configuration-reference.md)
