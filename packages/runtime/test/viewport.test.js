import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {layerViewportCreate} from '../src/index.js';
import {layerScrollAnchorRestore} from '../src/viewport-scroll.js';
import {layerViewportZoomGuardCreate} from '../src/viewport-zoom.js';

test( 'keyboard requests focus synchronously and never invents software keyboard visibility', function( testContext ){
    //Using the existing geometry authority and a component-owned facade
    const fixture = viewportFixtureCreate();
    testContext.after( fixture.close );
    const keyboard = fixture.controller.createOwner().keyboard;
    const fieldNode = /** @type {HTMLTextAreaElement} */ (fixture.rootNode.querySelector( 'textarea' ));
    const originalValue = fieldNode.value = 'Draft';
    assert.deepEqual( keyboard.show( fieldNode ), {status: 'requested', focused: true, reason: null} );
    assert.equal( fixture.browserWindow.document.activeElement, fieldNode );
    assert.equal( keyboard.getState().visible, null );
    assert.equal( keyboard.getCapability().strategy, 'focus' );
    assert.equal( keyboard.getCapability().nativeControl, false );
    assert.ok( Object.isFrozen( keyboard.getState() ) );
    assert.deepEqual( keyboard.hide(), {status: 'requested', focused: false, reason: null} );
    assert.equal( fieldNode.value, originalValue );
    assert.equal( keyboard.hide().reason, 'no-active-field' );

});

test( 'keyboard blocks unavailable fields and rejects foreign or invalid references', function( testContext ){
    //Checking input validation before focus can leave the application boundary
    const fixture = viewportFixtureCreate();
    testContext.after( fixture.close );
    const keyboard = fixture.controller.keyboard;
    const fieldNode = /** @type {HTMLTextAreaElement} */ (fixture.rootNode.querySelector( 'textarea' ));
    assert.throws( function(){
        //Rejecting a selector string instead of a DOM field
        keyboard.show( /** @type {any} */ ('textarea') );

    }, TypeError );
    const outsideNode = fixture.browserWindow.document.createElement( 'input' );
    fixture.browserWindow.document.body.append( outsideNode );
    assert.throws( function(){
        //Rejecting a connected field owned by a different host
        keyboard.show( outsideNode );

    }, TypeError );
    outsideNode.focus();
    assert.equal( keyboard.hide().reason, 'no-active-field' );
    assert.equal( fixture.browserWindow.document.activeElement, outsideNode );
    for ( const attributeName of ['readonly', 'disabled', 'hidden', 'inert'] ){
        //Preserving disabled and hidden semantics rather than changing attributes to obtain focus
        fieldNode.setAttribute( attributeName, '' );
        assert.equal( keyboard.show( fieldNode ).status, 'blocked' );
        fieldNode.removeAttribute( attributeName );

    }
    fieldNode.inputMode = 'none';
    assert.equal( keyboard.show( fieldNode ).reason, 'inputmode-none' );
    fieldNode.inputMode = '';
    (/** @type {HTMLElement} */ (fieldNode.parentElement)).style.display = 'none';
    assert.equal( keyboard.show( fieldNode ).reason, 'field-unavailable' );
    (/** @type {HTMLElement} */ (fieldNode.parentElement)).style.display = '';
    fieldNode.focus = function(){
        //Simulating a browser that declines focus without throwing

    };
    assert.equal( keyboard.show( fieldNode ).reason, 'focus-refused' );

});

test( 'keyboard uses optional native manual control and survives browser rejection', function( testContext ){
    //Providing a native capability while keeping measurements separate from requests
    const fixture = viewportFixtureCreate( {native: true} );
    testContext.after( fixture.close );
    Object.defineProperty( fixture.browserWindow, 'isSecureContext', {value: true} );
    let shown = 0;
    let hidden = 0;
    fixture.keyboard.show = function(){
        //Counting an accepted native request without manufacturing a geometry event
        shown += 1;

    };
    fixture.keyboard.hide = function(){
        //Recording native dismissal while preserving the ordinary blur fallback
        hidden += 1;

    };
    const keyboard = fixture.controller.keyboard;
    const fieldNode = /** @type {HTMLTextAreaElement} */ (fixture.rootNode.querySelector( 'textarea' ));
    assert.equal( keyboard.getCapability().nativeControl, true );
    keyboard.show( fieldNode );
    assert.equal( shown, 0 );
    fieldNode.setAttribute( 'virtualkeyboardpolicy', 'manual' );
    keyboard.show( fieldNode );
    assert.equal( shown, 1 );
    assert.equal( keyboard.getState().visible, false );
    keyboard.hide();
    assert.equal( hidden, 1 );
    assert.equal( fieldNode.getAttribute( 'virtualkeyboardpolicy' ), 'manual' );
    fixture.keyboard.show = function(){
        //Simulating optional native API rejection
        throw new Error( 'Not allowed' );

    };
    assert.equal( keyboard.show( fieldNode ).status, 'requested' );

});

