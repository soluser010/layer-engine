import assert from 'node:assert/strict';
import {createHash, webcrypto} from 'node:crypto';
import test from 'node:test';
import {
    LayerPwaError,
    layerPwaCapabilitiesCreate,
    layerServiceWorkerRegister,
    layerServiceWorkerRuntimeCreate,
    layerUpdateCoordinatorCreate,
    layerVersionCompare,
    layerVersionManifestValidate,
    layerWebAppManifestCreate,
    layerWebAppManifestValidate
} from '../src/index.js';

test('Service Worker registration requires HTTPS or localhost', async () => {
    const registrationCalls = /** @type {any[]} */ ([]);
    const serviceWorkerContainer = /** @type {ServiceWorkerContainer} */ (/** @type {unknown} */ ({
        /**
         * @param {string | URL} scriptUrl
         * @param {RegistrationOptions} registrationOptions
         */
        async register(scriptUrl, registrationOptions) {
            registrationCalls.push({scriptUrl, registrationOptions});

            return {
                scope: 'https://app.example.com/'
            };
        }
    }));

    await layerServiceWorkerRegister({
        scriptUrl: '/worker.js',
        serviceWorkerContainer,
        location: {
            hostname: 'app.example.com'
        },
        secureContext: true
    });
    await layerServiceWorkerRegister({
        serviceWorkerContainer,
        location: {
            hostname: 'localhost'
        },
        secureContext: false
    });

    assert.equal(registrationCalls.length, 2);
    assert.deepEqual(registrationCalls[0], {
        scriptUrl: '/worker.js',
        registrationOptions: {
            scope: '/',
            type: 'module',
            updateViaCache: 'none'
        }
    });
    await assert.rejects(() => layerServiceWorkerRegister({
        serviceWorkerContainer,
        location: {
            hostname: 'app.example.com'
        },
        secureContext: false
    }), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_SECURE_CONTEXT_REQUIRED';
    });
    await assert.rejects(() => layerServiceWorkerRegister({
        location: {
            hostname: 'localhost'
        },
        secureContext: false
    }), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_SERVICE_WORKER_UNAVAILABLE';
    });
});

test('Service Worker registration uses one validated TrustedScriptURL under CSP', async function trustedScriptUrlRegistrationCheck() {
    //Preparing one browser-shaped registration boundary with a private Trusted Types policy.
    const registrationCalls = /** @type {any[]} */ ([]);
    const policyCalls = /** @type {string[]} */ ([]);
    const globalData = /** @type {any} */ (globalThis);
    const originalTrustedTypes = globalData.trustedTypes;
    const serviceWorkerContainer = /** @type {ServiceWorkerContainer} */ (/** @type {unknown} */ ({
        /**
         * @param {any} scriptUrl
         * @param {RegistrationOptions} registrationOptions
         */
        async register(scriptUrl, registrationOptions) {
            //Recording the exact browser sink value and registration contract.
            registrationCalls.push({scriptUrl, registrationOptions});

            //CallBack THE REGISTRATION
            return {
                scope: 'https://app.example.com/'
            };

        }
    }));
    const trustedTypes = {
        /**
         * @param {string} policyName
         * @param {{createScriptURL: (scriptUrl: string) => string}} policyOptions
         */
        createPolicy(policyName, policyOptions) {
            //Recording that the framework creates only its private named policy.
            policyCalls.push(policyName);

            //CallBack THE POLICY
            return {
                /** @param {string} scriptUrl */
                createScriptURL(scriptUrl) {
                    //CallBack THE TRUSTED SCRIPT URL RECORD
                    return Object.freeze({
                        type: 'TrustedScriptURL',
                        value: policyOptions.createScriptURL(scriptUrl)
                    });

                }
            };

        }
    };

    //Installing the browser feature only for this isolated regression test.
    globalData.trustedTypes = trustedTypes;

    try {
        await layerServiceWorkerRegister({
            scriptUrl: '/layer-service-worker.js',
            serviceWorkerContainer,
            location: {
                hostname: 'app.example.com'
            },
            secureContext: true
        });

        assert.deepEqual(policyCalls, ['layer-service-worker']);
        assert.deepEqual(registrationCalls[0].scriptUrl, {
            type: 'TrustedScriptURL',
            value: 'https://app.example.com/layer-service-worker.js'
        });
        await assert.rejects(
            function crossOriginRegistrationRun() {
                //CallBack THE REJECTED REGISTRATION PROMISE
                return layerServiceWorkerRegister({
                    scriptUrl: 'https://attacker.example/worker.js',
                    serviceWorkerContainer,
                    location: {
                        hostname: 'app.example.com'
                    },
                    secureContext: true
                });

            },
            function crossOriginFailureCheck(errorData) {
                //CallBack THE BOOLEAN
                return /** @type {any} */ (errorData).code === 'PWA_SERVICE_WORKER_URL_INVALID';

            }
        );

    } finally {
        //Restoring the process global even when one assertion fails.
        globalData.trustedTypes = originalTrustedTypes;

    }

});

/**
 * @param {string} contentData
 */
function integrityCreate(contentData) {
    return `sha256-${createHash('sha256').update(contentData).digest('base64')}`;
}

/**
 * @param {Record<string, string>} assetData
 * @param {Record<string, unknown>} [overrideData]
 */
function versionManifestCreate(assetData, overrideData = {}) {
    return {
        appVersion: '1.1.0',
        runtimeVersion: '0.1.0',
        compilerVersion: '0.1.0',
        protocolMin: 1,
        protocolMax: 1,
        schemaVersions: {
            messenger: 1
        },
        minVersion: null,
        rollbackVersion: '1.0.0',
        offlineShellUrl: '/index.html',
        assets: Object.entries(assetData).map(([assetUrl, contentData]) => ({
            url: assetUrl,
            hash: integrityCreate(contentData),
            required: true,
            policy: assetUrl === '/index.html' ? 'shell' : 'immutable'
        })),
        ...overrideData
    };
}

/**
 * @param {string | Request} requestData
 */
function cacheKeyCreate(requestData) {
    const requestUrl = typeof requestData === 'string' ? requestData : requestData.url;

    return new URL(requestUrl, 'https://app.example.com').pathname;
}

function cacheStorageCreate() {
    const cacheMap = new Map();
    const deletedCaches = /** @type {string[]} */ ([]);

    return {
        cacheStorage: /** @type {CacheStorage} */ (/** @type {unknown} */ ({
            async open(/** @type {string} */ cacheName) {
                let responseMap = cacheMap.get(cacheName);

                if (responseMap === undefined) {
                    responseMap = new Map();
                    cacheMap.set(cacheName, responseMap);
                }

                return {
                    async put(/** @type {string | Request} */ requestData, /** @type {Response} */ responseData) {
                        responseMap.set(cacheKeyCreate(requestData), responseData.clone());
                    },
                    async match(/** @type {string | Request} */ requestData) {
                        return responseMap.get(cacheKeyCreate(requestData))?.clone();
                    }
                };
            },
            async delete(/** @type {string} */ cacheName) {
                deletedCaches.push(cacheName);

                return cacheMap.delete(cacheName);
            },
            async keys() {
                return [...cacheMap.keys()];
            }
        })),
        cacheMap,
        deletedCaches
    };
}

