import {LayerPwaError} from './pwa-error.js';
import {layerLinksConfigurationCreate} from './links-configuration.js';

const displayModeSet = new Set([
    'browser',
    'fullscreen',
    'minimal-ui',
    'standalone',
    'window-controls-overlay'
]);
const directionSet = new Set([
    'auto',
    'ltr',
    'rtl'
]);
const orientationSet = new Set([
    'any',
    'landscape',
    'landscape-primary',
    'landscape-secondary',
    'natural',
    'portrait',
    'portrait-primary',
    'portrait-secondary'
]);
const launchClientModeSet = new Set([
    'auto',
    'focus-existing',
    'navigate-existing',
    'navigate-new'
]);
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
const mimeTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const parameterNamePattern = /^[A-Za-z0-9_.-]{1,80}$/;
const manifestRootOptionKeySet = new Set([
    'scopeExtensions',
    'backgroundColor',
    'description',
    'dir',
    'display',
    'fileHandlers',
    'icons',
    'id',
    'lang',
    'launchHandler',
    'name',
    'orientation',
    'protocolHandlers',
    'scope',
    'shareTarget',
    'shortName',
    'shortcuts',
    'startUrl',
    'themeColor'
]);

/**
 * @typedef {Readonly<{
 *     src: string,
 *     sizes?: string,
 *     type?: string,
 *     purpose?: string
 * }>} LayerManifestIconOptions
 */

/**
 * @typedef {Readonly<{
 *     name: string,
 *     url: string,
 *     shortName?: string,
 *     description?: string,
 *     icons?: readonly LayerManifestIconOptions[]
 * }>} LayerManifestShortcutOptions
 */

/**
 * @typedef {Readonly<{
 *     action: string,
 *     accept: Readonly<Record<string, readonly string[]>>,
 *     name?: string,
 *     icons?: readonly LayerManifestIconOptions[],
 *     launchType?: 'single-client' | 'multiple-clients'
 * }>} LayerManifestFileHandlerOptions
 */

/**
 * @typedef {Readonly<{
 *     protocol: string,
 *     url: string
 * }>} LayerManifestProtocolHandlerOptions
 */

/**
 * @typedef {Readonly<{
 *     name: string,
 *     accept: readonly string[]
 * }>} LayerManifestShareFileOptions
 */

/**
 * @typedef {Readonly<{
 *     action: string,
 *     method: 'GET' | 'POST' | 'get' | 'post',
 *     enctype: 'application/x-www-form-urlencoded' | 'multipart/form-data',
 *     params: Readonly<{
 *         title?: string,
 *         text?: string,
 *         url?: string,
 *         files?: readonly LayerManifestShareFileOptions[]
 *     }>
 * }>} LayerManifestShareTargetOptions
 */

/**
 * @typedef {'auto' | 'focus-existing' | 'navigate-existing' | 'navigate-new'} LayerManifestClientMode
 */

/**
 * @typedef {Readonly<{
 *     clientMode: LayerManifestClientMode | readonly LayerManifestClientMode[]
 * }>} LayerManifestLaunchHandlerOptions
 */

/**
 * @typedef {Readonly<{
 *     name: string,
 *     shortName: string,
 *     startUrl: string,
 *     icons: readonly Readonly<{src: string, sizes: string, type: string, purpose?: string}>[],
 *     description?: string,
 *     id?: string,
 *     lang?: string,
 *     dir?: 'auto' | 'ltr' | 'rtl',
 *     orientation?: 'any' | 'natural' | 'landscape' | 'portrait' | 'portrait-primary' |
 *         'portrait-secondary' | 'landscape-primary' | 'landscape-secondary',
 *     scope?: string,
 *     scopeExtensions?: readonly string[],
 *     display?: 'browser' | 'fullscreen' | 'minimal-ui' | 'standalone' | 'window-controls-overlay',
 *     themeColor?: string,
 *     backgroundColor?: string,
 *     shortcuts?: readonly LayerManifestShortcutOptions[],
 *     fileHandlers?: readonly LayerManifestFileHandlerOptions[],
 *     protocolHandlers?: readonly LayerManifestProtocolHandlerOptions[],
 *     shareTarget?: LayerManifestShareTargetOptions,
 *     launchHandler?: LayerManifestLaunchHandlerOptions
 * }>} LayerWebAppManifestOptions
 */

/**
 * @param {string} messageData
 * @returns {never}
 */
