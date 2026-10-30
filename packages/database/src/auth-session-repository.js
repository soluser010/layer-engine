import {
    createHash,
    createHmac,
    randomBytes,
    randomUUID
} from 'node:crypto';
import {layerSystemTableReferenceCreate} from './system-schema.js';


/**
 * @param {unknown} timestampData
 * @param {string} fieldNameData
 */
//Function for checking a timestamp used by managed session expiry
const timestampCheck = function( timestampData, fieldNameData ){
    //Checking finite positive milliseconds before creating a PostgreSQL date
    if ( Number.isFinite( timestampData ) === false || Number( timestampData ) <= Number( 0 ) ){
        throw new TypeError( `${String( fieldNameData )} must contain a valid timestamp.` );

    }

};

/**
 * Creates managed opaque sessions for Layer Auth. Opaque session tokens are
 * returned only by `issue`; PostgreSQL/PGlite stores only HMAC/SHA-256 hashes.
 *
 * @param {{
 *     database: {
 *         systemSchema?: string,
 *         query: (queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, any>[], rowCount: number | null}>,
 *         transaction: <ResultData>(handlerData: (databaseData: any) => Promise<ResultData>) => Promise<ResultData>
 *     },
 *     sessionPepper: string,
 *     clock?: () => number,
 *     identifierCreate?: () => string,
 *     tokenCreate?: () => string
 * }} repositoryOptions
 */
