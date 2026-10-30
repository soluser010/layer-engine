import {randomUUID} from 'node:crypto';
import {layerSystemTableReferenceCreate} from './system-schema.js';


const identifierTypesData = Object.freeze([
    'email',
    'username',
    'phone'
]);
const userStatusesData = Object.freeze([
    'active',
    'anonymization-pending',
    'anonymized',
    'disabled',
    'pending'
]);


/**
 * @param {unknown} identifierTypeData
 * @param {unknown} identifierValueData
 */
//Function for checking a bounded Auth identifier
const identifierDataCheck = function( identifierTypeData, identifierValueData ){
    //Checking the identifier type before selecting a persisted identity
    if ( typeof identifierTypeData !== 'string' || identifierTypesData.includes( identifierTypeData ) === false ){
        throw new TypeError( 'Auth identifier type is invalid.' );

    }

    //Checking the normalized identifier without changing application policy
    if (
        typeof identifierValueData !== 'string' ||
        Number( identifierValueData.length ) < Number( 1 ) ||
        Number( identifierValueData.length ) > Number( 320 ) ||
        identifierValueData !== identifierValueData.trim()
    ){
        throw new TypeError( 'Auth identifier value is invalid.' );

    }

};

/**
 * Creates the SQL-first repository for Layer-owned identities and global roles.
 * Identifier normalization and password hashing are performed by Layer Auth
 * before this persistence boundary.
 *
 * @param {{
 *     database: {
 *         systemSchema?: string,
 *         query: (queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, any>[], rowCount: number | null}>,
 *         transaction: <ResultData>(handlerData: (databaseData: any) => Promise<ResultData>) => Promise<ResultData>
 *     },
 *     identifierCreate?: () => string
 * }} repositoryOptions
 */
