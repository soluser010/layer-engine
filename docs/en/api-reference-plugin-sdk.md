---
title: Signature reference — @solcorp/layer-plugin-sdk
description: Parameters, return values and related types.
audience: advanced
order: 310
status: documented
updated: 2026-10-31
---

# Signature reference — @solcorp/layer-plugin-sdk

Start with the [guide and examples](advanced-runtime.md). Below are the exact public call shapes and nested options for this version. This is notation reference, **not code to paste into an application**: applications remain JavaScript ESM. `?` means optional, `|` alternatives, `Promise<T>` an asynchronous result; readonly prohibits mutation through that contract. Optional does not define a default: behavior and defaults belong to the topic guide.

A signature describes data shape, not browser availability or a connected provider. Do not import server APIs into browser code. Advanced factories are for custom hosts; ordinary components use context. Route/cache/offline limitations: [page options](page-configuration.md).

## Imports

| Import | Export |
| --- | --- |
| `@solcorp/layer-plugin-sdk` | `LayerPluginError` |
| `@solcorp/layer-plugin-sdk` | `layerPluginEngineCompatible` |
| `@solcorp/layer-plugin-sdk` | `layerPluginManifestValidate` |
| `@solcorp/layer-plugin-sdk` | `layerPluginRegistryCreate` |

## Parameters and results

Named types are expanded below; DOM and external-library types retain their standard names. A helper from another Layer package is included only when required by a public signature.

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

Next: [capability map](capabilities.md), [API catalog](api-catalog.md).
