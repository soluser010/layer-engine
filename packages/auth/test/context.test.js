import assert from 'node:assert/strict';
import test from 'node:test';
import {LayerError} from '@solcorp/layer-protocol';
import {layerInMemoryRateLimiterCreate} from '@solcorp/layer-security';
import {
    layerDiagnosticsCreate,
    layerOperationExecutorCreate,
    layerOperationRegistryCreate
} from '@solcorp/layer-server';
import {layerAuthContextExtensionCreate} from '../src/server.js';


//Function for creating an observable custom-session-data repository fixture
const sessionDataRepositoryFixtureCreate = function(){
    let customDataValue = /** @type {Record<string, unknown>} */ ({
        draft: true,
        theme: 'dark'
    });
    let customDataRevision = Number( 2 );
    const invalidatedUsersData = /** @type {string[]} */ ([]);

    //CallBack THE OBJECT
    return {
        invalidatedUsersData,
        sessions: {
            async dataGetById( /** @type {string} */ sessionIdentifierData, /** @type {string} */ userIdentifierData ){
                assert.equal( sessionIdentifierData, 'session-context-identifier' );
                assert.equal( userIdentifierData, 'user-context-1' );

                return {
                    value: structuredClone( customDataValue ),
                    revision: customDataRevision
                };

            },
            async dataReplaceById(
                /** @type {string} */ sessionIdentifierData,
                /** @type {string} */ userIdentifierData,
                /** @type {number} */ expectedRevisionData,
                /** @type {Record<string, unknown>} */ nextValueData
            ){
                assert.equal( sessionIdentifierData, 'session-context-identifier' );
                assert.equal( userIdentifierData, 'user-context-1' );

                if ( Number( expectedRevisionData ) !== Number( customDataRevision ) ){
                    return null;

                }

                customDataValue = structuredClone( nextValueData );
                customDataRevision += Number( 1 );

                return customDataRevision;

            },
            async revokeAllByUser( /** @type {string} */ userIdentifierData ){
                invalidatedUsersData.push( userIdentifierData );

                return 3;

            }
        }
    };

};

//Function for creating the server-derived context fixture
const requestContextFixtureCreate = function(){
    return Object.freeze({
        requestId: '7ec2df78-6db4-4b35-8eb0-b2476bb10301',
        operation: 'profile.context.read',
        security: Object.freeze({
            authenticationType: 'session',
            credentialId: 'session-context-identifier',
            sessionId: 'session-context-identifier',
            userId: 'user-context-1',
            tenantId: null,
            permissions: Object.freeze(['profile.read']),
            assurance: Object.freeze(['password', 'totp']),
            remoteAddress: '127.0.0.1'
        })
    });

};

test( 'Context API reads, merges, deletes, and invalidates with revision safety', async function(){
    const repositoryFixtureData = sessionDataRepositoryFixtureCreate();
    const contextExtendData = layerAuthContextExtensionCreate({
        sessions: repositoryFixtureData.sessions,
        dataMaximumBytes: 16384
    });
    const contextData = contextExtendData( requestContextFixtureCreate() ).auth;
    const sessionContextData = contextData.session;

    assert.ok( sessionContextData );
    assert.deepEqual( contextData.user, {id: 'user-context-1'} );
    assert.deepEqual( contextData.permissions, ['profile.read'] );
    assert.deepEqual( contextData.assurance, ['password', 'totp'] );
    assert.equal( sessionContextData.id, 'session-context-identifier' );

    const initialDataResult = await sessionContextData.data.get();
    const mergeDataResult = await sessionContextData.data.merge({locale: 'ru'}, initialDataResult.revision);
    const deleteDataResult = await sessionContextData.data.delete(['draft'], mergeDataResult.revision);
    const invalidationResultData = await contextData.authorization.invalidate();

    assert.deepEqual( initialDataResult, {
        value: {draft: true, theme: 'dark'},
        revision: 2
    } );
    assert.deepEqual( mergeDataResult, {
        value: {draft: true, theme: 'dark', locale: 'ru'},
        revision: 3
    } );
    assert.deepEqual( deleteDataResult, {
        value: {theme: 'dark', locale: 'ru'},
        revision: 4
    } );
    assert.deepEqual( invalidationResultData, {revokedSessions: 3} );
    assert.deepEqual( repositoryFixtureData.invalidatedUsersData, ['user-context-1'] );

    await assert.rejects(
        function staleSessionDataSet(){
            return sessionContextData.data.set({theme: 'light'}, 2);

        },
        function conflictErrorCheck( errorData ){
            assert.ok( errorData instanceof LayerError );
            assert.equal( errorData.code, 'AUTH_SESSION_CONFLICT' );
            assert.equal( errorData.status, 409 );
            assert.equal( errorData.retryable, true );

            return true;

        }
    );

});

