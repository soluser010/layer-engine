import {LayerPwaError} from './pwa-error.js';

export const LAYER_UPDATE_BUILD_PLACEHOLDER = '__LAYER_UPDATE_BUILD_ID__';
/** @param {unknown} inputData */
export const layerUpdateBuildIdCheck = function( inputData ){
    //Restricting release identities before constructing cache names or messages
    return typeof inputData === 'string' && /^[a-f0-9]{64}$/u.test(inputData);

};

/** @param {unknown} inputData */
//Function for checking the additive deployment descriptor without changing legacy manifests
export const layerUpdateDescriptorValidate = function( inputData ){
    //Rejecting unknown metadata and malformed integrity values without reflecting input
    const descriptor = /** @type {Record<string, unknown>} */ (inputData);
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(descriptor)) ||
        Object.keys(descriptor).some(function(fieldName){
            //Allowing only the versioned update contract
            return !['protocol', 'buildId', 'versionManifestHash'].includes(fieldName);

        }) || descriptor.protocol !== 1 || !layerUpdateBuildIdCheck(descriptor.buildId) ||
        typeof descriptor.versionManifestHash !== 'string' ||
        !/^sha256-[A-Za-z0-9+/]{43}=$/u.test(descriptor.versionManifestHash)) {
        //Passing one bounded protocol failure to the caller
        throw new LayerPwaError('PWA_UPDATE_DESCRIPTOR_INVALID', 'The update descriptor is invalid.');

    }
    //CallBack THE OBJECT
    return Object.freeze({protocol: 1, buildId: /** @type {string} */ (descriptor.buildId),
        versionManifestHash: descriptor.versionManifestHash});

};

/** @param {unknown} inputData */
//Function for sharing strict update defaults between CLI and browser runtime
export const layerUpdatesConfigurationCreate = function( inputData ){
    //Accepting an omitted block, but never silently ignoring configuration typos
    let configuration = /** @type {Record<string, unknown>} */ (inputData);
    if (inputData === undefined) {
        configuration = {};

    }
    if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(configuration)) ||
        Object.keys(configuration).some(function(fieldName){
            //Keeping unsupported policy switches outside the public contract
            return !['enabled', 'ui', 'checkIntervalMs'].includes(fieldName);

        })) {
        throw new LayerPwaError('PWA_UPDATES_CONFIG_INVALID', 'updates supports enabled, ui and checkIntervalMs.');

    }
    const enabled = configuration.enabled ?? true;
    const ui = configuration.ui ?? true;
    const checkIntervalMs = configuration.checkIntervalMs ?? 300000;
    if (typeof enabled !== 'boolean' || typeof ui !== 'boolean' || !Number.isInteger(checkIntervalMs) ||
        Number(checkIntervalMs) < 60000 || Number(checkIntervalMs) > 86400000) {
        throw new LayerPwaError('PWA_UPDATES_CONFIG_INVALID', 'Use booleans and a checkIntervalMs between 60000 and 86400000.');

    }
    //CallBack THE OBJECT
    return Object.freeze({enabled, ui, checkIntervalMs: Number(checkIntervalMs)});

};

/** @param {ArrayBuffer} contentData @param {SubtleCrypto} cryptoData @param {(value: string) => string} encode */
//Function for verifying the exact network bytes before parsing deployment metadata
export const layerUpdateIntegrityCreate = async function( contentData, cryptoData, encode ){
    //Hashing bytes independently of JSON whitespace or property ordering
    const digest = new Uint8Array(await cryptoData.digest('SHA-256', contentData));
    let binaryData = '';
    for (const byteData of digest) {
        //Preparing the browser-compatible base64 input
        binaryData += String.fromCharCode(byteData);

    }
    //CallBack THE STRING
    return 'sha256-' + encode(binaryData);

};

/** @param {string} pathnameData */
export const layerUpdateMetadataPathCheck = function( pathnameData ){
    //Keeping mutable release metadata outside every offline shell and asset cache
    return ['/_layer/version.json', '/_layer/update.json'].includes(pathnameData);

};