test( 'keyboard subscriptions are immediate, deduplicated and released with their viewport owner', function( testContext ){
    //Observing the existing viewport notifications instead of acquiring a second event source
    const fixture = viewportFixtureCreate();
    testContext.after( fixture.close );
    const owner = fixture.controller.createOwner();
    const snapshots = /** @type {import('../src/keyboard.js').LayerKeyboardState[]} */ ([]);
    const unsubscribe = owner.keyboard.subscribe(function( state ){
        //Recording immutable state for initial and changed keyboard measurements
        snapshots.push( state );

    });
    assert.equal( snapshots.length, 1 );
    owner.keyboard.show( /** @type {HTMLTextAreaElement} */ (fixture.rootNode.querySelector( 'textarea' )) );
    fixture.flush();
    assert.equal( snapshots.length, 1 );
    fixture.visualViewport.height = 500;
    fixture.controller.refresh();
    fixture.flush();
    assert.equal( snapshots.length, 2 );
    assert.equal( snapshots[1]?.source, 'estimated' );
    unsubscribe();
    unsubscribe();
    owner.dispose();
    assert.throws( function(){
        //Rejecting stale callbacks after component unmount
        owner.keyboard.getState();

    }, /disposed/u );
    fixture.visualViewport.height = 800;
    fixture.controller.refresh();
    fixture.flush();
    assert.equal( snapshots.length, 2 );
    assert.throws( function(){
        //Rejecting invalid listeners before registration
        fixture.controller.keyboard.subscribe( /** @type {any} */ (null) );

    }, TypeError );

});

//Function for creating deterministic browser geometry without opening a keyboard
const viewportFixtureCreate = function( /** @type {{native?: boolean, visual?: boolean}} */ fixtureOptions = {} ){
    //Creating connected editable fields and named regions with no application side effects
    const dom = new JSDOM( '<main data-layer-root><input id="search" data-layer-keyboard="preserve" data-layer-scroll="preserve"><section data-layer-viewport="chat"><div data-layer-scroll-region="messages"><p data-layer-scroll-key="one">One</p></div><textarea data-layer-focus="retain" id="message"></textarea><button data-layer-focus-retain>Send</button></section></main>', {pretendToBeVisual: true} );
    const browserWindow = /** @type {any} */ (dom.window);
    const rootNode = /** @type {HTMLElement} */ (browserWindow.document.querySelector( 'main' ));
    const frameCallbacks = new Map( /** @type {[number, FrameRequestCallback][]} */ ([]) );
    let frameSequence = 0;
    browserWindow.innerWidth = 400;
    browserWindow.innerHeight = 800;
    browserWindow.requestAnimationFrame = function( /** @type {FrameRequestCallback} */ callback ){
        //Queuing frames for explicit advancement in each test
        frameSequence += 1;
        frameCallbacks.set( frameSequence, callback );
        return frameSequence;

    };
    browserWindow.cancelAnimationFrame = function( /** @type {number} */ frameId ){
        //Removing pending frames when the controller releases the document
        frameCallbacks.delete( frameId );

    };
    const visualViewport = Object.assign( new browserWindow.EventTarget(), {
        width: 400, height: 800, offsetTop: 0, offsetLeft: 0, scale: 1
    });
    if ( fixtureOptions.visual !== false ){
        Object.defineProperty( browserWindow, 'visualViewport', {value: visualViewport} );

    }

    const keyboard = Object.assign( new browserWindow.EventTarget(), {
        overlaysContent: false,
        boundingRect: new browserWindow.DOMRect( 0, 800, 400, 0 )
    });
    if ( fixtureOptions.native === true ){
        Object.defineProperty( browserWindow.navigator, 'virtualKeyboard', {value: keyboard} );

    }

    const controller = layerViewportCreate( {root: rootNode, window: browserWindow} );
    const flush = function(){
        //Advancing only the currently queued geometry batch
        for ( const [frameId, callback] of [...frameCallbacks] ){
            frameCallbacks.delete( frameId );
            callback( 0 );

        }

    };
    const close = function(){
        //Closing every resource acquired by this isolated browser fixture
        controller.dispose();
        dom.window.close();

    };
    return {browserWindow, rootNode, controller, flush, close, visualViewport, keyboard, frameCallbacks};

};

