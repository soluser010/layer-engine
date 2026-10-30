import {LayerPwaError} from './pwa-error.js';
import {layerNavigationHandoff} from './navigation-handoff.js';
import {layerVersionManifestValidate} from './version-manifest.js';
import {layerPushReceiptsCreate} from './push-receipts.js';
import {layerLinkAssociationPathCheck} from './link-associations.js';
import {layerUpdateWorkerCreate} from './update-worker.js';
import {layerUpdateMetadataPathCheck} from './update-protocol.js';

/**
 * @param {ArrayBuffer} bufferData
 * @param {SubtleCrypto} subtleCrypto
 * @param {(binaryData: string) => string} base64Encode
 */
async function sha256IntegrityCreate(bufferData, subtleCrypto, base64Encode) {
    const digestData = await subtleCrypto.digest('SHA-256', bufferData);
    const digestBytes = new Uint8Array(digestData);
    let binaryData = '';

    //Building browser-compatible base64 input without Node Buffer.
    for (const byteValue of digestBytes) {
        binaryData += String.fromCharCode(byteValue);

    }

    return `sha256-${base64Encode(binaryData)}`;

}

/**
 * @param {Response} responseData
 * @param {string} expectedHash
 * @param {SubtleCrypto} subtleCrypto
 * @param {(binaryData: string) => string} base64Encode
 */
async function verifiedResponseCreate(responseData, expectedHash, subtleCrypto, base64Encode) {
    //Rejecting failed network responses before integrity work.
    if (!responseData.ok) {
        throw new LayerPwaError('PWA_ASSET_FETCH_FAILED', `Required asset returned ${responseData.status}.`, {
            retryable: true
        });

    }

    const assetBuffer = await responseData.arrayBuffer();
    const actualHash = await sha256IntegrityCreate(assetBuffer, subtleCrypto, base64Encode);

    if (actualHash !== expectedHash) {
        throw new LayerPwaError('PWA_ASSET_INTEGRITY_FAILED', 'A required asset failed integrity verification.');

    }

    return new Response(assetBuffer, {
        status: responseData.status,
        statusText: responseData.statusText,
        headers: responseData.headers
    });

}

/**
 * @param {object} workerOptions
 * @param {unknown} workerOptions.manifest
 * @param {CacheStorage} workerOptions.cacheStorage
 * @param {typeof fetch} workerOptions.fetchImplementation
 * @param {SubtleCrypto} workerOptions.subtleCrypto
 * @param {(binaryData: string) => string} workerOptions.base64Encode
 * @param {{addEventListener?: (name: string, listener: (eventData: any) => void) => void, skipWaiting: () => Promise<void>, clients: {claim: () => Promise<void>, matchAll: (options?: Record<string, unknown>) => Promise<readonly any[]>, openWindow?: (url: string) => Promise<any>}, registration: {showNotification: (title: string, options?: NotificationOptions) => Promise<void>}}} workerOptions.scope
 * @param {() => Promise<unknown>} [workerOptions.outboxDrain]
 * @param {string} [workerOptions.cachePrefix]
 * @param {{buildId: string, appKey: string, scope: string, development?: boolean}} [workerOptions.deployment]
 * @param {string} [workerOptions.syncTag]
 * @param {string} [workerOptions.applicationOrigin]
 * @param {IDBFactory} [workerOptions.indexedDb]
 * @param {Readonly<{action: string, method: string, enctype: string, params: Readonly<Record<string, unknown>>}>} [workerOptions.shareTarget]
 * @param {(requestData: Request) => Promise<string>} [workerOptions.shareTargetCapture]
 */
