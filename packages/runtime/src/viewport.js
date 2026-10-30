import {layerScrollAnchorCapture, layerScrollAnchorRestore} from './viewport-scroll.js';
import {layerViewportZoomGuardCreate} from './viewport-zoom.js';
import {layerKeyboardCreate} from './keyboard.js';

/**
 * @typedef {{boundingRect: DOMRect, overlaysContent: boolean,
 *     addEventListener: EventTarget['addEventListener'], removeEventListener: EventTarget['removeEventListener']}} VirtualKeyboard
 * @typedef {Readonly<{width: number, height: number, offsetTop: number, offsetLeft: number, scale: number}>} ViewportRectangle
 * @typedef {Readonly<{layout: ViewportRectangle, visual: ViewportRectangle,
 *     keyboard: Readonly<{source: 'native' | 'estimated' | 'unknown', visible: boolean | null, height: number,
 *         rect: Readonly<{x: number, y: number, width: number, height: number}> | null}>,
 *     policy: 'resize' | 'preserve', availableHeight: number}>} LayerViewportState
 */

//Function for recognizing editable elements without executing application code
/** @param {Element | null} elementNode */
const editableCheck = function( elementNode ){
    //Excluding button-like inputs and disabled controls from keyboard policy
    return elementNode !== null && elementNode.matches(
        'textarea:not(:disabled):not([readonly]), input:not(:disabled):not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]):not([type=file]):not([readonly]), [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'
    );

};

//Function for creating the document-owned PWA viewport controller
/**
 * Owns geometry, declarative keyboard policies and scroll anchors, not application design.
 * Create once per application after its root exists. Component clients use `createOwner()`;
 * disposing an owner releases its subscriptions without stopping the shared controller.
 * No keyboard is reopened and no user blur is intercepted.
 * @param {{root: HTMLElement, window?: Window}} viewportOptions
 */
