import {
    createHmac,
    randomBytes,
    randomUUID
} from 'node:crypto';
import {layerSystemTableReferenceCreate} from './system-schema.js';


const roleNamePatternData = /^[a-z][a-z0-9-]{1,79}$/u;


/**
 * @param {unknown} rolesInputData
 */
//Function for checking invitation roles before persistence
const invitationRolesCreate = function( rolesInputData ){
    if ( Array.isArray( rolesInputData ) === false || Number( rolesInputData.length ) > Number( 50 ) ){
        throw new TypeError( 'Auth invitation roles must be an array with at most 50 items.' );

    }

    const rolesData = /** @type {string[]} */ ([]);
    const roleNamesData = new Set();

    for ( const roleInputData of rolesInputData ){
        //Checking each stable role name without accepting duplicates
        if (
            typeof roleInputData !== String( 'string' ) ||
            roleNamePatternData.test( roleInputData ) === false ||
            roleNamesData.has( roleInputData ) === true
        ){
            throw new TypeError( 'Auth invitation roles contain an invalid or duplicate value.' );

        }

        roleNamesData.add( roleInputData );
        rolesData.push( roleInputData );

    }

    rolesData.sort();

    //CallBack THE OBJECT
    return Object.freeze( rolesData );

};

/**
 * @param {unknown} emailInputData
 */
//Function for checking an optional normalized invitation email
const invitationEmailCreate = function( emailInputData ){
    if ( emailInputData === null || emailInputData === undefined ){
        return null;

    }

    if ( typeof emailInputData !== String( 'string' ) ){
        throw new TypeError( 'Auth invitation email must already be normalized.' );

    }

    const invitationEmailData = /** @type {string} */ (emailInputData);

    if (
        Number( invitationEmailData.length ) < Number( 3 ) ||
        Number( invitationEmailData.length ) > Number( 320 ) ||
        invitationEmailData !== invitationEmailData.trim().toLowerCase()
    ){
        throw new TypeError( 'Auth invitation email must already be normalized.' );

    }

    //CallBack THE STRING
    return String( invitationEmailData );

};

/**
 * Creates one-time invitation credentials. Tokens are returned only at
 * issuance; PostgreSQL receives an HMAC index instead of the credential.
 *
 * @param {{
 *     database: {
 *         systemSchema?: string,
 *         query: Function,
 *         transaction: <ResultData>(handlerData: (databaseData: any) => Promise<ResultData>) => Promise<ResultData>
 *     },
 *     invitationPepper: string,
 *     tokenCreate?: () => string,
 *     identifierCreate?: () => string,
 *     clock?: () => number
 * }} repositoryOptions
 */
