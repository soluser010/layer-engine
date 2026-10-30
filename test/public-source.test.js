import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';

const executeData = promisify( execFile );

test( 'public export copies reviewed source without application files or private Git history', async function(){
    //Using isolated repositories and synthetic secrets without touching configured remotes
    const temporaryDirectoryData = await mkdtemp( path.join( tmpdir(), 'layer-public-export-' ) );
    const sourceDirectoryData = path.join( temporaryDirectoryData, 'source' );
    const targetDirectoryData = path.join( temporaryDirectoryData, 'public' );
    const environmentData = {...process.env, GIT_CONFIG_GLOBAL: path.join( temporaryDirectoryData, 'empty-gitconfig' ), GIT_CONFIG_NOSYSTEM: '1'};
    /** @param {string} directoryData @param {string[]} argumentsData */
    const gitRun = async function( directoryData, argumentsData ){
        //Keeping fixture identity and hooks separate from the user's Git configuration
        return executeData( 'git', argumentsData, {cwd: directoryData, env: environmentData, windowsHide: true} );

    };
    try {
        for ( const directoryData of [sourceDirectoryData, targetDirectoryData] ){
            await mkdir( directoryData );
            await gitRun( directoryData, ['init', '-b', 'main'] );
            await gitRun( directoryData, ['config', 'user.name', 'Layer test'] );
            await gitRun( directoryData, ['config', 'user.email', 'test@example.test'] );
            await gitRun( directoryData, ['config', 'commit.gpgsign', 'false'] );
            await writeFile( path.join( directoryData, 'LICENSE' ), 'fixture license\n', 'utf8' );

        }
        await mkdir( path.join( sourceDirectoryData, 'scripts' ) );
        await copyFile( new URL( '../scripts/public-source-sync.js', import.meta.url ), path.join( sourceDirectoryData, 'scripts/public-source-sync.js' ) );
        await mkdir( path.join( sourceDirectoryData, 'apps/private-app' ), {recursive: true} );
        await writeFile( path.join( sourceDirectoryData, 'apps/private-app/private.txt' ), 'synthetic private application', 'utf8' );
        await writeFile( path.join( sourceDirectoryData, '.env' ), 'SYNTHETIC_TEST=excluded\n', 'utf8' );
        await writeFile( path.join( sourceDirectoryData, 'README.md' ), '# Public framework\n', 'utf8' );
        await writeFile( path.join( sourceDirectoryData, 'package.json' ), '{"type":"module"}\n', 'utf8' );
        await gitRun( sourceDirectoryData, ['add', '--', 'scripts', 'apps', '.env', 'README.md', 'LICENSE', 'package.json'] );
        await gitRun( sourceDirectoryData, ['commit', '-m', 'Private fixture'] );
        await gitRun( targetDirectoryData, ['add', '--', 'LICENSE'] );
        await gitRun( targetDirectoryData, ['commit', '-m', 'Public initial fixture'] );
        await gitRun( targetDirectoryData, ['remote', 'add', 'public', 'git@github.com:soluser010/layer-engine.git'] );
        const publicHeadData = (await gitRun( targetDirectoryData, ['rev-parse', 'HEAD'] )).stdout;
        const commandArgumentsData = [path.join( sourceDirectoryData, 'scripts/public-source-sync.js' ), targetDirectoryData];
        await executeData( process.execPath, commandArgumentsData, {env: environmentData, windowsHide: true} );
        assert.equal( await readFile( path.join( targetDirectoryData, 'README.md' ), 'utf8' ), '# Public framework\n' );
        await assert.rejects( readFile( path.join( targetDirectoryData, 'apps/private-app/private.txt' ) ), {code: 'ENOENT'} );
        await assert.rejects( readFile( path.join( targetDirectoryData, '.env' ) ), {code: 'ENOENT'} );
        assert.equal( (await gitRun( targetDirectoryData, ['rev-parse', 'HEAD'] )).stdout, publicHeadData );
        const inventoryData = JSON.parse( await readFile( path.join( targetDirectoryData, 'public-source.json' ), 'utf8' ) );
        assert.equal( inventoryData.files.length, 4 );
        assert.equal( inventoryData.sourceRevision, (await gitRun( sourceDirectoryData, ['rev-parse', 'HEAD'] )).stdout.trim() );
        await assert.rejects( executeData( process.execPath, commandArgumentsData, {env: environmentData, windowsHide: true} ), /pending changes/u );

    } finally {
        //Removing only the checked temporary fixture owned by this test
        assert.equal( path.dirname( temporaryDirectoryData ), path.resolve( tmpdir() ) );
        assert.ok( path.basename( temporaryDirectoryData ).startsWith( 'layer-public-export-' ) );
        await rm( temporaryDirectoryData, {recursive: true, force: true} );

    }

});
