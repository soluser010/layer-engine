const defaultRateReserveMultiplier = 2;
const defaultRateProfiles = Object.freeze({
    anonymous: Object.freeze({
        capacity: 20 * defaultRateReserveMultiplier,
        refillPerMinute: 60 * defaultRateReserveMultiplier
    }),
    session: Object.freeze({
        capacity: 100 * defaultRateReserveMultiplier,
        refillPerMinute: 600 * defaultRateReserveMultiplier
    }),
    bearer: Object.freeze({
        capacity: 100 * defaultRateReserveMultiplier,
        refillPerMinute: 600 * defaultRateReserveMultiplier
    }),
    'api-key': Object.freeze({
        capacity: 200 * defaultRateReserveMultiplier,
        refillPerMinute: 1200 * defaultRateReserveMultiplier
    })
});

/**
 * @typedef {object} LayerRateBucketState
 * @property {number} tokens
 * @property {number} updatedAt
 * @property {number} touchedAt
 */

/**
 * @typedef {object} LayerRateLimitResult
 * @property {boolean} allowed
 * @property {number} remaining
 * @property {number} retryAfterMs
 */

/**
 * @param {object} limiterOptions
 * @param {() => number} [limiterOptions.clock]
 * @param {number} [limiterOptions.maxEntries]
 * @param {number} [limiterOptions.entryTtlMs]
 */
export function layerInMemoryRateLimiterCreate(limiterOptions = {}) {
    const clock = limiterOptions.clock ?? Date.now;
    const maxEntries = limiterOptions.maxEntries ?? 10000;
    const entryTtlMs = limiterOptions.entryTtlMs ?? 600000;
    const bucketStateMap = /** @type {Map<string, LayerRateBucketState>} */ (new Map());

    //Checking bounded memory configuration at startup.
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isInteger(entryTtlMs) || entryTtlMs < 1000) {
        throw new TypeError('Rate limiter bounds are invalid.');

    }

    /**
     * @param {number} currentTime
     */
    function expiredBucketsRemove(currentTime) {
        //Removing inactive buckets before accepting new untrusted identities.
        for (const [bucketKey, bucketState] of bucketStateMap.entries()) {
            if (currentTime - bucketState.touchedAt > entryTtlMs) {
                bucketStateMap.delete(bucketKey);

            }

        }

    }

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
         * @returns {LayerRateLimitResult}
         */
        consume(rateRequestData) {
            const currentTime = clock();
            const rateProfile = defaultRateProfiles[rateRequestData.profile];

            //Checking the requested cost before touching bucket state.
            if (!Number.isInteger(rateRequestData.cost) || rateRequestData.cost < 1 || rateRequestData.cost > 1000) {
                throw new TypeError('Rate-limit cost is invalid.');

            }

            const identityKeys = [
                `ip:${rateRequestData.remoteAddress}`,
                `ip-operation:${rateRequestData.remoteAddress}:${rateRequestData.operation}`
            ];

            if (rateRequestData.credentialId !== undefined && rateRequestData.credentialId !== null) {
                //Adding the exact server-resolved session, bearer or API-key credential dimension.
                identityKeys.push(`credential:${rateRequestData.credentialId}`);

            }

            //Adding authenticated dimensions without trusting payload identity.
            if (rateRequestData.sessionId !== null) {
                identityKeys.push(`session:${rateRequestData.sessionId}`);

            }

            if (rateRequestData.userId !== null) {
                identityKeys.push(`user:${rateRequestData.userId}`);

            }

            if (rateRequestData.tenantId !== null) {
                identityKeys.push(`tenant:${rateRequestData.tenantId}`);

            }

            expiredBucketsRemove(currentTime);

            //Failing closed when untrusted identities exhaust the bounded map.
            let missingBucketCount = 0;

            //Counting new buckets before mutating the bounded store.
            for (const identityKey of identityKeys) {
                if (!bucketStateMap.has(`${rateRequestData.profile}:${identityKey}`)) {
                    missingBucketCount += 1;

                }

            }

            if (bucketStateMap.size + missingBucketCount > maxEntries) {
                return {
                    allowed: false,
                    remaining: 0,
                    retryAfterMs: entryTtlMs
                };

            }

            const evaluatedBuckets = [];

            //Refilling every applicable identity bucket at the same timestamp.
            for (const identityKey of identityKeys) {
                const bucketKey = `${rateRequestData.profile}:${identityKey}`;
                const existingBucket = bucketStateMap.get(bucketKey);
                let availableTokens = /** @type {number} */ (rateProfile.capacity);

                //Applying elapsed refill only to an existing bucket.
                if (existingBucket !== undefined) {
                    const elapsedMs = Math.max(0, currentTime - existingBucket.updatedAt);

                    availableTokens = Math.min(
                        rateProfile.capacity,
                        existingBucket.tokens + (elapsedMs * rateProfile.refillPerMinute / 60000)
                    );

                }

                evaluatedBuckets.push({
                    bucketKey,
                    availableTokens
                });

            }

            let exhaustedBucket;

            //Finding the first exhausted dimension without deducting partial cost.
            for (const bucketData of evaluatedBuckets) {
                if (bucketData.availableTokens < rateRequestData.cost) {
                    exhaustedBucket = bucketData;

                    break;

                }

            }

            //Returning the strictest exhausted dimension without partial deduction.
            if (exhaustedBucket !== undefined) {
                const missingTokens = rateRequestData.cost - exhaustedBucket.availableTokens;
                const retryAfterMs = Math.ceil(missingTokens * 60000 / rateProfile.refillPerMinute);

                return {
                    allowed: false,
                    remaining: Math.floor(exhaustedBucket.availableTokens),
                    retryAfterMs
                };

            }

            //Recording the cost atomically across every in-process dimension.
            for (const bucketData of evaluatedBuckets) {
                bucketStateMap.set(bucketData.bucketKey, {
                    tokens: bucketData.availableTokens - rateRequestData.cost,
                    updatedAt: currentTime,
                    touchedAt: currentTime
                });

            }

            let remainingTokens = Number.POSITIVE_INFINITY;

            //Returning the strictest remaining balance across all dimensions.
            for (const bucketData of evaluatedBuckets) {
                remainingTokens = Math.min(
                    remainingTokens,
                    Math.floor(bucketData.availableTokens - rateRequestData.cost)
                );

            }

            return {
                allowed: true,
                remaining: remainingTokens,
                retryAfterMs: 0
            };

        },

        sizeGet() {
            //Reporting bounded state for health checks and tests.
            return bucketStateMap.size;

        }
    });

}
