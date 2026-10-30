import {LayerPwaError} from './pwa-error.js';
import {layerVersionCompare, layerVersionManifestValidate} from './version-manifest.js';
import {layerUpdateBuildIdCheck, layerUpdateDescriptorValidate, layerUpdateIntegrityCreate,
    layerUpdatesConfigurationCreate} from './update-protocol.js';

/**
 * @typedef {'idle'|'checking'|'downloading'|'verifying'|'ready'|'preparing'|'activating'|'blocked'|'error'|'unsupported'} LayerUpdatePhase
 * @typedef {Readonly<{
 * updateAvailable: boolean, criticalUpdate: boolean, currentVersion: string, availableVersion: string,
 * waiting: boolean, currentBuildId: string, availableBuildId: string|null, phase: LayerUpdatePhase,
 * progress: Readonly<{completedFiles: number, totalFiles: number}>|null,
 * visible: boolean, error: Readonly<{code: string, retryable: boolean}>|null
 * }>} LayerApplicationUpdateState
 * @typedef {object} LayerApplicationUpdatesOptions
 * @property {Window} window
 * @property {ServiceWorkerRegistration} registration
 * @property {string} currentVersion
 * @property {string} currentBuildId
 * @property {string} appKey
 * @property {unknown} [configuration]
 * @property {(data: {buildId: string, force: boolean}) => unknown} [beforeUpdate]
 * @property {() => Promise<void>} localStateSave
 * @property {(error: unknown) => void} [onError]
 * @property {typeof fetch} [fetchImplementation]
 * @property {number} [rpcTimeoutMs]
 */

