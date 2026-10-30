import assert from 'node:assert/strict';
import {randomUUID, webcrypto} from 'node:crypto';
import test from 'node:test';
import {IDBFactory} from 'fake-indexeddb';
import {layerPwaCapabilitiesCreate, layerServiceWorkerRuntimeCreate} from '../src/index.js';
import {layerPushReceiptsCreate} from '../src/push-receipts.js';

test( 'server push enable/disable are explicit, online-only and keep low-level APIs', async function(){
    //Providing browser-owned subscriptions while tracking only operation names, not private keys
    const requestsData = /** @type {string[]} */ ([]);
    let permissionData = 'granted';
    let permissionCountData = 0;
    let subscriptionData = /** @type {any} */ (null);
    const registeredSubscriptionData = {endpoint: 'https://fcm.googleapis.com/device',
        toJSON(){
            return {endpoint: this.endpoint, keys: {auth: 'opaque', p256dh: 'opaque'}};

        }, async unsubscribe(){
            subscriptionData = null;

            return true;

        }};
    const optionsData = {notificationApi: /** @type {typeof Notification} */ (/** @type {unknown} */ ({
        async requestPermission(){
            permissionCountData += 1;

            return permissionData;

        }})), async registrationGet(){
        return /** @type {ServiceWorkerRegistration} */ (/** @type {unknown} */ ({pushManager: {
            async getSubscription(){
                return subscriptionData;

            }, async subscribe( /** @type {any} */ optionsData ){
                assert.ok( optionsData.applicationServerKey instanceof Uint8Array );
                assert.equal( optionsData.userVisibleOnly, true );
                subscriptionData = registeredSubscriptionData;

                return registeredSubscriptionData;

            }
        }}));

    }, async pushRequest( /** @type {any} */ requestData ){
        requestsData.push( requestData.operation );

        if ( requestData.type === 'query' ){
            return {data: {publicKey: Buffer.alloc( 65, 4 ).toString( 'base64url' )}};

        }

        return {data: {subscriptionId: 'device-id', revoked: true}};

    }};
    const capabilitiesData = layerPwaCapabilitiesCreate( optionsData );
    assert.equal( permissionCountData, 0 );
    assert.equal( (await capabilitiesData.push.enable()).subscriptionId, 'device-id' );
    await capabilitiesData.push.enable();
    assert.equal( requestsData.length, 4 );
    assert.equal( (await capabilitiesData.push.disable()).revoked, true );
    assert.equal( (await capabilitiesData.push.disable()).revoked, false );
    permissionData = 'denied';
    await assert.rejects( capabilitiesData.push.enable(), {code: 'PWA_PUSH_PERMISSION_DENIED'} );
    await assert.rejects( layerPwaCapabilitiesCreate().push.enable(), {code: 'PWA_CAPABILITY_UNAVAILABLE'} );
    await assert.rejects( layerPwaCapabilitiesCreate().push.disable(), {code: 'PWA_CAPABILITY_UNAVAILABLE'} );
    permissionData = 'granted';
    await assert.rejects( layerPwaCapabilitiesCreate({...optionsData, async pushRequest(){
        throw new Error( 'API offline' );

    }}).push.enable(), /API offline/ );

});

test( 'bounded push receipts persist across worker restart and rollback failed display', async function(){
    //Using real IndexedDB transaction semantics without invoking an operating-system notification
    const indexedDbData = new IDBFactory();
    const firstData = layerPushReceiptsCreate( indexedDbData, 'receipts-test' );
    const notificationIdData = randomUUID();
    assert.equal( await firstData.claim( notificationIdData ), true );
    const restartedData = layerPushReceiptsCreate( indexedDbData, 'receipts-test' );
    assert.equal( await restartedData.claim( notificationIdData ), false );
    await restartedData.forget( notificationIdData );
    assert.equal( await firstData.claim( notificationIdData ), true );

    for ( let indexData = 0; indexData < 257; indexData += 1 ){
        await restartedData.claim( String( indexData ) );

    }

    const memoryData = layerPushReceiptsCreate( undefined, 'fallback' );
    assert.equal( await memoryData.claim( 'a' ), true );
    assert.equal( await memoryData.claim( 'a' ), false );
    await memoryData.forget( 'a' );

    for ( let indexData = 0; indexData < 257; indexData += 1 ){
        await memoryData.claim( String( indexData ) );

    }

    assert.equal( await memoryData.claim( '0' ), true );

});

