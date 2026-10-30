import * as Ajv2020Module from 'ajv/dist/2020.js';
import * as ajvFormatsModule from 'ajv-formats';
import {layerProtocolDataValidatorCreate} from './data-validator.js';

const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
    /** @type {any} */ (Ajv2020Module.default)
);
const addFormats = /** @type {import('ajv-formats').FormatsPlugin} */ (
    /** @type {any} */ (ajvFormatsModule.default)
);

/**
 * @typedef {import('ajv').ValidateFunction} ValidateFunction
 */

export function layerProtocolValidatorCreate() {
    // Disable every AJV feature that could rewrite caller-owned input.
    const schemaCompiler = new Ajv2020({
        allErrors: true,
        coerceTypes: false,
        removeAdditional: false,
        strict: true,
        useDefaults: false
    });

    addFormats(schemaCompiler);

    const protocolDataValidator = layerProtocolDataValidatorCreate();

    return Object.freeze({
        ...protocolDataValidator,

        /**
         * @param {object | boolean} schemaData
         * @returns {ValidateFunction}
         */
        schemaCompile(schemaData) {
            return schemaCompiler.compile(schemaData);
        }
    });
}
