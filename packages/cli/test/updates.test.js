import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {layerConfigValidate, layerConfigLoad, layerProjectBuild, layerProjectCreate} from '../src/index.js';

test('updates config is strict and new projects document independent UI disabling', async function(context){
    //Checking the real CLI boundary rather than only its shared PWA helper
    assert.deepEqual(layerConfigValidate({appName: 'example'}).updates, {enabled: true, ui: true, checkIntervalMs: 300000});
    for (const updates of [null, [], {ui: 'yes'}, {checkIntervalMs: 59999}, {unknown: true}]) {
        assert.throws(function(){
            //Rejecting unsupported configuration through the public CLI category
            layerConfigValidate({appName: 'example', updates});

        }, function(errorData){
            //Accepting only the safe configuration error
            return /** @type {any} */ (errorData).code === 'CLI_CONFIG_INVALID';

        });

    }
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'layer-updates-config-'));
    context.after(async function(){
        //Removing only this generated fixture
        await rm(temporaryRoot, {recursive: true, force: true});

    });
    await layerProjectCreate({targetDirectory: temporaryRoot, projectName: 'updates-config'});
    const configSource = await readFile(path.join(temporaryRoot, 'layer.config.js'), 'utf8');
    assert.match(configSource, /updates: \{/u);
    assert.match(configSource, /ui: false/u);

});

test('build identity is deterministic, changes without appVersion and verifies final descriptor bytes', async function(context){
    //Building only a disposable project, never a user application
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'layer-updates-build-'));
    context.after(async function(){
        //Removing only the known fixture root after all in-memory bundles finish
        await rm(temporaryRoot, {recursive: true, force: true});

    });
    await layerProjectCreate({targetDirectory: temporaryRoot, projectName: 'updates-build'});
    const config = await layerConfigLoad(temporaryRoot);
    const descriptors = [];
    for (let buildIndex = 0; buildIndex < 3; buildIndex++) {
        if (buildIndex === 2) {
            //Changing a public resource while retaining the exact application version
            const pageFile = path.join(temporaryRoot, 'src/pages/index.layer.js');
            const original = await readFile(pageFile, 'utf8');
            await writeFile(pageFile, original.replace('<h1>updates-build</h1>', '<h1>Changed public page</h1>'));

        }
        const build = await layerProjectBuild({rootDirectory: temporaryRoot, config});
        const descriptor = JSON.parse(await readFile(path.join(temporaryRoot, 'dist/_layer/update.json'), 'utf8'));
        const manifestBytes = await readFile(path.join(temporaryRoot, 'dist/_layer/version.json'));
        const legacy = JSON.parse(manifestBytes.toString('utf8'));
        assert.equal(descriptor.versionManifestHash, 'sha256-' + createHash('sha256').update(manifestBytes).digest('base64'));
        assert.match(descriptor.buildId, /^[a-f0-9]{64}$/u);
        assert.equal(legacy.appVersion, '0.1.0');
        assert.equal(legacy.buildId, undefined);
        assert.ok(build.integrity['_layer/update.json']);
        assert.equal(legacy.assets.some(function(/** @type {any} */ entry){
            //Mutable descriptors must not be pinned by the old offline cache
            return entry.url === '/_layer/update.json';

        }), false);
        const browser = await readFile(path.join(temporaryRoot, 'dist/_layer/application.mjs'), 'utf8');
        assert.equal(browser.includes('__LAYER_UPDATE_BUILD_ID__'), false);
        assert.ok(browser.includes(descriptor.buildId));
        descriptors.push(descriptor);

    }
    assert.equal(descriptors[0].buildId, descriptors[1].buildId);
    assert.notEqual(descriptors[1].buildId, descriptors[2].buildId);

});
