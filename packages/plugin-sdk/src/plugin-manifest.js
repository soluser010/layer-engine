import {layerProtocolValidatorCreate} from '@solcorp/layer-protocol';
import {LayerPluginError} from './plugin-error.js';

const pluginManifestFields = Object.freeze([
    'browserPackages',
    'capabilities',
    'configSchema',
    'engine',
    'eventChannels',
    'integrity',
    'migrations',
    'name',
    'operations',
    'permissions',
    'version'
]);
const pluginCapabilities = Object.freeze([
    'config',
    'events',
    'logger',
    'metrics',
    'operations',
    'repositories'
]);
const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const protocolValidator = layerProtocolValidatorCreate();

/**
 * @param {unknown} valueData
 * @returns {valueData is Record<string, unknown>}
 */
function plainObjectCheck(valueData) {
    //Checking plugin records without accepting arrays or null.
    return typeof valueData === 'object' && valueData !== null && !Array.isArray(valueData);

}

/**
 * @param {string} messageData
 * @param {Readonly<Record<string, unknown>>} [detailsData]
 */
function pluginManifestErrorCreate(messageData, detailsData = {}) {
    //Creating one stable plugin manifest failure for startup diagnostics.
    return new LayerPluginError('PLUGIN_MANIFEST_INVALID', messageData, {
        details: detailsData
    });

}

/**
 * @param {unknown} listData
 * @param {string} fieldName
 * @param {RegExp} itemPattern
 */
function pluginStringListNormalize(listData, fieldName, itemPattern) {
    if (listData === undefined) {
        return Object.freeze([]);

    }

    //Checking bounded plugin declarations before copying them.
    if (!Array.isArray(listData) || listData.length > 256) {
        throw pluginManifestErrorCreate(`${fieldName} must be an array with at most 256 entries.`);

    }

    const normalizedItems = listData.map(function pluginStringNormalize(itemData) {
        //Checking one declared manifest name against its field contract.
        if (typeof itemData !== 'string' || !itemPattern.test(itemData)) {
            throw pluginManifestErrorCreate(`${fieldName} contains an invalid value.`);

        }

        return itemData;

    });

    if (new Set(normalizedItems).size !== normalizedItems.length) {
        throw pluginManifestErrorCreate(`${fieldName} must not contain duplicates.`);

    }

    return Object.freeze(normalizedItems);

}

/**
 * @param {unknown} integrityData
 */
function pluginIntegrityNormalize(integrityData) {
    if (integrityData === undefined) {
        return null;

    }

    //Checking optional supply-chain metadata without treating it as verification.
    if (!plainObjectCheck(integrityData) || Object.keys(integrityData).some(function integrityFieldFind(fieldName) {
        //Finding fields outside the declared integrity metadata.
        return fieldName !== 'sha256' && fieldName !== 'provenance';

    }) || typeof integrityData.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(integrityData.sha256) ||
        typeof integrityData.provenance !== 'string' || integrityData.provenance.length < 1 || integrityData.provenance.length > 500) {
        throw pluginManifestErrorCreate('integrity must contain a SHA-256 digest and bounded provenance.');

    }

    return Object.freeze({
        sha256: integrityData.sha256,
        provenance: integrityData.provenance
    });

}

/**
 * @param {unknown} manifestData
 */
