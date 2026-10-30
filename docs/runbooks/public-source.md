# Приватный GitVerse и публичный GitHub

История GitVerse сохранена. Она содержит прежние приложения, поэтому её нельзя отправлять в GitHub, в том числе через merge, mirror или force push. Используются **два checkout с независимой веткой main**:

| Checkout | Remote | Команда |
| --- | --- | --- |
| Приватный исходный | `origin` → `git@gitverse.ru:solcorp/Layer-Engine.git` | `git push origin main` |
| Публичный очищенный | `public` → `git@github.com:soluser010/layer-engine.git` | `git push public main` |

`apps/` игнорируется и удалён из текущего индекса приватной ветки; локальные файлы приложений остаются на диске. Старые коммиты сохранены приватными. Публичная ветка начинается с собственного Initial commit GitHub и получает только снимки исходников. Удаление приложений из текущего дерева само по себе не очищает историю.

## Перенос проверенного изменения

1. В приватном checkout завершите проверки и commit. Рабочее дерево должно быть чистым.
2. Один раз создайте отдельный публичный checkout: `git clone -o public git@github.com:soluser010/layer-engine.git ../layer-engine-public`.
3. В приватном checkout: `node scripts/public-source-sync.js ../layer-engine-public`.
4. В публичном checkout изучите `git diff --stat`, изменения и `public-source.json`. Скрипт копирует обычные файлы, не Git objects; manifest фиксирует исходный SHA и SHA-256 публичных файлов.
5. Установите Node 24.22.1+ ветки 24.x и npm 11; выполните `npm ci --ignore-scripts`, `npm run check`, `npm run api:check` и `npm run supply-chain:check`. При изменениях runtime используйте соответствующие browser/security gates. Первый GitHub Actions run проверяется отдельно; локальный Windows прогон не подменяет Linux CI.
6. Добавьте только проверенные пути, создайте отдельный публичный commit и выполните `git push public main`. Обе отправки — fast-forward, без force.

В приватном checkout рекомендуется `git config core.hooksPath .githooks`. Его pre-push hook запрещает отправку приватной истории в GitHub, независимо от имени remote. Публичный checkout этот hook не получает. Git hooks — дополнительная защита от ошибки, а не граница доступа.

## Состав публичного исходного кода

Включаются явный список файлов корня, `packages`, `extensions`, `skills`, `docs`, `fixtures`, `scripts`, `test`, `browser-tests`, `compatibility`, `infra` и `.github`. Не включаются `apps`, `.gitverse`, `.githooks`, рабочая история, state, node_modules, dist, artifacts, локальные ENV, ключи и токены. Проверки приложения создают временные fixtures штатным генератором и не требуют пользовательских проектов.

Публичный workflow только проверяет код. Он не публикует npm/Marketplace, не создаёт release tag и не меняет видимость GitVerse. Apache-2.0 LICENSE и attribution сохраняются. Npm candidate готовится отдельно по [инструкции](npm-candidate.md); его публикация — отдельный шаг владельца.
