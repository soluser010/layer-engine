import {layerAuthenticationCreate} from './authentication.js';

/**
 * @typedef {object} LayerSessionCompatibilityData
 * @property {string} id
 * @property {string} userId
 * @property {string | null} tenantId
 * @property {readonly string[]} permissions
 * @property {string} csrfTokenHash
 * @property {number} expiresAt
 * @property {'active' | 'revoked'} status
 */

/**
 * Compatibility entrypoint for applications configured with browser sessions only.
 *
 * @param {object} securityOptions
 * @param {readonly string[]} securityOptions.allowedOrigins
 * @param {(sessionIdentifier: string) => Promise<LayerSessionCompatibilityData | null> | LayerSessionCompatibilityData | null} securityOptions.sessionResolve
 * @param {string} [securityOptions.sessionCookieName]
 * @param {string} [securityOptions.csrfHeaderName]
 * @param {() => number} [securityOptions.clock]
 */
export function layerSessionSecurityCreate(securityOptions) {
    //Preserving the original strict session-only startup contract.
    if (!Array.isArray(securityOptions.allowedOrigins) || securityOptions.allowedOrigins.length === 0) {
        throw new TypeError('At least one allowed origin is required.');

    }

    if (typeof securityOptions.sessionResolve !== 'function') {
        throw new TypeError('sessionResolve must be a function.');

    }

    return layerAuthenticationCreate(securityOptions);

}
