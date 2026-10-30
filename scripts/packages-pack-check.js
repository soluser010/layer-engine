import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {packRegistryCreate} from './pack-registry.js';

const executeFile = promisify( execFile );
const rootDirectoryData = path.resolve( '.' );
const npmFileData = process.env.npm_execpath;
const candidateStatusData = process.argv.includes( '--candidate' );
let sourceRevisionData = '';

if ( npmFileData === undefined ){
    throw new Error( 'npm_execpath is required to check packed consumers.' );

}

/** @param {string[]} argumentsData @param {string} directoryData @param {Record<string, string>} [environmentData] */
const commandRun = async function( argumentsData, directoryData, environmentData = {} ){
    //Keeping npm asynchronous so the isolated loopback registry can answer dependency requests
    const executionData = await executeFile( process.execPath, argumentsData, {
        cwd: directoryData, timeout: 300000, maxBuffer: 8 * 1024 * 1024,
        env: {...process.env, NODE_PATH: '', ...environmentData}, windowsHide: true
    });

    return executionData.stdout;

};

/** @param {any} manifestData @param {{path: string}[]} filesData */
const exportsAssert = function( manifestData, filesData ){
    //Inspecting every advertised module, declaration and executable in the actual archive
    const pathsData = new Set( filesData.map(function( fileData ){
        //Comparing public export paths with npm's packed file inventory
        return fileData.path;

    }) );
    assert.ok( pathsData.has( 'LICENSE' ), `${manifestData.name} archive must contain LICENSE` );

    for ( const [subpathData, targetData] of Object.entries( manifestData.exports ) ){
        const targetsData = /** @type {{import?: string, types?: string}} */ (targetData);

        for ( const targetPathData of [targetsData.import, targetsData.types] ){
            assert.equal( typeof targetPathData, 'string', `${manifestData.name}${subpathData} requires ESM and declarations` );
            assert.ok( pathsData.has( String( targetPathData ).replace( /^\.\//u, '' ) ), `${manifestData.name} misses ${targetPathData}` );

        }

    }

    for ( const executableData of Object.values( manifestData.bin ?? {} ) ){
        assert.ok( pathsData.has( String( executableData ).replace( /^\.\//u, '' ) ), `${manifestData.name} misses its CLI executable` );

    }

};

//Building declarations before packaging; installation below has no path back to workspace packages
if ( candidateStatusData ){
    const statusData = await executeFile( 'git', ['status', '--porcelain'], {cwd: rootDirectoryData, windowsHide: true} );
    assert.equal( statusData.stdout.trim(), '', 'Candidate packaging requires a clean checkout.' );
    sourceRevisionData = (await executeFile( 'git', ['rev-parse', 'HEAD'], {cwd: rootDirectoryData, windowsHide: true} )).stdout.trim();

}

await commandRun( [npmFileData, 'run', 'build'], rootDirectoryData );
const temporaryDirectoryData = await mkdtemp( path.join( tmpdir(), 'layer-packed-consumer-' ) );
const archiveDirectoryData = path.join( temporaryDirectoryData, 'archives' );
await mkdir( archiveDirectoryData );
const packagesData = /** @type {{manifest: any, filename: string, shasum: string, integrity: string}[]} */ ([]);
let registryData = /** @type {Awaited<ReturnType<typeof packRegistryCreate>> | null} */ (null);

try {
    const packageDirectoriesData = await readdir( path.join( rootDirectoryData, 'packages' ), {withFileTypes: true} );
    const licenseData = await readFile( path.join( rootDirectoryData, 'LICENSE' ), 'utf8' );

    for ( const packageDirectoryData of packageDirectoriesData ){
        if ( packageDirectoryData.isDirectory() === false ){
            continue;

        }

        const directoryData = path.join( rootDirectoryData, 'packages', packageDirectoryData.name );
        const manifestData = JSON.parse( await readFile( path.join( directoryData, 'package.json' ), 'utf8' ) );

        if ( manifestData.private === true ){
            continue;

        }

        assert.equal( await readFile( path.join( directoryData, 'LICENSE' ), 'utf8' ), licenseData );
        const packSourceData = await commandRun( [npmFileData, 'pack', '--json', '--ignore-scripts', '--workspace',
            manifestData.name, '--pack-destination', archiveDirectoryData], rootDirectoryData );
        const packData = JSON.parse( packSourceData )[0];
        exportsAssert( manifestData, packData.files );
        packagesData.push({manifest: manifestData, filename: packData.filename, shasum: packData.shasum, integrity: packData.integrity});

    }

    registryData = await packRegistryCreate( packagesData, archiveDirectoryData );
    const userConfigFileData = path.join( temporaryDirectoryData, 'npmrc' );
    await writeFile( userConfigFileData, `@solcorp:registry=${registryData.origin}\nregistry=https://registry.npmjs.org/\n`, 'utf8' );
    const npmEnvironmentData = {npm_config_userconfig: userConfigFileData, npm_config_cache: path.join( rootDirectoryData, '.npm-cache' )};
    const installArgumentsData = ['--ignore-scripts', '--no-audit', '--no-fund'];
    const prefixDirectoryData = path.join( temporaryDirectoryData, 'global' );
    const cliPackageData = packagesData.find(function( packageData ){
        //Installing only the complete framework, proving every tool is a declared dependency
        return packageData.manifest.name === '@solcorp/layer';

    });
    assert.ok( cliPackageData );
    const cliVersionData = cliPackageData.manifest.version;

    //Proving the global CLI's declared dependencies supply its complete authoring runtime
    await commandRun( [npmFileData, 'install', '--global', '--prefix', prefixDirectoryData,
        ...installArgumentsData, `@solcorp/layer@${cliVersionData}`], temporaryDirectoryData, npmEnvironmentData );
    let globalModulesDirectoryData = path.join( prefixDirectoryData, 'lib', 'node_modules' );

    if ( process.platform === 'win32' ){
        globalModulesDirectoryData = path.join( prefixDirectoryData, 'node_modules' );

    }

    const globalBinData = path.join( globalModulesDirectoryData, '@solcorp', 'layer', 'src', 'bin.js' );
    const globalCliEntryData = path.join( globalModulesDirectoryData, '@solcorp', 'layer', 'node_modules', '@solcorp', 'layer-cli', 'src', 'index.js' );
    let globalShimData = path.join( prefixDirectoryData, 'bin', 'layer' );

    if ( process.platform === 'win32' ){
        globalShimData = path.join( prefixDirectoryData, 'layer.cmd' );

    }

    assert.ok( await lstat( globalShimData ) );
    await commandRun( [globalBinData, 'create', 'global-smoke'], temporaryDirectoryData, npmEnvironmentData );
    const globalAppDirectoryData = path.join( temporaryDirectoryData, 'apps', 'global-smoke' );
    await commandRun( [globalBinData, 'build'], globalAppDirectoryData, npmEnvironmentData );
    assert.ok( (await readFile( path.join( globalAppDirectoryData, 'dist', 'index.html' ), 'utf8' )).includes( 'global-smoke' ) );
    const developmentFixtureData = path.join( rootDirectoryData, 'fixtures', 'consumer', 'packed-development.js' );
    await commandRun( [developmentFixtureData, globalCliEntryData, globalAppDirectoryData], temporaryDirectoryData, npmEnvironmentData );

    //Installing only the facade must supply all framework packages and the local CLI
    const consumerDirectoryData = path.join( temporaryDirectoryData, 'consumer' );
    await mkdir( consumerDirectoryData );
    await writeFile( path.join( consumerDirectoryData, 'package.json' ), JSON.stringify({name: 'layer-packed-consumer', private: true, type: 'module'}), 'utf8' );
    const packageArgumentsData = [`@solcorp/layer@${cliVersionData}`];
    const rootManifestData = JSON.parse( await readFile( path.join( rootDirectoryData, 'package.json' ), 'utf8' ) );
    await commandRun( [npmFileData, 'install', ...installArgumentsData, ...packageArgumentsData,
        `@types/node@${rootManifestData.devDependencies['@types/node']}`], consumerDirectoryData, npmEnvironmentData );
    const importLinesData = ['import assert from \'node:assert/strict\';', 'import {realpathSync} from \'node:fs\';',
        'import {fileURLToPath} from \'node:url\';', 'import path from \'node:path\';'];
    const typeLinesData = [];
    let importIndexData = 0;

    for ( const packageData of packagesData ){
        const packageNameData = packageData.manifest.name;
        assert.equal( (await lstat( path.join( consumerDirectoryData, 'node_modules', packageNameData ) )).isSymbolicLink(), false );

        for ( const subpathData of Object.keys( packageData.manifest.exports ) ){
            let importNameData = packageNameData;

            if ( subpathData !== '.' ){
                importNameData += subpathData.slice( 1 );

            }

            importLinesData.push( `await import(${JSON.stringify( importNameData )});`,
                `assert.ok(realpathSync(fileURLToPath(import.meta.resolve(${JSON.stringify( importNameData )}))).startsWith(path.join(process.cwd(), 'node_modules') + path.sep));` );
            typeLinesData.push( `import * as module${importIndexData} from ${JSON.stringify( importNameData )};`, `void module${importIndexData};` );
            importIndexData += 1;

        }

    }

    await writeFile( path.join( consumerDirectoryData, 'consumer.mjs' ), importLinesData.join( '\n' ), 'utf8' );
    await writeFile( path.join( consumerDirectoryData, 'consumer.ts' ), typeLinesData.join( '\n' ), 'utf8' );
    await writeFile( path.join( consumerDirectoryData, 'tsconfig.json' ), JSON.stringify({compilerOptions: {
        noEmit: true, strict: true, skipLibCheck: false, module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2024',
        lib: ['ES2024', 'DOM', 'DOM.Iterable'], types: ['node']
    }, include: ['consumer.ts']}), 'utf8' );
    await commandRun( [path.join( consumerDirectoryData, 'consumer.mjs' )], consumerDirectoryData );
    const typescriptBinData = fileURLToPath( new URL( '../bin/tsc', import.meta.resolve( 'typescript' ) ) );
    await commandRun( [typescriptBinData, '-p', path.join( consumerDirectoryData, 'tsconfig.json' )], consumerDirectoryData );
    const localBinData = path.join( consumerDirectoryData, 'node_modules', '@solcorp', 'layer', 'src', 'bin.js' );
    await commandRun( [npmFileData, 'exec', '--offline', '--', 'layer', '--version'], consumerDirectoryData, npmEnvironmentData );
    await commandRun( [localBinData, 'create', 'local-smoke'], consumerDirectoryData, npmEnvironmentData );
    const localAppDirectoryData = path.join( consumerDirectoryData, 'apps', 'local-smoke' );
    const generatedPackageData = JSON.parse( await readFile( path.join( localAppDirectoryData, 'package.json' ), 'utf8' ) );
    assert.deepEqual( generatedPackageData.dependencies, {'@solcorp/layer': cliVersionData} );
    await commandRun( [npmFileData, 'install', ...installArgumentsData], localAppDirectoryData, npmEnvironmentData );
    await commandRun( [npmFileData, 'run', 'build'], localAppDirectoryData, npmEnvironmentData );
    assert.ok( (await readFile( path.join( localAppDirectoryData, 'dist', 'index.html' ), 'utf8' )).includes( 'local-smoke' ) );
    const installedLocalEntryData = path.join( localAppDirectoryData, 'node_modules', '@solcorp', 'layer-cli', 'src', 'index.js' );
    await commandRun( [developmentFixtureData, installedLocalEntryData, localAppDirectoryData], localAppDirectoryData, npmEnvironmentData );
    //Checking that the installed documentation works without a source checkout or internet
    await commandRun( [path.join( rootDirectoryData, 'fixtures/consumer/packed-guide.js' ),
        path.join( consumerDirectoryData, 'node_modules/@solcorp/layer-docs/src/index.js' )], consumerDirectoryData );
    console.log( `Packed consumer check passed: ${packagesData.length} packages, ${importIndexData} ESM/type exports, isolated global and project-local CLI create/build/dev.` );

    if ( candidateStatusData ){
        //Retaining the exact archives just installed and checked, only from an unchanged clean commit
        const statusData = await executeFile( 'git', ['status', '--porcelain'], {cwd: rootDirectoryData, windowsHide: true} );
        const revisionData = (await executeFile( 'git', ['rev-parse', 'HEAD'], {cwd: rootDirectoryData, windowsHide: true} )).stdout.trim();
        assert.equal( statusData.stdout.trim(), '' );
        assert.equal( revisionData, sourceRevisionData );
        const candidateDirectoryData = path.join( rootDirectoryData, 'artifacts', 'candidates', `${sourceRevisionData}-${Date.now()}` );
        const stagingDirectoryData = `${candidateDirectoryData}.preparing`;
        await mkdir( stagingDirectoryData, {recursive: true} );
        const archiveReportsData = [];

        for ( const packageData of packagesData ){
            const archiveFileData = path.join( archiveDirectoryData, packageData.filename );
            const archiveContentData = await readFile( archiveFileData );
            await copyFile( archiveFileData, path.join( stagingDirectoryData, packageData.filename ) );
            archiveReportsData.push({name: packageData.manifest.name, version: packageData.manifest.version,
                file: packageData.filename, sha256: createHash( 'sha256' ).update( archiveContentData ).digest( 'hex' ),
                integrity: packageData.integrity});

        }

        await writeFile( path.join( stagingDirectoryData, 'candidate.json' ), JSON.stringify({sourceRevision: sourceRevisionData,
            published: false, signed: false, platform: process.platform, architecture: process.arch, node: process.version,
            verified: ['packed-exports', 'licenses', 'isolated-esm', 'strict-types', 'global-cli', 'local-cli', 'create-build-dev'],
            packages: archiveReportsData}, null, 4) + '\n', 'utf8' );
        await rename( stagingDirectoryData, candidateDirectoryData );
        console.log( `Unpublished candidate: ${candidateDirectoryData}` );

    }

} finally {
    //Closing the registry before removing the exact mkdtemp directory owned by this gate
    await registryData?.close();
    assert.equal( path.dirname( temporaryDirectoryData ), path.resolve( tmpdir() ) );
    assert.ok( path.basename( temporaryDirectoryData ).startsWith( 'layer-packed-consumer-' ) );
    await rm( temporaryDirectoryData, {recursive: true, force: true, maxRetries: 4, retryDelay: 250} );

}
