import {
    createHash,
    randomUUID
} from 'node:crypto';

const cacheInvalidationScript = String.raw`
-- layer:cache-invalidate
redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[2])
local cacheKeysData = redis.call('SMEMBERS', KEYS[1])
if #cacheKeysData > 0 then
    redis.call('DEL', unpack(cacheKeysData))
end
redis.call('DEL', KEYS[1])
return #cacheKeysData
`;
const cacheGenerationScript = String.raw`
-- layer:cache-generation
redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2])
return redis.call('GET', KEYS[1])
`;
const cacheWriteScript = String.raw`
-- layer:cache-write
if ARGV[3] ~= '' and redis.call('GET', KEYS[2]) ~= ARGV[3] then
    return 0
end
for indexData = 3, #KEYS do
    if redis.call('SCARD', KEYS[indexData]) >= 4096 and redis.call('SISMEMBER', KEYS[indexData], KEYS[1]) == 0 then
        return 0
    end
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
for indexData = 3, #KEYS do
    redis.call('SADD', KEYS[indexData], KEYS[1])
    if redis.call('PTTL', KEYS[indexData]) < tonumber(ARGV[2]) then
        redis.call('PEXPIRE', KEYS[indexData], ARGV[2])
    end
end
return 1
`;
const cacheLeaseReleaseScript = String.raw`
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
`;

/**
 * @param {unknown} valueData
 * @param {Set<object>} visitedData
 * @param {number} depthData
 * @returns {unknown}
 */
function canonicalValueCreate( valueData, visitedData, depthData ){
    if ( Number( depthData ) > Number( 32 ) ){
        throw new TypeError( 'Cache payload depth is invalid.' );

    }

    if (
        valueData === null ||
        typeof valueData === 'string' ||
        typeof valueData === 'boolean'
    ){
        return valueData;

    }

    if ( typeof valueData === 'number' ){
        if ( Number.isFinite( valueData ) === false ){
            throw new TypeError( 'Cache payload number is invalid.' );

        }

        return valueData;

    }

    if ( typeof valueData !== 'object' ){
        throw new TypeError( 'Cache payload value is unsupported.' );

    }

    if ( visitedData.has( valueData ) === true ){
        throw new TypeError( 'Cache payload must not contain cycles.' );

    }

    visitedData.add( valueData );
    let canonicalValueData;

    if ( Array.isArray( valueData ) === true ){
        if ( Number( valueData.length ) > Number( 1000 ) ){
            throw new TypeError( 'Cache payload array is oversized.' );

        }

        canonicalValueData = valueData.map(function canonicalArrayValueCreate( itemData ){
            //Preserving array order while recursively validating payload values
            return canonicalValueCreate( itemData, visitedData, Number( depthData ) + Number( 1 ) );

        });

    } else {
        const valueRecordData = /** @type {Record<string, unknown>} */ (valueData);
        const valueKeysData = Object.keys( valueRecordData ).sort();

        if ( Number( valueKeysData.length ) > Number( 1000 ) ){
            throw new TypeError( 'Cache payload object is oversized.' );

        }

        const canonicalRecordData = /** @type {Record<string, unknown>} */ ({});

        for ( const valueKeyData of valueKeysData ){
            canonicalRecordData[valueKeyData] = canonicalValueCreate(
                valueRecordData[valueKeyData],
                visitedData,
                Number( depthData ) + Number( 1 )
            );

        }

        canonicalValueData = canonicalRecordData;

    }

    visitedData.delete( valueData );

    return canonicalValueData;

}

/** @param {unknown} valueData */
function canonicalSourceCreate( valueData ){
    //Producing a stable digest input without accepting cycles or unbounded nesting
    return JSON.stringify( canonicalValueCreate( valueData, new Set(), Number( 0 ) ) );

}

/**
 * @param {'global' | 'tenant' | 'user'} scopeData
 * @param {{tenantId?: string | null, userId?: string | null}} securityData
 */
