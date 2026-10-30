/**
 * @typedef {'auto' | 'app' | 'viewer' | 'external'} LayerLinkMode
 * @typedef {Readonly<{status: 'navigated' | 'viewer-opened' | 'external-requested' | 'blocked', url: string, reason: string}>} LayerLinkResult
 * @typedef {object} LayerLinksOptions
 * @property {HTMLElement} root
 * @property {Window} window
 * @property {string} [scope]
 * @property {Readonly<{external: Readonly<{mode: 'viewer' | 'platform', allowedOrigins: readonly string[]}>, scopeExtensions: readonly string[]}>} configuration
 * @property {(pathnameData: string) => unknown} resolve
 * @property {(urlData: string) => Promise<any>} navigate
 */


/** @param {LayerLinksOptions} linkOptions */
//Function for separating application routes, permitted embeds and platform navigation
export const layerLinksCreate = function( linkOptions ){
    //Acquiring document-owned state without importing application handlers or credentials
    const rootNode = linkOptions.root;
    const browserWindow = linkOptions.window;
    const browserDocument = rootNode.ownerDocument;
    const scopePath = linkOptions.scope ?? '/';
    const configuration = linkOptions.configuration;
    let disposedStatus = false;
    let readyStatus = false;
    let pendingLaunchUrl = /** @type {string | null} */ (null);
    let dialogNode = /** @type {HTMLDialogElement | null} */ (null);
    let viewerOwner = /** @type {object | null} */ (null);
    let previousFocus = /** @type {HTMLElement | null} */ (null);
    const applicationOwner = {};

    /** @param {string} urlData @param {LayerLinkResult['status']} statusData @param {string} reasonData */
    //Function for reporting a requested action without claiming browser or remote-site success
    const resultCreate = function( urlData, statusData, reasonData ){
        //CallBack THE OBJECT
        return Object.freeze({status: statusData, url: urlData, reason: reasonData});

    };

    /** @param {string} urlData */
    //Function for rejecting executable and credential-bearing URLs before any navigation
    const urlCreate = function( urlData ){
        //Checking the public text contract before parsing relative app links
        if ( typeof urlData !== 'string' || urlData.length > 4096 || urlData.includes('\\') || [...urlData].some(function(characterData){
            //Rejecting control characters without allowing the URL parser to strip them silently
            const characterCode = characterData.charCodeAt(0);
            return characterCode < 32 || characterCode === 127;

        }) ){
            //Passing invalid syntax to the caller without echoing the supplied URL
            throw new TypeError( 'A bounded navigation URL is required.' );

        }
        const normalizedUrl = new URL( urlData, browserWindow.location.href );
        if ( !['https:', 'http:'].includes( normalizedUrl.protocol ) || normalizedUrl.username !== '' || normalizedUrl.password !== '' ){
            //Rejecting a URL that must not reach an iframe, router or external window
            throw new TypeError( 'Only HTTP(S) navigation without credentials is allowed.' );

        }

        //CallBack THE OBJECT
        return normalizedUrl;

    };

    //Function for reporting concrete browser primitives rather than guaranteed OS link capture
    const getCapability = function(){
        //Detecting the native dialog independently from the experimental launch queue
        const probeNode = browserDocument.createElement( 'dialog' );
        //CallBack THE OBJECT
        return Object.freeze({
            viewer: typeof probeNode.showModal === 'function',
            launchQueue: typeof /** @type {any} */ (browserWindow).launchQueue?.setConsumer === 'function',
            associationVerification: 'platform-controlled',
            embeddingVerification: 'unavailable'
        });

    };

    //Function for closing only the active viewer and restoring connected focus
    const closeViewer = function(){
        //Leaving repeated closure harmless for route, modal and application cleanup
        if ( dialogNode === null ){
            //CallBack THE BOOLEAN
            return false;

        }
        const activeDialog = dialogNode;
        dialogNode = null;
        viewerOwner = null;
        if ( activeDialog.open && typeof activeDialog.close === 'function' ){
            //Releasing the browser top-layer modal before removing its DOM
            activeDialog.close();

        }
        activeDialog.remove();
        if ( previousFocus?.isConnected ){
            //Returning focus without scrolling a preserved application page
            previousFocus.focus({preventScroll: true});

        }
        previousFocus = null;

        //CallBack THE BOOLEAN
        return true;

    };

    /** @param {URL} targetUrl */
    //Function for requesting a new platform context while retaining the application's page
    const externalOpen = function( targetUrl ){
        //Opening synchronously within the user gesture; noopener may legitimately return null
        browserWindow.open( targetUrl.href, '_blank', 'noopener,noreferrer' );

        //CallBack THE OBJECT
        return resultCreate( targetUrl.href, 'external-requested', 'browser-controls-opening' );

    };

    /** @param {URL} targetUrl @param {object} ownerData @param {HTMLElement | null} focusTarget */
    //Function for creating one bounded modal without interpreting remote HTML
    const viewerOpen = function( targetUrl, ownerData, focusTarget ){
        //Rejecting same-origin embeds because scripts could otherwise remove their own sandbox
        if ( targetUrl.origin === browserWindow.location.origin || !configuration.external.allowedOrigins.includes( targetUrl.origin ) ){
            //CallBack THE OBJECT
            return resultCreate( targetUrl.href, 'blocked', 'viewer-origin-denied' );

        }
        if ( !getCapability().viewer ){
            //CallBack THE OBJECT
            return resultCreate( targetUrl.href, 'blocked', 'viewer-unavailable' );

        }
        closeViewer();
        previousFocus = focusTarget ?? /** @type {HTMLElement | null} */ (browserDocument.activeElement);
        const viewerNode = browserDocument.createElement( 'dialog' );
        viewerNode.setAttribute( 'data-layer-link-viewer', '' );
        viewerNode.setAttribute( 'aria-label', 'External website viewer' );
        const headerNode = browserDocument.createElement( 'header' );
        const originNode = browserDocument.createElement( 'span' );
        originNode.setAttribute( 'data-layer-link-origin', '' );
        originNode.textContent = targetUrl.origin;
        originNode.title = 'Requested origin; cross-origin redirects cannot be inspected.';
        const openButton = browserDocument.createElement( 'button' );
        openButton.type = 'button';
        openButton.textContent = 'Open separately';
        openButton.addEventListener( 'click', function(){
            //Letting the user choose the explicit external fallback even if embedding is blocked
            externalOpen( targetUrl );

        });
        const closeButton = browserDocument.createElement( 'button' );
        closeButton.type = 'button';
        closeButton.textContent = 'Close';
        closeButton.addEventListener( 'click', closeViewer );
        headerNode.append( originNode, openButton, closeButton );
        const noticeNode = browserDocument.createElement( 'p' );
        noticeNode.textContent = 'This website may prohibit embedding. Use Open separately if it does not appear.';
        const frameNode = browserDocument.createElement( 'iframe' );
        frameNode.title = 'External content from ' + targetUrl.origin;
        frameNode.setAttribute( 'sandbox', 'allow-scripts allow-forms allow-same-origin' );
        frameNode.setAttribute( 'allow', "camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'" );
        frameNode.referrerPolicy = 'no-referrer';
        frameNode.src = targetUrl.href;
        viewerNode.append( headerNode, noticeNode, frameNode );
        viewerNode.addEventListener( 'cancel', function( cancelEvent ){
            //Handling Escape with the same idempotent cleanup and focus restoration
            cancelEvent.preventDefault();
            closeViewer();

        });
        viewerNode.addEventListener( 'close', function(){
            //Cleaning up a native close without closing a newer replacement modal
            if ( dialogNode === viewerNode ){
                closeViewer();

            }

        });
        rootNode.append( viewerNode );
        dialogNode = viewerNode;
        viewerOwner = ownerData;
        try {
            //Entering the native top layer only after the viewer is connected to the app root
            viewerNode.showModal();
            closeButton.focus({preventScroll: true});

        } catch( modalError ){
            //Leaving no partial modal after a failed browser transition
            void modalError;
            closeViewer();
            return resultCreate( targetUrl.href, 'blocked', 'viewer-unavailable' );

        }

        //CallBack THE OBJECT
        return resultCreate( targetUrl.href, 'viewer-opened', 'embedding-not-verifiable' );

    };

    /** @param {string} urlData @param {{mode?: LayerLinkMode}} openOptions @param {object} ownerData @param {HTMLElement | null} [focusTarget] */
    //Function for applying the configured route and external-link policy
    const openInternal = async function( urlData, openOptions, ownerData, focusTarget = null ){
        //Rejecting late or unknown requests before acquiring browser resources
        if ( disposedStatus ){
            throw new TypeError( 'Links controller is disposed.' );

        }
        if ( openOptions === null || typeof openOptions !== 'object' || Array.isArray( openOptions ) ||
            Object.keys( openOptions ).some(function( fieldData ){
                //Finding unsupported public navigation options
                return fieldData !== 'mode';

            }) ){
            throw new TypeError( 'Link options support only mode.' );

        }
        const modeData = openOptions.mode ?? 'auto';
        if ( !['auto', 'app', 'viewer', 'external'].includes( modeData ) ){
            throw new TypeError( 'Link mode is invalid.' );

        }
        let targetUrl;
        try {
            //Converting expected unsafe URL rejection into a safe action result
            targetUrl = urlCreate( urlData );

        } catch( urlError ){
            void urlError;
            return resultCreate( '', 'blocked', 'url-denied' );

        }
        const appOriginStatus = targetUrl.origin === browserWindow.location.origin;
        const appRouteStatus = appOriginStatus && targetUrl.pathname.startsWith( scopePath ) &&
            linkOptions.resolve( targetUrl.pathname ) !== null;
        if ( modeData === 'app' || (modeData === 'auto' && appRouteStatus) ){
            //Using the application's existing guards and renderer instead of replacing the document
            if ( appRouteStatus ){
                const routeUrl = targetUrl.pathname + targetUrl.search + targetUrl.hash;
                if ( routeUrl === browserWindow.location.pathname + browserWindow.location.search + browserWindow.location.hash && readyStatus ){
                    //Completing a duplicate launch without mounting the same route again
                    return resultCreate( targetUrl.href, 'navigated', 'already-current' );

                }
                closeViewer();
                const navigationResult = await linkOptions.navigate( routeUrl );
                if ( navigationResult.status !== 'ready' ){
                    //Reporting guarded, offline and superseded boundaries without bypassing them
                    return resultCreate( targetUrl.href, 'blocked', navigationResult.status );

                }

                //CallBack THE OBJECT
                return resultCreate( targetUrl.href, 'navigated', 'router' );

            }
            if ( !configuration.scopeExtensions.includes( targetUrl.origin ) ){
                //CallBack THE OBJECT
                return resultCreate( targetUrl.href, 'blocked', 'app-scope-denied' );

            }

        }
        if ( (modeData === 'auto' || modeData === 'app') && !appOriginStatus && configuration.scopeExtensions.includes( targetUrl.origin ) ){
            //Letting the browser enforce related-origin scope instead of calling the local router
            browserWindow.location.assign( targetUrl.href );

            //CallBack THE OBJECT
            return resultCreate( targetUrl.href, 'external-requested', 'related-origin-navigation' );

        }
        if ( modeData === 'viewer' || (modeData === 'auto' && configuration.external.mode === 'viewer' &&
            !appOriginStatus && configuration.external.allowedOrigins.includes( targetUrl.origin )) ){
            //Opening only explicitly permitted external content in the application modal
            const viewerResult = viewerOpen( targetUrl, ownerData, focusTarget );
            if (modeData === 'auto' && viewerResult.reason === 'viewer-unavailable') {
                //Falling back only for a known local capability failure, not guessed remote embedding errors
                return externalOpen(targetUrl);

            }
            return viewerResult;

        }

        //Requesting a platform context without treating its window handle as proof of success
        return externalOpen( targetUrl );

    };

    /** @param {string} urlData */
    //Function for retaining one incoming route until the application router is ready
    const launch = async function( urlData ){
        //Rejecting native callbacks after the application's lifetime has ended
        if (disposedStatus) {
            throw new TypeError('Links controller is disposed.');

        }
        let validatedTarget;
        try {
            //Bounding an incoming native URL before retaining it during startup
            validatedTarget = urlCreate(urlData).href;

        } catch (launchUrlError) {
            //Dropping unsafe launch input without storing or reflecting it
            void launchUrlError;
            return resultCreate('', 'blocked', 'url-denied');

        }
        //Replacing only the pending startup URL, not a durable command or file queue
        if ( !readyStatus ){
            pendingLaunchUrl = validatedTarget;

            //CallBack THE OBJECT
            return resultCreate( '', 'blocked', 'router-not-ready' );

        }

        //CallBack THE OBJECT
        return openInternal( validatedTarget, {mode: 'app'}, applicationOwner );

    };
    const controller = Object.freeze({
        /** Open an app route, a permitted viewer, or a user-initiated external context. */
        open: function( /** @type {string} */ urlData, /** @type {{mode?: LayerLinkMode}} */ openOptions = {} ){
            //Using the shared application owner for infrastructure calls
            return openInternal( urlData, openOptions, applicationOwner );

        },
        closeViewer,
        /** Infrastructure anchor entry; preserves trigger focus even when WebKit blurs it before click. */
        openAnchor: function( /** @type {HTMLAnchorElement} */ anchorNode, /** @type {{mode?: LayerLinkMode}} */ openOptions = {} ){
            //Accepting only a connected anchor from the owning document
            if (anchorNode.ownerDocument !== browserDocument || !anchorNode.isConnected || anchorNode.tagName !== 'A') {
                throw new TypeError('A connected document anchor is required.');

            }
            return openInternal(anchorNode.href, openOptions, applicationOwner, anchorNode);

        },
        getCapability,
        launch,
        /** @param {boolean} [manualConsumerStatus] */
        ready: async function( manualConsumerStatus = false ){
            //Keeping late startup completion from reviving released state
            if (disposedStatus) {
                throw new TypeError('Links controller is disposed.');

            }
            //Flushing the latest startup route only when the application has not taken launch ownership
            readyStatus = true;
            const targetUrl = pendingLaunchUrl;
            pendingLaunchUrl = null;
            if ( targetUrl !== null && !manualConsumerStatus ){
                await launch( targetUrl );

            }

        },
        createOwner: function(){
            //Acquiring an independent component lifetime without disposing the shared controller
            const ownerData = {};
            let ownerDisposed = false;
            return Object.freeze({
                open: function( /** @type {string} */ urlData, /** @type {{mode?: LayerLinkMode}} */ openOptions = {} ){
                    //Rejecting use after the component has released its viewer ownership
                    if ( ownerDisposed ){
                        throw new TypeError( 'Links owner is disposed.' );

                    }
                    return openInternal( urlData, openOptions, ownerData );

                },
                closeViewer: function(){
                    //Closing only the viewer opened by this component
                    if ( viewerOwner !== ownerData ){
                        return false;

                    }
                    return closeViewer();

                },
                getCapability,
                dispose: function(){
                    //Releasing a component-owned viewer without affecting other owners
                    if ( ownerDisposed ){
                        return false;

                    }
                    ownerDisposed = true;
                    if ( viewerOwner === ownerData ){
                        closeViewer();

                    }
                    return true;

                }
            });

        },
        dispose: function(){
            //Ending shared modal ownership and dropping pending startup routing
            if ( disposedStatus ){
                return false;

            }
            disposedStatus = true;
            pendingLaunchUrl = null;
            closeViewer();
            return true;

        }
    });

    //CallBack THE OBJECT
    return controller;

};
