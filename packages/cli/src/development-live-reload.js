import {LayerCliError} from './cli-error.js';

const developmentEventsPath = '/_layer/dev/events';
const developmentClientPath = '/_layer/dev-client.mjs';
const developmentStylePath = '/_layer/dev-client.css';
const developmentHeartbeatMs = 15000;
const developmentDiagnosticLimit = 4096;

const developmentClientSource = String.raw`'use strict';

const developmentModuleUrl = new URL( import.meta.url );
const developmentDocumentRevision = Number( developmentModuleUrl.searchParams.get( 'revision' ) || 0 );
let developmentReloadStatus = false;

//Function for enabling network reads in the active Service Worker during development
const layerDevelopmentCacheBypassEnable = function(){
    return new Promise(function developmentCacheBypassCreate(resolve){
        //Checking whether this page is currently controlled by a Service Worker
        const workerController = navigator.serviceWorker?.controller;

        if ( workerController === null || workerController === undefined ){
            //CallBack THE BOOLEAN
            return resolve( false );

        }

        //Creating one acknowledged same-origin message before navigation
        const messageChannel = new MessageChannel();
        const messageTimeout = setTimeout(function developmentCacheBypassTimeout(){
            //Continuing the reload if an older worker does not support acknowledgement
            resolve( false );

        }, 1000);
        messageChannel.port1.addEventListener( 'message', function developmentCacheBypassComplete(){
            clearTimeout( messageTimeout );
            resolve( true );

        }, { once: true } );
        messageChannel.port1.start();
        workerController.postMessage({ type: String( 'development-cache-bypass' ) }, [messageChannel.port2]);

    });

}

//Function for installing the external development overlay stylesheet
const layerDevelopmentStyleInstall = function(){
    //Checking whether this document already owns the stylesheet
    if ( document.querySelector( 'link[data-layer-development-style]' ) !== null ){
        //CallBack THE BOOLEAN
        return false;

    }

    //Creating the same-origin stylesheet without adding an inline CSP exception
    const objectStyleElement = document.createElement( 'link' );
    objectStyleElement.rel = String( 'stylesheet' );
    objectStyleElement.href = String( '/_layer/dev-client.css' );
    objectStyleElement.setAttribute( 'data-layer-development-style', String( 'true' ) );
    document.head.append( objectStyleElement );

    //CallBack THE BOOLEAN
    return true;

}

//Function for showing a bounded build error over the last working document
const layerDevelopmentErrorShow = function( errorData = { code: String(), message: String() } ){
    //Installing the stylesheet before creating the overlay
    layerDevelopmentStyleInstall();

    //Getting or creating the development error overlay
    let objectErrorElement = document.getElementById( 'layer-development-error' );

    if ( objectErrorElement === null ){
        objectErrorElement = document.createElement( 'aside' );
        objectErrorElement.id = String( 'layer-development-error' );
        objectErrorElement.setAttribute( 'role', String( 'alert' ) );
        objectErrorElement.setAttribute( 'aria-live', String( 'assertive' ) );

        const objectErrorTitleElement = document.createElement( 'strong' );
        objectErrorTitleElement.textContent = String( 'Layer build failed' );
        objectErrorElement.append( objectErrorTitleElement );

        const objectErrorMessageElement = document.createElement( 'pre' );
        objectErrorMessageElement.setAttribute( 'data-layer-development-message', String( 'true' ) );
        objectErrorElement.append( objectErrorMessageElement );
        document.body.append( objectErrorElement );

    }

    //Recording only text content so compiler output cannot become markup
    const objectErrorMessageElement = objectErrorElement.querySelector( '[data-layer-development-message]' );

    if ( objectErrorMessageElement !== null ){
        objectErrorMessageElement.textContent = String( errorData.code ) + ': ' + String( errorData.message );

    }

    //Showing the same bounded failure in browser diagnostics
    console.error( 'Layer development build failed:', errorData );

}

//Function for reading one structured development event
const layerDevelopmentEventRead = function( eventData ){
    try {
        //Parsing only the server-owned JSON event data
        return JSON.parse( String( eventData.data ) );

    } catch( error ){
        //Showing malformed internal events without changing the current document
        console.error( 'Layer development event is invalid:', error );

        //CallBack THE BOOLEAN
        return false;

    }

}

//Function for applying the newest successful build revision
const layerDevelopmentRevisionApply = async function( eventData ){
    //Getting the structured revision event
    const eventObjectData = layerDevelopmentEventRead( eventData );

    if ( eventObjectData === false ){
        //CallBack THE BOOLEAN
        return false;

    }

    //Getting the bounded numeric build revision
    const buildRevisionData = Number( eventObjectData.revision );

    if (
        Number.isSafeInteger( buildRevisionData ) === false ||
        Number( buildRevisionData ) <= Number( developmentDocumentRevision ) ||
        developmentReloadStatus === true
    ){
        //CallBack THE BOOLEAN
        return false;

    }

    //Preventing duplicate reloads from ready and build events
    developmentReloadStatus = true;

    //Enabling network reads before the controlling worker handles the reload
    await layerDevelopmentCacheBypassEnable();

    //Reloading the current URL after the atomic build has completed
    window.location.reload();

    //CallBack THE BOOLEAN
    return true;

}

//Creating the same-origin development event stream
const layerDevelopmentEvents = new EventSource( String( '/_layer/dev/events' ) );
layerDevelopmentEvents.addEventListener( 'layer-ready', layerDevelopmentRevisionApply );
layerDevelopmentEvents.addEventListener( 'layer-build', layerDevelopmentRevisionApply );
layerDevelopmentEvents.addEventListener( 'layer-error', function( eventData ){
    //Getting the structured build failure
    const eventObjectData = layerDevelopmentEventRead( eventData );

    if ( eventObjectData === false ){
        return;

    }

    //Showing the failure without replacing the last working document
    layerDevelopmentErrorShow( eventObjectData );

});

//Preparing the active worker before any later development rebuild
void layerDevelopmentCacheBypassEnable();

window.addEventListener( 'beforeunload', function(){
    //Closing the stream before this document is discarded
    layerDevelopmentEvents.close();

}, { once: true } );
`;

