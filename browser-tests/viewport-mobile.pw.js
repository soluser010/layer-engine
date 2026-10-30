import {expect, test} from '@playwright/test';


//Function for replaying visual viewport geometry without claiming an emulated iOS keyboard
const viewportReplayInstall = async function( page ){
    //Keeping layout and CSS native while controlling only the browser geometry event stream
    await page.addInitScript(function(){
        //Replacing only optional keyboard measurements for deterministic cross-engine regressions
        const viewportData = Object.assign( new EventTarget(), {
            width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1
        });
        Object.defineProperty( window, 'visualViewport', {value: viewportData, configurable: true} );
        Object.defineProperty( navigator, 'virtualKeyboard', {value: undefined, configurable: true} );
        window.layerViewportReplay = function( changes, eventName = 'resize' ){
            //Applying a bounded test trace through the runtime's actual browser listeners
            Object.assign( viewportData, changes );
            viewportData.dispatchEvent( new Event( eventName ) );

        };

    });
    await page.goto( '/viewport/' );
    await page.waitForFunction(function(){
        //Waiting for the component owner and the generated runtime to share one controller
        return window.layerViewportFixture !== undefined;

    });

};

test( 'viewport replay keeps composer visible, preserves search and restores geometry after dismissal', async function( {page}, testInfo ){
    //Opening the real compiled fixture with deterministic keyboard animation measurements
    await viewportReplayInstall( page );
    await page.evaluate(function(){
        //Modeling nonzero shell insets: desktop WebKit does not expose a physical iPhone notch
        const rootNode = document.querySelector( '[data-layer-root]' );
        rootNode.style.paddingTop = '10px';
        rootNode.style.paddingBottom = '16px';

    });
    const baselineHeight = await page.evaluate(function(){
        //Reading the initial document height before any input owns the keyboard
        return innerHeight;

    });
    const messageField = page.locator( '#viewport-message' );
    await messageField.focus();
    const traceData = [];
    for ( const reduction of [100, 180, 250] ){
        //Checking intermediate animation frames, including Safari-style visual viewport panning
        await page.evaluate(function( height ){
            //Keeping the viewport's coordinate origin distinct from its visible height
            window.layerViewportReplay( {height, offsetTop: 24} );

        }, baselineHeight - reduction );
        await expect( page.locator( '#available-height' ) ).toHaveText( String( baselineHeight - reduction ) );
        const geometryData = await messageField.evaluate(function( elementNode ){
            //Measuring actual browser layout rather than accepting only the runtime snapshot
            const rootNode = document.querySelector( '[data-layer-root]' );
            return {
                fieldBottom: elementNode.getBoundingClientRect().bottom,
                rootTop: rootNode.getBoundingClientRect().top,
                rootHeight: rootNode.getBoundingClientRect().height,
                state: window.layer.viewport.getState()
            };

        });
        expect( geometryData.rootTop ).toBeCloseTo( 24, 0 );
        expect( geometryData.rootHeight ).toBeCloseTo( baselineHeight - reduction, 0 );
        expect( geometryData.fieldBottom ).toBeLessThanOrEqual( 24 + baselineHeight - reduction - 16 + 1 );
        traceData.push( geometryData );

    }

    //Preserving the full shell during search without forcing blur or changing the draft
    await page.locator( '#viewport-search' ).focus();
    await expect( page.locator( '#available-height' ) ).toHaveText( String( baselineHeight ) );
    await expect( messageField ).toHaveValue( 'Hello viewport' );
    await page.evaluate(function( height ){
        //Simulating keyboard dismissal while search retains native focus
        window.layerViewportReplay( {height, offsetTop: 0} );

    }, baselineHeight );
    await expect.poll(async function(){
        //Waiting for the coalesced frame to clear keyboard occlusion and root offset
        return page.evaluate(function(){
            //Returning only stable public geometry for the assertion
            return window.layer.viewport.getState().visual.offsetTop;

        });

    }).toBe( 0 );
    await expect( page.locator( '#viewport-search' ) ).toBeFocused();

    //Retaining replay evidence while clearly distinguishing it from a physical iOS capture
    await testInfo.attach( 'synthetic-visual-viewport-trace', {
        body: Buffer.from( JSON.stringify( traceData, null, 4 ) ), contentType: 'application/json'
    });

});

