import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';

//Restricting the self-signed certificate exception to the isolated local deployment
const originData = new URL( process.env.LAYER_PRODUCTION_URL ?? 'https://localhost:18443' );
assert.equal( originData.protocol, 'https:' );
assert.ok( ['localhost', '127.0.0.1', '[::1]'].includes( originData.hostname ) );
const browserData = await chromium.launch({args: ['--ignore-certificate-errors']});

try {
    //Collecting unhandled runtime errors without ignoring failed hydration
    const contextData = await browserData.newContext({ignoreHTTPSErrors: true});
    const pageData = await contextData.newPage();
    const pageErrorsData = /** @type {string[]} */ ([]);
    pageData.on( 'pageerror', function( errorData ){
        //Retaining errors for the final assertion
        pageErrorsData.push( errorData.message );

    });

    //Checking the generated SSR page and its hydrated signal binding
    await pageData.goto( originData.origin );
    await expect( pageData.getByRole( 'heading' ) ).toHaveText( 'Production fixture' );
    await pageData.waitForFunction( function(){
        //Waiting until the runtime finishes hydration before exercising an event binding
        return globalThis.document.querySelector( '[data-layer-root]' )?.hasAttribute( 'data-layer-ssr' ) === false;

    });
    await pageData.getByRole( 'button', {name: 'Increase'} ).click();
    await expect( pageData.locator( '#counter' ) ).toHaveText( '1' );
    const navigationStartData = await pageData.evaluate( function(){
        //Capturing the document identity before the router transition
        return performance.timeOrigin;

    });

    //Keeping query/hash and the same document during client-side navigation
    await pageData.getByRole( 'link', {name: 'Second page'} ).click();
    await expect( pageData.getByRole( 'heading' ) ).toHaveText( 'Second fixture' );
    assert.equal( new URL( pageData.url() ).pathname, '/second/' );
    assert.equal( new URL( pageData.url() ).search, '?source=fixture' );
    assert.equal( new URL( pageData.url() ).hash, '#content' );
    assert.equal( await pageData.evaluate( function(){
        //Reading the document identity after routing
        return performance.timeOrigin;

    }), navigationStartData );

    //Checking worker control and a real network reload of the direct route
    await pageData.waitForFunction( function(){
        //Waiting for the verified worker to control this page
        return navigator.serviceWorker.controller !== null;

    });
    await pageData.reload();
    await expect( pageData.getByRole( 'heading' ) ).toHaveText( 'Second fixture' );
    await pageData.waitForFunction( function(){
        //Waiting until the runtime finishes hydration before exercising an event binding
        return globalThis.document.querySelector( '[data-layer-root]' )?.hasAttribute( 'data-layer-ssr' ) === false;

    });
    await pageData.getByRole( 'button', {name: 'Increase'} ).click();
    await expect( pageData.locator( '#counter' ) ).toHaveText( '1' );
    assert.deepEqual( pageErrorsData, [] );
    process.stdout.write( 'Portable browser check passed: hydration, signals, routing and worker reload.\n' );

} finally {
    //Closing only the browser owned by this check
    await browserData.close();

}
