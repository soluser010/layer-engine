import {createHash} from 'node:crypto';
import {layerSystemTableReferenceCreate} from './system-schema.js';

const defaultRateReserveMultiplier = Number( 2 );
const defaultRateProfiles = Object.freeze({
    anonymous: Object.freeze({
        capacity: Number( 20 ) * defaultRateReserveMultiplier,
        refillPerMinute: Number( 60 ) * defaultRateReserveMultiplier
    }),
    session: Object.freeze({
        capacity: Number( 100 ) * defaultRateReserveMultiplier,
        refillPerMinute: Number( 600 ) * defaultRateReserveMultiplier
    }),
    bearer: Object.freeze({
        capacity: Number( 100 ) * defaultRateReserveMultiplier,
        refillPerMinute: Number( 600 ) * defaultRateReserveMultiplier
    }),
    'api-key': Object.freeze({
        capacity: Number( 200 ) * defaultRateReserveMultiplier,
        refillPerMinute: Number( 1200 ) * defaultRateReserveMultiplier
    })
});

/**
 * @typedef {Readonly<{
 *     capacity: number,
 *     refillPerMinute: number
 * }>} LayerDurableRateProfile
 * @typedef {Readonly<{
 *     query: (queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, unknown>[], rowCount: number | null}>
 * }>} LayerDurableRateTransaction
 * @typedef {Readonly<{
 *     systemSchema?: string,
 *     transaction: <ResultData>(handlerData: (transactionData: LayerDurableRateTransaction) => Promise<ResultData>) => Promise<ResultData>
 * }>} LayerDurableRateDatabase
 */

/**
 * @param {unknown} profileData
 * @returns {asserts profileData is LayerDurableRateProfile}
 */
function rateProfileAssert( profileData ){
    if ( profileData === null || typeof profileData !== 'object' || Array.isArray( profileData ) === true ){
        throw new TypeError( 'Database rate-limit profile is invalid.' );

    }

    const profileRecordData = /** @type {Record<string, unknown>} */ (profileData);

    if (
        Number.isInteger( profileRecordData.capacity ) === false ||
        Number( profileRecordData.capacity ) < Number( 1 ) ||
        Number( profileRecordData.capacity ) > Number( 1000000 ) ||
        Number.isInteger( profileRecordData.refillPerMinute ) === false ||
        Number( profileRecordData.refillPerMinute ) < Number( 1 ) ||
        Number( profileRecordData.refillPerMinute ) > Number( 10000000 )
    ){
        throw new TypeError( 'Database rate-limit profile bounds are invalid.' );

    }

}

/**
 * @param {string} identityData
 */
function bucketIdentityHashCreate( identityData ){
    return createHash( 'sha256' ).update( identityData, 'utf8' ).digest( 'hex' );

}

/**
 * @param {object} limiterOptionsData
 * @param {LayerDurableRateDatabase} limiterOptionsData.database
 * @param {Readonly<Record<'anonymous' | 'session' | 'bearer' | 'api-key', LayerDurableRateProfile>>} [limiterOptionsData.profiles]
 * @param {string} [limiterOptionsData.keyPrefix]
 * @param {number} [limiterOptionsData.entryTtlMs]
 * @param {() => number} [limiterOptionsData.clock]
 */
