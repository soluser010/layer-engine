# Карта локальной документации Layer-Engine

Все пути ниже относительны найденному `<framework-root>/docs`. Сначала откройте `ru/README.md`; если его нет, используйте `en/README.md`. Для отсутствующей отдельной переведённой статьи проверьте английский аналог той же установки. Актуальное оглавление имеет приоритет над этой картой; найдите новое имя через оглавление или поиск по теме.

| Задача | Статьи в выбранной `ru/` или `en/` |
| --- | --- |
| Назначение, архитектура, ограничения и статус готовности | `overview.md`, `glossary.md` |
| Установка, CLI, первый проект, диагностика окружения | `installation-cli.md`, `getting-started.md` |
| Каталоги приложения, конфигурация, generated dist | `project-structure.md`, `configuration.md` |
| Компоненты `*.layer.js`, generated operation facade, CSS и editor tooling | `authoring-layer-js.md`, `editor-tooling.md` |
| Signals, stores, bindings и обновление DOM | `reactivity.md` |
| Компоненты, props, events, slots, lifecycle и context | `components.md`, `context-api.md` |
| Страницы, layouts, маршруты, SSR и hydration | `routing-ssr.md` |
| Контракты query/command/sync, схемы, обработчики и авторизация | `operations.md`, `server-runtime.md`, `security-auth.md` |
| Server entry, данные, Redis, workers и изменения схем | `server-runtime.md`, `database-runtime.md` |
| Layer Auth, сессии и security primitives | `layer-auth.md`, `security-auth.md` |
| IndexedDB, outbox, idempotency, конфликты и realtime | `offline-realtime.md` |
| Service Worker, offline shell, кеши и обновления | `pwa-service-worker.md`, `browser-support.md` |
| Build, deployment, диагностика и ошибки | `deployment-diagnostics.md`, `errors.md`, `reference.md` |
| Проверки, практические примеры и измерения | `testing.md`, `recipes.md`, `performance-report.md` |

Для задач сопровождения дополнительно выбирайте существующие файлы:

- Совместимость и поддержка: `policies/semver-and-migrations.md`, `policies/runtime-support.md`, `policies/dependency-risk-acceptance.md`.
- Выпуск/развёртывание: `runbooks/release.md`, `runbooks/production-deployment.md`.
- Восстановление и инциденты: `runbooks/backup-restore.md`, `runbooks/incident-response.md`.
- Нагрузка и браузерная проверка: `runbooks/ddos-and-capacity.md`, `runbooks/native-safari-release-check.md`.

Чтение runbook не является разрешением выполнить описанные в нём изменения. Действуйте в рамках запроса пользователя и подтверждённой среды. Не представляйте устаревший performance report как измерение текущего приложения.
