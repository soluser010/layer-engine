/**
 * Creates the server-only account lifecycle. Identity blocking is followed by
 * immediate managed-session, OAuth artifact, and API-key revocation.
 *
 * @param {{
 *     configuration: Readonly<Record<string, any>>,
 *     users: {findById: Function, statusSet: Function, anonymize: Function},
 *     sessions: {revokeAllByUser: Function},
 *     oauth?: {revokeAccount: Function} | null,
 *     apiKeys?: {revokeAllByUser: Function} | null
 * }} lifecycleOptions
 */
export function layerAuthAccountLifecycleCreate( lifecycleOptions ){
    if (
        lifecycleOptions === null ||
        typeof lifecycleOptions !== String( 'object' ) ||
        typeof lifecycleOptions.users?.findById !== String( 'function' ) ||
        typeof lifecycleOptions.users?.statusSet !== String( 'function' ) ||
        typeof lifecycleOptions.users?.anonymize !== String( 'function' ) ||
        typeof lifecycleOptions.sessions?.revokeAllByUser !== String( 'function' )
    ){
        throw new TypeError( 'Layer Auth account lifecycle requires users and managed sessions.' );

    }

    /** @param {string} userIdentifierData @param {string} reasonData */
    //Function for revoking every Layer-owned authorization artifact
    const authorizationInvalidateData = async function( userIdentifierData, reasonData ){
        const revokedSessionsData = await lifecycleOptions.sessions.revokeAllByUser(
            userIdentifierData,
            reasonData
        );
        let revokedApiKeysData = Number( 0 );

        if ( lifecycleOptions.apiKeys !== null && lifecycleOptions.apiKeys !== undefined ){
            revokedApiKeysData = await lifecycleOptions.apiKeys.revokeAllByUser( userIdentifierData );

        }

        if ( lifecycleOptions.oauth !== null && lifecycleOptions.oauth !== undefined ){
            await lifecycleOptions.oauth.revokeAccount( userIdentifierData );

        }

        //CallBack THE OBJECT
        return Object.freeze({
            revokedSessions: Number( revokedSessionsData ),
            revokedApiKeys: Number( revokedApiKeysData ),
            oauthRevoked: lifecycleOptions.oauth !== null && lifecycleOptions.oauth !== undefined
        });

    };

    return Object.freeze({
        /** @param {string} userIdentifierData @param {string} [reasonData] */
        async disable( userIdentifierData, reasonData = 'operator-disabled' ){
            const userData = await lifecycleOptions.users.findById( userIdentifierData );

            if ( userData === null ){
                return Object.freeze({disabled: false});

            }

            if ( userData.status === String( 'anonymized' ) ){
                return Object.freeze({disabled: false});

            }

            const disabledStatusData = await lifecycleOptions.users.statusSet(
                userIdentifierData,
                'disabled',
                reasonData
            );

            if ( disabledStatusData !== true ){
                return Object.freeze({disabled: false});

            }

            const revokeResultData = await authorizationInvalidateData(
                userIdentifierData,
                'account-disabled'
            );

            //CallBack THE OBJECT
            return Object.freeze({
                disabled: true,
                ...revokeResultData
            });

        },

        /** @param {string} userIdentifierData */
        async anonymize( userIdentifierData ){
            const userData = await lifecycleOptions.users.findById( userIdentifierData );

            if ( userData === null ){
                return Object.freeze({anonymized: false});

            }

            if ( userData.status === String( 'anonymized' ) ){
                return Object.freeze({anonymized: true, repeated: true});

            }

            await lifecycleOptions.users.statusSet(
                userIdentifierData,
                'anonymization-pending',
                'anonymization-requested'
            );
            const revokeResultData = await authorizationInvalidateData(
                userIdentifierData,
                'account-anonymization'
            );
            const anonymizationHookData = lifecycleOptions.configuration.anonymization;

            //Calling the documented idempotent application cleanup before credential erasure
            if ( typeof anonymizationHookData === String( 'function' ) ){
                await anonymizationHookData(Object.freeze({
                    auth: Object.freeze({
                        user: Object.freeze({id: String( userIdentifierData )})
                    })
                }));

            }

            const anonymizedStatusData = await lifecycleOptions.users.anonymize( userIdentifierData );

            //CallBack THE OBJECT
            return Object.freeze({
                anonymized: anonymizedStatusData === true,
                repeated: false,
                ...revokeResultData
            });

        },

        /** @param {string} userIdentifierData @param {string} [reasonData] */
        invalidate( userIdentifierData, reasonData = 'authorization-invalidated' ){
            //Invalidating every credential affected by the authorization change
            return authorizationInvalidateData( userIdentifierData, reasonData );

        }
    });

}

/**
 * Creates global role management with immediate authorization invalidation.
 *
 * @param {{roles: any, accounts: {invalidate: Function}}} roleOptions
 */
export function layerAuthRoleServiceCreate( roleOptions ){
    if (
        roleOptions === null ||
        typeof roleOptions !== String( 'object' ) ||
        typeof roleOptions.roles?.define !== String( 'function' ) ||
        typeof roleOptions.roles?.assign !== String( 'function' ) ||
        typeof roleOptions.roles?.remove !== String( 'function' ) ||
        typeof roleOptions.roles?.listForUser !== String( 'function' ) ||
        typeof roleOptions.roles?.usersList !== String( 'function' ) ||
        typeof roleOptions.accounts?.invalidate !== String( 'function' )
    ){
        throw new TypeError( 'Layer Auth role service requires roles and authorization invalidation.' );

    }

    return Object.freeze({
        /** @param {{name: string, permissions: readonly string[], status?: 'active' | 'disabled'}} roleData */
        async define( roleData ){
            //Capturing existing assignees before replacing the role definition
            const affectedUsersData = await roleOptions.roles.usersList( roleData?.name );
            const roleResultData = await roleOptions.roles.define( roleData );

            for ( const userIdentifierData of affectedUsersData ){
                await roleOptions.accounts.invalidate( userIdentifierData, 'role-definition-changed' );

            }

            return roleResultData;

        },

        /** @param {string} userIdentifierData @param {string} roleNameData */
        async assign( userIdentifierData, roleNameData ){
            //Assigning the role before invalidating the affected authorization snapshots
            const assignmentStatusData = await roleOptions.roles.assign( userIdentifierData, roleNameData );

            if ( assignmentStatusData === true ){
                await roleOptions.accounts.invalidate( userIdentifierData, 'role-assigned' );

            }

            return assignmentStatusData;

        },

        /** @param {string} userIdentifierData @param {string} roleNameData */
        async remove( userIdentifierData, roleNameData ){
            //Removing the role before invalidating the affected authorization snapshots
            const removalStatusData = await roleOptions.roles.remove( userIdentifierData, roleNameData );

            if ( removalStatusData === true ){
                await roleOptions.accounts.invalidate( userIdentifierData, 'role-removed' );

            }

            return removalStatusData;

        },

        /** @param {string} userIdentifierData */
        listForUser( userIdentifierData ){
            //Returning the persisted global roles for the selected user
            return roleOptions.roles.listForUser( userIdentifierData );

        }
    });

}