export const layerViewportCreate = function( viewportOptions ){
    //Checking a live application root before acquiring browser resources
    const rootNode = viewportOptions.root;
    const browserWindow = viewportOptions.window ?? rootNode.ownerDocument.defaultView;
    if ( browserWindow === null || rootNode.ownerDocument !== browserWindow.document || !rootNode.isConnected ){
        throw new TypeError( 'Viewport requires a connected application root and its window.' );

    }

    const documentNode = browserWindow.document;
    const visualViewport = browserWindow.visualViewport;
    const virtualKeyboard = /** @type {Navigator & {virtualKeyboard?: VirtualKeyboard}} */ (browserWindow.navigator).virtualKeyboard;
    const subscriptions = new Set( /** @type {((state: LayerViewportState) => void)[]} */ ([]) );
    const regionRegistrations = new Map( /** @type {[string, HTMLElement][]} */ ([]) );
    const scrollRegistrations = new Map( /** @type {[string, HTMLElement][]} */ ([]) );
    const managedProperties = new Map( /** @type {[HTMLElement, Map<string, {value: string, priority: string, applied: string}>][]} */ ([]) );
    const ownerDisposers = new Set( /** @type {(() => boolean)[]} */ ([]) );
    let disposedStatus = false;
    let scheduledFrame = 0;
    let baselineHeight = browserWindow.innerHeight;
    let baselineWidth = browserWindow.innerWidth;
    let selectedRegion = rootNode;
    let selectedRegionBaseline = baselineHeight;
    let activeField = /** @type {HTMLElement | null} */ (null);
    let stateData = /** @type {LayerViewportState | null} */ (null);
    let keyboardOverlayBaseline = false;
    let regionObserver = /** @type {MutationObserver | null} */ (null);

    //Acquiring one geometry authority where native keyboard rectangles are available
    if ( virtualKeyboard !== undefined ){
        keyboardOverlayBaseline = virtualKeyboard.overlaysContent;
        virtualKeyboard.overlaysContent = true;

    }

    //Function for changing only controller-owned custom properties
    /** @param {HTMLElement} elementNode @param {string} propertyName @param {string} propertyValue */
    const propertySet = function( elementNode, propertyName, propertyValue ){
        //Recording original values once so disposal restores caller-owned CSS
        let originalProperties = managedProperties.get( elementNode );
        if ( originalProperties === undefined ){
            originalProperties = new Map();
            managedProperties.set( elementNode, originalProperties );

        }

        if ( !originalProperties.has( propertyName ) ){
            originalProperties.set( propertyName, {
                value: elementNode.style.getPropertyValue( propertyName ),
                priority: elementNode.style.getPropertyPriority( propertyName ),
                applied: propertyValue
            });

        }

        //Avoiding redundant DOM style mutations on heartbeat-like viewport events
        if ( elementNode.style.getPropertyValue( propertyName ) !== propertyValue ){
            elementNode.style.setProperty( propertyName, propertyValue );

        }

        const originalProperty = originalProperties.get( propertyName );
        if ( originalProperty !== undefined ){
            originalProperty.applied = propertyValue;

        }

    };

    //Function for releasing styles of a region no longer owned by the controller
    /** @param {HTMLElement} elementNode */
    const propertiesRestore = function( elementNode ){
        //Restoring only the custom properties acquired by this controller
        for ( const [propertyName, propertyData] of managedProperties.get( elementNode ) ?? [] ){
            //Preserving a later application override instead of undoing caller changes
            if ( elementNode.style.getPropertyValue( propertyName ) !== propertyData.applied ){
                continue;

            }

            if ( propertyData.value === '' ){
                elementNode.style.removeProperty( propertyName );

            } else {
                elementNode.style.setProperty( propertyName, propertyData.value, propertyData.priority );

            }

        }

        managedProperties.delete( elementNode );

    };

    //Function for checking element ownership across imperative API calls
    /** @param {HTMLElement} elementNode */
    const elementAssert = function( elementNode ){
        //Rejecting foreign documents, detached elements and disposed controllers
        if ( disposedStatus || !rootNode.contains( elementNode ) || !elementNode.isConnected ){
            throw new TypeError( 'Viewport element must belong to the active application root.' );

        }

    };

    //Function for resolving a scoped region without interpolating arbitrary selectors
    /** @param {string} regionName @param {'viewport' | 'scroll-region'} regionType */
    const regionGet = function( regionName, regionType ){
        //Checking bounded identifiers before scanning exact declared attributes
        if ( !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u.test( regionName ) ){
            throw new TypeError( 'Viewport region name is invalid.' );

        }

        let registeredRegions = scrollRegistrations;
        if ( regionType === 'viewport' ){
            registeredRegions = regionRegistrations;

        }
        const registeredNode = registeredRegions.get( regionName );
        if ( registeredNode !== undefined ){
            elementAssert( registeredNode );
            return registeredNode;

        }

        const regionMatches = Array.from( rootNode.querySelectorAll( '[data-layer-' + regionType + ']' ) ).filter(function( regionNode ){
            //Matching an exact name without granting access outside the app root
            return regionNode.getAttribute( 'data-layer-' + regionType ) === regionName;

        });
        if ( regionMatches.length !== 1 ){
            throw new TypeError( 'Viewport region must resolve to exactly one element.' );

        }

        return /** @type {HTMLElement} */ (regionMatches[0]);

    };

    //Function for minimally revealing a field inside its nearest scroll region
    /** @param {HTMLElement} elementNode @returns {boolean} */
    const ensureVisible = function( elementNode ){
        //Keeping explicit preserve policies and user zoom under user control
        elementAssert( elementNode );
        if ( elementNode.getAttribute( 'data-layer-scroll' ) === 'preserve' || (visualViewport?.scale ?? 1) !== 1 ){
            return false;

        }

        let scrollNode = /** @type {HTMLElement} */ (elementNode.closest( '[data-layer-scroll-region]' ) ?? rootNode);
        if ( !rootNode.contains( scrollNode ) ){
            //Keeping scrolling inside this app even when an outer host declares its own region
            scrollNode = rootNode;

        }
        const elementRectangle = elementNode.getBoundingClientRect();
        const regionRectangle = scrollNode.getBoundingClientRect();
        const visibleTop = Math.max( regionRectangle.top, visualViewport?.offsetTop ?? 0 );
        let visibleBottom = Math.min( regionRectangle.bottom, (visualViewport?.offsetTop ?? 0) + (visualViewport?.height ?? browserWindow.innerHeight) );
        if ( virtualKeyboard !== undefined && virtualKeyboard.boundingRect.height > 0 ){
            const keyboardRectangle = virtualKeyboard.boundingRect;
            //Accounting for floating keyboards only when they intersect this field horizontally
            if ( elementRectangle.right > keyboardRectangle.left && elementRectangle.left < keyboardRectangle.right &&
                elementRectangle.bottom > keyboardRectangle.top && elementRectangle.top < keyboardRectangle.bottom ){
                visibleBottom = Math.min( visibleBottom, keyboardRectangle.top );

            }

        }

        //Leaving fully occluded regions and oversized fields covering the visible area stationary
        if ( visibleBottom <= visibleTop + 16 ||
            (elementRectangle.top <= visibleTop + 8 && elementRectangle.bottom >= visibleBottom - 8) ){
            //CallBack THE BOOLEAN
            return false;

        }

        let scrollDelta = 0;
        if ( elementRectangle.bottom > visibleBottom - 8 ){
            scrollDelta = Math.min( elementRectangle.bottom - visibleBottom + 8, Math.max( 0, elementRectangle.top - visibleTop - 8 ) );

        } else if ( elementRectangle.top < visibleTop + 8 ){
            scrollDelta = elementRectangle.top - visibleTop - 8;

        }

        //Reporting actual movement because browser scroll positions may be clamped at either edge
        const previousScrollTop = scrollNode.scrollTop;
        scrollNode.scrollTop += scrollDelta;
        return scrollNode.scrollTop !== previousScrollTop;

    };

    //Function for applying one coalesced geometry measurement
    const geometryApply = function(){
        //Releasing the frame token and skipping disposed documents
        scheduledFrame = 0;
        if ( disposedStatus ){
            return;

        }

        const layoutWidth = browserWindow.innerWidth;
        const layoutHeight = browserWindow.innerHeight;
        const visualWidth = visualViewport?.width ?? layoutWidth;
        const visualHeight = visualViewport?.height ?? layoutHeight;
        const visualTop = visualViewport?.offsetTop ?? 0;
        const visualLeft = visualViewport?.offsetLeft ?? 0;
        const visualScale = visualViewport?.scale ?? 1;
        const nextField = /** @type {HTMLElement | null} */ (documentNode.activeElement);
        const fieldActive = editableCheck( nextField ) && nextField !== null && rootNode.contains( nextField );

        //Releasing references to regions removed by route or conditional rendering
        for ( const elementNode of managedProperties.keys() ){
            if ( !rootNode.contains( elementNode ) ){
                propertiesRestore( elementNode );

            }

        }

        //Discarding stale baselines on window resize and orientation changes
        if ( visualScale === 1 && (!fieldActive || layoutWidth !== baselineWidth) ){
            baselineHeight = layoutHeight;
            baselineWidth = layoutWidth;

        }

        const previousField = activeField;
        activeField = null;
        let policy = /** @type {'resize' | 'preserve'} */ ('resize');
        let nextRegion = rootNode;
        if ( fieldActive && nextField !== null ){
            activeField = nextField;
            if ( nextField.getAttribute( 'data-layer-keyboard' ) === 'preserve' ){
                policy = 'preserve';

            }

            const targetName = nextField.getAttribute( 'data-layer-viewport-target' );
            if ( targetName !== null ){
                //Ignoring unresolved declarative targets safely instead of breaking the viewport loop
                const targetNodes = rootNode.querySelectorAll( '[data-layer-viewport]' );
                const matchingNodes = Array.from( targetNodes ).filter(function( targetNode ){
                    //Matching exactly without constructing a selector from author input
                    return targetNode.getAttribute( 'data-layer-viewport' ) === targetName;

                });
                const registeredTarget = regionRegistrations.get( targetName );
                if ( registeredTarget !== undefined && rootNode.contains( registeredTarget ) ){
                    nextRegion = registeredTarget;

                } else if ( matchingNodes.length === 1 ){
                    nextRegion = /** @type {HTMLElement} */ (matchingNodes[0]);

                }

            }

        }

        let keyboardHeight = 0;
        let keyboardRect = /** @type {Readonly<{x: number, y: number, width: number, height: number}> | null} */ (null);
        let keyboardSource = /** @type {'native' | 'estimated' | 'unknown'} */ ('unknown');
        let keyboardVisible = /** @type {boolean | null} */ (null);
        if ( virtualKeyboard !== undefined ){
            keyboardRect = Object.freeze({
                x: virtualKeyboard.boundingRect.x,
                y: virtualKeyboard.boundingRect.y,
                width: virtualKeyboard.boundingRect.width,
                height: virtualKeyboard.boundingRect.height
            });
            keyboardSource = 'native';
            keyboardVisible = virtualKeyboard.boundingRect.height > 0;
            //Only a bottom-docked keyboard reduces the full-width working area
            if ( keyboardVisible && virtualKeyboard.boundingRect.bottom >= layoutHeight - 2 ){
                keyboardHeight = Math.max( 0, layoutHeight - virtualKeyboard.boundingRect.top );

            }

        } else if ( fieldActive && visualScale === 1 && baselineHeight - visualHeight > 80 ){
            keyboardSource = 'estimated';
            keyboardVisible = true;
            keyboardHeight = Math.max( 0, baselineHeight - visualHeight - visualTop );

        }

        //Preserving current scroll anchors only during geometry changes, never on each scroll event
        const scrollAnchors = [];
        const sizeChanged = stateData === null || stateData.visual.height !== visualHeight ||
            stateData.layout.height !== layoutHeight || stateData.policy !== policy ||
            stateData.keyboard.height !== keyboardHeight || nextRegion !== selectedRegion;
        const layoutChanged = stateData === null || stateData.layout.width !== layoutWidth || stateData.layout.height !== layoutHeight;
        const regionChanged = nextRegion !== selectedRegion;
        const fieldChanged = previousField !== activeField;
        const revealRequired = stateData === null || layoutChanged || regionChanged || fieldChanged ||
            stateData.visual.height !== visualHeight || stateData.visual.width !== visualWidth || stateData.policy !== policy ||
            JSON.stringify( stateData.keyboard.rect ) !== JSON.stringify( keyboardRect );
        if ( sizeChanged ){
            for ( const scrollNode of new Set( [rootNode, ...rootNode.querySelectorAll( '[data-layer-scroll-region]' ), ...scrollRegistrations.values()] ) ){
                scrollAnchors.push( layerScrollAnchorCapture( /** @type {HTMLElement} */ (scrollNode) ) );

            }

        }

        if ( nextRegion !== selectedRegion ){
            if ( selectedRegion !== rootNode ){
                propertiesRestore( selectedRegion );

            }

            selectedRegion = nextRegion;

        }

        let availableHeight = Math.min( layoutHeight, visualHeight );
        if ( virtualKeyboard !== undefined ){
            availableHeight = Math.min( availableHeight, layoutHeight - keyboardHeight );

        }

        if ( policy === 'preserve' ){
            availableHeight = baselineHeight;

        }

        //Keeping forced browser/accessibility zoom separate from keyboard occlusion
        if ( visualScale === 1 ){
            let rootHeight = availableHeight;
            if ( nextRegion !== rootNode ){
                rootHeight = baselineHeight;
                //Measuring a local region in its unoccluded shell, never against a stale orientation override
                propertySet( rootNode, '--layer-viewport-height', rootHeight + 'px' );
                propertySet( rootNode, '--layer-viewport-top', visualTop + 'px' );
                if ( regionChanged || layoutChanged ){
                    propertiesRestore( nextRegion );
                    selectedRegionBaseline = nextRegion.getBoundingClientRect().height;

                }

                const regionBottom = nextRegion.getBoundingClientRect().top + selectedRegionBaseline;
                const occlusionHeight = Math.max( 0, regionBottom - (visualTop + availableHeight) );
                propertySet( nextRegion, '--layer-region-height', Math.max( 0, selectedRegionBaseline - occlusionHeight ) + 'px' );

            }

            propertySet( rootNode, '--layer-viewport-height', rootHeight + 'px' );
            propertySet( rootNode, '--layer-viewport-top', visualTop + 'px' );
            propertySet( rootNode, '--layer-keyboard-height', keyboardHeight + 'px' );
            for ( const anchorData of scrollAnchors ){
                layerScrollAnchorRestore( anchorData );

            }

        }

        //Publishing frozen snapshots only when their semantic geometry changes
        const nextState = Object.freeze({
            layout: Object.freeze({width: layoutWidth, height: layoutHeight, offsetTop: 0, offsetLeft: 0, scale: 1}),
            visual: Object.freeze({width: visualWidth, height: visualHeight, offsetTop: visualTop, offsetLeft: visualLeft, scale: visualScale}),
            keyboard: Object.freeze({source: keyboardSource, visible: keyboardVisible, height: keyboardHeight, rect: keyboardRect}),
            policy,
            availableHeight
        });
        if ( JSON.stringify( nextState ) !== JSON.stringify( stateData ) ){
            stateData = nextState;
            for ( const stateListener of [...subscriptions] ){
                stateListener( stateData );

            }

        }

        //Revealing newly focused fields even with identical snapshots, but never fighting offset-only panning
        if ( activeField !== null && keyboardVisible === true && revealRequired ){
            ensureVisible( activeField );

        }

    };

    //Function for coalescing browser resize and focus notifications
    const refresh = function(){
        //Scheduling one frame without polling or restarting keyboard animations
        if ( !disposedStatus && scheduledFrame === 0 ){
            scheduledFrame = browserWindow.requestAnimationFrame( geometryApply );

        }

    };

    //Function for recovering measurements after the operating system resumes the document
    const visibilityHandle = function(){
        //Waiting until the page is visible instead of measuring suspended background geometry
        if ( !documentNode.hidden ){
            refresh();

        }

    };

    //Function for retaining focus only for explicitly declared pointer actions
    /** @param {Event} eventData */
    const pointerHandle = function( eventData ){
        //Allowing user-selected fields, navigation and keyboard focus to behave normally
        const eventTarget = /** @type {Element | null} */ (eventData.target);
        if ( activeField?.getAttribute( 'data-layer-focus' ) !== 'retain' || eventTarget === null || eventTarget.nodeType !== 1 ){
            return;

        }

        const retainAction = eventTarget.closest( '[data-layer-focus-retain]' );
        if ( retainAction !== null && rootNode.contains( retainAction ) && !editableCheck( retainAction ) ){
            //Preventing pointer-down focus transfer, not suppressing the subsequent click action
            eventData.preventDefault();

        }

    };

    //Function for creating a lifecycle-owned imperative client
    const createOwner = function(){
        //Keeping owned registrations separate from application-wide browser listeners
        if ( disposedStatus ){
            throw new TypeError( 'Viewport controller is disposed.' );

        }

        let ownerDisposed = false;
        const ownerCleanups = new Set( /** @type {(() => void)[]} */ ([]) );
        const ownerAssert = function(){
            //Rejecting late calls after either lifecycle has ended
            if ( ownerDisposed || disposedStatus ){
                throw new TypeError( 'Viewport owner is disposed.' );

            }

        };
        const ownerApi = Object.freeze({
            /** Returns an immutable cached snapshot; does not synchronously measure DOM. */
            getState: function(){
                //Returning the last immutable geometry without a synchronous layout read
                ownerAssert();
                return /** @type {LayerViewportState} */ (stateData);

            },
            /** Observes changed snapshots; returns unsubscribe. Read getState for the initial value. */
            subscribe: function( /** @type {(state: LayerViewportState) => void} */ stateListener ){
                //Acquiring a subscription that is released with the component
                ownerAssert();
                if ( typeof stateListener !== 'function' ){
                    throw new TypeError( 'Viewport listener must be a function.' );

                }

                const ownedListener = function( /** @type {LayerViewportState} */ viewportState ){
                    //Keeping identical caller callbacks isolated between separate owners
                    stateListener( viewportState );

                };
                subscriptions.add( ownedListener );
                const unsubscribe = function(){
                    //Releasing this callback before forgetting its owner cleanup
                    subscriptions.delete( ownedListener );
                    ownerCleanups.delete( unsubscribe );

                };
                ownerCleanups.add( unsubscribe );
                return unsubscribe;

            },
            /** Registers a connected app element; kind is viewport or scroll. Returns unregister. */
            registerRegion: function( /** @type {string} */ name, /** @type {HTMLElement} */ elementNode, /** @type {'viewport' | 'scroll'} */ kind = 'viewport' ){
                //Checking exact names and live roots before acquiring a registration
                ownerAssert();
                elementAssert( elementNode );
                if ( !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u.test( name ) || !['viewport', 'scroll'].includes( kind ) ){
                    throw new TypeError( 'Viewport registration is invalid.' );

                }

                let registrations = scrollRegistrations;
                if ( kind === 'viewport' ){
                    registrations = regionRegistrations;

                }
                if ( registrations.has( name ) ){
                    throw new TypeError( 'Viewport region is already registered.' );

                }

                registrations.set( name, elementNode );
                let attributeName = 'data-layer-viewport';
                if ( kind === 'scroll' ){
                    attributeName = 'data-layer-scroll-region';

                }

                const attributeValue = elementNode.getAttribute( attributeName );
                if ( attributeValue === null ){
                    elementNode.setAttribute( attributeName, name );

                }

                let registrationActive = true;
                const unregister = function(){
                    //Removing only the registration acquired by this owner
                    if ( !registrationActive ){
                        return;

                    }

                    registrationActive = false;
                    registrations.delete( name );
                    propertiesRestore( elementNode );
                    if ( attributeValue === null ){
                        elementNode.removeAttribute( attributeName );

                    }
                    ownerCleanups.delete( unregister );
                    refresh();

                };
                ownerCleanups.add( unregister );
                refresh();
                return unregister;

            },
            /** Minimally reveals the element in its nearest region; respects preserve and user zoom. */
            ensureVisible: function( /** @type {HTMLElement} */ elementNode ){
                //Revealing a field within app-owned scroll boundaries
                ownerAssert();
                return ensureVisible( elementNode );

            },
            /** Requests focus without scroll. Opening the system keyboard remains browser-controlled. */
            focus: function( /** @type {HTMLElement} */ elementNode ){
                //Requesting focus without forcing the browser to reopen a keyboard
                ownerAssert();
                elementAssert( elementNode );
                elementNode.focus( {preventScroll: true} );
                refresh();
                return documentNode.activeElement === elementNode;

            },
            /** Captures a declared scroll region and optional item. Use after mount; anchors own DOM references. */
            captureAnchor: function( /** @type {string} */ name, /** @type {Element | null} */ anchorNode = null ){
                //Capturing a declared scroll region rather than arbitrary document selectors
                ownerAssert();
                return layerScrollAnchorCapture( regionGet( name, 'scroll-region' ), anchorNode );

            },
            /** Restores item-relative position after the renderer settles. A removed item uses numeric fallback. */
            restoreAnchor: function( /** @type {import('./viewport-scroll.js').LayerScrollAnchor} */ anchorData ){
                //Validating captured ownership before restoring a numeric or keyed anchor
                ownerAssert();
                elementAssert( anchorData.region );
                return layerScrollAnchorRestore( anchorData );

            },
            /** Releases this owner's listeners and registrations. Later calls fail; repeated dispose returns false. */
            dispose: function(){
                //Releasing component listeners and registrations without stopping the document controller
                if ( ownerDisposed ){
                    return false;

                }

                ownerDisposed = true;
                for ( const cleanupHandle of [...ownerCleanups] ){
                    cleanupHandle();

                }

                ownerDisposers.delete( ownerApi.dispose );
                return true;

            }
        });
        ownerDisposers.add( ownerApi.dispose );
        //Sharing this owner's geometry and cleanup with the keyboard facade
        return Object.freeze({
            ...ownerApi,
            keyboard: layerKeyboardCreate({
                root: rootNode, window: browserWindow, assert: ownerAssert, refresh,
                getState: ownerApi.getState, subscribe: ownerApi.subscribe
            })
        });

    };

    //Separating browser page zoom from component gestures for this viewport lifecycle
    const zoomGuardDispose = layerViewportZoomGuardCreate( rootNode );

    //Acquiring passive geometry listeners and one explicit focus-retention listener
    browserWindow.addEventListener( 'resize', refresh );
    browserWindow.addEventListener( 'pageshow', refresh );
    documentNode.addEventListener( 'focusin', refresh );
    documentNode.addEventListener( 'focusout', refresh );
    documentNode.addEventListener( 'visibilitychange', visibilityHandle );
    rootNode.addEventListener( 'pointerdown', pointerHandle );
    visualViewport?.addEventListener( 'resize', refresh );
    visualViewport?.addEventListener( 'scroll', refresh );
    virtualKeyboard?.addEventListener( 'geometrychange', refresh );
    const BrowserMutationObserver = documentNode.defaultView?.MutationObserver;
    if ( BrowserMutationObserver !== undefined ){
        //Discovering conditional regions and changed input policies without observing our own CSS writes
        regionObserver = new BrowserMutationObserver( refresh );
        regionObserver.observe( rootNode, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-layer-keyboard', 'data-layer-scroll', 'data-layer-focus',
                'data-layer-viewport', 'data-layer-viewport-target', 'data-layer-scroll-region',
                'readonly', 'disabled', 'type', 'contenteditable']
        });

    }

    geometryApply();
    const applicationOwner = createOwner();

    //CallBack THE OBJECT
    return Object.freeze({
        ...applicationOwner,
        createOwner,
        refresh,
        resetScroll: function(){
            //Resetting only app-owned scrolling on explicit route navigation
            rootNode.scrollTop = 0;
            rootNode.scrollLeft = 0;
            refresh();

        },
        dispose: function(){
            //Releasing every acquired listener and scheduled frame exactly once
            if ( disposedStatus ){
                return false;

            }

            disposedStatus = true;
            zoomGuardDispose();
            regionObserver?.disconnect();
            for ( const ownerDispose of [...ownerDisposers] ){
                ownerDispose();

            }

            browserWindow.cancelAnimationFrame( scheduledFrame );
            browserWindow.removeEventListener( 'resize', refresh );
            browserWindow.removeEventListener( 'pageshow', refresh );
            documentNode.removeEventListener( 'focusin', refresh );
            documentNode.removeEventListener( 'focusout', refresh );
            documentNode.removeEventListener( 'visibilitychange', visibilityHandle );
            rootNode.removeEventListener( 'pointerdown', pointerHandle );
            visualViewport?.removeEventListener( 'resize', refresh );
            visualViewport?.removeEventListener( 'scroll', refresh );
            virtualKeyboard?.removeEventListener( 'geometrychange', refresh );
            if ( virtualKeyboard !== undefined ){
                virtualKeyboard.overlaysContent = keyboardOverlayBaseline;

            }

            for ( const elementNode of managedProperties.keys() ){
                propertiesRestore( elementNode );

            }

            subscriptions.clear();
            regionRegistrations.clear();
            scrollRegistrations.clear();
            applicationOwner.dispose();
            return true;

        }
    });

};
