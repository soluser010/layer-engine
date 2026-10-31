---
title: Справочник сигнатур — @solcorp/layer
description: Параметры, возвращаемые значения и связанные типы.
audience: advanced
order: 310
status: documented
updated: 2026-10-31
---

# Справочник сигнатур — @solcorp/layer

Начните с [руководства и примеров](authoring-layer-js.md). Ниже — точные формы публичных вызовов и вложенных options текущей версии. Это справочник обозначений, **не код для вставки в приложение**: приложение остаётся JavaScript ESM. `?` означает необязательность, `|` — варианты, `Promise<T>` — асинхронный результат; readonly запрещает изменение через этот контракт. Необязательность не задаёт default: поведение и значения по умолчанию описаны в тематической статье.

Подпись описывает форму данных, а не доступность браузерной функции и не гарантию подключения provider. Server API нельзя переносить в браузер. Advanced factories нужны для собственного host; обычный компонент использует context. Ограничения route/cache/offline: [настройки страницы](page-configuration.md).

## Импорты

| Import | Export |
| --- | --- |
| `@solcorp/layer` | `LayerComponentViewport` |
| `@solcorp/layer` | `LayerComponentKeyboard` |
| `@solcorp/layer` | `LayerComponentLinks` |
| `@solcorp/layer` | `LayerTemplateResult` |
| `@solcorp/layer` | `LayerPageRenderMode` |
| `@solcorp/layer` | `LayerPageAuthenticationMode` |
| `@solcorp/layer` | `LayerPageOfflineMode` |
| `@solcorp/layer` | `LayerPageCacheMode` |
| `@solcorp/layer` | `LayerPageMetadata` |
| `@solcorp/layer` | `LayerPageConfiguration` |
| `@solcorp/layer` | `html` |
| `@solcorp/layer` | `css` |
| `@solcorp/layer` | `layerComponentCreate` |
| `@solcorp/layer` | `layerComponentDefinitionCheck` |
| `@solcorp/layer` | `layerTemplateResultCheck` |
| `@solcorp/layer` | `ErrorBoundary` |
| `@solcorp/layer` | `when` |
| `@solcorp/layer` | `repeat` |
| `@solcorp/layer` | `layerPageCreate` |
| `@solcorp/layer` | `layerOperationContractsCreate` |
| `@solcorp/layer` | `layerBatch` |
| `@solcorp/layer` | `layerComputedCreate` |
| `@solcorp/layer` | `layerEffectCreate` |
| `@solcorp/layer` | `layerSignalCreate` |
| `@solcorp/layer` | `layerStoreCreate` |
| `@solcorp/layer` | `layerReferenceCreate` |

## Параметры и результаты

Именованные типы раскрываются ниже; типы DOM и внешних библиотек сохраняют свои стандартные имена. Одинаковый helper из другого Layer-пакета включён только если нужен для публичной подписи.

