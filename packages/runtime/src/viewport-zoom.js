const zoomEventNames = Object.freeze(['touchstart', 'touchmove', 'gesturestart', 'gesturechange', 'wheel']);


/**
 * Suppresses cancellable browser zoom defaults inside one app root without consuming
 * component events. Does not reset browser scale or override OS/accessibility settings.
 * @param {HTMLElement} rootNode
 */
//Function for separating native page zoom from application-owned photo and map gestures
export const layerViewportZoomGuardCreate = function( rootNode ){
    //Keeping one listener collection owned by the document viewport rather than each component
    let disposedStatus = false;
    const listenerOptions = Object.freeze({capture: false, passive: false});

    /** @param {Event} eventData */
    //Function for cancelling only a zoom default while preserving event delivery and ordinary scroll
    const zoomDefaultPrevent = function( eventData ){
        //Leaving non-cancellable browser events and disposed controllers unchanged
        if ( disposedStatus || eventData.cancelable === false ){
            //Completing the inactive event path
            return;

        }

        //Reading only the native input metadata needed to distinguish pinch from a single finger
        const inputEventData = /** @type {Event & {touches?: Pick<TouchList, 'length'>, ctrlKey?: boolean}} */ (eventData);
        if ( eventData.type === 'touchstart' || eventData.type === 'touchmove' ){
            //Preserving one-finger scrolling, selection, taps and input focus
            if ( (inputEventData.touches?.length ?? Number( 0 )) < Number( 2 ) ){
                //Completing the non-zoom touch path
                return;

            }

        } else if ( eventData.type === 'wheel' && inputEventData.ctrlKey !== true ){
            //Completing an ordinary mouse or trackpad scroll without altering it
            return;

        }

        //Cancelling the browser action without stopping photo-viewer pointer/touch propagation
        eventData.preventDefault();

    };

    //Acquiring non-passive root listeners so browser gesture defaults can be cancelled when supported
    for ( const eventName of zoomEventNames ){
        rootNode.addEventListener( eventName, zoomDefaultPrevent, listenerOptions );

    }

    //Returning one idempotent release handle for the shared viewport lifecycle
    return function(){
        //Leaving repeated teardown harmless for route and application cleanup
        if ( disposedStatus ){
            //CallBack THE BOOLEAN
            return false;

        }

        //Removing only the listeners acquired by this app viewport
        disposedStatus = true;
        for ( const eventName of zoomEventNames ){
            rootNode.removeEventListener( eventName, zoomDefaultPrevent, listenerOptions );

        }

        //CallBack THE BOOLEAN
        return true;

    };

};
