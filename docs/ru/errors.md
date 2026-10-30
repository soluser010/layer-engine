---
title: Ошибки и диагностика
description: Как читать CLI, runtime, protocol и browser ошибки Layer и безопасно выбирать retry или исправление.
audience: beginner
order: 230
status: release-candidate
updated: 2026-10-06
---

# Ошибки и диагностика

## Цель

Найти источник ошибки по code/requestId, не раскрыть секрет и не создать бесконечный retry.

## Публичная ошибка API

```js
const operationErrorData = {
    code: 'RATE_LIMITED',
    message: 'Request rate is limited.',
    requestId: '01900000-0000-7000-8000-000000000001',
    retryable: true,
    details: {
        retryAfterMs: 1000
    }
};
```

UI ветвится по code, сохраняет requestId для поддержки и использует retryable/retryAfterMs. message безопасен для общего объяснения, но приложение может заменить его локализованным текстом. details не следует выводить целиком без allowlist.

## Категории

| Категория | Примеры | Действие |
| --- | --- | --- |
| Input | INVALID_PAYLOAD, CLI_CONFIG_INVALID | исправить поле/schema; не retry |
| Identity | AUTH_REQUIRED, CSRF_INVALID | обновить auth state или показать вход |
| Access | PERMISSION_DENIED, OBJECT_ACCESS_DENIED | не повторять автоматически |
| Capacity | RATE_LIMITED | ждать retryAfterMs |
| Conflict | REVISION_CONFLICT | показать merge/reload flow |
| Dependency | DEPENDENCY_UNAVAILABLE | сохранить offline intent, ждать recovery |
| Lifecycle | QUERY_DISPOSED, COMMAND_ACTIVE | исправить component lifecycle |
| Build | LAYER_*_INVALID, CLI_DEV_BUILD_FAILED | исправить source diagnostic |

## CLI diagnostics

`INVALID_PAYLOAD` относится к входу операции; неверный результат handler скрывается за `INTERNAL_ERROR`. Низкоуровневый server adapter может выбросить `DATABASE_DEPENDENCY_UNAVAILABLE`, но это не универсальный browser error code. Проверяйте контракт того API, которое вызываете: managed Auth имеет свои identity codes, а базовый security слой — `AUTHENTICATION_REQUIRED`, `AUTHORIZATION_DENIED`, `CSRF_INVALID` и связанные protocol codes.

Запустите команду с --diagnostics=json или LAYER_CLI_DIAGNOSTICS=json для CI. Известная config ошибка содержит file, path, line, column и suggestions. Сначала исправляйте самую раннюю ошибку: следующие часто являются её следствием.

```text
layer doctor --diagnostics=json
layer build --diagnostics=json
```

CLI_INTERNAL_ERROR означает непредвиденный boundary failure. Сохраните code, безопасное сообщение, команду, Node/npm versions и минимальный reproduction. Не публикуйте .env, cookies, tokens, database URLs или полный private stack.

## Browser diagnostics

Проверьте:

1. Network: document, hashed JS/CSS, manifest, layer-service-worker.js.
2. Console: первый Layer code до каскадных AbortError.
3. Application: active/waiting Service Worker, Cache Storage, IndexedDB.
4. layer doctor и server /health/ready.
5. requestId в server audit/diagnostics.

Быстрые route переходы могут отменять старый query. Cancelled request — ожидаемое состояние, если устаревший результат не заменил новую страницу. Ошибка становится дефектом, когда cancel показывается пользователю или ломает актуальный handle.

## Service Worker

waiting не всегда ошибка: двухфазное обновление ждёт безопасного restart/activate. Используйте layer.pwa.update.getState(), check() и activate() для собственного UX. Не вызывайте skipWaiting вслепую и не удаляйте cache/IndexedDB как универсальное исправление.

## Failure contract

Для [Web Push](web-push.md): `NOTIFICATIONS_SECRET_UNAVAILABLE` означает отсутствующие/неверные ENV secrets и закрытый startup; `NOTIFICATIONS_INVALID` возвращает безопасный path неверного поля; `NOTIFICATIONS_SUBSCRIPTION_LIMIT` — лимит устройств пользователя. Отказ permission (`PWA_PUSH_PERMISSION_DENIED`) не следует автоматически повторять.

Stack/cause остаются внутри trusted diagnostics. Redaction удаляет credentials и payload secrets. Незнакомый code считается non-retryable generic failure. Любой автоматический retry должен быть bounded, учитывать idempotency и прекращаться при отмене lifecycle owner.

Далее: [reference](reference.md), [testing](testing.md), [deployment diagnostics](deployment-diagnostics.md).
