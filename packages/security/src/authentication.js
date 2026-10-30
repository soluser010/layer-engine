import {
    createHash,
    timingSafeEqual
} from 'node:crypto';
import {
    LAYER_ERROR_CODES,
    LayerError
} from '@solcorp/layer-protocol';
import {
    layerCookieValueGet,
    layerHeaderValueGet
} from './headers.js';

/**
 * @typedef {object} LayerIdentityData
 * @property {string} id
 * @property {string} userId
 * @property {string | null} tenantId
 * @property {readonly string[]} permissions
 * @property {readonly string[]} [assurance]
 * @property {string} [credentialReference]
 * @property {number} expiresAt
 * @property {'active' | 'revoked'} status
 * @typedef {LayerIdentityData & {csrfTokenHash: string}} LayerSessionData
 * @typedef {object} LayerSecurityContext
 * @property {'anonymous' | 'session' | 'bearer' | 'api-key'} authenticationType
 * @property {string | null} credentialId
 * @property {string | null} sessionId
 * @property {string | null} userId
 * @property {string | null} tenantId
 * @property {readonly string[]} permissions
 * @property {string} remoteAddress
 * @property {readonly string[]} [assurance]
 * @property {string} [credentialReference]
 */

/**
 * @param {string} providedToken
 * @param {string} expectedTokenHash
 */
function securityTokenMatchCheck(providedToken, expectedTokenHash) {
    //Hashing the untrusted token before comparing it with server-side state.
    const providedTokenHash = createHash('sha256').update(providedToken, 'utf8').digest('hex');
    const providedTokenBuffer = Buffer.from(providedTokenHash, 'utf8');
    const expectedTokenBuffer = Buffer.from(expectedTokenHash, 'utf8');

    //Checking equal lengths because timingSafeEqual rejects unequal buffers.
    if (providedTokenBuffer.length !== expectedTokenBuffer.length) {
        return false;

    }

    return timingSafeEqual(providedTokenBuffer, expectedTokenBuffer);

}

/**
 * @param {string} code
 * @param {string} message
 * @param {number} status
 */
function securityErrorCreate(code, message, status) {
    //Creating a public security error without exposing credentials or resolver details.
    return new LayerError(code, message, {
        status
    });

}

/**
 * @param {unknown} identityData
 * @param {boolean} csrfRequiredStatus
 * @returns {identityData is LayerSessionData}
 */
function activeIdentityShapeCheck(identityData, csrfRequiredStatus) {
    //Checking the identity object before reading trusted authorization fields.
    if (typeof identityData !== 'object' || identityData === null || Array.isArray(identityData)) {
        return false;

    }

    const identityRecord = /** @type {Record<string, unknown>} */ (identityData);
    const baseShapeValid = typeof identityRecord.id === 'string' && identityRecord.id.length > 0 && identityRecord.id.length <= 200 &&
        typeof identityRecord.userId === 'string' && identityRecord.userId.length > 0 && identityRecord.userId.length <= 200 &&
        (typeof identityRecord.tenantId === 'string' || identityRecord.tenantId === null) &&
        Array.isArray(identityRecord.permissions) &&
        typeof identityRecord.expiresAt === 'number' && Number.isSafeInteger(identityRecord.expiresAt) &&
        (identityRecord.status === 'active' || identityRecord.status === 'revoked');

    if (!baseShapeValid || !Array.isArray(identityRecord.permissions)) {
        return false;

    }

    //Requiring a server-side CSRF hash only for cookie sessions.
    if (csrfRequiredStatus && (typeof identityRecord.csrfTokenHash !== 'string' || identityRecord.csrfTokenHash.length !== 64)) {
        return false;

    }

    //Checking each permission without accepting mixed or unbounded arrays.
    if (identityRecord.permissions.length > 500) {
        return false;

    }

    for (const permissionData of identityRecord.permissions) {
        if (typeof permissionData !== 'string' || !/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/.test(permissionData)) {
            return false;

        }

    }

    //Checking optional authentication assurance without trusting mixed arrays
    if ( identityRecord.assurance !== undefined ){
        if ( Array.isArray( identityRecord.assurance ) === false || Number( identityRecord.assurance.length ) > Number( 16 ) ){
            return false;

        }

        for ( const assuranceData of identityRecord.assurance ){
            if ( typeof assuranceData !== String( 'string' ) || /^[a-z][a-z0-9-]{0,79}$/u.test( assuranceData ) === false ){
                return false;

            }

        }

    }

    return true;

}

