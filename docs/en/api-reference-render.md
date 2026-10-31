---
title: Signature reference — @solcorp/layer-render
description: Parameters, return values and related types.
audience: advanced
order: 310
status: documented
updated: 2026-10-31
---

# Signature reference — @solcorp/layer-render

Start with the [guide and examples](reactivity.md). Below are the exact public call shapes and nested options for this version. This is notation reference, **not code to paste into an application**: applications remain JavaScript ESM. `?` means optional, `|` alternatives, `Promise<T>` an asynchronous result; readonly prohibits mutation through that contract. Optional does not define a default: behavior and defaults belong to the topic guide.

A signature describes data shape, not browser availability or a connected provider. Do not import server APIs into browser code. Advanced factories are for custom hosts; ordinary components use context. Route/cache/offline limitations: [page options](page-configuration.md).

## Imports

| Import | Export |
| --- | --- |
| `@solcorp/layer-render` | `layerErrorBoundaryValueCreate` |
| `@solcorp/layer-render` | `layerErrorBoundaryValueResolve` |
| `@solcorp/layer-render` | `layerRenderErrorNormalize` |
| `@solcorp/layer-render` | `layerComponentHydrate` |
| `@solcorp/layer-render` | `layerComponentMount` |
| `@solcorp/layer-render` | `layerComponentContextCreate` |
| `@solcorp/layer-render` | `layerComponentDefinitionCreate` |
| `@solcorp/layer-render` | `layerComponentInvocationCreate` |
| `@solcorp/layer-render` | `layerComponentInstanceHydrate` |
| `@solcorp/layer-render` | `layerComponentInstanceMount` |
| `@solcorp/layer-render` | `layerComponentInstanceRenderToString` |
| `@solcorp/layer-render` | `layerSlotContentCreate` |
| `@solcorp/layer-render` | `layerRenderDiagnosticsCreate` |
| `@solcorp/layer-render` | `layerReferenceCreate` |
| `@solcorp/layer-render` | `layerComponentRenderToString` |
| `@solcorp/layer-render` | `layerReactiveValueRead` |
| `@solcorp/layer-render` | `layerRepeatValueCreate` |
| `@solcorp/layer-render` | `layerRepeatValueResolve` |
| `@solcorp/layer-render` | `layerWhenValueCreate` |
| `@solcorp/layer-render` | `layerWhenValueResolve` |
| `@solcorp/layer-render` | `batch` |
| `@solcorp/layer-render` | `computed` |
| `@solcorp/layer-render` | `effect` |
| `@solcorp/layer-render` | `layerBindingObserve` |
| `@solcorp/layer-render` | `layerCommitWait` |
| `@solcorp/layer-render` | `layerSchedulerFlush` |
| `@solcorp/layer-render` | `signal` |
| `@solcorp/layer-render` | `store` |

## Parameters and results

Named types are expanded below; DOM and external-library types retain their standard names. A helper from another Layer package is included only when required by a public signature.