test( 'viewport resizes by default, preserves search geometry, coalesces frames and tolerates browser zoom overrides', function( testContext ){
    //Acquiring an estimated-keyboard fixture with deterministic animation frames
    const fixture = viewportFixtureCreate();
    testContext.after( fixture.close );
    const messageNode = fixture.browserWindow.document.querySelector( '#message' );
    messageNode.focus();
    fixture.visualViewport.height = 500;
    fixture.controller.refresh();
    fixture.controller.refresh();
    assert.equal( fixture.frameCallbacks.size, 1 );
    fixture.flush();
    assert.equal( fixture.controller.getState().availableHeight, 500 );
    assert.equal( fixture.controller.getState().keyboard.source, 'estimated' );
    assert.equal( fixture.rootNode.style.getPropertyValue( '--layer-viewport-height' ), '500px' );

    //Switching directly between inputs without dropping the original baseline
    fixture.browserWindow.document.querySelector( '#search' ).focus();
    fixture.flush();
    assert.equal( fixture.controller.getState().policy, 'preserve' );
    assert.equal( fixture.controller.getState().availableHeight, 800 );
    assert.equal( fixture.rootNode.style.getPropertyValue( '--layer-viewport-height' ), '800px' );

    //Reporting an accessibility/browser override without mistaking scale for keyboard geometry
    fixture.visualViewport.scale = 2;
    fixture.visualViewport.height = 250;
    fixture.controller.refresh();
    fixture.flush();
    assert.equal( fixture.controller.getState().keyboard.source, 'unknown' );
    assert.equal( fixture.rootNode.style.getPropertyValue( '--layer-viewport-height' ), '800px' );

    //Recovering normal geometry after the keyboard closes
    fixture.visualViewport.scale = 1;
    fixture.visualViewport.height = 800;
    messageNode.focus();
    messageNode.blur();
    fixture.flush();
    assert.equal( fixture.controller.getState().availableHeight, 800 );
    assert.equal( fixture.controller.getState().keyboard.visible, null );

});

test( 'viewport blocks native zoom defaults without swallowing component gestures or ordinary input', function( testContext ){
    //Acquiring the document-owned guard through the real viewport controller
    const fixture = viewportFixtureCreate();
    testContext.after( fixture.close );
    const photoNode = fixture.browserWindow.document.createElement( 'div' );
    fixture.rootNode.append( photoNode );
    let componentGestureCountData = Number( 0 );
    photoNode.addEventListener( 'touchmove', function(){
        //Observing the same two-finger event in the application's photo-viewer handler
        componentGestureCountData++;

    });

    //Checking multi-touch and WebKit gesture cancellation while leaving propagation intact
    for ( const eventNameData of ['touchstart', 'touchmove', 'gesturestart', 'gesturechange'] ){
        const gestureEventData = new fixture.browserWindow.Event( eventNameData, {bubbles: true, cancelable: true} );
        Object.defineProperty( gestureEventData, 'touches', {value: {length: 2}} );
        photoNode.dispatchEvent( gestureEventData );
        assert.equal( gestureEventData.defaultPrevented, true );

    }
    assert.equal( componentGestureCountData, Number( 1 ) );

    //Preserving taps, one-finger scrolling, clicks and ordinary pointer delivery
    for ( const eventNameData of ['touchstart', 'touchmove', 'pointermove', 'click', 'dblclick'] ){
        const inputEventData = new fixture.browserWindow.Event( eventNameData, {bubbles: true, cancelable: true} );
        Object.defineProperty( inputEventData, 'touches', {value: {length: 1}} );
        photoNode.dispatchEvent( inputEventData );
        assert.equal( inputEventData.defaultPrevented, false );

    }

    //Cancelling browser Ctrl-wheel zoom while preserving normal scrolling and component wheel handlers
    const zoomWheelData = new fixture.browserWindow.WheelEvent( 'wheel', {bubbles: true, cancelable: true, ctrlKey: true} );
    photoNode.dispatchEvent( zoomWheelData );
    assert.equal( zoomWheelData.defaultPrevented, true );
    const scrollWheelData = new fixture.browserWindow.WheelEvent( 'wheel', {bubbles: true, cancelable: true} );
    photoNode.dispatchEvent( scrollWheelData );
    assert.equal( scrollWheelData.defaultPrevented, false );

    //Keeping events outside the app root and non-cancellable platform events untouched
    const outsideGestureData = new fixture.browserWindow.Event( 'gesturestart', {bubbles: true, cancelable: true} );
    fixture.browserWindow.document.body.dispatchEvent( outsideGestureData );
    assert.equal( outsideGestureData.defaultPrevented, false );
    const platformGestureData = new fixture.browserWindow.Event( 'gesturestart', {bubbles: true} );
    photoNode.dispatchEvent( platformGestureData );
    assert.equal( platformGestureData.defaultPrevented, false );

    //Removing native-default cancellation when the application controller releases its root
    fixture.controller.dispose();
    const releasedGestureData = new fixture.browserWindow.Event( 'gesturestart', {bubbles: true, cancelable: true} );
    photoNode.dispatchEvent( releasedGestureData );
    assert.equal( releasedGestureData.defaultPrevented, false );

});

