import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {createServer as httpServerCreate} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {setTimeout as timeoutWait} from 'node:timers/promises';
import {layerConfigValidate} from '../src/config.js';
import {layerDeploymentBundleCreate} from '../src/deployment-bundle.js';
import {layerProjectCreate} from '../src/project-create.js';

//Selecting an existing pinned binary without downloading software during unit checks
let caddyBinaryFileData = process.env.LAYER_TEST_CADDY_BINARY;
if ( caddyBinaryFileData === undefined ){
    const binaryFileNameData = 'caddy';
    let platformBinaryFileNameData = binaryFileNameData;
    if ( process.platform === 'win32' ){
        platformBinaryFileNameData += String( '.exe' );

    }

    caddyBinaryFileData = path.resolve( 'artifacts/production-test-state/caddy/2.11.4',
        process.platform + '-' + process.arch, platformBinaryFileNameData );

}

/** @param {number} portData */
//Function for reserving a loopback listener until all fixture ports are selected
const fixturePortReserve = async function( portData = 0 ){
    //Opening one empty listener to obtain an unused port without touching application servers
    const serverData = createServer();
    await new Promise( function( resolve, rejected ){
        //Forwarding listen failures rather than hiding a failed fixture setup
        serverData.once( 'error', rejected );
        serverData.listen( portData, '127.0.0.1', function(){
            //Completing listener startup
            resolve( undefined );

        });

    });
    const addressData = serverData.address();
    assert.ok( addressData !== null && typeof addressData === 'object' );

    //CallBack THE OBJECT
    return {server: serverData, port: addressData.port};

};

/** @param {ReturnType<typeof createServer>} serverData */
//Function for completing native callback-only listener shutdown
const fixturePortRelease = async function( serverData ){
    //Closing only a listener owned by this fixture
    await new Promise( function( resolve, rejected ){
        serverData.close( function( serverCloseError ){
            //Checking native close completion before continuing fixture startup
            if ( serverCloseError ){
                //Passing unexpected shutdown failure to the caller
                rejected( serverCloseError );

                //Completing the failed branch
                return;

            }

            //Completing successful shutdown
            resolve( undefined );

        });

    });

};

