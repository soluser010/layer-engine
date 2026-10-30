import {createHmac} from 'node:crypto';
import {LayerAuthError} from './auth-error.js';


const modelNamePatternData = /^[A-Za-z][A-Za-z0-9]{0,79}$/u;
const oidcEnvelopePurposeData = String( 'oidc-record' );


/**
 * Creates the durable oidc-provider adapter factory. Every provider identifier
 * is HMAC indexed and every payload is encrypted before PostgreSQL or PGlite.
 *
 * @param {{
 *     database: {query: Function, systemSchema: string},
 *     envelope: {seal: Function, open: Function},
 *     pepper: string,
 *     clock?: () => number
 * }} adapterOptions
 */
export function layerAuthOidcAdapterFactoryCreate( adapterOptions ){
    //Checking durable encrypted storage before accepting OAuth artifacts
    if (
        adapterOptions === null ||
        typeof adapterOptions !== String( 'object' ) ||
        typeof adapterOptions.database?.query !== String( 'function' ) ||
        typeof adapterOptions.database?.systemSchema !== String( 'string' ) ||
        typeof adapterOptions.envelope?.seal !== String( 'function' ) ||
        typeof adapterOptions.envelope?.open !== String( 'function' ) ||
        typeof adapterOptions.pepper !== String( 'string' ) ||
        Number( adapterOptions.pepper.length ) < Number( 32 )
    ){
        throw new TypeError( 'Layer Auth OIDC adapter requires encrypted system storage and a 32-character pepper.' );

    }

    const schemaNameData = adapterOptions.database.systemSchema;

    if ( /^layer_[a-z][a-z0-9_]{0,62}$/u.test( schemaNameData ) === false && schemaNameData !== String( 'layer_engine' ) ){
        throw new TypeError( 'Layer Auth OIDC system schema is invalid.' );

    }

    const recordsTableData = `"${String( schemaNameData )}"."sys_auth_oidc_records"`;
    const clockData = adapterOptions.clock ?? Date.now;

    /** @param {string} modelNameData @param {string} valueData */
    //Function for deriving a model-bound non-reversible lookup value
    const recordHashCreateData = function( modelNameData, valueData ){
        //Binding the lookup hash to its OIDC model to prevent cross-model correlation
        return createHmac( 'sha256', adapterOptions.pepper )
            .update( `${String( modelNameData )}\u0000${String( valueData )}`, 'utf8' )
            .digest( 'hex' );

    };

    //Class for implementing the exact oidc-provider adapter lifecycle
    return class LayerAuthOidcAdapter {
        /** @param {string} modelNameData */
        constructor( modelNameData ){
            //Validating the provider-controlled model name before it reaches an SQL identifier context
            if ( typeof modelNameData !== String( 'string' ) || modelNamePatternData.test( modelNameData ) === false ){
                throw new TypeError( 'Layer Auth OIDC model name is invalid.' );

            }

            this.modelName = String( modelNameData );

        }

        /** @param {string} identifierData */
        reference( identifierData ){
            //Returning an opaque durable lookup for revocation-sensitive server integrations
            return recordHashCreateData( this.modelName, identifierData );

        }

        /** @param {string} identifierData */
        async destroy( identifierData ){
            //Deleting only the record bound to this adapter model and opaque identifier
            await adapterOptions.database.query({
                text: `
                    DELETE FROM ${String( recordsTableData )}
                    WHERE model_name = $1
                        AND record_id_hash = $2
                `,
                values: [
                    this.modelName,
                    recordHashCreateData( this.modelName, identifierData )
                ]
            });

        }

        /** @param {string} identifierData */
        async consume( identifierData ){
            //Marking the selected one-time artifact as consumed without exposing its payload
            await adapterOptions.database.query({
                text: `
                    UPDATE ${String( recordsTableData )}
                    SET consumed_at = now(), updated_at = now()
                    WHERE model_name = $1
                        AND record_id_hash = $2
                        AND consumed_at IS NULL
                `,
                values: [
                    this.modelName,
                    recordHashCreateData( this.modelName, identifierData )
                ]
            });

        }

        /** @param {Record<string, any> | undefined} recordRowData */
        //Function for opening one unexpired provider record
        recordOpen( recordRowData ){
            if ( recordRowData === undefined ){
                return undefined;

            }

            if (
                recordRowData.expires_at !== null &&
                new Date( recordRowData.expires_at ).getTime() <= Number( clockData() )
            ){
                return undefined;

            }

            const payloadData = adapterOptions.envelope.open(
                Buffer.from( recordRowData.payload_encrypted ),
                oidcEnvelopePurposeData
            );

            if ( payloadData === null || typeof payloadData !== String( 'object' ) || Array.isArray( payloadData ) === true ){
                throw new LayerAuthError( 'AUTH_OAUTH_STORAGE_INVALID', 'OAuth state could not be loaded.' );

            }

            if ( recordRowData.consumed_at !== null ){
                payloadData.consumed = Math.floor(new Date( recordRowData.consumed_at ).getTime() / Number( 1000 ));

            }

            //CallBack THE OBJECT
            return payloadData;

        }

        /** @param {string} identifierData */
        async find( identifierData ){
            const recordLoadResultData = await adapterOptions.database.query({
                text: `
                    SELECT payload_encrypted, expires_at, consumed_at
                    FROM ${String( recordsTableData )}
                    WHERE model_name = $1
                        AND record_id_hash = $2
                    LIMIT 1
                `,
                values: [
                    this.modelName,
                    recordHashCreateData( this.modelName, identifierData )
                ]
            });

            //CallBack THE OBJECT
            return this.recordOpen( recordLoadResultData.rows[0] );

        }

        /** @param {string} uidData */
        async findByUid( uidData ){
            const recordLoadResultData = await adapterOptions.database.query({
                text: `
                    SELECT payload_encrypted, expires_at, consumed_at
                    FROM ${String( recordsTableData )}
                    WHERE model_name = $1
                        AND uid_hash = $2
                    LIMIT 1
                `,
                values: [
                    this.modelName,
                    recordHashCreateData( 'uid', uidData )
                ]
            });

            //CallBack THE OBJECT
            return this.recordOpen( recordLoadResultData.rows[0] );

        }

        /** @param {string} userCodeData */
        async findByUserCode( userCodeData ){
            const recordLoadResultData = await adapterOptions.database.query({
                text: `
                    SELECT payload_encrypted, expires_at, consumed_at
                    FROM ${String( recordsTableData )}
                    WHERE model_name = $1
                        AND user_code_hash = $2
                    LIMIT 1
                `,
                values: [
                    this.modelName,
                    recordHashCreateData( 'user-code', userCodeData )
                ]
            });

            //CallBack THE OBJECT
            return this.recordOpen( recordLoadResultData.rows[0] );

        }

        /** @param {string} identifierData @param {Record<string, any>} payloadData @param {number} [expiresInData] */
        async upsert( identifierData, payloadData, expiresInData = undefined ){
            //Rejecting non-record payloads before encryption and persistence
            if ( payloadData === null || typeof payloadData !== String( 'object' ) || Array.isArray( payloadData ) === true ){
                throw new TypeError( 'Layer Auth OIDC payload is invalid.' );

            }

            let expiresAtData = null;

            if ( expiresInData !== undefined ){
                if ( Number.isFinite( expiresInData ) === false || Number( expiresInData ) <= Number( 0 ) ){
                    throw new TypeError( 'Layer Auth OIDC record lifetime is invalid.' );

                }

                expiresAtData = new Date(Number( clockData() ) + Number( expiresInData ) * Number( 1000 ));

            }

            const encryptedPayloadData = adapterOptions.envelope.seal(
                payloadData,
                oidcEnvelopePurposeData
            );
            let grantIdentifierHashData = null;
            let accountIdentifierHashData = null;
            let uidHashData = null;
            let userCodeHashData = null;

            if ( typeof payloadData.grantId === String( 'string' ) ){
                grantIdentifierHashData = recordHashCreateData( 'grant', payloadData.grantId );

            }

            if ( typeof payloadData.accountId === String( 'string' ) ){
                accountIdentifierHashData = recordHashCreateData( 'account', payloadData.accountId );

            }

            if ( typeof payloadData.uid === String( 'string' ) ){
                uidHashData = recordHashCreateData( 'uid', payloadData.uid );

            }

            if ( typeof payloadData.userCode === String( 'string' ) ){
                userCodeHashData = recordHashCreateData( 'user-code', payloadData.userCode );

            }

            await adapterOptions.database.query({
                text: `
                    INSERT INTO ${String( recordsTableData )} (
                        model_name,
                        record_id_hash,
                        payload_encrypted,
                        grant_id_hash,
                        account_id_hash,
                        uid_hash,
                        user_code_hash,
                        expires_at,
                        consumed_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
                    ON CONFLICT (model_name, record_id_hash)
                    DO UPDATE SET
                        payload_encrypted = EXCLUDED.payload_encrypted,
                        grant_id_hash = EXCLUDED.grant_id_hash,
                        account_id_hash = EXCLUDED.account_id_hash,
                        uid_hash = EXCLUDED.uid_hash,
                        user_code_hash = EXCLUDED.user_code_hash,
                        expires_at = EXCLUDED.expires_at,
                        consumed_at = NULL,
                        updated_at = now()
                `,
                values: [
                    this.modelName,
                    recordHashCreateData( this.modelName, identifierData ),
                    encryptedPayloadData,
                    grantIdentifierHashData,
                    accountIdentifierHashData,
                    uidHashData,
                    userCodeHashData,
                    expiresAtData
                ]
            });

        }

        /**
         * Atomically claims a provider identifier once. This is used for
         * short-lived replay records such as DPoP proof identifiers.
         *
         * @param {string} identifierData
         * @param {Record<string, any>} payloadData
         * @param {number} expiresInData
         */
        async claim( identifierData, payloadData, expiresInData ){
            //Validating the bounded authorization artifact before atomically claiming it
            if (
                typeof identifierData !== String( 'string' ) ||
                Number( identifierData.length ) < Number( 1 ) ||
                Number( identifierData.length ) > Number( 512 ) ||
                payloadData === null ||
                typeof payloadData !== String( 'object' ) ||
                Array.isArray( payloadData ) === true ||
                Number.isFinite( expiresInData ) === false ||
                Number( expiresInData ) <= Number( 0 )
            ){
                throw new TypeError( 'Layer Auth OIDC replay claim is invalid.' );

            }

            const encryptedPayloadData = adapterOptions.envelope.seal(
                payloadData,
                oidcEnvelopePurposeData
            );
            const expiresAtData = new Date(
                Number( clockData() ) + Number( expiresInData ) * Number( 1000 )
            );
            const claimResultData = await adapterOptions.database.query({
                text: `
                    INSERT INTO ${String( recordsTableData )} (
                        model_name,
                        record_id_hash,
                        payload_encrypted,
                        grant_id_hash,
                        account_id_hash,
                        uid_hash,
                        user_code_hash,
                        expires_at,
                        consumed_at
                    )
                    VALUES ($1, $2, $3, NULL, NULL, NULL, NULL, $4, NULL)
                    ON CONFLICT (model_name, record_id_hash)
                    DO NOTHING
                    RETURNING record_id_hash
                `,
                values: [
                    this.modelName,
                    recordHashCreateData( this.modelName, identifierData ),
                    encryptedPayloadData,
                    expiresAtData
                ]
            });

            return Number( claimResultData.rowCount ?? claimResultData.rows.length ) === Number( 1 );

        }

        /** @param {string} grantIdentifierData */
        async revokeByGrantId( grantIdentifierData ){
            //Deleting every provider artifact derived from the revoked grant
            await adapterOptions.database.query({
                text: `
                    DELETE FROM ${String( recordsTableData )}
                    WHERE grant_id_hash = $1
                `,
                values: [recordHashCreateData( 'grant', grantIdentifierData )]
            });

        }

        /** @param {string} accountIdentifierData */
        async revokeByAccountId( accountIdentifierData ){
            //Deleting every provider artifact derived from the revoked account
            await adapterOptions.database.query({
                text: `
                    DELETE FROM ${String( recordsTableData )}
                    WHERE account_id_hash = $1
                `,
                values: [recordHashCreateData( 'account', accountIdentifierData )]
            });

        }
    };

}