test( 'operation executor exposes Auth context without allowing core replacement', async function(){
    const repositoryFixtureData = sessionDataRepositoryFixtureCreate();
    const contextExtendData = layerAuthContextExtensionCreate({
        sessions: repositoryFixtureData.sessions
    });
    const registryData = layerOperationRegistryCreate();

    registryData.define({
        name: 'profile.context.read',
        type: 'query',
        auth: 'session',
        inputSchema: {
            type: 'object',
            additionalProperties: false
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['assurance', 'sessionId', 'userId'],
            properties: {
                assurance: {type: 'array', items: {type: 'string'}},
                sessionId: {type: 'string'},
                userId: {type: 'string'}
            }
        },
        async handler( /** @type {any} */ payloadData, /** @type {any} */ handlerContextData ){
            //Returning only safe Auth context fields to prove executor integration
            return {
                assurance: handlerContextData.auth.assurance,
                sessionId: handlerContextData.auth.session.id,
                userId: handlerContextData.auth.user.id
            };

        }
    });

    const executorData = layerOperationExecutorCreate({
        operationRegistry: registryData,
        security: {
            async contextResolve(){
                return requestContextFixtureCreate().security;

            }
        },
        rateLimiter: layerInMemoryRateLimiterCreate(),
        diagnostics: layerDiagnosticsCreate(),
        contextExtend: contextExtendData
    });
    const operationResultData = await executorData.execute({
        request: {
            protocol: 1,
            requestId: '7ec2df78-6db4-4b35-8eb0-b2476bb10302',
            type: 'query',
            operation: 'profile.context.read',
            payload: {}
        },
        headers: {},
        remoteAddress: '127.0.0.1'
    });

    assert.deepEqual( operationResultData, {
        assurance: ['password', 'totp'],
        sessionId: 'session-context-identifier',
        userId: 'user-context-1'
    } );

    const reservedExecutorData = layerOperationExecutorCreate({
        operationRegistry: registryData,
        security: {
            async contextResolve(){
                return requestContextFixtureCreate().security;

            }
        },
        rateLimiter: layerInMemoryRateLimiterCreate(),
        diagnostics: layerDiagnosticsCreate(),
        contextExtend(){
            return {security: {userId: 'forged'}};

        }
    });
    await assert.rejects(
        function reservedContextExecute(){
            return reservedExecutorData.execute({
                request: {
                    protocol: 1,
                    requestId: '7ec2df78-6db4-4b35-8eb0-b2476bb10303',
                    type: 'query',
                    operation: 'profile.context.read',
                    payload: {}
                },
                headers: {},
                remoteAddress: '127.0.0.1'
            });

        },
        function reservedContextErrorCheck( errorData ){
            assert.ok( errorData instanceof LayerError );
            assert.equal( errorData.code, 'INTERNAL_ERROR' );

            return true;

        }
    );

});

