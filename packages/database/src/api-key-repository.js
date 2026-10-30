import {cacheInvalidationInsertSqlCreate} from './cache-invalidation-sql.js';
import {
    createHash,
    randomBytes,
    randomUUID
} from 'node:crypto';
import {layerSystemTableReferenceCreate} from './system-schema.js';

/**
 * @param {unknown} valueData
 * @param {string} fieldName
 * @param {boolean} [nullableStatus]
 */
function boundedIdentifierAssert(valueData, fieldName, nullableStatus = false) {
    //Allowing null only for explicitly optional tenant ownership.
    if (nullableStatus && valueData === null) {
        return;

    }

    if (typeof valueData !== 'string' || valueData.length < 1 || valueData.length > 200) {
        throw new TypeError(`${fieldName} is invalid.`);

    }

}

/**
 * @param {unknown} permissionsData
 */
function permissionsAssert(permissionsData) {
    //Checking bounded scopes before they become durable authorization state.
    if (!Array.isArray(permissionsData) || permissionsData.length > 500) {
        throw new TypeError('API key permissions are invalid.');

    }

    //Validating every scope without accepting mixed arrays.
    for (const permissionData of permissionsData) {
        if (typeof permissionData !== 'string' || !/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/.test(permissionData)) {
            throw new TypeError('API key permissions are invalid.');

        }

    }

}

/**
 * @param {object} repositoryOptions
 * @param {{
 *     query: (queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, unknown>[], rowCount: number | null}>,
 *     transaction?: <ResultData>(handlerData: (databaseData: any) => Promise<ResultData>) => Promise<ResultData>
 * }} repositoryOptions.database
 * @param {() => string} [repositoryOptions.secretCreate]
 */
