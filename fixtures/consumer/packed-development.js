import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {findPackageJSON} from 'node:module';
import {createServer} from 'node:net';
import {pathToFileURL} from 'node:url';

//Loading only the supplied installed CLI, without resolving framework modules through this fixture
const cliEntryData = process.argv[2];
const appDirectoryData = process.argv[3];
assert.ok( cliEntryData );
assert.ok( appDirectoryData );
const cliData = await import( pathToFileURL( cliEntryData ).href );

//Follow the consumer's resolved dependency chain, including npm's nested global layout.
const pathRead = function( /** @type {string} */ name, /** @type {string} */ parent ){
    const manifest = findPackageJSON( name, parent );
    assert.ok( manifest, 'Expected installed package ' + name );
    return manifest;

};
const authManifest = pathRead( '@solcorp/layer-auth', cliEntryData );
const providerManifest = pathRead( 'oidc-provider', authManifest );
const koaManifest = pathRead( 'koa', providerManifest );
const middleware = JSON.parse( await readFile( pathRead( 'koa-compose', koaManifest ), 'utf8' ) );
assert.notEqual( middleware.version, '4.2.0', 'This deprecated middleware release is incompatible with Koa 3.' );
const databaseManifest = pathRead( '@solcorp/layer-database', cliEntryData );
const driver = JSON.parse( await readFile( pathRead( 'pg', databaseManifest ), 'utf8' ) );
assert.equal( driver.version, JSON.parse( await readFile( databaseManifest, 'utf8' ) ).dependencies.pg );
const portServerData = createServer();
await new Promise(function( resolveData, rejectData ){
    //Allocating a temporary local development port without touching existing application servers
    portServerData.once( 'error', rejectData );
    portServerData.listen( 0, '127.0.0.1', function(){
        //Continuing only after the OS assigned a free port
        resolveData( undefined );

    });

});
const addressData = /** @type {import('node:net').AddressInfo} */ (portServerData.address());
await new Promise(function( resolveData, rejectData ){
    //Releasing the probe listener before the real Layer host binds that port
    portServerData.close(function( errorData ){
        //Propagating a failed probe shutdown before starting the application listener
        if ( errorData !== undefined ){
            rejectData( errorData );
            return;

        }

        resolveData( undefined );

    });

});
const configData = await cliData.layerConfigLoad( appDirectoryData );
const hostData = await cliData.layerDevelopmentHostCreate({rootDirectory: appDirectoryData,
    config: {...configData, development: {...configData.development, host: '127.0.0.1', port: addressData.port, https: false}}});

try {
    //Fetching the generated application and dev client from the installed host
    const pageData = await fetch( hostData.origin, {headers: {Accept: 'text/html'}, signal: AbortSignal.timeout( 10000 )} );
    assert.equal( pageData.status, 200 );
    const pageSourceData = await pageData.text();
    assert.ok( pageSourceData.includes( configData.appName ) );
    assert.ok( pageSourceData.includes( '/_layer/dev-client.mjs' ) );
    const clientData = await fetch( `${hostData.origin}/_layer/dev-client.mjs`, {signal: AbortSignal.timeout( 10000 )} );
    assert.equal( clientData.status, 200 );
    await clientData.text();

} finally {
    //Closing all owned watchers and sockets before the packed fixture is removed
    await hostData.close();

}
