import assert from 'node:assert/strict';
import {randomBytes, createECDH} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {layerDatabaseMigrate, layerPgliteDatabaseCreate} from '@solcorp/layer-database';
import {layerOperationRegistryCreate, layerOperationExecutorCreate} from '@solcorp/layer-server';
import {layerNotificationsConfigurationCreate, layerNotificationsRuntimeCreate, layerNotificationsSecretsRead, layerNotificationsVapidGenerate} from '../src/index.js';
import {pushCryptoCreate} from '../src/crypto.js';
import {pushInputErrorCreate} from '../src/configuration.js';
import {pushRepositoryCreate} from '../src/repository.js';
import {pushEndpointValidate, pushSubscriptionValidate, pushTransportCreate} from '../src/transport.js';

const vapidData = layerNotificationsVapidGenerate();
const environmentData = {PUSH_PUBLIC: vapidData.publicKey, PUSH_PRIVATE: vapidData.privateKey, PUSH_SECRET: randomBytes( 48 ).toString( 'base64url' )};
const configurationData = {secret: {env: 'PUSH_SECRET'}, webPush: {
    vapid: {subject: 'mailto:push@example.com', publicKey: {env: 'PUSH_PUBLIC'}, privateKey: {env: 'PUSH_PRIVATE'}},
    delivery: {pollIntervalMs: 60000}
}};
const identityData = {tenantId: 'tenant-a', userId: 'user-a', credentialId: 'session-a', authenticationType: 'session'};
const keyPairData = createECDH( 'prime256v1' );
keyPairData.generateKeys();
const subscriptionData = {endpoint: 'https://fcm.googleapis.com/push/device-a',
    keys: {p256dh: keyPairData.getPublicKey().toString( 'base64url' ), auth: randomBytes( 16 ).toString( 'base64url' )}};
const sendData = {recipients: {users: ['user-a']}, notification: {title: 'Message', body: 'Private message', url: '/chat/', badge: '/assets/badge.png', tag: 'chat'}, deduplicationKey: 'message-1', topic: 'chat_latest'};

test( 'subscription failures retain only a safe field path, never endpoint tokens or keys', function(){
    //Checking the diagnostic contract applications must preserve when mapping their public error code
    const casesData = [
        {input: {...subscriptionData, endpoint: 'https://untrusted.example/private-token'}, path: 'subscription.endpoint'},
        {input: {...subscriptionData, keys: {...subscriptionData.keys, auth: 'private-invalid-key'}}, path: 'subscription.keys.auth'},
        {input: {...subscriptionData, keys: {...subscriptionData.keys, p256dh: 'private-invalid-key'}}, path: 'subscription.keys.p256dh'}
    ];
    for ( const caseData of casesData ){
        assert.throws(function subscriptionValidate(){
            //Passing each isolated invalid field through the real provider and crypto validator
            pushSubscriptionValidate( caseData.input );

        }, function diagnosticCheck( errorData ){
            //Inspecting safe classification without weakening the provider allowlist
            const failureData = /** @type {import('@solcorp/layer-protocol').LayerError} */ (errorData);
            assert.equal( failureData.code, 'NOTIFICATIONS_INVALID' );
            assert.deepEqual( failureData.details, {path: caseData.path} );
            assert.doesNotMatch( JSON.stringify( failureData.details ) + failureData.message, /private-token|private-invalid-key/ );
            return true;

        });

    }

});