/**
 * @param {LayerIdentityData} identityData
 * @param {readonly string[]} requiredPermissions
 */
function identityPermissionsAssert(identityData, requiredPermissions) {
    const identityPermissionSet = new Set(identityData.permissions);

    //Finding the first missing permission for a deterministic denial.
    for (const permissionData of requiredPermissions) {
        if (!identityPermissionSet.has(permissionData)) {
            throw securityErrorCreate(
                LAYER_ERROR_CODES.PERMISSION_DENIED,
                'The operation is not permitted.',
                403
            );

        }

    }

}

/**
 * @param {LayerIdentityData} identityData
 * @param {'session' | 'bearer' | 'api-key'} authenticationType
 * @param {string} remoteAddress
 */
function securityContextCreate(identityData, authenticationType, remoteAddress) {
    let sessionIdentifier = /** @type {string | null} */ (null);

    if (authenticationType === 'session') {
        //Publishing the opaque session identity only for session-scoped controls.
        sessionIdentifier = identityData.id;

    }

    const securityContextData = /** @type {LayerSecurityContext} */ ({
        authenticationType,
        credentialId: identityData.id,
        sessionId: sessionIdentifier,
        userId: identityData.userId,
        tenantId: identityData.tenantId,
        permissions: Object.freeze([...identityData.permissions]),
        remoteAddress
    });
    //Preserving only a server-derived opaque revocation reference, never the bearer token
    if ( typeof identityData.credentialReference === 'string' ){
        securityContextData.credentialReference = identityData.credentialReference;

    }

    //Publishing only bounded assurance names from the trusted identity resolver
    if ( identityData.assurance !== undefined ){
        securityContextData.assurance = Object.freeze([...identityData.assurance]);

    }

    return Object.freeze( securityContextData );

}

/**
 * @param {object} authenticationOptions
 * @param {readonly string[]} [authenticationOptions.allowedOrigins]
 * @param {(sessionIdentifier: string) => Promise<LayerSessionData | null> | LayerSessionData | null} [authenticationOptions.sessionResolve]
 * @param {(sessionIdentifier: string) => Promise<boolean> | boolean} [authenticationOptions.sessionTouch] Durable activity check after session, CSRF and operation permissions pass; false rejects stale cached identities.
 * @param {(bearerToken: string, requestContext?: Readonly<{scheme: 'bearer' | 'dpop', headers: Record<string, string | string[] | undefined>}>) => Promise<LayerIdentityData | null> | LayerIdentityData | null} [authenticationOptions.bearerResolve]
 * @param {(apiKeyHash: string) => Promise<LayerIdentityData | null> | LayerIdentityData | null} [authenticationOptions.apiKeyResolve]
 * @param {string} [authenticationOptions.sessionCookieName]
 * @param {string} [authenticationOptions.csrfHeaderName]
 * @param {string} [authenticationOptions.apiKeyHeaderName]
 * @param {() => number} [authenticationOptions.clock]
 */