test( 'viewport zoom guard teardown is idempotent and missing touch metadata is not treated as pinch', function(){
    //Creating a direct guard fixture to exercise its internal lifecycle contract
    const dom = new JSDOM( '<main></main>' );
    const rootNode = /** @type {HTMLElement} */ (dom.window.document.querySelector( 'main' ));
    const disposeGuard = layerViewportZoomGuardCreate( rootNode );
    try {
        //Leaving a generic touch event without two known touches unchanged
        const touchEventData = new dom.window.Event( 'touchstart', {bubbles: true, cancelable: true} );
        rootNode.dispatchEvent( touchEventData );
        assert.equal( touchEventData.defaultPrevented, false );
        assert.equal( disposeGuard(), true );
        assert.equal( disposeGuard(), false );

    } finally {
        //Releasing fixture resources even if an assertion fails
        disposeGuard();
        dom.window.close();

    }

});

test( 'native keyboard controls occlusion once, floating keyboards do not collapse the whole app', function( testContext ){
    //Acquiring the exact native geometry adapter rather than inferring from height
    const fixture = viewportFixtureCreate( {native: true} );
    testContext.after( fixture.close );
    fixture.browserWindow.document.querySelector( '#message' ).focus();
    assert.equal( fixture.keyboard.overlaysContent, true );
    fixture.keyboard.boundingRect = new fixture.browserWindow.DOMRect( 0, 500, 400, 300 );
    fixture.keyboard.dispatchEvent( new fixture.browserWindow.Event( 'geometrychange' ) );
    fixture.flush();
    assert.equal( fixture.controller.getState().keyboard.source, 'native' );
    assert.deepEqual( fixture.controller.getState().keyboard.rect, {x: 0, y: 500, width: 400, height: 300} );
    assert.equal( fixture.controller.getState().availableHeight, 500 );

    //Keeping full shell size for a floating keyboard that does not touch the bottom edge
    fixture.keyboard.boundingRect = new fixture.browserWindow.DOMRect( 100, 300, 100, 100 );
    fixture.controller.refresh();
    fixture.flush();
    assert.equal( fixture.controller.getState().availableHeight, 800 );
    assert.equal( fixture.controller.getState().keyboard.visible, true );
    fixture.controller.dispose();
    assert.equal( fixture.keyboard.overlaysContent, false );

});

test( 'scoped resize restores styles and imperative registrations obey ownership', function( testContext ){
    //Preparing a local region with an application-owned original custom property
    const fixture = viewportFixtureCreate();
    testContext.after( fixture.close );
    const chatNode = fixture.browserWindow.document.querySelector( '[data-layer-viewport]' );
    chatNode.getBoundingClientRect = function(){
        //Returning the initial local region dimensions for occlusion calculations
        return new fixture.browserWindow.DOMRect( 0, 100, 400, 600 );

    };
    chatNode.style.setProperty( '--layer-region-height', '90%', 'important' );
    const messageNode = fixture.browserWindow.document.querySelector( '#message' );
    messageNode.setAttribute( 'data-layer-viewport-target', 'chat' );
    messageNode.focus();
    fixture.visualViewport.height = 500;
    fixture.flush();
    assert.equal( fixture.rootNode.style.getPropertyValue( '--layer-viewport-height' ), '800px' );
    assert.equal( chatNode.style.getPropertyValue( '--layer-region-height' ), '400px' );
    fixture.browserWindow.document.querySelector( '#search' ).focus();
    fixture.flush();
    assert.equal( chatNode.style.getPropertyValue( '--layer-region-height' ), '90%' );
    assert.equal( chatNode.style.getPropertyPriority( '--layer-region-height' ), 'important' );

    //Checking that imperative names never escape the active root
    const owner = fixture.controller.createOwner();
    const unregister = owner.registerRegion( 'local', chatNode );
    assert.throws( function(){
        //Rejecting a duplicate acquired registration
        owner.registerRegion( 'local', chatNode );

    }, /already registered/u );
    assert.throws( function(){
        //Rejecting selector injection and invalid region kinds
        owner.registerRegion( 'bad"]', chatNode );

    }, /invalid/u );
    assert.throws( function(){
        //Rejecting a body outside the application root
        owner.focus( fixture.browserWindow.document.body );

    }, /application root/u );
    unregister();
    assert.equal( owner.dispose(), true );
    assert.equal( owner.dispose(), false );
    assert.throws( owner.getState, /disposed/u );

});

