import {LayerPwaError} from './pwa-error.js';
import {layerLaunchBrokerCreate} from './launch-broker.js';

const protocolHandlerSafeSchemes = new Set([
    'bitcoin',
    'ftp',
    'ftps',
    'geo',
    'im',
    'irc',
    'ircs',
    'magnet',
    'mailto',
    'matrix',
    'mms',
    'news',
    'nntp',
    'openpgp4fpr',
    'sftp',
    'sip',
    'sms',
    'smsto',
    'ssh',
    'tel',
    'urn',
    'webcal',
    'wtai',
    'xmpp'
]);

/**
 * @param {boolean} supportedStatus
 * @param {string} permissionData
 * @param {string} reasonData
 */
function capabilityDataCreate(supportedStatus, permissionData, reasonData) {
    let availabilityData = 'fallback';

    //Publishing availability separately from browser permission state.
    if (supportedStatus) {
        availabilityData = 'available';

    }

    return Object.freeze({
        supported: supportedStatus,
        permission: permissionData,
        availability: availabilityData,
        reason: reasonData
    });

}

/**
 * @param {string} capabilityName
 */
function unsupportedErrorCreate(capabilityName) {
    //Returning one stable error for explicit fallback handling.
    return new LayerPwaError('PWA_CAPABILITY_UNAVAILABLE', `${capabilityName} is unavailable in this browser.`);

}

/**
 * @param {boolean} supportedStatus
 * @param {string} readyReason
 * @param {string} fallbackReason
 */
function capabilityReasonCreate(supportedStatus, readyReason, fallbackReason) {
    //Selecting the human-readable detection result without user-agent parsing.
    if (supportedStatus) {
        return readyReason;

    }

    return fallbackReason;

}

/**
 * @param {string} schemeData
 * @param {string} handlerUrl
 */
function protocolHandlerInputNormalize(schemeData, handlerUrl) {
    //Checking primitive values before normalization can invoke application code.
    if (typeof schemeData !== 'string' || typeof handlerUrl !== 'string') {
        throw new TypeError('Protocol handler input is invalid.');

    }

    const normalizedScheme = schemeData.toLowerCase();
    const customSchemeStatus = /^web\+[a-z]+$/.test(normalizedScheme);
    const handlerPathStatus = handlerUrl.length >= 3 && handlerUrl.length <= 2048 &&
        handlerUrl.startsWith('/') && !handlerUrl.startsWith('//') &&
        !handlerUrl.includes('\\') && handlerUrl.includes('%s');

    //Restricting registration to WHATWG schemes and same-origin relative handlers.
    if ((!protocolHandlerSafeSchemes.has(normalizedScheme) && !customSchemeStatus) || !handlerPathStatus) {
        throw new TypeError('Protocol handler input is invalid.');

    }

    return Object.freeze({
        scheme: normalizedScheme,
        url: handlerUrl
    });

}

/**
 * @param {unknown} objectData
 */
function plainObjectCheck(objectData) {
    //Rejecting arrays and prototype-shaped values before passing data to browser APIs.
    if (typeof objectData !== 'object' || objectData === null || Array.isArray(objectData)) {
        return false;

    }

    const objectPrototype = Object.getPrototypeOf(objectData);

    return objectPrototype === Object.prototype || objectPrototype === null;

}

/**
 * @param {unknown} tagData
 * @param {boolean} emptyAllowed
 */
function notificationTagNormalize(tagData, emptyAllowed) {
    //Bounding tags because browsers retain them beyond the current document lifetime.
    if (typeof tagData !== 'string' || tagData.length > 256 ||
        (!emptyAllowed && tagData.length < 1) || tagData.includes('\0')) {
        throw new TypeError('Notification tag is invalid.');

    }

    return tagData;

}

/**
 * @param {unknown} applicationServerKey
 */
function applicationServerKeyCheck(applicationServerKey) {
    const keyStatus = applicationServerKey instanceof ArrayBuffer || ArrayBuffer.isView(applicationServerKey);

    //Rejecting empty and unbounded key buffers before the native PushManager call.
    return keyStatus && applicationServerKey.byteLength >= 1 && applicationServerKey.byteLength <= 4096;

}

