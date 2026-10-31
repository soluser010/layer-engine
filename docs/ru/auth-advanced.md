---
title: Права, данные сессии и lifecycle аккаунта
description: Прикладные permissions и безопасное управление аккаунтом без повторения входа.
audience: advanced
order: 155
status: documented
updated: 2026-10-28
---

# Права, данные сессии и lifecycle аккаунта

Настройка и вход описаны в [Layer Auth](layer-auth.md). Здесь используется managed Auth, подключённый через `context.auth.create` в serverEntry. Обычный operation context всегда содержит security; auth extension появляется только при подключении Auth runtime.

<!-- contract: auth -->
## Роли и проверка доступа

```js
await authRuntime.roles.define({name: 'editor', permissions: ['messages.read', 'messages.edit']});
await authRuntime.roles.assign( userId, 'editor' );
const assigned = await authRuntime.roles.listForUser( userId );
await authRuntime.roles.remove( userId, 'editor' );
```

Это trusted server administration, не browser API. `authRuntime` — результат фабрики из [server runtime](layer-auth.md). Назначение роли вызывайте только из операции с административным permission и проверкой допустимого target user. Никогда не выдавайте роль непосредственно из присланного payload.roles. Роли глобальные; tenant-specific бизнес-доступ дополнительно проверяется authorize/repository.

Операция объявляет `permissions: ['messages.edit']`; handler получает проверенный `context.security`, а managed extension — `context.auth.user`, `permissions`, `assurance`. Guard на странице улучшает UI, но не заменяет серверную проверку. Изменение ролей инвалидирует авторизацию пользователя, включая активные сессии; интерфейс должен корректно предложить повторный вход.

## Custom session data

```js
import {LayerError} from '@solcorp/layer-protocol';

export async function selectedWorkspaceSave( payload, context ){
    //Requiring a managed browser session rather than trusting a payload session ID
    const session = context.auth?.session;
    if ( !session ){
        throw new LayerError( 'AUTH_REQUIRED', 'Sign in to save this preference.', {status: 401} );

    }

    //Validating workspace membership belongs in operation authorize before this handler
    const current = await session.data.get();
    return session.data.merge( {workspaceId: payload.workspaceId}, current.revision );

}
```

Зарегистрируйте handler как command, auth:session, с bounded workspaceId и проверкой членства в workspace. `session.data.get()` возвращает `{value, revision}`; `set(value, revision)` заменяет объект, `merge(patch, revision)` объединяет верхний уровень, `delete(['field'], revision)` удаляет выбранные поля. Результат записи содержит новое value/revision. Нет `context.auth.sessionData`: правильный путь — `context.auth.session.data`.

`AUTH_SESSION_CONFLICT` / 409 означает, что другая операция уже изменила данные. Перечитайте значение и повторно согласуйте patch; не подставляйте новую revision без проверки намерения. Данные ограничены `auth.session.dataMaximumBytes`, JSON-форматом и запретом зарезервированных identity/security полей. Custom data — предпочтения сессии, не место для паролей, access token или authoritative permissions. Для bearer/API key managed session может отсутствовать.

## Отзыв и удаление аккаунта

Браузер управляет только своими сессиями: `window.layer.auth.sessions.list()` и `sessions.revoke(sessionId)`. Серверный `context.auth.authorization.invalidate()` инвалидирует авторизацию текущего пользователя. Trusted `authRuntime.accounts.invalidate(userId, reason)` также предназначен только для проверенного административного кода.

`authRuntime.accounts.disable(userId)` запрещает дальнейшее использование и отзывает Layer-owned sessions/API keys/OAuth artifacts. `accounts.anonymize(userId)` вызывает настроенный `auth.anonymization` hook и очищает authentication identity. Прикладные профили/файлы нужно обработать в hook отдельно, идемпотентно. Ошибка оставляет процесс незавершённым для безопасного повтора, а не обещает распределённый rollback внешних систем. Не выполняйте destructive lifecycle из GET или без явного подтверждения приложения.

## Failure contract

Без действующей managed session — `AUTH_REQUIRED`; lost update custom data — `AUTH_SESSION_CONFLICT`; недопустимые custom values отклоняются валидацией. Не превращайте отказ в «успешный вход» через локальный store. Удаление аккаунта, отключение и отзыв — разные пользовательские действия и разные бизнес-политики.

Далее: [операции](operations.md), [безопасность](security-auth.md).
