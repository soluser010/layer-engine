import {LAYER_ERROR_CODES} from './constants.js';

/**
 * @typedef {object} LayerErrorOptions
 * @property {unknown} [cause]
 * @property {Record<string, unknown> | null} [details]
 * @property {boolean} [retryable]
 * @property {number} [status]
 */

export class LayerError extends Error {
    #internalCause;

    /**
     * @param {string} code
     * @param {string} message
     * @param {LayerErrorOptions} [options]
     */
    constructor(code, message, options = {}) {
        super(message);

        // Keep internal failure context away from enumerable public fields.
        this.name = 'LayerError';
        this.code = code;
        this.retryable = options.retryable ?? false;
        this.status = options.status ?? 500;
        this.details = options.details ?? null;
        this.#internalCause = options.cause;
    }

    /**
     * @returns {unknown}
     */
    internalCauseGet() {
        return this.#internalCause;
    }

    /**
     * @returns {{code: string, message: string, retryable: boolean, details: Record<string, unknown> | null}}
     */
    toJSON() {
        return {
            code: this.code,
            message: this.message,
            retryable: this.retryable,
            details: this.details
        };
    }
}

/**
 * Convert an unknown error to a public-safe Layer error.
 *
 * @param {unknown} errorData
 * @returns {LayerError}
 */
export function layerErrorNormalize(errorData) {
    if (errorData instanceof LayerError) {
        return errorData;
    }

    return new LayerError(
        LAYER_ERROR_CODES.INTERNAL_ERROR,
        'An internal error occurred.',
        {
            cause: errorData,
            status: 500
        }
    );
}

