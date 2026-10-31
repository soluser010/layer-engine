---
title: Links, incoming launches and viewer
description: PWA navigation, a bounded external viewer and platform association generation.
audience: all
order: 185
status: documented
updated: 2026-10-16
---

# Links, incoming launches and viewer

## Goal

Keep app routes inside the application, accept incoming URLs and view permitted external sites without unmounting the page. The OS/browser decides whether to open an installed PWA, respecting user preferences; Layer cannot capture all device navigation.

## Quick start

Allow only the required external origins in layer.config.js:

```js
export default {
    appName: 'example-app',
    links: {
        external: {
            mode: 'viewer',
            allowedOrigins: ['https://docs.example.com']
        },
        scopeExtensions: [],
        associations: {android: [], apple: [], windows: [], web: []}
    }
};
```

An ordinary anchor to https://docs.example.com/help opens the viewer. An empty allowlist embeds nothing: other external links retain platform behavior. external.mode: 'platform' disables automatic viewing. Origins must be exact HTTPS origins without wildcard, credentials or paths; HTTP is loopback-development only.

New manifests declare id, scope, start_url, standalone and a focus-existing launch_handler client_mode. Builds preserve explicit author settings; an absent id uses the previous effective start_url. Installed PWAs require the usual manifest/Service Worker update. Changing id may create a different installation.

## API and ordinary links

window.layer.links is the shared controller. context.links is a component owner, or null in SSR/manual hosts without the provider. Call actions from browser lifecycle or user handlers:

```js
const helpOpen = async function( context ){
    //Keeping server rendering and isolated hosts free from browser side effects
    if ( !context.links ){
        return;

    }
    //Opening only an origin explicitly allowed in application configuration
    const result = await context.links.open( 'https://docs.example.com/help', {mode: 'viewer'} );
    if ( result.status === 'blocked' ){
        //Reporting the safe action reason rather than a stack or sensitive URL
        console.warn( result.reason );

    }

};
```

open(url, {mode}) returns a result Promise. Modes: auto (default), app, viewer, external. Auto uses the router for app routes, browser navigation for related origins, the viewer for allowlisted origins, otherwise the platform. App stays within permitted scope. Explicit viewer rejects unlisted and same-origin iframe URLs. External requests a new window with noopener/noreferrer.

Results contain status, url and reason. Status: navigated, viewer-opened, external-requested, blocked. Viewer-opened does not prove site loading; external-requested does not prove window creation. Do not request external opening without a user gesture.

closeViewer() is idempotent; component owners close only their own viewer. getCapability() reports viewer/launchQueue primitives and limitations, not installation or remote embedding verification. Owners dispose at unmount; never dispose the shared controller from a component.

data-layer-link="app|viewer|external|auto" selects an anchor mode. Ctrl/Cmd/Shift/Alt-click, download and explicit targets retain browser semantics. Pathname selects the route; query/hash are preserved. Guards, permissions, preload, offline policy and cancellation are not bypassed.

## First click and notification navigation

The build adds a small external /_layer/navigation.js in head before the prerender becomes visible. While the main runtime loads and starts, an ordinary internal anchor retains the latest requested URL instead of replacing the document. Once ready, the normal router receives the complete pathname/query/hash; auth, permissions, guards and preload remain mandatory.

This does not block the entire interface. Unknown routes, other origins, download, modifier keys and explicit targets are not held. In particular, target="_self" intentionally retains native browser navigation. If runtime is not ready within 15 seconds of a retained click, or reports startup failure, Layer restores native navigation to the latest URL rather than trapping the user on a broken page.

For a Push click, an existing window within the app origin/scope first receives a verified Service Worker handoff. Its acknowledgement means URL ownership, not successful authorization. A ready runtime uses the router without reloading; repeating the current URL does not remount the page. A legacy or unresponsive window falls back to native navigation after a bounded wait of up to 2 seconds. Without a matching window, a new one opens. A closed app or unsupported platform launch capture cannot avoid the initial document load.

The bootstrap belongs to integrity/precache and needs no inline script, eval, relaxed CSP or application API changes. Rebuild and deploy dist after upgrading the engine. An already open legacy window without this bootstrap retains compatible native fallback until it adopts the new build.

