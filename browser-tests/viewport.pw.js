import {expect, test} from '@playwright/test';

test( 'app viewport preserves search, resizes composer and releases component ownership', async function( {page} ){
    //Injecting reproducible geometry because desktop automation cannot open an iOS keyboard
    await page.addInitScript(function(){
        //Recording safe browser diagnostics so bootstrap failures do not hide behind a timeout
        window.addEventListener( 'error', function( eventData ){
            window.layerViewportFailure = eventData.message;

        } );
        window.addEventListener( 'unhandledrejection', function( eventData ){
            window.layerViewportFailure = String( eventData.reason );

        } );
        const visualViewport = Object.assign( new EventTarget(), {
            width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1
        });
        Object.defineProperty( window, 'visualViewport', {value: visualViewport, configurable: true} );
        Object.defineProperty( navigator, 'virtualKeyboard', {value: undefined, configurable: true} );
        window.layerGeometryChange = function( height ){
            //Simulating browser geometry notifications without changing application transport
            visualViewport.height = height;
            visualViewport.dispatchEvent( new Event( 'resize' ) );

        };

    });
    await page.goto( '/viewport/' );
    await page.waitForFunction(function(){
        //Waiting for the generated component context and reactive state adapter
        return window.layerViewportFixture !== undefined || window.layerViewportFailure !== undefined;

    });
    expect( await page.evaluate(function(){
        //Checking startup failures before any geometry assertion
        return window.layerViewportFailure;

    }) ).toBeUndefined();
    const initialHeight = await page.evaluate(function(){
        //Reading the initial app shell geometry from the public application controller
        return window.layer.viewport.getState().availableHeight;

    });
    const composer = page.locator( '#viewport-message' );
    await composer.focus();
    await page.evaluate(function( height ){
        //Reducing the visible area as a bottom-docked mobile keyboard would
        window.layerGeometryChange( height );

    }, initialHeight - 250 );
    await expect( page.locator( '#available-height' ) ).toHaveText( String( initialHeight - 250 ) );
    await expect( composer ).toBeFocused();
    const composerBottom = await composer.evaluate(function( elementNode ){
        //Checking the actual laid-out composer rather than only a state flag
        return elementNode.getBoundingClientRect().bottom;

    });
    expect( composerBottom ).toBeLessThanOrEqual( initialHeight - 250 );

    //Preserving selection and DOM identity during a signal-driven update
    await composer.evaluate(function( elementNode ){
        elementNode.setSelectionRange( 2, 5 );
        window.layerComposerOriginal = elementNode;

    });
    await page.getByRole( 'button', {name: 'Send', exact: true} ).click();
    await expect( page.locator( 'h1' ) ).toHaveText( 'Updated viewport example' );
    await expect( composer ).toBeFocused();
    expect( await composer.evaluate(function( elementNode ){
        //Checking both retained identity and retained selection
        return elementNode === window.layerComposerOriginal && elementNode.selectionStart === 2 && elementNode.selectionEnd === 5;

    }) ).toBe( true );

    //Switching directly to header search must preserve the pre-keyboard shell height
    await page.locator( '#viewport-search' ).focus();
    await expect( page.locator( '#available-height' ) ).toHaveText( String( initialHeight ) );
    const shellHeight = await page.locator( '[data-layer-root]' ).evaluate(function( elementNode ){
        //Checking the CSS geometry produced by the preserve policy
        return elementNode.getBoundingClientRect().height;

    });
    expect( shellHeight ).toBe( initialHeight );

    //Navigating away must dispose the old component owner without stopping the app controller
    const disposedOwner = await page.evaluate(async function(){
        const previousOwner = window.layerViewportFixture.viewport;
        await window.layer.navigate( '/second/' );
        try {
            previousOwner.getState();
            return false;

        } catch( ownerError ){
            //Verifying the expected lifecycle failure without hiding an unrelated error
            return String( ownerError ).includes( 'disposed' );

        }

    });
    expect( disposedOwner ).toBe( true );
    await expect( page.locator( 'h1' ) ).toHaveText( 'second-browser-page' );

});