test( 'strict configuration, ENV keys and authenticated encryption', function(){
    //Checking fail-closed settings and key separation without sharing mutable fixture data
    assert.equal( layerNotificationsConfigurationCreate( null ), null );
    assert.equal( layerNotificationsConfigurationCreate( undefined ), null );
    const normalizedData = layerNotificationsConfigurationCreate( configurationData );
    assert.ok( normalizedData );
    assert.equal( normalizedData.webPush.delivery.maximumAttempts, 8 );
    assert.equal( /** @type {any} */ (pushInputErrorCreate( 'a'.repeat( 1024 ) ).details).path.length, 256 );
    assert.equal( pushInputErrorCreate( 'path\nunsafe' ).message.includes( '\n' ), false );
    assert.deepEqual( layerNotificationsSecretsRead( normalizedData, environmentData ).publicKey, vapidData.publicKey );

    for ( const invalidData of [[], {}, {...configurationData, unknown: true}, {...configurationData, secret: 'literal'},
        {...configurationData, secret: {env: 'lowercase'}},
        {...configurationData, webPush: {...configurationData.webPush, unknown: true}},
        {...configurationData, webPush: {...configurationData.webPush, delivery: {pollIntervalMs: 1}}},
        {...configurationData, webPush: {...configurationData.webPush, delivery: {maximumAttempts: 0}}},
        {...configurationData, webPush: {...configurationData.webPush, delivery: {maximumTtlSeconds: 10}}},
        {...configurationData, webPush: {...configurationData.webPush, vapid: {...configurationData.webPush.vapid, subject: 'bad'}}},
        {...configurationData, webPush: {...configurationData.webPush, allowedOrigins: ['http://internal']}},
        {...configurationData, webPush: {...configurationData.webPush, allowedOrigins: ['not-url']}},
        {...configurationData, webPush: {...configurationData.webPush, allowedOrigins: Array( 33 ).fill( 'https://example.com' )}}] ){
        assert.throws(function configReject(){
            layerNotificationsConfigurationCreate( invalidData );

        }, {code: 'NOTIFICATIONS_INVALID'});

    }

    for ( const invalidEnvironmentData of [{}, {...environmentData, PUSH_PRIVATE: 'bad'}, {...environmentData, PUSH_PUBLIC: 'mismatch'}] ){
        assert.throws(function missingSecretsReject(){
            layerNotificationsSecretsRead( normalizedData, invalidEnvironmentData );

        }, {code: 'NOTIFICATIONS_SECRET_UNAVAILABLE'});

    }

    const cryptoData = pushCryptoCreate( environmentData.PUSH_SECRET, 'test' );
    const ciphertextData = cryptoData.encrypt({private: 'value'}, 'subscription' );
    assert.deepEqual( cryptoData.decrypt( ciphertextData, 'subscription' ), {private: 'value'} );
    assert.throws(function substitutionReject(){
        cryptoData.decrypt( ciphertextData, 'notification' );

    });
    assert.equal( cryptoData.fingerprint( 'endpoint' ).length, 64 );
    assert.notEqual( cryptoData.fingerprint( 'endpoint' ), pushCryptoCreate( environmentData.PUSH_SECRET, 'other' ).fingerprint( 'endpoint' ) );

});

test( 'provider allowlist, subscription validation, DNS pinning and encrypted HTTP transport', async function(){
    //Rejecting malformed endpoints, redirects and invalid browser keys before any network request
    for ( const endpointData of ['bad', 'http://fcm.googleapis.com/a', 'https://fcm.googleapis.com:8443/a',
        'https://user@fcm.googleapis.com/a', 'https://evil.push.apple.com.evil/a', 'https://fcm.googleapis.com/a#b', 'https://127.0.0.1/'] ){
        assert.throws(function endpointReject(){
            pushEndpointValidate( endpointData );

        });

    }

    assert.equal( pushEndpointValidate( 'https://device.push.apple.com/a' ).hostname, 'device.push.apple.com' );
    assert.equal( pushEndpointValidate( 'https://device.notify.windows.com/a' ).hostname, 'device.notify.windows.com' );
    assert.equal( pushEndpointValidate( 'https://updates.push.services.mozilla.com/a' ).hostname, 'updates.push.services.mozilla.com' );
    assert.ok( pushEndpointValidate( 'https://push.example.com/a', ['https://push.example.com'] ) );
    assert.deepEqual( pushSubscriptionValidate( subscriptionData ), subscriptionData );

    for ( const inputData of [{}, {...subscriptionData, endpoint: 42}, {...subscriptionData, keys: {auth: 'bad', p256dh: 'bad'}},
        {...subscriptionData, keys: {...subscriptionData.keys, p256dh: Buffer.alloc( 65 ).toString( 'base64url' )}}] ){
        assert.throws(function subscriptionReject(){
            pushSubscriptionValidate( inputData );

        });

    }

    let networkCallsData = 0;
    const transportOptionsData = {vapid: {...vapidData, subject: 'mailto:push@example.com'},
        async lookup(){
            return [{address: '8.8.8.8', family: 4}];

        },
        requestImplementation: /** @type {typeof import('node:https').request} */ (/** @type {unknown} */ (function( /** @type {any} */ urlData, /** @type {any} */ optionsData, /** @type {any} */ callbackData ){
            networkCallsData += 1;
            assert.equal( optionsData.servername, 'fcm.googleapis.com' );
            assert.equal( optionsData.headers['Content-Encoding'], 'aes128gcm' );
            assert.equal( optionsData.headers.Topic, 'chat_latest' );
            assert.equal( optionsData.rejectUnauthorized, true );
            optionsData.lookup( 'fcm.googleapis.com', {all: true}, function pinnedAddressCheck( /** @type {any} */ errorData, /** @type {any} */ addressesData ){
                assert.equal( errorData, null );
                assert.equal( addressesData[0].address, '8.8.8.8' );

            });
            optionsData.lookup( 'fcm.googleapis.com', {}, function pinnedSingleCheck( /** @type {any} */ errorData, /** @type {any} */ addressData ){
                assert.equal( addressData, '8.8.8.8' );

            });
            const requestData = /** @type {any} */ (new EventEmitter());
            requestData.end = function encryptedBodyCheck( /** @type {Buffer} */ bodyData ){
                assert.ok( Buffer.isBuffer( bodyData ) );
                assert.equal( bodyData.includes( 'Private message' ), false );
                const responseData = /** @type {any} */ (new EventEmitter());
                responseData.statusCode = 201;
                responseData.headers = {};
                callbackData( responseData );
                responseData.emit( 'data', Buffer.from( 'ok' ) );
                responseData.emit( 'end' );

            };

            return requestData;

        }))};
    const resultData = await pushTransportCreate( transportOptionsData ).send( subscriptionData, sendData.notification, {ttlSeconds: 60, urgency: 'normal', topic: 'chat_latest'} );
    assert.equal( resultData.status, 201 );
    assert.equal( networkCallsData, 1 );
    await assert.rejects( pushTransportCreate({...transportOptionsData, async lookup(){
        return [{address: '127.0.0.1', family: 4}];

    }}).send( subscriptionData, {}, {ttlSeconds: 60, urgency: 'normal'} ), {code: 'OUTBOUND_REQUEST_DENIED'} );
    await assert.rejects( pushTransportCreate({...transportOptionsData, timeoutMs: 10, lookup(){
        return new Promise(function neverResolved(){});

    }}).send( subscriptionData, {}, {ttlSeconds: 60, urgency: 'normal'} ), /TIMEOUT/ );
    assert.equal( networkCallsData, 1 );

});

