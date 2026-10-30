import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {layerNotificationsVapidGenerate} from '@solcorp/layer-notifications';
import {layerDatabaseSchemaDefine} from '@solcorp/layer-database';
import {
    layerApplicationServerRuntimeCreate,
    layerConfigPublicCreate,
    layerConfigValidate,
    layerCliRun,
    layerProjectBuild,
    layerProjectCreate
} from '../src/index.js';

const pushConfigurationData = {
    secret: {env: 'LAYER_NOTIFICATIONS_SECRET'},
    webPush: {
        vapid: {
            subject: 'mailto:push@example.test',
            publicKey: {env: 'LAYER_PUSH_PUBLIC_KEY'},
            privateKey: {env: 'LAYER_PUSH_PRIVATE_KEY'}
        }
    }
};

test( 'Push config requires a backend and redacts server ENV references', function(){
    //Keeping static applications disabled and rejecting unsafe secret literals
    assert.equal( layerConfigValidate({appName: 'push-test'}).notifications, null );
    assert.throws(function staticPushReject(){
        layerConfigValidate({appName: 'push-test', notifications: pushConfigurationData});

    }, function errorCheck( errorData ){
        assert.equal( /** @type {any} */ (errorData).code, 'CLI_CONFIG_INVALID' );
        assert.equal( /** @type {any} */ (errorData).details.path, 'deployment.serverEntry' );

        return true;

    });
    assert.throws(function literalSecretReject(){
        layerConfigValidate({appName: 'push-test', deployment: {serverEntry: 'server/index.js'},
            notifications: {...pushConfigurationData, secret: 'do-not-serialize'}});

    }, {code: 'CLI_CONFIG_INVALID'});
    const configurationData = layerConfigValidate({appName: 'push-test', deployment: {serverEntry: 'server/index.js'},
        notifications: pushConfigurationData});
    const publicData = layerConfigPublicCreate( configurationData );
    assert.deepEqual( publicData.notifications, {webPush: {enabled: true}} );
    assert.equal( JSON.stringify( publicData ).includes( 'LAYER_PUSH' ), false );
    assert.equal( JSON.stringify( publicData ).includes( 'LAYER_NOTIFICATIONS_SECRET' ), false );

});

test( 'VAPID generation is an explicit CLI command independent of application configuration', async function(){
    //Capturing secret output only in test memory, never in CI console logs
    let outputData = '';
    const resultData = await layerCliRun({argv: ['notifications', 'vapid', 'generate'], cwd: os.tmpdir(),
        write( valueData ){
            outputData = valueData;

        }});
    assert.equal( resultData.code, 0 );
    const keysData = JSON.parse( outputData );
    assert.equal( Buffer.from( keysData.publicKey, 'base64url' ).length, 65 );
    assert.equal( Buffer.from( keysData.privateKey, 'base64url' ).length, 32 );
    await assert.rejects( layerCliRun({argv: ['notifications', 'unknown'], cwd: os.tmpdir(), write(){}}), {code: 'CLI_ARGUMENT_REQUIRED'} );

});

test( 'Managed Push lifecycle starts only after migrations and API readiness', async function(){
    //Using isolated embedded state without opening ports or contacting push providers
    const temporaryData = await mkdtemp( path.join( os.tmpdir(), 'layer-push-lifecycle-' ) );
    const vapidData = layerNotificationsVapidGenerate();
    const environmentData = {
        LAYER_PUSH_PUBLIC_KEY: vapidData.publicKey,
        LAYER_PUSH_PRIVATE_KEY: vapidData.privateKey,
        LAYER_NOTIFICATIONS_SECRET: randomBytes( 48 ).toString( 'base64url' )
    };
    const configurationData = layerConfigValidate({appName: 'push-lifecycle', deployment: {serverEntry: 'server/index.js'},
        notifications: pushConfigurationData});
    let contextData = /** @type {any} */ (null);
    let readyData = false;
    const runtimeData = await layerApplicationServerRuntimeCreate({
        rootDirectory: temporaryData,
        stateDirectory: temporaryData,
        configuration: configurationData,
        databaseSchema: layerDatabaseSchemaDefine([]),
        context: {workerId: 'push-worker', environment: 'development'},
        environment: environmentData,
        applicationServerCreate( applicationContextData ){
            //Confirming the factory receives the server-only runtime before it starts
            contextData = applicationContextData;

            return {
                async start(){
                    assert.equal( (await contextData.notifications.diagnostics()).running, false );
                    readyData = true;

                },
                async stop(){
                    readyData = false;

                },
                isReady(){
                    return readyData;

                }
            };

        }
    });

    try {
        assert.ok( contextData.notifications );
        await runtimeData.start({host: '127.0.0.1', port: 8787});
        assert.equal( runtimeData.isReady(), true );
        assert.equal( (await contextData.notifications.diagnostics()).running, true );
        await runtimeData.stop();
        await runtimeData.stop();
        assert.equal( runtimeData.isReady(), false );

    } finally {
        await runtimeData.stop();
        await rm( temporaryData, {recursive: true, force: true} );

    }

});

test( 'Production Push bundle locks transport and never embeds ENV values in browser assets', async function(){
    //Building a real generated application with explicit backend and ENV-only configuration
    const temporaryData = await mkdtemp( path.join( os.tmpdir(), 'layer-push-build-' ) );
    const projectData = path.join( temporaryData, 'push-build' );

    try {
        await layerProjectCreate({targetDirectory: projectData, projectName: 'push-build'});
        await writeFile( path.join( projectData, 'src/server/index.js' ), `
export function layerServerCreate(context) {
    let ready = false;
    return {
        async start() { ready = true; },
        async stop() { ready = false; },
        isReady() { return ready; }
    };
}
`, 'utf8' );
        const configurationData = layerConfigValidate({appName: 'push-build', deployment: {serverEntry: 'server/index.js'},
            notifications: pushConfigurationData});
        await layerProjectBuild({rootDirectory: projectData, config: configurationData});
        const distData = path.join( projectData, 'dist' );
        const packageData = JSON.parse( await readFile( path.join( distData, 'package.json' ), 'utf8' ) );
        const lockData = JSON.parse( await readFile( path.join( distData, 'package-lock.json' ), 'utf8' ) );
        assert.equal( packageData.dependencies['web-push'], '3.6.7' );
        assert.equal( lockData.packages['node_modules/web-push'].version, '3.6.7' );
        const serverSourceData = await readFile( path.join( distData, '_layer/server/application.mjs' ), 'utf8' );
        assert.ok( serverSourceData.includes( 'LAYER_PUSH_PRIVATE_KEY' ) );
        const browserSourceData = await readFile( path.join( distData, '_layer/application.mjs' ), 'utf8' );
        assert.equal( browserSourceData.includes( 'LAYER_PUSH_PRIVATE_KEY' ), false );
        const environmentSourceData = await readFile( path.join( distData, '.env.example' ), 'utf8' );
        assert.ok( environmentSourceData.includes( '# LAYER_NOTIFICATIONS_SECRET=' ) );

    } finally {
        await rm( temporaryData, {recursive: true, force: true} );

    }

});