test('version and web app manifests reject drift and normalize public data', () => {
    const manifest = layerVersionManifestValidate(versionManifestCreate({
        '/index.html': '<html></html>',
        '/app.js': 'export {}'
    }));

    assert.equal(manifest.assets.length, 2);
    assert.equal(Object.isFrozen(manifest), true);
    assert.equal(layerVersionCompare('1.2.0', '1.1.9'), 1);
    assert.equal(layerVersionCompare('1.0.0', '1.0.0'), 0);
    assert.equal(layerVersionCompare('0.9.0', '1.0.0'), -1);
    assert.throws(() => layerVersionManifestValidate({
        ...versionManifestCreate({
            '/app.js': 'export {}'
        }),
        offlineShellUrl: '/missing.html'
    }), (errorData) => errorData instanceof LayerPwaError && errorData.code === 'PWA_MANIFEST_INVALID');

    assert.deepEqual(layerWebAppManifestCreate({
        name: 'Layer Messenger',
        shortName: 'Messenger',
        description: 'Offline-first Layer application',
        startUrl: '/app/',
        scope: '/app/',
        id: '/app/',
        lang: 'ru',
        dir: 'ltr',
        orientation: 'portrait',
        icons: [
            {
                src: '/icon-192.png',
                sizes: '192x192',
                type: 'image/png'
            }
        ],
        shortcuts: [{
            name: 'Unread messages',
            shortName: 'Unread',
            description: 'Open unread conversations',
            url: '/app/unread',
            icons: [{
                src: '/shortcut.svg',
                type: 'image/svg+xml'
            }]
        }],
        fileHandlers: [{
            action: '/app/open-text',
            name: 'Layer text document',
            accept: {
                'text/plain': ['.txt']
            },
            launchType: 'single-client'
        }],
        protocolHandlers: [{
            protocol: 'web+layer',
            url: '/app/protocol?target=%s'
        }],
        shareTarget: {
            action: '/app/share',
            method: 'POST',
            enctype: 'multipart/form-data',
            params: {
                title: 'title',
                text: 'text',
                url: 'url',
                files: [{
                    name: 'files',
                    accept: [
                        'image/png',
                        '.png'
                    ]
                }]
            }
        },
        launchHandler: {
            clientMode: [
                'focus-existing',
                'navigate-new'
            ]
        }
    }), {
        name: 'Layer Messenger',
        short_name: 'Messenger',
        description: 'Offline-first Layer application',
        start_url: '/app/',
        scope: '/app/',
        id: '/app/',
        lang: 'ru',
        dir: 'ltr',
        orientation: 'portrait',
        display: 'standalone',
        theme_color: '#000000',
        background_color: '#ffffff',
        icons: [
            {
                src: '/icon-192.png',
                sizes: '192x192',
                type: 'image/png'
            }
        ],
        shortcuts: [{
            name: 'Unread messages',
            short_name: 'Unread',
            description: 'Open unread conversations',
            url: '/app/unread',
            icons: [{
                src: '/shortcut.svg',
                type: 'image/svg+xml'
            }]
        }],
        file_handlers: [{
            action: '/app/open-text',
            name: 'Layer text document',
            accept: {
                'text/plain': ['.txt']
            },
            launch_type: 'single-client'
        }],
        protocol_handlers: [{
            protocol: 'web+layer',
            url: '/app/protocol?target=%s'
        }],
        share_target: {
            action: '/app/share',
            method: 'POST',
            enctype: 'multipart/form-data',
            params: {
                title: 'title',
                text: 'text',
                url: 'url',
                files: [{
                    name: 'files',
                    accept: [
                        'image/png',
                        '.png'
                    ]
                }]
            }
        },
        launch_handler: {
            client_mode: [
                'focus-existing',
                'navigate-new'
            ]
        }
    });
});

test('standard web app manifest validation canonicalizes supported browser metadata', () => {
    const manifestData = layerWebAppManifestValidate({
        name: 'Layer Messenger',
        short_name: 'Messenger',
        description: 'Offline-first Layer application',
        start_url: '/app/',
        scope: '/app/',
        id: '/app/',
        lang: 'ru',
        dir: 'ltr',
        orientation: 'portrait',
        display: 'standalone',
        icons: [{
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
        }],
        shortcuts: [{
            name: 'Unread messages',
            short_name: 'Unread',
            url: '/app/unread'
        }],
        file_handlers: [{
            action: '/app/open',
            accept: {
                'text/plain': ['.txt']
            },
            launch_type: 'single-client'
        }],
        protocol_handlers: [{
            protocol: 'web+layer',
            url: '/app/protocol?target=%s'
        }],
        launch_handler: {
            client_mode: 'focus-existing'
        }
    });

    assert.equal(manifestData.short_name, 'Messenger');
    assert.equal(manifestData.description, 'Offline-first Layer application');
    assert.equal(manifestData.id, '/app/');
    assert.equal(/** @type {any} */ (manifestData.icons)[0].src, '/icon.svg');
    assert.equal(/** @type {any} */ (manifestData.shortcuts)[0].short_name, 'Unread');
    assert.equal(/** @type {any} */ (manifestData.file_handlers)[0].launch_type, 'single-client');
    assert.equal(/** @type {any} */ (manifestData.launch_handler).client_mode, 'focus-existing');

    for (const invalidManifestData of [
        null,
        {
            name: 'Layer',
            short_name: 'Layer',
            start_url: '/',
            icons: [],
            typo: true
        },
        {
            name: 'Layer',
            short_name: 'Layer',
            start_url: '/',
            icons: [{
                src: '/icon.svg',
                sizes: 'any',
                type: 'image/svg+xml'
            }],
            shortcuts: [{
                name: 'Home',
                url: '/',
                shortName: 'Wrong case'
            }]
        }
    ]) {
        assert.throws(() => layerWebAppManifestValidate(invalidManifestData), (errorData) => {
            return /** @type {any} */ (errorData).code === 'PWA_WEB_MANIFEST_INVALID';
        });
    }
});

