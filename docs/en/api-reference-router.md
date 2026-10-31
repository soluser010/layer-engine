---
title: Signature reference — @solcorp/layer-router
description: Parameters, return values and related types.
audience: advanced
order: 310
status: documented
updated: 2026-10-31
---

# Signature reference — @solcorp/layer-router

Start with the [guide and examples](routing.md). Below are the exact public call shapes and nested options for this version. This is notation reference, **not code to paste into an application**: applications remain JavaScript ESM. `?` means optional, `|` alternatives, `Promise<T>` an asynchronous result; readonly prohibits mutation through that contract. Optional does not define a default: behavior and defaults belong to the topic guide.

A signature describes data shape, not browser availability or a connected provider. Do not import server APIs into browser code. Advanced factories are for custom hosts; ordinary components use context. Route/cache/offline limitations: [page options](page-configuration.md).

## Imports

| Import | Export |
| --- | --- |
| `@solcorp/layer-router` | `layerRouteManifestCreate` |
| `@solcorp/layer-router` | `layerRouteMatch` |
| `@solcorp/layer-router` | `layerRouteMetadataDocumentCreate` |
| `@solcorp/layer-router` | `layerRouterCreate` |
| `@solcorp/layer-router` | `LayerRouterError` |

## Parameters and results

Named types are expanded below; DOM and external-library types retain their standard names. A helper from another Layer package is included only when required by a public signature.