test( 'ensureVisible uses visual coordinates, respects preserve and releases registrations idempotently', function( testContext ){
    //Preparing a field whose geometry is clipped by a visible region starting below the header
    const fixture = viewportFixtureCreate();
    testContext.after( fixture.close );
    const regionNode = fixture.browserWindow.document.querySelector( '[data-layer-scroll-region]' );
    const fieldNode = fixture.browserWindow.document.querySelector( '#message' );
    regionNode.append( fieldNode );
    regionNode.getBoundingClientRect = function(){
        //Modeling a scroll region partially intersecting the visual viewport
        return new fixture.browserWindow.DOMRect( 0, 100, 400, 600 );

    };
    fieldNode.getBoundingClientRect = function(){
        //Positioning a field below the visible bottom edge
        return new fixture.browserWindow.DOMRect( 0, 550, 400, 30 );

    };
    fixture.visualViewport.height = 500;
    assert.equal( fixture.controller.ensureVisible( fieldNode ), true );
    assert.equal( regionNode.scrollTop, 88 );
    fieldNode.setAttribute( 'data-layer-scroll', 'preserve' );
    assert.equal( fixture.controller.ensureVisible( fieldNode ), false );
    fieldNode.removeAttribute( 'data-layer-scroll' );
    assert.equal( fixture.controller.focus( fieldNode ), true );

    //Ensuring an old unregister callback cannot remove a later owner's registration
    const owner = fixture.controller.createOwner();
    const unregister = owner.registerRegion( 'local', regionNode, 'scroll' );
    unregister();
    const replacement = owner.registerRegion( 'local', regionNode, 'scroll' );
    unregister();
    assert.equal( owner.captureAnchor( 'local' ).region, regionNode );
    replacement();

    //Releasing owner registrations when the entire application stops
    const temporaryRegion = fixture.browserWindow.document.createElement( 'section' );
    fixture.rootNode.append( temporaryRegion );
    owner.registerRegion( 'temporary', temporaryRegion );
    fixture.rootNode.style.setProperty( '--layer-viewport-height', '75%' );
    fixture.controller.dispose();
    assert.equal( temporaryRegion.hasAttribute( 'data-layer-viewport' ), false );
    assert.equal( fixture.rootNode.style.getPropertyValue( '--layer-viewport-height' ), '75%' );

});

test( 'viewport owners expose immutable snapshots and clean subscriptions, frames and listeners', function( testContext ){
    //Acquiring a fallback document without optional browser capabilities
    const fixture = viewportFixtureCreate( {visual: false} );
    testContext.after( fixture.close );
    const owner = fixture.controller.createOwner();
    let notifications = 0;
    const unsubscribe = owner.subscribe( function(){
        //Counting only semantic state changes
        notifications += 1;

    } );
    fixture.controller.refresh();
    fixture.flush();
    assert.equal( notifications, 0 );
    fixture.browserWindow.innerHeight = 700;
    fixture.browserWindow.dispatchEvent( new fixture.browserWindow.Event( 'resize' ) );
    fixture.flush();
    assert.equal( notifications, 1 );
    assert.equal( Object.isFrozen( owner.getState().visual ), true );
    unsubscribe();
    owner.dispose();
    fixture.controller.refresh();
    assert.equal( fixture.controller.dispose(), true );
    assert.equal( fixture.controller.dispose(), false );
    assert.equal( fixture.frameCallbacks.size, 0 );
    fixture.browserWindow.dispatchEvent( new fixture.browserWindow.Event( 'resize' ) );
    assert.equal( fixture.frameCallbacks.size, 0 );
    assert.equal( fixture.rootNode.style.getPropertyValue( '--layer-viewport-height' ), '' );

});

test( 'retain focus applies only to declared pointer actions and never traps user blur', function( testContext ){
    //Selecting a composer without any automatic focus restoration
    const fixture = viewportFixtureCreate();
    testContext.after( fixture.close );
    const messageNode = fixture.browserWindow.document.querySelector( '#message' );
    messageNode.focus();
    messageNode.value = 'Hello';
    messageNode.setSelectionRange( 2, 4 );
    fixture.flush();
    const pointerEvent = new fixture.browserWindow.Event( 'pointerdown', {bubbles: true, cancelable: true} );
    fixture.browserWindow.document.querySelector( 'button' ).dispatchEvent( pointerEvent );
    assert.equal( pointerEvent.defaultPrevented, true );
    assert.equal( messageNode.selectionStart, 2 );
    assert.equal( messageNode.selectionEnd, 4 );
    const ordinaryPointer = new fixture.browserWindow.Event( 'pointerdown', {bubbles: true, cancelable: true} );
    fixture.browserWindow.document.querySelector( '#search' ).dispatchEvent( ordinaryPointer );
    assert.equal( ordinaryPointer.defaultPrevented, false );
    messageNode.blur();
    fixture.flush();
    assert.notEqual( fixture.browserWindow.document.activeElement, messageNode );

});

