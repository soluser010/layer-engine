import {createHash} from 'node:crypto';

const redisTokenBucketScript = String.raw`
local timeData = redis.call('TIME')
local currentTime = (tonumber(timeData[1]) * 1000) + math.floor(tonumber(timeData[2]) / 1000)
local costData = tonumber(ARGV[1])
local capacityData = tonumber(ARGV[2])
local refillPerMinuteData = tonumber(ARGV[3])
local expirationData = tonumber(ARGV[4])
local allowedData = 1
local remainingData = capacityData
local retryAfterData = 0
local bucketData = {}

for keyIndex, bucketKey in ipairs(KEYS) do
    local tokensData = tonumber(redis.call('HGET', bucketKey, 'tokens'))
    local updatedAtData = tonumber(redis.call('HGET', bucketKey, 'updatedAt'))

    if tokensData == nil or updatedAtData == nil then
        tokensData = capacityData
        updatedAtData = currentTime
    end

    local elapsedData = math.max(0, currentTime - updatedAtData)
    local availableData = math.min(capacityData, tokensData + (elapsedData * refillPerMinuteData / 60000))
    bucketData[keyIndex] = availableData
    remainingData = math.min(remainingData, math.floor(availableData - costData))

    if availableData < costData then
        allowedData = 0
        local missingData = costData - availableData
        retryAfterData = math.max(retryAfterData, math.ceil(missingData * 60000 / refillPerMinuteData))
    end
end

if allowedData == 1 then
    for keyIndex, bucketKey in ipairs(KEYS) do
        redis.call('HSET', bucketKey, 'tokens', bucketData[keyIndex] - costData, 'updatedAt', currentTime)
        redis.call('PEXPIRE', bucketKey, expirationData)
    end
else
    remainingData = math.max(0, remainingData + costData)
end

return {allowedData, remainingData, retryAfterData}
`;

const defaultRateReserveMultiplier = 2;
const defaultRateProfiles = Object.freeze({
    anonymous: Object.freeze({capacity: 20 * defaultRateReserveMultiplier, refillPerMinute: 60 * defaultRateReserveMultiplier}),
    session: Object.freeze({capacity: 100 * defaultRateReserveMultiplier, refillPerMinute: 600 * defaultRateReserveMultiplier}),
    bearer: Object.freeze({capacity: 100 * defaultRateReserveMultiplier, refillPerMinute: 600 * defaultRateReserveMultiplier}),
    'api-key': Object.freeze({capacity: 200 * defaultRateReserveMultiplier, refillPerMinute: 1200 * defaultRateReserveMultiplier})
});

/**
 * @param {unknown} profileData
 */
function rateProfileAssert(profileData) {
    //Checking each distributed bucket profile before it reaches Lua arithmetic.
    if (typeof profileData !== 'object' || profileData === null || Array.isArray(profileData)) {
        throw new TypeError('Redis rate-limit profile is invalid.');

    }

    const profileRecord = /** @type {Record<string, unknown>} */ (profileData);

    if (!Number.isInteger(profileRecord.capacity) || /** @type {number} */ (profileRecord.capacity) < 1 || /** @type {number} */ (profileRecord.capacity) > 1000000 ||
        !Number.isInteger(profileRecord.refillPerMinute) || /** @type {number} */ (profileRecord.refillPerMinute) < 1 || /** @type {number} */ (profileRecord.refillPerMinute) > 10000000) {
        throw new TypeError('Redis rate-limit profile bounds are invalid.');

    }

}

/**
 * @param {string} identityData
 */
function bucketIdentityHashCreate(identityData) {
    //Hashing identity material before it becomes an observable Redis key.
    return createHash('sha256').update(identityData, 'utf8').digest('hex');

}

/**
 * @param {object} limiterOptions
 * @param {{eval: (scriptData: string, commandData: {keys: readonly string[], arguments: readonly string[]}) => Promise<unknown>}} limiterOptions.redis
 * @param {Readonly<Record<'anonymous' | 'session' | 'bearer' | 'api-key', {capacity: number, refillPerMinute: number}>>} [limiterOptions.profiles]
 * @param {string} [limiterOptions.keyPrefix]
 * @param {number} [limiterOptions.entryTtlMs]
 */
export function layerRedisRateLimiterCreate(limiterOptions) {
    const rateProfiles = limiterOptions.profiles ?? defaultRateProfiles;
    const keyPrefix = limiterOptions.keyPrefix ?? 'layer:rate';
    const entryTtlMs = limiterOptions.entryTtlMs ?? 600000;

    if (typeof limiterOptions.redis?.eval !== 'function') {
        throw new TypeError('Redis rate limiter requires an eval-capable client.');

    }

    if (!/^[a-z][a-z0-9:_-]{0,79}$/.test(keyPrefix) || !Number.isInteger(entryTtlMs) || entryTtlMs < 1000 || entryTtlMs > 86400000) {
        throw new TypeError('Redis rate limiter bounds are invalid.');

    }

    for (const profileData of Object.values(rateProfiles)) {
        rateProfileAssert(profileData);

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
         */
        async consume(rateRequestData) {
            const rateProfile = rateProfiles[rateRequestData.profile];

            if (rateProfile === undefined || !Number.isInteger(rateRequestData.cost) || rateRequestData.cost < 1 || rateRequestData.cost > 1000) {
                throw new TypeError('Redis rate-limit request is invalid.');

            }

            const identityDimensions = [
                `ip:${rateRequestData.remoteAddress}`,
                `ip-operation:${rateRequestData.remoteAddress}:${rateRequestData.operation}`
            ];

            if (rateRequestData.credentialId !== undefined && rateRequestData.credentialId !== null) {
                identityDimensions.push(`credential:${rateRequestData.credentialId}`);

            }

            if (rateRequestData.sessionId !== null) {
                identityDimensions.push(`session:${rateRequestData.sessionId}`);

            }

            if (rateRequestData.userId !== null) {
                identityDimensions.push(`user:${rateRequestData.userId}`);

            }

            if (rateRequestData.tenantId !== null) {
                identityDimensions.push(`tenant:${rateRequestData.tenantId}`);

            }

            const bucketKeys = identityDimensions.map(function bucketKeyCreate(identityData) {
                //Creating a fixed-length opaque key for one independent limit dimension.
                return `${keyPrefix}:${rateRequestData.profile}:${bucketIdentityHashCreate(identityData)}`;

            });
            const redisResult = await limiterOptions.redis.eval(redisTokenBucketScript, {
                keys: bucketKeys,
                arguments: [
                    String(rateRequestData.cost),
                    String(rateProfile.capacity),
                    String(rateProfile.refillPerMinute),
                    String(entryTtlMs)
                ]
            });

            if (!Array.isArray(redisResult) || redisResult.length !== 3 || redisResult.some(function rateResultInvalid(resultData) {
                //Rejecting malformed Redis results instead of disabling protection.
                return typeof resultData !== 'number' && typeof resultData !== 'bigint' && typeof resultData !== 'string';

            })) {
                throw new TypeError('Redis rate-limit result is invalid.');

            }

            const allowedStatus = Number(redisResult[0]) === 1;
            const remainingData = Number(redisResult[1]);
            const retryAfterMs = Number(redisResult[2]);

            if (!Number.isFinite(remainingData) || !Number.isFinite(retryAfterMs) || remainingData < 0 || retryAfterMs < 0) {
                throw new TypeError('Redis rate-limit result bounds are invalid.');

            }

            return Object.freeze({
                allowed: allowedStatus,
                remaining: Math.floor(remainingData),
                retryAfterMs: Math.ceil(retryAfterMs)
            });

        }
    });

}
