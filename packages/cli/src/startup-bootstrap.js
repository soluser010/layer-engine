/** @param {any} browserWindow @param {any} configuration */
//Function for presenting the first verified installation before the application module loads
export const layerStartupBootstrapCreate = function( browserWindow, configuration ){
    //Keeping one private owner per document without registering a second Service Worker
    const key = Symbol.for( 'layer.startup.bootstrap' );
    if ( browserWindow[key] || configuration.enabled === false ){
        return browserWindow[key] ?? null;

    }
    const document = browserWindow.document;
    const container = browserWindow.navigator.serviceWorker;
    const scopeUrl = new URL( configuration.scope, browserWindow.location.href ).href;
    const scriptUrl = new URL( '/layer-service-worker.js', browserWindow.location.href ).href;
    const manifest = configuration.manifest;
    const russian = /^ru(?:-|$)/iu.test( manifest.lang ?? document.documentElement.lang );
    let failureText = 'The application could not start.';
    let retryText = 'Retry';
    let progressLabel = 'Preparing application';
    if ( russian ){
        //Localizing only infrastructure copy, never exposing a thrown application error
        failureText = 'Не удалось открыть приложение.';
        retryText = 'Повторить';
        progressLabel = 'Подготовка приложения';

    }
    const blocked = new Map();
    const workers = new Map();
    const requests = new Set();
    let registration = /** @type {any} */ (null);
    let appReady = false;
    let bypass = false;
    let firstInstall = false;
    let cacheReady = false;
    let readyWorker = /** @type {any} */ (null);
    let completed = 0;
    let total = 0;
    let phase = 'checking';
    let disposed = false;
    let failed = false;
    let startupElapsed = 0;
    let stalledElapsed = 0;
    let lastTick = browserWindow.performance.now();
    let visible = document.visibilityState !== 'hidden';
    let frame = 0;
    let screen = /** @type {any} */ (null);
    let percentage = /** @type {any} */ (null);
    let content = /** @type {any} */ (null);
    let timer = 0;

    //Painting an opaque app background while the registration lookup is still pending
    document.documentElement.setAttribute( 'data-layer-startup', '' );
    const probe = document.createElement( 'span' );
    probe.style.color = 'white';
    if ( typeof manifest.background_color === 'string' && manifest.background_color.length <= 64 ){
        probe.style.color = manifest.background_color;

    }
    document.documentElement.append( probe );
    const resolved = browserWindow.getComputedStyle( probe ).color;
    probe.remove();
    const canvas = document.createElement( 'canvas' );
    canvas.width = canvas.height = 1;
    const paint = canvas.getContext( '2d' );
    let channels = [255, 255, 255];
    if ( paint ){
        //Compositing transparent and modern CSS colors onto white to keep the cover opaque
        paint.fillStyle = 'white';
        paint.fillRect( 0, 0, 1, 1 );
        paint.fillStyle = resolved;
        paint.fillRect( 0, 0, 1, 1 );
        channels = Array.from( paint.getImageData( 0, 0, 1, 1 ).data ).slice( 0, 3 );

    }
    const luminance = channels.map(function( value ){
        //Converting sRGB channels before selecting a readable foreground
        const normalized = value / 255;
        if ( normalized <= 0.04045 ){
            return normalized / 12.92;

        }
        return Math.pow( (normalized + 0.055) / 1.055, 2.4 );

    });
    const background = 'rgb(' + channels.join( ',' ) + ')';
    let foreground = 'white';
    if ( (luminance[0] ?? 1) * 0.2126 + (luminance[1] ?? 1) * 0.7152 + (luminance[2] ?? 1) * 0.0722 > 0.179 ){
        foreground = 'black';

    }
    document.documentElement.style.setProperty( '--layer-startup-background', background );

    const lockBody = function(){
        //Preserving existing accessibility attributes while hiding all app-owned body regions
        if ( disposed || !document.body ){
            return;

        }
        for ( const child of document.body.children ){
            if ( child === screen || blocked.has( child ) || ['SCRIPT', 'LINK', 'STYLE'].includes( child.tagName ) ){
                continue;

            }
            blocked.set( child, {inert: child.hasAttribute( 'inert' ), aria: child.getAttribute( 'aria-hidden' )} );
            child.setAttribute( 'inert', '' );
            child.setAttribute( 'aria-hidden', 'true' );

        }

    };
    const observer = new browserWindow.MutationObserver(function(){
        //Showing the cover as soon as the parser creates body, before deferred modules finish loading
        bodyReady();
        lockBody();

    });
    const release = function(){
        //Removing only state owned by this screen without changing renderer or storage lifetimes
        if ( disposed ){
            return;

        }
        disposed = true;
        browserWindow.clearInterval( timer );
        browserWindow.cancelAnimationFrame( frame );
        observer.disconnect();
        document.removeEventListener( 'DOMContentLoaded', bodyReady );
        document.removeEventListener( 'visibilitychange', tick );
        browserWindow.removeEventListener( 'pagehide', release );
        browserWindow.removeEventListener( 'error', resourceError, true );
        container?.removeEventListener( 'message', messageReceive );
        registration?.removeEventListener( 'updatefound', registrationInspect );
        for ( const [worker, listener] of workers ){
            worker.removeEventListener( 'statechange', listener );

        }
        for ( const close of [...requests] ){
            close();

        }
        for ( const [child, original] of blocked ){
            if ( !original.inert ){
                child.removeAttribute( 'inert' );

            }
            if ( original.aria === null ){
                child.removeAttribute( 'aria-hidden' );

            } else {
                child.setAttribute( 'aria-hidden', original.aria );

            }

        }
        screen?.remove();
        document.documentElement.removeAttribute( 'data-layer-startup' );
        document.documentElement.style.removeProperty( '--layer-startup-background' );

    };
    const progressRender = function(){
        //Showing measured file progress, reserving 100 for complete app and worker readiness
        if ( !percentage || failed ){
            return;

        }
        let value = 0;
        if ( total > 0 ){
            value = Math.min( 99, Math.floor( completed / total * 100 ) );

        }
        if ( appReady && cacheReady && registration?.active === readyWorker && readyWorker?.state === 'activated' ){
            value = 100;

        }
        percentage.textContent = value + '%';
        percentage.setAttribute( 'aria-valuenow', String( value ) );
        content.hidden = !firstInstall;
        if ( value === 100 && !frame ){
            frame = browserWindow.requestAnimationFrame( release );

        }

    };
    const settle = function(){
        //Opening a ready app after a tolerated installation failure without claiming offline success
        if ( disposed || failed ){
            return;

        }
        if ( appReady && bypass ){
            release();
            return;

        }
        progressRender();

    };
    const fail = function(){
        //Replacing an unusable startup with one safe localized retry action
        if ( disposed || failed ){
            return;

        }
        bodyReady();
        failed = true;
        if ( !content ){
            return;

        }
        content.hidden = false;
        percentage.removeAttribute( 'role' );
        percentage.removeAttribute( 'aria-valuenow' );
        percentage.removeAttribute( 'aria-label' );
        percentage.removeAttribute( 'aria-valuemin' );
        percentage.removeAttribute( 'aria-valuemax' );
        percentage.textContent = failureText;
        const retry = document.createElement( 'button' );
        retry.type = 'button';
        retry.textContent = retryText;
        retry.addEventListener( 'click', function(){
            //Preserving pathname, query and hash through native reload
            browserWindow.location.reload();

        });
        content.append( retry );

    };
    function bodyReady(){
        //Creating infrastructure beside the renderer root, even when startup failed before parsing body
        if ( disposed || !document.body || screen ){
            return;

        }
        screen = document.createElement( 'section' );
        screen.setAttribute( 'data-layer-startup-screen', '' );
        screen.style.backgroundColor = background;
        screen.style.color = foreground;
        content = document.createElement( 'div' );
        content.hidden = true;
        const iconBox = document.createElement( 'div' );
        iconBox.setAttribute( 'data-layer-startup-icon', '' );
        const initials = document.createElement( 'span' );
        initials.textContent = Array.from( String( manifest.short_name ?? manifest.name ?? 'Application' ).trim() ).slice( 0, 2 ).join( '' ).toUpperCase();
        iconBox.append( initials );
        const icons = (manifest.icons ?? []).filter(function( /** @type {any} */ icon ){
            //Ignoring foreign, credential-bearing and malformed icon URLs
            try {
                const url = new URL( icon.src, browserWindow.location.href );
                return url.origin === browserWindow.location.origin && !url.username && !url.password &&
                    ['https:', 'http:'].includes( url.protocol ) && icon.purpose !== 'monochrome';

            } catch (invalidIcon) {
                void invalidIcon;
                return false;

            }

        });
        const required = 156 * (browserWindow.devicePixelRatio || 1);
        const rank = function( /** @type {any} */ icon ){
            //Choosing SVG first, then an adequate raster image for device pixel density
            if ( icon.type === 'image/svg+xml' || icon.sizes === 'any' ){
                return 0;

            }
            const size = Number( String( icon.sizes ).split( 'x' )[0] ) || 0;
            if ( size >= required ){
                return size;

            }
            return 10000 - size;

        };
        icons.sort(function( /** @type {any} */ first, /** @type {any} */ second ){
            //Ranking the available manifest icons without modifying the manifest
            return rank( first ) - rank( second );

        });
        if ( icons[0] ){
            const image = document.createElement( 'img' );
            image.width = image.height = 156;
            image.alt = '';
            image.src = new URL( icons[0].src, browserWindow.location.href ).href;
            image.addEventListener( 'load', function(){
                //Keeping initials visible until the selected image is available
                initials.hidden = true;

            });
            image.addEventListener( 'error', function(){
                //Retaining a local icon fallback instead of a broken image
                initials.hidden = false;
                image.remove();

            });
            iconBox.append( image );

        }
        percentage = document.createElement( 'output' );
        percentage.setAttribute( 'role', 'progressbar' );
        percentage.setAttribute( 'aria-label', progressLabel );
        percentage.setAttribute( 'aria-valuemin', '0' );
        percentage.setAttribute( 'aria-valuemax', '100' );
        content.append( iconBox, percentage );
        screen.append( content );
        document.body.append( screen );
        observer.disconnect();
        observer.observe( document.body, {childList: true} );
        lockBody();
        if ( failed ){
            //Rendering a failure that happened while the parser had not created body yet
            failed = false;
            fail();
            return;

        }
        settle();

    }
    const statusReceive = function( /** @type {any} */ data, /** @type {any} */ worker ){
        //Accepting only bounded progress for this app and build from its native registration
        if ( disposed || !registration || ![registration.installing, registration.waiting, registration.active].includes( worker ) ||
            worker?.scriptURL !== scriptUrl || data?.appKey !== configuration.appKey || data?.buildId !== configuration.buildId ||
            !['downloading', 'verifying', 'ready', 'error'].includes( data.phase ) ||
            !Number.isInteger( data.totalFiles ) || data.totalFiles < 1 || data.totalFiles > 10000 ||
            !Number.isInteger( data.completedFiles ) || data.completedFiles < 0 || data.completedFiles > data.totalFiles ||
            (data.phase === 'ready' && data.completedFiles !== data.totalFiles) || data.completedFiles < completed ||
            (cacheReady && data.phase !== 'ready' && data.phase !== 'error') ){
            return;

        }
        if ( phase !== data.phase || data.completedFiles > completed ){
            stalledElapsed = 0;

        }
        phase = data.phase;
        completed = data.completedFiles;
        total = data.totalFiles;
        cacheReady = phase === 'ready';
        if ( cacheReady ){
            readyWorker = worker;

        }
        if ( phase === 'error' ){
            bypass = true;

        }
        settle();

    };
    const snapshotRequest = function( /** @type {any} */ worker ){
        //Recovering missed installation events through the existing bounded worker RPC
        if ( disposed || typeof browserWindow.MessageChannel !== 'function' ){
            return;

        }
        const channel = new browserWindow.MessageChannel();
        const close = function(){
            //Releasing the response channel after delivery, timeout or document disposal
            browserWindow.clearTimeout( timeout );
            channel.port1.close();
            channel.port2.close();
            requests.delete( close );

        };
        const timeout = browserWindow.setTimeout( close, 5000 );
        requests.add( close );
        channel.port1.onmessage = function( /** @type {any} */ event ){
            //Processing only an explicitly successful scoped snapshot
            close();
            if ( event.data?.ok === true ){
                statusReceive( event.data, worker );

            }

        };
        try {
            worker.postMessage({type: 'layer-update-snapshot', appKey: configuration.appKey,
                currentBuildId: configuration.buildId}, [channel.port2]);

        } catch (snapshotError) {
            //Allowing native lifecycle or the bounded stall policy to recover a disappearing worker
            void snapshotError;
            close();

        }

    };
    function registrationInspect(){
        //Observing each native handle once, including a worker already activated during startup
        if ( disposed || !registration ){
            return;

        }
        for ( const worker of [registration.installing, registration.waiting, registration.active] ){
            if ( !worker || worker.scriptURL !== scriptUrl || workers.has( worker ) ){
                continue;

            }
            const changed = function(){
                //Treating a redundant first worker as a failed installation without forcing activation
                stalledElapsed = 0;
                if ( worker.state === 'redundant' && !registration.active ){
                    bypass = true;

                }
                snapshotRequest( worker );
                settle();

            };
            workers.set( worker, changed );
            worker.addEventListener( 'statechange', changed );
            snapshotRequest( worker );

        }
        settle();

    }
    const connect = function( /** @type {any} */ nextRegistration ){
        //Sharing the runtime's registration; null explicitly disables or bypasses installation
        if ( disposed ){
            return;

        }
        if ( !nextRegistration || nextRegistration.scope !== scopeUrl ){
            bypass = true;
            settle();
            return;

        }
        registration?.removeEventListener( 'updatefound', registrationInspect );
        registration = nextRegistration;
        registration.addEventListener( 'updatefound', registrationInspect );
        registrationInspect();

    };
    function messageReceive( /** @type {MessageEvent} */ event ){
        //Ignoring unrelated application messages before inspecting their contents
        if ( event.data?.type === 'layer-update-status' ){
            statusReceive( event.data, event.source );

        }

    }
    function resourceError( /** @type {any} */ event ){
        //Reporting a failed main module without treating unrelated image or widget errors as startup failure
        if ( event.target?.tagName === 'SCRIPT' && event.target.src === new URL( '/_layer/application.mjs', scopeUrl ).href ){
            fail();

        }

    }
    function tick(){
        //Counting only foreground time for both app startup and stalled installation
        const now = browserWindow.performance.now();
        const elapsed = Math.max( 0, now - lastTick );
        lastTick = now;
        if ( visible ){
            startupElapsed += elapsed;
            stalledElapsed += elapsed;

        }
        visible = document.visibilityState !== 'hidden';
        if ( !appReady && startupElapsed >= 60000 ){
            fail();

        } else if ( appReady && stalledElapsed >= 60000 ){
            bypass = true;
            settle();

        }

    }
    const ready = function(){
        //Revealing only after first navigation and application startup hooks have completed
        if ( disposed ){
            return;

        }
        appReady = true;
        const root = document.querySelector( '[data-layer-root]' );
        if ( screen && root ){
            screen.style.font = browserWindow.getComputedStyle( root ).font;

        }
        settle();

    };
    timer = browserWindow.setInterval( tick, 1000 );
    document.addEventListener( 'visibilitychange', tick );
    document.addEventListener( 'DOMContentLoaded', bodyReady, {once: true} );
    browserWindow.addEventListener( 'pagehide', release, {once: true} );
    browserWindow.addEventListener( 'error', resourceError, true );
    observer.observe( document.documentElement, {childList: true} );
    container?.addEventListener( 'message', messageReceive );
    bodyReady();
    const inspection = Promise.resolve().then(function(){
        //Looking up the exact app scope before classifying an uncontrolled page as a first install
        if ( !container?.getRegistration ){
            //Keeping only the app-readiness barrier when Service Worker is unavailable
            bypass = true;
            return null;

        }
        return container.getRegistration( scopeUrl );

    }).then(function( existing ){
        //Skipping the cover entirely for an existing active registration, including waiting updates
        if ( disposed ){
            return;

        }
        if ( existing?.scope === scopeUrl && existing.active ){
            release();
            return;

        }
        firstInstall = !bypass;
        if ( existing?.scope === scopeUrl ){
            connect( existing );

        }
        settle();

    }).catch(function( lookupError ){
        //Allowing online startup when the browser refuses registration inspection
        void lookupError;
        connect( null );

    });
    const api = Object.freeze({inspection, connect, ready, fail, dispose: release});
    browserWindow[key] = api;
    return api;

};
