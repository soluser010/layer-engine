---
title: Application configuration
description: Strict layer.config.js, safe disable modes, infrastructure, and production secrets.
audience: beginner
order: 50
status: documented
updated: 2026-10-31
---

# Application configuration

[Capability map](capabilities.md)

## CSS browser targets

`css.targets` sets minimum browser versions **for CSS transformation**. Omitted configuration uses the values below; generated applications include them explicitly. A supplied targets object replaces all defaults.

```js
export default {
    appName: 'css-example',
    css: {
        targets: {
            chrome: '109',
            edge: '109',
            firefox: '115',
            safari: '16.4',
            ios_saf: '16.4'
        }
    }
};
```

Both `layer dev` and `layer build` automatically enable vendor prefixes, supported syntax lowering and minification through pinned Lightning CSS. Supported keys: `chrome`, `edge`, `firefox`, `safari`, `ios_saf`, `opera`, `samsung`, `android`. Versions are strings: `major`, `major.minor`, or `major.minor.patch`; components are 0–255, major starts at 1. Null, empty targets, unknown fields, `latest`, and ranges fail with `CLI_CONFIG_INVALID` and a field path. Use `ios_saf` for iOS Safari and `safari` for macOS Safari.

Ambient Browserslist, package.json targets and ENV discovery are disabled: one configuration controls CSS identically in development and production. Restart the dev server after editing `layer.config.js`. Sources remain unchanged; builds do not fetch external `@import` rules. Local public stylesheets are transformed separately without rewriting their URL paths. Install from the lockfile with your platform's optional Lightning CSS native package for reproducibility; install scripts are not required.

Targets do not certify the entire runtime for an old browser and do not recommend running outdated browsers. JavaScript/PWA capabilities and the [browser matrix](browser-support.md) remain a separate contract. Transforms cannot emulate missing layout/API support: dynamic `color-mix()` with CSS variables, some selectors and new layout features may require authored fallbacks/`@supports`.

