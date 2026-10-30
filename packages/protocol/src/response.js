import {LAYER_PROTOCOL_VERSION} from './constants.js';
import {layerErrorNormalize} from './layer-error.js';

/**
 * @typedef {object} LayerSuccessResponseCreateOptions
 * @property {string} requestId
 * @property {unknown} data
 * @property {Record<string, unknown>} [meta]
 */

/**
 * @param {LayerSuccessResponseCreateOptions} responseOptions
 * @returns {{protocol: 1, requestId: string, ok: true, data: unknown, meta?: Record<string, unknown>}}
 */
export function layerSuccessResponseDataCreate(responseOptions) {
    const responseData = {
        protocol: /** @type {1} */ (LAYER_PROTOCOL_VERSION),
        requestId: responseOptions.requestId,
        ok: /** @type {const} */ (true),
        data: responseOptions.data
    };

    // Include response metadata only when the caller supplied it.
    if (responseOptions.meta !== undefined) {
        return {
            ...responseData,
            meta: responseOptions.meta
        };
    }

    return responseData;
}

/**
 * @param {{requestId: string, error: unknown}} responseOptions
 * @returns {{protocol: 1, requestId: string, ok: false, error: {code: string, message: string, retryable: boolean, details: Record<string, unknown> | null}}}
 */
export function layerErrorResponseDataCreate(responseOptions) {
    const publicError = layerErrorNormalize(responseOptions.error);

    return {
        protocol: /** @type {1} */ (LAYER_PROTOCOL_VERSION),
        requestId: responseOptions.requestId,
        ok: /** @type {const} */ (false),
        error: publicError.toJSON()
    };
}