test( 'app zoom guard preserves photo component events and ordinary scrolling', async function( {page} ){
    //Opening the actual generated app rather than injecting viewport styles into an unrelated document
    await page.goto( '/viewport/' );
    await page.waitForFunction( function(){
        //Waiting for the document-owned gesture guard to become active
        return window.layerViewportFixture !== undefined;

    });
    await expect( page.locator( 'meta[name=viewport]' ) ).toHaveAttribute( 'content', /maximum-scale=1.0, user-scalable=no/u );
    const gestureResultData = await page.evaluate( function(){
        //Reading generated CSS before attaching an application-owned photo surface
        const rootNode = document.querySelector( '[data-layer-root]' );
        const initialScaleData = window.visualViewport?.scale ?? 1;
        const initialHeightData = rootNode.getBoundingClientRect().height;
        const photoSurfaceNode = document.createElement( 'div' );
        const photoNode = document.createElement( 'img' );
        photoSurfaceNode.style.touchAction = 'none';
        photoSurfaceNode.append( photoNode );
        rootNode.append( photoSurfaceNode );
        let photoGestureCountData = 0;
        photoSurfaceNode.addEventListener( 'touchmove', function(){
            //Scaling only the image while the same event continues through the framework guard
            photoNode.style.transform = 'scale(2)';
            photoGestureCountData++;

        });
        const pinchEventData = new Event( 'touchmove', {bubbles: true, cancelable: true} );
        Object.defineProperty( pinchEventData, 'touches', {value: {length: 2}} );
        photoSurfaceNode.dispatchEvent( pinchEventData );
        const ordinaryScrollEventData = new WheelEvent( 'wheel', {bubbles: true, cancelable: true} );
        photoSurfaceNode.dispatchEvent( ordinaryScrollEventData );
        const zoomWheelEventData = new WheelEvent( 'wheel', {bubbles: true, cancelable: true, ctrlKey: true} );
        photoSurfaceNode.dispatchEvent( zoomWheelEventData );

        //Reporting component delivery, native-default cancellation and stable app geometry separately
        const gestureResultData = {
            rootTouchAction: getComputedStyle( rootNode ).touchAction,
            photoTouchAction: getComputedStyle( photoSurfaceNode ).touchAction,
            photoGestureCount: photoGestureCountData,
            photoTransform: getComputedStyle( photoNode ).transform,
            pinchCancelled: pinchEventData.defaultPrevented,
            normalScrollCancelled: ordinaryScrollEventData.defaultPrevented,
            ctrlWheelCancelled: zoomWheelEventData.defaultPrevented,
            scaleUnchanged: (window.visualViewport?.scale ?? 1) === initialScaleData,
            heightUnchanged: rootNode.getBoundingClientRect().height === initialHeightData
        };
        photoSurfaceNode.remove();

        //CallBack THE OBJECT
        return gestureResultData;

    });
    expect( gestureResultData.rootTouchAction ).toBe( 'pan-x pan-y' );
    expect( gestureResultData.photoTouchAction ).toBe( 'none' );
    expect( gestureResultData.photoGestureCount ).toBe( 1 );
    expect( gestureResultData.photoTransform ).toBe( 'matrix(2, 0, 0, 2, 0, 0)' );
    expect( gestureResultData.pinchCancelled ).toBe( true );
    expect( gestureResultData.normalScrollCancelled ).toBe( false );
    expect( gestureResultData.ctrlWheelCancelled ).toBe( true );
    expect( gestureResultData.scaleUnchanged ).toBe( true );
    expect( gestureResultData.heightUnchanged ).toBe( true );

});