export function layerAuthInvitationRepositoryCreate( repositoryOptions ){
    //Checking the durable and cryptographic boundaries before issuing credentials
    if (
        repositoryOptions === null ||
        typeof repositoryOptions !== String( 'object' ) ||
        typeof repositoryOptions.database?.query !== String( 'function' ) ||
        typeof repositoryOptions.database?.transaction !== String( 'function' ) ||
        typeof repositoryOptions.invitationPepper !== String( 'string' ) ||
        Number( repositoryOptions.invitationPepper.length ) < Number( 32 ) ||
        Number( repositoryOptions.invitationPepper.length ) > Number( 512 )
    ){
        throw new TypeError( 'Auth invitation repository options are invalid.' );

    }

    const invitationsTableData = layerSystemTableReferenceCreate(
        repositoryOptions.database,
        'sys_auth_invitations'
    );
    const identifierCreateData = repositoryOptions.identifierCreate ?? randomUUID;
    const tokenCreateData = repositoryOptions.tokenCreate ?? function invitationTokenCreate(){
        //Creating 256 bits of entropy for the one-time invitation credential
        return randomBytes( 32 ).toString( 'base64url' );

    };
    const clockData = repositoryOptions.clock ?? Date.now;

    //Function for indexing a credential without storing its reusable value
    const invitationTokenHashCreate = function( /** @type {string} */ invitationTokenData ){
        //Creating a purpose-bound HMAC for database lookup
        return createHmac( 'sha256', repositoryOptions.invitationPepper )
            .update( 'layer-auth-invitation\u0000', 'utf8' )
            .update( invitationTokenData, 'utf8' )
            .digest( 'hex' );

    };

    return Object.freeze({
        /**
         * @param {{
         *     email?: string | null,
         *     roles?: readonly string[],
         *     expiresAt: string | number | Date,
         *     createdBy?: string | null
         * }} invitationData
         */
        async issue( invitationData ){
            const invitationEmailData = invitationEmailCreate( invitationData?.email );
            const invitationRolesData = invitationRolesCreate( invitationData?.roles ?? [] );
            const expirationData = new Date( invitationData?.expiresAt );
            const currentTimeData = Number( clockData() );
            let createdByData = null;

            //Checking a future bounded expiration before creating a token
            if (
                Number.isFinite( expirationData.getTime() ) === false ||
                Number( expirationData.getTime() ) <= Number( currentTimeData ) ||
                Number( expirationData.getTime() ) > Number( currentTimeData ) + Number( 90 * 24 * 60 * 60 * 1000 )
            ){
                throw new TypeError( 'Auth invitation expiration must be within the next 90 days.' );

            }

            if ( invitationData?.createdBy !== null && invitationData?.createdBy !== undefined ){
                if (
                    typeof invitationData.createdBy !== String( 'string' ) ||
                    Number( invitationData.createdBy.length ) < Number( 8 ) ||
                    Number( invitationData.createdBy.length ) > Number( 128 )
                ){
                    throw new TypeError( 'Auth invitation creator is invalid.' );

                }

                createdByData = String( invitationData.createdBy );

            }

            const invitationIdentifierData = String( identifierCreateData() );
            const invitationTokenData = String( tokenCreateData() );

            if (
                Number( invitationIdentifierData.length ) < Number( 8 ) ||
                Number( invitationIdentifierData.length ) > Number( 128 ) ||
                Number( invitationTokenData.length ) < Number( 32 ) ||
                Number( invitationTokenData.length ) > Number( 512 ) ||
                /\s/u.test( invitationTokenData ) === true
            ){
                throw new TypeError( 'Generated Auth invitation credential is invalid.' );

            }

            const invitationTokenHashData = invitationTokenHashCreate( invitationTokenData );

            //Recording only the invitation index and bounded authorization metadata
            await repositoryOptions.database.query({
                text: `
                    INSERT INTO ${String( invitationsTableData )} (
                        invitation_id,
                        token_hash,
                        email_normalized,
                        roles,
                        expires_at,
                        created_by
                    )
                    VALUES ($1, $2, $3, $4::jsonb, $5, $6)
                `,
                values: [
                    invitationIdentifierData,
                    invitationTokenHashData,
                    invitationEmailData,
                    JSON.stringify( invitationRolesData ),
                    expirationData.toISOString(),
                    createdByData
                ]
            });

            //CallBack THE OBJECT
            return Object.freeze({
                id: invitationIdentifierData,
                token: invitationTokenData,
                expiresAt: Number( expirationData.getTime() )
            });

        },

        /**
         * @template ResultData
         * @param {{
         *     token: string,
         *     email?: string | null,
         *     effect: (invitationData: Readonly<{id: string, roles: readonly string[]}>, databaseData: any) => Promise<ResultData>
         * }} consumptionData
         * @returns {Promise<ResultData | null>}
         */
        async consume( consumptionData ){
            if (
                typeof consumptionData?.token !== String( 'string' ) ||
                Number( consumptionData.token.length ) < Number( 32 ) ||
                Number( consumptionData.token.length ) > Number( 512 ) ||
                /\s/u.test( consumptionData.token ) === true ||
                typeof consumptionData.effect !== String( 'function' )
            ){
                return null;

            }

            const invitationEmailData = invitationEmailCreate( consumptionData.email );
            const invitationTokenHashData = invitationTokenHashCreate( consumptionData.token );

            return repositoryOptions.database.transaction(async function invitationConsumeTransaction( transactionData ){
                //Locking one invitation so concurrent registrations cannot reuse it
                const invitationLoadResultData = await transactionData.query({
                    text: `
                        SELECT invitation_id, email_normalized, roles, expires_at, consumed_at
                        FROM ${String( invitationsTableData )}
                        WHERE token_hash = $1
                        LIMIT 1
                        FOR UPDATE
                    `,
                    values: [invitationTokenHashData]
                });
                const invitationRowData = invitationLoadResultData.rows[0];

                if (
                    invitationRowData === undefined ||
                    invitationRowData.consumed_at !== null ||
                    Number( new Date( invitationRowData.expires_at ).getTime() ) <= Number( clockData() )
                ){
                    return null;

                }

                let invitationStoredEmailData = null;

                if ( invitationRowData.email_normalized !== null ){
                    invitationStoredEmailData = String( invitationRowData.email_normalized );

                }

                //Enforcing an email-bound invitation without revealing the expected address
                if (
                    invitationStoredEmailData !== null &&
                    invitationStoredEmailData !== invitationEmailData
                ){
                    return null;

                }

                const invitationRolesData = invitationRolesCreate( invitationRowData.roles );

                //Applying identity creation and role assignment before consuming the token
                const invitationEffectResultData = await consumptionData.effect(Object.freeze({
                    id: String( invitationRowData.invitation_id ),
                    roles: invitationRolesData
                }), transactionData );
                const invitationConsumeResultData = await transactionData.query({
                    text: `
                        UPDATE ${String( invitationsTableData )}
                        SET consumed_at = now()
                        WHERE invitation_id = $1 AND consumed_at IS NULL
                        RETURNING invitation_id
                    `,
                    values: [invitationRowData.invitation_id]
                });

                if ( Number( invitationConsumeResultData.rowCount ?? Number( 0 ) ) !== Number( 1 ) ){
                    throw new Error( 'Auth invitation could not be consumed atomically.' );

                }

                //CallBack THE OBJECT
                return invitationEffectResultData;

            });

        }
    });

}
