---
title: Справочник сигнатур — @solcorp/layer-plugin-sdk
description: Параметры, возвращаемые значения и связанные типы.
audience: advanced
order: 310
status: documented
updated: 2026-10-31
---

# Справочник сигнатур — @solcorp/layer-plugin-sdk

Начните с [руководства и примеров](advanced-runtime.md). Ниже — точные формы публичных вызовов и вложенных options текущей версии. Это справочник обозначений, **не код для вставки в приложение**: приложение остаётся JavaScript ESM. `?` означает необязательность, `|` — варианты, `Promise<T>` — асинхронный результат; readonly запрещает изменение через этот контракт. Необязательность не задаёт default: поведение и значения по умолчанию описаны в тематической статье.

Подпись описывает форму данных, а не доступность браузерной функции и не гарантию подключения provider. Server API нельзя переносить в браузер. Advanced factories нужны для собственного host; обычный компонент использует context. Ограничения route/cache/offline: [настройки страницы](page-configuration.md).

## Импорты

| Import | Export |
| --- | --- |
| `@solcorp/layer-plugin-sdk` | `LayerPluginError` |
| `@solcorp/layer-plugin-sdk` | `layerPluginEngineCompatible` |
| `@solcorp/layer-plugin-sdk` | `layerPluginManifestValidate` |
| `@solcorp/layer-plugin-sdk` | `layerPluginRegistryCreate` |

## Параметры и результаты

Именованные типы раскрываются ниже; типы DOM и внешних библиотек сохраняют свои стандартные имена. Одинаковый helper из другого Layer-пакета включён только если нужен для публичной подписи.

[layerPluginEngineCompatible](#layerpluginenginecompatible) · [LayerPluginError](#layerpluginerror) · [layerPluginManifestValidate](#layerpluginmanifestvalidate) · [layerPluginRegistryCreate](#layerpluginregistrycreate) · [LayerPluginSetup](#layerpluginsetup)

### layerPluginEngineCompatible

```typescript
export declare function layerPluginEngineCompatible(engineRange: string, engineVersion: string): boolean;
```

### LayerPluginError

```typescript
export declare class LayerPluginError extends Error {
    #private;
    code: string;
    details: Readonly<Record<string, unknown>> | null;

    constructor(code: string, message: string, errorOptions?: {
        details?: Readonly<Record<string, unknown>> | null;
        cause?: unknown;
    });
    internalCauseGet(): unknown;
    toJSON(): {
        name: string;
        code: string;
        message: string;
        details: Readonly<Record<string, unknown>> | null;
    };
}
```

### layerPluginManifestValidate

```typescript
export declare function layerPluginManifestValidate(manifestData: unknown): Readonly<{
    name: string;
    version: string;
    engine: string;
    operations: readonly string[];
    migrations: readonly string[];
    eventChannels: readonly string[];
    capabilities: readonly string[];
    configSchema: {};
    permissions: readonly string[];
    browserPackages: readonly string[];
    integrity: Readonly<{
        sha256: string;
        provenance: string;
    }> | null;
}>;
```

### layerPluginRegistryCreate

```typescript
export declare function layerPluginRegistryCreate(registryOptions: {
    engineVersion: string;
}): Readonly<{

    define(pluginDefinition: {
        manifest: unknown;
        setup: LayerPluginSetup;
    }): Readonly<{
        name: string;
        version: string;
        engine: string;
        operations: readonly string[];
        migrations: readonly string[];
        eventChannels: readonly string[];
        capabilities: readonly string[];
        configSchema: {};
        permissions: readonly string[];
        browserPackages: readonly string[];
        integrity: Readonly<{
            sha256: string;
            provenance: string;
        }> | null;
    }>;
    seal(): true;
    isSealed(): boolean;
    list(): readonly any[];

    initialize(initializeOptions?: {
        services?: Readonly<Record<string, unknown>>;
        configs?: Readonly<Record<string, unknown>>;
    }): Promise<Readonly<Record<string, unknown>>>;
}>;
```

### LayerPluginSetup

```typescript
export type LayerPluginSetup = (pluginContext: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>;
```

Далее: [карта возможностей](capabilities.md), [каталог API](api-catalog.md).
