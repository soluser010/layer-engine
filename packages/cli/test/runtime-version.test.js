import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {layerNodeVersionSupported} from '../src/runtime-version.js';


test( 'runtime floor accepts only patched stable Node 24 versions', function(){
    //Checking security-floor boundaries without permitting a future untested major
    for ( const versionData of ['24.22.1', '24.22.2', '24.23.0', '24.100.0'] ){
        assert.equal( layerNodeVersionSupported( versionData ), true, versionData );

    }

    //Rejecting malformed, old and prerelease runtimes without coercion
    for ( const versionData of ['24.12.0', '24.22.0', '22.23.4', '25.0.0', '26.12.1', '24', '24.022.1', '24.22.1-rc.1', '24.22.1+build', '24.22.1\n', '24.9007199254740992.0'] ){
        assert.equal( layerNodeVersionSupported( versionData ), false, versionData );

    }

});

test( 'CLI refuses an unpatched runtime before executing a command', function(){
    //Simulating process version only inside an isolated child, never in the test runner
    const childSourceData = `
        Object.defineProperty(process.versions, 'node', {value: '24.22.0'});
        const {layerCliRun} = await import('./packages/cli/src/cli.js');
        try {
            await layerCliRun({argv: ['version']});
            process.exitCode = 2;
        } catch (error) {
            if (error.code !== 'CLI_NODE_UNSUPPORTED' || !error.message.includes('24.22.1')) process.exitCode = 3;
        }
    `;
    const childResultData = spawnSync( process.execPath, ['--input-type=module', '--eval', childSourceData], {
        cwd: new URL( '../../../', import.meta.url ),
        encoding: 'utf8'
    });

    //Checking the stable diagnostic rather than accepting a loader or syntax failure
    assert.equal( childResultData.status, 0, childResultData.stderr );

});

test( 'deployment copies the same runtime gate into its integrity-owned files', async function(){
    //Checking that the standalone launcher can resolve the shared gate after copying only dist
    const sourceData = await readFile( new URL( '../src/deployment-bundle.js', import.meta.url ), 'utf8' );
    assert.match( sourceData, /'_layer\/deployment\/runtime-version\.js': runtimeVersionSource/ );
    assert.match( sourceData, /node: '>=24\.22\.1 <25'/ );

});