export function layerPluginManifestValidate(manifestData) {
    //Checking the manifest boundary and rejecting unknown fields.
    if (!plainObjectCheck(manifestData)) {
        throw pluginManifestErrorCreate('plugin manifest must be an object.');

    }

    const unknownFields = Object.keys(manifestData).filter(function unknownPluginFieldFind(fieldName) {
        //Finding fields outside the stable plugin manifest contract.
        return !pluginManifestFields.includes(fieldName);

    });

    if (unknownFields.length > 0) {
        throw pluginManifestErrorCreate('plugin manifest contains unknown fields.', {
            fields: unknownFields
        });

    }

    //Checking plugin identity and engine compatibility declaration.
    if (typeof manifestData.name !== 'string' || !/^(?:@[a-z][a-z0-9-]*\/)?[a-z][a-z0-9-]*$/.test(manifestData.name) ||
        typeof manifestData.version !== 'string' || !semanticVersionPattern.test(manifestData.version) ||
        typeof manifestData.engine !== 'string' || manifestData.engine.length > 80 ||
        !/^(?:\*|\^?\d+\.\d+\.\d+|>=\d+\.\d+\.\d+ <\d+\.\d+\.\d+)$/.test(manifestData.engine)) {
        throw pluginManifestErrorCreate('plugin name, version, or engine range is invalid.');

    }

    const configSchema = manifestData.configSchema ?? false;

    try {
        //Compiling the config schema in the protocol strict Draft 2020-12 validator.
        protocolValidator.schemaCompile(configSchema);

    } catch (schemaError) {
        let schemaErrorReason = 'schema-compile-failed';

        if (schemaError instanceof Error) {
            schemaErrorReason = schemaError.message;

        }

        throw pluginManifestErrorCreate('plugin configSchema is invalid.', {
            reason: schemaErrorReason
        });

    }

    const capabilities = pluginStringListNormalize(manifestData.capabilities, 'capabilities', /^[a-z]+$/);

    if (capabilities.some(function unknownCapabilityFind(capabilityName) {
        //Finding requested services outside the restricted SDK surface.
        return !pluginCapabilities.includes(capabilityName);

    })) {
        throw pluginManifestErrorCreate('plugin requests an unknown capability.');

    }

    return Object.freeze({
        name: manifestData.name,
        version: manifestData.version,
        engine: manifestData.engine,
        operations: pluginStringListNormalize(manifestData.operations, 'operations', /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/),
        migrations: pluginStringListNormalize(manifestData.migrations, 'migrations', /^\d{3}-[a-z][a-z0-9-]{0,79}$/),
        eventChannels: pluginStringListNormalize(manifestData.eventChannels, 'eventChannels', /^[a-z][a-z0-9.-]{0,159}$/),
        capabilities,
        configSchema,
        permissions: pluginStringListNormalize(manifestData.permissions, 'permissions', /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/),
        browserPackages: pluginStringListNormalize(manifestData.browserPackages, 'browserPackages', /^(?:@[a-z][a-z0-9-]*\/)?[a-z][a-z0-9-]*$/),
        integrity: pluginIntegrityNormalize(manifestData.integrity)
    });

}

/**
 * @param {string} engineRange
 * @param {string} engineVersion
 */
export function layerPluginEngineCompatible(engineRange, engineVersion) {
    if (!semanticVersionPattern.test(engineVersion)) {
        throw new TypeError('Engine version must be a semantic version.');

    }

    //Accepting an explicit wildcard only when the plugin author declared it.
    if (engineRange === '*') {
        return true;

    }

    const versionParts = engineVersion.split('-', 1)[0]?.split('.').map(Number) ?? [];
    const versionValue = (versionParts[0] ?? 0) * 1000000000 + (versionParts[1] ?? 0) * 1000000 + (versionParts[2] ?? 0);

    if (engineRange.startsWith('^')) {
        const minimumParts = engineRange.slice(1).split('.').map(Number);
        const minimumValue = (minimumParts[0] ?? 0) * 1000000000 + (minimumParts[1] ?? 0) * 1000000 + (minimumParts[2] ?? 0);

        return versionValue >= minimumValue && versionParts[0] === minimumParts[0];

    }

    if (engineRange.startsWith('>=')) {
        const rangeMatch = /^>=(\d+\.\d+\.\d+) <(\d+\.\d+\.\d+)$/.exec(engineRange);

        if (rangeMatch === null) {
            return false;

        }

        const minimumParts = String(rangeMatch[1]).split('.').map(Number);
        const maximumParts = String(rangeMatch[2]).split('.').map(Number);
        const minimumValue = (minimumParts[0] ?? 0) * 1000000000 + (minimumParts[1] ?? 0) * 1000000 + (minimumParts[2] ?? 0);
        const maximumValue = (maximumParts[0] ?? 0) * 1000000000 + (maximumParts[1] ?? 0) * 1000000 + (maximumParts[2] ?? 0);

        return versionValue >= minimumValue && versionValue < maximumValue;

    }

    return engineRange === engineVersion;

}
