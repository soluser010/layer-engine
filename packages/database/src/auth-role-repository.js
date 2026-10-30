import {randomUUID} from 'node:crypto';
import {layerSystemTableReferenceCreate} from './system-schema.js';


const roleNamePatternData = /^[a-z][a-z0-9-]{1,79}$/u;
const permissionNamePatternData = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)+$/u;


/**
 * @typedef {{
 *     systemSchema?: string,
 *     query: (queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, any>[], rowCount: number | null}>,
 *     transaction: <ResultData>(handlerData: (databaseData: AuthRoleDatabase) => Promise<ResultData>) => Promise<ResultData>
 * }} AuthRoleDatabase
 */


/**
 * @param {unknown} roleNameData
 */
//Function for checking a stable global role name
const roleNameCheck = function( roleNameData ){
    //Checking the role name before using it as a stable policy identifier
    if ( typeof roleNameData !== 'string' || roleNamePatternData.test( roleNameData ) === false ){
        throw new TypeError( 'Auth role name is invalid.' );

    }

    //CallBack THE STRING
    return String( roleNameData );

};

/**
 * @param {unknown} permissionsInputData
 */
//Function for checking a bounded permission allowlist
const permissionsCreate = function( permissionsInputData ){
    //Checking the permission collection before normalizing its values
    if ( Array.isArray( permissionsInputData ) === false || Number( permissionsInputData.length ) > Number( 500 ) ){
        throw new TypeError( 'Auth role permissions must be an array with at most 500 items.' );

    }

    const permissionsData = /** @type {string[]} */ ([]);
    const permissionSetData = new Set();

    for ( const permissionInputData of permissionsInputData ){
        //Checking every permission before adding it to the role allowlist
        if (
            typeof permissionInputData !== 'string' ||
            permissionNamePatternData.test( permissionInputData ) === false ||
            permissionSetData.has( permissionInputData ) === true
        ){
            throw new TypeError( 'Auth role permissions contain an invalid or duplicate value.' );

        }

        permissionSetData.add( permissionInputData );
        permissionsData.push( permissionInputData );

    }

    permissionsData.sort();

    //CallBack THE OBJECT
    return Object.freeze( permissionsData );

};

/**
 * Creates the SQL-first global role repository. Application tenant roles stay
 * in application schema and may be merged by the Auth authorization hook.
 *
 * @param {{
 *     database: AuthRoleDatabase,
 *     identifierCreate?: () => string
 * }} repositoryOptions
 */