test('PWA manifests and update coordinator fail closed on invalid contracts', async () => {
    assert.throws(() => layerVersionManifestValidate(null), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_MANIFEST_INVALID';
    });
    assert.throws(() => layerVersionManifestValidate({}), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_MANIFEST_INVALID';
    });
    assert.throws(() => layerVersionManifestValidate(versionManifestCreate({
        '/index.html': '<html></html>'
    }, {
        schemaVersions: {
            'Invalid Schema': 0
        }
    })), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_MANIFEST_INVALID';
    });
    assert.throws(() => layerVersionManifestValidate(versionManifestCreate({
        '/index.html': '<html></html>'
    }, {
        assets: [null]
    })), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_MANIFEST_INVALID';
    });
    assert.throws(() => layerWebAppManifestCreate({
        name: '',
        shortName: 'Layer',
        startUrl: '/',
        icons: []
    }), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_WEB_MANIFEST_INVALID';
    });
    assert.throws(() => layerWebAppManifestCreate({
        name: 'Layer',
        shortName: 'Layer',
        startUrl: '/',
        icons: [{
            src: 'https://external.example/icon.png',
            sizes: '192x192',
            type: 'image/png'
        }]
    }), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_WEB_MANIFEST_INVALID';
    });

    const baseManifestOptions = {
        name: 'Layer',
        shortName: 'Layer',
        startUrl: '/app/',
        scope: '/app/',
        icons: [{
            src: '/icon.png',
            sizes: '192x192',
            type: 'image/png'
        }]
    };
    const invalidCapabilityManifests = [
        null,
        {
            ...baseManifestOptions,
            typo: true
        },
        {
            ...baseManifestOptions,
            scope: 'app/'
        },
        {
            ...baseManifestOptions,
            display: 'fullscreen-ish'
        },
        {
            ...baseManifestOptions,
            icons: [{
                src: '/icon.png',
                purpose: 'unknown-purpose'
            }]
        },
        {
            ...baseManifestOptions,
            shortcuts: [null]
        },
        {
            ...baseManifestOptions,
            shortcuts: [{
                name: 'Outside',
                url: '/outside'
            }]
        },
        {
            ...baseManifestOptions,
            shortcuts: Array.from({length: 33}, (_, shortcutIndex) => ({
                name: `Shortcut ${shortcutIndex}`,
                url: `/app/${shortcutIndex}`
            }))
        },
        {
            ...baseManifestOptions,
            fileHandlers: [null]
        },
        {
            ...baseManifestOptions,
            fileHandlers: [{
                action: '/app/open',
                accept: {}
            }]
        },
        {
            ...baseManifestOptions,
            fileHandlers: [{
                action: '/app/open',
                accept: {
                    'invalid mime': ['.txt']
                }
            }]
        },
        {
            ...baseManifestOptions,
            fileHandlers: [{
                action: '/app/open',
                accept: {
                    'text/plain': ['txt']
                }
            }]
        },
        {
            ...baseManifestOptions,
            protocolHandlers: [null]
        },
        {
            ...baseManifestOptions,
            protocolHandlers: [{
                protocol: 'web+layer',
                url: '/app/protocol'
            }]
        },
        {
            ...baseManifestOptions,
            protocolHandlers: [{
                protocol: 'http',
                url: '/app/protocol?target=%s'
            }]
        },
        {
            ...baseManifestOptions,
            shareTarget: null
        },
        {
            ...baseManifestOptions,
            shareTarget: {
                action: '/app/share',
                method: 'POST',
                enctype: 'application/x-www-form-urlencoded',
                params: {}
            }
        },
        {
            ...baseManifestOptions,
            shareTarget: {
                action: '/app/share?layerShareId=reserved',
                method: 'POST',
                enctype: 'application/x-www-form-urlencoded',
                params: {
                    text: 'text'
                }
            }
        },
        {
            ...baseManifestOptions,
            shareTarget: {
                action: '/app/share',
                method: 'POST',
                enctype: 'application/x-www-form-urlencoded',
                params: {
                    title: 'invalid field name'
                }
            }
        },
        {
            ...baseManifestOptions,
            shareTarget: {
                action: '/app/share',
                method: 'POST',
                enctype: 'multipart/form-data',
                params: {
                    files: [null]
                }
            }
        },
        {
            ...baseManifestOptions,
            shareTarget: {
                action: '/app/share',
                method: 'GET',
                enctype: 'application/x-www-form-urlencoded',
                params: {
                    files: [{
                        name: 'files',
                        accept: ['image/png']
                    }]
                }
            }
        },
        {
            ...baseManifestOptions,
            launchHandler: null
        },
        {
            ...baseManifestOptions,
            launchHandler: {
                clientMode: []
            }
        },
        {
            ...baseManifestOptions,
            launchHandler: {
                clientMode: 'reuse-unknown'
            }
        }
    ];

    for (const invalidManifestOptions of invalidCapabilityManifests) {
        assert.throws(() => layerWebAppManifestCreate(/** @type {any} */ (invalidManifestOptions)), (errorData) => {
            return /** @type {any} */ (errorData).code === 'PWA_WEB_MANIFEST_INVALID';
        });
    }

    const serviceWorkerContainer = new EventTarget();
    const coordinator = layerUpdateCoordinatorCreate({
        currentVersion: '1.0.0',
        protocolVersion: 2,
        manifestLoad: async () => versionManifestCreate({
            '/index.html': '<html></html>'
        }),
        registrationGet: async () => /** @type {ServiceWorkerRegistration} */ (/** @type {unknown} */ ({})),
        async localStateSave() {},
        reload() {},
        serviceWorkerContainer: /** @type {ServiceWorkerContainer} */ (serviceWorkerContainer)
    });

    await assert.rejects(() => coordinator.check(), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_PROTOCOL_INCOMPATIBLE';
    });
    await assert.rejects(() => coordinator.activate(), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_UPDATE_NOT_READY';
    });
    assert.deepEqual(coordinator.bootStart(), {
        attempts: 1,
        safeMode: false
    });
    assert.throws(() => layerUpdateCoordinatorCreate({
        currentVersion: 'invalid',
        protocolVersion: 1,
        manifestLoad: async () => ({}),
        registrationGet: async () => /** @type {ServiceWorkerRegistration} */ (/** @type {unknown} */ ({})),
        async localStateSave() {},
        reload() {},
        serviceWorkerContainer: /** @type {ServiceWorkerContainer} */ (serviceWorkerContainer)
    }), TypeError);
});

test('Service Worker installs verified assets atomically and keeps rollback cache', async () => {
    const assets = /** @type {Record<string, string>} */ ({
        '/index.html': '<html>offline</html>',
        '/app.js': 'export const ready = true;'
    });
    const cacheFixture = cacheStorageCreate();
    cacheFixture.cacheMap.set('layer-app:0.9.0', new Map());
    cacheFixture.cacheMap.set('layer-app:1.0.0', new Map());
    cacheFixture.cacheMap.set('unrelated', new Map());
    let claimCount = 0;
    let networkFetchCount = 0;
    const notifications = /** @type {any[]} */ ([]);
    const runtime = layerServiceWorkerRuntimeCreate({
        manifest: versionManifestCreate(assets),
        cacheStorage: cacheFixture.cacheStorage,
        fetchImplementation: async (requestData) => {
            networkFetchCount += 1;
            const assetUrl = cacheKeyCreate(/** @type {any} */ (requestData));
            const assetContent = assets[assetUrl];

            if (assetContent === undefined) {
                throw new TypeError('network unavailable');
            }

            return new Response(assetContent, {
                status: 200,
                headers: {
                    'content-type': assetUrl.endsWith('.js') ? 'text/javascript' : 'text/html'
                }
            });
        },
        subtleCrypto: /** @type {SubtleCrypto} */ (/** @type {unknown} */ (webcrypto.subtle)),
        base64Encode: (binaryData) => btoa(binaryData),
        scope: {
            async skipWaiting() {},
            clients: {
                async claim() {
                    claimCount += 1;
                },
                async matchAll() {
                    return [];
                },
                async openWindow() {}
            },
            registration: {
                async showNotification(titleData, notificationOptions) {
                    notifications.push({titleData, notificationOptions});
                }
            }
        },
        applicationOrigin: 'https://app.example.com'
    });

    await runtime.install();
    assert.equal(cacheFixture.cacheMap.get('layer-app:1.1.0').size, 2);
    await runtime.activate();
    assert.equal(claimCount, 1);
    assert.equal(cacheFixture.cacheMap.has('layer-app:0.9.0'), false);
    assert.equal(cacheFixture.cacheMap.has('layer-app:1.0.0'), true);
    assert.equal(cacheFixture.cacheMap.has('unrelated'), true);

    const immutableResponse = await runtime.fetch(/** @type {Request} */ (/** @type {unknown} */ ({
        method: 'GET',
        url: 'https://app.example.com/app.js',
        mode: 'cors'
    })));
    const navigationResponse = await runtime.fetch(/** @type {Request} */ (/** @type {unknown} */ ({
        method: 'GET',
        url: 'https://app.example.com/messages',
        mode: 'navigate'
    })));

    assert.match(await immutableResponse.text(), /ready/);
    assert.match(await navigationResponse.text(), /offline/);
    const cachedFetchCount = networkFetchCount;
    assets['/app.js'] = 'export const ready = false;';
    assert.equal(await runtime.message({type: 'development-cache-bypass'}), true);
    const developmentResponse = await runtime.fetch(/** @type {Request} */ (/** @type {unknown} */ ({
        method: 'GET',
        url: 'https://app.example.com/app.js',
        mode: 'cors'
    })));
    assert.match(await developmentResponse.text(), /false/);
    assert.equal(networkFetchCount, cachedFetchCount + 1);
    assert.equal(await runtime.message({type: 'activate-update'}), true);
    assert.equal(await runtime.message({type: 'unknown'}), false);
    assert.equal(await runtime.sync('other'), false);
    await runtime.push({
        title: 'New message',
        body: 'Hello',
        url: '/messages/1'
    });
    assert.equal(notifications[0].titleData, 'New message');
    await assert.rejects(() => runtime.notificationOpen('https://attacker.example/path'), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_NAVIGATION_DENIED';
    });
});

