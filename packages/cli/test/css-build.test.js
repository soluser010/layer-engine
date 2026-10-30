import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {layerStylesheetCompile} from '@solcorp/layer-compiler';
import {layerConfigValidate, layerProjectBuild, layerProjectCreate, layerConfigLoad} from '../src/index.js';
import {layerCssConfigurationCreate, layerCssBuild} from '../src/css-build.js';


test( 'CSS config validates explicit immutable browser floors', function(){
    //Checking defaults, strict fields and versions independently of the installed browser
    assert.equal( layerConfigValidate({appName: 'css-app'}).css.targets.safari, '16.4' );
    const configurationData = layerCssConfigurationCreate({targets: {safari: '15.2.1'}});
    assert.deepEqual( configurationData.targets, {safari: '15.2.1'} );
    assert.ok( Object.isFrozen( configurationData.targets ) );
    for ( const invalidData of [null, [], new Date(), {minify: false}, {targets: null}, {targets: {}},
        {targets: {safari: 16}}, {targets: {ie: '11'}}, {targets: {safari: '16\n'}},
        {targets: {safari: '256'}}, {targets: {safari: 'latest'}}, {targets: {safari: '16.04'}}] ){
        assert.throws(function(){
            //Rejecting ambiguous targets rather than silently compiling without compatibility
            layerCssConfigurationCreate( invalidData );

        }, {code: 'CLI_CONFIG_INVALID'} );

    }

});

test( 'CSS optimization prefixes, lowers nesting and media ranges, and minifies values', function(){
    //Using older explicit targets to require observable compilation rather than relying on defaults
    const configurationData = layerCssConfigurationCreate({targets: {safari: '13', chrome: '80'}});
    const sourceData = '.panel { user-select: none; padding: 0px 0px 0px 0px; color: rgb(255, 0, 0); & > .child { width: calc(10px * 2); } } @media (width >= 600px) { .panel { display: block; } }';
    const resultData = layerCssBuild( sourceData, 'example.css', configurationData );
    assert.match( resultData, /-webkit-user-select:none/ );
    assert.match( resultData, /padding:0[;}]/ );
    assert.match( resultData, /color:red/ );
    assert.match( resultData, /\.panel>\.child\{width:20px/ );
    assert.match( resultData, /min-width:600px/ );
    assert.doesNotMatch( resultData, /&|width\s*>=/ );
    assert.ok( resultData.length < sourceData.length );
    assert.equal( layerCssBuild( sourceData, 'example.css', configurationData ), resultData );
    //A modern Chrome-only target must not inherit the Safari compatibility prefixes
    const modernData = layerCssBuild( sourceData, 'example.css', layerCssConfigurationCreate({targets: {chrome: '140'}}) );
    assert.doesNotMatch( modernData, /-webkit-user-select/ );
    assert.notEqual( modernData, resultData );

});

test( 'CSS optimization preserves Layer scope, module names, globals and asset URLs', function(){
    //Running the real Layer pass before browser lowering to protect ownership and class maps
    const intermediateData = layerStylesheetCompile('.panel { background:url(./icon.svg); & > .child { color:red } } :global(body) { margin:0 }', {
        scopeIdentifier: 'test-scope', modules: true, assetUrlMap: {'./icon.svg': '/_layer/assets/icon.svg'}
    });
    const resultData = layerCssBuild( intermediateData.css, 'component.css', layerCssConfigurationCreate({targets: {safari: '13'}}) );
    assert.ok( resultData.includes( String(/** @type {Record<string, string>} */ (intermediateData.classes).panel) ) );
    assert.match( resultData, /data-layer-scope=test-scope/ );
    assert.match( resultData, /body\{margin:0/ );
    assert.match( resultData, /\/_layer\/assets\/icon.svg/ );
    assert.doesNotMatch( resultData, /:global|&/ );

});

test( 'invalid CSS reports safe coordinates without a source excerpt', function(){
    //Checking the build boundary instead of leaking a native parser stack or complete CSS source
    assert.throws(function(){
        //Feeding a malformed function value through the real native CSS parser
        layerCssBuild( '.private { color: rgb( }', 'public/broken.css', layerCssConfigurationCreate() );

    }, function( errorData ){
        const failureData = /** @type {import('../src/cli-error.js').LayerCliError} */ (errorData);
        assert.equal( failureData.code, 'CLI_BUILD_CSS_INVALID' );
        assert.equal( failureData.details?.file, 'public/broken.css' );
        assert.equal( typeof failureData.details?.line, 'number' );
        assert.doesNotMatch( JSON.stringify(failureData.details), /private|stack/ );
        return true;

    });

});

test( 'dev and production CSS use identical optimization and final-byte integrity', async function( testContext ){
    //Building an isolated generated app without modifying any user application
    const directoryData = await mkdtemp( path.join(os.tmpdir(), 'layer-css-build-') );
    testContext.after(async function(){
        //Removing only the temporary fixture owned by this test
        await rm( directoryData, {recursive: true, force: true} );

    });
    await layerProjectCreate({targetDirectory: directoryData, projectName: 'css-test'});
    await mkdir( path.join(directoryData, 'public/assets'), {recursive: true} );
    const sourceData = '.public { user-select: none; color: rgb(255, 0, 0); }';
    await writeFile( path.join(directoryData, 'public/assets/example.css'), sourceData );
    await writeFile( path.join(directoryData, 'public/extra.css'), sourceData );
    const configurationData = await layerConfigLoad( directoryData );
    const cssFilesData = /** @type {string[]} */ ([]);
    for ( const modeData of /** @type {const} */ (['development', 'production']) ){
        const buildData = await layerProjectBuild({rootDirectory: directoryData, config: configurationData, mode: modeData});
        const outputData = await readFile( path.join(directoryData, 'dist/assets/example.css'), 'utf8' );
        cssFilesData.push( outputData );
        assert.match( outputData, /-webkit-user-select:none/ );
        assert.ok( outputData.length < sourceData.length + 25 );
        assert.equal( await readFile(path.join(directoryData, 'dist/extra.css'), 'utf8'), outputData );
        const versionData = JSON.parse( await readFile(path.join(directoryData, 'dist/_layer/version.json'), 'utf8') );
        assert.equal( versionData.assets.find(function( /** @type {{url: string}} */ assetData ){
            //Comparing the offline hash with actual emitted bytes
            return assetData.url === '/assets/example.css';

        }).hash, 'sha256-' + createHash('sha256').update(outputData).digest('base64') );
        assert.equal( buildData.integrity['extra.css'], 'sha256-' + createHash('sha256').update(outputData).digest('hex') );

    }
    assert.equal( cssFilesData[0], cssFilesData[1] );
    assert.equal( await readFile(path.join(directoryData, 'public/assets/example.css'), 'utf8'), sourceData );
    //Failing a subsequent build must leave the complete previous output untouched
    await writeFile( path.join(directoryData, 'public/extra.css'), '.broken { color: rgb( }' );
    await assert.rejects( layerProjectBuild({rootDirectory: directoryData, config: configurationData}), {code: 'CLI_BUILD_CSS_INVALID'} );
    assert.equal( await readFile(path.join(directoryData, 'dist/extra.css'), 'utf8'), cssFilesData[0] );

});
