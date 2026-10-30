import {cacheInvalidationInsertSqlCreate} from './cache-invalidation-sql.js';
import {
    createHash,
    createHmac,
    randomUUID
} from 'node:crypto';
import {layerSystemTableReferenceCreate} from './system-schema.js';

/**
 * @param {object} repositoryOptions
 * @param {{
 *     query: (queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, unknown>[], rowCount: number | null}>,
 *     transaction?: <ResultData>(handlerData: (databaseData: any) => Promise<ResultData>) => Promise<ResultData>
 * }} repositoryOptions.database
 * @param {string} repositoryOptions.sessionPepper
 */
export function layerSessionRepositoryCreate(repositoryOptions) {
    //Checking the server-only pepper before accepting session lookups.
    if (typeof repositoryOptions.sessionPepper !== 'string' || repositoryOptions.sessionPepper.length < 32) {
        throw new TypeError('sessionPepper must contain at least 32 characters.');

    }

    //Getting the app-specific system session table before accepting lookups
    const sessionsTableReferenceData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_sessions' );
    const invalidationsTableReferenceData = layerSystemTableReferenceCreate(
        repositoryOptions.database,
        'sys_cache_invalidations'
    );
    const sessionHashCreateData = function( /** @type {string} */ sessionIdentifierData ){
        return createHmac('sha256', repositoryOptions.sessionPepper)
            .update(sessionIdentifierData, 'utf8')
            .digest('hex');

    };
    const sessionCacheTagCreateData = function( /** @type {string} */ sessionIdentifierData ){
        return `session:${createHash( 'sha256' ).update( sessionIdentifierData, 'utf8' ).digest( 'hex' )}`;

    };
    const transactionExecuteData = repositoryOptions.database.transaction ?? async function sessionTransactionFallback(
        /** @type {(databaseData: any) => Promise<any>} */ handlerData
    ){
        return handlerData( repositoryOptions.database );

    };

    return Object.freeze({
        /**
         * @param {string} sessionIdentifier
         */
        async resolve(sessionIdentifier) {
            //Hashing the opaque identifier before sending it to PostgreSQL.
            const sessionHash = sessionHashCreateData( sessionIdentifier );
            const sessionQueryResult = await repositoryOptions.database.query({
                text: `
                    SELECT user_id, tenant_id, permissions, csrf_hash, status, expires_at
                    FROM ${String( sessionsTableReferenceData )}
                    WHERE session_hash = $1
                    LIMIT 1
                `,
                values: [sessionHash]
            });
            const sessionRow = sessionQueryResult.rows[0];

            //Returning an explicit miss without revealing hash or lookup details.
            if (sessionRow === undefined) {
                return null;

            }

            let tenantIdentifier = null;
            const permissions = [];
            let sessionStatus = /** @type {'active' | 'revoked'} */ ('revoked');

            //Normalizing the optional tenant identifier from the database row.
            if (sessionRow.tenant_id !== null) {
                tenantIdentifier = String(sessionRow.tenant_id);

            }

            //Copying permission values into a dedicated plain array.
            if (Array.isArray(sessionRow.permissions)) {
                for (const permissionData of sessionRow.permissions) {
                    permissions.push(String(permissionData));

                }

            }

            //Accepting only the known active value and failing closed otherwise.
            if (sessionRow.status === 'active') {
                sessionStatus = 'active';

            }

            return {
                id: sessionHash,
                userId: String(sessionRow.user_id),
                tenantId: tenantIdentifier,
                permissions,
                csrfTokenHash: String(sessionRow.csrf_hash),
                status: sessionStatus,
                expiresAt: new Date(/** @type {string | number | Date} */ (sessionRow.expires_at)).getTime()
            };

        },

        /** @param {string} sessionIdentifier */
        async revoke( sessionIdentifier ){
            const sessionHashData = sessionHashCreateData( sessionIdentifier );
            const cacheTagData = sessionCacheTagCreateData( sessionIdentifier );

            return transactionExecuteData(async function sessionRevokeTransaction( transactionData ){
                const revokeResultData = await transactionData.query({
                    text: `
                        UPDATE ${String( sessionsTableReferenceData )}
                        SET status = 'revoked', updated_at = now()
                        WHERE session_hash = $1 AND status = 'active'
                        RETURNING session_hash
                    `,
                    values: [sessionHashData]
                });

                if ( Number( revokeResultData.rowCount ?? 0 ) < Number( 1 ) ){
                    return false;

                }

                await transactionData.query({
                    text: cacheInvalidationInsertSqlCreate( invalidationsTableReferenceData ),
                    values: [
                        `session-revoked:${String( randomUUID() )}`,
                        JSON.stringify({
                            scope: 'global',
                            tenantId: null,
                            userId: null,
                            tags: [cacheTagData]
                        })
                    ]
                });

                return true;

            });

        },

        /** @param {string} sessionIdentifier */
        cacheTagCreate( sessionIdentifier ){
            return sessionCacheTagCreateData( sessionIdentifier );

        }
    });

}
