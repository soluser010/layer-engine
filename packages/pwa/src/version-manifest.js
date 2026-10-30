import {LayerPwaError} from './pwa-error.js';

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const assetHashPattern = /^sha256-[A-Za-z0-9+/]{43}=$/;

/**
 * @param {unknown} manifestData
 */
export function layerVersionManifestValidate(manifestData) {
    if (typeof manifestData !== 'object' || manifestData === null || Array.isArray(manifestData)) {
        throw new LayerPwaError('PWA_MANIFEST_INVALID', 'The version manifest must be an object.');

    }

    const manifestRecord = /** @type {Record<string, unknown>} */ (manifestData);
    const allowedKeys = new Set([
        'appVersion',
        'runtimeVersion',
        'compilerVersion',
        'protocolMin',
        'protocolMax',
        'schemaVersions',
        'minVersion',
        'rollbackVersion',
        'offlineShellUrl',
        'assets'
    ]);

    if (Object.keys(manifestRecord).some(function unknownManifestKeyFind(manifestKey) {
        //Rejecting version metadata outside the stable update contract.
        return !allowedKeys.has(manifestKey);

    }) ||
        typeof manifestRecord.appVersion !== 'string' || !versionPattern.test(manifestRecord.appVersion) ||
        typeof manifestRecord.runtimeVersion !== 'string' || !versionPattern.test(manifestRecord.runtimeVersion) ||
        typeof manifestRecord.compilerVersion !== 'string' || !versionPattern.test(manifestRecord.compilerVersion) ||
        !Number.isInteger(manifestRecord.protocolMin) || !Number.isInteger(manifestRecord.protocolMax) ||
        Number(manifestRecord.protocolMin) < 1 || Number(manifestRecord.protocolMax) < Number(manifestRecord.protocolMin) ||
        typeof manifestRecord.schemaVersions !== 'object' || manifestRecord.schemaVersions === null || Array.isArray(manifestRecord.schemaVersions) ||
        (manifestRecord.minVersion !== null && manifestRecord.minVersion !== undefined &&
            (typeof manifestRecord.minVersion !== 'string' || !versionPattern.test(manifestRecord.minVersion))) ||
        (manifestRecord.rollbackVersion !== null && manifestRecord.rollbackVersion !== undefined &&
            (typeof manifestRecord.rollbackVersion !== 'string' || !versionPattern.test(manifestRecord.rollbackVersion))) ||
        typeof manifestRecord.offlineShellUrl !== 'string' || !manifestRecord.offlineShellUrl.startsWith('/') ||
        !Array.isArray(manifestRecord.assets) || manifestRecord.assets.length < 1 || manifestRecord.assets.length > 10000) {
        throw new LayerPwaError('PWA_MANIFEST_INVALID', 'The version manifest fields are invalid.');

    }

    const normalizedSchemas = /** @type {Record<string, number>} */ ({});

    for (const [schemaName, schemaVersion] of Object.entries(manifestRecord.schemaVersions)) {
        if (!/^[a-z][a-z0-9_-]{0,63}$/.test(schemaName) || !Number.isInteger(schemaVersion) || Number(schemaVersion) < 1) {
            throw new LayerPwaError('PWA_MANIFEST_INVALID', `Schema version ${schemaName} is invalid.`);

        }

        normalizedSchemas[schemaName] = Number(schemaVersion);

    }

    const assetUrls = new Set();
    const normalizedAssets = [];

    for (const assetValue of manifestRecord.assets) {
        if (typeof assetValue !== 'object' || assetValue === null || Array.isArray(assetValue)) {
            throw new LayerPwaError('PWA_MANIFEST_INVALID', 'A version asset is invalid.');

        }

        const assetRecord = /** @type {Record<string, unknown>} */ (assetValue);

        if (Object.keys(assetRecord).some(function unknownAssetKeyFind(assetKey) {
            //Rejecting asset metadata outside the integrity contract.
            return !['url', 'hash', 'required', 'policy'].includes(assetKey);

        }) ||
            typeof assetRecord.url !== 'string' || !assetRecord.url.startsWith('/') || assetRecord.url.length > 2048 ||
            typeof assetRecord.hash !== 'string' || !assetHashPattern.test(assetRecord.hash) ||
            assetRecord.required !== true ||
            !['immutable', 'shell', 'media'].includes(String(assetRecord.policy)) ||
            assetUrls.has(assetRecord.url)) {
            throw new LayerPwaError('PWA_MANIFEST_INVALID', 'A version asset contract is invalid or duplicated.');

        }

        assetUrls.add(assetRecord.url);
        normalizedAssets.push(Object.freeze({
            url: assetRecord.url,
            hash: assetRecord.hash,
            required: true,
            policy: assetRecord.policy
        }));

    }

    if (!assetUrls.has(manifestRecord.offlineShellUrl)) {
        throw new LayerPwaError('PWA_MANIFEST_INVALID', 'The offline shell must be a verified asset.');

    }

    return Object.freeze({
        appVersion: manifestRecord.appVersion,
        runtimeVersion: manifestRecord.runtimeVersion,
        compilerVersion: manifestRecord.compilerVersion,
        protocolMin: Number(manifestRecord.protocolMin),
        protocolMax: Number(manifestRecord.protocolMax),
        schemaVersions: Object.freeze(normalizedSchemas),
        minVersion: manifestRecord.minVersion ?? null,
        rollbackVersion: manifestRecord.rollbackVersion ?? null,
        offlineShellUrl: manifestRecord.offlineShellUrl,
        assets: Object.freeze(normalizedAssets)
    });

}

/**
 * @param {string} firstVersion
 * @param {string} secondVersion
 */
export function layerVersionCompare(firstVersion, secondVersion) {
    //Comparing the stable numeric core while ignoring prerelease labels for update order.
    const firstParts = (firstVersion.split('-', 1)[0] ?? '').split('.').map(Number);
    const secondParts = (secondVersion.split('-', 1)[0] ?? '').split('.').map(Number);

    for (let partIndex = 0; partIndex < 3; partIndex += 1) {
        const differenceValue = Number(firstParts[partIndex] ?? 0) - Number(secondParts[partIndex] ?? 0);

        if (differenceValue !== 0) {
            return Math.sign(differenceValue);

        }

    }

    return 0;

}