/**
 * @param {unknown} shareData
 */
function shareDataCheck(shareData) {
    if (!plainObjectCheck(shareData)) {
        return false;

    }

    const shareRecord = /** @type {Record<string, unknown>} */ (shareData);
    const shareKeys = Object.keys(shareRecord);
    const knownKeys = new Set(['files', 'text', 'title', 'url']);

    const unknownShareKeyStatus = shareKeys.some(function unknownShareKeyCheck(shareKey) {
        //Rejecting dictionary members that WebIDL would otherwise silently discard.
        return !knownKeys.has(shareKey);

    });

    if (shareKeys.length < 1 || unknownShareKeyStatus) {
        return false;

    }

    return (shareRecord.files === undefined || Array.isArray(shareRecord.files)) &&
        (shareRecord.text === undefined || typeof shareRecord.text === 'string') &&
        (shareRecord.title === undefined || typeof shareRecord.title === 'string') &&
        (shareRecord.url === undefined || typeof shareRecord.url === 'string');

}

/**
 * @param {object} capabilityOptions
 * @param {Window} [capabilityOptions.window]
 * @param {Navigator} [capabilityOptions.navigator]
 * @param {typeof Notification} [capabilityOptions.notificationApi]
 * @param {() => Promise<ServiceWorkerRegistration>} [capabilityOptions.registrationGet]
 * @param {(requestData: {type: 'query' | 'command', operation: string, payload: Record<string, unknown>}) => Promise<any>} [capabilityOptions.pushRequest]
 * @param {() => string | null} [capabilityOptions.shareTargetIdGet]
 * @param {(shareIdentifier: string) => Promise<Readonly<Record<string, unknown>> | null>} [capabilityOptions.shareTargetConsume]
 * @param {(shareIdentifier: string) => Promise<boolean>} [capabilityOptions.shareTargetDiscard]
 * @param {(shareIdentifier: string) => void} [capabilityOptions.shareTargetIdClear]
 * @param {(errorData: unknown) => void} [capabilityOptions.onError]
 */