See [CSS build processing](authoring-layer-js.md#css-build-pipeline) for ordering and diagnostics.

## Goal

Built-in updates configuration and manifest branding: [application updates](application-updates.md).

Choose the smallest application mode, enable only required subsystems, and understand configuration diagnostics.

Every new project receives a complete layer.config.js with active safe defaults and commented recipes. Do not enable all recipes at once: select an application mode first, then add infrastructure when it becomes necessary.

## Minimal static PWA

```js
export default {
    appName: 'catalog',
    appVersion: '0.1.0',
    sourceDirectory: 'src',
    publicDirectory: 'public',
    outputDirectory: 'dist',
    auth: null,
    notifications: null,
    development: {
        host: '127.0.0.1',
        port: 5173,
        https: false,
        liveReload: true
    },
    database: {
        embedded: {
            dataDirectory: null
        },
        postgres: [],
        schema: {
            file: 'src/server/database.js',
            synchronization: 'additive'
        },
        replica: {
            maximumLagMs: 2000
        },
        pool: {
            maximumConnectionsPerWorker: 5,
            connectionBudget: null
        }
    },
    redis: null,
    runtime: {
        workers: {
            minimum: 1,
            maximum: 1
        }
    },
    deployment: {
        domain: null,
        serverEntry: null,
        originPort: 8787,
        dependencies: {}
    }
};
```

With serverEntry: null, the production bundle does not start a Node API, PGlite, or Redis. Database/runtime blocks remain valid defaults but create no processes.

## Full stack without an external database

Set serverEntry: 'server/index.js', keep postgres: [] and workers at 1/1. Layer opens PGlite for system tables. Application SQL tables, multiple workers, and HA are unavailable in this mode.

## Local PostgreSQL without a password

```js
postgres: [{
    name: 'primary',
    role: 'primary',
    host: '127.0.0.1',
    port: 5432,
    database: 'layer_application',
    username: 'postgres',
    password: null,
    tls: {
        mode: 'disable'
    }
}]
```

password: null and plaintext are allowed only for loopback development. Remote PostgreSQL requires an ENV secret and verify-full TLS. Set Redis to null to disable it; remote Redis follows the same security rules.

## Workers

- 1/1 — PGlite or external PostgreSQL;
- 2/2 and 4/4 — fixed workers with external PostgreSQL only;
- 2/8 — autoscale range;
- 2/auto — automatic maximum and a required connectionBudget.

The total pool must stay within the PostgreSQL budget. Caddy distributes requests with least_conn; sticky sessions are not required.

## Secrets

```js
{
    password: {
        env: 'LAYER_POSTGRES_PRIMARY_PASSWORD'
    }
}
```

Production builds reject literal secrets. ENV values are not written to dist, manifests, diagnostics, or generated declarations. A .env file is not part of the deployment contract; provide variables through a supervisor or secret store.

## Web Push

Web Push is disabled by default (`notifications: null`). Enabling it requires `deployment.serverEntry`, VAPID public/private ENV references, and a separate stable encryption secret. Redis is optional: jobs remain in the system SQL queue. [Complete setup and examples](web-push.md).

## Third-party resource permissions in CSP

`security.csp.sources` adds resource origins to the HTTP Content-Security-Policy in both the development host and generated `dist/Caddyfile`. Existing local sources remain. Omitted configuration, `security: null`, and empty sources preserve the original policy.

```js
export default {
    appName: 'my-app',
    security: {
        csp: {
            sources: {
                'script-src': ['https://sdk.example.com'],
                'connect-src': ['https://api.example.com', 'wss://events.example.com'],
                'img-src': ['https://*.images.example.com'],
                'style-src': ['blob:'],
                'frame-src': ['https://widgets.example.com']
            }
        }
    }
};
```

Supported directives: `script-src`, `style-src`, `connect-src`, `img-src`, `media-src`, `font-src`, `frame-src`, `child-src`, `worker-src`, `manifest-src`. Lists extend `'self'`; they do not replace it. A subdomain permission such as `https://*.example.com` requires a separate entry for the apex origin.

For an embedded map iframe, add only the origin from its `src`, for example:

```js
export default {
    appName: 'map-app',
    security: {
        csp: {
            sources: {
                'frame-src': ['https://api-maps.yandex.ru']
            }
        }
    }
};
```

If the generated widget uses `https://yandex.ru`, allow that origin instead or additionally when required. Do not copy the iframe path or query into CSP sources. A cross-origin iframe document follows its own server's policies: the parent application does not need to permit all of the map's scripts, images, and connections. A JavaScript SDK integration instead needs permissions for resources loaded directly by the application and must support Trusted Types.

`frame-src` controls iframes, `script-src` controls scripts, `connect-src` controls Fetch and other connections, and `worker-src` controls workers. Prefer `frame-src` for embeds rather than the legacy shared `child-src`: explicit `worker-src 'self'` and `manifest-src 'self'` in both modes prevent frame or script permissions from broadening them through fallback. Worker exceptions must be added specifically to `worker-src`. Development keeps the existing inline-style tooling exception; production does not receive it.

Sources must be HTTPS origins without credentials, paths, queries, or fragments. WSS is allowed only in `connect-src`; HTTP/WS are loopback-only (`localhost`, `127.0.0.1`, `[::1]`). Local `data:` resources are supported in `img-src`/`font-src`; `blob:` in `style-src`/`img-src`/`media-src`/`worker-src`. Each directive accepts up to 32 entries; the normalized configuration is bounded to 6000 characters. Duplicate sources are removed.

Scheme and hostname casing is normalized without dropping wildcard semantics: `HTTPS://*.EXAMPLE.COM` becomes `https://*.example.com`. Directive names remain strictly defined lowercase keys. Allowing a third-party WSS origin does not change Layer's transport: application API and engine realtime continue to use HTTP/Fetch Stream without WebSocket.

The configuration rejects `*`, arbitrary protocol wildcards, `unsafe-inline`, `unsafe-eval`, CSP disabling, and protected-directive overrides. `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, and production `require-trusted-types-for 'script'` remain enforced. A permitted SDK must still support Trusted Types. Origin permissions do not change server authorization, upstream CORS, network availability, or offline caching.

Invalid input fails with `CLI_CONFIG_INVALID` and an exact `security.csp.sources.<directive>[index]` path without reflecting the supplied value. Restart `layer dev` after changes; rebuild the bundle for deployment. Never include secret API keys in CSP sources.

## Development

host accepts loopback only. Changing host, port, HTTPS, or layer.config.js requires restarting layer dev. liveReload: false disables the dev client and internal SSE endpoints. Enable HTTPS with a keyFile/certificateFile object.

## Deployment

domain is a hostname without scheme or path. null requires LAYER_DOMAIN on the server. serverEntry enables a private Node origin; dependencies contains only exact versions of external runtime packages. Layer packages and ordinary server imports are bundled.

## Common errors and solutions

- CLI_CONFIG_INVALID with a path: remove the unknown field or fix its type using the suggestion.
- DATABASE_CLUSTER_REQUIRED: return to 1/1 workers or configure external PostgreSQL.
- APPLICATION_DATABASE_REQUIRED: remove application tables or configure PostgreSQL.
- Remote password: null: use password: {env: '...'}.
- Remote tls.mode: disable: configure verify-full and a CA.

## Failure contract

Configuration is validated before a build or public listener. Diagnostics contain code, file, field path, line/column when available, and safe suggestions; secret values and stack traces are not printed.

Next: [Server runtime](server-runtime.md), [Databases](database-runtime.md), [Deployment](deployment-diagnostics.md).

## Browser device permissions

`security.permissionsPolicy` accepts only `camera`, `microphone`, `geolocation`, and `payment`. Each feature accepts `[]` (denied) or `['self']` (same origin only). Wildcards, external origins, and unknown features are rejected.

```js
export default {
    appName: 'my-app',
    security: {
        permissionsPolicy: {
            camera: [],
            microphone: ['self'],
            geolocation: ['self'],
            payment: []
        }
    }
};
```

Production preserves all four denials when no policy is configured. Development emits Permissions-Policy only when explicitly configured, preserving existing application defaults. The header neither grants user permission for microphone/geolocation nor changes CSP.

`self` is the exact current origin, not every subdomain. Omitted features in an explicit policy object remain denied. Restart the dev server after configuration changes; rebuild `dist` for production. Browser support varies: Permissions-Policy does not replace capability checks or user consent.

## Private files and logs
Links, viewer allowlists and association generators: [navigation](links-navigation.md). They never disable private-file denials.


The dev host and generated Caddyfile return 404 for `.env`, `.env.*`, `*.env`, and their variants at any depth, case-insensitively. Denials precede backend forwarding, navigation fallback, and HTTP-to-HTTPS redirects; URL encoding does not grant access. User environment files in `public` are excluded from `dist` and precache. The generated `.env.example` remains a private deployment file without secret values and cannot be fetched over HTTP.

Package/lock files, Caddyfile, node_modules, server/deployment metadata, declarations, and source maps are also private. `security.csp` and `permissionsPolicy` cannot disable these denials. Keep secrets outside public directories regardless: these protections cannot identify arbitrary public copies renamed to unrelated filenames.

The default Caddy error logger removes request headers and the query from `request.uri`, retaining the path and error diagnostic fields. This is not universal redaction of arbitrary messages or application logs. Never put secrets in URL paths or error text; an additional access logger needs its own safe filter.