/** @param {LayerApplicationUpdatesOptions} options */
//Function for presenting one observable update lifecycle without forcing document replacement
export const layerApplicationUpdatesCreate = function( options ){
    //Keeping subscription, timer and worker ownership inside the application lifetime
    const browserWindow = options.window;
    const document = browserWindow.document;
    const container = browserWindow.navigator.serviceWorker;
    const registration = options.registration;
    const configuration = layerUpdatesConfigurationCreate(options.configuration);
    const fetchImplementation = options.fetchImplementation ?? browserWindow.fetch.bind(browserWindow);
    const listeners = new Set();
    const workerListeners = new Map();
    const dismissedBuilds = new Set();
    const pendingRequests = new Set();
    const networkAbort = new AbortController();
    let disposed = false;
    let started = false;
    let lastAutomaticCheck = -Infinity;
    let checkTask = /** @type {Promise<LayerApplicationUpdateState> | null} */ (null);
    let activationTask = /** @type {Promise<void> | null} */ (null);
    let expectedBuildId = /** @type {string | null} */ (null);
    let interval = /** @type {ReturnType<typeof setInterval> | null} */ (null);
    let state = /** @type {LayerApplicationUpdateState} */ (Object.freeze({
        updateAvailable: false, criticalUpdate: false, currentVersion: options.currentVersion,
        availableVersion: options.currentVersion, waiting: false, currentBuildId: options.currentBuildId,
        availableBuildId: null, phase: 'idle', progress: null, visible: false, error: null
    }));
    const report = function(/** @type {unknown} */ errorData){
        //Containing a broken application diagnostic hook without leaking its exception
        try {
            options.onError?.(errorData);

        } catch (diagnosticError) {
            void diagnosticError;
            console.warn('Layer update diagnostic failed: PWA_UPDATE_CALLBACK_FAILED.');

        }

    };
    const notify = function(/** @type {(state: LayerApplicationUpdateState) => void} */ listener){
        //Delivering subscriber failures independently from cache preparation
        try {
            listener(state);

        } catch (listenerError) {
            report(listenerError);

        }

    };
    const publish = function(/** @type {Partial<LayerApplicationUpdateState>} */ patch){
        //Freezing every public nested value so consumers cannot mutate shared lifecycle state
        state = Object.freeze({...state, ...patch});
        for (const listener of listeners) {
            notify(listener);

        }

    };
    const visibilityGet = function(/** @type {string} */ buildId){
        //Suppressing first-install preparation and a dismissed proposal for this document lifetime
        return buildId !== options.currentBuildId && !dismissedBuilds.has(buildId);

    };
    /** @param {ServiceWorker} worker @param {Record<string, unknown>} requestData */
    const request = function( worker, requestData ){
        //Binding one reply to a dedicated channel rather than a global message callback
        return new Promise(function(resolve, rejected){
            const channel = new MessageChannel();
            let finished = false;
            const cleanup = function(){
                //Removing the channel after a successful reply, timeout or disposal
                finished = true;
                clearTimeout(timer);
                channel.port1.close();
                channel.port2.close();
                pendingRequests.delete(cancel);

            };
            const cancel = function(){
                //Ending an outstanding RPC when the owning application is disposed
                cleanup();
                rejected(new TypeError('Updates controller is disposed.'));

            };
            pendingRequests.add(cancel);
            const timer = setTimeout(function(){
                //Mapping an unavailable worker to one retryable public category
                cleanup();
                rejected(new LayerPwaError('PWA_UPDATE_TIMEOUT', 'The update worker did not respond.', {retryable: true}));

            }, options.rpcTimeoutMs ?? 20000);
            channel.port1.onmessage = function(eventData){
                //Validating identity before using a bounded worker reply
                if (finished) {
                    return;

                }
                const response = eventData.data;
                cleanup();
                if (disposed || !response || response.ok !== true) {
                    let code = 'PWA_UPDATE_MESSAGE_INVALID';
                    if (response?.code === 'PWA_UPDATE_CLIENTS_BUSY' || response?.code === 'PWA_UPDATE_NOT_READY') {
                        code = response.code;

                    }
                    rejected(new LayerPwaError(code, 'The application update could not be applied.', {retryable: true}));
                    return;

                }
                if (response.appKey !== options.appKey || !layerUpdateBuildIdCheck(response.buildId)) {
                    rejected(new LayerPwaError('PWA_UPDATE_MESSAGE_INVALID', 'The update reply is invalid.'));
                    return;

                }
                resolve(response);

            };
            try {
                worker.postMessage({...requestData, appKey: options.appKey, currentBuildId: options.currentBuildId}, [channel.port2]);

            } catch (requestError) {
                cleanup();
                rejected(requestError);

            }

        });

    };
    const trustedWorkerCheck = function(/** @type {unknown} */ worker){
        //Accepting only native handles belonging to this registration
        return worker !== null && [registration.active, registration.installing, registration.waiting].includes(/** @type {ServiceWorker} */ (worker));

    };
    const statusReceive = function(/** @type {any} */ data, /** @type {ServiceWorker} */ worker){
        //Rejecting malformed counts or unrelated release messages before exposing them to UI
        if (disposed || !configuration.enabled || data?.appKey !== options.appKey ||
            !layerUpdateBuildIdCheck(data?.buildId) ||
            !['downloading', 'verifying', 'ready', 'error'].includes(data.phase) ||
            !Number.isInteger(data.completedFiles) || !Number.isInteger(data.totalFiles) ||
            data.totalFiles < 1 || data.totalFiles > 10000 || data.completedFiles < 0 ||
            data.completedFiles > data.totalFiles || data.buildId === options.currentBuildId ||
            (expectedBuildId !== null && data.buildId !== expectedBuildId)) {
            return;

        }
        let phase = /** @type {LayerUpdatePhase} */ (data.phase);
        const waiting = worker === registration.waiting && worker.state === 'installed';
        if (phase === 'ready' && !waiting) {
            //Waiting for native installation completion, not just the final cache.put
            phase = 'verifying';

        }
        let error = null;
        if (phase === 'error') {
            error = Object.freeze({code: 'PWA_UPDATE_PREPARATION_FAILED', retryable: true});

        }
        publish({phase, updateAvailable: true, availableBuildId: data.buildId, waiting,
            progress: Object.freeze({completedFiles: data.completedFiles, totalFiles: data.totalFiles}),
            visible: visibilityGet(data.buildId), error});

    };
    const workerObserve = function(/** @type {ServiceWorker | null} */ worker){
        //Installing one native listener per worker, including already waiting updates
        if (!worker || workerListeners.has(worker)) {
            return;

        }
        const inspect = function(){
            //Querying snapshots recovers events emitted before application subscription
            if (disposed || !configuration.enabled || worker.state === 'redundant') {
                if (!disposed && worker.state === 'redundant' && state.visible && !state.waiting) {
                    publish({phase: 'error', error: Object.freeze({code: 'PWA_UPDATE_PREPARATION_FAILED', retryable: true})});

                }
                return;

            }
            void request(worker, {type: 'layer-update-snapshot'}).then(function(data){
                //Using only this registration's current worker state
                statusReceive(data, worker);

            }).catch(function(snapshotError){
                //Keeping legacy workers without snapshot support from producing an unhandled rejection
                if (!disposed) {
                    report(snapshotError);

                }

            });

        };
        worker.addEventListener('statechange', inspect);
        workerListeners.set(worker, inspect);
        inspect();

    };
    const updateFound = function(){
        //Beginning observation without exposing a discovery notification
        workerObserve(registration.installing);

    };
    const messageHandle = function(/** @type {MessageEvent} */ eventData){
        //Native worker identity and appKey must both match before receiving any instruction
        if (!trustedWorkerCheck(eventData.source) || eventData.data?.appKey !== options.appKey) {
            return;

        }
        const data = eventData.data;
        if (data.type === 'layer-update-status') {
            statusReceive(data, /** @type {ServiceWorker} */ (eventData.source));
            return;

        }
        if (data.type !== 'layer-update-prepare' || !layerUpdateBuildIdCheck(data.buildId) ||
            typeof data.force !== 'boolean' || !eventData.ports[0]) {
            return;

        }
        const replyPort = eventData.ports[0];
        const prepare = async function(){
            //Saving application-owned drafts and then the engine's existing durable outbox metadata
            let ready = false;
            try {
                const hookResult = await options.beforeUpdate?.({buildId: data.buildId, force: data.force});
                if (hookResult !== false) {
                    await options.localStateSave();
                    ready = true;

                }

            } catch (saveError) {
                report(saveError);

            }
            replyPort.postMessage({buildId: data.buildId, ready});
            replyPort.close();

        };
        void prepare().catch(report);

    };
    const checkRun = async function(){
        //Leaving disabled updates and offline background checks silent
        if (!configuration.enabled || !container) {
            publish({phase: 'unsupported', visible: false});
            return state;

        }
        const previousPhase = state.phase;
        if (!state.visible) {
            publish({phase: 'checking'});

        }
        try {
            const descriptorResponse = await fetchImplementation('/_layer/update.json', {cache: 'no-store', credentials: 'same-origin',
                signal: networkAbort.signal});
            if (!descriptorResponse.ok) {
                throw new LayerPwaError('PWA_UPDATE_DESCRIPTOR_UNAVAILABLE', 'Update metadata is unavailable.', {retryable: true});

            }
            const descriptorText = await descriptorResponse.text();
            if (descriptorText.length > 4096) {
                throw new LayerPwaError('PWA_UPDATE_DESCRIPTOR_INVALID', 'Update metadata exceeds its limit.');

            }
            const descriptor = layerUpdateDescriptorValidate(JSON.parse(descriptorText));
            const manifestResponse = await fetchImplementation('/_layer/version.json', {cache: 'no-store', credentials: 'same-origin',
                signal: networkAbort.signal});
            if (!manifestResponse.ok) {
                throw new LayerPwaError('PWA_UPDATE_CHECK_FAILED', 'Version metadata is unavailable.', {retryable: true});

            }
            const manifestBytes = await manifestResponse.arrayBuffer();
            if (manifestBytes.byteLength > 4 * 1024 * 1024) {
                throw new LayerPwaError('PWA_MANIFEST_INVALID', 'Version metadata exceeds its limit.');

            }
            const actualHash = await layerUpdateIntegrityCreate(manifestBytes, browserWindow.crypto.subtle, browserWindow.btoa.bind(browserWindow));
            if (actualHash !== descriptor.versionManifestHash) {
                throw new LayerPwaError('PWA_UPDATE_DEPLOYMENT_MISMATCH', 'Deployment metadata does not match.', {retryable: true});

            }
            const manifest = layerVersionManifestValidate(JSON.parse(new TextDecoder().decode(manifestBytes)));
            if (manifest.protocolMin > 1 || manifest.protocolMax < 1) {
                throw new LayerPwaError('PWA_PROTOCOL_INCOMPATIBLE', 'The update protocol is incompatible.');

            }
            expectedBuildId = descriptor.buildId;
            const updateAvailable = descriptor.buildId !== options.currentBuildId;
            const criticalUpdate = manifest.minVersion !== null && layerVersionCompare(options.currentVersion, manifest.minVersion) < 0;
            publish({updateAvailable, criticalUpdate, availableVersion: manifest.appVersion,
                availableBuildId: descriptor.buildId, error: null});
            if (updateAvailable) {
                await registration.update();
                workerObserve(registration.installing);
                workerObserve(registration.waiting);
                if (registration.waiting) {
                    const response = await request(registration.waiting, {type: 'layer-update-snapshot'});
                    statusReceive(response, registration.waiting);

                }

            } else {
                publish({phase: 'idle', visible: false, waiting: false, progress: null});

            }
            return state;

        } catch (checkError) {
            let code = 'PWA_UPDATE_CHECK_FAILED';
            if (checkError instanceof LayerPwaError) {
                code = checkError.code;

            }
            let phase = previousPhase;
            if (state.visible) {
                phase = 'error';

            } else if (phase === 'checking') {
                phase = 'idle';

            }
            publish({phase, error: Object.freeze({code, retryable: true})});
            throw checkError;

        }

    };
    const check = function(){
        //Sharing overlapping manual and automatic checks without duplicate update jobs
        if (disposed) {
            return Promise.reject(new TypeError('Updates controller is disposed.'));

        }
        if (checkTask === null) {
            checkTask = checkRun().finally(function(){
                //Allowing a later explicit retry after either success or failure
                checkTask = null;

            });

        }
        return checkTask;

    };
    const automaticCheck = function(){
        //Avoiding timers and network work while a document is hidden or offline
        if (disposed || !configuration.enabled || document.visibilityState === 'hidden' ||
            browserWindow.navigator.onLine === false || Date.now() - lastAutomaticCheck < 60000) {
            return;

        }
        lastAutomaticCheck = Date.now();
        void check().catch(report);

    };
    const activate = function(/** @type {{force?: boolean}} */ activationOptions = {}){
        //Refusing unknown apply flags before any cross-window side effect
        if (!activationOptions || typeof activationOptions !== 'object' ||
            Object.keys(activationOptions).some(function(fieldName){
                //Keeping force as an explicit trusted application decision
                return fieldName !== 'force';

            }) || (activationOptions.force !== undefined && typeof activationOptions.force !== 'boolean')) {
            return Promise.reject(new TypeError('Update activation options are invalid.'));

        }
        if (activationTask !== null) {
            return activationTask;

        }
        const run = async function(){
            //Revalidating availability and compatibility even when called directly by application code
            await check();
            const worker = registration.waiting;
            if (!worker || !state.waiting || !expectedBuildId) {
                throw new LayerPwaError('PWA_UPDATE_NOT_READY', 'No prepared update is waiting.');

            }
            publish({phase: 'preparing', visible: true, error: null});
            try {
                await request(worker, {type: 'layer-update-activate', buildId: expectedBuildId,
                    force: activationOptions.force === true});
                publish({phase: 'activating'});

            } catch (activationError) {
                let code = 'PWA_UPDATE_PREPARATION_FAILED';
                if (activationError instanceof LayerPwaError) {
                    code = activationError.code;

                }
                let phase = /** @type {LayerUpdatePhase} */ ('error');
                if (code === 'PWA_UPDATE_CLIENTS_BUSY') {
                    phase = 'blocked';

                }
                publish({phase, visible: true, error: Object.freeze({code, retryable: true})});
                throw activationError;

            }

        };
        activationTask = run().finally(function(){
            //Allowing the explicit force confirmation after a blocked preparation
            activationTask = null;

        });
        return activationTask;

    };
    //CallBack THE OBJECT
    return Object.freeze({
        check, activate,
        getState: function(){
            //Reading immutable state without triggering network traffic
            return state;

        },
        subscribe: function(/** @type {(state: LayerApplicationUpdateState) => void} */ listener){
            //Delivering an immediate snapshot and a lifecycle-safe unsubscription handle
            if (disposed || typeof listener !== 'function') {
                throw new TypeError('A live update subscription requires a listener.');

            }
            listeners.add(listener);
            notify(listener);
            return function(){
                //Removing only this subscriber
                listeners.delete(listener);

            };

        },
        dismiss: function(){
            //Remembering dismissal only for this document, not the next full application launch
            if (state.availableBuildId !== null) {
                dismissedBuilds.add(state.availableBuildId);

            }
            publish({visible: false});

        },
        show: function(){
            //Reopening only meaningful update state rather than creating an empty panel
            if (state.updateAvailable && state.availableBuildId && (state.progress !== null || state.waiting)) {
                dismissedBuilds.delete(state.availableBuildId);
                publish({visible: true});

            }

        },
        start: function(){
            //Attaching listeners once after the generated host and app hooks are ready
            if (started || disposed) {
                return;

            }
            started = true;
            registration.addEventListener('updatefound', updateFound);
            container?.addEventListener('message', messageHandle);
            workerObserve(registration.active);
            workerObserve(registration.waiting);
            workerObserve(registration.installing);
            document.addEventListener('visibilitychange', automaticCheck);
            browserWindow.addEventListener('online', automaticCheck);
            if (configuration.enabled) {
                interval = setInterval(automaticCheck, configuration.checkIntervalMs);
                automaticCheck();

            }
            //Only explicit activation can navigate; the worker consumes its durable reload intent once.

        },
        dispose: function(){
            //Releasing subscriptions, interval and native listeners without unregistering the worker
            if (disposed) {
                return false;

            }
            disposed = true;
            networkAbort.abort();
            for (const cancel of pendingRequests) {
                cancel();

            }
            if (interval !== null) {
                clearInterval(interval);

            }
            registration.removeEventListener('updatefound', updateFound);
            container?.removeEventListener('message', messageHandle);
            document.removeEventListener('visibilitychange', automaticCheck);
            browserWindow.removeEventListener('online', automaticCheck);
            for (const [worker, handler] of workerListeners) {
                worker.removeEventListener('statechange', handler);

            }
            workerListeners.clear();
            listeners.clear();
            return true;

        }
    });

};
