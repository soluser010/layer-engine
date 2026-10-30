import {stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild-wasm';
import {LayerCliError} from './cli-error.js';

const layerPwaEntryFile = fileURLToPath(import.meta.resolve('@solcorp/layer-pwa'));
const layerAuthBrowserEntryFile = fileURLToPath(import.meta.resolve('@solcorp/layer-auth/browser'));
const layerRouterEntryFile = fileURLToPath(import.meta.resolve('@solcorp/layer-router'));
const layerRuntimeEntryFile = fileURLToPath(import.meta.resolve('@solcorp/layer-runtime'));
const layerStorageEntryFile = fileURLToPath(import.meta.resolve('@solcorp/layer-storage'));

/**
 * @param {string} rootDirectory
 * @param {string} fileData
 */
function relativeFileNormalize(rootDirectory, fileData) {
    //Normalizing generated artifact paths independently from the host platform.
    return path.relative(rootDirectory, fileData).replaceAll('\\', '/');

}

/**
 * @param {string} sourceDirectory
 * @param {string} absoluteFile
 */
function sourceFileBoundaryCheck(sourceDirectory, absoluteFile) {
    const relativeFile = path.relative(sourceDirectory, absoluteFile);

    //Confining developer-owned relative imports to the configured source tree.
    if (relativeFile === '' || relativeFile.startsWith('..') || path.isAbsolute(relativeFile)) {
        throw new LayerCliError(
            'CLI_BUILD_IMPORT_DENIED',
            'An application entry import must stay inside the configured source directory.'
        );

    }

}

/**
 * @param {readonly Readonly<Record<string, unknown>>[]} routeRecords
 * @param {readonly Readonly<Record<string, unknown>>[]} layoutRecords
 * @param {string} appName
 * @param {string} appVersion
 * @param {boolean} authEnabled
 * @param {Readonly<Record<string, unknown>>} webAppManifest
 * @param {Readonly<Record<string, any>>} linksConfiguration
 * @param {Readonly<Record<string, any>>} updatesConfiguration
 */
function applicationModuleSourceCreate(routeRecords, layoutRecords, appName, appVersion, authEnabled, webAppManifest, linksConfiguration, updatesConfiguration) {
    //Serializing only the validated public route records into the browser bootstrap.
    const serializedRoutes = JSON.stringify(routeRecords);
    const serializedLayouts = JSON.stringify(layoutRecords);
    const applicationIdentifier = JSON.stringify(appName);
    const applicationVersion = JSON.stringify(appVersion);
    const serializedLinks = JSON.stringify(linksConfiguration);
    const serializedScope = JSON.stringify(webAppManifest.scope ?? '/');
    const shareTargetStatus = typeof webAppManifest.share_target === 'object' &&
    webAppManifest.share_target !== null &&
    /** @type {Record<string, unknown>} */ (webAppManifest.share_target).method === 'POST';

    return `
import {
    layerRouteManifestCreate,
    layerRouteMetadataDocumentCreate,
    layerRouterCreate
} from '@solcorp/layer-router';
import {
    layerPwaCapabilitiesCreate,
    layerServiceWorkerRegister,
    layerApplicationUpdatesCreate,
    layerUpdateCardCreate
} from '@solcorp/layer-pwa';
import {
    LayerRuntimeError,
    layerApiClientCreate,
    layerApplicationApiCreate,
    layerCommandRuntimeCreate,
    layerEventRuntimeCreate,
    layerEventSubscriptionsCreate,
    layerMultiTabEventsCreate,
    layerPostEventStreamCreate,
    layerViewportCreate,
    layerLinksCreate
} from '@solcorp/layer-runtime';
import {
    layerOfflineOutboxCreate,
    layerShareTargetInboxCreate,
    layerStorageOpen,
    layerStorageSchemaDefine,
    layerWorkerOutboxConfigurationClear,
    layerWorkerOutboxConfigure
} from '@solcorp/layer-storage';
import {layerAuthBrowserCreate} from '@solcorp/layer-auth/browser';
import * as applicationModule from 'layer-application-entry';

const applicationIdentifier = ${applicationIdentifier};
const applicationVersion = ${applicationVersion};
const applicationBuildId = '__LAYER_UPDATE_BUILD_ID__';
//Removing only the final engine-owned reload marker, preserving the original query bytes and fragment.
const updateReloadMarker = '__layer_update_build=' + applicationBuildId;
if (location.search.endsWith(updateReloadMarker)) {
    const queryPrefix = location.search.slice(0, -updateReloadMarker.length);
    if (queryPrefix === '?' || queryPrefix.endsWith('&')) {
        history.replaceState(history.state, '', location.pathname + queryPrefix.slice(0, -1) + location.hash);

    }

}
const applicationWebManifest = ${JSON.stringify(webAppManifest)};
const updatesConfiguration = ${JSON.stringify(updatesConfiguration)};
const layerAuthEnabled = ${JSON.stringify(authEnabled)};
const shareTargetEnabled = ${JSON.stringify(shareTargetStatus)};
const routeAssets = ${serializedRoutes};
const layoutAssets = ${serializedLayouts};
const routeAssetById = new Map(routeAssets.map((routeData) => [routeData.id, routeData]));
const linksConfiguration = ${serializedLinks};
const applicationScope = ${serializedScope};
const navigationBootstrap = globalThis[Symbol.for('layer.navigation.bootstrap')] ?? null;
const layoutAssetByName = new Map(layoutAssets.map((layoutData) => [layoutData.name, layoutData]));
const routeManifest = layerRouteManifestCreate(routeAssets.map((routeData) => ({
    file: routeData.file,
    route: {
        render: routeData.render,
        layout: routeData.layout,
        auth: routeData.auth,
        permissions: routeData.permissions,
        preload: routeData.preload,
        guard: routeData.guard,
        offline: routeData.offline,
        cache: routeData.cache,
        metadata: routeData.metadata
    }
})));
const rootNode = document.querySelector('[data-layer-root]');

if (!(rootNode instanceof Element)) {
    throw new TypeError('The application shell must contain one [data-layer-root] element.');
}

//Disabling browser-owned restoration so every completed Layer render owns its viewport position.
const historyScrollRestorationBaseline = history.scrollRestoration;
history.scrollRestoration = 'manual';

//Creating one document-owned viewport authority before any component mounts.
const applicationViewport = layerViewportCreate({root: rootNode, window});

let activePageController = null;
let activeLayoutController = null;
let activeLayoutName = null;
let activePageStyleNode = document.head.querySelector('link[data-layer-page-style]');
let activeLayoutStyleNode = document.head.querySelector('link[data-layer-layout-style]');
let disposedStatus = false;
let offlineContextPromise = null;
let offlineContextCurrent = null;
let navigationSequence = 0;
let updateCoordinator = null;
let updateCard = null;
let updateState = Object.freeze({
    updateAvailable: false,
    criticalUpdate: false,
    currentVersion: applicationVersion,
    availableVersion: applicationVersion,
    waiting: false,
    currentBuildId: applicationBuildId,
    availableBuildId: null,
    phase: 'unsupported',
    progress: null,
    visible: false,
    error: null
});
const shellTitleNode = document.head.querySelector('title');
const documentMetadataBaseline = Object.freeze({
    title: shellTitleNode?.getAttribute('data-layer-shell-content') ?? document.title,
    language: document.documentElement.getAttribute('lang'),
    direction: document.documentElement.getAttribute('dir')
});

function csrfTokenRead() {
    if (typeof applicationModule.csrfTokenGet === 'function') {
        return applicationModule.csrfTokenGet();
    }

    const cookieValues = String(document.cookie ?? '').split(';');

    //Reading the non-HttpOnly double-submit token set by Layer Auth.
    for (const cookieValue of cookieValues) {
        const cookieSection = cookieValue.trim();
        const separatorIndex = cookieSection.indexOf('=');

        if (separatorIndex < 1) {
            continue;
        }

        const cookieName = cookieSection.slice(0, separatorIndex);

        if (cookieName === '__Host-layer_csrf' || cookieName === 'layer_csrf') {
            return decodeURIComponent(cookieSection.slice(separatorIndex + 1));
        }

    }

    return document.querySelector('meta[name="layer-csrf"]')?.getAttribute('content') ?? null;
}

const apiClient = layerApiClientCreate({
    apiUrl: applicationModule.apiUrl ?? '/api',
    requestIdCreate: applicationModule.requestIdCreate ?? (() => crypto.randomUUID()),
    csrfTokenGet: csrfTokenRead,
    fetchImplementation: applicationModule.fetchImplementation
});
const applicationAuth = layerAuthBrowserCreate({
    request: apiClient.request,
    storagePurge,
    phoneOperations: applicationModule.authPhoneOperations
});
const pwaCapabilityOptions = {
    window,
    navigator,
    notificationApi: globalThis.Notification,
    pushRequest: apiClient.request,
    onError: applicationModule.onError
};
const shareTargetInbox = layerShareTargetInboxCreate({
    appId: applicationIdentifier,
    indexedDb: indexedDB
});

if (applicationModule.serviceWorker !== false && navigator.serviceWorker !== undefined) {
    //Providing live registrations only when this application owns a Service Worker.
    pwaCapabilityOptions.registrationGet = () => navigator.serviceWorker.ready;

}

if (shareTargetEnabled) {
    //Connecting only a manifest-declared POST target to the temporary inbox facade.
    pwaCapabilityOptions.shareTargetIdGet = () => new URL(location.href).searchParams.get('layerShareId');
    pwaCapabilityOptions.shareTargetConsume = (shareIdentifier) => shareTargetInbox.consume(shareIdentifier);
    pwaCapabilityOptions.shareTargetDiscard = (shareIdentifier) => shareTargetInbox.discard(shareIdentifier);
    pwaCapabilityOptions.shareTargetIdClear = (shareIdentifier) => {
        const currentUrl = new URL(location.href);

        if (currentUrl.searchParams.get('layerShareId') !== shareIdentifier) {
            return;

        }

        //Removing the consumed opaque identifier without adding a browser history entry.
        currentUrl.searchParams.delete('layerShareId');
        history.replaceState(
            history.state,
            '',
            currentUrl.pathname + currentUrl.search + currentUrl.hash
        );
    };

}

const pwaCapabilities = layerPwaCapabilitiesCreate(pwaCapabilityOptions);

async function updateManifestLoad() {
    //Reading update metadata from the network without a stale HTTP cache entry.
    const responseData = await fetch('/_layer/version.json', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
            accept: 'application/json'
        }
    });

    if (!responseData.ok) {
        throw new TypeError('The Layer version manifest is unavailable.');
    }

    return responseData.json();
}

function updateCoordinatorConnect(registrationData) {
    //Binding the verified manifest, durable local state, and live worker registration.
    updateCoordinator = layerApplicationUpdatesCreate({
        window,
        registration: registrationData,
        currentVersion: applicationVersion,
        currentBuildId: applicationBuildId,
        appKey: updatesConfiguration.appKey,
        configuration: {enabled: updatesConfiguration.enabled, ui: updatesConfiguration.ui,
            checkIntervalMs: updatesConfiguration.checkIntervalMs},
        beforeUpdate: applicationModule.onBeforeUpdate,
        onError: applicationModule.onError,
        async localStateSave() {
            const offlineContext = await offlineContextGet();

            //Persisting the active namespace and worker credentials before controller replacement.
            await workerOutboxConfigurationRefresh(offlineContext.storage);
            await offlineContext.outbox.list({
                statuses: ['queued', 'retryable']
            });
        }
    });
    if (updatesConfiguration.ui) {
        updateCard = layerUpdateCardCreate({root: rootNode, manifest: applicationWebManifest, controller: updateCoordinator});

    }

    return updateCoordinator;
}

const pwaUpdate = Object.freeze({
    getState() {
        //Returning the last immutable state without triggering network work.
        return updateCoordinator?.getState() ?? updateState;
    },
    async check() {
        //Requiring completed Service Worker registration before the update probe.
        if (updateCoordinator === null) {
            throw new TypeError('The Service Worker update coordinator is unavailable.');
        }

        updateState = await updateCoordinator.check();

        return updateState;
    },
    async activate(options = {}) {
        //Delegating activation to the coordinator that persists local state first.
        if (updateCoordinator === null) {
            throw new TypeError('The Service Worker update coordinator is unavailable.');
        }

        await updateCoordinator.activate(options);
    },
    subscribe(listener) {
        if (updateCoordinator === null) {
            throw new TypeError('The Service Worker update coordinator is unavailable.');

        }
        return updateCoordinator.subscribe(listener);
    },
    dismiss() {
        return updateCoordinator?.dismiss();
    },
    show() {
        return updateCoordinator?.show();
    }
});
const applicationPwa = Object.freeze({
    ...pwaCapabilities,
    update: pwaUpdate
});
const internalStorageSchema = layerStorageSchemaDefine({
    name: 'engine',
    version: 1,
    stores: {},
    migrations: {
        1() {
            //Reserving version one for engine-owned stores created by Layer storage.
        }
    }
});

async function storageNamespaceRead() {
    if (typeof applicationModule.storageNamespaceGet === 'function') {
        return applicationModule.storageNamespaceGet();
    }

    if (typeof applicationModule.identityGet === 'function') {
        const identityData = await applicationModule.identityGet();

        if (identityData?.authenticated === true) {
            throw new TypeError('Authenticated applications must export storageNamespaceGet.');
        }
    }

    if (layerAuthEnabled) {
        const authStateData = await applicationAuth.state.get();

        if (authStateData.authenticated === true && typeof authStateData.user?.id === 'string') {
            //Separating the managed identity from anonymous and other account storage.
            return 'auth:' + authStateData.user.id;
        }
    }

    return 'anonymous';
}

async function workerOutboxConfigurationRefresh(storageData) {
    //Recording the current user database and rotated CSRF token for worker delivery.
    await layerWorkerOutboxConfigure({
        appId: applicationIdentifier,
        storageName: storageData.name,
        apiUrl: applicationModule.apiUrl ?? '/api',
        csrfToken: await csrfTokenRead(),
        applicationOrigin: location.origin
    });
}

async function commandBackgroundSyncRegister(storageData, registrationData = null) {
    if (typeof applicationModule.backgroundSyncRegister === 'function') {
        //Delegating optional application-specific scheduling without changing durable outbox ownership.
        await applicationModule.backgroundSyncRegister({
            storage: storageData,
            registration: registrationData
        });

        return true;
    }

    //Using the generated Service Worker bridge for ordinary applications.
    return backgroundSyncRegister(storageData, registrationData);
}

async function backgroundSyncRegister(storageData, registrationData = null) {
    //Refreshing the worker bridge before registering the shared outbox tag.
    await workerOutboxConfigurationRefresh(storageData);
    let selectedRegistration = registrationData;

    if (selectedRegistration === null) {
        selectedRegistration = await navigator.serviceWorker?.getRegistration() ?? null;
    }

    if (selectedRegistration?.sync === undefined) {
        return false;
    }

    await selectedRegistration.sync.register('layer-outbox');

    return true;
}

async function offlineContextCreate() {
    const namespaceData = await storageNamespaceRead();
    const storageSchema = applicationModule.storageSchema === undefined
        ? internalStorageSchema
        : layerStorageSchemaDefine(applicationModule.storageSchema);
    const storageData = await layerStorageOpen({
        appId: applicationIdentifier,
        namespace: namespaceData,
        schema: storageSchema
    });
    await workerOutboxConfigurationRefresh(storageData);
    const outboxData = layerOfflineOutboxCreate({
        storage: storageData,
        ownerId: crypto.randomUUID(),
        commandIdCreate: () => crypto.randomUUID(),
        commandSend: (commandData) => apiClient.command(
            commandData.operation,
            commandData.payload,
            {
                commandId: commandData.commandId,
                baseRevision: commandData.baseRevision
            }
        )
    });
    const commandRuntime = layerCommandRuntimeCreate({
        outbox: outboxData,
        onlineGet: applicationModule.onlineGet ?? (() => navigator.onLine),
        optimisticApply: applicationModule.optimisticApply,
        async backgroundSyncRegister() {
            //Registering this user database after refreshing its worker credentials.
            await commandBackgroundSyncRegister(storageData);
        },
        failureHandle(failureData) {
            applicationModule.onError?.(failureData.error);
        }
    });

    return Object.freeze({
        storage: storageData,
        outbox: outboxData,
        commands: commandRuntime
    });
}

function offlineContextGet() {
    if (offlineContextPromise === null) {
        offlineContextPromise = offlineContextCreate().then(function offlineContextConnect(offlineContext) {
            if (disposedStatus) {
                //Closing storage that completed after its owning application was disposed.
                offlineContext.storage.close();

            } else {
                //Keeping a synchronous owner reference for page lifecycle cleanup.
                offlineContextCurrent = offlineContext;
            }

            return offlineContext;
        });
    }

    return offlineContextPromise;
}

const eventStream = layerPostEventStreamCreate({
    apiUrl: applicationModule.apiUrl ?? '/api',
    requestIdCreate: applicationModule.requestIdCreate ?? (() => crypto.randomUUID()),
    csrfTokenGet: csrfTokenRead,
    fetchImplementation: applicationModule.fetchImplementation
});
const eventSubscriptions = layerEventSubscriptionsCreate({
    async runtimeCreate(runtimeData) {
        const offlineContext = await offlineContextGet();
        //Sharing the authorized snapshot loader with the leader and follower tabs
        const eventSnapshotRecover = async function( gapData ){
            //Requiring application data recovery instead of inventing a snapshot or cursor
            if ( typeof applicationModule.eventSync !== 'function' ){
                throw new LayerRuntimeError(
                    'EVENT_SYNC_REQUIRED',
                    'The application must provide eventSync for snapshot recovery.'
                );

            }

            //Passing cancellation and returning the exact snapshot position applied in this tab
            return await applicationModule.eventSync( gapData, {
                api: apiClient,
                storage: offlineContext.storage,
                signal: gapData.signal
            });

        };
        const eventRuntime = layerEventRuntimeCreate({
            channels: runtimeData.channels,
            stream: eventStream,
            cursorRead: () => offlineContext.storage.eventCursors.read(runtimeData.channels),
            cursorWrite: (channelName, sequenceData) => {
                return offlineContext.storage.eventCursors.write(channelName, sequenceData);
            },
            eventApply: runtimeData.eventReceive,
            syncHandle: eventSnapshotRecover,
            controlHandle: applicationModule.eventControl,
            failureHandle: applicationModule.eventFailure
        });
        let broadcastChannelCreate;

        if (typeof BroadcastChannel === 'function') {
            broadcastChannelCreate = (channelName) => new BroadcastChannel(channelName);
        }

        return layerMultiTabEventsCreate({
            originKey: location.origin + ':' + applicationIdentifier,
            channels: runtimeData.channels,
            cursorRead: () => offlineContext.storage.eventCursors.read(runtimeData.channels),
            eventReceive: runtimeData.eventReceive,
            syncHandle: eventSnapshotRecover,
            streamRun: (runData) => eventRuntime.run(runData),
            lockManager: navigator.locks,
            broadcastChannelCreate,
            tabIdCreate: () => crypto.randomUUID(),
            failureHandle: (eventError) => applicationModule.onError?.(eventError)
        });
    },
    failureHandle: (eventError) => applicationModule.onError?.(eventError)
});

async function commandRun(operationName, payloadData, commandOptions) {
    const offlineContext = await offlineContextGet();

    return offlineContext.commands.command(operationName, payloadData, commandOptions);
}

async function commandOnlineRun(operationName, payloadData, commandOptions) {
    //Sending sensitive online-only commands without writing payloads to IndexedDB.
    return apiClient.command(operationName, payloadData, {
        commandId: crypto.randomUUID(),
        baseRevision: commandOptions.baseRevision
    });
}

const applicationApi = layerApplicationApiCreate({
    queryRequest(operationName, payloadData, queryOptions) {
        //Sending component queries through the strict same-origin protocol client.
        return apiClient.query(operationName, payloadData, queryOptions);
    },
    commandRun,
    commandOnlineRun,
    syncRun(operationName, payloadData, syncOptions) {
        //Keeping cursor recovery on the same generated application API boundary.
        return apiClient.sync(operationName, payloadData, syncOptions);
    },
    async queryCacheGet(cacheKey, timeData) {
        const offlineContext = await offlineContextGet();

        //Reading the user-isolated cache only after its schema is ready.
        return offlineContext.storage.queryCache.get(cacheKey, timeData);
    },
    async queryCachePut(cacheKey, cacheData, cacheOptions) {
        const offlineContext = await offlineContextGet();

        //Persisting one query snapshot through the engine-owned cache store.
        return offlineContext.storage.queryCache.put(cacheKey, cacheData, cacheOptions);
    },
    onlineGet: applicationModule.onlineGet ?? (() => navigator.onLine),
    failureHandle(failureData) {
        //Reporting background cache and optimistic failures without exposing storage details.
        applicationModule.onError?.(failureData.error);
    }
});

async function storageReady() {
    const offlineContext = await offlineContextGet();

    return offlineContext.storage;
}

async function storagePurge() {
    //Removing the browser device endpoint on logout; server credential revocation is authoritative
    if (applicationModule.serviceWorker !== false && navigator.serviceWorker !== undefined && globalThis.Notification?.permission === 'granted') {
        let pushCleanupTimer;
        try {
            await Promise.race([
                pwaCapabilities.push.unsubscribe(),
                new Promise(function pushCleanupDeadline(resolve) {
                    //Never delaying logout indefinitely for a suspended native push provider
                    pushCleanupTimer = setTimeout(resolve, 1000);
                })
            ]);
        } catch {
            //Server credential revocation remains authoritative if local cleanup is unavailable
        } finally {
            clearTimeout(pushCleanupTimer);
        }
    }
    const offlineContext = await offlineContextGet();

    await eventSubscriptions.stop();

    try {
        //Removing the worker pointer before another sync event can claim user intent.
        await layerWorkerOutboxConfigurationClear({
            appId: applicationIdentifier
        });

    } finally {
        try {
            //Removing transient shared content independently from the authenticated namespace.
            await shareTargetInbox.purge();

        } finally {
            //Purging user state even when registry or share cleanup reports a storage failure.
            await offlineContext.storage.purgeUserData();
            offlineContextCurrent = null;
            offlineContextPromise = null;

        }

    }
}

function boundaryRender(resultData) {
    if (typeof applicationModule.boundaryRender === 'function') {
        applicationModule.boundaryRender({
            result: resultData,
            root: rootNode,
            navigate
        });

        return;

    }

    const boundaryNode = document.createElement('section');
    boundaryNode.dataset.layerBoundary = String(resultData.status);
    boundaryNode.textContent = 'Layer application boundary: ' + String(resultData.status);
    rootNode.replaceChildren(boundaryNode);
}

async function styleNodeApply(styleUrl, previousStyleNode, styleMarker, activeCheck = () => true) {
    const normalizedUrl = new URL('/' + String(styleUrl).replace(/^\\/+/, ''), location.origin).href;

    if (previousStyleNode?.href === normalizedUrl) {
        return previousStyleNode;
    }

    const styleNode = document.createElement('link');
    styleNode.rel = 'stylesheet';
    styleNode.href = normalizedUrl;
    styleNode.setAttribute(styleMarker, '');

    const styleReady = new Promise((resolve, reject) => {
        styleNode.addEventListener('load', resolve, {once: true});
        styleNode.addEventListener('error', () => reject(new Error('Application stylesheet failed to load.')), {once: true});
    });

    document.head.append(styleNode);
    await styleReady;

    if (!activeCheck()) {
        styleNode.remove();

        return null;
    }

    previousStyleNode?.remove();

    return styleNode;
}

function documentElementAttributeApply(attributeName, attributeValue, baselineValue) {
    if (typeof attributeValue === 'string') {
        document.documentElement.setAttribute(attributeName, attributeValue);

        return;
    }

    if (typeof baselineValue === 'string') {
        document.documentElement.setAttribute(attributeName, baselineValue);

        return;
    }

    document.documentElement.removeAttribute(attributeName);
}

function routeMetadataApply(metadataData) {
    const documentData = layerRouteMetadataDocumentCreate(metadataData);
    const activeMetadataKeys = new Set();

    for (const entryData of documentData.entries) {
        const managedSelector = '[data-layer-route-metadata="' + entryData.key + '"]';
        const identitySelector = entryData.element + '[' + entryData.identity + '="' + entryData.identityValue + '"]';
        let metadataNode = document.head.querySelector(managedSelector);

        if (!(metadataNode instanceof Element)) {
            metadataNode = document.head.querySelector(identitySelector);
        }

        if (!(metadataNode instanceof Element) || metadataNode.localName !== entryData.element) {
            metadataNode = document.createElement(entryData.element);
            document.head.append(metadataNode);
        }

        metadataNode.setAttribute(entryData.identity, entryData.identityValue);
        metadataNode.setAttribute(entryData.value, entryData.valueData);
        metadataNode.setAttribute('data-layer-route-metadata', entryData.key);
        activeMetadataKeys.add(entryData.key);
    }

    for (const metadataNode of document.head.querySelectorAll('[data-layer-route-metadata]')) {
        const metadataKey = metadataNode.getAttribute('data-layer-route-metadata');

        if (metadataKey === null || activeMetadataKeys.has(metadataKey)) {
            continue;
        }

        metadataNode.remove();
    }

    document.title = documentData.title ?? documentMetadataBaseline.title;
    documentElementAttributeApply('lang', documentData.language, documentMetadataBaseline.language);
    documentElementAttributeApply('dir', documentData.direction, documentMetadataBaseline.direction);
}

function activeRenderDispose() {
    //Disposing the page before its owner layout and removing both style layers.
    activePageController?.dispose();
    activeLayoutController?.dispose();
    activePageStyleNode?.remove();
    activeLayoutStyleNode?.remove();
    activePageController = null;
    activeLayoutController = null;
    activeLayoutName = null;
    activePageStyleNode = null;
    activeLayoutStyleNode = null;
}

function componentContextCreate(navigationData) {
    const declaredContext = applicationModule.context ?? {};

    if (typeof declaredContext !== 'object' || declaredContext === null || Array.isArray(declaredContext)) {
        throw new TypeError('Application context must be an object.');
    }

    return {
        ...declaredContext,
        'layer.api': applicationApi,
        'layer.command': commandRun,
        'layer.events': eventSubscriptions,
        'layer.viewport': applicationViewport,
        'layer.links': applicationLinks,
        'layer.navigate': navigate,
        'layer.route': Object.freeze({
            route: navigationData.route,
            params: navigationData.params,
            preload: navigationData.preload
        })
    };
}

async function routeRender(navigationData, navigationIdentifier) {
    if (navigationIdentifier !== navigationSequence) {
        return navigationSupersededResultCreate(navigationData);
    }

    const routeAsset = routeAssetById.get(navigationData.route.id);
    const layoutName = navigationData.route.layout;

    if (routeAsset === undefined) {
        throw new TypeError('The selected route has no application asset.');
    }

    const componentUrl = new URL('/' + String(routeAsset.component).replace(/^\\/+/, ''), location.origin);
    const componentModulePromise = import(componentUrl.href);
    const preserveLayout = layoutName !== null && navigationData.preserveLayout === true &&
        activeLayoutName === layoutName && activeLayoutController !== null;
    let layoutAsset = null;
    let layoutModulePromise = null;

    if (layoutName !== null) {
        layoutAsset = layoutAssetByName.get(layoutName);

        if (layoutAsset === undefined) {
            throw new TypeError('The selected route layout has no application asset.');
        }

        const nextLayoutStyleNode = await styleNodeApply(
            layoutAsset.style,
            activeLayoutStyleNode,
            'data-layer-layout-style',
            () => navigationIdentifier === navigationSequence
        );

        if (nextLayoutStyleNode === null) {
            return navigationSupersededResultCreate(navigationData);
        }

        activeLayoutStyleNode = nextLayoutStyleNode;

        if (!preserveLayout) {
            const layoutUrl = new URL('/' + String(layoutAsset.component).replace(/^\\/+/, ''), location.origin);
            layoutModulePromise = import(layoutUrl.href);
        }

    } else {
        activeLayoutStyleNode?.remove();
        activeLayoutStyleNode = null;
    }

    const nextPageStyleNode = await styleNodeApply(
        routeAsset.style,
        activePageStyleNode,
        'data-layer-page-style',
        () => navigationIdentifier === navigationSequence
    );

    if (nextPageStyleNode === null) {
        return navigationSupersededResultCreate(navigationData);
    }

    activePageStyleNode = nextPageStyleNode;
    const componentModule = await componentModulePromise;
    const layoutModule = layoutModulePromise === null ? null : await layoutModulePromise;
    const props = typeof applicationModule.props === 'function'
        ? await applicationModule.props(navigationData)
        : {};

    if (navigationIdentifier !== navigationSequence) {
        return navigationSupersededResultCreate(navigationData);
    }

    const instanceOptions = {
        context: componentContextCreate(navigationData),
        props,
        onEmit: applicationModule.onEmit
    };
    const hydrateStatus = navigationData.route.render === 'ssr' &&
        rootNode.getAttribute('data-layer-ssr') === navigationData.route.id;
    let pageRootNode = rootNode;

    //Discarding a different route's build-time SSR shell before the first direct CSR mount.
    if (!hydrateStatus && activePageController === null && activeLayoutController === null &&
        rootNode.hasAttribute('data-layer-ssr')) {
        rootNode.replaceChildren();

    }

    activePageController?.dispose();
    activePageController = null;

    if (!preserveLayout) {
        activeLayoutController?.dispose();
        activeLayoutController = null;
        activeLayoutName = null;

        if (layoutName !== null && layoutModule !== null) {
            const layoutInstanceOptions = {
                context: componentContextCreate(navigationData)
            };

            if (hydrateStatus) {
                activeLayoutController = layoutModule.hydrate(rootNode, layoutInstanceOptions);

            } else {
                activeLayoutController = layoutModule.mount(rootNode, layoutInstanceOptions);

            }

            activeLayoutName = layoutName;
        }
    }

    if (layoutName !== null) {
        const layoutOutlets = rootNode.querySelectorAll('[data-layer-layout-outlet]');

        if (layoutOutlets.length !== 1) {
            throw new TypeError('An active layout must expose one data-layer-layout-outlet.');
        }

        pageRootNode = layoutOutlets[0];
    }

    if (hydrateStatus) {
        activePageController = componentModule.hydrate(pageRootNode, instanceOptions);

    } else {
        activePageController = componentModule.mount(pageRootNode, instanceOptions);

    }

    rootNode.removeAttribute('data-layer-ssr');

    //Resetting shell scrolling only at the completed route boundary.
    applicationViewport.resetScroll();
    rootNode.scrollTo({
        left: Number(navigationData.historyState.scrollX),
        top: Number(navigationData.historyState.scrollY),
        behavior: 'auto'
    });

    routeMetadataApply(navigationData.route.metadata);

    //Applying the route position only after the selected screen finishes rendering.
    window.scrollTo({
        left: Number(navigationData.historyState.scrollX),
        top: Number(navigationData.historyState.scrollY),
        behavior: 'auto'
    });

    return navigationData;
}

async function routeIdentityGet() {
    if (typeof applicationModule.identityGet === 'function') {
        return applicationModule.identityGet();
    }

    if (layerAuthEnabled) {
        //Using the server-derived managed session state as the default route guard identity.
        return applicationAuth.state.get();
    }

    return Object.freeze({
        authenticated: false,
        permissions: Object.freeze([])
    });
}

const router = layerRouterCreate({
    manifest: routeManifest,
    identityGet: routeIdentityGet,
    onlineGet: applicationModule.onlineGet ?? (() => navigator.onLine),
    guardRun: applicationModule.guardRun,
    preload: applicationModule.preload,
    history
});

function navigationSupersededResultCreate(navigationData) {
    //Converting an obsolete route result into a side-effect-free outcome.
    return Object.freeze({
        ...navigationData,
        status: 'superseded'
    });
}

//Creating the shared link policy after router construction but before any component mounts
const applicationLinks = layerLinksCreate({
    root: rootNode,
    window,
    scope: applicationScope,
    configuration: linksConfiguration,
    resolve: router.resolve,
    navigate
});
if (pwaCapabilities.launch.getCapability().supported) {
    //Capturing cold-start URLs without replacing application or file launch consumers
    pwaCapabilities.launch.setDefaultConsumer(function(launchData){
        //Ignoring file-only envelopes that contain no navigation target
        if (launchData.targetUrl !== null) {
            return applicationLinks.launch(launchData.targetUrl);

        }

    });

}

async function navigate(pathnameData, navigationOptions = {}) {
    if (disposedStatus) {
        throw new TypeError('A disposed Layer application cannot navigate.');
    }

    const navigationIdentifier = ++navigationSequence;
    //Closing a modal before an explicit application navigation changes its page lifetime
    applicationLinks.closeViewer();

    try {
        const navigationData = await router.navigate(pathnameData, navigationOptions);

        if (navigationData.status === 'superseded' || navigationIdentifier !== navigationSequence) {
            return navigationSupersededResultCreate(navigationData);
        }

        if (navigationData.status !== 'ready') {
            activeRenderDispose();
            boundaryRender(navigationData);

            return navigationData;
        }

        return routeRender(navigationData, navigationIdentifier);

    } catch (navigationError) {
        if (navigationIdentifier !== navigationSequence) {
            return Object.freeze({
                status: 'superseded',
                pathname: pathnameData
            });
        }

        if (typeof applicationModule.onError === 'function') {
            applicationModule.onError(navigationError);
        }

        throw navigationError;
    }
}

function documentClickHandle(eventData) {
    if (eventData.defaultPrevented || eventData.button !== 0 || eventData.metaKey || eventData.ctrlKey ||
        eventData.shiftKey || eventData.altKey) {
        return;
    }

    const linkNode = eventData.target instanceof Element ? eventData.target.closest('a[href]') : null;

    if (!(linkNode instanceof HTMLAnchorElement) || linkNode.target !== '' || linkNode.hasAttribute('download')) {
        return;
    }

    let targetUrl;
    try {
        //Rejecting malformed anchor URLs without invoking browser navigation
        targetUrl = new URL(linkNode.href, location.href);

    } catch (linkUrlError) {
        void linkUrlError;
        eventData.preventDefault();
        return;

    }
    if (['javascript:', 'data:', 'vbscript:', 'file:'].includes(targetUrl.protocol) ||
        targetUrl.username !== '' || targetUrl.password !== '') {
        //Blocking executable and credential-bearing ordinary links as well as explicit API requests
        eventData.preventDefault();
        return;

    }

    const requestedMode = linkNode.getAttribute('data-layer-link') ?? 'auto';
    const appRouteStatus = targetUrl.origin === location.origin && router.resolve(targetUrl.pathname) !== null;
    const viewerStatus = linksConfiguration.external.mode === 'viewer' &&
        linksConfiguration.external.allowedOrigins.includes(targetUrl.origin);
    const relatedOriginStatus = linksConfiguration.scopeExtensions.includes(targetUrl.origin);
    if (requestedMode === 'auto' && !appRouteStatus && !viewerStatus && !relatedOriginStatus) {
        return;
    }

    eventData.preventDefault();
    //Keeping asynchronous navigation failures observable without an unhandled rejection
    void applicationLinks.openAnchor(linkNode, {mode: requestedMode}).catch(function(linkError){
        //Using the trusted application error hook or a bounded diagnostic category
        if (typeof applicationModule.onError === 'function') {
            applicationModule.onError(linkError);

        } else {
            console.warn('Layer link opening failed: LINK_OPEN_FAILED.');

        }

    });
}

function historyChangeHandle() {
    void navigate(location.pathname + location.search + location.hash, {replace: true, history: false});
}

const application = Object.freeze({
    api: applicationApi,
    auth: applicationAuth,
    command: commandRun,
    commandOnline: applicationApi.commandOnline,
    events: eventSubscriptions,
    navigate,
    pwa: applicationPwa,
    viewport: applicationViewport,
    keyboard: applicationViewport.keyboard,
    links: applicationLinks,
    query: apiClient.query,
    sync: apiClient.sync,
    storageReady,
    storagePurge,
    currentGet: router.currentGet,
    dispose() {
        if (disposedStatus) {
            return false;
        }

        disposedStatus = true;
        activeRenderDispose();
        applicationViewport.dispose();
        applicationLinks.dispose();
        navigationBootstrap?.dispose();
        updateCard?.dispose();
        updateCoordinator?.dispose();
        pwaCapabilities.launch.dispose();
        applicationApi.dispose();
        void eventSubscriptions.stop();
        offlineContextCurrent?.storage.close();
        offlineContextCurrent = null;
        void offlineContextPromise?.then(function pendingOfflineContextClose(offlineContext) {
            //Closing a context that was still opening when disposal began.
            offlineContext.storage.close();

        });
        document.removeEventListener('click', documentClickHandle);
        window.removeEventListener('popstate', historyChangeHandle);
        window.removeEventListener('online', onlineChangeHandle);
        window.removeEventListener('pagehide', pageHideHandle);

        //Returning browser history ownership after the Layer application releases this document.
        history.scrollRestoration = historyScrollRestorationBaseline;

        return true;
    }
});

Object.defineProperty(globalThis, 'layerApplication', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: application
});
Object.defineProperty(globalThis, 'layer', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: application
});
document.addEventListener('click', documentClickHandle);
window.addEventListener('popstate', historyChangeHandle);

function pageHideHandle(eventData) {
    if (eventData.persisted) {
        //Keeping a back-forward cached document ready for its pageshow restoration.
        return;
    }

    //Closing IndexedDB and runtime ownership before reload releases this document.
    application.dispose();
}

function onlineChangeHandle() {
    if (offlineContextPromise !== null) {
        void offlineContextPromise
            .then((offlineContext) => offlineContext.commands.drain())
            .catch((onlineError) => applicationModule.onError?.(onlineError));
    }
}

window.addEventListener('online', onlineChangeHandle);
window.addEventListener('pagehide', pageHideHandle);

async function applicationStart() {
    let offlineContext = null;
    let registrationData = null;

    if (applicationModule.serviceWorker !== false) {
        try {
            registrationData = await layerServiceWorkerRegister();
            updateCoordinatorConnect(registrationData);

        } catch (registrationError) {
            applicationModule.onError?.(registrationError);
        }
    }

    try {
        offlineContext = await offlineContextGet();

        if ((applicationModule.onlineGet ?? (() => navigator.onLine))()) {
            await offlineContext.commands.drain();
        }
    } catch (storageError) {
        applicationModule.onError?.(storageError);
    }

    const initialResult = await navigate(location.pathname + location.search + location.hash, {replace: true, history: false});

    if (typeof applicationModule.onReady === 'function') {
        await applicationModule.onReady({application, result: initialResult});
    }

    //Delivering startup navigation only after application consumers and route lifecycle are ready
    await applicationLinks.ready(pwaCapabilities.launch.hasConsumer());
    pwaCapabilities.launch.startupComplete();
    await navigationBootstrap?.ready(function(url){
        //Preserving the existing router's guards and complete URL for early clicks and worker handoffs
        return applicationLinks.open(url, {mode: 'app'});

    });

    if (registrationData !== null) {
        try {
            if (offlineContext !== null) {
                const pendingCommands = await offlineContext.outbox.list({
                    statuses: ['queued', 'retryable']
                });

                if (pendingCommands.length > 0) {
                    //Registering commands restored from a previous offline application lifetime.
                    await commandBackgroundSyncRegister(offlineContext.storage, registrationData);

                }
            }

            //Observing updates after app hooks are ready; never activating on startup.
            updateCoordinator?.start();

        } catch (updateError) {
            applicationModule.onError?.(updateError);
        }
    }
}

void applicationStart().catch(function(startupError){
    //Releasing a queued URL if application startup fails instead of keeping a dead navigation queue
    navigationBootstrap?.fail();
    try {
        applicationModule.onError?.(startupError);

    } catch (reportingError) {
        //Containing a broken application diagnostic hook after native recovery has been requested
        void reportingError;
        console.warn('Layer startup diagnostic failed: APPLICATION_START_FAILED.');

    }

});
`;

}

/**
 * @param {object} bundleOptions
 * @param {string} bundleOptions.rootDirectory
 * @param {string} bundleOptions.sourceDirectory
 * @param {string} bundleOptions.appName
 * @param {string} bundleOptions.appVersion
 * @param {boolean} bundleOptions.authEnabled
 * @param {readonly Readonly<Record<string, unknown>>[]} bundleOptions.routes
 * @param {readonly Readonly<Record<string, unknown>>[]} bundleOptions.layouts
 * @param {Readonly<Record<string, unknown>>} bundleOptions.webAppManifest
 * @param {Readonly<Record<string, any>>} [bundleOptions.links]
 * @param {Readonly<Record<string, any>>} [bundleOptions.updates]
 * @param {string} bundleOptions.outputFile
 */
export async function layerApplicationBundleCreate(bundleOptions) {
    const applicationEntry = path.join(bundleOptions.sourceDirectory, 'app.js');
    const applicationEntryStatus = await stat(applicationEntry).catch(function applicationEntryMissing(entryError) {
        //Treating an absent optional entry as the engine-owned default module.
        if (/** @type {NodeJS.ErrnoException} */ (entryError).code === 'ENOENT') {
            return null;

        }

        throw entryError;

    });

    if (applicationEntryStatus !== null && !applicationEntryStatus.isFile()) {
        throw new LayerCliError('CLI_BUILD_APP_ENTRY_INVALID', 'src/app.js must be a regular file.');

    }

    if (typeof bundleOptions.appVersion !== 'string' ||
        !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(bundleOptions.appVersion)) {
        throw new LayerCliError('CLI_BUILD_APP_VERSION_INVALID', 'The application version is invalid.');

    }

    try {
        const buildResult = await build({
            absWorkingDir: bundleOptions.rootDirectory,
            bundle: true,
            charset: 'utf8',
            entryPoints: ['layer-application'],
            format: 'esm',
            legalComments: 'eof',
            logLevel: 'silent',
            outfile: path.join(bundleOptions.rootDirectory, bundleOptions.outputFile),
            platform: 'browser',
            sourcemap: 'linked',
            sourcesContent: false,
            target: ['es2022'],
            treeShaking: true,
            write: false,
            plugins: [{
                name: 'layer-application',
                setup(buildApi) {
                    //Connecting virtual engine entries and guarded developer source imports.
                    buildApi.onResolve({filter: /^layer-application$/}, function applicationResolve() {
                        //Selecting the generated browser bootstrap as the build root.
                        return {namespace: 'layer-application', path: 'entry'};

                    });
                    buildApi.onResolve({filter: /^layer-application-entry$/, namespace: 'layer-application'}, function applicationEntryResolve() {
                        //Selecting the developer entry or the isolated default module.
                        if (applicationEntryStatus === null) {
                            return {namespace: 'layer-application-default', path: 'entry'};

                        }

                        return {namespace: 'file', path: applicationEntry};

                    });
                    buildApi.onResolve({filter: /^@solcorp\/layer-pwa$/, namespace: 'layer-application'}, function pwaResolve() {
                        //Resolving the CLI-owned PWA runtime without browser bare imports.
                        return {namespace: 'file', path: layerPwaEntryFile};

                    });
                    buildApi.onResolve({filter: /^@solcorp\/layer-auth\/browser$/, namespace: 'layer-application'}, function authResolve() {
                        //Resolving the CLI-owned Auth facade without a browser bare import.
                        return {namespace: 'file', path: layerAuthBrowserEntryFile};

                    });
                    buildApi.onResolve({filter: /^@solcorp\/layer-router$/, namespace: 'layer-application'}, function routerResolve() {
                        //Resolving the CLI-owned router runtime without browser bare imports.
                        return {namespace: 'file', path: layerRouterEntryFile};

                    });
                    buildApi.onResolve({filter: /^@solcorp\/layer-runtime$/, namespace: 'layer-application'}, function runtimeResolve() {
                        //Resolving the CLI-owned API client without a browser bare import.
                        return {namespace: 'file', path: layerRuntimeEntryFile};

                    });
                    buildApi.onResolve({filter: /^@solcorp\/layer-storage$/, namespace: 'layer-application'}, function storageResolve() {
                        //Resolving the CLI-owned IndexedDB runtime without a browser bare import.
                        return {namespace: 'file', path: layerStorageEntryFile};

                    });
                    buildApi.onResolve({filter: /.*/, namespace: 'file'}, async function sourceImportResolve(resolveData) {
                        //Delegating already guarded package internals to the standard resolver.
                        if (/** @type {Record<string, unknown> | undefined} */ (resolveData.pluginData)?.layerDefaultResolve === true) {
                            return null;

                        }

                        const importerRelative = path.relative(bundleOptions.sourceDirectory, resolveData.importer);

                        if ((resolveData.path.startsWith('./') || resolveData.path.startsWith('../')) &&
                            importerRelative !== '' && !importerRelative.startsWith('..') && !path.isAbsolute(importerRelative)) {
                            sourceFileBoundaryCheck(
                                bundleOptions.sourceDirectory,
                                path.resolve(resolveData.resolveDir, resolveData.path)
                            );

                        }

                        return buildApi.resolve(resolveData.path, {
                            importer: resolveData.importer,
                            kind: resolveData.kind,
                            namespace: 'file',
                            pluginData: {layerDefaultResolve: true},
                            resolveDir: resolveData.resolveDir
                        });

                    });
                    buildApi.onLoad({filter: /.*/, namespace: 'layer-application'}, function applicationLoad() {
                        //Providing the generated bootstrap source to the in-memory bundler.
                        return {
                            contents: applicationModuleSourceCreate(
                                bundleOptions.routes,
                                bundleOptions.layouts,
                                bundleOptions.appName,
                                bundleOptions.appVersion,
                                bundleOptions.authEnabled,
                                bundleOptions.webAppManifest,
                                bundleOptions.links ?? {external: {mode: 'viewer', allowedOrigins: []}, scopeExtensions: []},
                                bundleOptions.updates ?? {enabled: false, ui: false, checkIntervalMs: 300000}
                            ),
                            loader: 'js'
                        };

                    });
                    buildApi.onLoad({filter: /.*/, namespace: 'layer-application-default'}, function applicationDefaultLoad() {
                        //Providing a sealed empty context when src/app.js is absent.
                        return {contents: 'export const context = Object.freeze({});\n', loader: 'js'};

                    });

                }
            }]
        });
        const bundleArtifacts = /** @type {Record<string, string>} */ ({});

        for (const outputData of buildResult.outputFiles ?? []) {
            bundleArtifacts[relativeFileNormalize(bundleOptions.rootDirectory, outputData.path)] = outputData.text;

        }

        if (!Object.hasOwn(bundleArtifacts, bundleOptions.outputFile) ||
            !Object.hasOwn(bundleArtifacts, `${bundleOptions.outputFile}.map`)) {
            throw new Error('The application bundle did not produce its module and source map.');

        }

        return Object.freeze(bundleArtifacts);

    } catch (bundleError) {
        if (bundleError instanceof LayerCliError) {
            throw bundleError;

        }

        let failureReason = 'Unknown bundle failure.';

        //Publishing one bounded bundler reason without exposing internal objects.
        if (bundleError instanceof Error) {
            failureReason = bundleError.message.slice(0, 500);

        }

        throw new LayerCliError('CLI_BUILD_APP_BUNDLE_FAILED', 'The browser application could not be bundled.', {
            reason: failureReason
        });

    }

}
