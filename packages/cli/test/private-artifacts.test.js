import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {layerConfigValidate} from '../src/config.js';
import {layerDeploymentBundleCreate} from '../src/deployment-bundle.js';
import {layerDevelopmentRequestHandlerCreate} from '../src/development-host.js';
import {layerProjectBuild} from '../src/project-build.js';
import {layerProjectCreate} from '../src/project-create.js';
import {layerEnvironmentRequestPathCheck, layerPrivateArtifactRequestPathCheck} from '../src/private-artifacts.js';


/** @param {import('node:test').TestContext} testContext */
//Function for owning one isolated filesystem fixture through test completion
const securityFixtureDirectoryCreate = async function( testContext ){
    //Creating a unique fixture rather than reusing any developer application directory
    const fixtureDirectoryData = await mkdtemp( path.join( os.tmpdir(), 'layer-security-' ) );
    testContext.after( async function(){
        //Validating the exact created target before recursive cleanup on Windows
        const relativeFixturePathData = path.relative( os.tmpdir(), fixtureDirectoryData );
        assert.ok( relativeFixturePathData.startsWith( 'layer-security-' ) );
        assert.equal( relativeFixturePathData.includes( path.sep ), false );

        //Removing only the temporary fixture owned by this test
        await rm( fixtureDirectoryData, {recursive: true, force: true} );

    });

    //CallBack THE STRING
    return fixtureDirectoryData;

};

test( 'private artifact rules deny environment names at every depth and preserve public assets', function(){
    //Checking conventional dotenv names, extension names, encoded-path decoded values and Windows aliases
    const environmentPathsData = ['/.env', '/.ENV', '/.env.production.local', '/assets/.env',
        '/assets/nested/.env.local', '/settings/service.env', '/assets/service.env.backup',
        '/.env/', '/.env./', '/.env ', '/.env::$DATA', '/assets\\.env', '/.env/private.txt'];
    for ( const environmentPathData of environmentPathsData ){
        //Applying the same case-insensitive environment policy used by the generated Caddy matcher
        assert.equal( layerEnvironmentRequestPathCheck( environmentPathData ), true, environmentPathData );
        assert.equal( layerPrivateArtifactRequestPathCheck( environmentPathData ), true, environmentPathData );

    }

    //Checking deployment files, directories, declarations and maps independently from environment names
    const privatePathsData = ['/package.json', '/PACKAGE-LOCK.JSON', '/Caddyfile', '/node_modules',
        '/node_modules/package/index.js', '/_layer/deployment/run.mjs', '/_layer/server/application.mjs',
        '/_layer/server', '/_layer/types', '/_layer/styles.json', '/_layer/API.md',
        '/_layer/components/page.d.mts', '/_layer/layouts/layout.d.mts', '/nested/test.d.ts',
        '/bundle.MAP', '/assets/../package.json'];
    for ( const privatePathData of privatePathsData ){
        //Checking the bounded private-artifact contract before any file read
        assert.equal( layerPrivateArtifactRequestPathCheck( privatePathData ), true, privatePathData );

    }

    //Keeping runtime resources, public assets and protocol endpoints available
    const publicPathsData = ['/', '/index.html', '/_layer/shell.html', '/manifest.webmanifest',
        '/_layer/application.mjs', '/_layer/components/page.mjs', '/assets/environment.css',
        '/assets/envelope.svg', '/api', '/_layer/dev/events'];
    for ( const publicPathData of publicPathsData ){
        //Confirming that security filters do not replace ordinary navigation or API routing
        assert.equal( layerPrivateArtifactRequestPathCheck( publicPathData ), false, publicPathData );

    }

});

test( 'development denies GET and HEAD private files before proxy and navigation fallback', async function( testContext ){
    //Creating synthetic secrets without reading any actual environment file
    const fixtureDirectoryData = await securityFixtureDirectoryCreate( testContext );
    const privateFilesData = ['.env', '.env.production', 'assets/.env', 'assets/settings.env',
        'package.json', 'package-lock.json', 'Caddyfile', 'node_modules/private.txt'];
    for ( const privateFileData of privateFilesData ){
        //Writing only a marker so test failures cannot disclose credentials
        const fixtureFileData = path.join( fixtureDirectoryData, privateFileData );
        await mkdir( path.dirname( fixtureFileData ), {recursive: true} );
        await writeFile( fixtureFileData, 'private-review-marker', 'utf8' );

    }

    //Providing a real shell so a mistaken navigation fallback is observable
    await mkdir( path.join( fixtureDirectoryData, '_layer' ), {recursive: true} );
    await writeFile( path.join( fixtureDirectoryData, 'index.html' ), 'public-index-marker', 'utf8' );
    await writeFile( path.join( fixtureDirectoryData, '_layer/shell.html' ), 'public-shell-marker', 'utf8' );
    let proxyRequestCountData = Number( 0 );
    const requestHandlerData = layerDevelopmentRequestHandlerCreate({
        outputDirectory: fixtureDirectoryData,
        serverProxy: /** @type {any} */ ({
            requestHandle(){
                //Observing whether a protected request incorrectly crosses the backend boundary
                proxyRequestCountData++;

                //CallBack THE BOOLEAN
                return false;

            }
        })
    });
    const serverData = createServer( function( requestData, responseData ){
        //Serving the fixture through the real development security boundary
        void requestHandlerData( requestData, responseData );

    });
    testContext.after( async function(){
        //Closing only this test listener before its temporary directory is removed
        serverData.closeAllConnections();
        await new Promise( function( resolve, rejected ){
            //Propagating unexpected native close failures to the test runner
            serverData.close( function( serverCloseError ){
                if ( serverCloseError ){
                    //Passing the shutdown failure to the fixture owner
                    rejected( serverCloseError );

                    //Completing the failed close branch
                    return;

                }

                //Completing successful listener shutdown
                resolve( undefined );

            });

        });

    });
    await new Promise( function( resolve ){
        //Opening an ephemeral loopback listener without occupying a developer application port
        serverData.listen( 0, '127.0.0.1', function(){
            //Completing listener startup
            resolve( undefined );

        });

    });
    const serverAddressData = serverData.address();
    assert.ok( serverAddressData !== null && typeof serverAddressData === 'object' );
    const baseUrlData = 'http://127.0.0.1:' + Number( serverAddressData.port );
    const requestPathsData = [...privateFilesData.map( function( fileData ){
        //Preparing ordinary public URLs for the fixture files
        return '/' + String( fileData );

    }), '/%2eenv', '/assets/%2Eenv', '/assets%2f.env', '/assets%2f..%2f.env',
    '/.ENV', '/.env/', '/.env%20', '/.env::$DATA', '/health/.env', '/node_modules'];
    for ( const requestPathData of requestPathsData ){
        for ( const requestMethodData of ['GET', 'HEAD'] ){
            //Checking both file requests and navigations without following any redirect
            const responseData = await fetch( baseUrlData + requestPathData, {
                method: requestMethodData, headers: {accept: 'text/html'}, redirect: 'manual'
            });
            assert.equal( responseData.status, 404, requestMethodData + ' ' + requestPathData );
            assert.equal( await responseData.text(), String() );

        }

    }
    assert.equal( proxyRequestCountData, Number( 0 ) );

    //Checking the old default device policy and public navigation still work
    const publicResponseData = await fetch( baseUrlData + '/' );
    assert.equal( publicResponseData.status, 200 );
    assert.equal( publicResponseData.headers.get( 'permissions-policy' ), null );
    assert.equal( await publicResponseData.text(), 'public-index-marker' );

});