export function layerAuthenticationCreate(authenticationOptions = {}) {
    const allowedOrigins = authenticationOptions.allowedOrigins ?? [];
    const allowedOriginSet = new Set(allowedOrigins);
    const sessionCookieName = authenticationOptions.sessionCookieName ?? 'layer_session';
    const csrfHeaderName = authenticationOptions.csrfHeaderName ?? 'x-layer-csrf';
    const apiKeyHeaderName = authenticationOptions.apiKeyHeaderName ?? 'x-layer-api-key';
    const clock = authenticationOptions.clock ?? Date.now;

    //Checking immutable authentication configuration at startup.
    if (!Array.isArray(allowedOrigins) || allowedOrigins.some(function allowedOriginInvalid(originData) {
        //Rejecting non-string and duplicated origin entries.
        return typeof originData !== 'string' || originData.length < 1 || originData.length > 500;

    }) || allowedOriginSet.size !== allowedOrigins.length) {
        throw new TypeError('Allowed origins are invalid.');

    }

    for (const resolverData of [authenticationOptions.sessionResolve, authenticationOptions.sessionTouch, authenticationOptions.bearerResolve, authenticationOptions.apiKeyResolve]) {
        if (resolverData !== undefined && typeof resolverData !== 'function') {
            throw new TypeError('Authentication resolvers must be functions.');

        }

    }

    return Object.freeze({
        /**
         * @param {object} requestSecurityData
         * @param {'session' | 'authenticated' | 'bearer' | 'api-key' | 'none'} requestSecurityData.auth
         * @param {readonly string[]} requestSecurityData.permissions
         * @param {Record<string, string | string[] | undefined>} requestSecurityData.headers
         * @param {string} requestSecurityData.remoteAddress
         * @returns {Promise<Readonly<{authenticationType: 'anonymous' | 'session' | 'bearer' | 'api-key', credentialId: string | null, sessionId: string | null, userId: string | null, tenantId: string | null, permissions: readonly string[], remoteAddress: string, assurance?: readonly string[], credentialReference?: string}>>}
         */
        async contextResolve(requestSecurityData) {
            //Selecting bearer or CSRF-protected session without accepting API keys as user identities
            if ( requestSecurityData.auth === 'authenticated' ){
                let selectedAuthData = /** @type {'session' | 'bearer'} */ ('session');

                if ( layerHeaderValueGet( requestSecurityData.headers, 'authorization' ) !== undefined ){
                    selectedAuthData = 'bearer';

                }

                return this.contextResolve({...requestSecurityData, auth: selectedAuthData});

            }

            if (requestSecurityData.auth === 'none') {
                //Returning an identity-free context for an explicitly public operation.
                return Object.freeze({
                    authenticationType: /** @type {const} */ ('anonymous'),
                    credentialId: null,
                    sessionId: null,
                    userId: null,
                    tenantId: null,
                    permissions: Object.freeze([]),
                    remoteAddress: requestSecurityData.remoteAddress
                });

            }

            /** @type {LayerIdentityData | LayerSessionData | null} */
            let identityResolveResult;
            let verifiedSessionTokenData = '';

            if (requestSecurityData.auth === 'session') {
                if (authenticationOptions.sessionResolve === undefined || allowedOriginSet.size === 0) {
                    throw securityErrorCreate(LAYER_ERROR_CODES.AUTH_REQUIRED, 'Session authentication is unavailable.', 401);

                }

                const originHeader = layerHeaderValueGet(requestSecurityData.headers, 'origin');
                const fetchSiteHeader = layerHeaderValueGet(requestSecurityData.headers, 'sec-fetch-site');

                //Checking the browser origin before resolving the session.
                if (originHeader === undefined || !allowedOriginSet.has(originHeader) || fetchSiteHeader === 'cross-site') {
                    throw securityErrorCreate(LAYER_ERROR_CODES.CSRF_INVALID, 'The request origin is not allowed.', 403);

                }

                const cookieHeader = layerHeaderValueGet(requestSecurityData.headers, 'cookie');
                const sessionIdentifier = layerCookieValueGet(cookieHeader, sessionCookieName);

                if (sessionIdentifier === undefined || sessionIdentifier.length < 16 || sessionIdentifier.length > 512) {
                    throw securityErrorCreate(LAYER_ERROR_CODES.AUTH_REQUIRED, 'Authentication is required.', 401);

                }

                //Resolving current session state so revocation applies immediately.
                identityResolveResult = await authenticationOptions.sessionResolve(sessionIdentifier);

                if (!activeIdentityShapeCheck(identityResolveResult, true) || identityResolveResult.status !== 'active' || identityResolveResult.expiresAt <= clock()) {
                    throw securityErrorCreate(LAYER_ERROR_CODES.AUTH_REQUIRED, 'The session is not active.', 401);

                }

                const csrfHeader = layerHeaderValueGet(requestSecurityData.headers, csrfHeaderName);

                if (csrfHeader === undefined || !securityTokenMatchCheck(csrfHeader, identityResolveResult.csrfTokenHash)) {
                    throw securityErrorCreate(LAYER_ERROR_CODES.CSRF_INVALID, 'The CSRF token is invalid.', 403);

                }

                verifiedSessionTokenData = sessionIdentifier;

            } else if (requestSecurityData.auth === 'bearer') {
                if (authenticationOptions.bearerResolve === undefined) {
                    throw securityErrorCreate(LAYER_ERROR_CODES.AUTH_REQUIRED, 'Bearer authentication is unavailable.', 401);

                }

                const authorizationHeader = layerHeaderValueGet(requestSecurityData.headers, 'authorization');
                const bearerMatch = authorizationHeader?.match(/^(Bearer|DPoP) ([^\s]{16,8192})$/i);

                if (bearerMatch?.[1] === undefined || bearerMatch[2] === undefined) {
                    throw securityErrorCreate(LAYER_ERROR_CODES.AUTH_REQUIRED, 'A valid bearer credential is required.', 401);

                }

                let bearerSchemeData = /** @type {'bearer' | 'dpop'} */ ('bearer');

                if ( String( bearerMatch[1] ).toLowerCase() === String( 'dpop' ) ){
                    bearerSchemeData = 'dpop';

                }

                //Delegating token and optional DPoP proof validation to the configured resolver.
                identityResolveResult = await authenticationOptions.bearerResolve(
                    bearerMatch[2],
                    Object.freeze({
                        scheme: bearerSchemeData,
                        headers: requestSecurityData.headers
                    })
                );

                if (!activeIdentityShapeCheck(identityResolveResult, false) || identityResolveResult.status !== 'active' || identityResolveResult.expiresAt <= clock()) {
                    throw securityErrorCreate(LAYER_ERROR_CODES.AUTH_REQUIRED, 'The bearer credential is not active.', 401);

                }

            } else if (requestSecurityData.auth === 'api-key') {
                if (authenticationOptions.apiKeyResolve === undefined) {
                    throw securityErrorCreate(LAYER_ERROR_CODES.AUTH_REQUIRED, 'API key authentication is unavailable.', 401);

                }

                const apiKeyHeader = layerHeaderValueGet(requestSecurityData.headers, apiKeyHeaderName);

                if (apiKeyHeader === undefined || apiKeyHeader.length < 24 || apiKeyHeader.length > 512 || /\s/.test(apiKeyHeader)) {
                    throw securityErrorCreate(LAYER_ERROR_CODES.AUTH_REQUIRED, 'A valid API key is required.', 401);

                }

                //Hashing the high-entropy API key before repository lookup or logging boundaries.
                const apiKeyHash = createHash('sha256').update(apiKeyHeader, 'utf8').digest('hex');
                identityResolveResult = await authenticationOptions.apiKeyResolve(apiKeyHash);

                if (!activeIdentityShapeCheck(identityResolveResult, false) || identityResolveResult.status !== 'active' || identityResolveResult.expiresAt <= clock()) {
                    throw securityErrorCreate(LAYER_ERROR_CODES.AUTH_REQUIRED, 'The API key is not active.', 401);

                }

            } else {
                throw securityErrorCreate(LAYER_ERROR_CODES.AUTH_REQUIRED, 'The requested authentication mode is not available.', 401);

            }

            identityPermissionsAssert(identityResolveResult, requestSecurityData.permissions);

            //Recording activity only after all credential and operation permission checks pass.
            if ( verifiedSessionTokenData !== '' && authenticationOptions.sessionTouch !== undefined ){
                const sessionActiveStatusData = await authenticationOptions.sessionTouch( verifiedSessionTokenData );

                if ( sessionActiveStatusData !== true ){
                    throw securityErrorCreate( LAYER_ERROR_CODES.AUTH_REQUIRED, 'The session is not active.', 401 );

                }

            }

            return securityContextCreate(identityResolveResult, requestSecurityData.auth, requestSecurityData.remoteAddress);

        }
    });

}
