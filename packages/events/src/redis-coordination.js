import {randomUUID} from 'node:crypto';

const lockReleaseScriptData = String.raw`
    if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
    end

    return 0
`;
const lockRenewScriptData = String.raw`
    if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('PEXPIRE', KEYS[1], ARGV[2])
    end

    return 0
`;

/** @param {unknown} valueData @param {string} fieldNameData */
function coordinationIdentityAssert( valueData, fieldNameData ){
    if (
        typeof valueData !== 'string' ||
        /^[a-zA-Z0-9:_-]{1,160}$/.test( valueData ) === false
    ){
        throw new TypeError( `${String( fieldNameData )} is invalid.` );

    }

}

/** @param {unknown} ttlData @param {number} maximumData */
function coordinationTtlAssert( ttlData, maximumData ){
    if (
        Number.isInteger( ttlData ) === false ||
        Number( ttlData ) < Number( 1000 ) ||
        Number( ttlData ) > Number( maximumData )
    ){
        throw new TypeError( 'Redis coordination TTL is invalid.' );

    }

}

/**
 * @param {object} coordinationOptionsData
 * @param {{
 *     set: (keyData: string, valueData: string, optionsData: Record<string, unknown>) => Promise<unknown>,
 *     eval: (scriptData: string, optionsData: {keys: string[], arguments: string[]}) => Promise<unknown>,
 *     zAdd: (keyData: string, valueData: {score: number, value: string}) => Promise<unknown>,
 *     zRem: (keyData: string, valueData: string) => Promise<unknown>,
 *     zRemRangeByScore: (keyData: string, minimumData: number | string, maximumData: number | string) => Promise<unknown>,
 *     zRangeByScore: (keyData: string, minimumData: number | string, maximumData: number | string, optionsData: Record<string, unknown>) => Promise<unknown>,
 *     pExpire: (keyData: string, ttlData: number) => Promise<unknown>
 * }} coordinationOptionsData.redis
 * @param {string} coordinationOptionsData.namespace
 * @param {number} [coordinationOptionsData.maximumPresenceMembers]
 * @param {() => number} [coordinationOptionsData.clock]
 * @param {() => string} [coordinationOptionsData.tokenCreate]
 */