test( 'scroll anchors follow retained keyed items, fall back safely and reject foreign regions', function( testContext ){
    //Capturing item-relative geometry before messages are prepended
    const fixture = viewportFixtureCreate();
    testContext.after( fixture.close );
    const regionNode = fixture.browserWindow.document.querySelector( '[data-layer-scroll-region]' );
    const itemNode = regionNode.querySelector( 'p' );
    let itemTop = 20;
    itemNode.getBoundingClientRect = function(){
        //Modeling an item moving down when older messages are inserted
        return new fixture.browserWindow.DOMRect( 0, itemTop, 400, 30 );

    };
    const anchor = fixture.controller.captureAnchor( 'messages' );
    itemTop = 60;
    assert.equal( fixture.controller.restoreAnchor( anchor ), true );
    assert.equal( regionNode.scrollTop, 40 );
    itemNode.remove();
    fixture.controller.restoreAnchor( anchor );
    assert.equal( regionNode.scrollTop, 0 );
    assert.throws( function(){
        //Rejecting an item outside the scroll list
        fixture.controller.captureAnchor( 'messages', fixture.rootNode );

    }, /belong/u );
    assert.throws( function(){
        //Rejecting missing or malformed regions instead of querying arbitrary selectors
        fixture.controller.captureAnchor( 'missing' );

    }, /exactly one/u );
    assert.throws( function(){
        //Rejecting invalid names before any document lookup
        fixture.controller.captureAnchor( 'bad/name' );

    }, /invalid/u );

});

test( 'viewport rejects invalid clients and releases detached regions without overwriting application styles', function( testContext ){
    //Checking optional browser APIs and invalid client boundaries in an isolated document
    const fixture = viewportFixtureCreate();
    testContext.after( fixture.close );
    const owner = fixture.controller.createOwner();
    assert.throws( function(){
        //Rejecting a non-callable callback before acquiring a subscription
        owner.subscribe( /** @type {any} */ (null) );

    }, /listener/u );
    assert.throws( function(){
        //Rejecting an invalid region kind even when the element is owned
        owner.registerRegion( 'region', fixture.rootNode, /** @type {any} */ ('outside') );

    }, /invalid/u );
    assert.throws( function(){
        //Rejecting a root associated with a different document
        layerViewportCreate( {root: fixture.rootNode, window: /** @type {any} */ ({document: {}})} );

    }, /connected/u );

    //Proving that identical callbacks belong independently to separate component owners
    let notifications = 0;
    const listener = function(){
        //Counting both owners until one explicitly unsubscribes
        notifications += 1;

    };
    const otherOwner = fixture.controller.createOwner();
    owner.subscribe( listener );
    otherOwner.subscribe( listener );
    owner.dispose();
    fixture.browserWindow.innerWidth = 700;
    fixture.browserWindow.innerHeight = 400;
    fixture.visualViewport.width = 700;
    fixture.visualViewport.height = 400;
    fixture.visualViewport.offsetTop = 15;
    fixture.visualViewport.offsetLeft = 5;
    fixture.controller.refresh();
    fixture.flush();
    assert.equal( notifications, 1 );
    assert.equal( fixture.controller.getState().visual.offsetTop, 15 );
    assert.equal( fixture.controller.getState().visual.offsetLeft, 5 );

    //Resolving an imperative viewport target and then releasing its disconnected style references
    const regionNode = fixture.browserWindow.document.createElement( 'section' );
    fixture.rootNode.append( regionNode );
    const unregister = otherOwner.registerRegion( 'local', regionNode );
    const fieldNode = fixture.browserWindow.document.querySelector( '#message' );
    fieldNode.setAttribute( 'data-layer-viewport-target', 'local' );
    fieldNode.focus();
    fixture.flush();
    assert.notEqual( regionNode.style.getPropertyValue( '--layer-region-height' ), '' );
    regionNode.remove();
    fixture.controller.refresh();
    fixture.flush();
    assert.equal( regionNode.style.getPropertyValue( '--layer-region-height' ), '' );
    unregister();

    //Rejecting imperative detached elements while a detached low-level scroll anchor becomes a no-op
    const messagesNode = fixture.browserWindow.document.querySelector( '[data-layer-scroll-region]' );
    const capturedAnchor = otherOwner.captureAnchor( 'messages' );
    messagesNode.remove();
    assert.equal( layerScrollAnchorRestore( capturedAnchor ), false );
    assert.throws( function(){
        //Validating connected membership before imperative DOM access
        otherOwner.ensureVisible( messagesNode );

    }, /application root/u );

});

