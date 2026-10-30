import assert from 'node:assert/strict';
import {copyFile, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {layerConfigLoad, layerConfigValidate, layerProjectBuild, layerProjectCreate} from '@solcorp/layer-cli';

//Creating disposable source through the same generator used by application developers
const retainedDirectoryData = process.argv[2];
const temporaryDirectoryData = await mkdtemp( path.join( os.tmpdir(), 'layer-preview-' ) );
let projectDirectoryData = path.join( temporaryDirectoryData, 'application' );

if ( retainedDirectoryData !== undefined ){
    //Retaining an explicitly requested CI fixture while the generator rejects existing content
    projectDirectoryData = path.resolve( retainedDirectoryData );

}

try {
    //Generating the minimal project without relying on any checked-in application
    await layerProjectCreate({targetDirectory: projectDirectoryData, projectName: 'production-fixture'});
    await copyFile( new URL( '../browser-tests/fixtures/production.layer.js', import.meta.url ),
        path.join( projectDirectoryData, 'src/pages/index.layer.js' ) );
    const secondPageSourceData = await readFile( new URL( '../browser-tests/fixtures/production.layer.js', import.meta.url ), 'utf8' );
    await writeFile( path.join( projectDirectoryData, 'src/pages/second.layer.js' ),
        secondPageSourceData.replace( 'Production fixture</h1>', 'Second fixture</h1>' ), 'utf8' );

    //Building a complete portable bundle with a local TLS domain for the CI launcher
    const configurationData = await layerConfigLoad( projectDirectoryData );
    const buildResultData = await layerProjectBuild({
        rootDirectory: projectDirectoryData,
        config: layerConfigValidate({...configurationData, deployment: {...configurationData.deployment, domain: 'localhost'}})
    });
    assert.equal( buildResultData.routes.length, 2 );
    assert.ok( buildResultData.artifacts.length >= 10 );

    for ( const routeData of buildResultData.routes ){
        //Retaining explicit SSR and offline navigation contracts in the generated preview
        assert.equal( routeData.auth, 'none' );
        assert.equal( routeData.offline, 'shell' );

    }

    process.stdout.write( JSON.stringify({appName: configurationData.appName,
        routeCount: buildResultData.routes.length, artifactCount: buildResultData.artifacts.length}) + '\n' );

} finally {
    //Deleting only the exact temporary directory owned by this invocation
    assert.equal( path.dirname( temporaryDirectoryData ), path.resolve( os.tmpdir() ) );
    assert.ok( path.basename( temporaryDirectoryData ).startsWith( 'layer-preview-' ) );
    await rm( temporaryDirectoryData, {recursive: true, force: true, maxRetries: 4, retryDelay: 250} );

}
