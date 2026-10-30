/**
 * @typedef {import('./viewport.js').LayerViewportState['keyboard']} LayerKeyboardState
 * @typedef {Readonly<{status: 'requested' | 'blocked', focused: boolean, reason: string | null}>} LayerKeyboardResult
 */

//Function for adapting the existing viewport owner into keyboard requests without a second geometry authority
/**
 * @param {{root: HTMLElement, window: Window, assert: () => void, refresh: () => void,
 *     getState: () => import('./viewport.js').LayerViewportState,
 *     subscribe: (listener: (state: import('./viewport.js').LayerViewportState) => void) => (() => void)}} keyboardOptions
 */
export const layerKeyboardCreate = function( keyboardOptions ){
    //Reusing the owner's lifecycle and browser document without installing listeners or timers
    const rootNode = keyboardOptions.root;
    const documentNode = rootNode.ownerDocument;
    const browserWindow = keyboardOptions.window;
    const nativeKeyboard = /** @type {Navigator & {virtualKeyboard?: {show?: () => void, hide?: () => void}}} */ (browserWindow.navigator).virtualKeyboard;

    //Function for returning immutable request results independently of observed keyboard visibility
    /** @param {'requested' | 'blocked'} status @param {HTMLElement | null} fieldNode @param {string | null} reason */
    const resultCreate = function( status, fieldNode, reason ){
        //Reporting DOM focus only; a browser may accept focus without displaying its software keyboard
        return Object.freeze( {status, focused: fieldNode !== null && documentNode.activeElement === fieldNode, reason} );

    };

    //Function for recognizing supported input surfaces without inventing focus proxies
    /** @param {HTMLElement} fieldNode */
    const editableCheck = function( fieldNode ){
        //Keeping picker controls, buttons and explicitly read-only fields out of keyboard requests
        return fieldNode.matches( 'textarea, input:not([type]), input[type=text], input[type=search], input[type=email], input[type=url], input[type=tel], input[type=password], input[type=number], [contenteditable=""], [contenteditable=true], [contenteditable=plaintext-only]' ) &&
            !fieldNode.matches( ':disabled, [readonly]' );

    };

    //Function for detecting platform control without changing browser-owned policy
    const capabilityRead = function(){
        //Advertising methods as capability, never as an unconditional promise of keyboard visibility
        const nativeControl = browserWindow.isSecureContext === true && typeof nativeKeyboard?.show === 'function' && typeof nativeKeyboard?.hide === 'function';
        let strategy = /** @type {'native' | 'focus'} */ ('focus');
        if ( nativeControl ){
            //Selecting the native strategy only when both request methods are available
            strategy = 'native';

        }
        return Object.freeze({
            strategy,
            nativeControl,
            requiresUserInteraction: true,
            visibilitySource: keyboardOptions.getState().keyboard.source
        });

    };

    //Function for requesting a native action only on an explicitly manual-policy field
    /** @param {HTMLElement} fieldNode @param {'show' | 'hide'} action */
    const nativeRequest = function( fieldNode, action ){
        //Preserving authored keyboard policy and using focus/blur when native control is unavailable
        if ( !capabilityRead().nativeControl || fieldNode.getAttribute( 'virtualkeyboardpolicy' ) !== 'manual' ){
            return false;

        }
        try {
            //Some browsers silently ignore the request; only geometry events can confirm visibility
            nativeKeyboard?.[action]?.();
            return true;

        } catch {
            //Keeping the ordinary focus/blur fallback when the browser rejects optional native control
            return false;

        }

    };

    //CallBack THE OBJECT
    return Object.freeze({
        /**
         * Synchronously requests the keyboard for a connected app input, textarea or editing host.
         * Call directly inside a user click/tap handler before awaiting work. No selector or ref wrapper.
         * Returns requested/blocked and DOM focus; requested does not confirm keyboard visibility.
         */
        show: function( /** @type {HTMLElement} */ fieldNode ){
            //Rejecting programming errors before touching focus or any foreign application
            keyboardOptions.assert();
            const elementConstructor = documentNode.defaultView?.HTMLElement;
            if ( elementConstructor === undefined || !(fieldNode instanceof elementConstructor) ||
                !rootNode.contains( fieldNode ) || !fieldNode.isConnected ){
                throw new TypeError( 'Keyboard requires a connected HTMLElement inside the application root.' );

            }
            if ( !editableCheck( fieldNode ) ){
                return resultCreate( 'blocked', fieldNode, 'field-not-editable' );

            }
            if ( fieldNode.inputMode === 'none' ){
                return resultCreate( 'blocked', fieldNode, 'inputmode-none' );

            }

            //Respecting hidden and inert ancestors instead of temporarily making a proxy input focusable
            for ( let ancestorNode = /** @type {HTMLElement | null} */ (fieldNode); ancestorNode !== null; ancestorNode = ancestorNode.parentElement ){
                const ancestorStyle = browserWindow.getComputedStyle( ancestorNode );
                if ( ancestorNode.hasAttribute( 'hidden' ) || ancestorNode.hasAttribute( 'inert' ) ||
                    ancestorStyle.display === 'none' || ['hidden', 'collapse'].includes( ancestorStyle.visibility ) ){
                    return resultCreate( 'blocked', fieldNode, 'field-unavailable' );

                }

            }

            //Keeping focus synchronous so the original user action is not lost to a timer or render queue
            fieldNode.focus( {preventScroll: true} );
            keyboardOptions.refresh();
            if ( documentNode.activeElement !== fieldNode ){
                return resultCreate( 'blocked', fieldNode, 'focus-refused' );

            }
            nativeRequest( fieldNode, 'show' );
            return resultCreate( 'requested', fieldNode, null );

        },
        /** Requests dismissal for the currently focused app field. Fallback removes focus; no automatic refocus. */
        hide: function(){
            //Leaving another application or an unrelated control's focus untouched
            keyboardOptions.assert();
            const fieldNode = /** @type {HTMLElement | null} */ (documentNode.activeElement);
            if ( fieldNode === null || !rootNode.contains( fieldNode ) || !editableCheck( fieldNode ) ){
                return resultCreate( 'blocked', null, 'no-active-field' );

            }
            nativeRequest( fieldNode, 'hide' );
            fieldNode.blur();
            keyboardOptions.refresh();
            if ( documentNode.activeElement === fieldNode ){
                return resultCreate( 'blocked', fieldNode, 'blur-refused' );

            }
            return resultCreate( 'requested', fieldNode, null );

        },
        /** Reads immutable viewport keyboard geometry. visible=null means unknown, not closed. */
        getState: function(){
            //Reusing the latest measurement; requesting focus never fabricates a visibility transition
            keyboardOptions.assert();
            return keyboardOptions.getState().keyboard;

        },
        /** Delivers an immediate snapshot and changed keyboard states; unsubscribe is also owned by the component. */
        subscribe: function( /** @type {(state: LayerKeyboardState) => void} */ listener ){
            //Validating before registration so a failed initial callback cannot leak a subscription
            keyboardOptions.assert();
            if ( typeof listener !== 'function' ){
                throw new TypeError( 'Keyboard listener must be a function.' );

            }
            const initialState = keyboardOptions.getState().keyboard;
            let previousSignature = JSON.stringify( initialState );
            listener( initialState );
            return keyboardOptions.subscribe(function( viewportState ){
                //Ignoring layout-only notifications while retaining immutable native or estimated geometry
                const nextSignature = JSON.stringify( viewportState.keyboard );
                if ( nextSignature !== previousSignature ){
                    previousSignature = nextSignature;
                    listener( viewportState.keyboard );

                }

            });

        },
        /** Returns the available strategy and measurement source. Native calls also require manual field policy. */
        getCapability: function(){
            //Checking lifecycle even though capability inspection does not change browser state
            keyboardOptions.assert();
            return capabilityRead();

        }
    });

};