[LayerRouteIdentity](#layerrouteidentity) · [layerRouteManifestCreate](#layerroutemanifestcreate) · [layerRouteMatch](#layerroutematch) · [layerRouteMetadataDocumentCreate](#layerroutemetadatadocumentcreate) · [layerRouterCreate](#layerroutercreate) · [LayerRouteRecord](#layerrouterecord) · [LayerRouterError](#layerroutererror) · [LayerRouterOptions](#layerrouteroptions) · [LayerRouteSource](#layerroutesource)

### LayerRouteIdentity

```typescript
export type LayerRouteIdentity = {
    authenticated: boolean;
    permissions?: readonly string[];
};
```

### layerRouteManifestCreate

```typescript
export declare function layerRouteManifestCreate(routeSources: readonly LayerRouteSource[]): readonly Readonly<LayerRouteRecord>[];
```

### layerRouteMatch

```typescript
export declare function layerRouteMatch(routeManifest: readonly Readonly<LayerRouteRecord>[], pathnameData: string): Readonly<{
    route: any;
    params: Readonly<Record<string, string>>;
}> | null;
```

### layerRouteMetadataDocumentCreate

```typescript
export declare function layerRouteMetadataDocumentCreate(metadataData: Readonly<Record<string, string>>): Readonly<{
    title: string | null;
    language: string | null;
    direction: string | null;
    entries: readonly (Readonly<{
        key: "description";
        element: "meta";
        identity: "name";
        identityValue: "description";
        value: "content";
        valueData: string;
    }> | Readonly<{
        key: "robots";
        element: "meta";
        identity: "name";
        identityValue: "robots";
        value: "content";
        valueData: string;
    }> | Readonly<{
        key: "author";
        element: "meta";
        identity: "name";
        identityValue: "author";
        value: "content";
        valueData: string;
    }> | Readonly<{
        key: "keywords";
        element: "meta";
        identity: "name";
        identityValue: "keywords";
        value: "content";
        valueData: string;
    }> | Readonly<{
        key: "themeColor";
        element: "meta";
        identity: "name";
        identityValue: "theme-color";
        value: "content";
        valueData: string;
    }> | Readonly<{
        key: "colorScheme";
        element: "meta";
        identity: "name";
        identityValue: "color-scheme";
        value: "content";
        valueData: string;
    }> | Readonly<{
        key: "applicationName";
        element: "meta";
        identity: "name";
        identityValue: "application-name";
        value: "content";
        valueData: string;
    }> | Readonly<{
        key: "canonical";
        element: "link";
        identity: "rel";
        identityValue: "canonical";
        value: "href";
        valueData: string;
    }> | Readonly<{
        key: "openGraphTitle";
        element: "meta";
        identity: "property";
        identityValue: "og:title";
        value: "content";
        valueData: string;
    }> | Readonly<{
        key: "openGraphDescription";
        element: "meta";
        identity: "property";
        identityValue: "og:description";
        value: "content";
        valueData: string;
    }> | Readonly<{
        key: "openGraphType";
        element: "meta";
        identity: "property";
        identityValue: "og:type";
        value: "content";
        valueData: string;
    }> | Readonly<{
        key: "openGraphUrl";
        element: "meta";
        identity: "property";
        identityValue: "og:url";
        value: "content";
        valueData: string;
    }> | Readonly<{
        key: "openGraphImage";
        element: "meta";
        identity: "property";
        identityValue: "og:image";
        value: "content";
        valueData: string;
    }> | Readonly<{
        key: "openGraphImageAlt";
        element: "meta";
        identity: "property";
        identityValue: "og:image:alt";
        value: "content";
        valueData: string;
    }> | Readonly<{
        key: "openGraphSiteName";
        element: "meta";
        identity: "property";
        identityValue: "og:site_name";
        value: "content";
        valueData: string;
    }> | Readonly<{
        key: "openGraphLocale";
        element: "meta";
        identity: "property";
        identityValue: "og:locale";
        value: "content";
        valueData: string;
    }> | Readonly<{
        key: "twitterCard";
        element: "meta";
        identity: "name";
        identityValue: "twitter:card";
        value: "content";
        valueData: string;
    }> | Readonly<{
        key: "twitterTitle";
        element: "meta";
        identity: "name";
        identityValue: "twitter:title";
        value: "content";
        valueData: string;
    }> | Readonly<{
        key: "twitterDescription";
        element: "meta";
        identity: "name";
        identityValue: "twitter:description";
        value: "content";
        valueData: string;
    }> | Readonly<{
        key: "twitterImage";
        element: "meta";
        identity: "name";
        identityValue: "twitter:image";
        value: "content";
        valueData: string;
    }> | Readonly<{
        key: "twitterImageAlt";
        element: "meta";
        identity: "name";
        identityValue: "twitter:image:alt";
        value: "content";
        valueData: string;
    }>)[];
}>;
```

### layerRouterCreate

```typescript
export declare function layerRouterCreate(routerOptions: LayerRouterOptions): Readonly<{
    resolve(pathnameData: string): Readonly<{
        route: any;
        params: Readonly<Record<string, string>>;
    }> | null;
    navigate: (pathnameData: string, navigationOptions?: {
        replace?: boolean;
        history?: boolean;
        scrollX?: number;
        scrollY?: number;
    }) => Promise<Readonly<{
        status: "superseded";
        pathname: string;
        route: any;
        params: Readonly<{}>;
    }> | Readonly<{
        status: "not-found";
        pathname: string;
    }> | Readonly<{
        status: string;
        route: any;
        params: Readonly<Record<string, string>>;
    }>>;
    currentGet(): Readonly<{
        route: any;
        params: Readonly<Record<string, string>>;
    }> | null;
}>;
```

### LayerRouteRecord

```typescript
export type LayerRouteRecord = import('./route-manifest.js').LayerRouteRecord;
```

### LayerRouterError

```typescript
export declare class LayerRouterError extends Error {
    code: string;
    details: Readonly<Record<string, unknown>> | null;

    constructor(code: string, message: string, details?: Readonly<Record<string, unknown>> | null);
}
```

### LayerRouterOptions

```typescript
export type LayerRouterOptions = {
    manifest: readonly Readonly<LayerRouteRecord>[];
    identityGet?: () => LayerRouteIdentity | Promise<LayerRouteIdentity>;
    onlineGet?: () => boolean;
    guardRun?: (guardName: string, contextData: Readonly<{
        route: Readonly<LayerRouteRecord>;
        params: Readonly<Record<string, string>>;
        identity: LayerRouteIdentity;
    }>) => boolean | string | Promise<boolean | string>;
    preload?: (operationName: string, payloadData: Readonly<{
        params: Readonly<Record<string, string>>;
    }>) => unknown | Promise<unknown>;
    history?: Pick<History, 'pushState' | 'replaceState'>;
};
```

### LayerRouteSource

```typescript
export type LayerRouteSource = {
    file: string;
    route?: unknown;
    layout?: string | null;
};
```

Next: [capability map](capabilities.md), [API catalog](api-catalog.md).
