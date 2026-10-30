import assert from 'node:assert/strict';
import test from 'node:test';
import {webcrypto} from 'node:crypto';
import {layerNavigationHandoff} from '../src/navigation-handoff.js';
import {layerServiceWorkerRuntimeCreate} from '../src/service-worker.js';

const appKey = 'a'.repeat(64);
const url = 'https://example.com/app/one/?q=1#draft';

test('notification handoff accepts only a matching reply and bounds an unavailable client', async function(){
    //Keeping each acknowledgement on its own native MessageChannel
    for (const mode of ['accept', 'deny', 'foreign', 'silent', 'closed', 'legacy']) {
        const client = /** @type {any} */ ({});
        if (mode !== 'legacy') {
            client.postMessage = function(/** @type {any} */ request, /** @type {MessagePort[]} */ ports){
                //Modeling a stopped worker, an unrelated app and a cooperative live app
                if (mode === 'closed') {
                    throw new Error('The fixture window closed.');

                }
                if (mode !== 'silent') {
                    let responseAppKey = request.appKey;
                    if (mode === 'foreign') {
                        responseAppKey = 'other-app';

                    }
                    ports[0]?.postMessage({type: 'layer-navigation-result', protocol: 1, url: request.url,
                        appKey: responseAppKey, accepted: mode === 'accept'});

                }

            };

        }
        const accepted = await layerNavigationHandoff(client, {url, appKey, timeoutMs: 10});
        assert.equal(accepted, mode === 'accept');

    }
    assert.equal(await layerNavigationHandoff({}, {url, appKey: null}), false);

});

test('notification focus uses live app routing, scopes clients and retains native legacy recovery', async function(){
    //Avoiding actual notifications, permissions and user browser windows in a unit test
    const calls = /** @type {string[]} */ ([]);
    let accepts = true;
    let clients = /** @type {any[]} */ ([{url: 'https://example.com/another-app/', focus: function(){
        //A sibling application must not be selected merely because its origin matches
        assert.fail('Focused another application.');

    }}, {url, focus: async function(){
        //Recording focus separately from any document replacement
        calls.push('focus');

    }, navigate: async function(){
        //Recording the compatibility-only native fallback
        calls.push('native');

    }, postMessage: function(/** @type {any} */ request, /** @type {MessagePort[]} */ ports){
        //Acknowledging ownership without claiming that a route guard permitted access
        calls.push('message');
        ports[0]?.postMessage({type: 'layer-navigation-result', protocol: 1,
            url: request.url, appKey: request.appKey, accepted: accepts});

    }}]);
    const runtime = layerServiceWorkerRuntimeCreate(/** @type {any} */ ({
        manifest: {appVersion: '0.1.0', runtimeVersion: '0.1.0', compilerVersion: '0.1.0', protocolMin: 1,
            protocolMax: 1, schemaVersions: {engine: 1}, minVersion: null, rollbackVersion: null,
            offlineShellUrl: '/index.html', assets: [{url: '/index.html', hash: 'sha256-' + Buffer.alloc(32).toString('base64'),
                required: true, policy: 'shell'}]},
        deployment: {appKey, buildId: 'b'.repeat(64), scope: '/app/'}, applicationOrigin: 'https://example.com',
        cacheStorage: {}, fetchImplementation: fetch, subtleCrypto: webcrypto.subtle, base64Encode: btoa,
        scope: {clients: {matchAll: async function(){
            //Returning only this fixture's current windows
            return clients;

        }, openWindow: async function(){
            //Opening no actual browser window in this unit test
            calls.push('open');

        }}, registration: {}, skipWaiting: async function(){
            //No installation or activation is part of this navigation test

        }}
    }));
    await runtime.notificationOpen(url);
    assert.deepEqual(calls, ['focus', 'message']);
    accepts = false;
    await runtime.notificationOpen(url);
    assert.deepEqual(calls.slice(2), ['focus', 'message', 'native']);
    clients = [];
    await runtime.notificationOpen(url);
    assert.equal(calls.at(-1), 'open');
    for (const target of ['https://foreign.example/app/', 'https://user:secret@example.com/app/', '/another-app/']) {
        await assert.rejects(runtime.notificationOpen(target), {code: 'PWA_NAVIGATION_DENIED'});

    }

});
