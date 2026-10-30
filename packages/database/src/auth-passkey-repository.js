import {layerSystemTableReferenceCreate} from './system-schema.js';


const transportNamesData = Object.freeze([
    'ble',
    'hybrid',
    'internal',
    'nfc',
    'smart-card',
    'usb'
]);


/** @param {unknown} transportsInputData */
//Function for checking authenticator transport metadata
const transportsCreate = function( transportsInputData ){
    if ( Array.isArray( transportsInputData ) === false || Number( transportsInputData.length ) > Number( 8 ) ){
        throw new TypeError( 'Auth passkey transports are invalid.' );

    }

    const transportsData = /** @type {string[]} */ ([]);

    for ( const transportData of transportsInputData ){
        if ( typeof transportData !== 'string' || transportNamesData.includes( transportData ) === false || transportsData.includes( transportData ) === true ){
            throw new TypeError( 'Auth passkey transports contain an invalid value.' );

        }

        transportsData.push( transportData );

    }

    //CallBack THE OBJECT
    return Object.freeze( transportsData.sort() );

};

/**
 * Creates the SQL-first Passkey repository used by SimpleWebAuthn adapters.
 *
 * @param {{database: {systemSchema?: string, query: Function, transaction: Function}}} repositoryOptions
 */
export function layerAuthPasskeyRepositoryCreate( repositoryOptions ){
    //Checking durable storage before accepting public-key credentials
    if (
        repositoryOptions === null ||
        typeof repositoryOptions !== String( 'object' ) ||
        typeof repositoryOptions.database?.query !== String( 'function' ) ||
        typeof repositoryOptions.database?.transaction !== String( 'function' )
    ){
        throw new TypeError( 'Auth passkeys require a transactional database.' );

    }

    const passkeysTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_passkeys' );
    const usersTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_users' );

    return Object.freeze({
        /**
         * @param {{
         *     credentialId: string,
         *     userId: string,
         *     publicKey: Uint8Array,
         *     counter: number,
         *     transports: readonly string[],
         *     backupEligible: boolean,
         *     backupState: boolean,
         *     displayName: string
         * }} passkeyData
         * @param {{query: Function}} [databaseData]
         */
        async create( passkeyData, databaseData = repositoryOptions.database ){
            //Checking credential bounds before inserting binary key material
            if ( typeof passkeyData?.credentialId !== 'string' || /^[A-Za-z0-9_-]{8,1024}$/u.test( passkeyData.credentialId ) === false ){
                throw new TypeError( 'Auth passkey credential identifier is invalid.' );

            }

            if ( typeof passkeyData.userId !== 'string' || Number( passkeyData.userId.length ) < Number( 1 ) || Number( passkeyData.userId.length ) > Number( 128 ) ){
                throw new TypeError( 'Auth passkey user identifier is invalid.' );

            }

            if ( ArrayBuffer.isView( passkeyData.publicKey ) === false || Number( passkeyData.publicKey.byteLength ) < Number( 16 ) || Number( passkeyData.publicKey.byteLength ) > Number( 16384 ) ){
                throw new TypeError( 'Auth passkey public key is invalid.' );

            }

            if ( Number.isSafeInteger( passkeyData.counter ) === false || Number( passkeyData.counter ) < Number( 0 ) ){
                throw new TypeError( 'Auth passkey counter is invalid.' );

            }

            if ( typeof passkeyData.displayName !== 'string' || Number( passkeyData.displayName.length ) < Number( 1 ) || Number( passkeyData.displayName.length ) > Number( 120 ) ){
                throw new TypeError( 'Auth passkey display name is invalid.' );

            }

            const transportsData = transportsCreate( passkeyData.transports );
            const passkeyCreateResultData = await databaseData.query({
                text: `
                    INSERT INTO ${String( passkeysTableData )} (
                        credential_id,
                        user_id,
                        public_key,
                        counter,
                        transports,
                        backup_eligible,
                        backup_state,
                        display_name
                    )
                    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
                    RETURNING credential_id
                `,
                values: [
                    passkeyData.credentialId,
                    passkeyData.userId,
                    Buffer.from( passkeyData.publicKey ),
                    passkeyData.counter,
                    JSON.stringify( transportsData ),
                    passkeyData.backupEligible === true,
                    passkeyData.backupState === true,
                    passkeyData.displayName
                ]
            });

            //CallBack THE BOOLEAN
            return Number( passkeyCreateResultData.rowCount ?? 0 ) === Number( 1 );

        },

        /** @param {string} credentialIdentifierData */
        async findByCredentialId( credentialIdentifierData ){
            const passkeyLoadResultData = await repositoryOptions.database.query({
                text: `
                    SELECT
                        passkeys.credential_id,
                        passkeys.user_id,
                        passkeys.public_key,
                        passkeys.counter,
                        passkeys.transports,
                        passkeys.backup_eligible,
                        passkeys.backup_state,
                        passkeys.display_name,
                        users.status AS user_status
                    FROM ${String( passkeysTableData )} AS passkeys
                    INNER JOIN ${String( usersTableData )} AS users
                        ON users.user_id = passkeys.user_id
                    WHERE passkeys.credential_id = $1
                    LIMIT 1
                `,
                values: [credentialIdentifierData]
            });
            const passkeyRowData = passkeyLoadResultData.rows[0];

            if ( passkeyRowData === undefined ){
                return null;

            }

            //CallBack THE OBJECT
            return Object.freeze({
                credentialId: String( passkeyRowData.credential_id ),
                userId: String( passkeyRowData.user_id ),
                publicKey: Buffer.from( passkeyRowData.public_key ),
                counter: Number( passkeyRowData.counter ),
                transports: Object.freeze([...(passkeyRowData.transports ?? [])].map( String )),
                backupEligible: passkeyRowData.backup_eligible === true,
                backupState: passkeyRowData.backup_state === true,
                displayName: String( passkeyRowData.display_name ),
                userStatus: String( passkeyRowData.user_status )
            });

        },

        /** @param {string} userIdentifierData */
        async listForUser( userIdentifierData ){
            const passkeysLoadResultData = await repositoryOptions.database.query({
                text: `
                    SELECT credential_id, transports, display_name, created_at, last_used_at
                    FROM ${String( passkeysTableData )}
                    WHERE user_id = $1
                    ORDER BY created_at DESC
                    LIMIT 100
                `,
                values: [userIdentifierData]
            });

            //CallBack THE OBJECT
            return Object.freeze(passkeysLoadResultData.rows.map(function passkeyRowMap( /** @type {Record<string, any>} */ passkeyRowData ){
                //Mapping persisted credential metadata without exposing the public key bytes
                let lastUsedAtData = null;

                if ( passkeyRowData.last_used_at !== null ){
                    lastUsedAtData = new Date( passkeyRowData.last_used_at ).getTime();

                }

                return Object.freeze({
                    credentialId: String( passkeyRowData.credential_id ),
                    transports: Object.freeze([...(passkeyRowData.transports ?? [])].map( String )),
                    displayName: String( passkeyRowData.display_name ),
                    createdAt: new Date( passkeyRowData.created_at ).getTime(),
                    lastUsedAt: lastUsedAtData
                });

            }));

        },

        /**
         * @param {{credentialId: string, userId: string, expectedCounter: number, newCounter: number, backupState: boolean}} counterData
         * @param {{query: Function}} [databaseData]
         */
        async counterAdvance( counterData, databaseData = repositoryOptions.database ){
            //Applying compare-and-swap while allowing authenticators with a stable zero counter
            const counterUpdateResultData = await databaseData.query({
                text: `
                    UPDATE ${String( passkeysTableData )}
                    SET
                        counter = $4,
                        backup_state = $5,
                        last_used_at = now()
                    WHERE credential_id = $1
                        AND user_id = $2
                        AND counter = $3
                        AND ($4 > $3 OR ($4 = 0 AND $3 = 0))
                    RETURNING credential_id
                `,
                values: [
                    counterData.credentialId,
                    counterData.userId,
                    counterData.expectedCounter,
                    counterData.newCounter,
                    counterData.backupState === true
                ]
            });

            //CallBack THE BOOLEAN
            return Number( counterUpdateResultData.rowCount ?? 0 ) === Number( 1 );

        },

        /** @param {string} credentialIdentifierData @param {string} userIdentifierData */
        async remove( credentialIdentifierData, userIdentifierData ){
            const passkeyRemoveResultData = await repositoryOptions.database.query({
                text: `
                    DELETE FROM ${String( passkeysTableData )}
                    WHERE credential_id = $1
                        AND user_id = $2
                    RETURNING credential_id
                `,
                values: [credentialIdentifierData, userIdentifierData]
            });

            //CallBack THE BOOLEAN
            return Number( passkeyRemoveResultData.rowCount ?? 0 ) === Number( 1 );

        }
    });

}