function manifestReject(messageData) {
    //Publishing one safe manifest failure without exposing developer data.
    throw new LayerPwaError('PWA_WEB_MANIFEST_INVALID', messageData);

}

/**
 * @param {unknown} objectData
 */
function plainObjectCheck(objectData) {
    //Rejecting arrays and prototype-shaped values from manifest metadata.
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
function knownKeysCheck(objectData, allowedKeySet) {
    //Checking every declared field so a manifest typo cannot be silently ignored.
    return Object.keys(objectData).every(function manifestKeyCheck(keyData) {
        //Checking this manifest key against the contract for its current object.
        return allowedKeySet.has(keyData);

    });

}

/**
 * @param {string} pathData
 * @param {string} scopeData
 * @param {boolean} [placeholderRequired]
 */
function manifestPathValidate(pathData, scopeData, placeholderRequired = false) {
    const pathStatus = typeof pathData === 'string' &&
        pathData.length >= 1 && pathData.length <= 2048 &&
        pathData.startsWith('/') && !pathData.startsWith('//') &&
        !pathData.includes('\\');

    if (!pathStatus || (placeholderRequired && !pathData.includes('%s'))) {
        return false;

    }

    let pathUrl;

    try {
        //Resolving against a fixed origin to inspect only path and scope semantics.
        pathUrl = new URL(pathData.replace('%s', 'layer-value'), 'https://layer.invalid');

    } catch (pathError) {
        //Treating an invalid URL as a manifest contract failure.
        void pathError;

        return false;

    }

    let normalizedScope = scopeData;

    if (!normalizedScope.endsWith('/')) {
        normalizedScope = `${normalizedScope}/`;

    }

    return pathUrl.pathname === scopeData || pathUrl.pathname.startsWith(normalizedScope);

}

/**
 * @param {unknown} textData
 * @param {number} maximumLength
 */
function optionalTextValidate(textData, maximumLength) {
    //Allowing absence while rejecting empty or oversized declared metadata.
    return textData === undefined ||
        (typeof textData === 'string' && textData.length >= 1 && textData.length <= maximumLength);

}

/**
 * @param {unknown} iconData
 * @param {boolean} sizesRequired
 */
function manifestIconNormalize(iconData, sizesRequired) {
    if (!plainObjectCheck(iconData)) {
        manifestReject('A web app manifest icon is invalid.');

    }

    const iconRecord = /** @type {Record<string, unknown>} */ (iconData);
    const iconSizes = iconRecord.sizes;
    const iconType = iconRecord.type;
    const iconPurpose = iconRecord.purpose;
    let sizesStatus = !sizesRequired;

    if (iconSizes !== undefined) {
        sizesStatus = typeof iconSizes === 'string' &&
            (iconSizes === 'any' || /^\d+x\d+(?: \d+x\d+)*$/.test(iconSizes));

    }
    const typeStatus = iconType === undefined ||
        (typeof iconType === 'string' && mimeTypePattern.test(iconType));
    const purposeStatus = iconPurpose === undefined ||
        (typeof iconPurpose === 'string' && iconPurpose.split(' ').every(function iconPurposeCheck(purposeData) {
            //Restricting icon purposes to the current manifest vocabulary.
            return ['any', 'maskable', 'monochrome'].includes(purposeData);

        }));

    //Restricting every icon to known metadata and a same-origin relative resource.
    if (!knownKeysCheck(iconRecord, new Set(['purpose', 'sizes', 'src', 'type'])) ||
        typeof iconRecord.src !== 'string' || iconRecord.src.length > 2048 ||
        !iconRecord.src.startsWith('/') || iconRecord.src.startsWith('//') ||
        !sizesStatus || !typeStatus || !purposeStatus) {
        manifestReject('A web app manifest icon is invalid.');

    }

    const normalizedIcon = /** @type {Record<string, unknown>} */ ({
        src: iconRecord.src
    });

    if (iconSizes !== undefined) {
        normalizedIcon.sizes = iconSizes;

    }

    if (iconType !== undefined) {
        normalizedIcon.type = iconType;

    }

    if (iconPurpose !== undefined) {
        normalizedIcon.purpose = iconPurpose;

    }

    return Object.freeze(normalizedIcon);

}

/**
 * @param {unknown} shortcutData
 * @param {string} scopeData
 */
function manifestShortcutNormalize(shortcutData, scopeData) {
    if (!plainObjectCheck(shortcutData)) {
        manifestReject('A web app manifest shortcut is invalid.');

    }

    const shortcutRecord = /** @type {Record<string, unknown>} */ (shortcutData);

    if (!knownKeysCheck(shortcutRecord, new Set(['description', 'icons', 'name', 'shortName', 'url'])) ||
        typeof shortcutRecord.name !== 'string' || shortcutRecord.name.length < 1 ||
        shortcutRecord.name.length > 160 || typeof shortcutRecord.url !== 'string' ||
        !manifestPathValidate(shortcutRecord.url, scopeData) ||
        !optionalTextValidate(shortcutRecord.shortName, 32) ||
        !optionalTextValidate(shortcutRecord.description, 500) ||
        (shortcutRecord.icons !== undefined && !Array.isArray(shortcutRecord.icons))) {
        manifestReject('A web app manifest shortcut is invalid.');

    }

    const normalizedShortcut = /** @type {Record<string, unknown>} */ ({
        name: shortcutRecord.name,
        url: shortcutRecord.url
    });

    if (shortcutRecord.shortName !== undefined) {
        normalizedShortcut.short_name = shortcutRecord.shortName;

    }

    if (shortcutRecord.description !== undefined) {
        normalizedShortcut.description = shortcutRecord.description;

    }

    if (Array.isArray(shortcutRecord.icons)) {
        normalizedShortcut.icons = Object.freeze(shortcutRecord.icons.map(function shortcutIconNormalize(iconData) {
            //Normalizing each optional shortcut icon through the shared image contract.
            return manifestIconNormalize(iconData, false);

        }));

    }

    return Object.freeze(normalizedShortcut);

}

/**
 * @param {unknown} fileHandlerData
 * @param {string} scopeData
 */
function manifestFileHandlerNormalize(fileHandlerData, scopeData) {
    if (!plainObjectCheck(fileHandlerData)) {
        manifestReject('A web app manifest file handler is invalid.');

    }

    const fileHandlerRecord = /** @type {Record<string, unknown>} */ (fileHandlerData);

    if (!knownKeysCheck(fileHandlerRecord, new Set(['accept', 'action', 'icons', 'launchType', 'name'])) ||
        typeof fileHandlerRecord.action !== 'string' ||
        !manifestPathValidate(fileHandlerRecord.action, scopeData) ||
        !plainObjectCheck(fileHandlerRecord.accept) ||
        !optionalTextValidate(fileHandlerRecord.name, 160) ||
        (fileHandlerRecord.launchType !== undefined &&
            (typeof fileHandlerRecord.launchType !== 'string' ||
                !['single-client', 'multiple-clients'].includes(fileHandlerRecord.launchType))) ||
        (fileHandlerRecord.icons !== undefined && !Array.isArray(fileHandlerRecord.icons))) {
        manifestReject('A web app manifest file handler is invalid.');

    }

    const acceptEntries = Object.entries(/** @type {Record<string, unknown>} */ (fileHandlerRecord.accept));

    if (acceptEntries.length < 1 || acceptEntries.length > 32) {
        manifestReject('A web app manifest file handler is invalid.');

    }

    const normalizedAccept = /** @type {Record<string, readonly string[]>} */ ({});

    for (const [mimeTypeData, extensionData] of acceptEntries) {
        const extensionsStatus = Array.isArray(extensionData) &&
            extensionData.length >= 1 && extensionData.length <= 32 &&
            extensionData.every(function fileExtensionCheck(extensionItem) {
                //Enforcing the manifest incubation limit and extension syntax.
                return typeof extensionItem === 'string' && extensionItem.length <= 16 &&
                    /^\.[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(extensionItem);

            });

        if (!mimeTypePattern.test(mimeTypeData) || !extensionsStatus) {
            manifestReject('A web app manifest file handler accept map is invalid.');

        }

        normalizedAccept[mimeTypeData] = Object.freeze([.../** @type {string[]} */ (extensionData)]);

    }

    const normalizedFileHandler = /** @type {Record<string, unknown>} */ ({
        action: fileHandlerRecord.action,
        accept: Object.freeze(normalizedAccept)
    });

    if (fileHandlerRecord.name !== undefined) {
        normalizedFileHandler.name = fileHandlerRecord.name;

    }

    if (fileHandlerRecord.launchType !== undefined) {
        normalizedFileHandler.launch_type = fileHandlerRecord.launchType;

    }

    if (Array.isArray(fileHandlerRecord.icons)) {
        normalizedFileHandler.icons = Object.freeze(fileHandlerRecord.icons.map(function fileIconNormalize(iconData) {
            //Normalizing optional OS file-type icons without requiring explicit sizes.
            return manifestIconNormalize(iconData, false);

        }));

    }

    return Object.freeze(normalizedFileHandler);

}

/**
 * @param {unknown} protocolHandlerData
 * @param {string} scopeData
 */
function manifestProtocolHandlerNormalize(protocolHandlerData, scopeData) {
    if (!plainObjectCheck(protocolHandlerData)) {
        manifestReject('A web app manifest protocol handler is invalid.');

    }

    const protocolHandlerRecord = /** @type {Record<string, unknown>} */ (protocolHandlerData);
    let normalizedProtocol = '';

    if (typeof protocolHandlerRecord.protocol === 'string') {
        normalizedProtocol = protocolHandlerRecord.protocol.toLowerCase();

    }
    const protocolStatus = protocolHandlerSafeSchemes.has(normalizedProtocol) ||
        /^web\+[a-z]+$/.test(normalizedProtocol);

    if (!knownKeysCheck(protocolHandlerRecord, new Set(['protocol', 'url'])) ||
        !protocolStatus || typeof protocolHandlerRecord.url !== 'string' ||
        !manifestPathValidate(protocolHandlerRecord.url, scopeData, true)) {
        manifestReject('A web app manifest protocol handler is invalid.');

    }

    return Object.freeze({
        protocol: normalizedProtocol,
        url: protocolHandlerRecord.url
    });

}

/**
 * @param {unknown} shareFileData
 */
function manifestShareFileNormalize(shareFileData) {
    if (!plainObjectCheck(shareFileData)) {
        manifestReject('A web share target file parameter is invalid.');

    }

    const shareFileRecord = /** @type {Record<string, unknown>} */ (shareFileData);
    const acceptStatus = Array.isArray(shareFileRecord.accept) &&
        shareFileRecord.accept.length >= 1 && shareFileRecord.accept.length <= 32 &&
        shareFileRecord.accept.every(function shareAcceptCheck(acceptData) {
            //Accepting MIME types and bounded dot-prefixed extensions.
            return typeof acceptData === 'string' &&
                (mimeTypePattern.test(acceptData) ||
                    (/^\.[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(acceptData) && acceptData.length <= 16));

        });

    if (!knownKeysCheck(shareFileRecord, new Set(['accept', 'name'])) ||
        typeof shareFileRecord.name !== 'string' ||
        !parameterNamePattern.test(shareFileRecord.name) || !acceptStatus) {
        manifestReject('A web share target file parameter is invalid.');

    }

    return Object.freeze({
        name: shareFileRecord.name,
        accept: Object.freeze([.../** @type {string[]} */ (shareFileRecord.accept)])
    });

}

/**
 * @param {unknown} shareTargetData
 * @param {string} scopeData
 */
function manifestShareTargetNormalize(shareTargetData, scopeData) {
    if (!plainObjectCheck(shareTargetData)) {
        manifestReject('The web share target is invalid.');

    }

    const shareTargetRecord = /** @type {Record<string, unknown>} */ (shareTargetData);
    let shareParamsRecord = /** @type {Record<string, unknown> | null} */ (null);
    let methodData = '';
    let enctypeData = '';

    if (plainObjectCheck(shareTargetRecord.params)) {
        shareParamsRecord = /** @type {Record<string, unknown>} */ (shareTargetRecord.params);

    }

    if (typeof shareTargetRecord.method === 'string') {
        methodData = shareTargetRecord.method.toUpperCase();

    }

    if (typeof shareTargetRecord.enctype === 'string') {
        enctypeData = shareTargetRecord.enctype.toLowerCase();

    }

    if (!knownKeysCheck(shareTargetRecord, new Set(['action', 'enctype', 'method', 'params'])) ||
        typeof shareTargetRecord.action !== 'string' ||
        !manifestPathValidate(shareTargetRecord.action, scopeData) ||
        new URL(shareTargetRecord.action, 'https://layer.invalid').searchParams.has('layerShareId') ||
        !['GET', 'POST'].includes(methodData) ||
        !['application/x-www-form-urlencoded', 'multipart/form-data'].includes(enctypeData) ||
        shareParamsRecord === null) {
        manifestReject('The web share target is invalid.');

    }

    const validatedShareParams = /** @type {Record<string, unknown>} */ (shareParamsRecord);
    const normalizedParams = /** @type {Record<string, unknown>} */ ({});

    if (!knownKeysCheck(validatedShareParams, new Set(['files', 'text', 'title', 'url']))) {
        manifestReject('The web share target parameters are invalid.');

    }

    for (const parameterName of ['title', 'text', 'url']) {
        const mappedName = validatedShareParams[parameterName];

        if (mappedName !== undefined) {
            if (typeof mappedName !== 'string' || !parameterNamePattern.test(mappedName)) {
                manifestReject('A web share target parameter is invalid.');

            }

            normalizedParams[parameterName] = mappedName;

        }

    }

    if (validatedShareParams.files !== undefined) {
        if (!Array.isArray(validatedShareParams.files) ||
            validatedShareParams.files.length < 1 || validatedShareParams.files.length > 16 ||
            methodData !== 'POST' || enctypeData !== 'multipart/form-data') {
            manifestReject('Web share target files require multipart POST.');

        }

        const shareFileItems = /** @type {unknown[]} */ (validatedShareParams.files);

        normalizedParams.files = Object.freeze(shareFileItems.map(function shareFileNormalize(fileData) {
            //Normalizing every declared shared file field.
            return manifestShareFileNormalize(fileData);

        }));

    }

    if (Object.keys(normalizedParams).length < 1 ||
        (methodData === 'GET' && enctypeData !== 'application/x-www-form-urlencoded')) {
        manifestReject('The web share target parameters are invalid.');

    }

    return Object.freeze({
        action: shareTargetRecord.action,
        method: methodData,
        enctype: enctypeData,
        params: Object.freeze(normalizedParams)
    });

}

/**
 * @param {unknown} launchHandlerData
 */
function manifestLaunchHandlerNormalize(launchHandlerData) {
    if (!plainObjectCheck(launchHandlerData)) {
        manifestReject('The web app launch handler is invalid.');

    }

    const launchHandlerRecord = /** @type {Record<string, unknown>} */ (launchHandlerData);
    const clientModeData = launchHandlerRecord.clientMode;

    if (!knownKeysCheck(launchHandlerRecord, new Set(['clientMode']))) {
        manifestReject('The web app launch handler is invalid.');

    }

    if (typeof clientModeData === 'string') {
        if (!launchClientModeSet.has(clientModeData)) {
            manifestReject('The web app launch client mode is invalid.');

        }

        return Object.freeze({
            client_mode: clientModeData
        });

    }

    if (!Array.isArray(clientModeData) || clientModeData.length < 1 || clientModeData.length > 4 ||
        !clientModeData.every(function clientModeCheck(modeData) {
            //Allowing the browser to select the first supported declared mode.
            return typeof modeData === 'string' && launchClientModeSet.has(modeData);

        })) {
        manifestReject('The web app launch client mode is invalid.');

    }

    const normalizedClientModes = /** @type {string[]} */ (clientModeData);

    return Object.freeze({
        client_mode: Object.freeze([...normalizedClientModes])
    });

}

/**
 * @param {LayerWebAppManifestOptions} manifestOptions
 */
export function layerWebAppManifestCreate(manifestOptions) {
    //Checking the root contract before reading individual install metadata.
    if (!plainObjectCheck(manifestOptions)) {
        manifestReject('The web app manifest is invalid.');

    }

    const manifestRecord = /** @type {Record<string, unknown>} */ (manifestOptions);
    const scopeData = manifestOptions.scope ?? '/';
    const displayData = manifestOptions.display ?? 'standalone';

    if (!knownKeysCheck(manifestRecord, manifestRootOptionKeySet) ||
        typeof manifestOptions.name !== 'string' || manifestOptions.name.length < 1 ||
        manifestOptions.name.length > 160 || typeof manifestOptions.shortName !== 'string' ||
        manifestOptions.shortName.length < 1 || manifestOptions.shortName.length > 32 ||
        typeof scopeData !== 'string' || !manifestPathValidate(scopeData, scopeData) ||
        typeof manifestOptions.startUrl !== 'string' ||
        !manifestPathValidate(manifestOptions.startUrl, scopeData) ||
        typeof displayData !== 'string' || !displayModeSet.has(displayData) ||
        !optionalTextValidate(manifestOptions.description, 1024) ||
        (manifestOptions.id !== undefined &&
            (typeof manifestOptions.id !== 'string' || !manifestPathValidate(manifestOptions.id, scopeData))) ||
        (manifestOptions.lang !== undefined &&
            (typeof manifestOptions.lang !== 'string' || manifestOptions.lang.length > 35 ||
                !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(manifestOptions.lang))) ||
        (manifestOptions.dir !== undefined &&
            (typeof manifestOptions.dir !== 'string' || !directionSet.has(manifestOptions.dir))) ||
        (manifestOptions.orientation !== undefined &&
            (typeof manifestOptions.orientation !== 'string' || !orientationSet.has(manifestOptions.orientation))) ||
        !optionalTextValidate(manifestOptions.themeColor, 64) ||
        !optionalTextValidate(manifestOptions.backgroundColor, 64) ||
        !Array.isArray(manifestOptions.icons) || manifestOptions.icons.length < 1 ||
        manifestOptions.icons.length > 64 ||
        (manifestOptions.shortcuts !== undefined && !Array.isArray(manifestOptions.shortcuts)) ||
        (manifestOptions.fileHandlers !== undefined && !Array.isArray(manifestOptions.fileHandlers)) ||
        (manifestOptions.protocolHandlers !== undefined && !Array.isArray(manifestOptions.protocolHandlers))) {
        manifestReject('The web app manifest is invalid.');

    }

    const icons = manifestOptions.icons.map(function applicationIconNormalize(iconData) {
        //Normalizing every required installation icon.
        return manifestIconNormalize(iconData, true);

    });
    const shortcuts = (manifestOptions.shortcuts ?? []).map(function shortcutNormalize(shortcutData) {
        //Normalizing every shortcut inside the application navigation scope.
        return manifestShortcutNormalize(shortcutData, scopeData);

    });
    const fileHandlers = (manifestOptions.fileHandlers ?? []).map(function fileHandlerNormalize(fileHandlerData) {
        //Normalizing every OS file association inside the application scope.
        return manifestFileHandlerNormalize(fileHandlerData, scopeData);

    });
    const protocolHandlers = (manifestOptions.protocolHandlers ?? []).map(function protocolHandlerNormalize(
        protocolHandlerData
    ) {
        //Normalizing every OS protocol association through the WHATWG contract.
        return manifestProtocolHandlerNormalize(protocolHandlerData, scopeData);

    });

    if (shortcuts.length > 32 || fileHandlers.length > 32 || protocolHandlers.length > 32) {
        manifestReject('The web app manifest capability list is too large.');

    }

    const normalizedManifest = /** @type {Record<string, unknown>} */ ({
        name: manifestOptions.name,
        short_name: manifestOptions.shortName,
        start_url: manifestOptions.startUrl,
        scope: scopeData,
        display: displayData,
        theme_color: manifestOptions.themeColor ?? '#000000',
        background_color: manifestOptions.backgroundColor ?? '#ffffff',
        icons: Object.freeze(icons),
        shortcuts: Object.freeze(shortcuts),
        file_handlers: Object.freeze(fileHandlers),
        protocol_handlers: Object.freeze(protocolHandlers)
    });

    if (manifestOptions.description !== undefined) {
        normalizedManifest.description = manifestOptions.description;

    }

    if (manifestOptions.id !== undefined) {
        normalizedManifest.id = manifestOptions.id;

    }

    if (manifestOptions.lang !== undefined) {
        normalizedManifest.lang = manifestOptions.lang;

    }

    if (manifestOptions.dir !== undefined) {
        normalizedManifest.dir = manifestOptions.dir;

    }

    if (manifestOptions.orientation !== undefined) {
        normalizedManifest.orientation = manifestOptions.orientation;

    }

    if (manifestOptions.shareTarget !== undefined) {
        normalizedManifest.share_target = manifestShareTargetNormalize(manifestOptions.shareTarget, scopeData);

    }

    if (manifestOptions.launchHandler !== undefined) {
        normalizedManifest.launch_handler = manifestLaunchHandlerNormalize(manifestOptions.launchHandler);

    }

    //Normalizing related origins without treating association as browser certification
    if (manifestRecord.scopeExtensions !== undefined) {
        const scopeConfiguration = layerLinksConfigurationCreate({scopeExtensions: manifestRecord.scopeExtensions}, {development: true});
        normalizedManifest.scope_extensions = scopeConfiguration.scopeExtensions.map(function(originData) {
            //Serializing only the standard origin extension shape
            return Object.freeze({type: 'origin', origin: originData});

        });

    }
    return Object.freeze(normalizedManifest);


}