test( 'dynamic input policies are observed without polling and observer teardown prevents further frames', async function( testContext ){
    //Acquiring a connected observer owned by this controller rather than a per-input watcher
    const fixture = viewportFixtureCreate();
    testContext.after( fixture.close );
    const fieldNode = fixture.browserWindow.document.querySelector( '#message' );
    fieldNode.focus();
    fixture.visualViewport.height = 500;
    fixture.flush();
    assert.equal( fixture.controller.getState().availableHeight, 500 );

    //Changing the policy while the same textarea still owns focus
    fieldNode.setAttribute( 'data-layer-keyboard', 'preserve' );
    await Promise.resolve();
    fixture.flush();
    assert.equal( fixture.controller.getState().availableHeight, 800 );
    fixture.controller.dispose();
    assert.throws( function(){
        //Rejecting new owners after application teardown instead of retaining late registrations
        fixture.controller.createOwner();

    }, /disposed/u );
    fieldNode.setAttribute( 'data-layer-keyboard', 'resize' );
    await Promise.resolve();
    assert.equal( fixture.frameCallbacks.size, 0 );

});

test( 'visual viewport panning does not pull a manually scrolled field back into view', function( testContext ){
    //Modeling an iOS visual viewport moving while the keyboard stays open
    const fixture = viewportFixtureCreate();
    testContext.after( fixture.close );
    const fieldNode = fixture.browserWindow.document.querySelector( '#message' );
    fieldNode.getBoundingClientRect = function(){
        //Keeping the field below the visible area after an intentional user scroll
        return new fixture.browserWindow.DOMRect( 0, 600, 400, 30 );

    };
    fixture.rootNode.getBoundingClientRect = function(){
        //Providing actual scroll boundaries independently from the keyboard estimate
        return new fixture.browserWindow.DOMRect( 0, 0, 400, 800 );

    };
    fieldNode.focus();
    fixture.visualViewport.height = 500;
    fixture.flush();
    fixture.rootNode.scrollTop = 120;
    fixture.visualViewport.offsetTop = 40;
    fixture.visualViewport.dispatchEvent( new fixture.browserWindow.Event( 'scroll' ) );
    fixture.flush();
    assert.equal( fixture.rootNode.scrollTop, 120 );
    assert.equal( fixture.rootNode.style.getPropertyValue( '--layer-viewport-top' ), '40px' );

});

test( 'changing focused fields reveals the new field even when the viewport snapshot is unchanged', function( testContext ){
    //Opening the keyboard before focusing a second field with the same resize policy
    const fixture = viewportFixtureCreate();
    testContext.after( fixture.close );
    fixture.rootNode.getBoundingClientRect = function(){
        //Providing bounded root geometry for both fields
        return new fixture.browserWindow.DOMRect( 0, 0, 400, 800 );

    };
    fixture.browserWindow.document.querySelector( '#message' ).focus();
    fixture.visualViewport.height = 500;
    fixture.flush();
    const nextField = fixture.browserWindow.document.createElement( 'input' );
    nextField.getBoundingClientRect = function(){
        //Placing the next field below the keyboard edge
        return new fixture.browserWindow.DOMRect( 0, 600, 400, 30 );

    };
    fixture.rootNode.append( nextField );
    fixture.rootNode.scrollTop = 0;
    nextField.focus();
    fixture.flush();
    assert.equal( fixture.rootNode.scrollTop, 138 );

});

test( 'scoped viewport remeasures its natural height after rotation instead of restoring portrait dimensions', function( testContext ){
    //Modeling a region whose natural size follows the unoccluded app shell
    const fixture = viewportFixtureCreate();
    testContext.after( fixture.close );
    const regionNode = fixture.browserWindow.document.querySelector( '[data-layer-viewport]' );
    regionNode.getBoundingClientRect = function(){
        //Reading the applied size just as browser layout would, including stale overrides
        const height = Number.parseFloat( regionNode.style.getPropertyValue( '--layer-region-height' ) ) || fixture.browserWindow.innerHeight - 100;
        return new fixture.browserWindow.DOMRect( 0, 100, fixture.browserWindow.innerWidth, height );

    };
    const fieldNode = fixture.browserWindow.document.querySelector( '#message' );
    fieldNode.setAttribute( 'data-layer-viewport-target', 'chat' );
    fieldNode.focus();
    fixture.visualViewport.height = 500;
    fixture.flush();
    assert.equal( regionNode.style.getPropertyValue( '--layer-region-height' ), '400px' );

    //Rotating with the field still focused, then closing the keyboard without blurring
    fixture.browserWindow.innerWidth = 800;
    fixture.browserWindow.innerHeight = 400;
    fixture.visualViewport.width = 800;
    fixture.visualViewport.height = 250;
    fixture.controller.refresh();
    fixture.flush();
    fixture.visualViewport.height = 400;
    fixture.controller.refresh();
    fixture.flush();
    assert.equal( regionNode.style.getPropertyValue( '--layer-region-height' ), '300px' );

    //Expanding the same region after returning to portrait must recover its natural height
    fixture.browserWindow.innerWidth = 400;
    fixture.browserWindow.innerHeight = 900;
    fixture.visualViewport.width = 400;
    fixture.visualViewport.height = 900;
    fixture.controller.refresh();
    fixture.flush();
    assert.equal( regionNode.style.getPropertyValue( '--layer-region-height' ), '800px' );

});

