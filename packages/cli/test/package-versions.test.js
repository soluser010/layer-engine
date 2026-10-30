import assert from 'node:assert/strict';
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';

test( 'generator versions follow installed metadata and reject incompatible compiler/runtime versions', async function(){
    //Simulating a coordinated next release without editing any installed framework package
    const directoryData = await mkdtemp( path.join( tmpdir(), 'layer-version-contract-' ) );
    const namesData = ['layer', 'layer-cli', 'layer-auth', 'layer-compiler', 'layer-database', 'layer-events',
        'layer-pwa', 'layer-render', 'layer-router', 'layer-runtime', 'layer-security', 'layer-server', 'layer-storage'];
    const nextVersionData = '0.2.7';

    try {
        await writeFile( path.join( directoryData, 'package.json' ), '{"private":true,"type":"module"}', 'utf8' );

        for ( const fileNameData of ['package-versions.js', 'project-create.js', 'cli-error.js'] ){
            await copyFile( new URL( `../src/${fileNameData}`, import.meta.url ), path.join( directoryData, fileNameData ) );

        }

        for ( const nameData of namesData ){
            const packageDirectoryData = path.join( directoryData, 'node_modules', '@solcorp', nameData );
            await mkdir( path.join( packageDirectoryData, 'src' ), {recursive: true} );
            await writeFile( path.join( packageDirectoryData, 'src', 'index.js' ), 'export {};\n', 'utf8' );
            await writeFile( path.join( packageDirectoryData, 'package.json' ), JSON.stringify({name: `@solcorp/${nameData}`,
                version: nextVersionData, type: 'module', exports: './src/index.js'}), 'utf8' );

        }

        const versionsData = await import( pathToFileURL( path.join( directoryData, 'package-versions.js' ) ).href );
        assert.deepEqual( versionsData.frameworkVersionsRead(), {runtimeVersion: nextVersionData, compilerVersion: nextVersionData} );
        const generatorData = await import( pathToFileURL( path.join( directoryData, 'project-create.js' ) ).href );
        const appDirectoryData = path.join( directoryData, 'app' );
        await generatorData.layerProjectCreate({targetDirectory: appDirectoryData, projectName: 'version-test'});
        const applicationManifestData = JSON.parse( await readFile( path.join( appDirectoryData, 'package.json' ), 'utf8' ) );
        assert.deepEqual( new Set( Object.values( applicationManifestData.dependencies ) ), new Set([nextVersionData]) );
        assert.equal( applicationManifestData.version, '0.1.0' );

        //A partially updated installation must fail with an actionable compatibility error
        const compilerManifestFileData = path.join( directoryData, 'node_modules', '@solcorp', 'layer-compiler', 'package.json' );
        const compilerManifestData = JSON.parse( await readFile( compilerManifestFileData, 'utf8' ) );
        await writeFile( compilerManifestFileData, JSON.stringify({...compilerManifestData, version: '0.2.8'}), 'utf8' );
        assert.throws( versionsData.frameworkVersionsRead, {code: 'CLI_FRAMEWORK_VERSION_MISMATCH'} );
        await writeFile( compilerManifestFileData, JSON.stringify({...compilerManifestData, version: 'latest'}), 'utf8' );
        assert.throws( versionsData.frameworkVersionsRead, {code: 'CLI_PACKAGE_VERSION_INVALID'} );

    } finally {
        //Removing only the fresh version-contract fixture created by this test
        assert.equal( path.dirname( directoryData ), path.resolve( tmpdir() ) );
        assert.ok( path.basename( directoryData ).startsWith( 'layer-version-contract-' ) );
        await rm( directoryData, {recursive: true, force: true} );

    }

});
