import {
    createHmac,
    randomUUID
} from 'node:crypto';
import {layerSystemTableReferenceCreate} from './system-schema.js';


const recoveryCodePatternData = /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$/u;


/**
 * Creates encrypted TOTP credential and one-time recovery-code persistence.
 * Raw TOTP secrets and recovery codes never enter SQL values.
 *
 * @param {{
 *     database: {systemSchema?: string, query: Function, transaction: Function},
 *     recoveryPepper: string,
 *     identifierCreate?: () => string
 * }} repositoryOptions
 */
export function layerAuthTotpRepositoryCreate( repositoryOptions ){
    //Checking transactional persistence and the recovery-code HMAC secret
    if (
        repositoryOptions === null ||
        typeof repositoryOptions !== String( 'object' ) ||
        typeof repositoryOptions.database?.query !== String( 'function' ) ||
        typeof repositoryOptions.database?.transaction !== String( 'function' ) ||
        typeof repositoryOptions.recoveryPepper !== String( 'string' ) ||
        Number( repositoryOptions.recoveryPepper.length ) < Number( 32 )
    ){
        throw new TypeError( 'Auth TOTP requires a transactional database and a 32-character recovery pepper.' );

    }

    const totpTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_totp_credentials' );
    const recoveryCodesTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_recovery_codes' );
    const identifierCreateData = repositoryOptions.identifierCreate ?? randomUUID;

    /** @param {string} recoveryCodeData */
    //Function for normalizing a human-entered recovery code
    const recoveryCodeNormalizeData = function( recoveryCodeData ){
        const recoveryCodeNormalizedData = String( recoveryCodeData ).trim().toUpperCase();

        if ( recoveryCodePatternData.test( recoveryCodeNormalizedData ) === false ){
            throw new TypeError( 'Auth recovery code is invalid.' );

        }

        //CallBack THE STRING
        return recoveryCodeNormalizedData;

    };

    /** @param {string} recoveryCodeData */
    //Function for deriving a non-reversible recovery-code lookup value
    const recoveryCodeHashCreateData = function( recoveryCodeData ){
        //Hashing the normalized one-time code with the server-only recovery pepper
        return createHmac( 'sha256', repositoryOptions.recoveryPepper )
            .update( recoveryCodeNormalizeData( recoveryCodeData ), 'utf8' )
            .digest( 'hex' );

    };

    return Object.freeze({
        /**
         * @param {{userId: string, encryptedSecret: Uint8Array, keyId: string, algorithm: string, digits: number, period: number}} credentialData
         */
        async pendingSave( credentialData ){
            //Replacing an unfinished enrollment without exposing the seed
            const credentialSaveResultData = await repositoryOptions.database.query({
                text: `
                    INSERT INTO ${String( totpTableData )} (
                        user_id,
                        encrypted_secret,
                        key_id,
                        algorithm,
                        digits,
                        period,
                        last_counter,
                        confirmed_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL)
                    ON CONFLICT (user_id)
                    DO UPDATE SET
                        encrypted_secret = EXCLUDED.encrypted_secret,
                        key_id = EXCLUDED.key_id,
                        algorithm = EXCLUDED.algorithm,
                        digits = EXCLUDED.digits,
                        period = EXCLUDED.period,
                        last_counter = NULL,
                        confirmed_at = NULL,
                        updated_at = now()
                    RETURNING user_id
                `,
                values: [
                    credentialData.userId,
                    Buffer.from( credentialData.encryptedSecret ),
                    credentialData.keyId,
                    credentialData.algorithm,
                    credentialData.digits,
                    credentialData.period
                ]
            });

            //CallBack THE BOOLEAN
            return Number( credentialSaveResultData.rowCount ?? 0 ) === Number( 1 );

        },

        /** @param {string} userIdentifierData @param {{query: Function}} [databaseData] */
        async get( userIdentifierData, databaseData = repositoryOptions.database ){
            const credentialLoadResultData = await databaseData.query({
                text: `
                    SELECT
                        user_id,
                        encrypted_secret,
                        key_id,
                        algorithm,
                        digits,
                        period,
                        last_counter,
                        confirmed_at
                    FROM ${String( totpTableData )}
                    WHERE user_id = $1
                    LIMIT 1
                `,
                values: [userIdentifierData]
            });
            const credentialRowData = credentialLoadResultData.rows[0];

            if ( credentialRowData === undefined ){
                return null;

            }

            let confirmedAtData = null;

            if ( credentialRowData.confirmed_at !== null ){
                confirmedAtData = new Date( credentialRowData.confirmed_at ).getTime();

            }

            let lastCounterData = null;

            //Keeping a never-used credential distinct from the first accepted counter
            if ( credentialRowData.last_counter !== null ){
                lastCounterData = Number( credentialRowData.last_counter );

            }

            //CallBack THE OBJECT
            return Object.freeze({
                userId: String( credentialRowData.user_id ),
                encryptedSecret: Buffer.from( credentialRowData.encrypted_secret ),
                keyId: String( credentialRowData.key_id ),
                algorithm: String( credentialRowData.algorithm ),
                digits: Number( credentialRowData.digits ),
                period: Number( credentialRowData.period ),
                lastCounter: lastCounterData,
                confirmedAt: confirmedAtData
            });

        },

        /**
         * @param {{userId: string, counter: number, recoveryCodes: readonly string[]}}
         */
        async confirm( confirmationData ){
            //Confirming the seed and replacing every previous recovery code atomically
            return repositoryOptions.database.transaction(async function totpConfirmTransaction( /** @type {any} */ databaseData ){
                const credentialConfirmResultData = await databaseData.query({
                    text: `
                        UPDATE ${String( totpTableData )}
                        SET
                            last_counter = $2,
                            confirmed_at = now(),
                            updated_at = now()
                        WHERE user_id = $1
                            AND confirmed_at IS NULL
                            AND (last_counter IS NULL OR last_counter < $2)
                        RETURNING user_id
                    `,
                    values: [confirmationData.userId, confirmationData.counter]
                });

                if ( Number( credentialConfirmResultData.rowCount ?? 0 ) !== Number( 1 ) ){
                    return false;

                }

                await databaseData.query({
                    text: `DELETE FROM ${String( recoveryCodesTableData )} WHERE user_id = $1`,
                    values: [confirmationData.userId]
                });

                for ( const recoveryCodeData of confirmationData.recoveryCodes ){
                    await databaseData.query({
                        text: `
                            INSERT INTO ${String( recoveryCodesTableData )} (
                                code_id,
                                user_id,
                                code_hash
                            )
                            VALUES ($1, $2, $3)
                        `,
                        values: [
                            String( identifierCreateData() ),
                            confirmationData.userId,
                            recoveryCodeHashCreateData( recoveryCodeData )
                        ]
                    });

                }

                //CallBack THE BOOLEAN
                return true;

            });

        },

        /**
         * @param {{userId: string, expectedCounter: number | null, counter: number}}
         * @param {{query: Function}} [databaseData]
         */
        async counterAdvance( counterData, databaseData = repositoryOptions.database ){
            //Applying one compare-and-swap update to reject a replayed time step
            const counterAdvanceResultData = await databaseData.query({
                text: `
                    UPDATE ${String( totpTableData )}
                    SET
                        last_counter = $3,
                        updated_at = now()
                    WHERE user_id = $1
                        AND confirmed_at IS NOT NULL
                        AND last_counter IS NOT DISTINCT FROM $2
                        AND ($2 IS NULL OR $3 > $2)
                    RETURNING user_id
                `,
                values: [counterData.userId, counterData.expectedCounter, counterData.counter]
            });

            //CallBack THE BOOLEAN
            return Number( counterAdvanceResultData.rowCount ?? 0 ) === Number( 1 );

        },

        /** @param {string} userIdentifierData @param {string} recoveryCodeData @param {{query: Function}} [databaseData] */
        async recoveryCodeConsume( userIdentifierData, recoveryCodeData, databaseData = repositoryOptions.database ){
            const recoveryCodeHashData = recoveryCodeHashCreateData( recoveryCodeData );
            const recoveryConsumeResultData = await databaseData.query({
                text: `
                    UPDATE ${String( recoveryCodesTableData )}
                    SET consumed_at = now()
                    WHERE user_id = $1
                        AND code_hash = $2
                        AND consumed_at IS NULL
                    RETURNING code_id
                `,
                values: [userIdentifierData, recoveryCodeHashData]
            });

            //CallBack THE BOOLEAN
            return Number( recoveryConsumeResultData.rowCount ?? 0 ) === Number( 1 );

        },

        /** @param {string} userIdentifierData @param {readonly string[]} recoveryCodesData */
        async recoveryCodesReplace( userIdentifierData, recoveryCodesData ){
            //Rotating every recovery code in one transaction after strong verification
            return repositoryOptions.database.transaction(async function recoveryCodesReplaceTransaction( /** @type {any} */ databaseData ){
                await databaseData.query({
                    text: `DELETE FROM ${String( recoveryCodesTableData )} WHERE user_id = $1`,
                    values: [userIdentifierData]
                });

                for ( const recoveryCodeData of recoveryCodesData ){
                    await databaseData.query({
                        text: `
                            INSERT INTO ${String( recoveryCodesTableData )} (
                                code_id,
                                user_id,
                                code_hash
                            )
                            VALUES ($1, $2, $3)
                        `,
                        values: [
                            String( identifierCreateData() ),
                            userIdentifierData,
                            recoveryCodeHashCreateData( recoveryCodeData )
                        ]
                    });

                }

                //CallBack THE BOOLEAN
                return true;

            });

        },

        /** @param {string} userIdentifierData */
        async remove( userIdentifierData ){
            //Deleting the seed cascades account-owned recovery material explicitly
            return repositoryOptions.database.transaction(async function totpRemoveTransaction( /** @type {any} */ databaseData ){
                await databaseData.query({
                    text: `DELETE FROM ${String( recoveryCodesTableData )} WHERE user_id = $1`,
                    values: [userIdentifierData]
                });
                const credentialRemoveResultData = await databaseData.query({
                    text: `DELETE FROM ${String( totpTableData )} WHERE user_id = $1 RETURNING user_id`,
                    values: [userIdentifierData]
                });

                //CallBack THE BOOLEAN
                return Number( credentialRemoveResultData.rowCount ?? 0 ) === Number( 1 );

            });

        }
    });

}
