# Проверка npm candidate без публикации

Это инструкция сопровождающему фреймворк, не команда пользовательского приложения.

1. Используйте отдельный чистый checkout проверяемого SHA и Node.js 24.22.1+ в ветке 24.x, npm 11.
2. Выполните `npm ci --ignore-scripts`, затем требуемые release checks. Не используйте рабочую папку пользовательских приложений как источник candidate.
3. Выполните `npm run pack:check -- --candidate`.

Gate упаковывает каждый publishable пакет из `packages`, включая Auth, проверяет LICENSE, executable, ESM exports и subpath declarations. В отдельном временном каталоге устанавливает настоящий глобальный CLI и локальное приложение из этих архивов через временный read-only loopback registry. Внешние зависимости берутся из npm registry; публикация не выполняется. Проверяются create/build/dev, реальные ESM imports и TypeScript consumer с `skipLibCheck: false`. Установочные scripts зависимостей отключены. Глобальная установка ограничена временным prefix и не заменяет системную команду `layer`.

После успешной проверки `artifacts/candidates/<SHA>-<time>/` содержит именно проверенные `.tgz` и `candidate.json`: SHA исходников, ОС/архитектуру, Node, SHA-256 и npm integrity каждого архива. Сборка candidate отказывается работать с изменённым checkout и повторно сверяет состояние после проверок. Каталог `.preparing` не является готовым candidate.

Этот gate не заменяет browser/security/infrastructure проверки или испытание владельцем на Linux и в реальном приложении. Windows-результат не является доказательством Linux-результата; в GitVerse Linux CI обычный `npm run check` выполняет тот же pack gate. Исторические прогоны фиксируйте отдельно с SHA и платформой.

Candidate остаётся unsigned и unpublished. Не создавайте stable tag, версию `1.0.0`, npm или Marketplace публикацию без отдельного разрешения владельца.
