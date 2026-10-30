/**
 * @param {unknown} identityData
 * @param {number} currentTimeData
 */
function activeIdentityCheck( identityData, currentTimeData ){
    return (
        identityData !== null &&
        typeof identityData === 'object' &&
        Array.isArray( identityData ) === false &&
        /** @type {{status?: unknown}} */ (identityData).status === 'active' &&
        Number.isFinite( Number( /** @type {{expiresAt?: unknown}} */ (identityData).expiresAt ) ) === true &&
        Number( /** @type {{expiresAt?: unknown}} */ (identityData).expiresAt ) > Number( currentTimeData )
    );

}

/** @param {unknown} hashData */
function apiKeyHashAssert( hashData ){
    //Accepting only a server-derived digest, never an API-key secret
    if ( typeof hashData !== 'string' || /^[0-9a-f]{64}$/.test( hashData ) === false ){
        throw new TypeError( 'API key cache identity is invalid.' );

    }

}

/**
 * @param {object} cacheOptionsData
 * @param {{
 *     read: (requestData: any) => Promise<{hit: boolean, value: unknown}>,
 *     write: (requestData: any, valueData: unknown, generationData?: string) => Promise<boolean>,
 *     generationRead?: () => Promise<string>,
 *     invalidate: (invalidationData: any) => Promise<number>
 * }} cacheOptionsData.cache
 * @param {{
 *     resolve: (sessionIdentifierData: string) => Promise<any>,
 *     revoke: (sessionIdentifierData: string) => Promise<boolean>,
 *     cacheTagCreate: (sessionIdentifierData: string) => string
 * }} cacheOptionsData.sessions
 * @param {{
 *     resolve: (apiKeyHashData: string) => Promise<any>,
 *     revokeWithCacheTag: (keyIdentifierData: string) => Promise<{revoked: boolean, cacheTag: string | null}>
 * }} cacheOptionsData.apiKeys
 * @param {number} [cacheOptionsData.maximumTtlMs]
 * @param {() => number} [cacheOptionsData.clock]
 * @param {{record: (diagnosticData: Record<string, unknown>) => void}} [cacheOptionsData.diagnostics]
 */
