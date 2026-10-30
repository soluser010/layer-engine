# @solcorp/layer-router

**Part of [Layer-Engine](https://www.npmjs.com/package/@solcorp/layer), a JavaScript framework for full PWA applications.** Route matching, navigation policy and application layouts.

Start with `npm install @solcorp/layer`; this module is installed automatically. You do not need to assemble the framework package by package.

[Quick start](https://github.com/soluser010/layer-engine/blob/main/README.md#quick-start) · [API guide EN](https://github.com/soluser010/layer-engine/blob/main/docs/en/routing-ssr.md) · [Документация RU](https://github.com/soluser010/layer-engine/blob/main/docs/ru/routing-ssr.md) · [Source](https://github.com/soluser010/layer-engine/tree/main/packages/router)

Часть фреймворка **Layer-Engine**. Для разработки приложения установите основной пакет `@solcorp/layer`; этот модуль входит в его зависимости. Ссылки выше ведут к назначению, API, примерам и ограничениям модуля.

File-route contracts and browser transitions for Layer-Engine. Build tooling supplies `.layer` pages from `src/pages`; the package compiles deterministic static, dynamic, and terminal catch-all routes without importing Node.js modules into the browser runtime.

```js
import {
    layerRouteManifestCreate,
    layerRouterCreate
} from '@solcorp/layer-router';

const manifest = layerRouteManifestCreate([
    {
        file: 'src/pages/index.layer',
        route: {
            auth: 'none',
            offline: 'shell'
        }
    },
    {
        file: 'src/pages/chats/[dialogId].layer',
        layout: 'application',
        route: {
            permissions: ['chat.read'],
            preload: ['chat.dialog.get'],
            offline: 'snapshot'
        }
    }
]);

const router = layerRouterCreate({
    manifest,
    identityGet,
    preload: layer.query,
    onlineGet: () => navigator.onLine,
    history
});
```

Static routes are matched before parameters and catch-all routes. Expected boundaries return `not-found`, `auth-required`, `forbidden`, or `offline`; invalid manifests and missing runtime integrations throw `LayerRouterError`. History state contains only route identity and scroll metadata.

`router.navigate(pathname, {history: false})` resolves and commits the route without calling `pushState` or `replaceState`. Browser boot and `popstate` integrations use this option because the address bar already owns the complete pathname, query, and fragment; application-initiated navigation keeps history updates enabled by default.

Route `metadata` is a strict document/SEO contract. Supported fields include
`title`, `description`, `robots`, `canonical`, `author`, `keywords`,
`themeColor`, `colorScheme`, `applicationName`, `language`, `direction`,
Open Graph fields such as `openGraphTitle`/`openGraphImage`, and Twitter card
fields such as `twitterCard`/`twitterImage`. URL fields accept only HTTP(S) or
root-relative values. Build-time SSR and client navigation consume the same
`layerRouteMetadataDocumentCreate` model; managed tags are updated or removed
when the active route changes instead of leaving stale head state.