const developmentClientStyle = String.raw`#layer-development-error {
    position: fixed;
    right: 16px;
    bottom: 16px;
    left: 16px;
    z-index: 2147483647;
    display: grid;
    gap: 8px;
    max-height: min(50vh, 480px);
    padding: 16px;
    overflow: auto;
    color: #fee2e2;
    background: #450a0a;
    border: 1px solid #ef4444;
    border-radius: 10px;
    box-shadow: 0 20px 40px rgb(0 0 0 / 35%);
    font: 14px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
}

#layer-development-error strong {
    color: #ffffff;
    font-size: 15px;
}

#layer-development-error pre {
    margin: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}
`;

/**
 * @param {import('node:http').ServerResponse} responseData
 * @param {string} eventName
 * @param {Readonly<Record<string, unknown>>} eventData
 */
function developmentEventSend(responseData, eventName, eventData) {
    //Writing one bounded SSE event through the active response.
    responseData.write(`event: ${eventName}\ndata: ${JSON.stringify(eventData)}\n\n`);

}

/**
 * @param {unknown} buildError
 */
function developmentErrorCreate(buildError) {
    let errorCode = 'CLI_DEV_BUILD_FAILED';
    let errorMessage = 'The development build could not be completed.';

    //Keeping stable CLI diagnostics while excluding stack and cause data.
    if (buildError instanceof LayerCliError) {
        errorCode = buildError.code;
        errorMessage = buildError.message;

    } else if (buildError instanceof Error && buildError.message.length > 0) {
        errorMessage = buildError.message;

    }

    return Object.freeze({
        code: String(errorCode).slice(0, 128),
        message: String(errorMessage).slice(0, developmentDiagnosticLimit)
    });

}

/**
 * @param {{heartbeatMs?: number}} [liveReloadOptions]
 */