function cacheScopeIdentityCreate( scopeData, securityData ){
    if ( scopeData === 'global' ){
        return String( 'global' );

    }

    let identityData = securityData.tenantId;

    if ( scopeData === 'user' ){
        identityData = securityData.userId;

    }

    if (
        typeof identityData !== 'string' ||
        Number( identityData.length ) < Number( 1 ) ||
        Number( identityData.length ) > Number( 200 )
    ){
        throw new TypeError( 'Cache scope identity is unavailable.' );

    }

    //Including tenant ownership for user-scoped entries and their invalidation tags
    let identityPartsData = /** @type {(string | null)[]} */ ([scopeData, identityData]);

    if ( scopeData === 'user' ){
        const tenantIdentityData = securityData.tenantId ?? null;

        if ( tenantIdentityData !== null && (typeof tenantIdentityData !== 'string' || tenantIdentityData.length < 1 || tenantIdentityData.length > 200) ){
            throw new TypeError( 'Cache tenant identity is invalid.' );

        }

        identityPartsData = [scopeData, tenantIdentityData, identityData];

    }

    //Separating this encoding from old entries, including delimiter-like identity values
    return createHash( 'sha256' ).update( JSON.stringify( identityPartsData ), 'utf8' ).digest( 'hex' );

}

/**
 * @param {object} cacheOptionsData
 * @param {{get: Function, set: Function, sAdd: Function, pExpire: Function, eval: Function}} cacheOptionsData.redis
 * @param {string} cacheOptionsData.namespace
 * @param {number} [cacheOptionsData.protocolVersion]
 * @param {string} [cacheOptionsData.schemaVersion]
 * @param {number} [cacheOptionsData.maximumEntryBytes]
 * @param {number} [cacheOptionsData.leaseMs]
 * @param {() => string} [cacheOptionsData.tokenCreate]
 * @param {() => boolean} [cacheOptionsData.isReady]
 */
