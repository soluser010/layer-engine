import {LayerPwaError} from './pwa-error.js';
import {layerWebAppManifestCreate} from './web-app-manifest.js';

const standardManifestKeySet = new Set([
    'background_color',
    'description',
    'dir',
    'display',
    'file_handlers',
    'icons',
    'id',
    'lang',
    'launch_handler',
    'name',
    'orientation',
    'protocol_handlers',
    'scope',
    'scope_extensions',
    'share_target',
    'short_name',
    'shortcuts',
    'start_url',
    'theme_color'
]);

/**
 * @param {unknown} objectData
 */
function plainObjectCheck(objectData) {
    //Rejecting arrays and custom prototypes before reading browser metadata.
    if (typeof objectData !== 'object' || objectData === null || Array.isArray(objectData)) {
        return false;

    }

    const objectPrototype = Object.getPrototypeOf(objectData);

    return objectPrototype === Object.prototype || objectPrototype === null;

}

/**
 * @param {Record<string, unknown>} objectData
 * @param {ReadonlySet<string>} allowedKeySet
 */
function standardKeysCheck(objectData, allowedKeySet) {
    //Checking every standard field so misspelled metadata cannot disappear during mapping.
    return Object.keys(objectData).every(function standardManifestKeyCheck(keyData) {
        //Checking this source key against its standard manifest object.
        return allowedKeySet.has(keyData);

    });

}

/**
 * @param {string} messageData
 * @returns {never}
 */
function standardManifestReject(messageData) {
    //Publishing one safe validation error without returning manifest input values.
    throw new LayerPwaError('PWA_WEB_MANIFEST_INVALID', messageData);

}

/**
 * @param {unknown} shortcutData
 */
function standardShortcutMap(shortcutData) {
    if (!plainObjectCheck(shortcutData)) {
        standardManifestReject('A standard web app shortcut is invalid.');

    }

    const shortcutRecord = /** @type {Record<string, unknown>} */ (shortcutData);

    if (!standardKeysCheck(shortcutRecord, new Set(['description', 'icons', 'name', 'short_name', 'url']))) {
        standardManifestReject('A standard web app shortcut is invalid.');

    }

    return {
        name: shortcutRecord.name,
        shortName: shortcutRecord.short_name,
        description: shortcutRecord.description,
        url: shortcutRecord.url,
        icons: shortcutRecord.icons
    };

}

/**
 * @param {unknown} fileHandlerData
 */
function standardFileHandlerMap(fileHandlerData) {
    if (!plainObjectCheck(fileHandlerData)) {
        standardManifestReject('A standard web app file handler is invalid.');

    }

    const fileHandlerRecord = /** @type {Record<string, unknown>} */ (fileHandlerData);

    if (!standardKeysCheck(fileHandlerRecord, new Set(['accept', 'action', 'icons', 'launch_type', 'name']))) {
        standardManifestReject('A standard web app file handler is invalid.');

    }

    return {
        action: fileHandlerRecord.action,
        accept: fileHandlerRecord.accept,
        name: fileHandlerRecord.name,
        icons: fileHandlerRecord.icons,
        launchType: fileHandlerRecord.launch_type
    };

}

/**
 * @param {unknown} protocolHandlerData
 */
function standardProtocolHandlerMap(protocolHandlerData) {
    if (!plainObjectCheck(protocolHandlerData)) {
        standardManifestReject('A standard web app protocol handler is invalid.');

    }

    const protocolHandlerRecord = /** @type {Record<string, unknown>} */ (protocolHandlerData);

    if (!standardKeysCheck(protocolHandlerRecord, new Set(['protocol', 'url']))) {
        standardManifestReject('A standard web app protocol handler is invalid.');

    }

    return {
        protocol: protocolHandlerRecord.protocol,
        url: protocolHandlerRecord.url
    };

}

/**
 * @param {unknown} launchHandlerData
 */
function standardLaunchHandlerMap(launchHandlerData) {
    if (!plainObjectCheck(launchHandlerData)) {
        standardManifestReject('A standard web app launch handler is invalid.');

    }

    const launchHandlerRecord = /** @type {Record<string, unknown>} */ (launchHandlerData);

    if (!standardKeysCheck(launchHandlerRecord, new Set(['client_mode']))) {
        standardManifestReject('A standard web app launch handler is invalid.');

    }

    return {
        clientMode: launchHandlerRecord.client_mode
    };

}

/**
 * @param {unknown} manifestData
 */
export function layerWebAppManifestValidate(manifestData) {
    //Checking the standard JSON root before translating its snake-case members.
    if (!plainObjectCheck(manifestData)) {
        standardManifestReject('The standard web app manifest is invalid.');

    }

    const manifestRecord = /** @type {Record<string, unknown>} */ (manifestData);

    if (!standardKeysCheck(manifestRecord, standardManifestKeySet)) {
        standardManifestReject('The standard web app manifest contains an unknown member.');

    }

    let shortcutItems = manifestRecord.shortcuts;
    let fileHandlerItems = manifestRecord.file_handlers;
    let protocolHandlerItems = manifestRecord.protocol_handlers;
    let launchHandlerData = manifestRecord.launch_handler;

    if (Array.isArray(shortcutItems)) {
        //Mapping every shortcut without discarding unknown nested members.
        shortcutItems = shortcutItems.map(standardShortcutMap);

    }

    if (Array.isArray(fileHandlerItems)) {
        //Mapping every file handler into the generator's public option names.
        fileHandlerItems = fileHandlerItems.map(standardFileHandlerMap);

    }

    if (Array.isArray(protocolHandlerItems)) {
        //Mapping every protocol handler into the generator's public option names.
        protocolHandlerItems = protocolHandlerItems.map(standardProtocolHandlerMap);

    }

    if (launchHandlerData !== undefined) {
        //Mapping the launch handler only when the standard manifest declares it.
        launchHandlerData = standardLaunchHandlerMap(launchHandlerData);

    }

    const manifestOptions = {
        name: manifestRecord.name,
        shortName: manifestRecord.short_name,
        description: manifestRecord.description,
        startUrl: manifestRecord.start_url,
        icons: manifestRecord.icons,
        id: manifestRecord.id,
        lang: manifestRecord.lang,
        dir: manifestRecord.dir,
        orientation: manifestRecord.orientation,
        scope: manifestRecord.scope,
        display: manifestRecord.display,
        themeColor: manifestRecord.theme_color,
        backgroundColor: manifestRecord.background_color,
        shortcuts: shortcutItems,
        fileHandlers: fileHandlerItems,
        protocolHandlers: protocolHandlerItems,
        shareTarget: manifestRecord.share_target,
        launchHandler: launchHandlerData
    };

    //Checking extension objects before passing origins to the shared validator
    if (manifestRecord.scope_extensions !== undefined) {
        if (!Array.isArray(manifestRecord.scope_extensions)) {
            standardManifestReject('scope_extensions must be an array.');

        }
        /** @type {Record<string, unknown>} */ (manifestOptions).scopeExtensions =
            /** @type {any[]} */ (manifestRecord.scope_extensions).map(function(extensionData) {
                //Rejecting unknown fields instead of hiding malformed association input
                if (!plainObjectCheck(extensionData) || !standardKeysCheck(extensionData, new Set(['type', 'origin'])) ||
                    extensionData.type !== 'origin') {
                    standardManifestReject('A scope extension must declare type origin.');

                }

                return extensionData.origin;

            });

    }
    //Creating one canonical immutable manifest through the shared strict contract.
    return layerWebAppManifestCreate(/** @type {any} */ (manifestOptions));

}
