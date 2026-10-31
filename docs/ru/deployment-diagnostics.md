---
title: Build, deployment и diagnostics
description: Переносимый dist, Caddy HTTPS, supervisor и диагностика запуска.
audience: advanced
order: 190
status: documented
updated: 2026-09-24
---

# Build, deployment и diagnostics

## Security baseline и соединения upstream

Минимальный runtime — **Node.js 24.22.1**, поддерживается стабильная ветка `>=24.22.1 <25` и npm 11. CLI, doctor и переносимый launcher проверяют полную версию. `CLI_NODE_UNSUPPORTED` / `DEPLOY_NODE_UNSUPPORTED` означают, что нужно обновить Node и перезапустить терминал, supervisor и все workers. Проверяйте executable службы: версия в SSH-оболочке может отличаться. `npm audit fix` не обновляет сам Node.

Generated Caddy использует upstream `keepalive 4s`, а Node runtime — idle timeout 5 секунд. Прокси освобождает простаивающее соединение раньше backend; это снижает риск POST 502 при повторном использовании закрывающегося сокета. Четыре секунды — время простоя между запросами, не ограничение длительности SSE. Общий retry POST не включается: потеря ответа не означает откат команды. Повторять бизнес-команду следует с прежним `commandId`.

После обновления фреймворка пересоберите `dist`: существующий deployment не получает новый launcher/Caddyfile автоматически. Перед переключением проверьте staging и сохраните предыдущий release для rollback; rollback приложения не должен возвращать уязвимый Node.

При исследовании OOM сравнивайте heapUsed/heap limit, RSS, external memory, число streams, PG pool и рабочую нагрузку по worker. Рост RSS сам по себе не доказывает JS-утечку. Heap snapshot может приостановить процесс и потребовать дополнительной памяти — снимайте его на изолированном стенде. Увеличение heap без профилирования не доказывает исправление.

## Цель

Перенести только `dist` на сервер и запустить его под внешним supervisor.

## Пример

```text
npm run build
cd dist
npm run check
npm start
```

```text
LAYER_DOMAIN=app.example.com
LAYER_STATE_DIRECTORY=/var/lib/layer/application
```

## Ожидаемый результат

Launcher проверяет integrity, lockfile и зависимости, безопасно устанавливает закреплённый Caddy 2.11.4, запускает private workers, ждёт readiness и оставляет Caddy foreground-процессом.

## Объяснение

`dist` содержит package/lock, Caddyfile, runtime launcher, assets и optional server bundle. Сертификаты, embedded data и Caddy binary живут вне release в state directory. systemd/PM2/Windows service управляет restart и логами.

## Типовые ошибки

- Нет DNS/firewall или прав на 80/443.
- `LAYER_DOMAIN` отсутствует при `deployment.domain: null`.
- Registry недоступен при первой locked-установке.
- Production secret задан literal-строкой.

## Failure contract

Порядок fail-closed: integrity → dependencies → Caddy checksum → config validation → workers/readiness → public Caddy. При ошибке backend публичный listener не запускается. SIGINT/SIGTERM выполняют drain HTTP/SSE.

Используйте `layer doctor`, `/health/live`, `/health/ready` и bounded diagnostics. Секреты, stack и raw SQL не логируются.

Далее: [database runtime](database-runtime.md), [security](security-auth.md), [production runbook](../runbooks/production-deployment.md).