test( 'readonly textarea focus is not treated as an editable keyboard target', function( testContext ){
    //Keeping selectable read-only text outside keyboard policy estimation
    const fixture = viewportFixtureCreate();
    testContext.after( fixture.close );
    const fieldNode = fixture.browserWindow.document.querySelector( '#message' );
    fieldNode.readOnly = true;
    fieldNode.focus();
    fixture.visualViewport.height = 500;
    fixture.flush();
    assert.equal( fixture.controller.getState().keyboard.source, 'unknown' );

});

test( 'ensureVisible respects app boundaries, oversized fields and fully occluded regions', function( testContext ){
    //Declaring an outer host region must not grant the controller permission to scroll its parent
    const fixture = viewportFixtureCreate();
    testContext.after( fixture.close );
    fixture.browserWindow.document.body.setAttribute( 'data-layer-scroll-region', 'foreign-host' );
    const fieldNode = fixture.browserWindow.document.querySelector( '#message' );
    let fieldTop = 550;
    let fieldHeight = 30;
    let rootTop = 0;
    fixture.rootNode.getBoundingClientRect = function(){
        //Modeling the app's visible boundary independently of the surrounding host document
        return new fixture.browserWindow.DOMRect( 0, rootTop, 400, 800 );

    };
    fieldNode.getBoundingClientRect = function(){
        //Exercising ordinary, oversized and completely occluded editable fields
        return new fixture.browserWindow.DOMRect( 0, fieldTop, 400, fieldHeight );

    };
    fixture.visualViewport.height = 500;
    assert.equal( fixture.controller.ensureVisible( fieldNode ), true );
    assert.equal( fixture.rootNode.scrollTop, 88 );
    assert.equal( fixture.browserWindow.document.body.scrollTop, 0 );

    //Keeping a tall textarea stationary when it already covers the whole visible area
    fieldTop = -100;
    fieldHeight = 800;
    assert.equal( fixture.controller.ensureVisible( fieldNode ), false );
    assert.equal( fixture.rootNode.scrollTop, 88 );
    rootTop = 600;
    assert.equal( fixture.controller.ensureVisible( fieldNode ), false );
    assert.equal( fixture.rootNode.scrollTop, 88 );

});

test( 'changing readonly or disabled state refreshes keyboard policy without a new focus event', async function( testContext ){
    //Opening an estimated keyboard with a live editable textarea
    const fixture = viewportFixtureCreate();
    testContext.after( fixture.close );
    const fieldNode = fixture.browserWindow.document.querySelector( '#message' );
    fieldNode.focus();
    fixture.visualViewport.height = 500;
    fixture.flush();
    assert.equal( fixture.controller.getState().keyboard.source, 'estimated' );

    //Observing application attribute changes through the controller's single mutation observer
    for ( const attributeName of ['readonly', 'disabled'] ){
        fieldNode.setAttribute( attributeName, '' );
        await Promise.resolve();
        fixture.flush();
        assert.equal( fixture.controller.getState().keyboard.source, 'unknown' );
        fieldNode.removeAttribute( attributeName );
        await Promise.resolve();
        fixture.flush();
        assert.equal( fixture.controller.getState().keyboard.source, 'estimated' );

    }

});

test( 'foreground return refreshes geometry without focusing a field and releases its visibility listener', function( testContext ){
    //Modeling a geometry change that happened while the OS suspended the document
    const fixture = viewportFixtureCreate();
    testContext.after( fixture.close );
    Object.defineProperty( fixture.browserWindow.document, 'hidden', {value: true, configurable: true} );
    fixture.visualViewport.height = 650;
    fixture.browserWindow.document.dispatchEvent( new fixture.browserWindow.Event( 'visibilitychange' ) );
    assert.equal( fixture.frameCallbacks.size, 0 );

    //Resuming without assuming that Safari also sends a resize or pageshow event
    Object.defineProperty( fixture.browserWindow.document, 'hidden', {value: false, configurable: true} );
    fixture.browserWindow.document.dispatchEvent( new fixture.browserWindow.Event( 'visibilitychange' ) );
    fixture.flush();
    assert.equal( fixture.controller.getState().visual.height, 650 );
    assert.equal( fixture.browserWindow.document.activeElement, fixture.browserWindow.document.body );
    fixture.controller.dispose();
    fixture.browserWindow.document.dispatchEvent( new fixture.browserWindow.Event( 'visibilitychange' ) );
    assert.equal( fixture.frameCallbacks.size, 0 );

});
