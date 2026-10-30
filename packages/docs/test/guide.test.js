import assert from 'node:assert/strict';
import {request} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'node:test';
import {layerGuideServe} from '../src/index.js';
import {layerCliRun} from '../../cli/src/cli.js';

const executeData = promisify( execFile );

/** @param {string} originData @param {string} pathData @param {string} [hostData] */
const rawStatusRead = function( originData, pathData, hostData ){
    //Sending paths without URL normalization to verify the filesystem boundary
    return new Promise( function( resolveData, rejectedData ){
        const requestData = request( originData, {path: pathData, headers: {Host: hostData ?? new URL( originData ).host}}, function( responseData ){
            responseData.resume();
            responseData.on( 'end', function(){
                resolveData( responseData.statusCode );

            });

        });
        requestData.on( 'error', rejectedData );
        requestData.end();

    });

};

test( 'guide serves versioned offline pages and rejects non-document requests', async function(){
    const guideData = await layerGuideServe({lang: 'ru'});
    try {
        //Verifying both languages, local assets, search and safe response headers
        for ( const targetData of ['/ru/README.html', '/en/README.html', '/', '/assets/guide.css', '/assets/guide.js', '/ru/search.json'] ){
            const responseData = await fetch( guideData.origin + targetData );
            assert.equal( responseData.status, 200 );
            assert.equal( responseData.headers.get( 'x-content-type-options' ), 'nosniff' );
            assert.ok( responseData.headers.get( 'content-security-policy' )?.includes( "frame-ancestors 'none'" ) );
            assert.ok( (await responseData.text()).length > 20 );

        }
        const headData = await fetch( guideData.url, {method: 'HEAD'} );
        assert.equal( headData.status, 200 );
        assert.equal( await headData.text(), '' );
        assert.equal( (await fetch( guideData.url, {method: 'POST'} )).status, 403 );
        for ( const pathData of ['/../package.json', '/%2e%2e/package.json', '/.env', '/C:/secret', '/%5csecret', '/%00', '/%ZZ', '/missing.html', '/private.exe'] ){
            assert.equal( await rawStatusRead( guideData.origin, pathData ), 404 );

        }
        assert.equal( await rawStatusRead( guideData.origin, '/', 'evil.example' ), 403 );
        await assert.rejects( layerGuideServe({port: Number( new URL( guideData.origin ).port )}), {code: 'EADDRINUSE'} );

    } finally {
        //Ensuring repeated disposal never leaks a loopback server
        await guideData.close();
        await guideData.close();

    }
    await assert.rejects( fetch( guideData.url ) );
    await assert.rejects( layerGuideServe({lang: /** @type {any} */ ('xx')}), TypeError );
    await assert.rejects( layerGuideServe({port: -1}), TypeError );
    await assert.rejects( layerGuideServe({port: 65536}), TypeError );
    await assert.rejects( layerGuideServe({port: 1.5}), TypeError );

});

test( 'guide command works outside an application and light commands do not initialize passkeys', async function(){
    //Checking a real executable rather than suppressing warnings in the caller
    for ( const argumentData of ['--version', '--help'] ){
        const outputData = await executeData( process.execPath, ['packages/layer/src/bin.js', argumentData] );
        assert.equal( outputData.stderr, '' );
        assert.ok( outputData.stdout.length > 0 );

    }
    const outputItemsData = /** @type {string[]} */ ([]);
    const resultData = await layerCliRun({argv: ['guide', '--lang', 'ru'], write: function( outputData ){
        //Capturing the printed URL without opening a browser during tests
        outputItemsData.push( outputData );

    }});
    const hostData = /** @type {Awaited<ReturnType<typeof layerGuideServe>>} */ (resultData.result);
    try {
        assert.equal( resultData.command, 'guide' );
        assert.equal( outputItemsData[0], hostData.url );
        assert.ok( hostData.url.endsWith( '/ru/README.html' ) );

    } finally {
        await hostData.close();

    }
    const defaultData = await layerGuideServe();
    assert.ok( defaultData.url.endsWith( '/en/README.html' ) );
    await defaultData.close();
    await assert.rejects( layerCliRun({argv: ['guide', '--lang', 'fr']}), {code: 'CLI_ARGUMENT_UNKNOWN'} );
    await assert.rejects( layerCliRun({argv: ['guide', '--port', '80']}), {code: 'CLI_ARGUMENT_UNKNOWN'} );

});