test( 'pinned Caddy enforces private paths, association routing and redacted proxy logs', async function( testContext ){
    //Skipping only when no test binary exists; an explicit invalid binary is a test failure
    assert.ok( caddyBinaryFileData !== undefined );
    if ( existsSync( caddyBinaryFileData ) === false && process.env.LAYER_TEST_CADDY_BINARY === undefined ){
        testContext.skip( 'Provide LAYER_TEST_CADDY_BINARY pointing to Caddy 2.11.4 for this runtime gate.' );

        //Completing the unavailable optional runtime fixture
        return;

    }
    assert.match( execFileSync( caddyBinaryFileData, ['version'], {encoding: 'utf8', windowsHide: true} ), /^v2[.]11[.]4\b/u );

    //Creating marker-only files instead of using any application or real secret
    const fixtureDirectoryData = await mkdtemp( path.join( os.tmpdir(), 'layer-caddy-security-' ) );
    testContext.after( async function(){
        //Validating the exact created directory before removing it recursively
        const relativeFixturePathData = path.relative( os.tmpdir(), fixtureDirectoryData );
        assert.ok( relativeFixturePathData.startsWith( 'layer-caddy-security-' ) );
        assert.equal( relativeFixturePathData.includes( path.sep ), false );
        await rm( fixtureDirectoryData, {recursive: true, force: true} );

    });
    for ( const fixtureFileData of ['.env', 'assets/.env', 'assets/settings.env', 'package.json',
        'package-lock.json', 'Caddyfile', 'node_modules/private.txt', '_layer/shell.html', 'index.html',
        '.well-known/assetlinks.json', '.well-known/apple-app-site-association',
        '.well-known/windows-app-web-link', '.well-known/web-app-origin-association',
        '_layer/version.json', '_layer/update.json'] ){
        //Preparing an observable file response for each protected or public fixture path
        const fixtureFilePathData = path.join( fixtureDirectoryData, fixtureFileData );
        let fixtureContentData = String( 'caddy-fixture-marker' );
        if ( fixtureFileData.endsWith( '.json' ) || fixtureFileData.startsWith( '.well-known/' ) ){
            //Keeping package metadata valid for the bundler without adding real dependencies
            fixtureContentData = JSON.stringify( {name: 'caddy-fixture-marker', private: true} );

        }
        await mkdir( path.dirname( fixtureFilePathData ), {recursive: true} );
        await writeFile( fixtureFilePathData, fixtureContentData, 'utf8' );

    }

    //Preparing a generated full-stack project without executing its server factory
    const projectDirectoryData = path.join( fixtureDirectoryData, 'project' );
    await layerProjectCreate( {targetDirectory: projectDirectoryData, projectName: 'caddy-security'} );
    await writeFile( path.join( projectDirectoryData, 'src/server/index.js' ), `
export const layerServerCreate = function(){
    //Rejecting accidental execution because this fixture tests Caddy routing only
    throw new Error( 'The Caddy fixture server must not execute.' );

};
`, 'utf8' );

    //Generating the real production config and adding only an unreachable fixture upstream
    const deploymentArtifactsData = await layerDeploymentBundleCreate({
        rootDirectory: projectDirectoryData, sourceDirectory: path.join( projectDirectoryData, 'src' ), dryRun: true,
        config: layerConfigValidate({
            appName: 'caddy-security', deployment: {serverEntry: 'server/index.js'},
            security: {permissionsPolicy: {microphone: ['self'], geolocation: ['self']}}
        })
    });
    const caddyfileData = String( deploymentArtifactsData.Caddyfile ).replace( 'handle @layerNavigation {',
        'handle /security-proxy-error {\n            reverse_proxy 127.0.0.1:1\n        }\n        handle @layerNavigation {' );
    //Exercising real upstream idle reuse with the same five-second Node timeout as Layer
    const upstreamData = httpServerCreate(function( requestData, responseData ){
        //Returning socket identity so the test can distinguish safe reuse from stale reuse
        requestData.resume();
        responseData.writeHead( 200, {'content-type': 'application/json'} );
        responseData.end( JSON.stringify({socket: requestData.socket.remotePort}) );

    });
    upstreamData.keepAliveTimeout = 5000;
    await new Promise(function( resolve ){
        //Opening only an ephemeral loopback fixture port
        upstreamData.listen( 0, '127.0.0.1', function(){
            //Completing the callback-only listener startup
            resolve( undefined );

        });

    });
    testContext.after(async function(){
        //Closing fixture connections regardless of proxy test outcome
        upstreamData.closeAllConnections();
        await new Promise(function( resolve ){
            upstreamData.close( resolve );

        });

    });
    const upstreamAddressData = upstreamData.address();
    assert.ok( upstreamAddressData !== null && typeof upstreamAddressData === 'object' );
    const adaptedSourceData = execFileSync( caddyBinaryFileData, ['adapt', '--config', '-', '--adapter', 'caddyfile'], {
        input: caddyfileData, encoding: 'utf8', windowsHide: true,
        env: {...process.env, LAYER_DOMAIN: 'localhost', LAYER_UPSTREAMS: '127.0.0.1:' + upstreamAddressData.port,
            LAYER_BUNDLE_ROOT: fixtureDirectoryData.replaceAll( '\\', '/' )}
    });
    const caddyConfigurationData = JSON.parse( adaptedSourceData );

    //Reserving distinct HTTP and converted-HTTPS ports before starting the isolated process
    const httpsPortData = await fixturePortReserve();
    const httpPortData = await fixturePortReserve();
    for ( const serverData of Object.values( caddyConfigurationData.apps.http.servers ) ){
        //Keeping the generated routing but replacing public listeners and TLS for this local fixture
        const serverRecordData = /** @type {any} */ (serverData);
        let listenerPortData = httpPortData.port;
        if ( serverRecordData.listen.some( function( /** @type {string} */ addressData ){
            //Recognizing the generated HTTPS site without depending on adapter-assigned names
            return String( addressData ).endsWith( ':443' );

        }) ){
            listenerPortData = httpsPortData.port;

        }
        serverRecordData.listen = ['127.0.0.1:' + Number( listenerPortData )];
        serverRecordData.automatic_https = {disable: true};
        delete serverRecordData.tls_connection_policies;
        for ( const routeData of serverRecordData.routes ){
            //Removing only hostname selection because Node Fetch does not send the fixture Host override
            for ( const matcherData of routeData.match ?? [] ){
                delete matcherData.host;

            }

        }

    }
    delete caddyConfigurationData.apps.tls;
    caddyConfigurationData.admin = {disabled: true, config: {persist: false}};
    await fixturePortRelease( httpsPortData.server );
    await fixturePortRelease( httpPortData.server );

    //Capturing only the isolated child logger output for redaction assertions
    const caddyProcessData = spawn( caddyBinaryFileData, ['run', '--config', '-'], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    });
    let loggerOutputData = String();
    for ( const outputStreamData of [caddyProcessData.stdout, caddyProcessData.stderr] ){
        outputStreamData.on( 'data', function( chunkData ){
            //Bounding captured diagnostics even if Caddy unexpectedly becomes verbose
            loggerOutputData = (loggerOutputData + String( chunkData )).slice( Number( -1024 * 1024 ) );

        });

    }
    const processClosePromiseData = new Promise( function( resolve, rejected ){
        //Observing this owned process only; no global Caddy shutdown command is used
        caddyProcessData.once( 'close', resolve );
        caddyProcessData.once( 'error', rejected );

    });
    caddyProcessData.stdin.end( JSON.stringify( caddyConfigurationData ) );
    const baseUrlData = 'http://127.0.0.1:' + Number( httpsPortData.port );
    try {
        //Waiting for the generated public fixture response with bounded retry and no network dependencies
        let readyStatusData = false;
        for ( let attemptData = Number( 0 ); attemptData < Number( 60 ); attemptData++ ){
            try {
                const readyResponseData = await fetch( baseUrlData + '/' );
                readyStatusData = readyResponseData.status === Number( 200 );
                await readyResponseData.arrayBuffer();

            } catch( readinessError ){
                //Tolerating only startup connection failures while the child is still alive
                assert.ok( readinessError instanceof TypeError );
                assert.equal( caddyProcessData.exitCode, null );

            }
            if ( readyStatusData ){
                //Completing readiness after a real response
                break;

            }
            await timeoutWait( Number( 100 ) );

        }
        assert.equal( readyStatusData, true );

        //Verifying POST reuse while active and replacement before the backend's idle close deadline
        const firstPostData = await fetch( baseUrlData + '/api', {method: 'POST', body: '{}'} );
        assert.equal( firstPostData.status, 200 );
        const firstSocketData = await firstPostData.json();
        const secondPostData = await fetch( baseUrlData + '/api', {method: 'POST', body: '{}'} );
        assert.equal( secondPostData.status, 200 );
        assert.equal( (await secondPostData.json()).socket, firstSocketData.socket );
        await timeoutWait( 4400 );
        const resumedPostData = await fetch( baseUrlData + '/api', {method: 'POST', body: '{}'} );
        assert.equal( resumedPostData.status, 200 );
        assert.notEqual( (await resumedPostData.json()).socket, firstSocketData.socket );

        //Checking mutable update metadata on the real generated HTTPS site route
        for ( const metadataNameData of ['version.json', 'update.json'] ){
            for ( const methodData of ['GET', 'HEAD'] ){
                const metadataResponseData = await fetch( baseUrlData + '/_layer/' + metadataNameData,
                    {method: methodData, headers: {accept: 'text/html'}, redirect: 'manual'} );
                assert.equal( metadataResponseData.status, 200 );
                assert.equal( metadataResponseData.headers.get( 'content-type' ), 'application/json' );
                assert.equal( metadataResponseData.headers.get( 'cache-control' ), 'no-store' );
                await metadataResponseData.arrayBuffer();

            }
            await rm( path.join( fixtureDirectoryData, '_layer', metadataNameData ) );
            const missingMetadataResponseData = await fetch( baseUrlData + '/_layer/' + metadataNameData,
                {headers: {accept: 'text/html'}} );
            assert.equal( missingMetadataResponseData.status, 404 );

        }

        //Checking public association documents before navigation fallback on the HTTPS site's routing
        const associationPathsData = ['assetlinks.json', 'apple-app-site-association',
            'windows-app-web-link', 'web-app-origin-association'];
        for ( const associationNameData of associationPathsData ){
            for ( const requestMethodData of ['GET', 'HEAD'] ){
                //Using HTML Accept to detect accidental SPA fallback or document redirects
                const associationResponseData = await fetch( baseUrlData + '/.well-known/' + associationNameData,
                    {method: requestMethodData, headers: {accept: 'text/html'}, redirect: 'manual'} );
                assert.equal( associationResponseData.status, 200 );
                assert.equal( associationResponseData.headers.get( 'content-type' ), 'application/json' );
                assert.equal( associationResponseData.headers.get( 'cache-control' ), 'no-cache' );
                assert.equal( associationResponseData.headers.get( 'location' ), null );
                await associationResponseData.arrayBuffer();

            }
            //Checking missing documents against the same generated routes and existing index shell
            await rm( path.join( fixtureDirectoryData, '.well-known', associationNameData ) );
            const missingResponseData = await fetch( baseUrlData + '/.well-known/' + associationNameData,
                {headers: {accept: 'text/html'}, redirect: 'manual'} );
            assert.equal( missingResponseData.status, 404 );
            assert.doesNotMatch( await missingResponseData.text(), /caddy-fixture-marker/u );

        }

        //Checking GET and HEAD, encoded names, case variants and Windows environment aliases
        const privatePathsData = ['/.env', '/%2eenv', '/.ENV', '/.env/', '/.env%20', '/.env::$DATA',
            '/assets/.env', '/assets%2F.env', '/assets%5C.env', '/assets/settings.env',
            '/package.json', '/%70ackage.json', '/PACKAGE.JSON', '/package-lock.json',
            '/Caddyfile', '/node_modules', '/node_modules/private.txt', '/health/.env'];
        for ( const requestPathData of privatePathsData ){
            for ( const requestMethodData of ['GET', 'HEAD'] ){
                //Checking both public listeners without following HTTPS redirects
                for ( const portData of [httpsPortData.port, httpPortData.port] ){
                    const deniedResponseData = await fetch( 'http://127.0.0.1:' + Number( portData ) + requestPathData,
                        {method: requestMethodData, headers: {accept: 'text/html'}, redirect: 'manual'} );
                    assert.equal( deniedResponseData.status, 404, requestMethodData + ' ' + requestPathData );
                    assert.doesNotMatch( await deniedResponseData.text(), /caddy-fixture-marker/u );

                }

            }

        }

        //Checking the actual generated device header, not only its serialized source
        const publicResponseData = await fetch( baseUrlData + '/' );
        assert.equal( publicResponseData.headers.get( 'permissions-policy' ), 'camera=(), microphone=(self), geolocation=(self), payment=()' );
        assert.equal( await publicResponseData.text(), 'caddy-fixture-marker' );
        const redirectResponseData = await fetch( 'http://127.0.0.1:' + Number( httpPortData.port ) + '/', {redirect: 'manual'} );
        assert.equal( redirectResponseData.status, 301 );
        await redirectResponseData.arrayBuffer();

        //Triggering a real proxy failure with synthetic header and query secrets
        const errorResponseData = await fetch( baseUrlData + '/security-proxy-error?code=query-review-secret&custom=custom-review-secret', {
            headers: {authorization: 'Bearer authorization-review-secret', cookie: 'session=cookie-review-secret',
                'x-csrf-token': 'csrf-review-secret'}
        });
        assert.equal( errorResponseData.status, 502 );
        await errorResponseData.arrayBuffer();
        await timeoutWait( Number( 100 ) );
        const loggerEntriesData = loggerOutputData.trim().split( /\r?\n/u ).map( function( entrySourceData ){
            //Parsing the default structured logger; malformed output fails instead of hiding a missing error
            return JSON.parse( entrySourceData );

        });
        const errorEntriesData = loggerEntriesData.filter( function( entryData ){
            //Selecting the real HTTP error event produced by the failed proxy
            return entryData.logger === 'http.log.error';

        });
        assert.ok( errorEntriesData.length > Number( 0 ) );
        for ( const errorEntryData of errorEntriesData ){
            //Keeping useful error context while removing every request header and query value
            assert.equal( errorEntryData.request.headers, undefined );
            assert.equal( errorEntryData.request.uri, '/security-proxy-error' );
            assert.equal( errorEntryData.status, 502 );

        }
        assert.doesNotMatch( loggerOutputData, /authorization-review-secret|cookie-review-secret|csrf-review-secret|query-review-secret|custom-review-secret/u );

    } finally {
        //Terminating only the owned test child before filesystem cleanup
        caddyProcessData.kill();
        await processClosePromiseData;

    }

});