test( 'build excludes public environment files from dist and offline precache', async function( testContext ){
    //Creating a generated project only inside an owned temporary directory
    const fixtureDirectoryData = await securityFixtureDirectoryCreate( testContext );
    const projectDirectoryData = path.join( fixtureDirectoryData, 'security-project' );
    await layerProjectCreate( {targetDirectory: projectDirectoryData, projectName: 'security-project'} );
    const publicDirectoryData = path.join( projectDirectoryData, 'public' );
    const environmentFilesData = ['.env', '.env.local', 'assets/.env', 'assets/settings.env',
        'assets/nested/.ENV.production', 'assets/.env.directory/private.txt'];
    for ( const environmentFileData of environmentFilesData ){
        //Writing marker-only environment inputs to exercise copy and precache filtering
        const environmentInputFileData = path.join( publicDirectoryData, environmentFileData );
        await mkdir( path.dirname( environmentInputFileData ), {recursive: true} );
        await writeFile( environmentInputFileData, 'private-build-marker', 'utf8' );

    }
    await writeFile( path.join( publicDirectoryData, 'assets/public.txt' ), 'public-build-marker', 'utf8' );

    //Building through the normal atomic release path, including generated deployment artifacts
    const buildResultData = await layerProjectBuild({
        rootDirectory: projectDirectoryData, config: layerConfigValidate( {appName: 'security-project'} )
    });
    for ( const environmentFileData of environmentFilesData ){
        //Confirming no user environment source exists in the public release
        await assert.rejects( stat( path.join( buildResultData.outputDirectory, environmentFileData ) ), {code: 'ENOENT'} );

    }

    //Confirming public assets and the engine-owned non-secret deployment example remain intact
    assert.equal( await readFile( path.join( buildResultData.outputDirectory, 'assets/public.txt' ), 'utf8' ), 'public-build-marker' );
    const versionManifestData = /** @type {{assets: {url: string}[]}} */ (JSON.parse(
        await readFile( path.join( buildResultData.outputDirectory, '_layer/version.json' ), 'utf8' )
    ));
    assert.equal( versionManifestData.assets.some( function( assetData ){
        //Checking that every offline URL is outside the protected environment namespace
        return layerEnvironmentRequestPathCheck( assetData.url );

    }), false );
    const environmentExampleData = await readFile( path.join( buildResultData.outputDirectory, '.env.example' ), 'utf8' );
    assert.doesNotMatch( environmentExampleData, /private-build-marker/u );
    assert.equal( versionManifestData.assets.some( function( assetData ){
        //Checking that the ordinary public asset still participates in verified offline install
        return assetData.url === '/assets/public.txt';

    }), true );

});

test( 'Caddy generation denies private files before proxy fallback and filters request secrets', async function(){
    //Generating the production contract without installing dependencies or executing an application
    const deploymentArtifactsData = await layerDeploymentBundleCreate({
        rootDirectory: process.cwd(), sourceDirectory: process.cwd(), dryRun: true,
        config: layerConfigValidate( {appName: 'security-contract'} )
    });
    const caddyfileData = String( deploymentArtifactsData.Caddyfile );

    //Checking matcher wiring in both HTTP redirect and HTTPS file-serving sites
    assert.equal( caddyfileData.match( /respond @layerEnvironment 404/gu )?.length, Number( 2 ) );
    assert.equal( caddyfileData.match( /respond @layerPrivate 404/gu )?.length, Number( 2 ) );
    assert.match( caddyfileData, /request>headers delete/u );
    assert.match( caddyfileData, /request>uri regexp "\[\?\]\.\*\$" ""/u );
    assert.match( caddyfileData, /@layerPrivate path .*\/package.json .*\/node_modules/u );
    assert.ok( caddyfileData.indexOf( 'respond @layerEnvironment 404' ) < caddyfileData.indexOf( 'redir https://' ) );

});
