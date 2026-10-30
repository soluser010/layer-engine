import {
    createHmac,
    randomUUID
} from 'node:crypto';
import {layerSystemTableReferenceCreate} from './system-schema.js';


const providerIdentifierPatternData = /^[a-z][a-z0-9-]{1,63}$/u;
const externalClaimsMaximumBytesData = Number( 16384 );
const externalClaimsEnvelopePurposeData = String( 'external-identity-claims' );


/**
 * Creates the repository for identities verified by an external OpenID
 * Connect provider. Upstream subjects are HMAC indexed and bounded claims are
 * encrypted before persistence.
 *
 * @param {{
 *     database: {
 *         systemSchema?: string,
 *         query: (queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, any>[], rowCount: number | null}>,
 *         transaction: <ResultData>(handlerData: (databaseData: any) => Promise<ResultData>) => Promise<ResultData>
 *     },
 *     envelope: {seal: Function, open: Function},
 *     subjectPepper: string,
 *     identifierCreate?: () => string
 * }} repositoryOptions
 */
export function layerAuthExternalIdentityRepositoryCreate( repositoryOptions ){
    //Checking storage and cryptographic boundaries before accepting upstream identities
    if (
        repositoryOptions === null ||
        typeof repositoryOptions !== String( 'object' ) ||
        typeof repositoryOptions.database?.query !== String( 'function' ) ||
        typeof repositoryOptions.database?.transaction !== String( 'function' ) ||
        typeof repositoryOptions.envelope?.seal !== String( 'function' ) ||
        typeof repositoryOptions.envelope?.open !== String( 'function' ) ||
        typeof repositoryOptions.subjectPepper !== String( 'string' ) ||
        Number( repositoryOptions.subjectPepper.length ) < Number( 32 )
    ){
        throw new TypeError( 'External Auth identities require encrypted storage and a 32-character pepper.' );

    }

    const externalIdentitiesTableData = layerSystemTableReferenceCreate(
        repositoryOptions.database,
        'sys_auth_external_identities'
    );
    const usersTableData = layerSystemTableReferenceCreate(
        repositoryOptions.database,
        'sys_auth_users'
    );
    const identifierCreateData = repositoryOptions.identifierCreate ?? randomUUID;

    /** @param {unknown} providerIdentifierData @param {unknown} subjectData */
    //Function for checking one provider-bound external subject
    const externalIdentityCheckData = function( providerIdentifierData, subjectData ){
        //Rejecting invalid provider identifiers before deriving a subject lookup hash
        if (
            typeof providerIdentifierData !== 'string' ||
            providerIdentifierPatternData.test( providerIdentifierData ) === false
        ){
            throw new TypeError( 'External Auth provider identifier is invalid.' );

        }

        if (
            typeof subjectData !== 'string' ||
            Number( subjectData.length ) < Number( 1 ) ||
            Number( subjectData.length ) > Number( 512 )
        ){
            throw new TypeError( 'External Auth subject is invalid.' );

        }

    };

    /** @param {string} providerIdentifierData @param {string} subjectData */
    //Function for deriving a non-reversible provider-scoped subject index
    const subjectHashCreateData = function( providerIdentifierData, subjectData ){
        //Binding the subject hash to the provider namespace
        return createHmac( 'sha256', repositoryOptions.subjectPepper )
            .update( `${String( providerIdentifierData )}\u0000${String( subjectData )}`, 'utf8' )
            .digest( 'hex' );

    };

    /** @param {unknown} claimsData */
    //Function for checking bounded claims before authenticated encryption
    const claimsCheckData = function( claimsData ){
        //Rejecting non-record claims before serialization and encryption
        if ( claimsData === null || typeof claimsData !== String( 'object' ) || Array.isArray( claimsData ) === true ){
            throw new TypeError( 'External Auth claims must be an object.' );

        }

        const claimsSourceData = JSON.stringify( claimsData );

        if ( Number( Buffer.byteLength( claimsSourceData, 'utf8' ) ) > Number( externalClaimsMaximumBytesData ) ){
            throw new TypeError( 'External Auth claims are too large.' );

        }

    };

    return Object.freeze({
        /**
         * @param {string} providerIdentifierData
         * @param {string} subjectData
         */
        async find( providerIdentifierData, subjectData ){
            externalIdentityCheckData( providerIdentifierData, subjectData );
            const subjectHashData = subjectHashCreateData( providerIdentifierData, subjectData );
            const identityLoadResultData = await repositoryOptions.database.query({
                text: `
                    SELECT
                        external_identities.external_identity_id,
                        external_identities.user_id,
                        external_identities.claims,
                        users.status
                    FROM ${String( externalIdentitiesTableData )} AS external_identities
                    INNER JOIN ${String( usersTableData )} AS users
                        ON users.user_id = external_identities.user_id
                    WHERE external_identities.provider_id = $1
                        AND external_identities.subject = $2
                    LIMIT 1
                `,
                values: [
                    providerIdentifierData,
                    subjectHashData
                ]
            });
            const identityRowData = identityLoadResultData.rows[0];

            if ( identityRowData === undefined ){
                return null;

            }

            const envelopeBase64Data = identityRowData.claims?.envelope;

            if ( typeof envelopeBase64Data !== String( 'string' ) || Number( envelopeBase64Data.length ) < Number( 1 ) ){
                throw new TypeError( 'External Auth identity claims are invalid.' );

            }

            const claimsData = repositoryOptions.envelope.open(
                Buffer.from( envelopeBase64Data, 'base64url' ),
                externalClaimsEnvelopePurposeData
            );
            claimsCheckData( claimsData );

            //CallBack THE OBJECT
            return Object.freeze({
                externalIdentityId: String( identityRowData.external_identity_id ),
                userId: String( identityRowData.user_id ),
                status: String( identityRowData.status ),
                claims: Object.freeze( claimsData )
            });

        },

        /**
         * @param {{
         *     providerId: string,
         *     subject: string,
         *     userId: string,
         *     claims: Readonly<Record<string, unknown>>,
         *     database?: {query: Function}
         * }} identityData
         */
        async create( identityData ){
            externalIdentityCheckData( identityData?.providerId, identityData?.subject );
            claimsCheckData( identityData?.claims );

            if (
                typeof identityData.userId !== String( 'string' ) ||
                Number( identityData.userId.length ) < Number( 8 ) ||
                Number( identityData.userId.length ) > Number( 128 )
            ){
                throw new TypeError( 'External Auth user identifier is invalid.' );

            }

            const externalIdentityIdentifierData = identifierCreateData();
            const subjectHashData = subjectHashCreateData( identityData.providerId, identityData.subject );
            const encryptedClaimsData = repositoryOptions.envelope.seal(
                identityData.claims,
                externalClaimsEnvelopePurposeData
            );
            const queryDatabaseData = identityData.database ?? repositoryOptions.database;

            await queryDatabaseData.query({
                text: `
                    INSERT INTO ${String( externalIdentitiesTableData )} (
                        external_identity_id,
                        user_id,
                        provider_id,
                        subject,
                        claims
                    )
                    VALUES ($1, $2, $3, $4, $5::jsonb)
                `,
                values: [
                    externalIdentityIdentifierData,
                    identityData.userId,
                    identityData.providerId,
                    subjectHashData,
                    JSON.stringify({envelope: encryptedClaimsData.toString( 'base64url' )})
                ]
            });

            //CallBack THE OBJECT
            return Object.freeze({
                externalIdentityId: String( externalIdentityIdentifierData ),
                userId: String( identityData.userId )
            });

        }
    });

}