export function layerAuthUserRepositoryCreate( repositoryOptions ){
    //Checking the transactional database contract before exposing identity writes
    if (
        repositoryOptions === null ||
        typeof repositoryOptions !== String( 'object' ) ||
        typeof repositoryOptions.database?.query !== String( 'function' ) ||
        typeof repositoryOptions.database?.transaction !== String( 'function' )
    ){
        throw new TypeError( 'Auth user repository requires a transactional database.' );

    }

    const usersTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_users' );
    const identifiersTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_identifiers' );
    const passwordCredentialsTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_password_credentials' );
    const passkeysTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_passkeys' );
    const totpCredentialsTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_totp_credentials' );
    const recoveryCodesTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_recovery_codes' );
    const challengesTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_challenges' );
    const externalIdentitiesTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_external_identities' );
    const rolesTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_roles' );
    const rolePermissionsTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_role_permissions' );
    const userRolesTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_user_roles' );
    const identifierCreateData = repositoryOptions.identifierCreate ?? randomUUID;

    return Object.freeze({
        /**
         * Creates one identity, its first identifier, and optional password in
         * one transaction. The password must already be an Argon2id hash.
         *
         * @param {{
         *     userId?: string,
         *     status?: 'pending' | 'active',
         *     identifier: {type: 'email' | 'username', normalized: string, display: string, verified?: boolean},
         *     password?: {hash: string, parameters: Readonly<Record<string, unknown>>} | null,
         *     afterCreate?: (createdData: Readonly<{userId: string, identifierId: string}>, databaseData: any) => Promise<void>
         * }} userCreateData
         * @param {{query: Function, transaction?: Function}} [databaseData]
         */
        async create( userCreateData, databaseData = repositoryOptions.database ){
            //Checking the identifier before opening the identity transaction
            identifierDataCheck( userCreateData.identifier?.type, userCreateData.identifier?.normalized );

            const userIdentifierData = userCreateData.userId ?? identifierCreateData();
            const identityIdentifierData = identifierCreateData();
            const identityStatusData = userCreateData.status ?? 'pending';
            const identifierDisplayData = userCreateData.identifier.display;

            if ( typeof userIdentifierData !== String( 'string' ) || Number( userIdentifierData.length ) < Number( 8 ) || Number( userIdentifierData.length ) > Number( 128 ) ){
                throw new TypeError( 'Auth user identifier is invalid.' );

            }

            if ( ['pending', 'active'].includes( identityStatusData ) === false ){
                throw new TypeError( 'New Auth user status is invalid.' );

            }

            if ( typeof identifierDisplayData !== String( 'string' ) || Number( identifierDisplayData.length ) < Number( 1 ) || Number( identifierDisplayData.length ) > Number( 320 ) ){
                throw new TypeError( 'Auth identifier display value is invalid.' );

            }

            //Checking the optional password hash without accepting plaintext
            if (
                userCreateData.password !== null &&
                userCreateData.password !== undefined &&
                (
                    typeof userCreateData.password.hash !== String( 'string' ) ||
                    userCreateData.password.hash.startsWith( String( '$argon2id$' ) ) === false ||
                    typeof userCreateData.password.parameters !== String( 'object' ) ||
                    userCreateData.password.parameters === null
                )
            ){
                throw new TypeError( 'Auth password credential must contain an Argon2id hash.' );

            }

            if ( typeof databaseData?.query !== String( 'function' ) ){
                throw new TypeError( 'Auth user creation database is invalid.' );

            }

            //Function for recording identity and credentials in the selected transaction
            const authUserCreateExecuteData = async function( /** @type {any} */ transactionData ){
                await transactionData.query({
                    text: `
                        INSERT INTO ${String( usersTableData )} (user_id, status)
                        VALUES ($1, $2)
                    `,
                    values: [
                        userIdentifierData,
                        identityStatusData
                    ]
                });

                await transactionData.query({
                    text: `
                        INSERT INTO ${String( identifiersTableData )} (
                            identifier_id,
                            user_id,
                            identifier_type,
                            value_normalized,
                            value_display,
                            verified_at
                        )
                        VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() ELSE NULL END)
                    `,
                    values: [
                        identityIdentifierData,
                        userIdentifierData,
                        userCreateData.identifier.type,
                        userCreateData.identifier.normalized,
                        identifierDisplayData,
                        userCreateData.identifier.verified === true
                    ]
                });

                if ( userCreateData.password !== null && userCreateData.password !== undefined ){
                    await transactionData.query({
                        text: `
                            INSERT INTO ${String( passwordCredentialsTableData )} (
                                user_id,
                                password_hash,
                                algorithm,
                                parameters
                            )
                            VALUES ($1, $2, 'argon2id', $3::jsonb)
                        `,
                        values: [
                            userIdentifierData,
                            userCreateData.password.hash,
                            JSON.stringify( userCreateData.password.parameters )
                        ]
                    });

                }

                //Applying trusted lifecycle effects inside the identity transaction
                if ( typeof userCreateData.afterCreate === 'function' ){
                    await userCreateData.afterCreate(Object.freeze({
                        userId: String( userIdentifierData ),
                        identifierId: String( identityIdentifierData )
                    }), transactionData );

                }

                //CallBack THE OBJECT
                return Object.freeze({
                    userId: String( userIdentifierData ),
                    status: String( identityStatusData )
                });

            };

            //Reusing a caller-owned transaction for invitation consumption
            if ( databaseData !== repositoryOptions.database ){
                return authUserCreateExecuteData( databaseData );

            }

            //Recording an ordinary identity through the repository transaction
            return repositoryOptions.database.transaction( authUserCreateExecuteData );

        },

        /**
         * @param {'email' | 'username'} identifierTypeData
         * @param {string} identifierValueData
         */
        async findByIdentifier( identifierTypeData, identifierValueData ){
            //Checking the normalized lookup before using it as a bound parameter
            identifierDataCheck( identifierTypeData, identifierValueData );

            const identityLoadResult = await repositoryOptions.database.query({
                text: `
                    SELECT
                        users.user_id,
                        users.status,
                        identifiers.identifier_id,
                        identifiers.verified_at,
                        credentials.password_hash,
                        credentials.parameters
                    FROM ${String( identifiersTableData )} AS identifiers
                    INNER JOIN ${String( usersTableData )} AS users
                        ON users.user_id = identifiers.user_id
                    LEFT JOIN ${String( passwordCredentialsTableData )} AS credentials
                        ON credentials.user_id = users.user_id
                    WHERE identifiers.identifier_type = $1
                        AND identifiers.value_normalized = $2
                    LIMIT 1
                `,
                values: [
                    identifierTypeData,
                    identifierValueData
                ]
            });
            const identityRowData = identityLoadResult.rows[0];

            //Returning an explicit miss without revealing identifier internals
            if ( identityRowData === undefined ){
                return null;

            }

            let passwordHashData = null;

            //Exposing a credential hash only when password authentication is configured
            if ( identityRowData.password_hash !== null ){
                passwordHashData = String( identityRowData.password_hash );

            }

            //CallBack THE OBJECT
            return Object.freeze({
                userId: String( identityRowData.user_id ),
                status: String( identityRowData.status ),
                identifierId: String( identityRowData.identifier_id ),
                verified: identityRowData.verified_at !== null,
                passwordHash: passwordHashData,
                passwordParameters: identityRowData.parameters ?? null
            });

        },

        /** @param {string} userIdentifierData */
        async findById( userIdentifierData ){
            if ( typeof userIdentifierData !== String( 'string' ) || Number( userIdentifierData.length ) < Number( 8 ) || Number( userIdentifierData.length ) > Number( 128 ) ){
                throw new TypeError( 'Auth user identifier is invalid.' );

            }

            const userLoadResultData = await repositoryOptions.database.query({
                text: `
                    SELECT user_id, status, disabled_reason, anonymized_at
                    FROM ${String( usersTableData )}
                    WHERE user_id = $1
                    LIMIT 1
                `,
                values: [userIdentifierData]
            });
            const userRowData = userLoadResultData.rows[0];

            if ( userRowData === undefined ){
                return null;

            }

            let disabledReasonData = null;
            let anonymizedAtData = null;

            //Mapping optional lifecycle metadata without coercing absent values
            if ( userRowData.disabled_reason !== null ){
                disabledReasonData = String( userRowData.disabled_reason );

            }

            if ( userRowData.anonymized_at !== null ){
                anonymizedAtData = new Date( userRowData.anonymized_at ).getTime();

            }

            //CallBack THE OBJECT
            return Object.freeze({
                userId: String( userRowData.user_id ),
                status: String( userRowData.status ),
                disabledReason: disabledReasonData,
                anonymizedAt: anonymizedAtData
            });

        },

        /** @param {string} userIdentifierData */
        async identifiersList( userIdentifierData ){
            //Loading safe identifier labels for authenticated credential setup
            const identifiersLoadResultData = await repositoryOptions.database.query({
                text: `
                    SELECT identifier_id, identifier_type, value_display, verified_at
                    FROM ${String( identifiersTableData )}
                    WHERE user_id = $1
                    ORDER BY
                        CASE WHEN identifier_type = 'email' THEN 0 ELSE 1 END,
                        created_at ASC
                    LIMIT 20
                `,
                values: [userIdentifierData]
            });

            //CallBack THE OBJECT
            return Object.freeze(identifiersLoadResultData.rows.map(function identifierRowMap( identifierRowData ){
                //Mapping public identifier metadata without normalized lookup values
                return Object.freeze({
                    identifierId: String( identifierRowData.identifier_id ),
                    type: String( identifierRowData.identifier_type ),
                    display: String( identifierRowData.value_display ),
                    verified: identifierRowData.verified_at !== null
                });

            }));

        },

        /**
         * @param {string} userIdentifierData
         */
        async permissionsResolve( userIdentifierData ){
            //Loading only active global roles and their stable permission names
            const permissionsLoadResult = await repositoryOptions.database.query({
                text: `
                    SELECT DISTINCT permissions.permission
                    FROM ${String( userRolesTableData )} AS user_roles
                    INNER JOIN ${String( rolesTableData )} AS roles
                        ON roles.role_id = user_roles.role_id
                        AND roles.status = 'active'
                    INNER JOIN ${String( rolePermissionsTableData )} AS permissions
                        ON permissions.role_id = roles.role_id
                    WHERE user_roles.user_id = $1
                    ORDER BY permissions.permission ASC
                `,
                values: [userIdentifierData]
            });

            //CallBack THE OBJECT
            return Object.freeze(permissionsLoadResult.rows.map(function permissionRowRead( permissionRowData ){
                //Returning only the stable permission name from each joined role
                return String( permissionRowData.permission );

            }));

        },

        /**
         * @param {string} userIdentifierData
         * @param {'pending' | 'active' | 'disabled' | 'anonymization-pending' | 'anonymized'} statusData
         * @param {string | null} [reasonData]
         */
        async statusSet( userIdentifierData, statusData, reasonData = null, databaseData = repositoryOptions.database ){
            //Checking the lifecycle status and bounded operator reason
            if ( userStatusesData.includes( statusData ) === false ){
                throw new TypeError( 'Auth user status is invalid.' );

            }

            if ( reasonData !== null && (typeof reasonData !== String( 'string' ) || Number( reasonData.length ) > Number( 240 )) ){
                throw new TypeError( 'Auth user status reason is invalid.' );

            }

            const statusUpdateResult = await databaseData.query({
                text: `
                    UPDATE ${String( usersTableData )}
                    SET
                        status = $2,
                        disabled_reason = $3,
                        anonymized_at = CASE WHEN $2 = 'anonymized' THEN now() ELSE anonymized_at END,
                        updated_at = now()
                    WHERE user_id = $1
                    RETURNING user_id
                `,
                values: [
                    userIdentifierData,
                    statusData,
                    reasonData
                ]
            });

            //CallBack THE BOOLEAN
            return Number( statusUpdateResult.rowCount ?? 0 ) === Number( 1 );

        },

        /** @param {string} userIdentifierData */
        async anonymize( userIdentifierData ){
            if ( typeof userIdentifierData !== String( 'string' ) || Number( userIdentifierData.length ) < Number( 8 ) || Number( userIdentifierData.length ) > Number( 128 ) ){
                throw new TypeError( 'Auth user identifier is invalid.' );

            }

            return repositoryOptions.database.transaction(async function userAnonymizeTransaction( transactionData ){
                const userLockResultData = await transactionData.query({
                    text: `
                        SELECT user_id, status
                        FROM ${String( usersTableData )}
                        WHERE user_id = $1
                        FOR UPDATE
                        LIMIT 1
                    `,
                    values: [userIdentifierData]
                });
                const userRowData = userLockResultData.rows[0];

                if ( userRowData === undefined ){
                    return false;

                }

                if ( userRowData.status === String( 'anonymized' ) ){
                    return true;

                }

                //Removing every Layer-owned credential and external identity link
                const credentialTablesData = [
                    recoveryCodesTableData,
                    totpCredentialsTableData,
                    passkeysTableData,
                    passwordCredentialsTableData,
                    challengesTableData,
                    externalIdentitiesTableData,
                    userRolesTableData,
                    identifiersTableData
                ];

                for ( const credentialTableData of credentialTablesData ){
                    await transactionData.query({
                        text: `DELETE FROM ${String( credentialTableData )} WHERE user_id = $1`,
                        values: [userIdentifierData]
                    });

                }

                await transactionData.query({
                    text: `
                        UPDATE ${String( usersTableData )}
                        SET
                            status = 'anonymized',
                            disabled_reason = NULL,
                            anonymized_at = now(),
                            updated_at = now()
                        WHERE user_id = $1
                    `,
                    values: [userIdentifierData]
                });

                return true;

            });

        },

        /**
         * @param {string} userIdentifierData
         * @param {string} identityIdentifierData
         * @param {{query: Function}} [databaseData]
         */
        async identifierVerify( userIdentifierData, identityIdentifierData, databaseData = repositoryOptions.database ){
            //Marking only an identifier owned by the challenge user
            const identifierUpdateResultData = await databaseData.query({
                text: `
                    UPDATE ${String( identifiersTableData )}
                    SET
                        verified_at = COALESCE(verified_at, now()),
                        updated_at = now()
                    WHERE identifier_id = $1
                        AND user_id = $2
                    RETURNING identifier_id
                `,
                values: [
                    identityIdentifierData,
                    userIdentifierData
                ]
            });

            if ( Number( identifierUpdateResultData.rowCount ?? 0 ) !== Number( 1 ) ){
                return false;

            }

            //Activating only a pending identity after successful verification
            await databaseData.query({
                text: `
                    UPDATE ${String( usersTableData )}
                    SET
                        status = 'active',
                        updated_at = now()
                    WHERE user_id = $1
                        AND status = 'pending'
                `,
                values: [userIdentifierData]
            });

            //CallBack THE BOOLEAN
            return true;

        },

        /**
         * @param {string} userIdentifierData
         * @param {{hash: string, parameters: Readonly<Record<string, unknown>>}} passwordData
         * @param {{query: Function}} [databaseData]
         */
        async passwordReplace( userIdentifierData, passwordData, databaseData = repositoryOptions.database ){
            //Rejecting plaintext or a different algorithm at the persistence boundary
            if (
                typeof passwordData?.hash !== 'string' ||
                passwordData.hash.startsWith( '$argon2id$' ) === false ||
                passwordData.parameters === null ||
                typeof passwordData.parameters !== String( 'object' )
            ){
                throw new TypeError( 'Auth password credential must contain an Argon2id hash.' );

            }

            const passwordUpdateResultData = await databaseData.query({
                text: `
                    INSERT INTO ${String( passwordCredentialsTableData )} (
                        user_id,
                        password_hash,
                        algorithm,
                        parameters
                    )
                    SELECT user_id, $2, 'argon2id', $3::jsonb
                    FROM ${String( usersTableData )}
                    WHERE user_id = $1
                        AND status IN ('active', 'pending')
                    ON CONFLICT (user_id)
                    DO UPDATE SET
                        password_hash = EXCLUDED.password_hash,
                        algorithm = 'argon2id',
                        parameters = EXCLUDED.parameters,
                        changed_at = now()
                    RETURNING user_id
                `,
                values: [
                    userIdentifierData,
                    passwordData.hash,
                    JSON.stringify( passwordData.parameters )
                ]
            });

            //CallBack THE BOOLEAN
            return Number( passwordUpdateResultData.rowCount ?? 0 ) === Number( 1 );

        }
    });

}
