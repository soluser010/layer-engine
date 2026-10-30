import assert from 'node:assert/strict';
import {createHash, webcrypto} from 'node:crypto';
import test from 'node:test';
import {IDBFactory} from 'fake-indexeddb';
import {JSDOM} from 'jsdom';
import {layerUpdateWorkerCreate} from '../src/update-worker.js';
import {layerUpdateStoreCreate} from '../src/update-store.js';
import {layerApplicationUpdatesCreate, layerUpdateCardCreate, layerUpdateDescriptorValidate,
    layerUpdatesConfigurationCreate} from '../src/index.js';

const appKey = 'a'.repeat(64);
const oldBuild = '1'.repeat(64);
const newBuild = '2'.repeat(64);
/** @param {string} contentData */
const hash = function( contentData ){
    //Matching the public byte integrity contract independently from implementation helpers
    return 'sha256-' + createHash('sha256').update(contentData).digest('base64');

};
/** @param {Record<string, string>} [contents] */
const manifestCreate = function( contents = {'/_layer/shell.html': '<h1>Shell</h1>', '/asset.js': 'export default 1;'} ){
    //Keeping old and new application versions equal to exercise build-based discovery
    return {appVersion: '0.1.0', runtimeVersion: '0.1.0', compilerVersion: '0.1.0', protocolMin: 1, protocolMax: 1,
        schemaVersions: {engine: 1}, minVersion: null, rollbackVersion: null, offlineShellUrl: '/_layer/shell.html',
        assets: Object.entries(contents).map(function([url, content]){
            //Declaring only verified required resources
            return {url, hash: hash(content), required: true, policy: 'immutable'};

        })};

};
const cachesCreate = function(){
    //Providing native Response cloning semantics without filesystem or user caches
    const records = new Map();
    return {records, open: async function(/** @type {string} */ nameData){
        //Creating one isolated in-memory cache
        if (!records.has(nameData)) {
            records.set(nameData, new Map());

        }
        const entries = records.get(nameData);
        return {match: async function(/** @type {any} */ keyData){
            //Returning independent bodies like native Cache Storage
            let key = keyData;
            if (typeof keyData !== 'string') {
                key = new URL(keyData.url).pathname;

            }
            return entries.get(key)?.clone();

        }, put: async function(/** @type {string} */ keyData, /** @type {Response} */ responseData){
            //Keeping a reusable cached response body
            entries.set(keyData, responseData.clone());

        }};

    }, keys: async function(){
        //Returning only owned fixture cache names
        return [...records.keys()];

    }, delete: async function(/** @type {string} */ nameData){
        //Deleting an exact fixture cache, never application databases
        return records.delete(nameData);

    }};

};

test('updates configuration and descriptor reject typos and unsafe release identities', function(){
    //Checking safe defaults and unknown metadata without changing legacy manifest validation
    assert.deepEqual(layerUpdatesConfigurationCreate(undefined), {enabled: true, ui: true, checkIntervalMs: 300000});
    for (const input of [null, [], {extra: true}, {enabled: 'yes'}, {ui: 1}, {checkIntervalMs: 1}, {checkIntervalMs: Infinity}]) {
        assert.throws(function(){
            //Rejecting each unsupported configuration shape
            layerUpdatesConfigurationCreate(input);

        });

    }
    const descriptor = {protocol: 1, buildId: newBuild, versionManifestHash: hash('{}')};
    assert.deepEqual(layerUpdateDescriptorValidate(descriptor), descriptor);
    for (const input of [null, [], {}, {...descriptor, buildId: '../outside'}, {...descriptor, protocol: 2},
        {...descriptor, secret: true}, {...descriptor, versionManifestHash: 'not-a-hash'}]) {
        assert.throws(function(){
            //Rejecting descriptors before constructing cache or message identities
            layerUpdateDescriptorValidate(input);

        });

    }

});