export function layerAuthRoleRepositoryCreate( repositoryOptions ){
    //Checking the transactional boundary before exposing role mutation
    if (
        repositoryOptions === null ||
        typeof repositoryOptions !== String( 'object' ) ||
        typeof repositoryOptions.database?.query !== String( 'function' ) ||
        typeof repositoryOptions.database?.transaction !== String( 'function' )
    ){
        throw new TypeError( 'Auth role repository requires a transactional database.' );

    }

    const rolesTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_roles' );
    const permissionsTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_role_permissions' );
    const userRolesTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_user_roles' );
    const identifierCreateData = repositoryOptions.identifierCreate ?? randomUUID;

    return Object.freeze({
        /**
         * @param {{name: string, permissions: readonly string[], status?: 'active' | 'disabled'}} roleData
         */
        async define( roleData ){
            const roleNameData = roleNameCheck( roleData?.name );
            const permissionsData = permissionsCreate( roleData?.permissions );
            const roleStatusData = roleData?.status ?? 'active';

            if ( ['active', 'disabled'].includes( roleStatusData ) === false ){
                throw new TypeError( 'Auth role status is invalid.' );

            }

            //Replacing one complete role permission set in a single transaction
            return repositoryOptions.database.transaction(async function roleDefineTransaction( /** @type {AuthRoleDatabase} */ transactionData ){
                const roleUpsertResultData = await transactionData.query({
                    text: `
                        INSERT INTO ${String( rolesTableData )} (role_id, role_name, status)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (role_name)
                        DO UPDATE SET
                            status = EXCLUDED.status,
                            updated_at = now()
                        RETURNING role_id, role_name, status
                    `,
                    values: [
                        identifierCreateData(),
                        roleNameData,
                        roleStatusData
                    ]
                });
                const roleRowData = roleUpsertResultData.rows[0];

                if ( roleRowData === undefined ){
                    throw new Error( 'Auth role definition did not return its identifier.' );

                }

                await transactionData.query({
                    text: `DELETE FROM ${String( permissionsTableData )} WHERE role_id = $1`,
                    values: [roleRowData.role_id]
                });

                for ( const permissionData of permissionsData ){
                    await transactionData.query({
                        text: `
                            INSERT INTO ${String( permissionsTableData )} (role_id, permission)
                            VALUES ($1, $2)
                        `,
                        values: [
                            roleRowData.role_id,
                            permissionData
                        ]
                    });

                }

                //CallBack THE OBJECT
                return Object.freeze({
                    id: String( roleRowData.role_id ),
                    name: String( roleRowData.role_name ),
                    status: String( roleRowData.status ),
                    permissions: permissionsData
                });

            });

        },

        /**
         * @param {string} userIdentifierData
         * @param {string} roleNameData
         * @param {{query: Function}} [databaseData]
         */
        async assign( userIdentifierData, roleNameData, databaseData = repositoryOptions.database ){
            const roleNameCheckedData = roleNameCheck( roleNameData );

            if ( typeof databaseData?.query !== String( 'function' ) ){
                throw new TypeError( 'Auth role assignment database is invalid.' );

            }

            //Assigning only an existing active role to an existing Auth identity
            const roleAssignmentResultData = await databaseData.query({
                text: `
                    INSERT INTO ${String( userRolesTableData )} (user_id, role_id)
                    SELECT $1, roles.role_id
                    FROM ${String( rolesTableData )} AS roles
                    WHERE roles.role_name = $2
                        AND roles.status = 'active'
                    ON CONFLICT (user_id, role_id) DO NOTHING
                    RETURNING role_id
                `,
                values: [
                    userIdentifierData,
                    roleNameCheckedData
                ]
            });

            //CallBack THE BOOLEAN
            return Number( roleAssignmentResultData.rowCount ?? 0 ) === Number( 1 );

        },

        /**
         * @param {string} userIdentifierData
         * @param {string} roleNameData
         */
        async remove( userIdentifierData, roleNameData ){
            const roleNameCheckedData = roleNameCheck( roleNameData );
            const roleRemovalResultData = await repositoryOptions.database.query({
                text: `
                    DELETE FROM ${String( userRolesTableData )} AS user_roles
                    USING ${String( rolesTableData )} AS roles
                    WHERE user_roles.user_id = $1
                        AND user_roles.role_id = roles.role_id
                        AND roles.role_name = $2
                    RETURNING user_roles.role_id
                `,
                values: [
                    userIdentifierData,
                    roleNameCheckedData
                ]
            });

            //CallBack THE BOOLEAN
            return Number( roleRemovalResultData.rowCount ?? 0 ) === Number( 1 );

        },

        /** @param {string} userIdentifierData */
        async listForUser( userIdentifierData ){
            //Loading active roles with deterministic permission aggregation
            const rolesLoadResultData = await repositoryOptions.database.query({
                text: `
                    SELECT
                        roles.role_id,
                        roles.role_name,
                        COALESCE(jsonb_agg(permissions.permission ORDER BY permissions.permission)
                            FILTER (WHERE permissions.permission IS NOT NULL), '[]'::jsonb) AS permissions
                    FROM ${String( userRolesTableData )} AS user_roles
                    INNER JOIN ${String( rolesTableData )} AS roles
                        ON roles.role_id = user_roles.role_id
                        AND roles.status = 'active'
                    LEFT JOIN ${String( permissionsTableData )} AS permissions
                        ON permissions.role_id = roles.role_id
                    WHERE user_roles.user_id = $1
                    GROUP BY roles.role_id, roles.role_name
                    ORDER BY roles.role_name ASC
                `,
                values: [userIdentifierData]
            });

            //CallBack THE OBJECT
            return Object.freeze(rolesLoadResultData.rows.map(function roleRowMap( /** @type {Record<string, any>} */ roleRowData ){
                //Mapping immutable public role metadata from the system schema
                return Object.freeze({
                    id: String( roleRowData.role_id ),
                    name: String( roleRowData.role_name ),
                    permissions: Object.freeze([...(roleRowData.permissions ?? [])].map( String ))
                });

            }));

        },

        /** @param {string} roleNameData */
        async usersList( roleNameData ){
            const roleNameCheckedData = roleNameCheck( roleNameData );
            const usersLoadResultData = await repositoryOptions.database.query({
                text: `
                    SELECT user_roles.user_id
                    FROM ${String( userRolesTableData )} AS user_roles
                    INNER JOIN ${String( rolesTableData )} AS roles
                        ON roles.role_id = user_roles.role_id
                    WHERE roles.role_name = $1
                    ORDER BY user_roles.user_id ASC
                `,
                values: [roleNameCheckedData]
            });

            //CallBack THE OBJECT
            return Object.freeze(usersLoadResultData.rows.map(function userIdentifierMap( userRowData ){
                //Returning only stable user identifiers affected by the role
                return String( userRowData.user_id );

            }));

        }
    });

}