export function layerServiceWorkerRuntimeCreate(workerOptions) {
    const manifest = layerVersionManifestValidate(workerOptions.manifest);
    const cachePrefix = workerOptions.cachePrefix ?? 'layer-app';
    const syncTag = workerOptions.syncTag ?? 'layer-outbox';
    let activeCacheName = `${cachePrefix}:${manifest.appVersion}`;
    const pushReceiptsData = layerPushReceiptsCreate( workerOptions.indexedDb ?? /** @type {any} */ (workerOptions.scope).indexedDB, cachePrefix );
    let shareTargetActionUrl = /** @type {URL | null} */ (null);
    let developmentCacheBypassStatus = workerOptions.deployment?.development === true;

    if (workerOptions.shareTarget !== undefined || workerOptions.shareTargetCapture !== undefined) {
        //Requiring the generated POST contract and its storage action as one capability.
        if (workerOptions.shareTarget === undefined || workerOptions.shareTarget.method !== 'POST' ||
            typeof workerOptions.shareTarget.action !== 'string' ||
            typeof workerOptions.applicationOrigin !== 'string' ||
            typeof workerOptions.shareTargetCapture !== 'function') {
            throw new TypeError('Service Worker Share Target options are invalid.');

        }

        const applicationOrigin = new URL(workerOptions.applicationOrigin).origin;

        shareTargetActionUrl = new URL(workerOptions.shareTarget.action, applicationOrigin);

        if (shareTargetActionUrl.origin !== applicationOrigin ||
            shareTargetActionUrl.searchParams.has('layerShareId')) {
            throw new TypeError('Service Worker Share Target action is invalid.');

        }

    }

    const assetMap = new Map(manifest.assets.map(function manifestAssetIndex(assetData) {
        //Indexing verified asset metadata by same-origin path.
        return [assetData.url, assetData];

    }));

    /**
     * @param {string} assetUrl
     */
    async function assetFetchVerified(assetUrl) {
        //Resolving integrity metadata before issuing a no-cache request.
        const assetData = assetMap.get(assetUrl);

        if (assetData === undefined) {
            throw new LayerPwaError('PWA_ASSET_UNKNOWN', 'The asset is not declared in the version manifest.');

        }

        const responseData = await workerOptions.fetchImplementation(assetUrl, {
            cache: 'no-store',
            credentials: 'same-origin'
        });

        return verifiedResponseCreate(
            responseData,
            assetData.hash,
            workerOptions.subtleCrypto,
            workerOptions.base64Encode
        );

    }

    //Using isolated build caches only for generated deployments with a release descriptor
    let updateWorker = /** @type {ReturnType<typeof layerUpdateWorkerCreate> | null} */ (null);
    if (workerOptions.deployment) {
        updateWorker = layerUpdateWorkerCreate({
            ...workerOptions, manifest, assetFetchVerified,
            verifyResponse: function(/** @type {Response} */ responseData, /** @type {string} */ expectedHash){
                //Sharing the same byte-level integrity check for network and cache reuse
                return verifiedResponseCreate(responseData, expectedHash, workerOptions.subtleCrypto, workerOptions.base64Encode);

            }
        });
        activeCacheName = updateWorker.cacheName;

    }
    const runtimeData = Object.freeze({
        manifest,
        cacheName: activeCacheName,

        async install() {
            //Keeping the old adapter compatible while generated apps use build-aware installation
            if (updateWorker !== null) {
                await updateWorker.install();
                return;

            }
            await workerOptions.cacheStorage.delete(activeCacheName);
            const assetCache = await workerOptions.cacheStorage.open(activeCacheName);

            try {
                //Verifying every required response before this worker can enter waiting.
                for (const assetData of manifest.assets) {
                    const verifiedResponse = await assetFetchVerified(assetData.url);
                    await assetCache.put(assetData.url, verifiedResponse);

                }

            } catch (installError) {
                await workerOptions.cacheStorage.delete(activeCacheName);

                throw installError;

            }

        },

        async activate() {
            //Committing explicit multi-window activation before collecting obsolete build caches
            if (updateWorker !== null) {
                await updateWorker.activate();
                return;

            }
            const cacheNames = await workerOptions.cacheStorage.keys();
            const retainedCaches = new Set([
                activeCacheName
            ]);

            if (manifest.rollbackVersion !== null) {
                retainedCaches.add(`${cachePrefix}:${manifest.rollbackVersion}`);

            }

            //Deleting only Layer caches outside the active and declared rollback versions.
            await Promise.all(cacheNames.map(async function obsoleteCacheDelete(cacheName) {
                //Leaving unrelated application caches untouched.
                if (cacheName.startsWith(`${cachePrefix}:`) && !retainedCaches.has(cacheName)) {
                    await workerOptions.cacheStorage.delete(cacheName);

                }

            }));
            await workerOptions.scope.clients.claim();

        },

        /**
         * @param {Request} requestData
         * @param {(promiseData: Promise<unknown>) => void} [waitUntil]
         */
        async fetch(requestData, waitUntil) {
            if (requestData.method === 'POST' && shareTargetActionUrl !== null) {
                const requestUrl = new URL(requestData.url);
                const shareTargetRequestStatus = requestUrl.origin === shareTargetActionUrl.origin &&
                    requestUrl.pathname + requestUrl.search ===
                        shareTargetActionUrl.pathname + shareTargetActionUrl.search;

                if (shareTargetRequestStatus) {
                    try {
                        //Capturing declared shared content before redirecting to the application route.
                        const shareIdentifier = await /** @type {(requestData: Request) => Promise<string>} */ (
                            workerOptions.shareTargetCapture
                        )(requestData);
                        const redirectUrl = new URL(shareTargetActionUrl.href);

                        redirectUrl.searchParams.set('layerShareId', shareIdentifier);

                        return new Response(null, {
                            status: 303,
                            headers: {
                                'cache-control': 'no-store',
                                location: redirectUrl.href
                            }
                        });

                    } catch (shareTargetError) {
                        let shareTargetErrorCode = '';
                        let failureStatus = 400;

                        if (typeof shareTargetError === 'object' && shareTargetError !== null &&
                            'code' in shareTargetError) {
                            //Reading only the stable error code without exposing storage details.
                            shareTargetErrorCode = String(
                                /** @type {Record<string, unknown>} */ (shareTargetError).code
                            );

                        }

                        if (shareTargetErrorCode === 'SHARE_TARGET_SIZE_EXCEEDED') {
                            failureStatus = 413;

                        } else if (['SHARE_TARGET_INBOX_FULL', 'SHARE_TARGET_STORAGE_BLOCKED',
                            'SHARE_TARGET_STORAGE_FAILED'].includes(shareTargetErrorCode)) {
                            failureStatus = 503;

                        }

                        //Returning one bounded failure without leaking shared fields or storage details.
                        return new Response('Shared content could not be accepted.', {
                            status: failureStatus,
                            headers: {
                                'cache-control': 'no-store',
                                'content-type': 'text/plain; charset=utf-8'
                            }
                        });

                    }

                }

            }

            //Bypassing Cache Storage for POST API and every other non-GET request.
            if (requestData.method !== 'GET') {
                return workerOptions.fetchImplementation(requestData);

            }

            //Bypassing versioned Cache Storage only after an explicit same-origin development message.
            if (developmentCacheBypassStatus) {
                return workerOptions.fetchImplementation(requestData);

            }

            const requestUrl = new URL(requestData.url);
            const assetData = assetMap.get(requestUrl.pathname);
            if (layerLinkAssociationPathCheck(requestUrl.pathname) || layerUpdateMetadataPathCheck(requestUrl.pathname)) {
                //Leaving verification on the network without Cache Storage or shell fallback
                return workerOptions.fetchImplementation(requestData);

            }
            const assetCache = await workerOptions.cacheStorage.open(activeCacheName);

            if (assetData?.policy === 'immutable') {
                const cachedResponse = await assetCache.match(requestData);

                if (cachedResponse !== undefined) {
                    return cachedResponse;

                }

                const verifiedResponse = await assetFetchVerified(assetData.url);
                await assetCache.put(assetData.url, verifiedResponse.clone());

                return verifiedResponse;

            }

            if (requestData.mode === 'navigate') {
                try {
                    const networkResponse = await workerOptions.fetchImplementation(requestData);

                    if (networkResponse.ok) {
                        return networkResponse;

                    }

                } catch (navigationError) {
                    void navigationError;

                }

                const shellResponse = await assetCache.match(manifest.offlineShellUrl);

                if (shellResponse === undefined) {
                    throw new LayerPwaError('PWA_OFFLINE_SHELL_MISSING', 'The verified offline shell is unavailable.');

                }

                return shellResponse;

            }

            if (assetData?.policy === 'media') {
                const cachedResponse = await assetCache.match(requestData);
                const refreshPromise = workerOptions.fetchImplementation(requestData).then(async function mediaCacheRefresh(responseData) {
                    //Refreshing media only when the network returned a successful response.
                    if (responseData.ok) {
                        await assetCache.put(requestData, responseData.clone());

                    }

                    return responseData;

                });

                if (cachedResponse !== undefined) {
                    waitUntil?.(refreshPromise);

                    return cachedResponse;

                }

                return refreshPromise;

            }

            return workerOptions.fetchImplementation(requestData);

        },

        /**
         * @param {unknown} messageData
         */
        async message(messageData) {
            if (typeof messageData === 'object' && messageData !== null &&
            /** @type {Record<string, unknown>} */ (messageData).type === 'development-cache-bypass') {
                //Keeping development reloads on the network without unregistering this worker.
                developmentCacheBypassStatus = true;

                return true;

            }

            if (typeof messageData === 'object' && messageData !== null &&
            /** @type {Record<string, unknown>} */ (messageData).type === 'activate-update') {
                //Refusing the legacy uncoordinated shortcut in build-aware deployments
                if (updateWorker !== null) {
                    return false;

                }
                await workerOptions.scope.skipWaiting();

                return true;

            }

            return false;

        },

        /**
         * @param {string} tagData
         */
        async sync(tagData) {
            //Handling only the engine-owned outbox tag with an injected drain action.
            if (tagData !== syncTag || workerOptions.outboxDrain === undefined) {
                return false;

            }

            await workerOptions.outboxDrain();

            return true;

        },

        /**
         * @param {unknown} pushData
         */
        async push(pushData) {
            if (typeof pushData !== 'object' || pushData === null || Array.isArray(pushData)) {
                throw new LayerPwaError('PWA_PUSH_INVALID', 'The push payload is invalid.');

            }

            const pushRecord = /** @type {Record<string, unknown>} */ (pushData);

            if (typeof pushRecord.title !== 'string' || pushRecord.title.length < 1 || pushRecord.title.length > 160) {
                throw new LayerPwaError('PWA_PUSH_INVALID', 'The push title is invalid.');

            }

            let notificationBody = '';
            let notificationUrl = '/';

            if (typeof pushRecord.body === 'string') {
                notificationBody = pushRecord.body.slice(0, 500);

            }

            if (typeof pushRecord.url === 'string') {
                notificationUrl = pushRecord.url;

            }

            //Validating same-origin navigation and icons before displaying untrusted push data
            const applicationOriginData = new URL( workerOptions.applicationOrigin ?? 'https://localhost' ).origin;
            const targetUrlData = new URL( notificationUrl, applicationOriginData );

            if ( targetUrlData.origin !== applicationOriginData || targetUrlData.username !== '' || targetUrlData.password !== '' ){
                throw new LayerPwaError( 'PWA_NAVIGATION_DENIED', 'The notification target is outside the application origin.' );

            }

            const notificationOptionsData = /** @type {NotificationOptions} */ ({
                body: notificationBody,
                data: {
                    url: targetUrlData.href
                }
            });

            if ( typeof pushRecord.tag === 'string' ){
                notificationOptionsData.tag = pushRecord.tag.slice( 0, 128 );

            }

            if ( typeof pushRecord.icon === 'string' ){
                const iconUrlData = new URL( pushRecord.icon, applicationOriginData );

                if ( iconUrlData.origin !== applicationOriginData ){
                    throw new LayerPwaError( 'PWA_PUSH_INVALID', 'The notification icon is outside the application origin.' );

                }

                notificationOptionsData.icon = iconUrlData.href;

            }

            if ( pushRecord.badge !== undefined ){
                //Keeping status-bar artwork within the application, just like the main icon.
                if ( typeof pushRecord.badge !== 'string' ){
                    throw new LayerPwaError( 'PWA_PUSH_INVALID', 'The notification badge is invalid.' );

                }

                const badgeUrlData = new URL( pushRecord.badge, applicationOriginData );

                if ( badgeUrlData.origin !== applicationOriginData || badgeUrlData.username !== '' || badgeUrlData.password !== '' ){
                    throw new LayerPwaError( 'PWA_PUSH_INVALID', 'The notification badge is outside the application origin.' );

                }

                notificationOptionsData.badge = badgeUrlData.href;

            }

            let notificationIdData = null;

            if ( pushRecord.notificationId !== undefined ){
                if ( typeof pushRecord.notificationId !== 'string' || /^[0-9a-f-]{36}$/i.test( pushRecord.notificationId ) === false ){
                    throw new LayerPwaError( 'PWA_PUSH_INVALID', 'The notification ID is invalid.' );

                }

                notificationIdData = pushRecord.notificationId;

                //Suppressing bounded duplicate delivery across Service Worker restarts
                if ( await pushReceiptsData.claim( notificationIdData ) === false ){
                    return;

                }

            }

            try {
                await workerOptions.scope.registration.showNotification( pushRecord.title, notificationOptionsData );

            } catch( error ){
                if ( notificationIdData !== null ){
                    await pushReceiptsData.forget( notificationIdData );

                }

                throw error;

            }

        },

        /**
         * @param {string} targetUrl
         */
        async notificationOpen(targetUrl) {
            const applicationOrigin = workerOptions.applicationOrigin ?? 'https://localhost';
            const normalizedUrl = new URL(targetUrl, applicationOrigin);
            const applicationScope = workerOptions.deployment?.scope ?? '/';
            let scopePrefix = applicationScope;
            if (!scopePrefix.endsWith('/')) {
                scopePrefix += '/';

            }

            if (normalizedUrl.origin !== applicationOrigin || normalizedUrl.username !== '' || normalizedUrl.password !== '' ||
                (normalizedUrl.pathname !== applicationScope && !normalizedUrl.pathname.startsWith(scopePrefix))) {
                throw new LayerPwaError('PWA_NAVIGATION_DENIED', 'The notification target is outside the application origin.');

            }

            const clientList = await workerOptions.scope.clients.matchAll({
                type: 'window',
                includeUncontrolled: true
            });
            const matchingClient = clientList.find(function notificationClientFind(clientData) {
                //Selecting only a window within this app's declared origin and scope
                if (typeof clientData.url !== 'string') {
                    return false;

                }
                try {
                    const clientUrl = new URL(clientData.url);
                    return clientUrl.origin === applicationOrigin &&
                        (clientUrl.pathname === applicationScope || clientUrl.pathname.startsWith(scopePrefix));

                } catch (invalidClientUrl) {
                    //Skipping a stale native client descriptor without disrupting other candidates
                    void invalidClientUrl;
                    return false;

                }

            });

            if (matchingClient !== undefined && typeof matchingClient.focus === 'function') {
                await matchingClient.focus();

                //Letting the live app own routing; an acknowledgement does not bypass auth or guards
                const handled = await layerNavigationHandoff(matchingClient, {
                    url: normalizedUrl.href, appKey: workerOptions.deployment?.appKey ?? null
                });
                if (handled) {
                    return;

                }

                if (typeof matchingClient.navigate === 'function') {
                    //Retaining native navigation only for legacy, unavailable or non-app clients
                    await matchingClient.navigate(normalizedUrl.href);

                }

                return;

            }

            await workerOptions.scope.clients.openWindow?.(normalizedUrl.href);

        },

        attach() {
            const scopeData = /** @type {any} */ (workerOptions.scope);
            const applicationOrigin = new URL(
                workerOptions.applicationOrigin ?? scopeData.location?.origin ?? 'https://localhost'
            ).origin;

            scopeData.addEventListener('install', function installEventHandle(/** @type {any} */ eventData) {
                //Keeping the worker install alive through complete asset verification.
                eventData.waitUntil(runtimeData.install());

            });
            scopeData.addEventListener('activate', function activateEventHandle(/** @type {any} */ eventData) {
                //Keeping activation alive through cache cleanup and client claim.
                eventData.waitUntil(runtimeData.activate());

            });
            scopeData.addEventListener('fetch', function fetchEventHandle(/** @type {any} */ eventData) {
                const requestUrl = new URL(eventData.request.url);
                const requestOrigin = requestUrl.origin;

                //Leaving foreign-origin requests to the browser and the document security policy.
                if (requestOrigin !== applicationOrigin || layerLinkAssociationPathCheck(requestUrl.pathname) ||
                    layerUpdateMetadataPathCheck(requestUrl.pathname)) {
                    return;

                }

                const shareTargetRequestStatus = eventData.request.method === 'POST' &&
                    shareTargetActionUrl !== null &&
                    requestUrl.pathname + requestUrl.search ===
                        shareTargetActionUrl.pathname + shareTargetActionUrl.search;

                //Leaving API and development streams with the document so they cannot pin worker activation.
                if (requestUrl.pathname.startsWith('/_layer/dev/') ||
                    (eventData.request.method !== 'GET' && !shareTargetRequestStatus)) {
                    return;

                }

                //Routing the response and any background refresh through event lifetime controls.
                const responseGet = async function(){
                    //Serving this client's release before falling back to independent runtime capabilities
                    if (updateWorker !== null && !developmentCacheBypassStatus) {
                        const releaseResponse = await updateWorker.fetch(eventData.request, eventData.clientId ?? '');
                        if (releaseResponse !== null) {
                            return releaseResponse;

                        }

                    }
                    return runtimeData.fetch(eventData.request, function refreshLifetimeExtend(promiseData) {
                    //Keeping stale-while-revalidate work alive after the cached response returns.
                        eventData.waitUntil(promiseData);

                    });

                };
                eventData.respondWith(responseGet());

            });
            scopeData.addEventListener('message', function messageEventHandle(/** @type {any} */ eventData) {
                //Separating verified update RPC from older capability messages
                if (updateWorker !== null && typeof eventData.data?.type === 'string' &&
                    eventData.data.type.startsWith('layer-update-')) {
                    const updateMessage = updateWorker.message(eventData).then(function(resultData){
                        //Replying only through the caller's dedicated channel
                        eventData.ports?.[0]?.postMessage(resultData);

                    });
                    eventData.waitUntil?.(updateMessage);
                    return;

                }
                //Processing explicit worker messages and acknowledging optional development requests.
                const messagePromise = runtimeData.message(eventData.data).then(function workerMessageComplete(messageResult) {
                    //Confirming completion only to a caller that supplied a MessageChannel port.
                    eventData.ports?.[0]?.postMessage({ok: messageResult});

                    return messageResult;

                });
                eventData.waitUntil?.(messagePromise);

            });
            scopeData.addEventListener('sync', function syncEventHandle(/** @type {any} */ eventData) {
                //Extending worker lifetime through the leased outbox drain.
                eventData.waitUntil(runtimeData.sync(eventData.tag));

            });
            scopeData.addEventListener('push', function pushEventHandle(/** @type {any} */ eventData) {
                //Parsing a bounded notification envelope before displaying it.
                let pushData = {};

                try {
                    pushData = eventData.data?.json() ?? {};

                } catch (pushError) {
                    void pushError;

                }

                eventData.waitUntil(runtimeData.push(pushData));

            });
            scopeData.addEventListener('notificationclick', function notificationClickHandle(/** @type {any} */ eventData) {
                //Closing the notification before focusing or opening the application.
                eventData.notification.close();
                eventData.waitUntil(runtimeData.notificationOpen(eventData.notification.data?.url ?? '/'));

            });

        }
    });

    return runtimeData;

}