test( 'Context API rejects incomplete repositories and every unsafe session mutation boundary', async function(){
    const contextExtensionCreateData = /** @type {any} */ (layerAuthContextExtensionCreate);
    const incompleteContextOptionsData = [
        null,
        {},
        {sessions: {dataGetById(){}, dataReplaceById(){}}},
        {sessions: {dataGetById(){}, revokeAllByUser(){}}},
        {sessions: {dataReplaceById(){}, revokeAllByUser(){}}}
    ];

    for ( const contextOptionsData of incompleteContextOptionsData ){
        assert.throws(function incompleteContextCreate(){
            contextExtensionCreateData( contextOptionsData );

        }, TypeError);

    }

    let sessionLoadMissingStatusData = false;
    let currentRevisionData = Number( 3 );
    let authorizationInvalidateCountData = Number( 0 );
    const contextExtendData = layerAuthContextExtensionCreate({
        sessions: {
            async dataGetById(){
                if ( sessionLoadMissingStatusData === true ){
                    return null;

                }

                return {
                    value: {theme: 'dark'},
                    revision: currentRevisionData
                };

            },
            async dataReplaceById(
                /** @type {string} */ sessionIdentifierData,
                /** @type {string} */ userIdentifierData,
                /** @type {number} */ expectedRevisionData
            ){
                assert.equal( sessionIdentifierData, 'session-context-identifier' );
                assert.equal( userIdentifierData, 'user-context-1' );

                if ( expectedRevisionData !== currentRevisionData ){
                    return null;

                }

                currentRevisionData += Number( 1 );
                return currentRevisionData;

            },
            async revokeAllByUser(){
                return 0;

            }
        },
        async authorizationInvalidate( userIdentifierData ){
            authorizationInvalidateCountData += Number( 1 );
            return {userId: userIdentifierData, invalidated: true};

        }
    });

    assert.throws(
        function missingSecurityContextCreate(){
            contextExtendData( /** @type {any} */ ({security: null}) );

        },
        /security context is unavailable/u
    );
    assert.throws(
        function primitiveSecurityContextCreate(){
            contextExtendData( /** @type {any} */ ({security: 'anonymous'}) );

        },
        /security context is unavailable/u
    );

    const anonymousContextData = contextExtendData({
        security: {
            userId: null,
            sessionId: null,
            permissions: null,
            assurance: null
        }
    }).auth;

    assert.equal( anonymousContextData.user, null );
    assert.equal( anonymousContextData.session, null );
    assert.deepEqual( anonymousContextData.permissions, [] );
    assert.deepEqual( anonymousContextData.assurance, [] );

    await assert.rejects(
        anonymousContextData.authorization.invalidate(),
        function authenticationRequiredCheck( errorData ){
            assert.ok( errorData instanceof LayerError );
            assert.equal( errorData.code, 'AUTH_REQUIRED' );
            return true;

        }
    );

    const authenticatedContextData = contextExtendData( requestContextFixtureCreate() ).auth;
    const sessionContextData = authenticatedContextData.session;

    assert.ok( sessionContextData );
    assert.deepEqual(
        await authenticatedContextData.authorization.invalidate(),
        {userId: 'user-context-1', invalidated: true}
    );
    assert.equal( authorizationInvalidateCountData, 1 );

    for ( const revisionData of [Number.NaN, -1, Number.MAX_SAFE_INTEGER + Number( 1 )] ){
        await assert.rejects(
            sessionContextData.data.set(
                {theme: 'light'},
                /** @type {any} */ (revisionData)
            ),
            TypeError
        );

    }

    const invalidDeleteFieldsData = [
        null,
        [],
        Array.from({length: 65}, function fieldNameCreate( valueData, indexData ){
            return 'field-' + String( indexData );

        }),
        [null],
        [''],
        ['x'.repeat( 129 )],
        ['theme', 'theme']
    ];

    for ( const fieldNamesData of invalidDeleteFieldsData ){
        await assert.rejects(
            sessionContextData.data.delete(
                /** @type {any} */ (fieldNamesData),
                currentRevisionData
            ),
            TypeError
        );

    }

    await assert.rejects(
        sessionContextData.data.merge({locale: 'ru'}, currentRevisionData - Number( 1 )),
        function mergeConflictCheck( errorData ){
            assert.ok( errorData instanceof LayerError );
            assert.equal( errorData.code, 'AUTH_SESSION_CONFLICT' );
            return true;

        }
    );
    await assert.rejects(
        sessionContextData.data.delete(['theme'], currentRevisionData - Number( 1 )),
        function deleteConflictCheck( errorData ){
            assert.ok( errorData instanceof LayerError );
            assert.equal( errorData.code, 'AUTH_SESSION_CONFLICT' );
            return true;

        }
    );

    sessionLoadMissingStatusData = true;

    await assert.rejects(
        sessionContextData.data.get(),
        function lostSessionCheck( errorData ){
            assert.ok( errorData instanceof LayerError );
            assert.equal( errorData.code, 'AUTH_REQUIRED' );
            return true;

        }
    );

});