test('association reads bypass cache and native fetch interception even during offline navigation', async function(){
    //Providing an offline shell that must never stand in for a platform verification document
    const cacheFixture = cacheStorageCreate();
    const eventHandlers = /** @type {Map<string, (eventData: any) => void>} */ (new Map());
    let fetchCount = 0;
    const runtime = layerServiceWorkerRuntimeCreate({
        manifest: versionManifestCreate({'/index.html': '<html>offline shell</html>'}),
        cacheStorage: cacheFixture.cacheStorage,
        applicationOrigin: 'https://app.example.com',
        fetchImplementation: async function(){
            //Simulating an unavailable network without consulting the existing shell
            fetchCount++;
            throw new TypeError('fixture network unavailable');

        },
        subtleCrypto: /** @type {SubtleCrypto} */ (/** @type {unknown} */ (webcrypto.subtle)),
        base64Encode: function(binaryData){
            //Keeping the fixture's integrity adapter identical to the existing worker tests
            return btoa(binaryData);

        },
        scope: /** @type {any} */ ({
            addEventListener: function(/** @type {string} */ nameData, /** @type {any} */ callbackData){
                //Recording the attached fetch event path used by the actual worker
                eventHandlers.set(nameData, callbackData);

            }
        })
    });
    runtime.attach();
    const request = new Request('https://app.example.com/.well-known/apple-app-site-association');
    Object.defineProperty(request, 'mode', {value: 'navigate'});
    await assert.rejects(function(){
        //Requiring a network failure rather than a successful offline HTML response
        return runtime.fetch(request);

    }, /network unavailable/u);
    assert.equal(fetchCount, 1);
    assert.equal(cacheFixture.cacheMap.size, 0);
    let interceptedStatus = false;
    eventHandlers.get('fetch')?.({request, respondWith: function(){
        //Recording accidental ownership of an association fetch
        interceptedStatus = true;

    }});
    assert.equal(interceptedStatus, false);

});

test('Service Worker removes partial cache when integrity verification fails', async () => {
    const cacheFixture = cacheStorageCreate();
    const manifest = versionManifestCreate({
        '/index.html': 'expected'
    });
    const runtime = layerServiceWorkerRuntimeCreate({
        manifest,
        cacheStorage: cacheFixture.cacheStorage,
        fetchImplementation: async () => new Response('tampered', {
            status: 200
        }),
        subtleCrypto: /** @type {SubtleCrypto} */ (/** @type {unknown} */ (webcrypto.subtle)),
        base64Encode: (binaryData) => btoa(binaryData),
        scope: {
            async skipWaiting() {},
            clients: {
                async claim() {},
                async matchAll() {
                    return [];
                }
            },
            registration: {
                async showNotification() {}
            }
        }
    });

    await assert.rejects(() => runtime.install(), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_ASSET_INTEGRITY_FAILED';
    });
    assert.equal(cacheFixture.cacheMap.has('layer-app:1.1.0'), false);
});

test('Service Worker captures only the exact declared Share Target POST route', async () => {
    const attachedEvents = /** @type {Map<string, (eventData: any) => void>} */ (new Map());
    const cacheFixture = cacheStorageCreate();
    const networkRequests = /** @type {Request[]} */ ([]);
    const capturedRequests = /** @type {Request[]} */ ([]);
    const runtime = layerServiceWorkerRuntimeCreate({
        manifest: versionManifestCreate({
            '/index.html': '<html></html>'
        }),
        cacheStorage: cacheFixture.cacheStorage,
        fetchImplementation: async (requestData) => {
            networkRequests.push(/** @type {Request} */ (requestData));

            return new Response('network', {
                status: 200
            });
        },
        subtleCrypto: /** @type {SubtleCrypto} */ (/** @type {unknown} */ (webcrypto.subtle)),
        base64Encode: (binaryData) => btoa(binaryData),
        scope: {
            addEventListener: function( name, handler ){
                //Recording event callbacks so the test exercises the same attached path as a browser
                attachedEvents.set( name, handler );

            },
            async skipWaiting() {},
            clients: {
                async claim() {},
                async matchAll() {
                    return [];
                }
            },
            registration: {
                async showNotification() {}
            }
        },
        applicationOrigin: 'https://app.example.com',
        shareTarget: {
            action: '/share?source=os',
            method: 'POST',
            enctype: 'multipart/form-data',
            params: Object.freeze({
                text: 'text'
            })
        },
        async shareTargetCapture(requestData) {
            capturedRequests.push(requestData);
            const errorCode = requestData.headers.get('x-share-error');

            if (errorCode !== null) {
                throw Object.assign(new Error('private storage detail'), {
                    code: errorCode
                });

            }

            return '16f3a5d1-6b63-45ba-859b-09312b70498c';
        }
    });

    runtime.attach();
    //Capturing only attached Share Target responses while normal API traffic remains outside the worker
    const sharedResponses = /** @type {Promise<Response>[]} */ ([]);
    const shareFetchHandler = attachedEvents.get( 'fetch' );
    assert.ok( shareFetchHandler !== undefined );
    shareFetchHandler({
        request: new Request( 'https://app.example.com/share?source=os', {method: 'POST', body: new FormData()} ),
        respondWith: function( /** @type {Promise<Response>} */ promiseData ){
            //Recording the response owned by the Share Target fetch event
            sharedResponses.push( promiseData );

        },
        waitUntil: function(){
            //Accepting optional refresh lifetimes; this Share Target test performs no cache refresh

        }
    });
    assert.equal( sharedResponses.length, 1 );
    assert.ok( sharedResponses[0] !== undefined );
    const sharedResponse = await sharedResponses[0];
    assert.equal( sharedResponse.status, 303 );
    capturedRequests.length = 0;

    const responseData = await runtime.fetch(new Request('https://app.example.com/share?source=os', {
        method: 'POST',
        body: new FormData()
    }));

    assert.equal(responseData.status, 303);
    assert.equal(
        responseData.headers.get('location'),
        'https://app.example.com/share?source=os&layerShareId=16f3a5d1-6b63-45ba-859b-09312b70498c'
    );
    assert.equal(responseData.headers.get('cache-control'), 'no-store');
    assert.equal(capturedRequests.length, 1);
    assert.equal(networkRequests.length, 0);

    for (const failureData of [
        ['SHARE_TARGET_SIZE_EXCEEDED', 413],
        ['SHARE_TARGET_STORAGE_FAILED', 503],
        ['SHARE_TARGET_INVALID', 400]
    ]) {
        const failureResponse = await runtime.fetch(new Request('https://app.example.com/share?source=os', {
            method: 'POST',
            headers: {
                'x-share-error': String(failureData[0])
            },
            body: new FormData()
        }));

        assert.equal(failureResponse.status, failureData[1]);
        assert.equal(await failureResponse.text(), 'Shared content could not be accepted.');
        assert.equal(failureResponse.headers.get('cache-control'), 'no-store');

    }

    const ordinaryPostResponse = await runtime.fetch(new Request('https://app.example.com/api', {
        method: 'POST',
        body: '{}'
    }));

    assert.equal(await ordinaryPostResponse.text(), 'network');
    assert.equal(networkRequests.length, 1);
    assert.throws(() => layerServiceWorkerRuntimeCreate({
        manifest: versionManifestCreate({
            '/index.html': '<html></html>'
        }),
        cacheStorage: cacheFixture.cacheStorage,
        fetchImplementation: fetch,
        subtleCrypto: /** @type {SubtleCrypto} */ (/** @type {unknown} */ (webcrypto.subtle)),
        base64Encode: (binaryData) => btoa(binaryData),
        scope: {
            async skipWaiting() {},
            clients: {
                async claim() {},
                async matchAll() {
                    return [];
                }
            },
            registration: {
                async showNotification() {}
            }
        },
        applicationOrigin: 'https://app.example.com',
        shareTarget: {
            action: '/share',
            method: 'POST',
            enctype: 'multipart/form-data',
            params: Object.freeze({
                text: 'text'
            })
        }
    }), TypeError);
});

