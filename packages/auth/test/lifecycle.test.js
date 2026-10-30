import assert from 'node:assert/strict';
import test from 'node:test';
import {
    layerAuthAccountLifecycleCreate,
    layerAuthRoleServiceCreate
} from '../src/index.js';


test( 'account disable revokes sessions, OAuth records, and API keys immediately', async function(){
    const actionsData = /** @type {any[]} */ ([]);
    let accountStatusData = String( 'active' );
    const lifecycleData = layerAuthAccountLifecycleCreate(/** @type {any} */ ({
        configuration: {anonymization: null},
        users: {
            async findById(){
                return {userId: 'user-lifecycle', status: accountStatusData};

            },
            async statusSet( /** @type {any} */ userIdentifierData, /** @type {any} */ statusData, /** @type {any} */ reasonData ){
                actionsData.push(['status', userIdentifierData, statusData, reasonData]);
                accountStatusData = statusData;
                return true;

            },
            async anonymize(){
                actionsData.push(['anonymize']);
                accountStatusData = 'anonymized';
                return true;

            }
        },
        sessions: {
            async revokeAllByUser( /** @type {any} */ userIdentifierData, /** @type {any} */ reasonData ){
                actionsData.push(['sessions', userIdentifierData, reasonData]);
                return 3;

            }
        },
        oauth: {
            async revokeAccount( /** @type {any} */ userIdentifierData ){
                actionsData.push(['oauth', userIdentifierData]);

            }
        },
        apiKeys: {
            async revokeAllByUser( /** @type {any} */ userIdentifierData ){
                actionsData.push(['api-keys', userIdentifierData]);
                return 2;

            }
        }
    }));
    const resultData = await lifecycleData.disable( 'user-lifecycle', 'operator-request' );

    assert.deepEqual( resultData, {
        disabled: true,
        revokedSessions: 3,
        revokedApiKeys: 2,
        oauthRevoked: true
    } );
    assert.deepEqual( actionsData, [
        ['status', 'user-lifecycle', 'disabled', 'operator-request'],
        ['sessions', 'user-lifecycle', 'account-disabled'],
        ['api-keys', 'user-lifecycle'],
        ['oauth', 'user-lifecycle']
    ]);

});

test( 'account anonymization is retriable and erases Layer credentials after application cleanup', async function(){
    const actionsData = /** @type {any[]} */ ([]);
    let accountStatusData = String( 'active' );
    const lifecycleData = layerAuthAccountLifecycleCreate(/** @type {any} */ ({
        configuration: {
            async anonymization( /** @type {any} */ contextData ){
                actionsData.push(['application', contextData.auth.user.id]);

            }
        },
        users: {
            async findById(){
                return {userId: 'user-anonymize', status: accountStatusData};

            },
            async statusSet( /** @type {any} */ userIdentifierData, /** @type {any} */ statusData ){
                actionsData.push(['status', statusData]);
                accountStatusData = statusData;
                return true;

            },
            async anonymize( /** @type {any} */ userIdentifierData ){
                actionsData.push(['credentials', userIdentifierData]);
                accountStatusData = 'anonymized';
                return true;

            }
        },
        sessions: {
            async revokeAllByUser(){
                actionsData.push(['sessions']);
                return 1;

            }
        }
    }));

    const firstResultData = await lifecycleData.anonymize( 'user-anonymize' );
    const repeatedResultData = await lifecycleData.anonymize( 'user-anonymize' );

    assert.equal( firstResultData.anonymized, true );
    assert.equal( firstResultData.repeated, false );
    assert.deepEqual( repeatedResultData, {anonymized: true, repeated: true} );
    assert.deepEqual( actionsData, [
        ['status', 'anonymization-pending'],
        ['sessions'],
        ['application', 'user-anonymize'],
        ['credentials', 'user-anonymize']
    ]);

});

test( 'role mutations invalidate every affected account authorization', async function(){
    const invalidationsData = /** @type {any[]} */ ([]);
    const roleServiceData = layerAuthRoleServiceCreate(/** @type {any} */ ({
        roles: {
            async usersList(){
                return ['user-role-a', 'user-role-b'];

            },
            async define( /** @type {any} */ roleData ){
                return {...roleData, id: 'role-id', status: 'active'};

            },
            async assign(){
                return true;

            },
            async remove(){
                return true;

            },
            async listForUser(){
                return [{name: 'moderator'}];

            }
        },
        accounts: {
            async invalidate( /** @type {any} */ userIdentifierData, /** @type {any} */ reasonData ){
                invalidationsData.push([userIdentifierData, reasonData]);
                return {revokedSessions: 1};

            }
        }
    }));

    await roleServiceData.define({name: 'moderator', permissions: ['chat.message.remove']});
    await roleServiceData.assign( 'user-role-c', 'moderator' );
    await roleServiceData.remove( 'user-role-d', 'moderator' );

    assert.deepEqual( invalidationsData, [
        ['user-role-a', 'role-definition-changed'],
        ['user-role-b', 'role-definition-changed'],
        ['user-role-c', 'role-assigned'],
        ['user-role-d', 'role-removed']
    ]);

});