test( 'Built-in credential checks block delivery after session or OAuth revocation', async function(){
    //Using real system tables so identity checks cannot be accidentally satisfied by a callback mock
    const temporaryData = await mkdtemp( path.join( os.tmpdir(), 'layer-push-credentials-' ) );
    const databaseData = layerPgliteDatabaseCreate({dataDirectory: path.join( temporaryData, 'database' ), systemSchema: 'layer_push_credentials'});
    let deliveryCountData = 0;
    const runtimeData = layerNotificationsRuntimeCreate({configuration: configurationData, applicationName: 'credential-test',
        database: databaseData, environment: environmentData, transport: {async send(){
            deliveryCountData += 1;

            return {status: 201};

        }}});
    const registryData = layerOperationRegistryCreate();
    runtimeData.register( registryData );
    const operationData = registryData.get( 'notifications.webpush.subscription.register' );
    assert.ok( operationData );

    try {
        await databaseData.connect();
        await layerDatabaseMigrate( databaseData );
        await databaseData.query({text: "INSERT INTO layer_push_credentials.sys_auth_users(user_id,status) VALUES('user-a','active')", values: []});
        await databaseData.query({text: `INSERT INTO layer_push_credentials.sys_sessions(session_hash,session_id,user_id,csrf_hash,status,expires_at)
            VALUES('session-hash','session-a','user-a','csrf','active',now()+interval '1 hour')`, values: []});
        await operationData.handler({subscription: subscriptionData}, {security: identityData});
        await runtimeData.scope({tenantId: 'tenant-a'}).webPush.send( sendData );
        await runtimeData.start();
        await runtimeData.stop();
        assert.equal( deliveryCountData, 1 );
        await databaseData.query({text: "UPDATE layer_push_credentials.sys_sessions SET status='revoked'", values: []});
        await runtimeData.scope({tenantId: 'tenant-a'}).webPush.send({...sendData, deduplicationKey: 'revoked-session'});
        await runtimeData.start();
        await runtimeData.stop();
        assert.equal( deliveryCountData, 1 );

        //Checking the opaque built-in OIDC reference without storing the original access token
        const oauthIdentityData = {...identityData, authenticationType: 'bearer', credentialId: 'oauth:digest', credentialReference: 'oidc:record-digest'};
        await databaseData.query({text: `INSERT INTO layer_push_credentials.sys_auth_oidc_records(model_name,record_id_hash,payload_encrypted,expires_at)
            VALUES('AccessToken','record-digest',$1,now()+interval '1 hour')`, values: [Buffer.from( 'fixture' )]});
        await operationData.handler({subscription: subscriptionData}, {security: oauthIdentityData});
        await runtimeData.scope({tenantId: 'tenant-a'}).webPush.send({...sendData, deduplicationKey: 'oauth-active'});
        await runtimeData.start();
        await runtimeData.stop();
        assert.equal( deliveryCountData, 2 );
        await databaseData.query({text: 'DELETE FROM layer_push_credentials.sys_auth_oidc_records', values: []});
        await runtimeData.scope({tenantId: 'tenant-a'}).webPush.send({...sendData, deduplicationKey: 'revoked-oauth'});
        await runtimeData.start();
        await runtimeData.stop();
        assert.equal( deliveryCountData, 2 );

        //Failing closed for unknown external credentials and server-to-server OAuth subjects
        await operationData.handler({subscription: subscriptionData}, {security: {...identityData, authenticationType: 'bearer', credentialId: 'unknown'}});
        await runtimeData.scope({tenantId: 'tenant-a'}).webPush.send({...sendData, deduplicationKey: 'unknown-bearer'});
        await runtimeData.start();
        assert.equal( deliveryCountData, 2 );
        await assert.rejects( Promise.resolve( operationData.handler({subscription: subscriptionData}, {security: {...oauthIdentityData, userId: 'oauth-client:test'}}) ), {code: 'AUTH_REQUIRED'} );

    } finally {
        await runtimeData.stop();
        await databaseData.close();
        await rm( temporaryData, {recursive: true, force: true} );

    }

});