test('build-aware worker keeps active caches, verifies reuse and commits preparation before activation', async function(){
    //Keeping cache, IndexedDB and client state isolated from the workstation
    const cacheStorage = cachesCreate();
    const indexedDb = new IDBFactory();
    const clients = /** @type {any[]} */ ([]);
    const broadcasts = /** @type {any[]} */ ([]);
    let fetched = 0;
    let fail = false;
    let skipped = 0;
    const contents = {'/_layer/shell.html': '<h1>Shell</h1>', '/asset.js': 'export default 1;'};
    const manifest = manifestCreate(contents);
    const options = {manifest, cacheStorage, indexedDb, applicationOrigin: 'https://app.example.com',
        scope: {clients: {matchAll: async function(){
            //Returning only fixture clients
            return clients;

        }, claim: async function(){
            //Modeling native ownership without application state changes

        }}, skipWaiting: async function(){
            //Recording explicit activation only
            skipped++;

        }}, assetFetchVerified: async function(/** @type {string} */ urlData){
            //Failing only the candidate build's requested resource
            fetched++;
            if (fail) {
                throw new Error('Fixture failure');

            }
            return new Response(contents[/** @type {keyof typeof contents} */ (urlData)]);

        }, verifyResponse: async function(/** @type {Response} */ responseData, /** @type {string} */ expected){
            //Detecting a damaged old cache instead of blindly trusting its URL
            assert.equal(hash(await responseData.clone().text()), expected);
            return responseData;

        }};
    const first = layerUpdateWorkerCreate({...options, deployment: {appKey, buildId: oldBuild, scope: '/'}});
    await first.install();
    await first.activate();
    await first.install();
    assert.equal(fetched, 2);
    const oldCache = cacheStorage.records.get(first.cacheName);
    oldCache.set('/asset.js', new Response('damaged'));
    clients.push({id: 'tab-one', url: 'https://app.example.com/chat?room=1#draft',
        postMessage: function(/** @type {any} */ messageData, /** @type {MessagePort[]} */ ports){
            //Separating progress broadcasts from save votes on dedicated ports
            broadcasts.push(messageData);
            ports?.[0]?.postMessage({buildId: newBuild, ready: false});

        }, navigate: async function(/** @type {string} */ urlData){
            //Retaining the entire URL across committed forced activation
            assert.equal(urlData, 'https://app.example.com/chat?room=1&__layer_update_build=' + newBuild + '#draft');

        }});
    const second = layerUpdateWorkerCreate({...options, deployment: {appKey, buildId: newBuild, scope: '/'}});
    await second.install();
    assert.equal(fetched, 3);
    assert.ok(cacheStorage.records.has(first.cacheName));
    assert.equal(broadcasts.at(-1).phase, 'ready');
    const source = clients[0];
    const request = {source, data: {type: 'layer-update-activate', appKey, buildId: newBuild, force: false}};
    assert.equal((await second.message(request)).code, 'PWA_UPDATE_CLIENTS_BUSY');
    assert.equal(skipped, 0);
    assert.equal((await second.message({...request, data: {...request.data, force: true}})).ok, true);
    await second.activate();
    assert.equal(skipped, 1);
    assert.ok(cacheStorage.records.has(first.cacheName));
    assert.equal((await second.message({...request, source: {id: 'outsider', url: 'https://foreign.example/'}})).ok, false);
    assert.equal((await second.message({...request, data: {...request.data, extra: true}})).ok, false);
    const metadata = layerUpdateStoreCreate(indexedDb, appKey);
    assert.equal((await metadata.get('head')).buildId, newBuild);
    assert.equal(await (await second.fetch(new Request('https://app.example.com/asset.js'), '')).text(), contents['/asset.js']);
    assert.equal(await second.fetch(new Request('https://app.example.com/_layer/update.json'), ''), null);
    fail = true;
    const broken = layerUpdateWorkerCreate({...options, deployment: {appKey, buildId: '3'.repeat(64), scope: '/'},
        manifest: manifestCreate({'/_layer/shell.html': 'changed'})});
    await assert.rejects(broken.install());
    assert.ok(cacheStorage.records.has(second.cacheName));
    assert.equal(cacheStorage.records.has(broken.cacheName), false);

});

