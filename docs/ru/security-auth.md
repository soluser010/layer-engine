---
title: Безопасность и auth primitives
description: Identity, permissions, CSRF, rate limits и trust boundaries.
audience: intermediate
order: 160
status: documented
updated: 2026-10-07
---

# Безопасность и auth primitives

## Цель

Зарегистрировать операцию с минимальными правами и server-derived identity.

## Пример

```js
registry.define({
    name: 'profile.rename',
    type: 'command',
    auth: 'session',
    permissions: ['profile.write'],
    transaction: true,
    inputSchema,
    outputSchema,
    handler
});
```

## Ожидаемый результат

Session/user/tenant берутся из проверенного server context. Значения identity из payload не влияют на ownership и permissions.

## Объяснение

Browser session использует opaque `Secure`, `HttpOnly`, `SameSite=Lax` cookie и CSRF для привилегированных POST. External clients используют bearer, интеграции — scoped hashed API keys. Проверки выполняются на operation, object и field уровнях.

## Сторонние ресурсы и CSP

Приложение может добавлять точные источники через [security.csp.sources](configuration.md#разрешения-сторонних-ресурсов-csp). Разрешения не отключают CSP: `'self'`, запреты объектов, base URI и frame ancestors, а также production Trusted Types сохраняются. Валидатор отклоняет произвольный текст политики, небезопасные script keywords и подмену защитных директив. Добавлять следует только сервисы, которым приложение намеренно доверяет загрузку указанного типа ресурсов; доступ к операциям и данным проверяется независимо на сервере.

## Типовые ошибки

- `auth: none` на операции, которая читает личные данные.
- Секрет в `layer.config.js` вместо ENV reference.
- Remote plaintext PostgreSQL/Redis или произвольный URL без SSRF allowlist.

## Failure contract

Ошибка наружу содержит стабильный code, requestId и retryable/details без stack/cause. Rate limits одновременно учитывают IP, identity, tenant, operation и cost. Объёмный DDoS требует внешнего CDN/WAF.

Далее: [Context API](context-api.md), [развёртывание](deployment-diagnostics.md).
