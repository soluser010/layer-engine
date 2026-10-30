import {expect, test} from '@playwright/test';

test( 'keyboard component API uses real clicks, preserves drafts and releases owner subscriptions', async function( {page} ){
    //Opening the compiled application so context and window facades use the same viewport authority
    await page.goto( '/viewport/' );
    await page.waitForFunction(function(){
        //Waiting for component mount, without synthesizing any user activation
        return window.layerViewportFixture?.keyboard !== undefined;

    });
    await page.locator( '#keyboard-show' ).click();
    await expect( page.locator( '#viewport-message' ) ).toBeFocused();
    expect( await page.evaluate(function(){
        //Reading the synchronous request result independently from keyboard visibility
        return window.layerKeyboardResult;

    }) ).toEqual( {status: 'requested', focused: true, reason: null} );
    await page.locator( '#keyboard-hide' ).click();
    await expect( page.locator( '#viewport-message' ) ).not.toBeFocused();
    await expect( page.locator( '#viewport-message' ) ).toHaveValue( 'Hello viewport' );
    expect( await page.evaluate(function(){
        //Both facades read the same frozen snapshot and immediately deliver one subscription notification
        let count = 0;
        const unsubscribe = window.layerViewportFixture.keyboard.subscribe(function(){
            //Counting only public keyboard observations
            count += 1;

        });
        unsubscribe();
        return count === 1 && window.layer.keyboard.getState() === window.layer.viewport.getState().keyboard;

    }) ).toBe( true );
    const disposedResult = await page.evaluate(async function(){
        //Keeping the old owner to prove navigation cannot leave a callable stale keyboard facade
        const keyboardOwner = window.layerViewportFixture.keyboard;
        await window.layer.navigate( '/second/' );
        try {
            keyboardOwner.getCapability();
            return false;

        } catch( lifecycleError ){
            //Only the expected lifecycle guard satisfies this regression
            return String( lifecycleError ).includes( 'disposed' );

        }

    });
    expect( disposedResult ).toBe( true );

});