test( 'account and role lifecycle constructors reject each incomplete dependency', function(){
    const accountLifecycleCreateData = /** @type {any} */ (layerAuthAccountLifecycleCreate);
    const roleServiceCreateData = /** @type {any} */ (layerAuthRoleServiceCreate);
    const userMethodsData = {
        findById(){},
        statusSet(){},
        anonymize(){}
    };
    const sessionMethodsData = {
        revokeAllByUser(){}
    };
    const roleMethodsData = {
        define(){},
        assign(){},
        remove(){},
        listForUser(){},
        usersList(){}
    };
    const accountMethodsData = {
        invalidate(){}
    };
    const invalidAccountOptionsData = [
        null,
        {},
        {users: {statusSet(){}, anonymize(){}}, sessions: sessionMethodsData},
        {users: {findById(){}, anonymize(){}}, sessions: sessionMethodsData},
        {users: {findById(){}, statusSet(){}}, sessions: sessionMethodsData},
        {users: userMethodsData, sessions: {}}
    ];
    const invalidRoleOptionsData = [
        null,
        {},
        {roles: {...roleMethodsData, define: null}, accounts: accountMethodsData},
        {roles: {...roleMethodsData, assign: null}, accounts: accountMethodsData},
        {roles: {...roleMethodsData, remove: null}, accounts: accountMethodsData},
        {roles: {...roleMethodsData, listForUser: null}, accounts: accountMethodsData},
        {roles: {...roleMethodsData, usersList: null}, accounts: accountMethodsData},
        {roles: roleMethodsData, accounts: {}}
    ];

    for ( const accountOptionsData of invalidAccountOptionsData ){
        assert.throws(function invalidAccountLifecycleCreate(){
            accountLifecycleCreateData( accountOptionsData );

        }, TypeError);

    }

    for ( const roleOptionsData of invalidRoleOptionsData ){
        assert.throws(function invalidRoleServiceCreate(){
            roleServiceCreateData( roleOptionsData );

        }, TypeError);

    }

});

test( 'account and role lifecycle return neutral results for missing or unchanged state', async function(){
    let accountModeData = String( 'missing' );
    const lifecycleData = layerAuthAccountLifecycleCreate(/** @type {any} */ ({
        configuration: {anonymization: null},
        users: {
            async findById(){
                if ( accountModeData === String( 'missing' ) ){
                    return null;

                }

                if ( accountModeData === String( 'anonymized' ) ){
                    return {userId: 'user-lifecycle', status: 'anonymized'};

                }

                return {userId: 'user-lifecycle', status: 'active'};

            },
            async statusSet(){
                return accountModeData !== String( 'status-miss' );

            },
            async anonymize(){
                return false;

            }
        },
        sessions: {
            async revokeAllByUser(){
                return 0;

            }
        }
    }));

    assert.deepEqual(
        await lifecycleData.disable( 'user-lifecycle' ),
        {disabled: false}
    );
    assert.deepEqual(
        await lifecycleData.anonymize( 'user-lifecycle' ),
        {anonymized: false}
    );

    accountModeData = 'anonymized';
    assert.deepEqual(
        await lifecycleData.disable( 'user-lifecycle' ),
        {disabled: false}
    );

    accountModeData = 'status-miss';
    assert.deepEqual(
        await lifecycleData.disable( 'user-lifecycle' ),
        {disabled: false}
    );

    accountModeData = 'active';
    assert.deepEqual(
        await lifecycleData.invalidate( 'user-lifecycle' ),
        {
            revokedSessions: 0,
            revokedApiKeys: 0,
            oauthRevoked: false
        }
    );
    assert.deepEqual(
        await lifecycleData.anonymize( 'user-lifecycle' ),
        {
            anonymized: false,
            repeated: false,
            revokedSessions: 0,
            revokedApiKeys: 0,
            oauthRevoked: false
        }
    );

    let invalidationCountData = Number( 0 );
    const roleServiceData = layerAuthRoleServiceCreate(/** @type {any} */ ({
        roles: {
            async define( /** @type {any} */ roleData ){
                return roleData;

            },
            async assign(){
                return false;

            },
            async remove(){
                return false;

            },
            async listForUser(){
                return [];

            },
            async usersList(){
                return [];

            }
        },
        accounts: {
            async invalidate(){
                invalidationCountData += Number( 1 );

            }
        }
    }));

    assert.equal( await roleServiceData.assign( 'user-role', 'moderator' ), false );
    assert.equal( await roleServiceData.remove( 'user-role', 'moderator' ), false );
    assert.deepEqual( await roleServiceData.listForUser( 'user-role' ), [] );
    assert.equal( invalidationCountData, 0 );

});