export function layerDevelopmentLiveReloadCreate(liveReloadOptions = {}) {
    const heartbeatMs = liveReloadOptions.heartbeatMs ?? developmentHeartbeatMs;

    if (!Number.isInteger(heartbeatMs) || heartbeatMs < 1000 || heartbeatMs > 60000) {
        throw new TypeError('Development heartbeatMs must be between 1000 and 60000.');

    }

    const clientResponses = /** @type {Set<import('node:http').ServerResponse>} */ (new Set());
    let buildRevision = 0;
    let closedStatus = false;
    const heartbeatTimer = setInterval(function developmentHeartbeatSend() {
        //Keeping active development streams visible to proxies and browsers.
        for (const responseData of clientResponses) {
            responseData.write(': heartbeat\n\n');

        }

    }, heartbeatMs);
    heartbeatTimer.unref();

    /**
     * @param {string} eventName
     * @param {Readonly<Record<string, unknown>>} eventData
     */
    function eventBroadcast(eventName, eventData) {
        //Sending the event to every currently connected development page.
        for (const responseData of clientResponses) {
            developmentEventSend(responseData, eventName, eventData);

        }

    }

    return Object.freeze({
        get revision() {
            //Exposing the current document revision without allowing mutation.
            return buildRevision;

        },

        buildReady() {
            //Recording the completed atomic build before notifying browsers.
            buildRevision += 1;
            eventBroadcast('layer-build', Object.freeze({revision: buildRevision}));

            return buildRevision;

        },

        /**
         * @param {unknown} buildError
         */
        buildFailed(buildError) {
            //Sending a safe diagnostic while the previous build remains active.
            const errorData = developmentErrorCreate(buildError);
            eventBroadcast('layer-error', errorData);

            return errorData;

        },

        /**
         * @param {Buffer} documentContent
         */
        documentInject(documentContent) {
            //Creating one external module reference with the served document revision.
            const documentSource = documentContent.toString('utf8');
            const clientElement = `<script type="module" src="${developmentClientPath}?revision=${buildRevision}"></script>`;
            const bodyClosingIndex = documentSource.toLowerCase().lastIndexOf('</body>');

            if (bodyClosingIndex < 0) {
                return Buffer.from(`${documentSource}\n${clientElement}\n`, 'utf8');

            }

            return Buffer.from(
                `${documentSource.slice(0, bodyClosingIndex)}${clientElement}\n${documentSource.slice(bodyClosingIndex)}`,
                'utf8'
            );

        },

        /**
         * @param {import('node:http').IncomingMessage} requestData
         * @param {import('node:http').ServerResponse} responseData
         * @param {string} requestPath
         */
        requestHandle(requestData, responseData, requestPath) {
            if (requestPath === developmentClientPath) {
                //Serving the generated client outside the production artifact set.
                let responseContent;

                if (requestData.method === 'HEAD') {
                    //Returning only metadata for a development client HEAD request.
                    responseContent = undefined;

                } else {
                    //Returning the generated client for a development client GET request.
                    responseContent = developmentClientSource;

                }

                responseData.statusCode = 200;
                responseData.setHeader('Content-Type', 'text/javascript; charset=utf-8');
                responseData.setHeader('Content-Length', String(Buffer.byteLength(developmentClientSource)));
                responseData.end(responseContent);

                return true;

            }

            if (requestPath === developmentStylePath) {
                //Serving CSP-compatible overlay styles outside the production artifact set.
                let responseContent;

                if (requestData.method === 'HEAD') {
                    //Returning only metadata for a development stylesheet HEAD request.
                    responseContent = undefined;

                } else {
                    //Returning the generated stylesheet for a development stylesheet GET request.
                    responseContent = developmentClientStyle;

                }

                responseData.statusCode = 200;
                responseData.setHeader('Content-Type', 'text/css; charset=utf-8');
                responseData.setHeader('Content-Length', String(Buffer.byteLength(developmentClientStyle)));
                responseData.end(responseContent);

                return true;

            }

            if (requestPath !== developmentEventsPath) {
                return false;

            }

            if (requestData.method === 'HEAD') {
                //Returning the stream metadata without retaining a HEAD response.
                responseData.statusCode = 200;
                responseData.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
                responseData.end();

                return true;

            }

            //Opening one no-cache same-origin development event stream.
            responseData.statusCode = 200;
            responseData.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            responseData.setHeader('Connection', 'keep-alive');
            responseData.setHeader('X-Accel-Buffering', 'no');
            responseData.flushHeaders();
            clientResponses.add(responseData);
            developmentEventSend(responseData, 'layer-ready', Object.freeze({revision: buildRevision}));

            responseData.once('close', function developmentClientClose() {
                //Releasing the disconnected browser response.
                clientResponses.delete(responseData);

            });

            return true;

        },

        close() {
            //Closing the heartbeat and every owned SSE response exactly once.
            if (closedStatus) {
                return false;

            }

            closedStatus = true;
            clearInterval(heartbeatTimer);

            for (const responseData of clientResponses) {
                responseData.end();

            }

            clientResponses.clear();

            return true;

        }
    });

}

export const layerDevelopmentLiveReloadPaths = Object.freeze({
    client: developmentClientPath,
    events: developmentEventsPath,
    style: developmentStylePath
});