test( 'viewport replay does not fight manual scrolling and reveals another field with unchanged geometry', async function( {page} ){
    //Creating a real scroll container so clamping and element positions come from the browser
    await viewportReplayInstall( page );
    await page.evaluate(function(){
        //Adding isolated inputs to the compiled test app without changing application templates
        const regionNode = document.createElement( 'section' );
        regionNode.id = 'keyboard-scroll-test';
        regionNode.setAttribute( 'data-layer-scroll-region', 'keyboard-test' );
        Object.assign( regionNode.style, {position: 'absolute', top: '20px', left: '0', height: '180px', width: '240px'} );
        for ( const fieldName of ['first', 'second'] ){
            //Spacing fields far enough apart to require a bounded scroll when focus changes
            const spacerNode = document.createElement( 'div' );
            spacerNode.style.height = '320px';
            const fieldNode = document.createElement( 'input' );
            fieldNode.id = 'keyboard-' + fieldName;
            fieldNode.style.fontSize = '16px';
            regionNode.append( spacerNode, fieldNode );

        }
        const trailingNode = document.createElement( 'div' );
        trailingNode.style.height = '300px';
        regionNode.append( trailingNode );
        document.querySelector( '[data-layer-root]' ).append( regionNode );
        document.querySelector( '#keyboard-first' ).focus( {preventScroll: true} );
        window.layerViewportReplay( {height: innerHeight - 250} );

    });
    const scrollRegion = page.locator( '#keyboard-scroll-test' );
    await expect.poll(async function(){
        //Waiting until initial keyboard opening has revealed the first field
        return scrollRegion.evaluate(function( elementNode ){
            //Reading the actual scroll position managed by the browser
            return elementNode.scrollTop;

        });

    }).toBeGreaterThan( 0 );
    await page.evaluate(function(){
        //Panning the visual viewport after the user deliberately scrolls away from the focused field
        document.querySelector( '#keyboard-scroll-test' ).scrollTop = 0;
        window.layerViewportReplay( {offsetTop: 40}, 'scroll' );

    });
    await expect.poll(async function(){
        //Waiting for the offset event to be processed before inspecting scroll preservation
        return page.evaluate(function(){
            //Reading the last published measurement
            return window.layer.viewport.getState().visual.offsetTop;

        });

    }).toBe( 40 );
    expect( await scrollRegion.evaluate(function( elementNode ){
        //Checking that the runtime did not pull the old field back into view
        return elementNode.scrollTop;

    }) ).toBe( 0 );

    //Moving focus without native scrolling must still reveal the new field once
    await page.locator( '#keyboard-second' ).evaluate(function( elementNode ){
        //Separating browser focus behavior from the controller's reveal obligation
        elementNode.focus( {preventScroll: true} );

    });
    await expect.poll(async function(){
        //Checking the focused field fits inside its nearest scroll container
        return page.locator( '#keyboard-second' ).evaluate(function( elementNode ){
            //Comparing layout rectangles in the same coordinate system
            return elementNode.getBoundingClientRect().bottom <= elementNode.parentElement.getBoundingClientRect().bottom;

        });

    }).toBe( true );

});

test( 'native viewport resizing restores a scoped region across mobile portrait and landscape layouts', async function( {page} ){
    //Keeping the real VisualViewport: this tests browser layout, not a simulated software keyboard
    await page.setViewportSize( {width: 390, height: 740} );
    await page.goto( '/viewport/' );
    await page.waitForFunction(function(){
        //Waiting for generated client initialization before selecting a local viewport
        return window.layerViewportFixture !== undefined;

    });
    await page.evaluate(function(){
        //Declaring the existing chat as a local resize target through public attributes
        document.querySelector( '.chat' ).setAttribute( 'data-layer-viewport', 'chat' );
        const fieldNode = document.querySelector( '#viewport-message' );
        fieldNode.setAttribute( 'data-layer-viewport-target', 'chat' );
        fieldNode.focus( {preventScroll: true} );

    });
    for ( const dimensions of [{width: 740, height: 390}, {width: 320, height: 568}, {width: 390, height: 844}] ){
        //Changing the actual browser viewport so CSS grid, root padding and region measurements all settle
        await page.setViewportSize( dimensions );
        await expect.poll(async function(){
            //Checking the scoped region fills the natural grid row after either orientation
            return page.evaluate(function(){
                //Comparing the region bottom against the app's available content edge
                const rootNode = document.querySelector( '[data-layer-root]' );
                const rootRectangle = rootNode.getBoundingClientRect();
                const rootStyle = getComputedStyle( rootNode );
                const regionRectangle = document.querySelector( '.chat' ).getBoundingClientRect();
                return Math.abs( regionRectangle.bottom - (rootRectangle.bottom - Number.parseFloat( rootStyle.paddingBottom )) );

            });

        }).toBeLessThanOrEqual( 1 );
        await expect( page.locator( '#viewport-message' ) ).toBeFocused();

    }

    //Changing routes releases the scoped style and component owner without leaving a stuck shell
    await page.evaluate(async function(){
        //Using the actual router cleanup rather than removing DOM nodes manually
        await window.layer.navigate( '/second/' );

    });
    await expect( page.locator( 'h1' ) ).toHaveText( 'second-browser-page' );
    await expect.poll(async function(){
        //Checking root geometry returns to the native visual viewport after route teardown
        return page.evaluate(function(){
            //Reading the final measured root and native viewport in CSS pixels
            return Math.abs( document.querySelector( '[data-layer-root]' ).getBoundingClientRect().height - visualViewport.height );

        });

    }).toBeLessThanOrEqual( 1 );

});
