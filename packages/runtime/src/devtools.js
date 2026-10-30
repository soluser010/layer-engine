import {LayerRuntimeError} from './runtime-error.js';

const defaultSensitiveFields = Object.freeze([
    'apiKey',
    'authorization',
    'body',
    'cookie',
    'csrf',
    'e2ee',
    'message',
    'password',
    'secret',
    'token'
]);

/**
 * @typedef {object} LayerDevtoolsOptions
 * @property {boolean} [enabled]
 * @property {readonly string[]} [sensitiveFields]
 * @property {number} [maximumDepth]
 * @property {number} [maximumEntries]
 * @property {number} [maximumStringLength]
 * @property {() => string} [timeCreate]
 */

/**
 * @param {string} fieldName
 * @param {Set<string>} sensitiveFields
 */
function sensitiveFieldCheck(fieldName, sensitiveFields) {
    const normalizedField = fieldName.replaceAll(/[^a-zA-Z0-9]/g, '').toLowerCase();

    //Checking exact and compound field names such as accessToken or csrf_token.
    for (const sensitiveField of sensitiveFields) {
        if (normalizedField.includes(sensitiveField)) {
            return true;

        }

    }

    return false;

}

/**
 * @param {unknown} valueData
 * @param {{depth: number, entries: {count: number}, sensitiveFields: Set<string>, maximumDepth: number, maximumEntries: number, maximumStringLength: number}} sanitizeState
 * @param {string} [fieldName]
 * @returns {unknown}
 */
function diagnosticValueSanitize(valueData, sanitizeState, fieldName = '') {
    if (sensitiveFieldCheck(fieldName, sanitizeState.sensitiveFields)) {
        return '[REDACTED]';

    }

    if (sanitizeState.entries.count >= sanitizeState.maximumEntries) {
        return '[TRUNCATED]';

    }

    sanitizeState.entries.count += 1;

    if (typeof valueData === 'string') {
        return valueData.slice(0, sanitizeState.maximumStringLength);

    }

    if (typeof valueData === 'number' || typeof valueData === 'boolean' || valueData === null) {
        return valueData;

    }

    if (typeof valueData === 'bigint') {
        return valueData.toString();

    }

    if (valueData instanceof Date) {
        return valueData.toISOString();

    }

    if (valueData instanceof Error) {
        return Object.freeze({
            name: valueData.name,
            message: valueData.message.slice(0, sanitizeState.maximumStringLength)
        });

    }

    if (typeof valueData === 'function' || typeof valueData === 'symbol' || valueData === undefined) {
        return '[UNAVAILABLE]';

    }

    if (sanitizeState.depth >= sanitizeState.maximumDepth) {
        return '[MAX_DEPTH]';

    }

    const nestedState = {
        ...sanitizeState,
        depth: sanitizeState.depth + 1
    };

    if (Array.isArray(valueData)) {
        //Copying bounded collection values without retaining application references.
        return Object.freeze(valueData.map(function diagnosticArrayValueSanitize(itemData) {
            //Sanitizing one collection value with the shared entry budget.
            return diagnosticValueSanitize(itemData, nestedState);

        }));

    }

    if (typeof valueData === 'object') {
        const diagnosticRecord = /** @type {Record<string, unknown>} */ ({});

        //Copying own enumerable fields while applying field-name redaction.
        for (const [nestedFieldName, nestedValue] of Object.entries(valueData)) {
            diagnosticRecord[nestedFieldName] = diagnosticValueSanitize(nestedValue, nestedState, nestedFieldName);

        }

        return Object.freeze(diagnosticRecord);

    }

    return String(valueData).slice(0, sanitizeState.maximumStringLength);

}

/**
 * @param {LayerDevtoolsOptions} [devtoolsOptions]
 */