test('update coordinator waits for explicit activation and detects boot loops', async () => {
    const serviceWorkerContainer = new EventTarget();
    const postedMessages = /** @type {any[]} */ ([]);
    let updateCount = 0;
    let saveCount = 0;
    let reloadCount = 0;
    const waitingWorker = {
        postMessage(/** @type {any} */ messageData) {
            postedMessages.push(messageData);
            queueMicrotask(() => serviceWorkerContainer.dispatchEvent(new Event('controllerchange')));
        }
    };
    const sessionData = new Map();
    const sessionStorage = /** @type {Storage} */ (/** @type {unknown} */ ({
        getItem(/** @type {string} */ keyData) {
            return sessionData.get(keyData) ?? null;
        },
        setItem(/** @type {string} */ keyData, /** @type {string} */ valueData) {
            sessionData.set(keyData, valueData);
        },
        removeItem(/** @type {string} */ keyData) {
            sessionData.delete(keyData);
        }
    }));
    const coordinator = layerUpdateCoordinatorCreate({
        currentVersion: '1.0.0',
        protocolVersion: 1,
        manifestLoad: async () => versionManifestCreate({
            '/index.html': '<html></html>'
        }, {
            minVersion: '1.1.0'
        }),
        registrationGet: async () => /** @type {ServiceWorkerRegistration} */ (/** @type {unknown} */ ({
            waiting: waitingWorker,
            async update() {
                updateCount += 1;
            }
        })),
        async localStateSave() {
            saveCount += 1;
        },
        reload() {
            reloadCount += 1;
        },
        serviceWorkerContainer: /** @type {ServiceWorkerContainer} */ (serviceWorkerContainer),
        sessionStorage,
        maximumBootAttempts: 2
    });

    assert.deepEqual(await coordinator.check(), {
        updateAvailable: true,
        criticalUpdate: true,
        currentVersion: '1.0.0',
        availableVersion: '1.1.0',
        waiting: true
    });
    assert.equal(updateCount, 1);
    await coordinator.activate();
    assert.equal(saveCount, 1);
    assert.equal(reloadCount, 1);
    assert.equal(postedMessages[0].type, 'activate-update');
    assert.equal(coordinator.bootStart().safeMode, false);
    assert.equal(coordinator.bootStart().safeMode, false);
    assert.equal(coordinator.bootStart().safeMode, true);
    coordinator.bootSuccess();
    assert.equal(sessionData.size, 0);
});

test('capability facade exposes explicit support and fallback behavior', async () => {
    const syncTags = /** @type {string[]} */ ([]);
    const badgeValues = /** @type {number[]} */ ([]);
    const navigatorData = /** @type {Navigator} */ (/** @type {unknown} */ ({
        onLine: true,
        async setAppBadge(/** @type {number} */ countData) {
            badgeValues.push(countData);
        },
        async clearAppBadge() {
            badgeValues.push(0);
        },
        async share() {},
        storage: {
            async persist() {
                return true;
            },
            async persisted() {
                return true;
            },
            async estimate() {
                return {
                    usage: 128,
                    quota: 1024
                };
            }
        }
    }));
    const capabilities = layerPwaCapabilitiesCreate({
        navigator: navigatorData,
        registrationGet: async () => /** @type {ServiceWorkerRegistration} */ (/** @type {unknown} */ ({
            sync: {
                async register(/** @type {string} */ tagData) {
                    syncTags.push(tagData);
                }
            }
        }))
    });

    assert.equal(capabilities.install.getCapability().supported, false);
    assert.equal(capabilities.shareTarget.getCapability().supported, false);
    assert.equal(capabilities.shareTarget.pendingIdGet(), null);
    assert.equal(capabilities.badge.getCapability().supported, true);
    await capabilities.badge.set(4);
    await capabilities.badge.clear();
    assert.deepEqual(badgeValues, [
        4,
        0
    ]);
    assert.equal((await capabilities.backgroundSync.getCapability()).supported, true);
    await capabilities.backgroundSync.register();
    assert.deepEqual(syncTags, [
        'layer-outbox'
    ]);
    assert.equal(capabilities.network.isOnlineHint(), true);
    assert.equal(await capabilities.storage.persist(), true);
    assert.equal(await capabilities.storage.persisted(), true);
    assert.deepEqual(await capabilities.storage.estimate(), {
        usage: 128,
        quota: 1024
    });
    await assert.rejects(() => capabilities.badge.set(-1), TypeError);
    await assert.rejects(() => capabilities.backgroundSync.register('invalid tag'), TypeError);
    await assert.rejects(() => capabilities.install.prompt(), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_CAPABILITY_UNAVAILABLE';
    });
    await assert.rejects(() => capabilities.shareTarget.consume(), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_CAPABILITY_UNAVAILABLE';
    });
});

