---
title: Установка и CLI
description: Установка фреймворка, команды Layer CLI и подготовка приложения.
audience: beginner
order: 20
status: documented
updated: 2026-10-29
---

# Установка и CLI

## Цель

Установить фреймворк и запустить первое приложение. Команда локального руководства `guide` доступна начиная с версии 0.1.1.

## Требования

Node.js **>=24.22.1 <25**, npm 11. Для Service Worker нужен HTTPS либо localhost. Git нужен только для checkout исходников; VS Code необязателен.

## Пример

```text
mkdir my-workspace
cd my-workspace
npm init -y
npm install @solcorp/layer
npx layer create hello-layer
cd apps/hello-layer
npm install
npm run dev
```

## Ожидаемый результат

Откройте адрес из вывода dev. Приложение находится в `apps/hello-layer`; родительская папка предоставляет локальный CLI. Все модули фреймворка устанавливаются как зависимости `@solcorp/layer`.

## Объяснение

`layer create` создаёт файлы, но не устанавливает зависимости. Установка внутри приложения формирует его lockfile и позволяет переносить приложение отдельно от родительской папки. Новые проекты закрепляют версию фреймворка. Обновляйте связанные Layer-пакеты согласованно: `CLI_FRAMEWORK_VERSION_MISMATCH` отклоняет смешанные версии.

Для глобальной команды:

```text
npm install --global @solcorp/layer
layer create hello-layer
```

Каталог npm bin должен находиться в PATH. Глобальная установка не заменяет зависимости приложения. Создание принимает имя, а не путь. Пробелы и регистр нормализуются; кириллица, traversal и `--name` запрещены.

## Команды

| Команда | Назначение |
| --- | --- |
| npm run dev | Build, watch и live reload |
| npm run build | Переносимый production dist |
| npm run doctor | Диагностика конфигурации и инфраструктуры |
| npm run inspect | Маршруты и план сборки |
| npm run docs | Сгенерированный API приложения |
| npm run database:plan | План несовместимых изменений схемы |
| npm run database:apply | Явно одобренные изменения схемы |
| npx layer guide --lang ru | Локальное руководство, с 0.1.1 |

`guide` не требует конфигурации приложения, слушает только loopback и выводит адрес. `--lang en` выбирает английский; `--open` открывает браузер. Ctrl+C закрывает listener. Поиск и подсветка используют локальные файлы. Внешние ссылки требуют сети. Руководство соответствует версии фреймворка и исключено из production-сборок.


## Типовые ошибки

- После локальной установки `layer` не найден: используйте `npx layer` или npm scripts.
- `npm run dev` запущен в родительской папке: перейдите в `apps/hello-layer`.
- В 0.1.0 нет `guide`: используйте онлайн-руководство или обновите фреймворк до 0.1.1 и выше.

## Failure contract

Отсутствующие пакеты восстанавливаются по lockfile приложения. Неподдерживаемый Node вызывает `CLI_NODE_UNSUPPORTED`. Неверные параметры guide вызывают `CLI_ARGUMENT_UNKNOWN`; занятый listener или отсутствующий файл руководства дают ошибку/404, а не доступ к файлам приложения.

Далее: [быстрый старт](getting-started.md), [IDE](editor-tooling.md), [развёртывание](deployment-diagnostics.md).