export function layerDevtoolsCreate(devtoolsOptions = {}) {
    const enabledStatus = devtoolsOptions.enabled ?? false;
    const maximumDepth = devtoolsOptions.maximumDepth ?? 12;
    const maximumEntries = devtoolsOptions.maximumEntries ?? 5000;
    const maximumStringLength = devtoolsOptions.maximumStringLength ?? 2000;
    const timeCreate = devtoolsOptions.timeCreate ?? function diagnosticTimeCreate() {
        //Creating the diagnostic timestamp at snapshot time.
        return new Date().toISOString();

    };

    //Checking diagnostic bounds before providers can register.
    if (typeof enabledStatus !== 'boolean' || !Number.isInteger(maximumDepth) || maximumDepth < 1 || maximumDepth > 32 ||
        !Number.isInteger(maximumEntries) || maximumEntries < 10 || maximumEntries > 100000 ||
        !Number.isInteger(maximumStringLength) || maximumStringLength < 32 || maximumStringLength > 100000) {
        throw new TypeError('DevTools configuration is invalid.');

    }

    const sensitiveFields = new Set(defaultSensitiveFields.map(function sensitiveFieldNormalize(fieldName) {
        //Normalizing one default field for case-independent comparison.
        return fieldName.toLowerCase();

    }));

    for (const fieldName of devtoolsOptions.sensitiveFields ?? []) {
        if (typeof fieldName !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(fieldName)) {
            throw new TypeError('DevTools sensitive field names are invalid.');

        }

        sensitiveFields.add(fieldName.replaceAll(/[^a-zA-Z0-9]/g, '').toLowerCase());

    }

    const diagnosticProviders = new Map();

    return Object.freeze({
        /**
         * @param {string} providerName
         * @param {() => unknown | Promise<unknown>} providerLoad
         */
        register(providerName, providerLoad) {
            if (!enabledStatus) {
                throw new LayerRuntimeError('DEVTOOLS_DISABLED', 'DevTools are disabled for this runtime.');

            }

            //Checking provider identity and preventing silent replacement.
            if (!/^[a-z][a-z0-9-]{0,79}$/.test(providerName) || typeof providerLoad !== 'function') {
                throw new LayerRuntimeError('DEVTOOLS_PROVIDER_INVALID', 'DevTools provider name or loader is invalid.');

            }

            if (diagnosticProviders.has(providerName)) {
                throw new LayerRuntimeError('DEVTOOLS_PROVIDER_DUPLICATE', 'DevTools provider is already registered.', {
                    details: {
                        provider: providerName
                    }
                });

            }

            diagnosticProviders.set(providerName, providerLoad);

            return function diagnosticProviderDispose() {
                //Removing only the provider owned by this registration.
                return diagnosticProviders.delete(providerName);

            };

        },
        list() {
            //Returning provider names without exposing provider functions.
            return Object.freeze([...diagnosticProviders.keys()]);

        },
        /**
         * @param {{include?: readonly string[], export?: boolean, consent?: boolean}} [snapshotOptions]
         */
        async snapshot(snapshotOptions = {}) {
            if (!enabledStatus) {
                throw new LayerRuntimeError('DEVTOOLS_DISABLED', 'DevTools are disabled for this runtime.');

            }

            if (snapshotOptions.export === true && snapshotOptions.consent !== true) {
                throw new LayerRuntimeError('DEVTOOLS_EXPORT_CONSENT_REQUIRED', 'Diagnostic export requires explicit user consent.');

            }

            let includedProviders;

            //Selecting all providers or the explicit bounded export selection.
            if (snapshotOptions.include === undefined) {
                includedProviders = [...diagnosticProviders.keys()];

            } else {
                includedProviders = [...snapshotOptions.include];

            }

            const diagnosticSections = /** @type {Record<string, unknown>} */ ({});

            for (const providerName of includedProviders) {
                const providerLoad = diagnosticProviders.get(providerName);

                if (providerLoad === undefined) {
                    throw new LayerRuntimeError('DEVTOOLS_PROVIDER_UNKNOWN', 'Requested DevTools provider is not registered.', {
                        details: {
                            provider: providerName
                        }
                    });

                }

                try {
                    //Loading and sanitizing each provider independently.
                    const providerResult = await providerLoad();
                    diagnosticSections[providerName] = diagnosticValueSanitize(providerResult, {
                        depth: 0,
                        entries: {count: 0},
                        sensitiveFields,
                        maximumDepth,
                        maximumEntries,
                        maximumStringLength
                    });

                } catch (providerError) {
                    diagnosticSections[providerName] = Object.freeze({
                        status: 'failed',
                        error: diagnosticValueSanitize(providerError, {
                            depth: 0,
                            entries: {count: 0},
                            sensitiveFields,
                            maximumDepth,
                            maximumEntries,
                            maximumStringLength
                        })
                    });

                }

            }

            return Object.freeze({
                generatedAt: timeCreate(),
                export: snapshotOptions.export === true,
                sections: Object.freeze(diagnosticSections)
            });

        }
    });

}
