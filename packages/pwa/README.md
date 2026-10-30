# @solcorp/layer-pwa

**Part of [Layer-Engine](https://www.npmjs.com/package/@solcorp/layer), a JavaScript framework for full PWA applications.** Service Worker lifecycle, updates and capability-based browser APIs.

Start with `npm install @solcorp/layer`; this module is installed automatically. You do not need to assemble the framework package by package.

[Quick start](https://github.com/soluser010/layer-engine/blob/main/README.md#quick-start) · [API guide EN](https://github.com/soluser010/layer-engine/blob/main/docs/en/pwa-service-worker.md) · [Документация RU](https://github.com/soluser010/layer-engine/blob/main/docs/ru/pwa-service-worker.md) · [Source](https://github.com/soluser010/layer-engine/tree/main/packages/pwa)

Часть фреймворка **Layer-Engine**. Для разработки приложения установите основной пакет `@solcorp/layer`; этот модуль входит в его зависимости. Ссылки выше ведут к назначению, API, примерам и ограничениям модуля.

Capability-first PWA and Service Worker foundation for Layer-Engine. The package validates immutable version manifests, verifies every required precache asset with SHA-256, provides navigation fallback and cache policies, drains the offline outbox through Background Sync, handles push/notifications, and coordinates explicit two-phase updates.

```js
import {
    layerServiceWorkerRegister,
    layerServiceWorkerRuntimeCreate,
    layerVersionManifestValidate
} from '@solcorp/layer-pwa';

await layerServiceWorkerRegister();

const versionManifest = layerVersionManifestValidate(await versionResponse.json());
const serviceWorkerRuntime = layerServiceWorkerRuntimeCreate({
    manifest: versionManifest,
    cacheStorage: caches,
    fetchImplementation: fetch,
    subtleCrypto: crypto.subtle,
    base64Encode: btoa,
    scope: self,
    outboxDrain
});

serviceWorkerRuntime.attach();
```

Registration fails closed outside HTTPS and localhost. It never downgrades production applications to an insecure HTTP mode.

One generated worker owns the application scope. `POST /api` responses are never cached; query and entity state belongs in IndexedDB. The worker does not own the persistent event stream.

An update installs into a versioned cache only after every required response passes SHA-256 verification. The generated runtime activates an already waiting worker at the next safe application restart, after the active IndexedDB namespace and outbox configuration are persisted. `minVersion` marks a critical update; the coordinator tracks boot attempts and exposes safe mode instead of reloading forever.

The generated browser facade exposes the verified lifecycle through `layer.pwa.update.getState()`, `layer.pwa.update.check()`, and `layer.pwa.update.activate()`. `activate()` remains available for an application-owned update screen; it never invokes the PWA installation prompt.

Capability namespaces report `supported`, `permission`, `availability`, and `reason`. Permission and installation prompts are invoked only by explicit methods intended for user gestures. Layer retains `beforeinstallprompt` for `await layer.pwa.install.prompt()` without cancelling the event, so the browser remains free to present its native installation UI. Missing Background Sync, Badging, Share, File Handling, Protocol Handling, Push, notifications, and persistent storage remain explicit fallbacks rather than fake polyfills.

The generated browser facade exposes the same capability object as `layer.pwa`. File and launch consumers normalize the incubating `LaunchQueue` API; assigning either consumer follows the platform's single-consumer rule. Protocol registration accepts WHATWG safelisted schemes or lowercase `web+` custom schemes and requires a same-origin relative URL containing `%s`. Push exposes subscribe, current subscription, permission state, and idempotent unsubscribe. Persistent notifications expose show, bounded tag lookup, and close. Web Share exposes `canSend`; persistent storage exposes `persist`, `persisted`, and quota `estimate`.

```js
layer.pwa.files.setConsumer(async (fileHandles, targetUrl) => {
    //Reading file handles only after the operating system launched this application.
    await filesOpen(fileHandles, targetUrl);
});

layer.pwa.protocols.register('web+layer', '/protocol?target=%s');

if (layer.pwa.share.canSend({title: 'Layer'})) {
    await layer.pwa.share.send({title: 'Layer'});
}

const storageEstimate = await layer.pwa.storage.estimate();
```

For a validated manifest `share_target` with `method: POST`, the generated Service Worker captures only the exact same-origin action, stores bounded declared content in the temporary IndexedDB inbox, and redirects with an opaque `layerShareId`. The generated capability facade exposes `pendingIdGet()`, one-time `consume()`, and `discard()`; both terminal operations remove the identifier from the address bar. Capture failures return bounded generic 400, 413, or 503 responses without reflecting shared content or storage details. Ordinary POST requests continue to the network and are never cached.

```js
if (layer.pwa.shareTarget.pendingIdGet() !== null) {
    const sharedRecord = await layer.pwa.shareTarget.consume();

    //The record has nullable title/text/url fields and immutable file metadata with Blob values.
    await incomingShareOpen(sharedRecord);
}
```

`layerWebAppManifestCreate` validates and freezes install metadata for shortcuts, `share_target`, `file_handlers`, `protocol_handlers`, and `launch_handler`. `layerWebAppManifestValidate` accepts the standard snake-case JSON shape, rejects unknown root or nested members, and returns the same canonical immutable contract. Capability URLs must remain inside the declared application scope; shared files require multipart POST; file associations require both MIME types and bounded dot-prefixed extensions.

```js
import {layerWebAppManifestValidate} from '@solcorp/layer-pwa';

const manifestData = layerWebAppManifestValidate({
    name: 'Layer Messenger',
    short_name: 'Messenger',
    start_url: '/',
    scope: '/',
    id: '/',
    icons: [{
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml'
    }]
});
```