[batch](#batch) · [computed](#computed) · [effect](#effect) · [LAYER_SIGNAL_READ](#layer_signal_read) · [layerBindingObserve](#layerbindingobserve) · [layerCommitWait](#layercommitwait) · [layerComponentContextCreate](#layercomponentcontextcreate) · [layerComponentDefinitionCreate](#layercomponentdefinitioncreate) · [layerComponentHydrate](#layercomponenthydrate) · [layerComponentInstanceHydrate](#layercomponentinstancehydrate) · [layerComponentInstanceMount](#layercomponentinstancemount) · [layerComponentInstanceRenderToString](#layercomponentinstancerendertostring) · [layerComponentInvocationCreate](#layercomponentinvocationcreate) · [layerComponentMount](#layercomponentmount) · [layerComponentRenderToString](#layercomponentrendertostring) · [LayerErrorBoundaryState](#layererrorboundarystate) · [layerErrorBoundaryValueCreate](#layererrorboundaryvaluecreate) · [layerErrorBoundaryValueResolve](#layererrorboundaryvalueresolve) · [layerReactiveValueRead](#layerreactivevalueread) · [layerReferenceCreate](#layerreferencecreate) · [layerRenderDiagnosticsCreate](#layerrenderdiagnosticscreate) · [layerRenderErrorNormalize](#layerrendererrornormalize) · [layerRepeatValueCreate](#layerrepeatvaluecreate) · [layerRepeatValueResolve](#layerrepeatvalueresolve) · [LayerRepeatValueState](#layerrepeatvaluestate) · [layerSchedulerFlush](#layerschedulerflush) · [layerSlotContentCreate](#layerslotcontentcreate) · [LayerTemplateResult](#layertemplateresult) · [LayerTemplateResultCheck](#layertemplateresultcheck) · [layerWhenValueCreate](#layerwhenvaluecreate) · [layerWhenValueResolve](#layerwhenvalueresolve) · [LayerWhenValueState](#layerwhenvaluestate) · [signal](#signal) · [store](#store)

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

### effect

```typescript
export declare function effect(effectHandler: () => void | (() => void)): () => void;
```

### LAYER_SIGNAL_READ

```typescript
export declare const LAYER_SIGNAL_READ: unique symbol;
```

### layerBindingObserve

```typescript
export declare function layerBindingObserve(bindingHandler: () => void): () => void;
```

### layerCommitWait

```typescript
export declare function layerCommitWait(): Promise<void>;
```

### layerComponentContextCreate

```typescript
export declare function layerComponentContextCreate(contextOptions?: {
    parent?: object | null;
    values?: Record<string, unknown>;
}): Readonly<{

    has(contextKey: string): boolean;

    get(contextKey: string): any;

    derive(childValues?: Record<string, unknown>): Readonly< any>;
}>;
```

### layerComponentDefinitionCreate

```typescript
export declare function layerComponentDefinitionCreate(definitionOptions: {
    component: Record<string, unknown>;
    props?: Record<string, unknown>;
    emits?: readonly string[] | Record<string, ((payloadData: unknown) => boolean) | null>;
    setup?: (setupContext: Readonly<Record<string, unknown>>) => Record<string, unknown> | void;
}): Readonly<{
    component: Record<string, unknown>;
    props: any;
    emits: readonly any[];
    emitValidators: any;
    setup: ((setupContext: Readonly<Record<string, unknown>>) => Record<string, unknown> | void) | null;
}>;
```

### layerComponentHydrate

```typescript
export declare function layerComponentHydrate(componentData: {
    scopeId: string;
    template: Record<string, unknown>[];
}, rootNode: Element | DocumentFragment, renderScope: Record<string, unknown>, renderOptions?: {
    diagnostics?: ReturnType<typeof layerRenderDiagnosticsCreate>;
}): Readonly<{
    recovered: boolean;
    diagnostics: Readonly<{
        mutationRecord(mutationType: string, bindingId?: string | null, nodeId?: string | null): void;
        mismatchRecord(bindingId?: null, nodeId?: null): void;
        snapshot(): any;
        reset(): void;
    }>;
    refs: Readonly<{

        get(refName: string): Element | null;

        getAll(refName: string): readonly Element[];

        has(refName: string): boolean;
        list(): readonly string[];
    }>;
    regions: Readonly<{
        has(regionName: string): boolean;
        list(): readonly Readonly<{
            name: string;
            revision: number;
        }>[];
        revision(regionName: string): number;
        apply(patchData: unknown): Readonly<{
            operationCount: number;
            region: string;
            revision: number;
        }>;
    }>;
    dispose(): void;
}>;
```

### layerComponentInstanceHydrate

```typescript
export declare function layerComponentInstanceHydrate(definitionData: ReturnType<typeof layerComponentDefinitionCreate>, rootNode: Element | DocumentFragment, instanceOptions?: Record<string, unknown>): Readonly<{
    context: Readonly<{

        has(contextKey: string): boolean;

        get(contextKey: string): any;

        derive(childValues?: Record<string, unknown>): Readonly< any>;
    }>;
    diagnostics: Readonly<{

        mutationRecord(mutationType: string, bindingId?: string | null, nodeId?: string | null): void;

        mismatchRecord(bindingId?: string | null, nodeId?: string | null): void;
        snapshot(): any;
        reset(): any;
    }>;
    props: any;
    recovered: boolean;
    refs: Readonly<{
        get(refName: string): Element | null;
        getAll(refName: string): readonly Element[];
        has(refName: string): boolean;
        list(): readonly string[];
    }>;
    regions: Readonly<{
        has(regionName: string): boolean;
        list(): readonly Readonly<{
            name: string;
            revision: number;
        }>[];
        revision(regionName: string): number;
        apply(patchData: unknown): Readonly<{
            operationCount: number;
            region: string;
            revision: number;
        }>;
    }>;
    slots: any;

    update(nextProps: Record<string, unknown>): Promise<void>;
    settled(): Promise<void>;
    dispose(): void;
}>;
```

### layerComponentInstanceMount

```typescript
export declare function layerComponentInstanceMount(definitionData: ReturnType<typeof layerComponentDefinitionCreate>, rootNode: Element | DocumentFragment, instanceOptions?: Record<string, unknown>): Readonly<{
    context: Readonly<{

        has(contextKey: string): boolean;

        get(contextKey: string): any;

        derive(childValues?: Record<string, unknown>): Readonly< any>;
    }>;
    diagnostics: Readonly<{

        mutationRecord(mutationType: string, bindingId?: string | null, nodeId?: string | null): void;

        mismatchRecord(bindingId?: string | null, nodeId?: string | null): void;
        snapshot(): any;
        reset(): any;
    }>;
    props: any;
    recovered: boolean;
    refs: Readonly<{
        get(refName: string): Element | null;
        getAll(refName: string): readonly Element[];
        has(refName: string): boolean;
        list(): readonly string[];
    }>;
    regions: Readonly<{
        has(regionName: string): boolean;
        list(): readonly Readonly<{
            name: string;
            revision: number;
        }>[];
        revision(regionName: string): number;
        apply(patchData: unknown): Readonly<{
            operationCount: number;
            region: string;
            revision: number;
        }>;
    }>;
    slots: any;

    update(nextProps: Record<string, unknown>): Promise<void>;
    settled(): Promise<void>;
    dispose(): void;
}>;
```

### layerComponentInstanceRenderToString

```typescript
export declare function layerComponentInstanceRenderToString(definitionData: ReturnType<typeof layerComponentDefinitionCreate>, instanceOptions?: Record<string, unknown>): Readonly<{
    html: string;
    css: string;
    metadata: Readonly<{
        componentId: string;
        compilerVersion: number;
        runtimeVersion: string;
        protocolVersion: number;
    }>;
}>;
```

### layerComponentInvocationCreate

```typescript
export declare function layerComponentInvocationCreate(definitionData: ReturnType<typeof layerComponentDefinitionCreate>, invocationOptions?: Record<string, unknown>): Readonly<{}>;
```

### layerComponentMount

```typescript
export declare function layerComponentMount(componentData: {
    scopeId: string;
    template: Record<string, unknown>[];
}, rootNode: Element | DocumentFragment, renderScope: Record<string, unknown>, renderOptions?: {
    diagnostics?: ReturnType<typeof layerRenderDiagnosticsCreate>;
}): Readonly<{
    recovered: false;
    diagnostics: Readonly<{
        mutationRecord(mutationType: string, bindingId?: string | null, nodeId?: string | null): void;
        mismatchRecord(bindingId?: null, nodeId?: null): void;
        snapshot(): any;
        reset(): void;
    }>;
    refs: Readonly<{

        get(refName: string): Element | null;

        getAll(refName: string): readonly Element[];

        has(refName: string): boolean;
        list(): readonly string[];
    }>;
    regions: Readonly<{
        has(regionName: string): boolean;
        list(): readonly Readonly<{
            name: string;
            revision: number;
        }>[];
        revision(regionName: string): number;
        apply(patchData: unknown): Readonly<{
            operationCount: number;
            region: string;
            revision: number;
        }>;
    }>;
    dispose(): void;
}>;
```

### layerComponentRenderToString

```typescript
export declare function layerComponentRenderToString(componentData: {
    compilerVersion: number;
    componentId: string;
    scopeId: string;
    template: Record<string, unknown>[];
    style: {
        css: string;
    };
}, renderScope: Record<string, unknown>, renderOptions?: {
    runtimeVersion?: string;
    protocolVersion?: number;
}): Readonly<{
    html: string;
    css: string;
    metadata: Readonly<{
        componentId: string;
        compilerVersion: number;
        runtimeVersion: string;
        protocolVersion: number;
    }>;
}>;
```

### LayerErrorBoundaryState

```typescript
export type LayerErrorBoundaryState = Readonly<{
    content: () => unknown;
    fallback: (renderError: Readonly<{
        code: string;
        message: string;
        retryable: false;
    }>) => unknown;
}>;
```

### layerErrorBoundaryValueCreate

```typescript
export declare function layerErrorBoundaryValueCreate(contentRenderer: () => unknown, fallbackRenderer: (renderError: Readonly<{
    code: string;
    message: string;
    retryable: false;
}>) => unknown, templateResultCheck: (templateResult: unknown) => boolean): Readonly<{}>;
```

### layerErrorBoundaryValueResolve

```typescript
export declare function layerErrorBoundaryValueResolve(boundaryDescriptor: unknown): LayerErrorBoundaryState;
```

### layerReactiveValueRead

```typescript
export declare function layerReactiveValueRead(inputValue: unknown): unknown;
```

### layerReferenceCreate

```typescript
export declare function layerReferenceCreate(): {
    current: Element | null;
};
```

### layerRenderDiagnosticsCreate

```typescript
export declare function layerRenderDiagnosticsCreate(diagnosticOptions?: {
    sink?: (eventData: Readonly<{
        type: string;
        bindingId: string | null;
        nodeId: string | null;
    }>) => void;
}): Readonly<{

    mutationRecord(mutationType: string, bindingId?: string | null, nodeId?: string | null): void;
    mismatchRecord(bindingId?: null, nodeId?: null): void;
    snapshot(): any;
    reset(): void;
}>;
```

### layerRenderErrorNormalize

```typescript
export declare function layerRenderErrorNormalize(renderFailure: unknown): Readonly<{
    code: string;
    message: string;
    retryable: false;
}>;
```

### layerRepeatValueCreate

```typescript
export declare function layerRepeatValueCreate(collectionValue: unknown, keySelector: (itemValue: unknown, itemIndex: number) => unknown, itemRenderer: (itemValue: unknown, itemIndex: number) => unknown, templateResultCheck: LayerTemplateResultCheck): Readonly<{}>;
```

### layerRepeatValueResolve

```typescript
export declare function layerRepeatValueResolve(descriptorData: unknown): LayerRepeatValueState;
```

### LayerRepeatValueState

```typescript
export type LayerRepeatValueState = Readonly<{
    collection: unknown;
    key: (itemValue: unknown, itemIndex: number) => unknown;
    render: (itemValue: unknown, itemIndex: number) => LayerTemplateResult;
}>;
```

### layerSchedulerFlush

```typescript
export declare function layerSchedulerFlush(): void;
```

### layerSlotContentCreate

```typescript
export declare function layerSlotContentCreate(componentData: Record<string, unknown>, renderScope: Record<string, unknown>): Readonly<{
    component: Record<string, unknown>;
    scope: Record<string, unknown>;
}>;
```

### LayerTemplateResult

```typescript
export type LayerTemplateResult = Readonly<{
    strings: readonly string[];
    values: readonly unknown[];
}>;
```

### LayerTemplateResultCheck

```typescript
export type LayerTemplateResultCheck = (templateResult: unknown) => boolean;
```

### layerWhenValueCreate

```typescript
export declare function layerWhenValueCreate(conditionValue: unknown, truthyRenderer: () => unknown, falsyRenderer: (() => unknown) | null, templateResultCheck: LayerTemplateResultCheck): Readonly<{}>;
```

### layerWhenValueResolve

```typescript
export declare function layerWhenValueResolve(descriptorData: unknown): LayerWhenValueState;
```

### LayerWhenValueState

```typescript
export type LayerWhenValueState = Readonly<{
    condition: unknown;
    render: (branchStatus: boolean) => LayerTemplateResult | null;
}>;
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

Next: [capability map](capabilities.md), [API catalog](api-catalog.md).
