import {
    createHmac,
    randomBytes,
    randomUUID
} from 'node:crypto';
import {layerSystemTableReferenceCreate} from './system-schema.js';


const challengeTypePatternData = /^[a-z][a-z0-9-]{1,79}$/u;


/**
 * Creates one-time Auth challenges. Only HMAC values are persisted; the raw
 * token is returned once to the trusted Auth service.
 *
 * @param {{
     *     database: {
 *         systemSchema?: string,
 *         query: (queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, any>[], rowCount: number | null}>,
 *         transaction: <ResultData>(handlerData: (databaseData: any) => Promise<ResultData>) => Promise<ResultData>
 *     },
 *     challengePepper: string,
 *     clock?: () => number,
 *     identifierCreate?: () => string,
 *     tokenCreate?: () => string
 * }} repositoryOptions
 */
export function layerAuthChallengeRepositoryCreate( repositoryOptions ){
    //Checking the server-only persistence and secret contracts
    if (
        repositoryOptions === null ||
        typeof repositoryOptions !== String( 'object' ) ||
        typeof repositoryOptions.database?.query !== String( 'function' ) ||
        typeof repositoryOptions.database?.transaction !== String( 'function' ) ||
        typeof repositoryOptions.challengePepper !== String( 'string' ) ||
        Number( repositoryOptions.challengePepper.length ) < Number( 32 )
    ){
        throw new TypeError( 'Auth challenges require a transactional database and a 32-character pepper.' );

    }

    const challengesTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_challenges' );
    const clockData = repositoryOptions.clock ?? Date.now;
    const identifierCreateData = repositoryOptions.identifierCreate ?? randomUUID;
    const tokenCreateData = repositoryOptions.tokenCreate ?? function challengeTokenCreate(){
        //Creating 256 bits of entropy for a single-use public credential
        return randomBytes( 32 ).toString( 'base64url' );

    };

    /** @param {string} valueData */
    //Function for creating a purpose-bound HMAC value
    const valueHashCreateData = function( valueData ){
        //Binding the opaque value to the server-only challenge pepper
        return createHmac( 'sha256', repositoryOptions.challengePepper )
            .update( valueData, 'utf8' )
            .digest( 'hex' );

    };

    return Object.freeze({
        /**
         * @param {{
         *     type: string,
         *     subject: string,
         *     userId?: string | null,
         *     payload?: Readonly<Record<string, unknown>>,
         *     attempts?: number,
         *     token?: string,
         *     expiresAt: number,
         *     database?: {query: Function}
         * }} challengeData
         */
        async create( challengeData ){
            //Checking bounded challenge metadata before creating a secret
            if ( typeof challengeData?.type !== 'string' || challengeTypePatternData.test( challengeData.type ) === false ){
                throw new TypeError( 'Auth challenge type is invalid.' );

            }

            if ( typeof challengeData.subject !== 'string' || Number( challengeData.subject.length ) < Number( 1 ) || Number( challengeData.subject.length ) > Number( 512 ) ){
                throw new TypeError( 'Auth challenge subject is invalid.' );

            }

            if ( Number.isInteger( challengeData.attempts ?? Number( 5 ) ) === false || Number( challengeData.attempts ?? Number( 5 ) ) < Number( 1 ) || Number( challengeData.attempts ?? Number( 5 ) ) > Number( 20 ) ){
                throw new TypeError( 'Auth challenge attempt limit is invalid.' );

            }

            if ( Number.isFinite( challengeData.expiresAt ) === false || Number( challengeData.expiresAt ) <= Number( clockData() ) ){
                throw new TypeError( 'Auth challenge expiry is invalid.' );

            }

            const payloadData = challengeData.payload ?? {};
            const payloadSourceData = JSON.stringify( payloadData );

            if ( Number( Buffer.byteLength( payloadSourceData, 'utf8' ) ) > Number( 16384 ) ){
                throw new TypeError( 'Auth challenge payload is too large.' );

            }

            const challengeIdentifierData = identifierCreateData();
            const challengeTokenData = challengeData.token ?? tokenCreateData();

            if ( typeof challengeTokenData !== 'string' || Number( challengeTokenData.length ) < Number( 20 ) || Number( challengeTokenData.length ) > Number( 512 ) ){
                throw new TypeError( 'Auth challenge token is invalid.' );

            }
            const challengeSubjectHashData = valueHashCreateData( `subject:${String( challengeData.type )}:${String( challengeData.subject )}` );
            const challengeSecretHashData = valueHashCreateData( `token:${String( challengeData.type )}:${String( challengeTokenData )}` );
            const queryDatabaseData = challengeData.database ?? repositoryOptions.database;

            //Invalidating earlier challenges for the same purpose and subject
            await queryDatabaseData.query({
                text: `
                    UPDATE ${String( challengesTableData )}
                    SET consumed_at = now()
                    WHERE challenge_type = $1
                        AND subject_hash = $2
                        AND consumed_at IS NULL
                `,
                values: [
                    challengeData.type,
                    challengeSubjectHashData
                ]
            });

            await queryDatabaseData.query({
                text: `
                    INSERT INTO ${String( challengesTableData )} (
                        challenge_id,
                        challenge_type,
                        subject_hash,
                        user_id,
                        secret_hash,
                        payload,
                        attempts_remaining,
                        expires_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
                `,
                values: [
                    challengeIdentifierData,
                    challengeData.type,
                    challengeSubjectHashData,
                    challengeData.userId ?? null,
                    challengeSecretHashData,
                    payloadSourceData,
                    challengeData.attempts ?? Number( 5 ),
                    new Date( challengeData.expiresAt )
                ]
            });

            //CallBack THE OBJECT
            return Object.freeze({
                challengeId: String( challengeIdentifierData ),
                token: String( challengeTokenData ),
                expiresAt: Number( challengeData.expiresAt )
            });

        },

        /**
         * @param {{
         *     type: string,
         *     token: string,
         *     effect?: (challengeData: Readonly<{challengeId: string, userId: string | null, payload: Readonly<Record<string, unknown>>}>, databaseData: any) => Promise<void>
         * }} challengeConsumeData
         */
        async consume( challengeConsumeData ){
            //Checking the public token shape before opening a transaction
            if (
                typeof challengeConsumeData?.type !== 'string' ||
                challengeTypePatternData.test( challengeConsumeData.type ) === false ||
                typeof challengeConsumeData.token !== 'string' ||
                Number( challengeConsumeData.token.length ) < Number( 20 ) ||
                Number( challengeConsumeData.token.length ) > Number( 512 )
            ){
                return null;

            }

            const challengeSecretHashData = valueHashCreateData( `token:${String( challengeConsumeData.type )}:${String( challengeConsumeData.token )}` );

            //Locking and consuming the challenge with its domain mutation
            return repositoryOptions.database.transaction(async function challengeConsumeTransaction( transactionData ){
                const challengeLoadResultData = await transactionData.query({
                    text: `
                        SELECT challenge_id, user_id, payload
                        FROM ${String( challengesTableData )}
                        WHERE challenge_type = $1
                            AND secret_hash = $2
                            AND consumed_at IS NULL
                            AND expires_at > now()
                            AND attempts_remaining > 0
                        FOR UPDATE
                        LIMIT 1
                    `,
                    values: [
                        challengeConsumeData.type,
                        challengeSecretHashData
                    ]
                });
                const challengeRowData = challengeLoadResultData.rows[0];

                //Returning one neutral miss for invalid, expired, or consumed tokens
                if ( challengeRowData === undefined ){
                    return null;

                }

                let challengeUserIdentifierData = null;

                //Exposing the optional owner only when the challenge is identity-bound
                if ( challengeRowData.user_id !== null ){
                    challengeUserIdentifierData = String( challengeRowData.user_id );

                }

                const challengeResultData = Object.freeze({
                    challengeId: String( challengeRowData.challenge_id ),
                    userId: challengeUserIdentifierData,
                    payload: Object.freeze( challengeRowData.payload ?? {} )
                });
                const challengeEffectData = challengeConsumeData.effect;

                //Applying the trusted identity mutation before consuming the token
                if ( typeof challengeEffectData === 'function' ){
                    await challengeEffectData( challengeResultData, transactionData );

                }

                await transactionData.query({
                    text: `
                        UPDATE ${String( challengesTableData )}
                        SET consumed_at = now()
                        WHERE challenge_id = $1
                    `,
                    values: [challengeResultData.challengeId]
                });

                //CallBack THE OBJECT
                return challengeResultData;

            });

        }
    });

}
