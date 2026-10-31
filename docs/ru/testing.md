---
title: Тестирование приложений
description: Unit, protocol, renderer, browser, security, integration и load-проверки Layer-приложения.
audience: intermediate
order: 200
status: documented
updated: 2026-10-27
---

# Тестирование приложений

## Цель

Проверять бизнес-логику быстро, а реальные browser/database/PWA контракты — отдельными воспроизводимыми проверками.

## Пирамида проверок

1. Unit: чистые services, merge-policy, validators.
2. Contract: operation schemas, registry metadata, error codes.
3. Renderer: реальные DOM mutations, keyed identity, cleanup.
4. Integration: POST /api, PostgreSQL transaction, Redis fallback, event replay.
5. Browser: SSR→hydration, navigation, IndexedDB, offline, Service Worker update.
6. Security: XSS, CSRF, BOLA/BFLA, injection, SSRF, deep/large body, replay, limits.
7. Load/soak: throughput, p50/p95/p99, CPU/RSS/ELU, pools, streams and drain.

## Unit example

Используйте встроенный node:test и передавайте зависимости явно.

Создайте `src/server/status.js` в своём приложении. Этот handler можно назначить операции `system.status` с `auth: 'none'` и schema результата `{status: string}`.

```js
export async function statusRead(){
    //Returning the application status without private infrastructure details
    return {status: 'ok'};

}
```

Затем создайте `test/status.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {statusRead} from '../src/server/status.js';

test( 'public status handler returns the documented result', async function(){
    //Calling the application's own handler with validated input
    const operationResultData = await statusRead( {}, {} );

    //Checking the exact output contract
    assert.deepEqual( operationResultData, {
        status: String( 'ok' )
    });

});
```

Запуск из каталога приложения: `node --test test/status.test.js`. Ожидается один успешный тест. Прямой вызов handler проверяет только его бизнес-логику; HTTP/auth/schema проверяйте отдельным integration-тестом.

## Что обязательно проверять у операции

- valid/invalid input and output;
- auth none/session/bearer/api-key;
- permissions и object authorize;
- timeout, concurrency и rate-limit cost;
- transaction commit/rollback;
- idempotent command replay;
- offline conflict и retryability;
- tenant/user isolation;
- handler не виден в inspection.

## Renderer и browser

Проверяйте не только HTML, но и число реальных DOM mutations. Для repeat сохраните Element reference, измените один item и подтвердите, что остальные nodes не заменены. Browser test должен открыть прямой route, выполнить hydration, навигацию с query/hash, reload под Service Worker и offline fallback.

## Инфраструктура

Локальный fault proxy безопаснее остановки общей службы: он моделирует disconnect/reconnect PostgreSQL или Redis на отдельных тестовых портах. Integration environment должен использовать отдельную database/schema и Redis database index; cleanup не должен касаться пользовательских данных.

## Проверки вашего приложения

Добавьте в package.json приложения собственные команды для unit и integration tests. Они должны запускать проверки ваших операций, политик доступа и пользовательских сценариев. Перед развёртыванием проверьте собранный production bundle, восстановление данных и откат версии на отдельном стенде.

## Нагрузочные проверки

Повышайте нагрузку ступенчато. Задайте допустимые задержки и потребление ресурсов для своего приложения. Отделяйте успешные 200 от защитных 429; общий transport rate не равен полезной пропускной способности.

## Safari

Выбирайте браузеры по аудитории вашего приложения. Для iPhone/iPad отдельно проверяйте Safari во вкладке и установленную PWA: ввод, клавиатуру, safe-area, навигацию и возврат из фона. Недоступные возможности должны иметь понятный fallback.

## Failure contract

При превышении допустимой задержки, потере данных или нарушении прав доступа исправьте причину и повторите соответствующий сценарий перед развёртыванием. Не отключайте защиту API в публичной среде.

Далее: [ошибки](errors.md), [browser support](browser-support.md), [performance report](performance-report.md).