test('application updates retain full state, subscriptions, dismissal and explicit force without automatic apply', async function(context){
    //Modeling native worker replies while retaining real DOM and event dispatch
    const dom = new JSDOM('<html lang="ru"><body><main id="app"><input id="draft"></main></body></html>',
        {url: 'https://app.example.com/'});
    context.after(function(){
        //Releasing the fixture document
        dom.window.close();

    });
    const browserWindow = /** @type {any} */ (dom.window);
    Object.defineProperty(browserWindow.crypto, 'subtle', {value: webcrypto.subtle});
    const container = new browserWindow.EventTarget();
    Object.defineProperty(browserWindow.navigator, 'serviceWorker', {value: container});
    const worker = new browserWindow.EventTarget();
    worker.state = 'installed';
    let applied = 0;
    let rejectApply = true;
    worker.postMessage = function(/** @type {any} */ data, /** @type {MessagePort[]} */ ports){
        //Replying on the exact port belonging to this request
        let response = {ok: true, appKey, buildId: newBuild, phase: 'ready', completedFiles: 2, totalFiles: 2};
        if (data.type === 'layer-update-activate') {
            if (rejectApply && !data.force) {
                response = /** @type {any} */ ({ok: false, code: 'PWA_UPDATE_CLIENTS_BUSY'});

            } else {
                applied++;

            }

        }
        ports[0]?.postMessage(response);

    };
    const registration = new browserWindow.EventTarget();
    registration.waiting = worker;
    registration.installing = registration.active = null;
    registration.update = async function(){
        //A native update job alone must not activate a prepared worker

    };
    const manifestText = JSON.stringify(manifestCreate());
    let corrupt = false;
    const controller = layerApplicationUpdatesCreate({window: browserWindow, registration, appKey,
        currentBuildId: oldBuild, currentVersion: '0.1.0', localStateSave: async function(){
            //No application credentials are required by this headless fixture

        }, fetchImplementation: async function(/** @type {any} */ urlData){
            //Returning the exact bytes whose digest appears in update.json
            if (urlData === '/_layer/update.json') {
                let hashInput = manifestText;
                if (corrupt) {
                    hashInput = 'different';

                }
                return new Response(JSON.stringify({protocol: 1, buildId: newBuild,
                    versionManifestHash: hash(hashInput)}));

            }
            return new Response(manifestText);

        }});
    context.after(function(){
        //Disposing timers, channels and native listeners after assertions
        controller.dispose();

    });
    const states = /** @type {any[]} */ ([]);
    const unsubscribe = controller.subscribe(function(stateData){
        //Retaining immutable snapshots rather than a shared mutable reference
        states.push(stateData);

    });
    assert.equal(states.length, 1);
    await controller.check();
    assert.equal(controller.getState().phase, 'ready');
    assert.equal(controller.getState().currentVersion, controller.getState().availableVersion);
    assert.equal(controller.getState().updateAvailable, true);
    assert.equal(applied, 0);
    const card = layerUpdateCardCreate({root: browserWindow.document.querySelector('#app'), controller,
        manifest: {name: '<unsafe>', short_name: 'AP', description: 'Fixture', lang: 'ru',
            background_color: 'rgb(255, 255, 255)', theme_color: 'rgb(0, 0, 0)', icons: []}});
    assert.equal(browserWindow.document.querySelector('[data-layer-update-card] strong').textContent, '<unsafe>');
    assert.equal(browserWindow.document.querySelector('[data-layer-update-card] unsafe'), null);
    controller.dismiss();
    await controller.check();
    assert.equal(controller.getState().visible, false);
    controller.show();
    await assert.rejects(controller.activate(), {code: 'PWA_UPDATE_CLIENTS_BUSY'});
    assert.equal(controller.getState().phase, 'blocked');
    rejectApply = false;
    await controller.activate({force: true});
    assert.equal(applied, 1);
    await assert.rejects(controller.activate(/** @type {any} */ ({force: 'yes'})), TypeError);
    corrupt = true;
    await assert.rejects(controller.check(), {code: 'PWA_UPDATE_DEPLOYMENT_MISMATCH'});
    assert.equal(Object.isFrozen(controller.getState()), true);
    unsubscribe();
    assert.equal(card.dispose(), true);
    assert.equal(card.dispose(), false);
    controller.dispose();
    await assert.rejects(controller.check(), TypeError);

});

