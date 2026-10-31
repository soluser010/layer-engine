---
title: Справочник сигнатур — @solcorp/layer-router
description: Параметры, возвращаемые значения и связанные типы.
audience: advanced
order: 310
status: documented
updated: 2026-10-31
---

# Справочник сигнатур — @solcorp/layer-router

Начните с [руководства и примеров](routing.md). Ниже — точные формы публичных вызовов и вложенных options текущей версии. Это справочник обозначений, **не код для вставки в приложение**: приложение остаётся JavaScript ESM. `?` означает необязательность, `|` — варианты, `Promise<T>` — асинхронный результат; readonly запрещает изменение через этот контракт. Необязательность не задаёт default: поведение и значения по умолчанию описаны в тематической статье.

Подпись описывает форму данных, а не доступность браузерной функции и не гарантию подключения provider. Server API нельзя переносить в браузер. Advanced factories нужны для собственного host; обычный компонент использует context. Ограничения route/cache/offline: [настройки страницы](page-configuration.md).

## Импорты

| Import | Export |
| --- | --- |
| `@solcorp/layer-router` | `layerRouteManifestCreate` |
| `@solcorp/layer-router` | `layerRouteMatch` |
| `@solcorp/layer-router` | `layerRouteMetadataDocumentCreate` |
| `@solcorp/layer-router` | `layerRouterCreate` |
| `@solcorp/layer-router` | `LayerRouterError` |

## Параметры и результаты

Именованные типы раскрываются ниже; типы DOM и внешних библиотек сохраняют свои стандартные имена. Одинаковый helper из другого Layer-пакета включён только если нужен для публичной подписи.

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

Далее: [карта возможностей](capabilities.md), [каталог API](api-catalog.md).