export function layerIdentityCacheCreate( cacheOptionsData ){
    const maximumTtlMsData = cacheOptionsData.maximumTtlMs ?? Number( 30000 );
    const clockData = cacheOptionsData.clock ?? Date.now;

    if (
        typeof cacheOptionsData.cache?.read !== 'function' ||
        typeof cacheOptionsData.cache?.write !== 'function' ||
        typeof cacheOptionsData.cache?.invalidate !== 'function' ||
        typeof cacheOptionsData.sessions?.resolve !== 'function' ||
        typeof cacheOptionsData.sessions?.revoke !== 'function' ||
        typeof cacheOptionsData.sessions?.cacheTagCreate !== 'function' ||
        typeof cacheOptionsData.apiKeys?.resolve !== 'function' ||
        typeof cacheOptionsData.apiKeys?.revokeWithCacheTag !== 'function' ||
        typeof clockData !== 'function' ||
        Number.isInteger( maximumTtlMsData ) === false ||
        Number( maximumTtlMsData ) < Number( 1000 ) ||
        Number( maximumTtlMsData ) > Number( 300000 )
    ){
        throw new TypeError( 'Identity cache options are invalid.' );

    }

    let bypassUntilData = Number( 0 );
    const timeReadData = function(){
        //Validating the trusted clock before applying expiration or fallback windows
        const currentTimeData = Number( clockData() );

        if ( Number.isSafeInteger( currentTimeData ) === false || Number( currentTimeData ) < Number( 0 ) ){
            throw new TypeError( 'Identity cache clock is invalid.' );

        }

        return currentTimeData;

    };
    const requestCreateData = function(
        /** @type {'system.session.resolve' | 'system.api-key.resolve'} */ operationData,
        /** @type {Record<string, unknown>} */ payloadData,
        /** @type {string} */ tagData,
        /** @type {number} */ timeToLiveData
    ){
        return Object.freeze({
            operation: operationData,
            payload: payloadData,
            security: {},
            metadata: Object.freeze({
                ttlMs: timeToLiveData,
                scope: /** @type {const} */ ('global'),
                tags: Object.freeze([tagData])
            })
        });

    };
    const diagnosticRecordData = function( /** @type {string} */ eventNameData ){
        //Reporting a safe cache failure without credential or backend error details
        cacheOptionsData.diagnostics?.record({
            level: 'warning',
            event: eventNameData,
            code: 'CACHE_UNAVAILABLE'
        });

    };
    const identityResolveData = async function(
        /** @type {'system.session.resolve' | 'system.api-key.resolve'} */ operationData,
        /** @type {Record<string, unknown>} */ payloadData,
        /** @type {string} */ tagData,
        /** @type {() => Promise<any>} */ durableResolveData
    ){
        const currentTimeData = timeReadData();
        const requestData = requestCreateData(
            operationData,
            payloadData,
            tagData,
            maximumTtlMsData
        );
        let generationData = /** @type {string | null} */ (null);

        if ( currentTimeData >= Number( bypassUntilData ) && typeof cacheOptionsData.cache.generationRead === 'function' ){
            try {
                //Capturing invalidation ownership before reading the durable identity on a miss
                generationData = await cacheOptionsData.cache.generationRead();
                const cachedIdentityData = await cacheOptionsData.cache.read( requestData );

                if (
                    cachedIdentityData.hit === true &&
                    activeIdentityCheck( cachedIdentityData.value, currentTimeData ) === true
                ){
                    return cachedIdentityData.value;

                }

            } catch {
                diagnosticRecordData( 'identity-cache.read-failed' );

            }

        }

        const durableIdentityData = await durableResolveData();

        if ( activeIdentityCheck( durableIdentityData, currentTimeData ) === false || generationData === null ){
            return durableIdentityData;

        }

        const expirationData = Number( durableIdentityData.expiresAt );
        const timeToLiveData = Math.min(
            maximumTtlMsData,
            Math.max( Number( 1 ), expirationData - currentTimeData )
        );
        const writeRequestData = requestCreateData(
            operationData,
            payloadData,
            tagData,
            timeToLiveData
        );

        try {
            //A revocation committed during resolution prevents this old result from repopulating cache
            await cacheOptionsData.cache.write( writeRequestData, durableIdentityData, generationData );

        } catch {
            diagnosticRecordData( 'identity-cache.write-failed' );

        }

        return durableIdentityData;

    };
    const identityInvalidateData = async function( /** @type {string} */ tagData ){
        //Clearing the durable identity's tag or bypassing this process's cache on failure
        try {
            await cacheOptionsData.cache.invalidate({
                security: {},
                metadata: {
                    scope: 'global'
                },
                tags: [tagData]
            });
            bypassUntilData = Number( 0 );

        } catch {
            bypassUntilData = timeReadData() + Number( maximumTtlMsData );
            diagnosticRecordData( 'identity-cache.invalidation-failed' );

        }

    };

    return Object.freeze({
        sessions: Object.freeze({
            async resolve( /** @type {string} */ sessionIdentifierData ){
                //Hashing validated session identity into the shared cache request
                if (
                    typeof sessionIdentifierData !== 'string' ||
                    Number( sessionIdentifierData.length ) < Number( 1 ) ||
                    Number( sessionIdentifierData.length ) > Number( 512 )
                ){
                    throw new TypeError( 'Session cache identity is invalid.' );

                }

                const cacheTagData = cacheOptionsData.sessions.cacheTagCreate( sessionIdentifierData );

                return identityResolveData(
                    'system.session.resolve',
                    {sessionIdentifier: sessionIdentifierData},
                    cacheTagData,
                    function(){
                        //Resolving the authoritative session on a miss or dependency outage
                        return cacheOptionsData.sessions.resolve( sessionIdentifierData );

                    }
                );

            },

            async revoke( /** @type {string} */ sessionIdentifierData ){
                //Committing revocation before invalidating an already cached identity
                const cacheTagData = cacheOptionsData.sessions.cacheTagCreate( sessionIdentifierData );
                const revokeStatusData = await cacheOptionsData.sessions.revoke( sessionIdentifierData );

                await identityInvalidateData( cacheTagData );

                return revokeStatusData;

            }
        }),

        apiKeys: Object.freeze({
            async resolve( /** @type {string} */ apiKeyHashData ){
                //Using only a checked opaque key hash in cache and durable lookups
                apiKeyHashAssert( apiKeyHashData );

                return identityResolveData(
                    'system.api-key.resolve',
                    {apiKeyHash: apiKeyHashData},
                    `api-key:${String( apiKeyHashData )}`,
                    function(){
                        //Reading authoritative API-key status after a cache miss
                        return cacheOptionsData.apiKeys.resolve( apiKeyHashData );

                    }
                );

            },

            async revoke( /** @type {string} */ keyIdentifierData ){
                //Invalidating only the key whose revocation was durably recorded
                const revokeResultData = await cacheOptionsData.apiKeys.revokeWithCacheTag( keyIdentifierData );

                if ( revokeResultData.cacheTag !== null ){
                    await identityInvalidateData( revokeResultData.cacheTag );

                }

                return revokeResultData.revoked;

            }
        }),

        isBypassing(){
            //Exposing the local safety window after a failed immediate invalidation
            return timeReadData() < Number( bypassUntilData );

        }
    });

}
