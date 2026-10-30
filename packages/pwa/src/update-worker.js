import {LayerPwaError} from './pwa-error.js';
import {layerUpdateBuildIdCheck, layerUpdateMetadataPathCheck} from './update-protocol.js';
import {layerUpdateStoreCreate} from './update-store.js';

/** @param {any} options */
//Function for owning isolated release caches and a scope-local activation transaction
export const layerUpdateWorkerCreate = function( options ){
    //Binding public deployment identity to this registration rather than a user namespace
    const deployment = options.deployment;
    const origin = new URL(options.applicationOrigin).origin;
    const scopePath = deployment.scope;
    if (!layerUpdateBuildIdCheck(deployment.buildId) || !layerUpdateBuildIdCheck(deployment.appKey) ||
        typeof scopePath !== 'string' || !scopePath.startsWith('/') || scopePath.startsWith('//') ||
        scopePath.includes('?') || scopePath.includes('#')) {
        throw new TypeError('Worker deployment identity is invalid.');

    }
    const buildId = deployment.buildId;
    const cachePrefix = 'layer-release:' + deployment.appKey + ':';
    const cacheName = cachePrefix + buildId;
    const metadata = layerUpdateStoreCreate(options.indexedDb ?? options.scope.indexedDB, deployment.appKey);
    let snapshot = /** @type {any} */ ({phase: 'downloading', completedFiles: 0, totalFiles: options.manifest.assets.length});
    let installationTask = /** @type {Promise<void> | null} */ (null);
    let activationTask = /** @type {Promise<void> | null} */ (null);

    /** @param {string} urlData */
    const scopeContains = function( urlData ){
        //Rejecting foreign or sibling applications before sending metadata or navigating a client
        try {
            const targetUrl = new URL(urlData);
            return targetUrl.origin === origin && targetUrl.pathname.startsWith(scopePath);

        } catch (invalidClientUrl) {
            //Rejecting malformed caller metadata before publishing or navigating anything
            void invalidClientUrl;
            return false;

        }

    };
    const clientsGet = async function(){
        //Looking up live clients afresh; a sleeping worker never owns a permanent tab list
        const clients = await options.scope.clients.matchAll({type: 'window', includeUncontrolled: true});
        return clients.filter(function(/** @type {any} */ clientData){
            //Restricting every broadcast and activation request to the application scope
            return typeof clientData.url === 'string' && scopeContains(clientData.url);

        });

    };
    /** @param {any} nextSnapshot */
    const publish = async function( nextSnapshot ){
        //Retaining a queryable snapshot before independent clients receive progress
        snapshot = {...nextSnapshot};
        const clients = await clientsGet();
        for (const clientData of clients) {
            try {
                //Sending bounded counters, never arbitrary exception text or private payloads
                clientData.postMessage({type: 'layer-update-status', appKey: deployment.appKey, buildId, ...snapshot});

            } catch (deliveryError) {
                //Tolerating a tab closing between enumeration and delivery
                void deliveryError;

            }

        }

    };
    const snapshotGet = async function(){
        //Recovering readiness after the browser has stopped and restarted a waiting worker
        const record = await metadata.get(buildId);
        if (record?.complete === true) {
            return {...snapshot, phase: 'ready', completedFiles: options.manifest.assets.length,
                totalFiles: options.manifest.assets.length};

        }
        return {...snapshot};

    };
    const assetsAssert = async function(){
        //Refusing activation after cache eviction even when a prior completion marker exists
        const cache = await options.cacheStorage.open(cacheName);
        for (const asset of options.manifest.assets) {
            const response = await cache.match(asset.url);
            if (!response) {
                throw new LayerPwaError('PWA_UPDATE_NOT_READY', 'Prepared update resources are missing.', {retryable: true});

            }
            //Rechecking integrity immediately before a force or normal activation
            await options.verifyResponse(response, asset.hash);

        }

    };
    const installRun = async function(){
        //Leaving an already committed installation intact, including a currently active identical build
        const existing = await metadata.get(buildId);
        if (existing?.complete === true) {
            try {
                await assetsAssert();
                await publish({phase: 'ready', completedFiles: options.manifest.assets.length,
                    totalFiles: options.manifest.assets.length});
                return;

            } catch (evictedCacheError) {
                //Repairing verified resources in place without deleting a potentially active cache
                void evictedCacheError;

            }

        }
        const head = await metadata.get('head');
        const previous = await metadata.get(head?.buildId ?? '');
        const cache = await options.cacheStorage.open(cacheName);
        try {
            //Preparing a separate cache before publishing any activation-ready marker
            await publish({phase: 'downloading', completedFiles: 0, totalFiles: options.manifest.assets.length});
            for (const asset of options.manifest.assets) {
                let response = null;
                const previousAsset = previous?.manifest?.assets.find(function(/** @type {any} */ candidate){
                    //Reusing only a matching public resource, never a stale URL alone
                    return candidate.url === asset.url && candidate.hash === asset.hash;

                });
                if (previousAsset) {
                    const previousCache = await options.cacheStorage.open(previous.cacheName);
                    const candidate = await previousCache.match(asset.url);
                    if (candidate) {
                        try {
                            //Rechecking integrity before copying a resource from an older cache
                            response = await options.verifyResponse(candidate, asset.hash);

                        } catch (reuseError) {
                            //Fetching a fresh verified copy instead of trusting damaged local content
                            void reuseError;

                        }

                    }

                }
                if (response === null) {
                    response = await options.assetFetchVerified(asset.url);

                }
                await cache.put(asset.url, response);
                await publish({phase: 'downloading', completedFiles: snapshot.completedFiles + 1,
                    totalFiles: options.manifest.assets.length});

            }
            await publish({...snapshot, phase: 'verifying'});
            await assetsAssert();
            await metadata.put(buildId, {buildId, cacheName, manifest: options.manifest, complete: true});
            await publish({...snapshot, phase: 'ready'});

        } catch (installationError) {
            //Deleting only this uncommitted build; active and rollback releases are independent
            if (existing?.complete !== true) {
                await options.cacheStorage.delete(cacheName);

            }
            await publish({...snapshot, phase: 'error', code: 'PWA_UPDATE_PREPARATION_FAILED'});
            throw installationError;

        }

    };
    /** @param {any} clientData @param {boolean} forceStatus */
    const clientPrepare = function( clientData, forceStatus ){
        //Using a dedicated port so another tab cannot acknowledge this client's save hook
        return new Promise(function(resolve){
            const channel = new MessageChannel();
            let finished = false;
            const finish = function(/** @type {boolean} */ readyStatus){
                //Settling timeout, closure or response exactly once
                if (finished) {
                    return;

                }
                finished = true;
                clearTimeout(timer);
                channel.port1.close();
                channel.port2.close();
                resolve(readyStatus);

            };
            const timer = setTimeout(function(){
                //Treating a suspended legacy window as unconfirmed rather than silently ready
                finish(false);

            }, options.preparationTimeoutMs ?? 15000);
            channel.port1.onmessage = function(eventData){
                //Accepting only an acknowledgement for the exact target build
                finish(eventData.data?.buildId === buildId && eventData.data?.ready === true);

            };
            try {
                clientData.postMessage({type: 'layer-update-prepare', buildId, appKey: deployment.appKey,
                    force: forceStatus}, [channel.port2]);

            } catch (closedClientError) {
                //Failing the vote safely when a client disappeared
                void closedClientError;
                finish(false);

            }

        });

    };
    /** @param {boolean} forceStatus */
    const activationPrepare = async function( forceStatus ){
        //Checking durable preparation before asking any client to save its application state
        const record = await metadata.get(buildId);
        if (record?.complete !== true) {
            throw new LayerPwaError('PWA_UPDATE_NOT_READY', 'The update has not finished preparation.');

        }
        await assetsAssert();
        const clients = await clientsGet();
        const votes = await Promise.all(clients.map(function(/** @type {any} */ clientData){
            //Running independent save hooks concurrently within one bounded preparation window
            return clientPrepare(clientData, forceStatus);

        }));
        if (!forceStatus && votes.some(function(readyStatus){
            //Rejecting any unconfirmed application window
            return readyStatus !== true;

        })) {
            throw new LayerPwaError('PWA_UPDATE_CLIENTS_BUSY', 'Other application windows have not confirmed saving.');

        }
        //Persisting the explicit activation intent across a waiting-worker restart
        await metadata.put('activation:' + buildId, {clients: clients.map(function(/** @type {any} */ clientData){
            //Keeping only this application's original URLs for the committed reload
            return {id: clientData.id, url: clientData.url};

        }), force: forceStatus});
        await options.scope.skipWaiting();

    };
    const activate = async function(){
        //Recording the previous complete release before taking control of any document
        const oldHead = await metadata.get('head');
        await assetsAssert();
        await metadata.put('head', {buildId, previousBuildId: oldHead?.buildId ?? null});
        await options.scope.clients.claim();
        const intent = await metadata.get('activation:' + buildId);
        if (intent && Array.isArray(intent.clients)) {
            //Clearing intent first so an interrupted restart cannot loop document navigation
            await metadata.put('activation:' + buildId, null);
            const clients = await clientsGet();
            for (const clientData of clients) {
                const original = intent.clients.find(function(/** @type {any} */ entry){
                    //Reloading only the windows that participated in this activation
                    return entry.id === clientData.id && scopeContains(entry.url);

                });
                if (original && typeof clientData.navigate === 'function') {
                    try {
                        //Preserving pathname, query and fragment in each native document replacement
                        //A changed query forces a document navigation even when the original URL contains a fragment
                        const originalUrl = new URL(original.url);
                        let separator = '?';
                        if (originalUrl.search !== '') {
                            separator = '&';

                        }
                        const reloadUrl = originalUrl.origin + originalUrl.pathname + originalUrl.search + separator +
                            '__layer_update_build=' + buildId + originalUrl.hash;
                        //Not awaiting a navigation that itself waits for this activate event to finish
                        void clientData.navigate(reloadUrl).catch(function(/** @type {unknown} */ closedWindowError){
                            //The native navigation has been dispatched; a concurrently closed window may reject
                            void closedWindowError;

                        });

                    } catch (navigationError) {
                        //Allowing a client that closed concurrently to disappear harmlessly
                        void navigationError;

                    }

                }

            }

        }
        //Keeping rollback and live-client caches, never touching legacy or user-owned cache namespaces
        const retained = new Set([cacheName, cachePrefix + (oldHead?.buildId ?? '')]);
        for (const clientData of await clientsGet()) {
            const clientRecord = await metadata.get('client:' + clientData.id);
            if (layerUpdateBuildIdCheck(clientRecord?.buildId)) {
                retained.add(cachePrefix + clientRecord.buildId);

            }

        }
        for (const candidateName of await options.cacheStorage.keys()) {
            if (candidateName.startsWith(cachePrefix) && !retained.has(candidateName)) {
                await options.cacheStorage.delete(candidateName);

            }

        }

    };
    /** @param {any} eventData */
    const message = async function( eventData ){
        //Requiring a real scoped WindowClient and an exact public request shape
        const source = eventData.source;
        const data = eventData.data;
        if (!source || typeof source.id !== 'string' || typeof source.url !== 'string' ||
            !scopeContains(source.url) || !data || typeof data !== 'object' || Array.isArray(data) ||
            data.appKey !== deployment.appKey || !['layer-update-snapshot', 'layer-update-activate'].includes(data.type) ||
            Object.keys(data).some(function(fieldName){
                //Rejecting arbitrary forwarded state and unknown instructions
                return !['type', 'appKey', 'buildId', 'currentBuildId', 'force'].includes(fieldName);

            })) {
            return {ok: false, code: 'PWA_UPDATE_MESSAGE_INVALID'};

        }
        try {
            if (layerUpdateBuildIdCheck(data.currentBuildId)) {
                await metadata.put('client:' + source.id, {buildId: data.currentBuildId});

            }
            if (data.type === 'layer-update-snapshot') {
                return {ok: true, appKey: deployment.appKey, buildId, ...(await snapshotGet())};

            }
            if (data.buildId !== buildId || typeof data.force !== 'boolean') {
                return {ok: false, code: 'PWA_UPDATE_MESSAGE_INVALID'};

            }
            if (activationTask === null) {
                //Deduplicating concurrent apply buttons across clients
                activationTask = activationPrepare(data.force);

            }
            await activationTask;
            return {ok: true, appKey: deployment.appKey, buildId};

        } catch (activationError) {
            activationTask = null;
            let code = 'PWA_UPDATE_PREPARATION_FAILED';
            if (activationError instanceof LayerPwaError) {
                code = activationError.code;

            }
            return {ok: false, code};

        }

    };
    /** @param {Request} requestData @param {string} clientId */
    const fetch = async function( requestData, clientId ){
        //Returning null only when the existing runtime should handle a non-release resource
        const urlData = new URL(requestData.url);
        if (requestData.method !== 'GET' || layerUpdateMetadataPathCheck(urlData.pathname)) {
            return null;

        }
        let record = {cacheName, manifest: options.manifest};
        const clientRecord = await metadata.get('client:' + clientId);
        const explicitReload = requestData.mode === 'navigate' &&
            urlData.search.endsWith('__layer_update_build=' + buildId);
        if (!explicitReload && layerUpdateBuildIdCheck(clientRecord?.buildId) && clientRecord.buildId !== buildId) {
            const previous = await metadata.get(clientRecord.buildId);
            if (previous?.complete === true) {
                record = previous;

            }

        }
        const cache = await options.cacheStorage.open(record.cacheName);
        const asset = record.manifest.assets.find(function(/** @type {any} */ candidate){
            //Matching immutable resource URLs independently of incidental query strings
            return candidate.url === urlData.pathname;

        });
        if (asset) {
            return (await cache.match(asset.url)) ?? null;

        }
        if (requestData.mode === 'navigate' && scopeContains(urlData.href)) {
            //Pinning document and runtime to the same release while a new worker is waiting
            let documentPath = urlData.pathname;
            if (documentPath.endsWith('/')) {
                documentPath += 'index.html';

            }
            const routeDocument = await cache.match(documentPath);
            return routeDocument ?? (await cache.match(record.manifest.offlineShellUrl)) ?? null;

        }
        return null;

    };
    //CallBack THE OBJECT
    return Object.freeze({cacheName, message, fetch, activate, install: function(){
        //Sharing one installation task without ever deleting an already completed same-build cache
        installationTask ??= installRun();
        return installationTask;

    }});

};
