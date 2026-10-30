import {expect, test} from '@playwright/test';

test( 'Web Push browser facade and native IndexedDB receipts retain the same contract', async function( {page} ){
    //Loading only fixtures; this gate never asks the owner for OS notification permission
    await page.goto( '/browser-tests/harness.html' );
    const resultData = await page.evaluate(async function(){
        const {layerPwaCapabilitiesCreate} = await import('/packages/pwa/src/index.js');
        const {layerPushReceiptsCreate} = await import('/packages/pwa/src/push-receipts.js');
        let permissionCallsData = 0;
        const operationNamesData = [];
        const subscriptionData = {endpoint: 'https://fcm.googleapis.com/browser-fixture',
            toJSON(){
                //Returning a browser-shaped subscription without issuing network push requests
                return {endpoint: this.endpoint, keys: {p256dh: 'fixture', auth: 'fixture'}};

            }, async unsubscribe(){
                //Simulating a successful native device unsubscription
                return true;

            }};
        const capabilitiesData = layerPwaCapabilitiesCreate({notificationApi: {
            async requestPermission(){
                //Confirming permission is invoked only by the explicit enable API
                permissionCallsData += 1;

                return 'granted';

            }}, async registrationGet(){
            //Supplying a controlled registration, independent of browser push-provider support
            return {pushManager: {async getSubscription(){
                return subscriptionData;

            }}};

        }, async pushRequest( requestData ){
            operationNamesData.push( requestData.operation );

            if ( requestData.type === 'query' ){
                return {data: {publicKey: btoa( String.fromCharCode( ...new Uint8Array( 65 ).fill( 4 ) ) )}};

            }

            return {data: {subscriptionId: 'fixture', revoked: true}};

        }});
        const automaticPermissionCountData = permissionCallsData;
        const enabledData = await capabilitiesData.push.enable();
        const disabledData = await capabilitiesData.push.disable();
        const receiptNamespaceData = 'push-browser-' + crypto.randomUUID();
        const firstReceiptsData = layerPushReceiptsCreate( indexedDB, receiptNamespaceData );
        const firstClaimData = await firstReceiptsData.claim( 'notification' );
        const nextReceiptsData = layerPushReceiptsCreate( indexedDB, receiptNamespaceData );
        const repeatedClaimData = await nextReceiptsData.claim( 'notification' );
        await nextReceiptsData.forget( 'notification' );
        const releasedClaimData = await firstReceiptsData.claim( 'notification' );
        indexedDB.deleteDatabase( `layer:${receiptNamespaceData}:push-receipts` );

        return {automaticPermissionCount: automaticPermissionCountData, permissionCalls: permissionCallsData,
            enabled: enabledData.subscriptionId, disabled: disabledData.revoked, operationNames: operationNamesData,
            firstClaim: firstClaimData, repeatedClaim: repeatedClaimData, releasedClaim: releasedClaimData};

    });

    expect( resultData ).toEqual({automaticPermissionCount: 0, permissionCalls: 1, enabled: 'fixture', disabled: true,
        operationNames: ['notifications.webpush.configuration', 'notifications.webpush.subscription.register', 'notifications.webpush.subscription.revoke'],
        firstClaim: true, repeatedClaim: false, releasedClaim: true});

});