test('capability facade exercises supported prompts and every explicit fallback', async () => {
    const windowListeners = new Map();
    const promptCalls = /** @type {string[]} */ ([]);
    const subscriptions = /** @type {any[]} */ ([]);
    const sharedRecords = /** @type {ShareData[]} */ ([]);
    const fileLaunchRecords = /** @type {any[]} */ ([]);
    const applicationLaunchRecords = /** @type {any[]} */ ([]);
    const protocolRegistrations = /** @type {string[][]} */ ([]);
    const protocolRemovals = /** @type {string[][]} */ ([]);
    const shownNotifications = /** @type {any[]} */ ([]);
    const notificationFilters = /** @type {any[]} */ ([]);
    const permissionStates = /** @type {PushSubscriptionOptionsInit[]} */ ([]);
    const consumedShareIdentifiers = /** @type {string[]} */ ([]);
    const discardedShareIdentifiers = /** @type {string[]} */ ([]);
    const clearedShareIdentifiers = /** @type {string[]} */ ([]);
    let closedNotificationCount = 0;
    let pushSubscriptionActive = true;
    let unsubscribedCount = 0;
    let pendingShareIdentifier = /** @type {string | null} */ ('55a2c45d-96f9-4925-84c6-154a23168acd');
    let launchConsumer = /** @type {((launchData: any) => unknown) | null} */ (null);
    const windowData = /** @type {Window} */ (/** @type {unknown} */ ({
        launchQueue: {
            /** @param {(launchData: any) => unknown} consumerData */
            setConsumer(consumerData) {
                launchConsumer = consumerData;
            }
        },
        /** @param {string} eventName @param {EventListener} eventHandle */
        addEventListener(eventName, eventHandle) {
            windowListeners.set(eventName, eventHandle);
        }
    }));
    const notificationApi = /** @type {typeof Notification} */ (/** @type {unknown} */ ({
        permission: 'granted',
        async requestPermission() {
            return 'granted';
        }
    }));
    const navigatorData = /** @type {Navigator} */ (/** @type {unknown} */ ({
        onLine: false,
        async setAppBadge() {},
        async clearAppBadge() {},
        /** @param {ShareData} shareData */
        async share(shareData) {
            sharedRecords.push(shareData);
        },
        /** @param {ShareData} shareData */
        canShare(shareData) {
            return typeof shareData.title === 'string';
        },
        /** @param {string} schemeData @param {string} handlerUrl */
        registerProtocolHandler(schemeData, handlerUrl) {
            protocolRegistrations.push([schemeData, handlerUrl]);
        },
        /** @param {string} schemeData @param {string} handlerUrl */
        unregisterProtocolHandler(schemeData, handlerUrl) {
            protocolRemovals.push([schemeData, handlerUrl]);
        },
        storage: {
            async persist() {
                return false;
            },
            async persisted() {
                return true;
            },
            async estimate() {
                return {
                    usage: 512,
                    quota: 4096
                };
            }
        }
    }));
    const pushSubscription = /** @type {PushSubscription} */ (/** @type {unknown} */ ({
        endpoint: 'https://push.example/subscription',
        async unsubscribe() {
            unsubscribedCount += 1;
            pushSubscriptionActive = false;

            return true;
        }
    }));
    const persistentNotification = /** @type {Notification} */ (/** @type {unknown} */ ({
        tag: 'message:42',
        close() {
            closedNotificationCount += 1;
        }
    }));
    const registrationGet = async () => /** @type {ServiceWorkerRegistration} */ (/** @type {unknown} */ ({
        pushManager: {
            /** @param {PushSubscriptionOptionsInit} subscriptionOptions */
            async subscribe(subscriptionOptions) {
                subscriptions.push(subscriptionOptions);

                return pushSubscription;
            },
            async getSubscription() {
                return pushSubscriptionActive ? pushSubscription : null;
            },
            /** @param {PushSubscriptionOptionsInit} permissionOptions */
            async permissionState(permissionOptions) {
                permissionStates.push(permissionOptions);

                return 'granted';
            }
        },
        sync: {
            async register() {}
        },
        /** @param {string} titleData @param {NotificationOptions} notificationOptions */
        async showNotification(titleData, notificationOptions) {
            shownNotifications.push({
                titleData,
                notificationOptions
            });
        },
        /** @param {GetNotificationOptions} [filterOptions] */
        async getNotifications(filterOptions) {
            notificationFilters.push(filterOptions ?? null);

            return [persistentNotification];
        }
    }));
    const capabilities = layerPwaCapabilitiesCreate({
        window: windowData,
        navigator: navigatorData,
        notificationApi,
        registrationGet,
        shareTargetIdGet() {
            return pendingShareIdentifier;
        },
        async shareTargetConsume(shareIdentifier) {
            consumedShareIdentifiers.push(shareIdentifier);

            return Object.freeze({
                id: shareIdentifier,
                text: 'Incoming'
            });
        },
        async shareTargetDiscard(shareIdentifier) {
            discardedShareIdentifiers.push(shareIdentifier);

            return true;
        },
        shareTargetIdClear(shareIdentifier) {
            clearedShareIdentifiers.push(shareIdentifier);
            pendingShareIdentifier = null;
        }
    });
    const installEventHandle = windowListeners.get('beforeinstallprompt');

    installEventHandle({
        preventDefault() {
            promptCalls.push('prevented');
        },
        async prompt() {
            promptCalls.push('prompted');
        },
        userChoice: Promise.resolve({
            outcome: 'accepted',
            platform: 'web'
        })
    });

    assert.equal(capabilities.install.getCapability().supported, true);
    assert.deepEqual(await capabilities.install.prompt(), {
        outcome: 'accepted',
        platform: 'web'
    });
    assert.deepEqual(promptCalls, [
        'prompted'
    ]);
    assert.equal(capabilities.notifications.getCapability().supported, true);
    assert.equal(await capabilities.notifications.requestPermission(), 'granted');
    await capabilities.notifications.show('New message', {
        tag: 'message:42',
        body: 'Layer'
    });
    assert.equal(shownNotifications[0]?.titleData, 'New message');
    assert.equal((await capabilities.notifications.list())[0]?.tag, 'message:42');
    assert.equal(await capabilities.notifications.close('message:42'), 1);
    assert.equal(closedNotificationCount, 1);
    await assert.rejects(() => capabilities.notifications.show(''), TypeError);
    await assert.rejects(() => capabilities.notifications.list(/** @type {any} */ (null)), TypeError);
    assert.deepEqual(notificationFilters, [
        null,
        {
            tag: 'message:42'
        }
    ]);
    assert.equal((await capabilities.push.getCapability()).supported, true);
    await capabilities.push.subscribe(new Uint8Array([1, 2, 3]));
    assert.equal(subscriptions.length, 1);
    assert.equal((await capabilities.push.getSubscription())?.endpoint, 'https://push.example/subscription');
    assert.equal(await capabilities.push.permissionState(new Uint8Array([1, 2, 3])), 'granted');
    assert.equal(await capabilities.push.permissionState(), 'granted');
    assert.equal(permissionStates.length, 2);
    assert.equal(permissionStates[0]?.applicationServerKey instanceof Uint8Array, true);
    assert.equal(permissionStates[1]?.applicationServerKey, undefined);
    assert.equal(await capabilities.push.unsubscribe(), true);
    assert.equal(unsubscribedCount, 1);
    assert.equal(await capabilities.push.unsubscribe(), false);
    await assert.rejects(() => capabilities.push.subscribe(new Uint8Array()), TypeError);
    assert.equal(capabilities.share.getCapability().supported, true);
    assert.equal(capabilities.share.canSend({title: 'Layer'}), true);
    assert.equal(capabilities.share.canSend(/** @type {any} */ ({unknown: true})), false);
    await capabilities.share.send({title: 'Layer'});
    await assert.rejects(
        () => capabilities.share.send(/** @type {any} */ ({unknown: true})),
        TypeError
    );
    assert.equal(sharedRecords[0]?.title, 'Layer');
    assert.equal(capabilities.shareTarget.getCapability().supported, true);
    assert.equal(capabilities.shareTarget.pendingIdGet(), '55a2c45d-96f9-4925-84c6-154a23168acd');
    assert.deepEqual(await capabilities.shareTarget.consume(), {
        id: '55a2c45d-96f9-4925-84c6-154a23168acd',
        text: 'Incoming'
    });
    assert.deepEqual(consumedShareIdentifiers, [
        '55a2c45d-96f9-4925-84c6-154a23168acd'
    ]);
    assert.deepEqual(clearedShareIdentifiers, [
        '55a2c45d-96f9-4925-84c6-154a23168acd'
    ]);

    pendingShareIdentifier = '2992f18a-3181-44c4-9c12-4b956ee71af4';
    assert.equal(await capabilities.shareTarget.discard(), true);
    assert.deepEqual(discardedShareIdentifiers, [
        '2992f18a-3181-44c4-9c12-4b956ee71af4'
    ]);
    await capabilities.badge.set();
    assert.equal(capabilities.files.getCapability().supported, true);
    capabilities.files.setConsumer((fileHandles, targetUrl) => {
        fileLaunchRecords.push({fileHandles, targetUrl});
    });
    assert.equal(typeof launchConsumer, 'function');
    /** @type {(launchData: any) => unknown} */ (launchConsumer)({
        targetURL: 'https://app.example.com/open',
        files: [{name: 'message.txt'}]
    });
    assert.equal(fileLaunchRecords[0]?.fileHandles[0]?.name, 'message.txt');
    assert.equal(fileLaunchRecords[0]?.targetUrl, 'https://app.example.com/open');
    assert.equal(capabilities.protocols.getCapability().supported, true);
    capabilities.protocols.register('WEB+LAYER', '/protocol?target=%s');
    capabilities.protocols.unregister('web+layer', '/protocol?target=%s');
    assert.deepEqual(protocolRegistrations, [[
        'web+layer',
        '/protocol?target=%s'
    ]]);
    assert.deepEqual(protocolRemovals, [[
        'web+layer',
        '/protocol?target=%s'
    ]]);
    assert.throws(() => capabilities.protocols.register('http', '/protocol?target=%s'), TypeError);
    assert.equal(capabilities.launch.getCapability().supported, true);
    capabilities.launch.setConsumer((launchData) => {
        applicationLaunchRecords.push(launchData);
    });
    /** @type {(launchData: any) => unknown} */ (launchConsumer)({
        targetURL: 'https://app.example.com/conversation/42',
        files: []
    });
    assert.deepEqual(applicationLaunchRecords[0], {
        targetUrl: 'https://app.example.com/conversation/42',
        files: []
    });
    assert.equal(capabilities.storage.getCapability().supported, true);
    assert.equal(await capabilities.storage.persist(), false);
    assert.equal(await capabilities.storage.persisted(), true);
    assert.deepEqual(await capabilities.storage.estimate(), {
        usage: 512,
        quota: 4096
    });
    assert.equal(capabilities.network.getCapability().supported, true);
    assert.equal(capabilities.network.isOnlineHint(), false);

    const unpermittedNotifications = layerPwaCapabilitiesCreate({
        notificationApi: /** @type {typeof Notification} */ (/** @type {unknown} */ ({
            permission: 'default'
        })),
        registrationGet
    });

    await assert.rejects(() => unpermittedNotifications.notifications.show('Layer'), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_NOTIFICATION_PERMISSION_REQUIRED';
    });

    const fallbackCapabilities = layerPwaCapabilitiesCreate();

    assert.equal(fallbackCapabilities.notifications.getCapability().supported, false);
    assert.equal((await fallbackCapabilities.push.getCapability()).supported, false);
    assert.equal((await fallbackCapabilities.backgroundSync.getCapability()).supported, false);
    assert.equal(fallbackCapabilities.badge.getCapability().supported, false);
    assert.equal(fallbackCapabilities.share.getCapability().supported, false);
    assert.equal(fallbackCapabilities.share.canSend({title: 'Layer'}), false);
    assert.equal(fallbackCapabilities.shareTarget.getCapability().supported, false);
    assert.equal(fallbackCapabilities.shareTarget.pendingIdGet(), null);
    assert.equal(fallbackCapabilities.files.getCapability().supported, false);
    assert.equal(fallbackCapabilities.protocols.getCapability().supported, false);
    assert.equal(fallbackCapabilities.launch.getCapability().supported, false);
    assert.equal(fallbackCapabilities.storage.getCapability().supported, false);
    assert.equal(fallbackCapabilities.network.getCapability().supported, false);
    assert.equal(fallbackCapabilities.network.isOnlineHint(), false);
    assert.throws(() => fallbackCapabilities.files.setConsumer(() => {}), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_CAPABILITY_UNAVAILABLE';
    });
    assert.throws(() => fallbackCapabilities.protocols.register('web+layer', '/open?target=%s'), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_CAPABILITY_UNAVAILABLE';
    });
    assert.throws(() => fallbackCapabilities.protocols.unregister('web+layer', '/open?target=%s'), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_CAPABILITY_UNAVAILABLE';
    });
    assert.throws(() => fallbackCapabilities.launch.setConsumer(() => {}), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_CAPABILITY_UNAVAILABLE';
    });

    for (const fallbackAction of [
        () => fallbackCapabilities.notifications.requestPermission(),
        () => fallbackCapabilities.notifications.show('Layer'),
        () => fallbackCapabilities.notifications.list(),
        () => fallbackCapabilities.notifications.close('layer'),
        () => fallbackCapabilities.push.subscribe(new Uint8Array()),
        () => fallbackCapabilities.push.getSubscription(),
        () => fallbackCapabilities.push.permissionState(),
        () => fallbackCapabilities.push.unsubscribe(),
        () => fallbackCapabilities.backgroundSync.register(),
        () => fallbackCapabilities.badge.set(1),
        () => fallbackCapabilities.badge.clear(),
        () => fallbackCapabilities.share.send({title: 'Layer'}),
        () => fallbackCapabilities.shareTarget.consume(),
        () => fallbackCapabilities.shareTarget.discard(),
        () => fallbackCapabilities.storage.persist(),
        () => fallbackCapabilities.storage.persisted(),
        () => fallbackCapabilities.storage.estimate()
    ]) {
        await assert.rejects(fallbackAction, (errorData) => {
            return /** @type {any} */ (errorData).code === 'PWA_CAPABILITY_UNAVAILABLE';
        });
    }
});