test( 'PGlite durable queue: transaction rollback, isolation, replay, leases, retries and logout', async function(){
    //Using a disposable database without modifying the user's applications or OpenServer services
    const temporaryDirectoryData = await mkdtemp( path.join( os.tmpdir(), 'layer-push-' ) );
    const databaseData = layerPgliteDatabaseCreate({dataDirectory: path.join( temporaryDirectoryData, 'database' ), systemSchema: 'layer_push_test'});
    const cryptoData = pushCryptoCreate( environmentData.PUSH_SECRET, 'test' );
    let providerStatusData = 201;
    let identityActiveData = true;
    let deliveryCountData = 0;
    const runtimeData = layerNotificationsRuntimeCreate({configuration: configurationData, applicationName: 'test', database: databaseData,
        environment: environmentData, async identityActive(){
            return identityActiveData;

        }, transport: {async send( subscriptionData, notificationData, optionsData ){
            assert.equal( notificationData.body, 'Private message' );
            assert.equal( notificationData.badge, '/assets/badge.png' );
            assert.ok( notificationData.notificationId );
            assert.equal( optionsData.topic, 'chat_latest' );
            deliveryCountData += 1;

            return {status: providerStatusData};

        }}});
    const registryData = layerOperationRegistryCreate();
    runtimeData.register( registryData );
    const registerOperationData = registryData.get( 'notifications.webpush.subscription.register' );
    assert.ok( registerOperationData );

    try {
        await databaseData.connect();
        assert.deepEqual( await layerDatabaseMigrate( databaseData ), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] );
        const registrationData = /** @type {{subscriptionId: string}} */ (await registerOperationData.handler({subscription: subscriptionData}, {security: identityData}));
        assert.ok( registrationData.subscriptionId );
        await assert.rejects( Promise.resolve( registerOperationData.handler({subscription: subscriptionData}, {security: {userId: 'forged'}}) ), {code: 'AUTH_REQUIRED'} );
        const repositoryData = pushRepositoryCreate( databaseData, cryptoData );

        await assert.rejects( databaseData.transaction(async function rollbackCommand( transactionData ){
            await runtimeData.executor.bind( transactionData, identityData ).webPush.send( sendData );
            throw new Error( 'rollback' );

        }), /rollback/ );
        assert.equal( (await repositoryData.diagnostics()).pending, 0 );
        const notificationResultData = await runtimeData.scope({tenantId: 'tenant-a'}).webPush.send( sendData );
        const replayData = await runtimeData.scope({tenantId: 'tenant-a'}).webPush.send( sendData );
        assert.deepEqual( replayData, notificationResultData );
        assert.equal( (await repositoryData.diagnostics()).pending, 1 );
        const ciphertextResultData = await databaseData.query({text: 'SELECT encrypted_payload FROM layer_push_test.sys_push_notifications', values: []});
        assert.equal( String( ciphertextResultData.rows[0]?.encrypted_payload ).includes( 'Private message' ), false );

        //Confirming concurrent claim exclusion and lease ownership fencing
        const claimsData = await databaseData.transaction(async function claimsRead( transactionData ){
            return pushRepositoryCreate( transactionData, cryptoData ).claim( 'worker-a', 1, 8 );

        });
        assert.equal( claimsData.length, 1 );
        assert.equal( (await repositoryData.claim( 'worker-b', 1, 8 )).length, 0 );
        await repositoryData.complete( /** @type {Record<string, any>} */ (claimsData[0]), 'wrong-worker', 'sent', 0, false );
        assert.equal( (await repositoryData.diagnostics()).pending, 1 );
        await repositoryData.complete( /** @type {Record<string, any>} */ (claimsData[0]), 'worker-a', 'pending', 0, false );
        await runtimeData.start();
        await runtimeData.start();
        assert.equal( deliveryCountData, 1 );
        assert.equal( (await runtimeData.diagnostics()).coordination, 'sql' );
        assert.equal( (await repositoryData.diagnostics()).pending, 0 );

        //Retrying provider failures without deleting the authoritative SQL record
        providerStatusData = 429;
        await runtimeData.scope({tenantId: 'tenant-a'}).webPush.send({...sendData, deduplicationKey: 'retry'});
        await runtimeData.poll();
        assert.equal( (await repositoryData.diagnostics()).pending, 1 );
        await databaseData.query({text: "UPDATE layer_push_test.sys_push_deliveries SET next_attempt_at=now() WHERE status='pending'", values: []});
        providerStatusData = 410;
        await runtimeData.poll();
        assert.equal( (await repositoryData.diagnostics()).pending, 0 );

        //Preventing old-account queued messages from reaching a rebound device
        await registerOperationData.handler({subscription: subscriptionData}, {security: identityData});
        await runtimeData.stop();
        await runtimeData.scope({tenantId: 'tenant-a'}).webPush.send({...sendData, deduplicationKey: 'account-switch'});
        await registerOperationData.handler({subscription: subscriptionData}, {security: {...identityData, userId: 'user-b', credentialId: 'session-b'}});
        const deliveryBeforeSwitchData = deliveryCountData;
        await runtimeData.start();
        assert.equal( deliveryCountData, deliveryBeforeSwitchData );
        await runtimeData.stop();
        await registerOperationData.handler({subscription: subscriptionData}, {security: identityData});
        await runtimeData.scope({tenantId: 'tenant-a'}).webPush.send({...sendData, deduplicationKey: 'logout'});
        identityActiveData = false;
        await runtimeData.start();
        assert.equal( deliveryCountData, deliveryBeforeSwitchData );

        //Checking permission-independent scope, URL and resource limits in the trusted facade
        const invalidBadgeNotificationsData = ['//evil.example/badge.png', 'https://evil.example/badge.png', '/a\\b', '/a b', 'data:image/png;base64,AA', 7, null].map(function( badgeData ){
            //Preparing one invalid notification for each untrusted badge value
            return {...sendData, notification: {...sendData.notification, badge: badgeData}};

        });

        for ( const invalidData of [...invalidBadgeNotificationsData, {...sendData, notification: {...sendData.notification, url: '//evil.com'}},
            {...sendData, notification: {...sendData.notification, icon: '/a\\b'}},
            {...sendData, recipients: {users: []}}, {...sendData, ttlSeconds: 0}, {...sendData, urgency: 'bad'},
            {...sendData, notification: {...sendData.notification, title: ''}}, {...sendData, notification: {...sendData.notification, tag: 2}},
            {...sendData, topic: 'bad topic'}, {...sendData, topic: 'a'.repeat( 33 )}] ){
            await assert.rejects( runtimeData.scope({tenantId: 'tenant-a'}).webPush.send( /** @type {any} */ (invalidData) ), {code: 'NOTIFICATIONS_INVALID'} );

        }

        assert.equal( (await repositoryData.revoke({...identityData, userId: 'foreign'}, registrationData.subscriptionId)).revoked, false );
        await repositoryData.cleanup();

        //Exercising the real operation executor's atomic push binding and replay behavior
        await runtimeData.stop();
        await registerOperationData.handler({subscription: subscriptionData}, {security: identityData});
        registryData.define({name: 'test.notification.send', type: 'command', transaction: true,
            inputSchema: {type: 'object', required: ['commandId'], properties: {commandId: {type: 'string'}, fail: {type: 'boolean'}}, additionalProperties: false},
            outputSchema: {type: 'object', required: ['notificationId', 'status'], properties: {notificationId: {type: 'string'}, status: {type: 'string'}}, additionalProperties: false},
            async handler( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
                const resultData = await contextData.notifications.webPush.send({...sendData, deduplicationKey: payloadData.commandId});

                if ( payloadData.fail ){
                    throw new Error( 'transaction rejected' );

                }

                return resultData;

            }});
        const executorData = layerOperationExecutorCreate({operationRegistry: registryData, database: databaseData,
            notifications: runtimeData.executor, security: {contextResolve(){
                return identityData;

            }}, rateLimiter: {consume(){
                return {allowed: true};

            }}, diagnostics: {record(){}}});
        const executionData = {request: {requestId: 'test-push', type: 'command', operation: 'test.notification.send', payload: {commandId: 'push-command'}}, headers: {}, remoteAddress: '127.0.0.1'};
        const firstCommandData = await executorData.execute( executionData );
        assert.deepEqual( await executorData.execute( executionData ), firstCommandData );
        assert.equal( (await repositoryData.diagnostics()).pending, 1 );
        await assert.rejects( executorData.execute({...executionData, request: {...executionData.request, payload: {commandId: 'rollback-command', fail: true}}}), {code: 'INTERNAL_ERROR'} );
        assert.equal( (await repositoryData.diagnostics()).pending, 1 );
        const configurationOperationData = registryData.get( 'notifications.webpush.configuration' );
        assert.ok( configurationOperationData );
        assert.equal( /** @type {any} */ (await configurationOperationData.handler({}, {})).publicKey, vapidData.publicKey );
        const revokeOperationData = registryData.get( 'notifications.webpush.subscription.revoke' );
        assert.ok( revokeOperationData );
        assert.equal( /** @type {any} */ (await revokeOperationData.handler({endpoint: subscriptionData.endpoint}, {security: identityData})).revoked, true );

        //Testing Redis hints without depending on shared user Redis services
        const redisCallbacksData = /** @type {Record<string, Function>} */ ({});
        let publishFailureData = false;
        let destroyCountData = 0;
        let providerFailureData = false;
        const subscriberData = {on(){}, async connect(){}, async subscribe( /** @type {string} */ channelData, /** @type {Function} */ callbackData ){
            redisCallbacksData.wake = callbackData;

        }, destroy(){
            destroyCountData += 1;

        }};
        const acceleratedData = layerNotificationsRuntimeCreate({configuration: configurationData, applicationName: 'test', database: databaseData,
            environment: environmentData, async identityActive(){
                return true;

            }, redis: {isReady(){
                return true;

            }, client: {duplicate(){
                return subscriberData;

            }, async publish(){
                if ( publishFailureData ){
                    throw new Error( 'Redis unavailable' );

                }

            }}}, transport: {async send(){
                if ( providerFailureData ){
                    throw new Error( 'network unavailable' );

                }

                return {status: 503, retryAfter: '30'};

            }}});
        await registerOperationData.handler({subscription: subscriptionData}, {security: identityData});
        await acceleratedData.start();
        assert.equal( (await acceleratedData.diagnostics()).coordination, 'redis+sql' );
        publishFailureData = true;
        providerFailureData = true;
        await acceleratedData.scope({tenantId: 'tenant-a'}).webPush.send({...sendData, deduplicationKey: 'redis-fallback'});
        await acceleratedData.poll();
        await redisCallbacksData.wake?.();
        await acceleratedData.stop();
        assert.equal( destroyCountData, 1 );

        //Confirming quotas, expiration and cleanup are evaluated by authoritative storage
        for ( let indexData = 0; indexData < 9; indexData += 1 ){
            await registerOperationData.handler({subscription: {...subscriptionData, endpoint: subscriptionData.endpoint + String( indexData )}}, {security: identityData});

        }

        await assert.rejects( Promise.resolve( registerOperationData.handler({subscription: {...subscriptionData, endpoint: subscriptionData.endpoint + 'overflow'}}, {security: identityData}) ), {code: 'NOTIFICATIONS_SUBSCRIPTION_LIMIT'} );
        await databaseData.query({text: "UPDATE layer_push_test.sys_push_notifications SET expires_at=now()-interval '8 days'", values: []});
        await repositoryData.cleanup();
        assert.equal( (await repositoryData.diagnostics()).pending, 0 );

    } finally {
        await runtimeData.stop();
        await databaseData.close();
        await rm( temporaryDirectoryData, {recursive: true, force: true} );

    }

});