export function layerAuthSessionRepositoryCreate( repositoryOptions ){
    //Checking the server-only persistence and secret contracts
    if (
        repositoryOptions === null ||
        typeof repositoryOptions !== String( 'object' ) ||
        typeof repositoryOptions.database?.query !== String( 'function' ) ||
        typeof repositoryOptions.database?.transaction !== String( 'function' ) ||
        typeof repositoryOptions.sessionPepper !== String( 'string' ) ||
        Number( repositoryOptions.sessionPepper.length ) < Number( 32 )
    ){
        throw new TypeError( 'Managed Auth sessions require a transactional database and a 32-character pepper.' );

    }

    const sessionsTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_sessions' );
    const clockData = repositoryOptions.clock ?? Date.now;
    const identifierCreateData = repositoryOptions.identifierCreate ?? randomUUID;
    const tokenCreateData = repositoryOptions.tokenCreate ?? function opaqueTokenCreate(){
        //Creating one high-entropy opaque token for browser session ownership
        return randomBytes( 32 ).toString( 'base64url' );

    };

    /**
     * @param {string} sessionTokenData
     */
    //Function for hashing an opaque session token with the server-only pepper
    const sessionHashCreateData = function( sessionTokenData ){
        //Creating the non-reversible lookup stored by the system schema
        return createHmac( 'sha256', repositoryOptions.sessionPepper )
            .update( sessionTokenData, 'utf8' )
            .digest( 'hex' );

    };

    return Object.freeze({
        /**
         * @param {{
         *     userId: string,
         *     tenantId?: string | null,
         *     permissions?: readonly string[],
         *     assurance?: readonly string[],
         *     idleExpiresAt: number,
         *     idleLifetimeMs?: number,
         *     absoluteExpiresAt: number
         * }} sessionIssueData
         */
        async issue( sessionIssueData ){
            //Checking identity and expiry before producing credentials
            if ( typeof sessionIssueData.userId !== String( 'string' ) || Number( sessionIssueData.userId.length ) < Number( 1 ) || Number( sessionIssueData.userId.length ) > Number( 128 ) ){
                throw new TypeError( 'Managed session user identifier is invalid.' );

            }

            timestampCheck( sessionIssueData.idleExpiresAt, 'idleExpiresAt' );
            timestampCheck( sessionIssueData.absoluteExpiresAt, 'absoluteExpiresAt' );

            if ( Number( sessionIssueData.absoluteExpiresAt ) < Number( sessionIssueData.idleExpiresAt ) ){
                throw new TypeError( 'Managed session absolute expiry cannot precede idle expiry.' );

            }

            const sessionIdentifierData = identifierCreateData();
            const sessionFamilyIdentifierData = identifierCreateData();
            const sessionTokenData = tokenCreateData();
            const csrfTokenData = tokenCreateData();
            const sessionHashData = sessionHashCreateData( sessionTokenData );
            const csrfHashData = createHash( 'sha256' ).update( csrfTokenData, 'utf8' ).digest( 'hex' );
            const issuedAtData = Number( clockData() );
            const idleLifetimeData = sessionIssueData.idleLifetimeMs ?? (Number( sessionIssueData.idleExpiresAt ) - issuedAtData);

            //Keeping the issued idle policy independent from later application configuration changes.
            if ( Number.isSafeInteger( idleLifetimeData ) === false || idleLifetimeData < 1 || idleLifetimeData > 31536000000 ){
                throw new TypeError( 'Managed session idle lifetime must contain 1 to 31536000000 milliseconds.' );

            }

            await repositoryOptions.database.query({
                text: `
                    INSERT INTO ${String( sessionsTableData )} (
                        session_hash,
                        session_id,
                        family_id,
                        user_id,
                        tenant_id,
                        permissions,
                        csrf_hash,
                        assurance,
                        managed,
                        status,
                        expires_at,
                        idle_expires_at,
                        absolute_expires_at,
                        last_seen_at,
                        idle_lifetime_ms
                    )
                    VALUES (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6::jsonb,
                        $7,
                        $8::jsonb,
                        true,
                        'active',
                        $9,
                        $9,
                        $10,
                        $11,
                        $12
                    )
                `,
                values: [
                    sessionHashData,
                    sessionIdentifierData,
                    sessionFamilyIdentifierData,
                    sessionIssueData.userId,
                    sessionIssueData.tenantId ?? null,
                    JSON.stringify( sessionIssueData.permissions ?? [] ),
                    csrfHashData,
                    JSON.stringify( sessionIssueData.assurance ?? [] ),
                    new Date( sessionIssueData.idleExpiresAt ),
                    new Date( sessionIssueData.absoluteExpiresAt ),
                    new Date( issuedAtData ),
                    idleLifetimeData
                ]
            });

            //Returning each opaque credential only to the issuing Auth flow
            return Object.freeze({
                sessionId: String( sessionIdentifierData ),
                sessionToken: String( sessionTokenData ),
                csrfToken: String( csrfTokenData ),
                idleExpiresAt: Number( sessionIssueData.idleExpiresAt ),
                absoluteExpiresAt: Number( sessionIssueData.absoluteExpiresAt )
            });

        },

        /**
         * @param {string} sessionTokenData
         */
        async resolve( sessionTokenData ){
            //Hashing the untrusted credential before the parameterized lookup
            const sessionHashData = sessionHashCreateData( sessionTokenData );
            const sessionLoadResult = await repositoryOptions.database.query({
                text: `
                    SELECT
                        session_id,
                        user_id,
                        tenant_id,
                        permissions,
                        csrf_hash,
                        assurance,
                        custom_data_revision,
                        idle_expires_at,
                        absolute_expires_at,
                        status
                    FROM ${String( sessionsTableData )}
                    WHERE session_hash = $1
                        AND managed = true
                        AND status = 'active'
                        AND idle_expires_at > now()
                        AND absolute_expires_at > now()
                    LIMIT 1
                `,
                values: [sessionHashData]
            });
            const sessionRowData = sessionLoadResult.rows[0];

            if ( sessionRowData === undefined ){
                return null;

            }

            let tenantIdentifierData = null;

            //Exposing the optional server-derived tenant without inventing a global value
            if ( sessionRowData.tenant_id !== null ){
                tenantIdentifierData = String( sessionRowData.tenant_id );

            }

            //CallBack THE OBJECT
            return Object.freeze({
                id: String( sessionRowData.session_id ),
                userId: String( sessionRowData.user_id ),
                tenantId: tenantIdentifierData,
                permissions: Object.freeze([...(sessionRowData.permissions ?? [])].map( String )),
                csrfTokenHash: String( sessionRowData.csrf_hash ),
                assurance: Object.freeze([...(sessionRowData.assurance ?? [])].map( String )),
                dataRevision: Number( sessionRowData.custom_data_revision ),
                idleExpiresAt: new Date( sessionRowData.idle_expires_at ).getTime(),
                absoluteExpiresAt: new Date( sessionRowData.absolute_expires_at ).getTime(),
                expiresAt: Math.min(
                    new Date( sessionRowData.idle_expires_at ).getTime(),
                    new Date( sessionRowData.absolute_expires_at ).getTime()
                ),
                status: /** @type {const} */ ('active')
            });

        },

        /**
         * Records verified API activity. Call only after Origin, CSRF and permission
         * checks. Returns false for expired/revoked sessions, including cached identities.
         * Writes are throttled by the interval, capped at half the issued idle lifetime.
         * The database clock and conditional UPDATE coordinate concurrent workers.
         *
         * @param {string} sessionTokenData Opaque server-side credential; never log it.
         * @param {number} [touchIntervalMsData] Minimum interval between activity writes.
         */
        async touch( sessionTokenData, touchIntervalMsData = 300000 ){
            //Rejecting invalid trusted options before sending a parameterized activity update.
            if (
                typeof sessionTokenData !== 'string' || sessionTokenData.length < 16 || sessionTokenData.length > 512 ||
                Number.isSafeInteger( touchIntervalMsData ) === false || touchIntervalMsData < 10000 || touchIntervalMsData > 3600000
            ){
                throw new TypeError( 'Managed session activity requires a valid token and a 10000 to 3600000 millisecond interval.' );

            }

            const sessionHashData = sessionHashCreateData( sessionTokenData );
            const activityResultData = await repositoryOptions.database.query({
                text: `
                    WITH active_session AS MATERIALIZED (
                        SELECT session_hash, idle_expires_at, absolute_expires_at FROM ${String( sessionsTableData )}
                        WHERE session_hash = $1
                            AND managed = true
                            AND status = 'active'
                            AND idle_expires_at > now()
                            AND absolute_expires_at > now()
                            AND idle_lifetime_ms IS NOT NULL
                        FOR UPDATE
                    ), touched_session AS (
                        UPDATE ${String( sessionsTableData )}
                        SET
                            idle_expires_at = LEAST(absolute_expires_at, GREATEST(idle_expires_at, statement_timestamp() + idle_lifetime_ms * INTERVAL '1 millisecond')),
                            expires_at = LEAST(absolute_expires_at, GREATEST(idle_expires_at, statement_timestamp() + idle_lifetime_ms * INTERVAL '1 millisecond')),
                            last_seen_at = GREATEST(last_seen_at, statement_timestamp()),
                            updated_at = statement_timestamp()
                        WHERE session_hash = $1
                            AND session_hash IN (SELECT session_hash FROM active_session)
                            AND managed = true
                            AND status = 'active'
                            AND idle_expires_at > clock_timestamp()
                            AND absolute_expires_at > clock_timestamp()
                            AND idle_lifetime_ms IS NOT NULL
                            AND last_seen_at <= statement_timestamp() - LEAST($2::bigint, idle_lifetime_ms / 2) * INTERVAL '1 millisecond'
                        RETURNING session_hash
                    )
                    SELECT EXISTS (
                        SELECT 1 FROM active_session
                        WHERE idle_expires_at > clock_timestamp()
                            AND absolute_expires_at > clock_timestamp()
                    ) AS active
                `,
                values: [sessionHashData, touchIntervalMsData]
            });

            //Returning only liveness; refreshed deadlines stay in the durable session record.
            return activityResultData.rows[0]?.active === true;

        },

        /**
         * @param {string} userIdentifierData
         */
        async list( userIdentifierData ){
            //Loading safe session metadata without hashes or custom data
            const sessionsLoadResult = await repositoryOptions.database.query({
                text: `
                    SELECT
                        session_id,
                        assurance,
                        last_seen_at,
                        idle_expires_at,
                        absolute_expires_at,
                        created_at
                    FROM ${String( sessionsTableData )}
                    WHERE user_id = $1
                        AND managed = true
                        AND status = 'active'
                        AND absolute_expires_at > now()
                    ORDER BY created_at DESC
                    LIMIT 100
                `,
                values: [userIdentifierData]
            });

            //CallBack THE OBJECT
            return Object.freeze(sessionsLoadResult.rows.map(function sessionRowMap( sessionRowData ){
                //Mapping public session metadata without token or CSRF hashes
                return Object.freeze({
                    sessionId: String( sessionRowData.session_id ),
                    assurance: Object.freeze([...(sessionRowData.assurance ?? [])].map( String )),
                    lastSeenAt: new Date( sessionRowData.last_seen_at ).getTime(),
                    idleExpiresAt: new Date( sessionRowData.idle_expires_at ).getTime(),
                    absoluteExpiresAt: new Date( sessionRowData.absolute_expires_at ).getTime(),
                    createdAt: new Date( sessionRowData.created_at ).getTime()
                });

            }));

        },

        /**
         * @param {string} sessionIdentifierData
         * @param {string} userIdentifierData
         * @param {string} [reasonData]
         */
        async revokeById( sessionIdentifierData, userIdentifierData, reasonData = 'user-request' ){
            //Revoking only a session owned by the verified user
            const revokeResultData = await repositoryOptions.database.query({
                text: `
                    UPDATE ${String( sessionsTableData )}
                    SET
                        status = 'revoked',
                        revoked_at = now(),
                        revoke_reason = $3,
                        updated_at = now()
                    WHERE session_id = $1
                        AND user_id = $2
                        AND managed = true
                        AND status = 'active'
                    RETURNING session_id
                `,
                values: [
                    sessionIdentifierData,
                    userIdentifierData,
                    String( reasonData ).slice( 0, 120 )
                ]
            });

            //CallBack THE BOOLEAN
            return Number( revokeResultData.rowCount ?? 0 ) === Number( 1 );

        },

        /**
         * @param {string} userIdentifierData
         * @param {string} [reasonData]
         * @param {{query: Function}} [databaseData]
         */
        async revokeAllByUser( userIdentifierData, reasonData = 'authorization-invalidated', databaseData = repositoryOptions.database ){
            //Revoking every active managed session after an authorization change
            const revokeResultData = await databaseData.query({
                text: `
                    UPDATE ${String( sessionsTableData )}
                    SET
                        status = 'revoked',
                        revoked_at = now(),
                        revoke_reason = $2,
                        updated_at = now()
                    WHERE user_id = $1
                        AND managed = true
                        AND status = 'active'
                `,
                values: [
                    userIdentifierData,
                    String( reasonData ).slice( 0, 120 )
                ]
            });

            //CallBack THE NUMBER
            return Number( revokeResultData.rowCount ?? 0 );

        },

        /**
         * @param {string} sessionIdentifierData
         * @param {string} userIdentifierData
         */
        async dataGetById( sessionIdentifierData, userIdentifierData ){
            //Loading developer data only from the server-derived session owner
            const dataLoadResult = await repositoryOptions.database.query({
                text: `
                    SELECT custom_data, custom_data_revision
                    FROM ${String( sessionsTableData )}
                    WHERE session_id = $1
                        AND user_id = $2
                        AND managed = true
                        AND status = 'active'
                        AND absolute_expires_at > now()
                    LIMIT 1
                `,
                values: [
                    sessionIdentifierData,
                    userIdentifierData
                ]
            });
            const dataRowData = dataLoadResult.rows[0];

            if ( dataRowData === undefined ){
                return null;

            }

            //CallBack THE OBJECT
            return Object.freeze({
                value: structuredClone( dataRowData.custom_data ?? {} ),
                revision: Number( dataRowData.custom_data_revision )
            });

        },

        /**
         * @param {string} sessionIdentifierData
         * @param {string} userIdentifierData
         * @param {number} expectedRevisionData
         * @param {Readonly<Record<string, unknown>>} customDataValue
         */
        async dataReplaceById( sessionIdentifierData, userIdentifierData, expectedRevisionData, customDataValue ){
            //Applying compare-and-swap to the current server-derived session only
            const dataUpdateResult = await repositoryOptions.database.query({
                text: `
                    UPDATE ${String( sessionsTableData )}
                    SET
                        custom_data = $4::jsonb,
                        custom_data_revision = custom_data_revision + 1,
                        updated_at = now()
                    WHERE session_id = $1
                        AND user_id = $2
                        AND custom_data_revision = $3
                        AND managed = true
                        AND status = 'active'
                        AND absolute_expires_at > now()
                    RETURNING custom_data_revision
                `,
                values: [
                    sessionIdentifierData,
                    userIdentifierData,
                    expectedRevisionData,
                    JSON.stringify( customDataValue )
                ]
            });
            const revisionRowData = dataUpdateResult.rows[0];

            if ( revisionRowData === undefined ){
                return null;

            }

            //CallBack THE NUMBER
            return Number( revisionRowData.custom_data_revision );

        },

        /**
         * @param {string} sessionTokenData
         */
        async dataGet( sessionTokenData ){
            //Loading custom data only for the current active managed session
            const dataLoadResult = await repositoryOptions.database.query({
                text: `
                    SELECT custom_data, custom_data_revision
                    FROM ${String( sessionsTableData )}
                    WHERE session_hash = $1
                        AND managed = true
                        AND status = 'active'
                        AND absolute_expires_at > now()
                    LIMIT 1
                `,
                values: [sessionHashCreateData( sessionTokenData )]
            });
            const dataRowData = dataLoadResult.rows[0];

            if ( dataRowData === undefined ){
                return null;

            }

            //CallBack THE OBJECT
            return Object.freeze({
                value: structuredClone( dataRowData.custom_data ?? {} ),
                revision: Number( dataRowData.custom_data_revision )
            });

        },

        /**
         * @param {string} sessionTokenData
         * @param {number} expectedRevisionData
         * @param {Readonly<Record<string, unknown>>} customDataValue
         */
        async dataReplace( sessionTokenData, expectedRevisionData, customDataValue ){
            //Applying compare-and-swap without exposing a lost update
            const dataUpdateResult = await repositoryOptions.database.query({
                text: `
                    UPDATE ${String( sessionsTableData )}
                    SET
                        custom_data = $3::jsonb,
                        custom_data_revision = custom_data_revision + 1,
                        updated_at = now()
                    WHERE session_hash = $1
                        AND custom_data_revision = $2
                        AND managed = true
                        AND status = 'active'
                        AND absolute_expires_at > now()
                    RETURNING custom_data_revision
                `,
                values: [
                    sessionHashCreateData( sessionTokenData ),
                    expectedRevisionData,
                    JSON.stringify( customDataValue )
                ]
            });
            const dataRevisionRowData = dataUpdateResult.rows[0];

            if ( dataRevisionRowData === undefined ){
                return null;

            }

            //CallBack THE NUMBER
            return Number( dataRevisionRowData.custom_data_revision );

        }
    });

}
