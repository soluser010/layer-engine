import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {createClient} from 'redis';
import {layerDatabaseMigrate, layerPostgresDatabaseCreate} from '@solcorp/layer-database';
import {layerOperationRegistryCreate} from '@solcorp/layer-server';
import {layerNotificationsRuntimeCreate, layerNotificationsVapidGenerate} from '../src/index.js';
import {pushCryptoCreate} from '../src/crypto.js';
import {pushRepositoryCreate} from '../src/repository.js';

test( 'local PostgreSQL and Redis: durable queue, concurrent claims, restart and SQL fallback', {
    skip: process.env.LAYER_PUSH_INFRASTRUCTURE_TEST !== '1'
}, async function(){
    //Creating an isolated temporary schema without stopping or reconfiguring shared OpenServer services
    const schemaData = 'layer_push_gate_' + randomBytes( 6 ).toString( 'hex' );
    const vapidData = layerNotificationsVapidGenerate();
    const configurationData = {secret: {env: 'PUSH_SECRET'}, webPush: {
        vapid: {subject: 'mailto:push@example.com', publicKey: {env: 'PUSH_PUBLIC'}, privateKey: {env: 'PUSH_PRIVATE'}}, delivery: {pollIntervalMs: 100}
    }};
    const environmentData = {PUSH_SECRET: randomBytes( 48 ).toString( 'base64url' ), PUSH_PUBLIC: vapidData.publicKey, PUSH_PRIVATE: vapidData.privateKey};
    const databaseData = layerPostgresDatabaseCreate({connectionOptions: {host: '127.0.0.1', port: 5432, user: 'postgres', database: 'postgres'},
        systemSchema: schemaData, maxConnections: 4});
    const redisData = createClient({RESP: 2, socket: {host: '127.0.0.1', port: 6379, connectTimeout: 2000, reconnectStrategy: false}});
    redisData.on( 'error', function redisErrorIgnore(){
        //The test reports failures through the awaited operation, never through unhandled events

    });
    const runtimeOptionsData = {applicationName: schemaData, configuration: configurationData, database: databaseData, environment: environmentData,
        redis: {client: redisData, isReady(){
            return redisData.isReady;

        }}, transport: {async send(){
            return {status: 201};

        }}};
    const runtimeData = layerNotificationsRuntimeCreate( runtimeOptionsData );
    const registryData = layerOperationRegistryCreate();
    runtimeData.register( registryData );
    const identityData = {tenantId: null, userId: 'push-user', credentialId: 'push-session', authenticationType: 'session'};
    const sendData = {recipients: {users: ['push-user']}, notification: {title: 'Test', body: 'Local test', url: '/'}, deduplicationKey: 'gate'};

    try {
        await databaseData.connect();
        await layerDatabaseMigrate( databaseData );
        await redisData.connect();
        await databaseData.query({text: `INSERT INTO "${schemaData}".sys_sessions (session_hash,session_id,user_id,csrf_hash,status,expires_at)
            VALUES ('push-hash','push-session','push-user','csrf','active',now()+interval '1 hour')`, values: []});
        await registryData.get( 'notifications.webpush.subscription.register' )?.handler({subscription: {
            endpoint: 'https://fcm.googleapis.com/test-only', keys: {p256dh: vapidData.publicKey, auth: randomBytes( 16 ).toString( 'base64url' )}
        }}, {security: identityData});
        await runtimeData.scope({tenantId: null}).webPush.send( sendData );

        const repositoryData = pushRepositoryCreate( databaseData, pushCryptoCreate( environmentData.PUSH_SECRET, schemaData ) );
        const claimsData = await Promise.all( ['worker-one', 'worker-two'].map(async function workerClaim( workerIdData ){
            return databaseData.transaction(async function claimTransaction( transactionData ){
                return pushRepositoryCreate( transactionData, pushCryptoCreate( environmentData.PUSH_SECRET, schemaData ) ).claim( workerIdData, 1, 8 );

            });

        }) );
        assert.equal( claimsData.flat().length, 1 );
        const claimedData = /** @type {Record<string, any>} */ (claimsData.flat()[0]);
        await repositoryData.complete( claimedData, String( claimedData.lease_owner ), 'pending', 0, false );
        await runtimeData.start();
        assert.equal( (await runtimeData.diagnostics()).pending, 0 );
        assert.equal( (await runtimeData.diagnostics()).coordination, 'redis+sql' );
        await runtimeData.stop();

        //Disconnecting only the test's Redis connection; shared Redis remains running
        await redisData.quit();
        await runtimeData.scope({tenantId: null}).webPush.send({...sendData, deduplicationKey: 'sql-fallback'});
        const restartedData = layerNotificationsRuntimeCreate( runtimeOptionsData );
        await restartedData.start();
        assert.equal( (await restartedData.diagnostics()).pending, 0 );
        assert.equal( (await restartedData.diagnostics()).coordination, 'sql' );
        await restartedData.stop();

    } finally {
        await runtimeData.stop();

        if ( redisData.isOpen ){
            redisData.destroy();

        }

        //Removing only the freshly generated test schema, after checking its exact identifier
        assert.match( schemaData, /^layer_push_gate_[a-f0-9]{12}$/ );
        await databaseData.query({text: `DROP SCHEMA IF EXISTS "${schemaData}" CASCADE`, values: []});
        await databaseData.close();

    }

});