export function layerRedisCoordinationCreate( coordinationOptionsData ){
    const redisData = coordinationOptionsData.redis;
    const maximumPresenceMembersData = coordinationOptionsData.maximumPresenceMembers ?? Number( 1000 );
    const clockData = coordinationOptionsData.clock ?? Date.now;
    const tokenCreateData = coordinationOptionsData.tokenCreate ?? randomUUID;

    coordinationIdentityAssert( coordinationOptionsData.namespace, 'Redis coordination namespace' );

    if (
        typeof redisData?.set !== 'function' ||
        typeof redisData?.eval !== 'function' ||
        typeof redisData?.zAdd !== 'function' ||
        typeof redisData?.zRem !== 'function' ||
        typeof redisData?.zRemRangeByScore !== 'function' ||
        typeof redisData?.zRangeByScore !== 'function' ||
        typeof redisData?.pExpire !== 'function' ||
        typeof clockData !== 'function' ||
        typeof tokenCreateData !== 'function' ||
        Number.isInteger( maximumPresenceMembersData ) === false ||
        Number( maximumPresenceMembersData ) < Number( 1 ) ||
        Number( maximumPresenceMembersData ) > Number( 10000 )
    ){
        throw new TypeError( 'Redis coordination options are invalid.' );

    }

    const timeReadData = function(){
        const currentTimeData = Number( clockData() );

        if ( Number.isSafeInteger( currentTimeData ) === false || Number( currentTimeData ) < Number( 0 ) ){
            throw new TypeError( 'Redis coordination clock is invalid.' );

        }

        return currentTimeData;

    };
    const lockKeyCreateData = function( /** @type {string} */ lockNameData ){
        coordinationIdentityAssert( lockNameData, 'Redis lock name' );

        return `${String( coordinationOptionsData.namespace )}:lock:${String( lockNameData )}`;

    };
    const presenceKeyCreateData = function( /** @type {string} */ scopeNameData ){
        coordinationIdentityAssert( scopeNameData, 'Redis presence scope' );

        return `${String( coordinationOptionsData.namespace )}:presence:${String( scopeNameData )}`;

    };
    const lockHandleCreateData = function(
        /** @type {string} */ lockNameData,
        /** @type {string} */ lockKeyData,
        /** @type {string} */ lockTokenData
    ){
        let releasedStatusData = false;

        return Object.freeze({
            name: lockNameData,

            async renew( /** @type {number} */ timeToLiveData ){
                coordinationTtlAssert( timeToLiveData, Number( 60000 ) );

                if ( releasedStatusData === true ){
                    return false;

                }

                const renewalResultData = await redisData.eval(lockRenewScriptData, {
                    keys: [lockKeyData],
                    arguments: [
                        lockTokenData,
                        String( timeToLiveData )
                    ]
                });

                return Number( renewalResultData ) === Number( 1 );

            },

            async release(){
                if ( releasedStatusData === true ){
                    return false;

                }

                const releaseResultData = await redisData.eval(lockReleaseScriptData, {
                    keys: [lockKeyData],
                    arguments: [lockTokenData]
                });
                releasedStatusData = Number( releaseResultData ) === Number( 1 );

                return releasedStatusData;

            }
        });

    };

    return Object.freeze({
        locks: Object.freeze({
            async acquire(
                /** @type {string} */ lockNameData,
                /** @type {number} */ timeToLiveData
            ){
                coordinationTtlAssert( timeToLiveData, Number( 60000 ) );

                const lockKeyData = lockKeyCreateData( lockNameData );
                const lockTokenData = tokenCreateData();

                coordinationIdentityAssert( lockTokenData, 'Redis lock token' );

                const acquisitionResultData = await redisData.set(
                    lockKeyData,
                    lockTokenData,
                    {
                        NX: true,
                        PX: timeToLiveData
                    }
                );

                if ( acquisitionResultData !== 'OK' ){
                    return null;

                }

                return lockHandleCreateData( lockNameData, lockKeyData, lockTokenData );

            }
        }),

        presence: Object.freeze({
            async touch(
                /** @type {string} */ scopeNameData,
                /** @type {string} */ memberIdentifierData,
                /** @type {number} */ timeToLiveData
            ){
                coordinationTtlAssert( timeToLiveData, Number( 300000 ) );
                coordinationIdentityAssert( memberIdentifierData, 'Redis presence member' );

                const presenceKeyData = presenceKeyCreateData( scopeNameData );
                const currentTimeData = timeReadData();

                await redisData.zRemRangeByScore( presenceKeyData, Number( 0 ), currentTimeData );
                await redisData.zAdd(presenceKeyData, {
                    score: currentTimeData + Number( timeToLiveData ),
                    value: memberIdentifierData
                });
                await redisData.pExpire( presenceKeyData, Number( timeToLiveData ) * Number( 2 ) );

            },

            async remove(
                /** @type {string} */ scopeNameData,
                /** @type {string} */ memberIdentifierData
            ){
                coordinationIdentityAssert( memberIdentifierData, 'Redis presence member' );

                const removalResultData = await redisData.zRem(
                    presenceKeyCreateData( scopeNameData ),
                    memberIdentifierData
                );

                return Number( removalResultData ) > Number( 0 );

            },

            async list(
                /** @type {string} */ scopeNameData,
                /** @type {number} */ limitData = Math.min( Number( 100 ), Number( maximumPresenceMembersData ) )
            ){
                if (
                    Number.isInteger( limitData ) === false ||
                    Number( limitData ) < Number( 1 ) ||
                    Number( limitData ) > Number( maximumPresenceMembersData )
                ){
                    throw new TypeError( 'Redis presence limit is invalid.' );

                }

                const presenceKeyData = presenceKeyCreateData( scopeNameData );
                const currentTimeData = timeReadData();

                await redisData.zRemRangeByScore( presenceKeyData, Number( 0 ), currentTimeData );

                const memberListData = await redisData.zRangeByScore(
                    presenceKeyData,
                    currentTimeData,
                    '+inf',
                    {
                        LIMIT: {
                            offset: 0,
                            count: limitData
                        }
                    }
                );

                if (
                    Array.isArray( memberListData ) === false ||
                    memberListData.some((memberData) => typeof memberData !== 'string') === true ||
                    Number( memberListData.length ) > Number( limitData )
                ){
                    throw new TypeError( 'Redis presence response is invalid.' );

                }

                return Object.freeze([...memberListData]);

            }
        })
    });

}