export function layerPwaCapabilitiesCreate(capabilityOptions = {}) {
    const windowData = capabilityOptions.window;
    const navigatorData = capabilityOptions.navigator;
    const protocolNavigatorData = /** @type {any} */ (navigatorData);
    const notificationApi = capabilityOptions.notificationApi;
    const launchQueueData = /** @type {any} */ (windowData)?.launchQueue;
    const launchBroker = layerLaunchBrokerCreate(launchQueueData, capabilityOptions.onError);
    let installPrompt = /** @type {any} */ (null);

    windowData?.addEventListener('beforeinstallprompt', function installPromptCapture(eventData) {
        //Retaining the browser-owned event without suppressing its native installation UI.
        installPrompt = eventData;

    });

    return Object.freeze({
        install: Object.freeze({
            getCapability() {
                const supportedStatus = installPrompt !== null;

                //Reporting whether the browser supplied a prompt for an explicit user action.
                return capabilityDataCreate(
                    supportedStatus,
                    'prompt',
                    capabilityReasonCreate(supportedStatus, 'ready', 'browser-prompt-not-captured')
                );

            },
            async prompt() {
                //Requiring an explicitly captured browser prompt and user gesture.
                if (installPrompt === null) {
                    throw unsupportedErrorCreate('Installation prompt');

                }

                const activeInstallPrompt = installPrompt;

                installPrompt = null;
                await activeInstallPrompt.prompt();
                const choiceData = await activeInstallPrompt.userChoice;

                return Object.freeze({
                    outcome: choiceData.outcome,
                    platform: choiceData.platform ?? null
                });

            }
        }),

        notifications: Object.freeze({
            getCapability() {
                const supportedStatus = notificationApi !== undefined;

                //Reporting the current permission without requesting it automatically.
                return capabilityDataCreate(
                    supportedStatus,
                    notificationApi?.permission ?? 'unavailable',
                    capabilityReasonCreate(supportedStatus, 'ready', 'notification-api-missing')
                );

            },
            async requestPermission() {
                //Delegating the permission prompt only from this explicit action.
                if (notificationApi === undefined) {
                    throw unsupportedErrorCreate('Notifications');

                }

                return notificationApi.requestPermission();

            },
            /**
             * @param {string} titleData
             * @param {NotificationOptions} [notificationOptions]
             */
            async show(titleData, notificationOptions = {}) {
                if (capabilityOptions.registrationGet === undefined) {
                    throw unsupportedErrorCreate('Persistent notifications');

                }

                if (typeof titleData !== 'string' || titleData.length < 1 || titleData.length > 160 ||
                    !plainObjectCheck(notificationOptions)) {
                    throw new TypeError('Notification input is invalid.');

                }

                const registrationData = await capabilityOptions.registrationGet();

                if (typeof registrationData.showNotification !== 'function') {
                    throw unsupportedErrorCreate('Persistent notifications');

                }

                //Requiring an existing permission grant before persistent notification display.
                if (notificationApi?.permission !== 'granted') {
                    throw new LayerPwaError(
                        'PWA_NOTIFICATION_PERMISSION_REQUIRED',
                        'Notification permission is required.'
                    );

                }

                await registrationData.showNotification(titleData, notificationOptions);

            },
            /**
             * @param {string} [tagData]
             */
            async list(tagData = '') {
                //Reading persistent notifications only through the active application registration.
                if (capabilityOptions.registrationGet === undefined) {
                    throw unsupportedErrorCreate('Persistent notifications');

                }

                const normalizedTag = notificationTagNormalize(tagData, true);
                const registrationData = await capabilityOptions.registrationGet();

                if (typeof registrationData.getNotifications !== 'function') {
                    throw unsupportedErrorCreate('Persistent notifications');

                }

                let notificationItems;

                if (normalizedTag.length > 0) {
                    notificationItems = await registrationData.getNotifications({
                        tag: normalizedTag
                    });

                } else {
                    notificationItems = await registrationData.getNotifications();

                }

                return Object.freeze([...notificationItems]);

            },
            /**
             * @param {string} tagData
             */
            async close(tagData) {
                const normalizedTag = notificationTagNormalize(tagData, false);

                if (capabilityOptions.registrationGet === undefined) {
                    throw unsupportedErrorCreate('Persistent notifications');

                }

                const registrationData = await capabilityOptions.registrationGet();

                if (typeof registrationData.getNotifications !== 'function') {
                    throw unsupportedErrorCreate('Persistent notifications');

                }

                const notificationItems = Object.freeze([
                    ...await registrationData.getNotifications({
                        tag: normalizedTag
                    })
                ]);

                //Closing every platform record sharing the application-owned tag.
                for (const notificationData of notificationItems) {
                    notificationData.close();

                }

                return notificationItems.length;

            }
        }),

        push: Object.freeze({
            async getCapability() {
                //Requiring a live Service Worker registration before PushManager detection.
                if (capabilityOptions.registrationGet === undefined) {
                    return capabilityDataCreate(false, 'unavailable', 'service-worker-registration-missing');

                }

                const registrationData = await capabilityOptions.registrationGet();
                const supportedStatus = registrationData.pushManager !== undefined;

                return capabilityDataCreate(
                    supportedStatus,
                    notificationApi?.permission ?? 'default',
                    capabilityReasonCreate(supportedStatus, 'ready', 'push-manager-missing')
                );

            },
            /**
             * @param {BufferSource} applicationServerKey
             */
            async subscribe(applicationServerKey) {
                //Creating a user-visible subscription only after explicit application action.
                if (capabilityOptions.registrationGet === undefined) {
                    throw unsupportedErrorCreate('Push');

                }

                const registrationData = await capabilityOptions.registrationGet();

                if (registrationData.pushManager === undefined) {
                    throw unsupportedErrorCreate('Push');

                }

                if (!applicationServerKeyCheck(applicationServerKey)) {
                    throw new TypeError('Push application server key is invalid.');

                }

                return registrationData.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey
                });

            },
            async getSubscription() {
                //Reading the one subscription associated with the application Service Worker.
                if (capabilityOptions.registrationGet === undefined) {
                    throw unsupportedErrorCreate('Push');

                }

                const registrationData = await capabilityOptions.registrationGet();

                if (typeof registrationData.pushManager?.getSubscription !== 'function') {
                    throw unsupportedErrorCreate('Push');

                }

                return registrationData.pushManager.getSubscription();

            },
            /**
             * @param {BufferSource} [applicationServerKey]
             */
            async permissionState(applicationServerKey) {
                if (capabilityOptions.registrationGet === undefined) {
                    throw unsupportedErrorCreate('Push');

                }

                if (applicationServerKey !== undefined && !applicationServerKeyCheck(applicationServerKey)) {
                    throw new TypeError('Push application server key is invalid.');

                }

                const registrationData = await capabilityOptions.registrationGet();

                if (typeof registrationData.pushManager?.permissionState !== 'function') {
                    throw unsupportedErrorCreate('Push');

                }

                const permissionOptions = /** @type {PushSubscriptionOptionsInit} */ ({
                    userVisibleOnly: true
                });

                if (applicationServerKey !== undefined) {
                    permissionOptions.applicationServerKey = applicationServerKey;

                }

                return registrationData.pushManager.permissionState(permissionOptions);

            },
            /** Enable server Web Push from a user gesture. Requires login and an online API.
             * The browser permission is requested only by this explicit call. */
            async enable(){
                //Starting permission acquisition while still in the user's action callback
                if ( !notificationApi || !capabilityOptions.registrationGet || !capabilityOptions.pushRequest ){
                    throw unsupportedErrorCreate( 'Server Web Push' );

                }

                const permissionData = await notificationApi.requestPermission();

                if ( permissionData !== 'granted' ){
                    throw new LayerPwaError( 'PWA_PUSH_PERMISSION_DENIED', 'Notification permission was not granted.' );

                }

                const configurationResultData = await capabilityOptions.pushRequest({type: 'query', operation: 'notifications.webpush.configuration', payload: {}});
                const publicKeyData = String( configurationResultData.data.publicKey );
                const binaryKeyData = atob( publicKeyData.replaceAll( '-', '+' ).replaceAll( '_', '/' ) );
                const keyBytesData = Uint8Array.from( binaryKeyData, function keyByteRead( characterData ){
                    return characterData.charCodeAt( 0 );

                });
                const registrationData = await capabilityOptions.registrationGet();
                const existingSubscriptionData = await registrationData.pushManager.getSubscription();
                const subscriptionData = existingSubscriptionData ?? await registrationData.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: keyBytesData});

                //Registering the device online; failure never enters the offline command queue
                const registrationResultData = await capabilityOptions.pushRequest({type: 'command', operation: 'notifications.webpush.subscription.register',
                    payload: {subscription: subscriptionData.toJSON()}});

                return registrationResultData.data;

            },
            /** Revoke this identity's server binding before unsubscribing locally. Online-only. */
            async disable(){
                if ( !capabilityOptions.registrationGet || !capabilityOptions.pushRequest ){
                    throw unsupportedErrorCreate( 'Server Web Push' );

                }

                const registrationData = await capabilityOptions.registrationGet();
                const subscriptionData = await registrationData.pushManager.getSubscription();

                if ( subscriptionData === null ){
                    return {revoked: false};

                }

                const resultData = await capabilityOptions.pushRequest({type: 'command', operation: 'notifications.webpush.subscription.revoke', payload: {endpoint: subscriptionData.endpoint}});
                await subscriptionData.unsubscribe();

                return resultData.data;

            },
            async unsubscribe() {
                if (capabilityOptions.registrationGet === undefined) {
                    throw unsupportedErrorCreate('Push');

                }

                const registrationData = await capabilityOptions.registrationGet();

                if (typeof registrationData.pushManager?.getSubscription !== 'function') {
                    throw unsupportedErrorCreate('Push');

                }

                const subscriptionData = await registrationData.pushManager.getSubscription();

                //Treating an absent subscription as an idempotent completed removal.
                if (subscriptionData === null) {
                    return false;

                }

                return subscriptionData.unsubscribe();

            }
        }),

        backgroundSync: Object.freeze({
            async getCapability() {
                //Checking SyncManager on the active registration instead of the user agent.
                if (capabilityOptions.registrationGet === undefined) {
                    return capabilityDataCreate(false, 'unavailable', 'service-worker-registration-missing');

                }

                const registrationData = /** @type {any} */ (await capabilityOptions.registrationGet());
                const supportedStatus = registrationData.sync !== undefined;

                return capabilityDataCreate(
                    supportedStatus,
                    'granted',
                    capabilityReasonCreate(supportedStatus, 'ready', 'sync-manager-missing')
                );

            },
            async register(tagData = 'layer-outbox') {
                //Registering one bounded sync tag while preserving app-start fallback.
                if (capabilityOptions.registrationGet === undefined) {
                    throw unsupportedErrorCreate('Background Sync');

                }

                const registrationData = /** @type {any} */ (await capabilityOptions.registrationGet());

                if (registrationData.sync === undefined) {
                    throw unsupportedErrorCreate('Background Sync');

                }

                if (typeof tagData !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(tagData)) {
                    throw new TypeError('Background Sync tag is invalid.');

                }

                await registrationData.sync.register(tagData);

            }
        }),

        badge: Object.freeze({
            getCapability() {
                const supportedStatus = typeof /** @type {any} */ (navigatorData)?.setAppBadge === 'function';

                //Detecting badging by callable API presence.
                return capabilityDataCreate(
                    supportedStatus,
                    'granted',
                    capabilityReasonCreate(supportedStatus, 'ready', 'badge-api-missing')
                );

            },
            async set(/** @type {number | undefined} */ countData = undefined) {
                const setBadge = /** @type {any} */ (navigatorData)?.setAppBadge;

                if (typeof setBadge !== 'function') {
                    throw unsupportedErrorCreate('Badging');

                }

                if (countData !== undefined &&
                    (!Number.isSafeInteger(countData) || countData < 0)) {
                    throw new TypeError('Application badge count is invalid.');

                }

                if (countData === undefined) {
                    await setBadge.call(navigatorData);

                } else {
                    await setBadge.call(navigatorData, countData);

                }

            },
            async clear() {
                const clearBadge = /** @type {any} */ (navigatorData)?.clearAppBadge;

                if (typeof clearBadge !== 'function') {
                    throw unsupportedErrorCreate('Badging');

                }

                await clearBadge.call(navigatorData);

            }
        }),

        share: Object.freeze({
            getCapability() {
                const supportedStatus = typeof navigatorData?.share === 'function';

                //Detecting native share without inventing a polyfill.
                return capabilityDataCreate(
                    supportedStatus,
                    'granted',
                    capabilityReasonCreate(supportedStatus, 'ready', 'web-share-missing')
                );

            },
            canSend(/** @type {ShareData} */ shareData) {
                //Checking every known share member before delegating to the browser validator.
                if (!shareDataCheck(shareData) || typeof navigatorData?.canShare !== 'function') {
                    return false;

                }

                return navigatorData.canShare(shareData);

            },
            async send(/** @type {ShareData} */ shareData) {
                //Invoking native share only through an explicit user action.
                if (typeof navigatorData?.share !== 'function') {
                    throw unsupportedErrorCreate('Web Share');

                }

                if (!shareDataCheck(shareData)) {
                    throw new TypeError('Web Share data is invalid.');

                }

                await navigatorData.share(shareData);

            }
        }),

        shareTarget: Object.freeze({
            getCapability() {
                const supportedStatus = typeof capabilityOptions.shareTargetIdGet === 'function' &&
                    typeof capabilityOptions.shareTargetConsume === 'function' &&
                    typeof capabilityOptions.shareTargetDiscard === 'function';

                //Reporting generated manifest support instead of guessing from the browser user agent.
                return capabilityDataCreate(
                    supportedStatus,
                    'granted',
                    capabilityReasonCreate(supportedStatus, 'ready', 'manifest-share-target-missing')
                );

            },
            pendingIdGet() {
                if (typeof capabilityOptions.shareTargetIdGet !== 'function') {
                    return null;

                }

                //Returning only the opaque redirect identifier, never the shared payload.
                return capabilityOptions.shareTargetIdGet();

            },
            /**
             * @param {string | null} [shareIdentifier]
             */
            async consume(shareIdentifier = null) {
                if (typeof capabilityOptions.shareTargetIdGet !== 'function' ||
                    typeof capabilityOptions.shareTargetConsume !== 'function') {
                    throw unsupportedErrorCreate('Web Share Target');

                }

                let selectedIdentifier = shareIdentifier;

                if (selectedIdentifier === null) {
                    //Selecting the current redirect identifier when the application omits one.
                    selectedIdentifier = capabilityOptions.shareTargetIdGet();

                }

                if (selectedIdentifier === null) {
                    return null;

                }

                const sharedRecord = await capabilityOptions.shareTargetConsume(selectedIdentifier);

                capabilityOptions.shareTargetIdClear?.(selectedIdentifier);

                return sharedRecord;

            },
            /**
             * @param {string | null} [shareIdentifier]
             */
            async discard(shareIdentifier = null) {
                if (typeof capabilityOptions.shareTargetIdGet !== 'function' ||
                    typeof capabilityOptions.shareTargetDiscard !== 'function') {
                    throw unsupportedErrorCreate('Web Share Target');

                }

                let selectedIdentifier = shareIdentifier;

                if (selectedIdentifier === null) {
                    //Selecting the current redirect identifier when the application omits one.
                    selectedIdentifier = capabilityOptions.shareTargetIdGet();

                }

                if (selectedIdentifier === null) {
                    return false;

                }

                const discardStatus = await capabilityOptions.shareTargetDiscard(selectedIdentifier);

                capabilityOptions.shareTargetIdClear?.(selectedIdentifier);

                return discardStatus;

            }
        }),

        files: Object.freeze({
            getCapability() {
                const supportedStatus = typeof launchQueueData?.setConsumer === 'function';

                //Advertising ordinary file input as the explicit fallback.
                return capabilityDataCreate(
                    supportedStatus,
                    'granted',
                    capabilityReasonCreate(supportedStatus, 'ready', 'use-file-input-fallback')
                );

            },
            /**
             * @param {(files: readonly FileSystemHandle[], targetUrl: string | null) => unknown} fileConsumer
             */
            setConsumer(fileConsumer) {
                //Checking the application callback before assigning the single native launch consumer.
                if (typeof fileConsumer !== 'function') {
                    throw new TypeError('File launch consumer must be a function.');

                }

                if (typeof launchQueueData?.setConsumer !== 'function') {
                    throw unsupportedErrorCreate('File Handling');

                }

                //Sharing the native queue without replacing application or router delivery
                launchBroker.setFileConsumer(fileConsumer);

            }
        }),

        protocols: Object.freeze({
            getCapability() {
                const supportedStatus = typeof navigatorData?.registerProtocolHandler === 'function';

                //Detecting protocol registration without calling its browser prompt.
                return capabilityDataCreate(
                    supportedStatus,
                    'prompt',
                    capabilityReasonCreate(supportedStatus, 'ready', 'protocol-handler-missing')
                );

            },
            /**
             * @param {string} schemeData
             * @param {string} handlerUrl
             */
            register(schemeData, handlerUrl) {
                //Checking browser support before presenting its registration prompt.
                if (typeof navigatorData?.registerProtocolHandler !== 'function') {
                    throw unsupportedErrorCreate('Protocol Handling');

                }

                const protocolHandlerData = protocolHandlerInputNormalize(schemeData, handlerUrl);

                navigatorData.registerProtocolHandler(protocolHandlerData.scheme, protocolHandlerData.url);

            },
            /**
             * @param {string} schemeData
             * @param {string} handlerUrl
             */
            unregister(schemeData, handlerUrl) {
                //Keeping removal explicit because support differs from registration support.
                if (typeof protocolNavigatorData?.unregisterProtocolHandler !== 'function') {
                    throw unsupportedErrorCreate('Protocol Handler removal');

                }

                const protocolHandlerData = protocolHandlerInputNormalize(schemeData, handlerUrl);

                protocolNavigatorData.unregisterProtocolHandler(protocolHandlerData.scheme, protocolHandlerData.url);

            }
        }),

        launch: Object.freeze({
            getCapability() {
                const supportedStatus = typeof launchQueueData?.setConsumer === 'function';

                //Reporting launch queue support independently from file handling.
                return capabilityDataCreate(
                    supportedStatus,
                    'granted',
                    capabilityReasonCreate(supportedStatus, 'ready', 'launch-queue-missing')
                );

            },
            /**
             * @param {(launchData: Readonly<{targetUrl: string | null, files: readonly FileSystemHandle[]}>) => unknown} launchConsumer
             */
            setConsumer(launchConsumer) {
                //Checking the application callback before assigning the single native launch consumer.
                if (typeof launchConsumer !== 'function') {
                    throw new TypeError('Application launch consumer must be a function.');

                }

                if (typeof launchQueueData?.setConsumer !== 'function') {
                    throw unsupportedErrorCreate('Launch Queue');

                }

                //Replacing only the application callback slot in the shared native broker
                launchBroker.setConsumer(launchConsumer);

            },
            setDefaultConsumer: launchBroker.setDefaultConsumer,
            hasConsumer: launchBroker.hasConsumer,
            startupComplete: launchBroker.startupComplete,
            dispose: launchBroker.dispose
        }),

        storage: Object.freeze({
            getCapability() {
                const storageData = navigatorData?.storage;
                const supportedStatus = typeof storageData?.persist === 'function' &&
                    typeof storageData.persisted === 'function' &&
                    typeof storageData.estimate === 'function';

                //Detecting StorageManager before offering persistence controls.
                return capabilityDataCreate(
                    supportedStatus,
                    'prompt',
                    capabilityReasonCreate(supportedStatus, 'ready', 'storage-manager-missing')
                );

            },
            async persist() {
                //Requesting persistence only through this explicit application action.
                if (typeof navigatorData?.storage?.persist !== 'function') {
                    throw unsupportedErrorCreate('Persistent storage');

                }

                return navigatorData.storage.persist();

            },
            async persisted() {
                //Reading persistence state without triggering a permission prompt.
                if (typeof navigatorData?.storage?.persisted !== 'function') {
                    throw unsupportedErrorCreate('Persistent storage');

                }

                return navigatorData.storage.persisted();

            },
            async estimate() {
                //Returning the browser's intentionally approximate usage and quota values.
                if (typeof navigatorData?.storage?.estimate !== 'function') {
                    throw unsupportedErrorCreate('Storage estimate');

                }

                const estimateData = await navigatorData.storage.estimate();

                return Object.freeze({
                    usage: estimateData.usage ?? null,
                    quota: estimateData.quota ?? null
                });

            }
        }),

        network: Object.freeze({
            getCapability() {
                const supportedStatus = navigatorData !== undefined;

                //Marking online state as a diagnostic hint rather than reachability proof.
                return capabilityDataCreate(
                    supportedStatus,
                    'granted',
                    capabilityReasonCreate(supportedStatus, 'diagnostic-only', 'navigator-missing')
                );

            },
            isOnlineHint() {
                //Returning only a browser hint; successful requests remain authoritative.
                return navigatorData?.onLine ?? false;

            }
        })
    });

}