[batch](#batch) · [computed](#computed) · [css](#css) · [effect](#effect) · [ErrorBoundary](#errorboundary) · [html](#html) · [LAYER_SIGNAL_READ](#layer_signal_read) · [layerBatch](#layerbatch) · [layerComponentCreate](#layercomponentcreate) · [layerComponentDefinitionCheck](#layercomponentdefinitioncheck) · [LayerComponentKeyboard](#layercomponentkeyboard) · [LayerComponentLinks](#layercomponentlinks) · [LayerComponentViewport](#layercomponentviewport) · [layerComputedCreate](#layercomputedcreate) · [layerEffectCreate](#layereffectcreate) · [layerOperationContractsCreate](#layeroperationcontractscreate) · [LayerPageAuthenticationMode](#layerpageauthenticationmode) · [LayerPageCacheMode](#layerpagecachemode) · [LayerPageConfiguration](#layerpageconfiguration) · [layerPageCreate](#layerpagecreate) · [LayerPageMetadata](#layerpagemetadata) · [LayerPageOfflineMode](#layerpageofflinemode) · [LayerPageRenderMode](#layerpagerendermode) · [layerReferenceCreate](#layerreferencecreate) · [layerSignalCreate](#layersignalcreate) · [layerStoreCreate](#layerstorecreate) · [LayerTemplateResult](#layertemplateresult) · [layerTemplateResultCheck](#layertemplateresultcheck) · [repeat](#repeat) · [signal](#signal) · [store](#store) · [when](#when)

### batch

```typescript
export declare function batch<ResultData>(batchHandler: () => ResultData): ResultData;
```

### computed

```typescript
export declare function computed<ValueData>(computeHandler: () => ValueData, computedOptions?: {
    equal?: (previousValue: ValueData, nextValue: ValueData) => boolean;
}): Readonly<{
    [LAYER_SIGNAL_READ](): ValueData;
    get(): ValueData;
    peek(): ValueData;
    dispose(): void;
}>;
```

### css

```typescript
export declare function css(templateParts: TemplateStringsArray, ...templateValues: unknown[]): string;
```

### effect

```typescript
export declare function effect(effectHandler: () => void | (() => void)): () => void;
```

### ErrorBoundary

```typescript
export declare function ErrorBoundary(boundaryOptions: {
    content: () => LayerTemplateResult;
    fallback: (renderError: Readonly<{
        code: string;
        message: string;
        retryable: false;
    }>) => LayerTemplateResult;
}): Readonly<Record<string, unknown>>;
```

### html

```typescript
export declare function html(templateParts: TemplateStringsArray, ...templateValues: unknown[]): LayerTemplateResult;
```

### LAYER_SIGNAL_READ

```typescript
export declare const LAYER_SIGNAL_READ: unique symbol;
```

### layerBatch

```typescript
export declare const layerBatch: typeof batch;
```

### layerComponentCreate

```typescript
export declare function layerComponentCreate<PropertiesData extends Record<string, unknown>, ContextData extends Record<string, unknown>>(componentFunction: (properties: Readonly<PropertiesData>, context: Readonly<ContextData> & {
    readonly viewport?: LayerComponentViewport | null;
    readonly keyboard?: LayerComponentKeyboard | null;
    readonly links?: LayerComponentLinks | null;
}) => LayerTemplateResult): Readonly<{
    render: (properties: Readonly<PropertiesData>, context: Readonly<ContextData> & {
        readonly viewport?: LayerComponentViewport | null;
        readonly keyboard?: LayerComponentKeyboard | null;
        readonly links?: LayerComponentLinks | null;
    }) => LayerTemplateResult;
}>;
```

### layerComponentDefinitionCheck

```typescript
export declare function layerComponentDefinitionCheck(componentDefinition: unknown): boolean;
```

### LayerComponentKeyboard

```typescript
export type LayerComponentKeyboard = LayerComponentViewport['keyboard'];
```

### LayerComponentLinks

```typescript
export type LayerComponentLinks = ReturnType<ReturnType<typeof import('@solcorp/layer-runtime').layerLinksCreate>['createOwner']>;
```

### LayerComponentViewport

```typescript
export type LayerComponentViewport = ReturnType<ReturnType<typeof import('@solcorp/layer-runtime').layerViewportCreate>['createOwner']> & {
    state: Readonly<{
        get: () => import('@solcorp/layer-runtime').LayerViewportState;
        peek: () => import('@solcorp/layer-runtime').LayerViewportState;
    }>;
};
```

### layerComputedCreate

```typescript
export declare const layerComputedCreate: typeof computed;
```

### layerEffectCreate

```typescript
export declare const layerEffectCreate: typeof effect;
```

### layerOperationContractsCreate

```typescript
export declare function layerOperationContractsCreate(contractList: readonly Readonly<Record<string, unknown>>[]): readonly Readonly<Record<string, unknown>>[];
```

### LayerPageAuthenticationMode

```typescript
export type LayerPageAuthenticationMode = 'session' | 'none';
```

### LayerPageCacheMode

```typescript
export type LayerPageCacheMode = 'private' | 'public' | 'no-store';
```

### LayerPageConfiguration

```typescript
export type LayerPageConfiguration = {

    render?: LayerPageRenderMode;

    layout?: string | null;

    auth?: LayerPageAuthenticationMode;

    permissions?: readonly string[];

    preload?: readonly string[];

    guard?: string | null;

    offline?: LayerPageOfflineMode;

    cache?: LayerPageCacheMode;

    metadata?: LayerPageMetadata;
};
```

### layerPageCreate

```typescript
export declare function layerPageCreate(pageData: LayerPageConfiguration): Readonly<LayerPageConfiguration>;
```

### LayerPageMetadata

```typescript
export type LayerPageMetadata = {

    title?: string;

    description?: string;

    robots?: string;

    canonical?: string;

    author?: string;

    keywords?: string;

    themeColor?: string;

    colorScheme?: string;

    applicationName?: string;

    language?: string;

    direction?: 'auto' | 'ltr' | 'rtl';

    openGraphTitle?: string;

    openGraphDescription?: string;

    openGraphType?: string;

    openGraphUrl?: string;

    openGraphImage?: string;

    openGraphImageAlt?: string;

    openGraphSiteName?: string;

    openGraphLocale?: string;

    twitterCard?: 'app' | 'player' | 'summary' | 'summary_large_image';

    twitterTitle?: string;

    twitterDescription?: string;

    twitterImage?: string;

    twitterImageAlt?: string;
};
```

### LayerPageOfflineMode

```typescript
export type LayerPageOfflineMode = 'deny' | 'shell' | 'snapshot' | 'local';
```

### LayerPageRenderMode

```typescript
export type LayerPageRenderMode = 'ssr' | 'csr';
```

### layerReferenceCreate

```typescript
export declare function layerReferenceCreate(): {
    current: Element | null;
};
```

### layerSignalCreate

```typescript
export declare const layerSignalCreate: typeof signal;
```

### layerStoreCreate

```typescript
export declare const layerStoreCreate: typeof store;
```

### LayerTemplateResult

```typescript
export type LayerTemplateResult = Readonly<{
    strings: readonly string[];
    values: readonly unknown[];
}>;
```

### layerTemplateResultCheck

```typescript
export declare function layerTemplateResultCheck(templateResult: unknown): boolean;
```

### repeat

```typescript
export declare function repeat<ItemValue>(collectionValue: readonly ItemValue[] | {
    get: () => readonly ItemValue[];
}, keySelector: (itemValue: ItemValue, itemIndex: number) => string | number, itemRenderer: (itemValue: ItemValue, itemIndex: number) => LayerTemplateResult): Readonly<Record<string, unknown>>;
```

### signal

```typescript
export declare function signal<ValueData>(initialValue: ValueData, signalOptions?: {
    equal?: (previousValue: ValueData, nextValue: ValueData) => boolean;
}): Readonly<{
    [LAYER_SIGNAL_READ](): ValueData;
    get(): ValueData;
    peek(): ValueData;

    set(nextValue: ValueData): ValueData;

    update(updateHandler: (previousValue: ValueData) => ValueData): ValueData;
}>;
```

### store

```typescript
export declare function store<StoreData extends Record<string, unknown>>(initialData: StoreData): StoreData;
```

### when

```typescript
export declare function when(conditionValue: unknown, truthyRenderer: () => LayerTemplateResult, falsyRenderer?: (() => LayerTemplateResult) | null): Readonly<Record<string, unknown>>;
```

Далее: [карта возможностей](capabilities.md), [каталог API](api-catalog.md).