test('Service Worker routes cache policies, drains outbox, and wires lifecycle events', async () => {
    const assets = /** @type {Record<string, string>} */ ({
        '/index.html': '<html>offline</html>',
        '/app.js': 'export const version = 1;',
        '/image.png': 'image-one'
    });
    const cacheFixture = cacheStorageCreate();
    const eventHandlers = new Map();
    const openedWindows = /** @type {string[]} */ ([]);
    const navigatedWindows = /** @type {string[]} */ ([]);
    let focusedWindows = 0;
    let drainCount = 0;
    let matchedClients = /** @type {any[]} */ ([{
        url: 'https://app.example.com/messages',
        async focus() {
            focusedWindows += 1;
        },
        /** @param {string} targetUrl */
        async navigate(targetUrl) {
            navigatedWindows.push(targetUrl);
        }
    }]);
    const scopeData = {
        /** @param {string} eventName @param {Function} eventHandle */
        addEventListener(eventName, eventHandle) {
            eventHandlers.set(eventName, eventHandle);
        },
        async skipWaiting() {},
        clients: {
            async claim() {},
            async matchAll() {
                return matchedClients;
            },
            /** @param {string} targetUrl */
            async openWindow(targetUrl) {
                openedWindows.push(targetUrl);
            }
        },
        registration: {
            async showNotification() {}
        }
    };
    const runtime = layerServiceWorkerRuntimeCreate({
        manifest: versionManifestCreate(assets, {
            assets: [
                {
                    url: '/index.html',
                    hash: integrityCreate(assets['/index.html'] ?? ''),
                    required: true,
                    policy: 'shell'
                },
                {
                    url: '/app.js',
                    hash: integrityCreate(assets['/app.js'] ?? ''),
                    required: true,
                    policy: 'immutable'
                },
                {
                    url: '/image.png',
                    hash: integrityCreate(assets['/image.png'] ?? ''),
                    required: true,
                    policy: 'media'
                }
            ]
        }),
        cacheStorage: cacheFixture.cacheStorage,
        fetchImplementation: async (requestData) => {
            const requestRecord = /** @type {any} */ (requestData);
            const assetUrl = cacheKeyCreate(requestRecord);

            if (requestRecord.method === 'POST') {
                return new Response('posted');
            }

            if (assetUrl === '/online') {
                return new Response('online');
            }

            return new Response(assets[assetUrl] ?? 'network', {
                status: 200
            });
        },
        subtleCrypto: /** @type {SubtleCrypto} */ (/** @type {unknown} */ (webcrypto.subtle)),
        base64Encode: (binaryData) => btoa(binaryData),
        scope: /** @type {any} */ (scopeData),
        applicationOrigin: 'https://app.example.com',
        async outboxDrain() {
            drainCount += 1;
        }
    });

    await runtime.install();
    const postResponse = await runtime.fetch(/** @type {Request} */ (/** @type {unknown} */ ({
        method: 'POST',
        url: 'https://app.example.com/api'
    })));
    const onlineResponse = await runtime.fetch(/** @type {Request} */ (/** @type {unknown} */ ({
        method: 'GET',
        url: 'https://app.example.com/online',
        mode: 'cors'
    })));
    const refreshPromises = /** @type {Promise<unknown>[]} */ ([]);
    const mediaResponse = await runtime.fetch(/** @type {Request} */ (/** @type {unknown} */ ({
        method: 'GET',
        url: 'https://app.example.com/image.png',
        mode: 'cors'
    })), (promiseData) => refreshPromises.push(promiseData));

    assert.equal(await postResponse.text(), 'posted');
    assert.equal(await onlineResponse.text(), 'online');
    assert.equal(await mediaResponse.text(), 'image-one');
    await Promise.all(refreshPromises);
    const navigationResponse = await runtime.fetch(/** @type {Request} */ (/** @type {unknown} */ ({
        method: 'GET',
        url: 'https://app.example.com/online',
        mode: 'navigate'
    })));
    assert.equal(await navigationResponse.text(), 'online');
    cacheFixture.cacheMap.get(runtime.cacheName).delete('/app.js');
    const refetchedAsset = await runtime.fetch(/** @type {Request} */ (/** @type {unknown} */ ({
        method: 'GET',
        url: 'https://app.example.com/app.js',
        mode: 'cors'
    })));
    assert.match(await refetchedAsset.text(), /version/);
    cacheFixture.cacheMap.get(runtime.cacheName).delete('/image.png');
    const refetchedMedia = await runtime.fetch(/** @type {Request} */ (/** @type {unknown} */ ({
        method: 'GET',
        url: 'https://app.example.com/image.png',
        mode: 'cors'
    })));
    assert.equal(await refetchedMedia.text(), 'image-one');
    assert.equal(await runtime.sync('layer-outbox'), true);
    assert.equal(drainCount, 1);
    await assert.rejects(() => runtime.push(null), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_PUSH_INVALID';
    });
    await assert.rejects(() => runtime.push({title: ''}), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PWA_PUSH_INVALID';
    });
    await runtime.notificationOpen('/messages/2');
    assert.equal(focusedWindows, 1);
    assert.equal(navigatedWindows[0], 'https://app.example.com/messages/2');
    matchedClients = [];
    await runtime.notificationOpen('/messages/3');
    assert.equal(openedWindows[0], 'https://app.example.com/messages/3');

    runtime.attach();
    assert.deepEqual([...eventHandlers.keys()], [
        'install',
        'activate',
        'fetch',
        'message',
        'sync',
        'push',
        'notificationclick'
    ]);

    let eventPromise = /** @type {Promise<unknown>} */ (Promise.resolve());
    eventHandlers.get('install')({
        /** @param {Promise<unknown>} promiseData */
        waitUntil(promiseData) {
            eventPromise = promiseData;
        }
    });
    await eventPromise;
    eventHandlers.get('activate')({
        /** @param {Promise<unknown>} promiseData */
        waitUntil(promiseData) {
            eventPromise = promiseData;
        }
    });
    await eventPromise;
    eventHandlers.get('message')({
        data: {type: 'unknown'},
        /** @param {Promise<unknown>} promiseData */
        waitUntil(promiseData) {
            eventPromise = promiseData;
        }
    });
    await eventPromise;
    eventHandlers.get('sync')({
        tag: 'layer-outbox',
        /** @param {Promise<unknown>} promiseData */
        waitUntil(promiseData) {
            eventPromise = promiseData;
        }
    });
    await eventPromise;
    let foreignFetchResponseCount = 0;

    eventHandlers.get('fetch')({
        request: /** @type {Request} */ (/** @type {unknown} */ ({
            method: 'GET',
            url: 'https://security.example.net/injected.js',
            mode: 'cors'
        })),
        respondWith() {
            foreignFetchResponseCount += 1;
        },
        waitUntil() {}
    });
    assert.equal(foreignFetchResponseCount, 0);
    for (const requestData of [
        new Request('https://app.example.com/api', {method: 'POST', body: '{}'}),
        new Request('https://app.example.com/_layer/dev/events'),
        new Request('https://app.example.com/api', {method: 'DELETE'})
    ]) {
        //Keeping streaming API lifetimes and cancellation in the browser document.
        eventHandlers.get('fetch')({
            request: requestData,
            respondWith: function(){
                //Rejecting interception that could transfer cancellation or stream lifetime to the worker
                assert.fail( 'Private or development transport must bypass the worker.' );

            },
            waitUntil: function(){
                //Rejecting lifetime extensions for application API and development streams
                assert.fail( 'Transport must not extend the worker lifetime.' );

            }
        });

    }
    eventHandlers.get('fetch')({
        request: /** @type {Request} */ (/** @type {unknown} */ ({
            method: 'GET',
            url: 'https://app.example.com/app.js',
            mode: 'cors'
        })),
        /** @param {Promise<unknown>} promiseData */
        respondWith(promiseData) {
            eventPromise = promiseData;
        },
        waitUntil() {}
    });
    await eventPromise;
    eventHandlers.get('push')({
        data: {
            json() {
                return {title: 'Layer'};
            }
        },
        /** @param {Promise<unknown>} promiseData */
        waitUntil(promiseData) {
            eventPromise = promiseData;
        }
    });
    await eventPromise;
    let notificationClosed = false;
    eventHandlers.get('notificationclick')({
        notification: {
            data: {url: '/'},
            close() {
                notificationClosed = true;
            }
        },
        /** @param {Promise<unknown>} promiseData */
        waitUntil(promiseData) {
            eventPromise = promiseData;
        }
    });
    await eventPromise;
    assert.equal(notificationClosed, true);
});
