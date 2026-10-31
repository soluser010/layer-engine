---
title: Server runtime и serverEntry
description: Контракт full-stack server entry, operation registry, private origin, readiness, drain и Caddy.
audience: intermediate
order: 130
status: documented
updated: 2026-10-20
---

# Server runtime и serverEntry

## Цель

Подключить Node backend только тогда, когда приложению нужны операции, auth, database или event stream.

Static PWA оставляет deployment.serverEntry: null. Full-stack приложение указывает serverEntry: 'server/index.js'. CLI собирает этот ESM-граф в dist/_layer/server/application.mjs.

## Lifecycle contract

Server entry экспортирует layerServerCreate(context). Factory возвращает start, stop и isReady. Launcher всегда передаёт private loopback host/port; приложение не открывает публичный 0.0.0.0 самостоятельно.

```js
import {
    layerDiagnosticsCreate,
    layerHttpRuntimeCreate,
    layerOperationExecutorCreate
} from '@solcorp/layer-server';
import {applicationOperationRegistryCreate} from './operations.js';
import {applicationSecurityCreate} from './security.js';

export async function layerServerCreate( contextData ){
    //Checking infrastructure managed by the Layer launcher
    if (
        typeof contextData.databaseRuntime?.query !== String( 'function' ) ||
        typeof contextData.rateLimiter?.consume !== String( 'function' )
    ){
        //Passing the incomplete runtime context to startup
        throw new TypeError( String( 'The application server context is invalid.' ) );

    }

    //Creating the sealed operation, security, and diagnostics boundaries
    const operationRegistryData = applicationOperationRegistryCreate();
    const securityData = applicationSecurityCreate( contextData );
    const diagnosticsData = layerDiagnosticsCreate();
    const operationExecutorData = layerOperationExecutorCreate({
        operationRegistry: operationRegistryData,
        security: securityData,
        rateLimiter: contextData.rateLimiter,
        diagnostics: diagnosticsData,
        database: contextData.databaseRuntime,
        databaseSchema: contextData.databaseSchema,
        queryCache: contextData.queryCache
    });
    const httpRuntimeData = layerHttpRuntimeCreate({
        operationRegistry: operationRegistryData,
        operationExecutor: operationExecutorData,
        diagnostics: diagnosticsData,
        database: null,
        trustedProxy: contextData.trustedProxy
    });

    //Returning the lifecycle controlled by dev host or production launcher
    return Object.freeze({
        async start( listenOptionsData ){
            //Opening only the private loopback listener supplied by Layer
            await httpRuntimeData.start( listenOptionsData );

        },
        async stop( stopOptionsData = {} ){
            //Draining active requests before the worker exits
            await httpRuntimeData.stop( stopOptionsData );

        },
        isReady(){
            //CallBack THE BOOLEAN
            return httpRuntimeData.isReady();

        }
    });

}
```

Это infrastructure-level пример. Для приложения создайте небольшие modules operations.js, security.js и services, чтобы index.js показывал порядок startup/shutdown, а не содержал бизнес-логику.

## Managed context

Launcher передаёт environment, workerId, trustedProxy, databaseRuntime, databaseSchema, rateLimiter, queryCache, eventBus, leases, coordination, Redis status и Layer Auth factory в зависимости от конфигурации. Проверяйте только реально нужные зависимости и завершайте startup, если обязательная недоступна.

Не создавайте отдельный PostgreSQL pool или Redis client в каждом domain module: managed context уже учитывает worker count, connection budget, fallback и shutdown order.

## HTTP surface

Layer HTTP runtime публикует:

- GET /health/live;
- GET /health/ready;
- POST /api;
- OAuth/OIDC interoperability endpoints только при включённом Layer Auth provider.

HTML, JS, CSS, manifest и Service Worker отдаёт Caddy как GET resources. Event stream открывается operation events.open через POST /api.

## Startup и shutdown

Production launcher выполняет integrity → dependencies → Caddy verification → database/migrations → workers/readiness → public Caddy. При SIGINT/SIGTERM Caddy перестаёт направлять новые запросы, worker выполняет drain HTTP/SSE и только затем закрывает adapters.

isReady означает готовность обслужить реальный запрос, а не только наличие процесса. Потеря primary PostgreSQL снимает readiness для write API. Redis failure включает предусмотренный fallback и не делает Redis источником истины.

## Trusted proxy

Передавайте context.trustedProxy в layerHttpRuntimeCreate. Runtime доверяет forwarded address только от настроенного loopback Caddy boundary и идёт справа налево до ближайшего недоверенного hop. Никогда не включайте доверие к X-Forwarded-For на публичном listener без точного proxy allowlist.

## Безопасная диагностика HTTP

`layerDiagnosticsCreate({sink})` передаёт allowlisted скалярные поля. В `request.failed` доступны `stage`, `errorType`, `errorCode`, `causeType`, `causeCode`, `requestComplete`, `responseDestroyed`, `responseEnded`, `responseHeadersSent` и прежние `requestId`, `operation`, `code`, `status`. Типы/технические коды причин ограничены: message, stack, SQL, payload, headers и credentials не копируются.

Стадии: `readiness`, `body-read`, `protocol`, `envelope`, `client-address`, `stream-authorization`, `stream-open`, `operation`, `response`, `extension`. До проверки envelope операция не считается доверенной. До разбора body используется server-generated UUID, который возвращается в JSON-ошибке, если ответ ещё можно отправить. Ошибка sink не ломает запрос и не выводится небезопасным console fallback.

Обрыв тела запроса классифицируется как `REQUEST_ABORTED`: событие `request.aborted` имеет уровень `info`, не является подтверждённой внутренней ошибкой и не получает выдуманный HTTP 499. Закрытому соединению ответ не отправляется; если оно ещё доступно, ошибка имеет HTTP 400. Сбой зависимости с `ECONNRESET` во время операции остаётся внутренней ошибкой, а не отменой клиента. Невалидный JSON остаётся 400, превышение размера — 413, body deadline — 408.

Если журнал приложения фильтрует события/поля, явно подключите `request.aborted` и новые технические поля, иначе они будут отброшены. Worker/build metadata можно добавить в server-only sink из доверенного launcher context; не включайте HTTP-заголовки или произвольный объект ошибки. Внешний requestId используется для корреляции, не как identity или permission.

Обрыв после commit не доказывает rollback: повтор команды выполняется с прежним `commandId` по существующему идемпотентному контракту.

## Типовые ошибки

- serverEntry задан, но файл не экспортирует layerServerCreate;
- start открыл другой host/port;
- registry запечатан до регистрации Layer Auth/system operations;
- readiness всегда true при потерянной БД;
- stop не ждёт drain event streams.

## Failure contract

Ошибка factory/start/readiness не запускает публичный Caddy listener. Launcher возвращает bounded code без private stack/cause. Завершение Caddy всегда инициирует stop worker; частично запущенный backend не считается готовым.

Далее: [операции](operations.md), [базы данных](database-runtime.md), [deployment](deployment-diagnostics.md).