export function layerDatabaseRateLimiterCreate( limiterOptionsData ){
    const rateProfilesData = limiterOptionsData.profiles ?? defaultRateProfiles;
    const keyPrefixData = limiterOptionsData.keyPrefix ?? 'layer:rate';
    const entryTtlMsData = limiterOptionsData.entryTtlMs ?? Number( 600000 );
    const clockData = limiterOptionsData.clock ?? Date.now;

    if ( typeof limiterOptionsData.database?.transaction !== 'function' ){
        throw new TypeError( 'Database rate limiter requires transactions.' );

    }

    if (
        /^[a-z][a-z0-9:_-]{0,79}$/.test( keyPrefixData ) === false ||
        Number.isInteger( entryTtlMsData ) === false ||
        Number( entryTtlMsData ) < Number( 1000 ) ||
        Number( entryTtlMsData ) > Number( 86400000 )
    ){
        throw new TypeError( 'Database rate limiter bounds are invalid.' );

    }

    for ( const profileData of Object.values( rateProfilesData ) ){
        rateProfileAssert( profileData );

    }

    const rateLimitTableData = layerSystemTableReferenceCreate(
        limiterOptionsData.database,
        'sys_rate_limits'
    );

    return Object.freeze({
        /**
         * @param {object} rateRequestData
         * @param {'anonymous' | 'session' | 'bearer' | 'api-key'} rateRequestData.profile
         * @param {string} rateRequestData.remoteAddress
         * @param {string | null} [rateRequestData.credentialId]
         * @param {string | null} rateRequestData.sessionId
         * @param {string | null} rateRequestData.userId
         * @param {string | null} rateRequestData.tenantId
         * @param {string} rateRequestData.operation
         * @param {number} rateRequestData.cost
         */
        async consume( rateRequestData ){
            const rateProfileData = rateProfilesData[rateRequestData.profile];

            if (
                rateProfileData === undefined ||
                typeof rateRequestData.remoteAddress !== 'string' ||
                Number( rateRequestData.remoteAddress.length ) < Number( 1 ) ||
                Number( rateRequestData.remoteAddress.length ) > Number( 160 ) ||
                typeof rateRequestData.operation !== 'string' ||
                /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test( rateRequestData.operation ) === false ||
                Number.isInteger( rateRequestData.cost ) === false ||
                Number( rateRequestData.cost ) < Number( 1 ) ||
                Number( rateRequestData.cost ) > Number( 1000 )
            ){
                throw new TypeError( 'Database rate-limit request is invalid.' );

            }

            const identityDimensionsData = [
                `ip:${String( rateRequestData.remoteAddress )}`,
                `ip-operation:${String( rateRequestData.remoteAddress )}:${String( rateRequestData.operation )}`
            ];

            for ( const [dimensionNameData, dimensionValueData] of [
                ['credential', rateRequestData.credentialId],
                ['session', rateRequestData.sessionId],
                ['user', rateRequestData.userId],
                ['tenant', rateRequestData.tenantId]
            ] ){
                if ( dimensionValueData !== undefined && dimensionValueData !== null ){
                    identityDimensionsData.push( `${String( dimensionNameData )}:${String( dimensionValueData )}` );

                }

            }

            const bucketKeysData = identityDimensionsData.map(function bucketKeyCreate( identityData ){
                return `${String( keyPrefixData )}:${String( rateRequestData.profile )}:${String( bucketIdentityHashCreate( identityData ) )}`;

            }).sort();
            const currentTimeData = Number( clockData() );
            const expirationTimeData = Number( currentTimeData ) + Number( entryTtlMsData );

            if ( Number.isFinite( currentTimeData ) === false || Number( currentTimeData ) < Number( 0 ) ){
                throw new TypeError( 'Database rate-limit clock is invalid.' );

            }

            return limiterOptionsData.database.transaction(async function rateLimitTransactionExecute( transactionData ){
                const evaluatedBucketsData = [];

                //Creating missing rows before ordered row locks prevent concurrent first-use bypass
                for ( const bucketKeyData of bucketKeysData ){
                    await transactionData.query({
                        text: `
                            INSERT INTO ${rateLimitTableData} (
                                bucket_key,
                                tokens,
                                updated_at,
                                expires_at
                            ) VALUES ($1, $2, to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0))
                            ON CONFLICT (bucket_key) DO NOTHING
                        `,
                        values: [
                            bucketKeyData,
                            rateProfileData.capacity,
                            currentTimeData,
                            expirationTimeData
                        ]
                    });

                }

                //Locking in stable key order prevents workers from deadlocking across shared dimensions
                for ( const bucketKeyData of bucketKeysData ){
                    const bucketResultData = await transactionData.query({
                        text: `
                            SELECT
                                tokens,
                                EXTRACT(EPOCH FROM updated_at) * 1000 AS updated_at_ms,
                                EXTRACT(EPOCH FROM expires_at) * 1000 AS expires_at_ms
                            FROM ${rateLimitTableData}
                            WHERE bucket_key = $1
                            FOR UPDATE
                        `,
                        values: [bucketKeyData]
                    });
                    const bucketRowData = bucketResultData.rows[0];

                    if ( bucketRowData === undefined ){
                        throw new Error( 'Database rate-limit bucket is unavailable.' );

                    }

                    const storedTokensData = Number( bucketRowData.tokens );
                    const updatedAtData = Number( bucketRowData.updated_at_ms );
                    const expiresAtData = Number( bucketRowData.expires_at_ms );

                    if (
                        Number.isFinite( storedTokensData ) === false ||
                        Number.isFinite( updatedAtData ) === false ||
                        Number.isFinite( expiresAtData ) === false
                    ){
                        throw new Error( 'Database rate-limit bucket is invalid.' );

                    }

                    let availableTokensData = Number( rateProfileData.capacity );

                    if ( Number( expiresAtData ) > Number( currentTimeData ) ){
                        const elapsedTimeData = Math.max( Number( 0 ), Number( currentTimeData ) - Number( updatedAtData ) );
                        availableTokensData = Math.min(
                            Number( rateProfileData.capacity ),
                            Number( storedTokensData ) + (
                                Number( elapsedTimeData ) * Number( rateProfileData.refillPerMinute ) / Number( 60000 )
                            )
                        );

                    }

                    evaluatedBucketsData.push({
                        key: bucketKeyData,
                        available: availableTokensData
                    });

                }

                const exhaustedBucketData = evaluatedBucketsData.find(function exhaustedBucketFind( bucketData ){
                    return Number( bucketData.available ) < Number( rateRequestData.cost );

                });

                if ( exhaustedBucketData !== undefined ){
                    const missingTokensData = Number( rateRequestData.cost ) - Number( exhaustedBucketData.available );

                    return Object.freeze({
                        allowed: false,
                        remaining: Math.max( Number( 0 ), Math.floor( exhaustedBucketData.available ) ),
                        retryAfterMs: Math.ceil(
                            Number( missingTokensData ) * Number( 60000 ) / Number( rateProfileData.refillPerMinute )
                        )
                    });

                }

                let remainingTokensData = Number.POSITIVE_INFINITY;

                //Deducting every dimension only after the complete request is allowed
                for ( const bucketData of evaluatedBucketsData ){
                    const nextTokensData = Number( bucketData.available ) - Number( rateRequestData.cost );

                    await transactionData.query({
                        text: `
                            UPDATE ${rateLimitTableData}
                            SET
                                tokens = $2,
                                updated_at = to_timestamp($3 / 1000.0),
                                expires_at = to_timestamp($4 / 1000.0)
                            WHERE bucket_key = $1
                        `,
                        values: [
                            bucketData.key,
                            nextTokensData,
                            currentTimeData,
                            expirationTimeData
                        ]
                    });
                    remainingTokensData = Math.min( remainingTokensData, Math.floor( nextTokensData ) );

                }

                return Object.freeze({
                    allowed: true,
                    remaining: remainingTokensData,
                    retryAfterMs: Number( 0 )
                });

            });

        }
    });

}