test( 'worker validates push URLs, retains tag/icon and suppresses repeated notification IDs', async function(){
    const displayedData = /** @type {any[]} */ ([]);
    let failDisplayData = false;
    const optionsData = {manifest: {appVersion: '0.1.0', runtimeVersion: '0.1.0', compilerVersion: '0.1.0',
        protocolMin: 1, protocolMax: 1, schemaVersions: {}, minVersion: null, rollbackVersion: null,
        offlineShellUrl: '/index.html', assets: [{url: '/index.html', hash: 'sha256-' + Buffer.alloc( 32 ).toString( 'base64' ), required: true, policy: 'shell'}]},
    indexedDb: new IDBFactory(), applicationOrigin: 'https://app.example.com',
    cacheStorage: /** @type {CacheStorage} */ (/** @type {unknown} */ ({})), fetchImplementation: fetch,
    subtleCrypto: /** @type {SubtleCrypto} */ (/** @type {unknown} */ (webcrypto.subtle)), base64Encode: btoa,
    scope: {async skipWaiting(){}, clients: {async claim(){}, async matchAll(){
        return [];

    }}, registration: {async showNotification( /** @type {string} */ titleData, /** @type {NotificationOptions} */ notificationOptionsData = {} ){
        if ( failDisplayData ){
            throw new Error( 'display failed' );

        }

        displayedData.push({title: titleData, options: notificationOptionsData});

    }}}};
    const runtimeData = layerServiceWorkerRuntimeCreate( optionsData );
    const pushData = {notificationId: randomUUID(), title: 'Notification', body: 'Plain text', url: '/messages/1', icon: '/icon.png', badge: '/badge.png', tag: 'message'};
    await runtimeData.push( pushData );
    await layerServiceWorkerRuntimeCreate( optionsData ).push( pushData );
    assert.equal( displayedData.length, 1 );
    assert.equal( displayedData[0].options.icon, 'https://app.example.com/icon.png' );
    assert.equal( displayedData[0].options.badge, 'https://app.example.com/badge.png' );
    assert.equal( displayedData[0].options.tag, 'message' );
    await assert.rejects( runtimeData.push({...pushData, notificationId: 'invalid'}), {code: 'PWA_PUSH_INVALID'} );
    await assert.rejects( runtimeData.push({...pushData, url: '//evil.example'}), {code: 'PWA_NAVIGATION_DENIED'} );
    await assert.rejects( runtimeData.push({...pushData, icon: 'https://evil.example/icon.png'}), {code: 'PWA_PUSH_INVALID'} );
    for ( const badgeData of ['https://evil.example/badge.png', '//evil.example/badge.png', 'data:image/png;base64,AAAA', 'https://user:pass@app.example.com/badge.png', 7, null] ){
        await assert.rejects( runtimeData.push({...pushData, notificationId: randomUUID(), badge: badgeData}), {code: 'PWA_PUSH_INVALID'} );

    }

    //Checking older callers which do not send status-bar artwork
    const legacyPushData = {notificationId: randomUUID(), title: pushData.title, body: pushData.body, url: pushData.url};
    await runtimeData.push( legacyPushData );
    assert.equal( displayedData.at(-1).options.badge, undefined );
    displayedData.pop();

    failDisplayData = true;
    const retryPushData = {...pushData, notificationId: randomUUID()};
    await assert.rejects( runtimeData.push( retryPushData ), /display failed/ );
    failDisplayData = false;
    await runtimeData.push( retryPushData );
    assert.equal( displayedData.length, 2 );

});