test('update card covers dark branding, icons, progress and every explicit action without owning page focus', async function(context){
    //Driving presentation independently from network and native worker scheduling
    const dom = new JSDOM('<html lang="en"><body><main><input id="draft"></main></body></html>',
        {url: 'https://app.example.com/'});
    const window = /** @type {any} */ (dom.window);
    context.after(function(){
        //Closing this fixture document only
        dom.window.close();

    });
    const actions = /** @type {string[]} */ ([]);
    let subscriber = /** @type {any} */ (null);
    const state = /** @type {any} */ ({phase: 'downloading', visible: true, progress: null});
    const controller = {subscribe: function(/** @type {any} */ listener){
        //Giving the renderer the same immediate snapshot contract as the real controller
        subscriber = listener;
        listener(state);
        return function(){
            //Releasing only this renderer subscription
            subscriber = null;

        };

    }, activate: function(/** @type {any} */ options){
        //Recording force separately from the ordinary apply button
        let action = 'activate';
        if (options?.force) {
            action = 'force';

        }
        actions.push(action);

    }, dismiss: function(){
        //Recording the Later button
        actions.push('dismiss');

    }, check: function(){
        //Recording retry and the return from force confirmation
        actions.push('check');

    }};
    const root = window.document.querySelector('main');
    root.style.setProperty('--layer-update-radius', '20px');
    const card = layerUpdateCardCreate({root, controller, manifest: {name: 'Dark example',
        short_name: 'DE', background_color: '#111827', theme_color: '#5b21b6',
        icons: [{src: '/small.png', sizes: '32x32'}, {src: '/large.png', sizes: '192x192'},
            {src: '/icon.svg', sizes: 'any', type: 'image/svg+xml'}]}});
    const node = window.document.querySelector('[data-layer-update-card]');
    assert.equal(node.style.getPropertyValue('--layer-update-default-background'), 'rgb(17, 24, 39)');
    assert.equal(node.style.getPropertyValue('--layer-update-default-text'), 'rgb(255, 255, 255)');
    assert.equal(node.style.getPropertyValue('--layer-update-radius'), '20px');
    const image = node.querySelector('img');
    assert.equal(image.getAttribute('src'), '/icon.svg');
    image.dispatchEvent(new window.Event('load'));
    image.dispatchEvent(new window.Event('error'));
    assert.equal(node.querySelector('img'), null);
    for (const phase of ['ready', 'error', 'blocked', 'preparing', 'activating', 'verifying']) {
        //Keeping button handlers alive long enough to observe their promised actions
        Object.assign(state, {phase, progress: {completedFiles: 1, totalFiles: 2}});
        subscriber(state);
        for (const button of node.querySelectorAll('button')) {
            button.click();

        }
        await new Promise(function(resolve){
            //Flushing queued user actions without any arbitrary integration sleep
            setImmediate(resolve);

        });

    }
    assert.deepEqual(actions, ['activate', 'dismiss', 'check', 'dismiss', 'force', 'check']);
    assert.equal(node.querySelector('progress').value, 1);
    card.dispose();

});

test('window save hooks isolate callback failures and acknowledge scoped preparation on dedicated ports', async function(context){
    //Using real MessageChannels while suppressing automatic network checks
    const dom = new JSDOM('<body></body>', {url: 'https://app.example.com/'});
    const window = /** @type {any} */ (dom.window);
    const container = new window.EventTarget();
    const worker = new window.EventTarget();
    const registration = new window.EventTarget();
    worker.state = 'activated';
    registration.active = worker;
    registration.waiting = registration.installing = null;
    Object.defineProperty(window.navigator, 'serviceWorker', {value: container});
    let behavior = 'accept';
    let saved = 0;
    const errors = [];
    const controller = layerApplicationUpdatesCreate({window, registration, appKey, currentBuildId: oldBuild,
        currentVersion: '0.1.0', configuration: {enabled: false},
        fetchImplementation: async function(){
            //Disabled automatic checks must not use this transport
            throw new Error('Unexpected network request');

        }, beforeUpdate: function(){
            //Modeling application-owned refusal and a failed save hook
            if (behavior === 'throw') {
                throw new Error('Fixture hook failure');

            }
            return behavior !== 'refuse';

        }, localStateSave: async function(){
            //Recording engine persistence after an accepted application hook
            saved++;

        }, onError: function(errorData){
            //Keeping diagnostics observable without failing other subscribers
            errors.push(errorData);

        }});
    context.after(function(){
        //Releasing browser listeners and the disposable document
        controller.dispose();
        dom.window.close();

    });
    const unsubscribe = controller.subscribe(function(){
        //A broken consumer must not stop other state delivery
        throw new Error('Fixture subscriber failure');

    });
    controller.start();
    controller.start();
    assert.equal((await controller.check()).phase, 'unsupported');
    unsubscribe();
    for (const mode of ['accept', 'refuse', 'throw']) {
        behavior = mode;
        const channel = new MessageChannel();
        const acknowledgement = new Promise(function(resolve){
            //Observing only this request's channel response
            channel.port1.onmessage = function(eventData){
                //Returning one readiness vote
                resolve(eventData.data);

            };

        });
        const event = new window.Event('message');
        Object.assign(event, {source: worker, ports: [channel.port2],
            data: {type: 'layer-update-prepare', buildId: newBuild, appKey, force: false}});
        container.dispatchEvent(event);
        assert.equal(/** @type {any} */ (await acknowledgement).ready, mode === 'accept');
        channel.port1.close();
        channel.port2.close();

    }
    assert.equal(saved, 1);
    assert.ok(errors.length >= 2);
    assert.equal(controller.dispose(), true);
    assert.equal(controller.dispose(), false);

});