test( 'mobile Chromium keeps page scale fixed while a photo consumes native pinch pointers', async function( {browser} ){
    //Using real touch input only on engines that expose the Chromium input protocol
    test.skip( browser.browserType().name() !== 'chromium', 'Native multi-touch injection uses Chromium CDP; WebKit touch behavior still needs device testing.' );
    const mobileContextData = await browser.newContext({
        viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 1
    });
    try {
        //Opening the generated viewport page with a real mobile VisualViewport
        const mobilePageData = await mobileContextData.newPage();
        await mobilePageData.goto( 'http://127.0.0.1:5330/viewport/' );
        await mobilePageData.waitForFunction( function(){
            //Waiting for the runtime before exercising native browser defaults
            return window.layerViewportFixture !== undefined;

        });
        await mobilePageData.evaluate( function(){
            //Creating an application-owned surface whose CSS retains all pointer movements
            const photoSurfaceNode = document.createElement( 'div' );
            photoSurfaceNode.id = 'native-photo-surface';
            photoSurfaceNode.style.position = 'fixed';
            photoSurfaceNode.style.top = '160px';
            photoSurfaceNode.style.left = '20px';
            photoSurfaceNode.style.width = '300px';
            photoSurfaceNode.style.height = '220px';
            photoSurfaceNode.style.touchAction = 'none';
            photoSurfaceNode.style.overflow = 'hidden';
            const photoNode = document.createElement( 'img' );
            photoNode.id = 'native-photo';
            photoNode.src = '/icon.svg';
            photoNode.style.width = '100px';
            photoNode.style.height = '100px';
            photoSurfaceNode.append( photoNode );
            document.querySelector( '[data-layer-root]' ).append( photoSurfaceNode );
            const pointerPositionsData = new Map();
            let initialDistanceData = 0;
            const photoPointerHandle = function( eventData ){
                //Recording component pointers without changing document geometry or suppressing propagation
                pointerPositionsData.set( eventData.pointerId, {x: eventData.clientX, y: eventData.clientY} );
                if ( pointerPositionsData.size === 2 ){
                    const positionData = [...pointerPositionsData.values()];
                    const distanceData = Math.hypot( positionData[0].x - positionData[1].x, positionData[0].y - positionData[1].y );
                    if ( initialDistanceData === 0 ){
                        initialDistanceData = distanceData;

                    }
                    photoNode.style.transform = 'scale(' + distanceData / initialDistanceData + ')';

                }

            };
            photoSurfaceNode.addEventListener( 'pointerdown', photoPointerHandle );
            photoSurfaceNode.addEventListener( 'pointermove', photoPointerHandle );

        });
        const inputSessionData = await mobileContextData.newCDPSession( mobilePageData );

        //Pinching the normal app area must not magnify the page itself
        await inputSessionData.send( 'Input.synthesizePinchGesture', {x: 180, y: 480, scaleFactor: 2, gestureSourceType: 'touch'} );
        expect( await mobilePageData.evaluate( function(){
            //Reading native geometry rather than replacing the browser viewport with a mock
            return window.visualViewport.scale;

        }) ).toBeCloseTo( 1, 2 );

        //Delivering two native touch contacts to the custom photo surface
        await inputSessionData.send( 'Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [
            {id: 0, x: 90, y: 240}, {id: 1, x: 150, y: 240}
        ]} );
        await inputSessionData.send( 'Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [
            {id: 0, x: 60, y: 240}, {id: 1, x: 180, y: 240}
        ]} );
        await inputSessionData.send( 'Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []} );
        await expect( mobilePageData.locator( '#native-photo' ) ).toHaveCSS( 'transform', 'matrix(2, 0, 0, 2, 0, 0)' );
        expect( await mobilePageData.evaluate( function(){
            //Confirming that only the photo changed scale after the native multi-touch sequence
            return window.visualViewport.scale;

        }) ).toBeCloseTo( 1, 2 );
        await inputSessionData.detach();

    } finally {
        //Closing only the mobile fixture context and its touch resources
        await mobileContextData.close();

    }

});