export function layerRedisQueryCacheCreate( cacheOptionsData ){
    const protocolVersionData = cacheOptionsData.protocolVersion ?? Number( 1 );
    const schemaVersionData = cacheOptionsData.schemaVersion ?? String( '1' );
    const maximumEntryBytesData = cacheOptionsData.maximumEntryBytes ?? Number( 256 * 1024 );
    const leaseMsData = cacheOptionsData.leaseMs ?? Number( 5000 );
    const tokenCreateData = cacheOptionsData.tokenCreate ?? randomUUID;
    const readyReadData = cacheOptionsData.isReady ?? function(){
        //Standalone adapters own their own dependency readiness
        return true;

    };
    const generationTtlData = 3630000;

    if (
        typeof cacheOptionsData.redis?.get !== 'function' ||
        typeof cacheOptionsData.redis?.set !== 'function' ||
        typeof cacheOptionsData.redis?.sAdd !== 'function' ||
        typeof cacheOptionsData.redis?.pExpire !== 'function' ||
        typeof cacheOptionsData.redis?.eval !== 'function' ||
        typeof readyReadData !== 'function'
    ){
        throw new TypeError( 'Redis query cache requires cache and set operations.' );

    }

    if (
        /^[a-z][a-z0-9:_-]{0,79}$/.test( cacheOptionsData.namespace ) === false ||
        Number.isSafeInteger( protocolVersionData ) === false ||
        Number( protocolVersionData ) < Number( 1 ) ||
        /^[A-Za-z0-9._-]{1,80}$/.test( schemaVersionData ) === false ||
        Number.isInteger( maximumEntryBytesData ) === false ||
        Number( maximumEntryBytesData ) < Number( 1024 ) ||
        Number( maximumEntryBytesData ) > Number( 1024 * 1024 ) ||
        Number.isInteger( leaseMsData ) === false ||
        Number( leaseMsData ) < Number( 100 ) ||
        Number( leaseMsData ) > Number( 30000 )
    ){
        throw new TypeError( 'Redis query cache bounds are invalid.' );

    }

    const cacheKeyCreate = function( /** @type {any} */ cacheRequestData ){
        //Separating operation, actor scope and canonical payload within this application
        if (
            typeof cacheRequestData.operation !== 'string' ||
            /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test( cacheRequestData.operation ) === false
        ){
            throw new TypeError( 'Cache operation is invalid.' );

        }

        const scopeIdentityData = cacheScopeIdentityCreate(
            cacheRequestData.metadata.scope,
            cacheRequestData.security
        );
        const requestDigestData = createHash( 'sha256' )
            .update( canonicalSourceCreate( cacheRequestData.payload ), 'utf8' )
            .digest( 'hex' );

        return `${String( cacheOptionsData.namespace )}:v3:query:${String( protocolVersionData )}:${String( schemaVersionData )}:${String( cacheRequestData.operation )}:${String( cacheRequestData.metadata.scope )}:${String( scopeIdentityData )}:${String( requestDigestData )}`;

    };
    const tagKeyCreate = function( /** @type {string} */ tagData, /** @type {any} */ cacheRequestData ){
        //Using the same actor ownership for invalidation as for cached entries
        const scopeIdentityData = cacheScopeIdentityCreate(
            cacheRequestData.metadata.scope,
            cacheRequestData.security
        );

        return `${String( cacheOptionsData.namespace )}:v3:tag:${String( cacheRequestData.metadata.scope )}:${String( scopeIdentityData )}:${String( tagData )}`;

    };
    const invalidationCursorKeyData = `${String( cacheOptionsData.namespace )}:v3:invalidation:cursor`;
    const generationKeyData = `${String( cacheOptionsData.namespace )}:v3:generation`;

    return Object.freeze({
        async generationRead(){
            //Failing closed while a managed cache has not replayed its invalidations
            if ( readyReadData() !== true ){
                throw new Error( 'CACHE_UNAVAILABLE' );

            }

            const generationData = await cacheOptionsData.redis.eval( cacheGenerationScript, {
                keys: [generationKeyData],
                arguments: [randomUUID(), String( generationTtlData )]
            });

            if ( typeof generationData !== 'string' || generationData.length < 1 || generationData.length > 200 ){
                throw new Error( 'Redis cache generation is invalid.' );

            }

            //CallBack THE STRING
            return generationData;

        },

        /** @param {any} cacheRequestData */
        async read( cacheRequestData ){
            //Bypassing stale cache contents until startup or reconnect catch-up is complete
            if ( readyReadData() !== true ){
                return Object.freeze({hit: false, value: null});

            }

            const cachedSourceData = await cacheOptionsData.redis.get( cacheKeyCreate( cacheRequestData ) );

            if ( cachedSourceData === null || readyReadData() !== true ){
                return Object.freeze({hit: false, value: null});

            }

            if (
                typeof cachedSourceData !== 'string' ||
                Buffer.byteLength( cachedSourceData, 'utf8' ) > Number( maximumEntryBytesData )
            ){
                throw new Error( 'Redis query cache entry is invalid.' );

            }

            const cachedEnvelopeData = JSON.parse( cachedSourceData );

            if (
                cachedEnvelopeData === null ||
                typeof cachedEnvelopeData !== 'object' ||
                Array.isArray( cachedEnvelopeData ) === true ||
                Object.keys( cachedEnvelopeData ).length !== Number( 1 ) ||
                Object.prototype.hasOwnProperty.call( cachedEnvelopeData, 'value' ) === false
            ){
                throw new Error( 'Redis query cache envelope is invalid.' );

            }

            return Object.freeze({
                hit: true,
                value: cachedEnvelopeData.value
            });

        },

        /** @param {any} cacheRequestData @param {unknown} resultData @param {string} [generationData] */
        async write( cacheRequestData, resultData, generationData ){
            if ( readyReadData() !== true ){
                return false;

            }

            //Bounding Lua work and lifetime for direct infrastructure callers too
            const metadataData = cacheRequestData.metadata;

            if ( Number.isInteger( metadataData.ttlMs ) === false || metadataData.ttlMs < 1 || metadataData.ttlMs > 3600000 ||
                Array.isArray( metadataData.tags ) === false || metadataData.tags.length > 16 ||
                metadataData.tags.some(function( /** @type {unknown} */ tagData ){
                    //Restricting infrastructure tags to bounded stable identifiers
                    return typeof tagData !== 'string' || /^[a-z][a-z0-9:_-]{0,79}$/.test( tagData ) === false;

                }) ){
                throw new TypeError( 'Cache metadata is invalid.' );

            }

            const cacheKeyData = cacheKeyCreate( cacheRequestData );
            const cacheSourceData = JSON.stringify({value: resultData});

            if ( Buffer.byteLength( cacheSourceData, 'utf8' ) > Number( maximumEntryBytesData ) ){
                return false;

            }

            //Publishing entry and tags atomically only if no invalidation overtook its loader
            const tagKeysData = metadataData.tags.map(function( /** @type {string} */ tagData ){
                //Resolving each tag inside this request's security scope
                return tagKeyCreate( tagData, cacheRequestData );

            });
            const writeResultData = await cacheOptionsData.redis.eval( cacheWriteScript, {
                keys: [cacheKeyData, generationKeyData, ...tagKeysData],
                arguments: [cacheSourceData, String( metadataData.ttlMs ), generationData ?? '']
            });

            return Number( writeResultData ) === 1;

        },

        /** @param {any} invalidationData */
        async invalidate( invalidationData ){
            //Replacing the fill generation and deleting each tagged group atomically
            let removedCountData = Number( 0 );

            for ( const tagData of invalidationData.tags ){
                const tagKeyData = tagKeyCreate( tagData, invalidationData );
                const invalidationResultData = await cacheOptionsData.redis.eval( cacheInvalidationScript, {
                    keys: [tagKeyData, generationKeyData],
                    arguments: [randomUUID(), String( generationTtlData )]
                });

                removedCountData += Number( invalidationResultData );

            }

            return removedCountData;

        },

        async invalidationCursorRead(){
            //Recovering the last durable replay checkpoint without trusting malformed cache values
            const cursorSourceData = await cacheOptionsData.redis.get( invalidationCursorKeyData );

            if ( cursorSourceData === null ){
                return Number( 0 );

            }

            const cursorData = Number( cursorSourceData );

            if ( Number.isSafeInteger( cursorData ) === false || Number( cursorData ) < Number( 0 ) ){
                throw new Error( 'Redis query cache invalidation cursor is invalid.' );

            }

            return cursorData;

        },

        /** @param {number} cursorData */
        async invalidationCursorWrite( cursorData ){
            //Recording only bounded journal positions supplied by the synchronizer
            if ( Number.isSafeInteger( cursorData ) === false || Number( cursorData ) < Number( 0 ) ){
                throw new TypeError( 'Cache invalidation cursor is invalid.' );

            }

            await cacheOptionsData.redis.set( invalidationCursorKeyData, String( cursorData ) );

        },

        /** @param {any} cacheRequestData @param {() => Promise<unknown>} loadData */
        async execute( cacheRequestData, loadData ){
            //Avoiding leases and queued Redis commands while the durable fallback owns readiness
            if ( readyReadData() !== true ){
                return loadData();

            }

            const cacheResultData = await this.read( cacheRequestData );

            if ( cacheResultData.hit === true ){
                return cacheResultData.value;

            }

            const cacheKeyData = cacheKeyCreate( cacheRequestData );
            const leaseKeyData = `${String( cacheKeyData )}:lease`;
            const leaseTokenData = tokenCreateData();
            const leaseResultData = await cacheOptionsData.redis.set( leaseKeyData, leaseTokenData, {
                NX: true,
                PX: leaseMsData
            });

            if ( leaseResultData !== null ){
                try {
                    const generationData = await this.generationRead();
                    const loadedResultData = await loadData();
                    await this.write( cacheRequestData, loadedResultData, generationData );

                    return loadedResultData;

                } finally {
                    await cacheOptionsData.redis.eval( cacheLeaseReleaseScript, {
                        keys: [leaseKeyData],
                        arguments: [leaseTokenData]
                    });

                }

            }

            for ( const waitTimeData of [25, 50, 100, 200] ){
                await new Promise(function cacheWait( resolve ){
                    //Waiting briefly for the lease owner before using the durable fallback
                    setTimeout( resolve, waitTimeData );

                });
                const retryResultData = await this.read( cacheRequestData );

                if ( retryResultData.hit === true ){
                    return retryResultData.value;

                }

            }

            return loadData();

        }
    });

}