export function layerApiKeyRepositoryCreate(repositoryOptions) {
    const secretCreate = repositoryOptions.secretCreate ?? function apiKeySecretCreate() {
        //Generating 256 bits of entropy for a credential shown only at issuance.
        return `layer_${randomBytes(32).toString('base64url')}`;

    };

    if (typeof repositoryOptions.database?.query !== 'function' || typeof secretCreate !== 'function') {
        throw new TypeError('API key repository options are invalid.');

    }

    //Getting the app-specific API key table before creating credential operations
    const apiKeysTableReferenceData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_api_keys' );
    const invalidationsTableReferenceData = layerSystemTableReferenceCreate(
        repositoryOptions.database,
        'sys_cache_invalidations'
    );
    const transactionExecuteData = repositoryOptions.database.transaction ?? async function apiKeyTransactionFallback(
        /** @type {(databaseData: any) => Promise<any>} */ handlerData
    ){
        return handlerData( repositoryOptions.database );

    };
    const apiKeyRevokeExecuteData = async function( /** @type {string} */ keyIdentifierData ){
        boundedIdentifierAssert(keyIdentifierData, 'keyId');

        return transactionExecuteData(async function apiKeyRevokeTransaction( transactionData ){
            //Revoking only an active key so repeated calls report no change.
            const revokeResult = await transactionData.query({
                text: `
                    UPDATE ${String( apiKeysTableReferenceData )}
                    SET status = 'revoked', updated_at = now()
                    WHERE key_id = $1 AND status = 'active'
                    RETURNING key_hash
                `,
                values: [keyIdentifierData]
            });
            const keyHashData = revokeResult.rows[0]?.key_hash;

            if (
                Number( revokeResult.rowCount ?? 0 ) < Number( 1 ) ||
                typeof keyHashData !== 'string' ||
                /^[0-9a-f]{64}$/.test( keyHashData ) === false
            ){
                return Object.freeze({
                    revoked: false,
                    cacheTag: null
                });

            }

            const cacheTagData = `api-key:${String( keyHashData )}`;

            await transactionData.query({
                text: cacheInvalidationInsertSqlCreate( invalidationsTableReferenceData ),
                values: [
                    `api-key-revoked:${String( randomUUID() )}`,
                    JSON.stringify({
                        scope: 'global',
                        tenantId: null,
                        userId: null,
                        tags: [cacheTagData]
                    })
                ]
            });

            return Object.freeze({
                revoked: true,
                cacheTag: cacheTagData
            });

        });

    };

    return Object.freeze({
        /**
         * @param {object} keyData
         * @param {string} keyData.keyId
         * @param {string} keyData.userId
         * @param {string | null} keyData.tenantId
         * @param {readonly string[]} keyData.permissions
         * @param {string | number | Date} keyData.expiresAt
         */
        async issue(keyData) {
            boundedIdentifierAssert(keyData.keyId, 'keyId');
            boundedIdentifierAssert(keyData.userId, 'userId');
            boundedIdentifierAssert(keyData.tenantId, 'tenantId', true);
            permissionsAssert(keyData.permissions);

            const expirationData = new Date(keyData.expiresAt);

            if (!Number.isFinite(expirationData.getTime())) {
                throw new TypeError('API key expiration is invalid.');

            }

            const apiKeySecret = secretCreate();

            //Rejecting injected weak or whitespace-bearing secret generators.
            if (typeof apiKeySecret !== 'string' || apiKeySecret.length < 32 || apiKeySecret.length > 512 || /\s/.test(apiKeySecret)) {
                throw new TypeError('Generated API key secret is invalid.');

            }

            const apiKeyHash = createHash('sha256').update(apiKeySecret, 'utf8').digest('hex');

            await repositoryOptions.database.query({
                text: `
                    INSERT INTO ${String( apiKeysTableReferenceData )} (
                        key_hash,
                        key_id,
                        user_id,
                        tenant_id,
                        permissions,
                        status,
                        expires_at
                    )
                    VALUES ($1, $2, $3, $4, $5::jsonb, 'active', $6)
                `,
                values: [
                    apiKeyHash,
                    keyData.keyId,
                    keyData.userId,
                    keyData.tenantId,
                    JSON.stringify(keyData.permissions),
                    expirationData.toISOString()
                ]
            });

            return Object.freeze({
                id: keyData.keyId,
                secret: apiKeySecret
            });

        },

        /**
         * @param {string} apiKeyHash
         */
        async resolve(apiKeyHash) {
            if (!/^[0-9a-f]{64}$/.test(apiKeyHash)) {
                return null;

            }

            const keyQueryResult = await repositoryOptions.database.query({
                text: `
                    SELECT key_id, user_id, tenant_id, permissions, status, expires_at
                    FROM ${String( apiKeysTableReferenceData )}
                    WHERE key_hash = $1
                    LIMIT 1
                `,
                values: [apiKeyHash]
            });
            const keyRow = keyQueryResult.rows[0];

            if (keyRow === undefined) {
                return null;

            }

            const permissionList = [];
            let tenantIdentifier = null;
            let keyStatus = /** @type {'active' | 'revoked'} */ ('revoked');

            //Copying only array-shaped permission state from PostgreSQL.
            if (Array.isArray(keyRow.permissions)) {
                for (const permissionData of keyRow.permissions) {
                    permissionList.push(String(permissionData));

                }

            }

            //Normalizing optional tenant ownership without stringifying null.
            if (keyRow.tenant_id !== null) {
                tenantIdentifier = String(keyRow.tenant_id);

            }

            //Accepting the active state explicitly and failing closed otherwise.
            if (keyRow.status === 'active') {
                keyStatus = 'active';

            }

            return {
                id: String(keyRow.key_id),
                userId: String(keyRow.user_id),
                tenantId: tenantIdentifier,
                permissions: permissionList,
                status: keyStatus,
                expiresAt: new Date(/** @type {string | number | Date} */ (keyRow.expires_at)).getTime()
            };

        },

        /**
         * @param {string} keyIdentifier
         */
        async revoke(keyIdentifier) {
            return (await apiKeyRevokeExecuteData( keyIdentifier )).revoked;

        },

        /** @param {string} keyIdentifier */
        async revokeWithCacheTag( keyIdentifier ){
            return apiKeyRevokeExecuteData( keyIdentifier );

        },

        /** @param {string} userIdentifierData */
        async revokeAllByUser( userIdentifierData ){
            boundedIdentifierAssert( userIdentifierData, 'userId' );

            return transactionExecuteData(async function apiKeyUserRevokeTransaction( transactionData ){
                const revokeResultData = await transactionData.query({
                    text: `
                        UPDATE ${String( apiKeysTableReferenceData )}
                        SET status = 'revoked', updated_at = now()
                        WHERE user_id = $1 AND status = 'active'
                        RETURNING key_hash
                    `,
                    values: [userIdentifierData]
                });

                //Publishing cache invalidation for every revoked opaque key hash
                for ( const keyRowData of revokeResultData.rows ){
                    const keyHashData = String( keyRowData.key_hash );

                    if ( /^[0-9a-f]{64}$/u.test( keyHashData ) === false ){
                        continue;

                    }

                    await transactionData.query({
                        text: cacheInvalidationInsertSqlCreate( invalidationsTableReferenceData ),
                        values: [
                            `api-key-revoked:${String( randomUUID() )}`,
                            JSON.stringify({
                                scope: 'global',
                                tenantId: null,
                                userId: userIdentifierData,
                                tags: [`api-key:${String( keyHashData )}`]
                            })
                        ]
                    });

                }

                return Number( revokeResultData.rowCount ?? Number( 0 ) );

            });

        }
    });

}