## Viewer and security

One native dialog inside the app root contains an iframe, requested origin, notice, Close and a persistent Open separately button. Escape/closing restores a connected focus target. The app page and draft remain mounted; a component releases only its own viewer.

Sandbox: allow-scripts allow-forms allow-same-origin. No popups, downloads, top navigation or device grants. Allowlisted origins extend frame-src only, not script-src/connect-src. DOM uses no innerHTML; external CSS participates in integrity/precache. Styling supports --layer-viewer-background and --layer-viewer-color.

Remote X-Frame-Options/frame-ancestors are not bypassed. Load and cross-origin redirects cannot be verified reliably: the label shows the requested origin, not a verified current iframe address. No HTML proxy or automatic timeout redirect. Use platform opening for OAuth/payments: sandbox and third-party cookie restrictions may break them.

## Platform associations and related domains

| links.associations list | Entry fields | Generated document under .well-known |
| --- | --- | --- |
| android | packageName, sha256CertFingerprints | assetlinks.json |
| apple | appId, paths (default /*) | apple-app-site-association |
| windows | packageFamilyName, paths (default *), excludePaths (default []) | windows-app-web-link |
| web | absolute manifest appId, scope (default /) | web-app-origin-association |

Android needs the actual applicationId and SHA-256 signing certificate, not the upload key if Play signs with a different key. Apple appId combines App ID prefix and bundle ID. Windows needs a Package Family Name. Web uses the full manifest ID including its path, not just an origin. Fingerprints contain 32 colon-separated bytes. Lists allow up to 32 entries; unknown fields and duplicate identities are rejected.

Nonempty lists generate files; empty lists do not. No signing keys, wrappers, credential sharing, Handoff or App Clips are created. Native apps separately configure intent filters, Associated Domains entitlements or package manifests. If public already contains a generated file, remove it or disable that generator: conflicts preserve the previous dist.

Documents are public HTTPS application/json resources; Apple/Windows/Web filenames have no .json suffix. They participate in release integrity, not SW cache; missing documents return 404 even with Accept text/html.

scopeExtensions origins are added to manifest scope_extensions. Receiving sites must confirm association through web-app-origin-association. associations.web publishes this site's consent, not files on somebody else's server. Other origins use browser navigation, not the local router; cookies/storage/API credentials are not merged. This capability is experimental and requires browser fallback. [Reference](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/scope_extensions).

## Launch Queue

One native broker shares delivery between router, pwa.launch.setConsumer and pwa.files.setConsumer without overwriting callbacks. It retains the latest URL before readiness, then routes after onReady. Repeating the current URL does not remount the page.

A manual launch consumer takes priority; register it in onReady. Startup replay and queued file delivery preserve early launches. Up to 32 file envelopes wait for registration; overflow reports PWA_LAUNCH_QUEUE_LIMIT. Callback failures do not prevent other delivery. Do not call native launchQueue.setConsumer directly.

Without Launch Queue, initial URLs and router navigation still work. Users may disable link capture. [Chrome navigation management](https://developer.chrome.com/docs/capabilities/pwa-navigation-management).

## Errors and verification

CLI_CONFIG_INVALID and PWA_LINKS_CONFIG_INVALID report links paths without reflecting input values. CLI_BUILD_ASSOCIATION_CONFLICT requires choosing generated or public ownership. Blocked reasons include url-denied, viewer-origin-denied, viewer-unavailable, app-scope-denied and router boundaries such as auth-required, offline and superseded. Invalid options/disposed APIs throw TypeError. Auto may fall back for a known local viewer capability failure, never a guessed iframe error.

Test direct URLs/query/hash, repeated launches, viewer, Escape/focus, modifiers and embedding refusal. OS link opening requires configuration in the corresponding APK/Apple/Windows package and association files on the HTTPS domain. Verify this workflow on devices used by your audience.

Next: [PWA](pwa-service-worker.md), [routing](routing-ssr.md), [configuration](configuration.md), [browser support](browser-support.md).
