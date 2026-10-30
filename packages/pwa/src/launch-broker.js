import {LayerPwaError} from './pwa-error.js';

/** @typedef {Readonly<{targetUrl: string | null, files: readonly FileSystemHandle[]}>} LayerLaunchData */
/**
 * @typedef {Readonly<{
 *     setConsumer: (consumer: (data: LayerLaunchData) => unknown) => void,
 *     setFileConsumer: (consumer: (files: readonly FileSystemHandle[], targetUrl: string | null) => unknown) => void,
 *     setDefaultConsumer: (consumer: (data: LayerLaunchData) => unknown) => void,
 *     hasConsumer: () => boolean, startupComplete: () => void, dispose: () => boolean
 * }>} LayerLaunchBroker
 */
const queueBrokers = /** @type {WeakMap<object, LayerLaunchBroker>} */ (new WeakMap());


/** @param {any} queueData @param {(errorData: unknown) => void} [errorReport] @returns {LayerLaunchBroker} */
//Function for sharing one native launch consumer across router, files and application callbacks
export const layerLaunchBrokerCreate = function( queueData, errorReport ){
    //Reusing the document queue owner instead of installing another native consumer
    if ( queueData && queueBrokers.has( queueData ) ){
        //CallBack THE OBJECT
        return /** @type {LayerLaunchBroker} */ (queueBrokers.get( queueData ));

    }
    let disposedStatus = false;
    let connectedStatus = false;
    let launchConsumer = /** @type {null | ((data: LayerLaunchData) => unknown)} */ (null);
    let fileConsumer = /** @type {null | ((files: readonly FileSystemHandle[], targetUrl: string | null) => unknown)} */ (null);
    let defaultConsumer = /** @type {null | ((data: LayerLaunchData) => unknown)} */ (null);
    let startupStatus = true;
    let pendingLaunch = /** @type {LayerLaunchData | null} */ (null);
    const pendingFiles = /** @type {LayerLaunchData[]} */ ([]);

    /** @param {unknown} errorData */
    //Function for reporting callback failures without preventing independent delivery
    const failureReport = function( errorData ){
        //Keeping consumer failures observable without logging URLs, files or stack traces by default
        if ( typeof errorReport === 'function' ){
            try {
                //Delivering the trusted application's diagnostic callback independently
                errorReport( errorData );

            } catch( reporterError ){
                //Reporting a broken diagnostic hook without exposing its exception text
                void reporterError;
                console.warn( 'Layer launch diagnostic failed: PWA_LAUNCH_CONSUMER_FAILED.' );

            }

        } else {
            //Reporting only the stable failure category for an unhandled callback
            console.warn( 'Layer launch consumer failed: PWA_LAUNCH_CONSUMER_FAILED.' );

        }

    };

    /** @param {() => unknown} consumerInvoke */
    //Function for isolating both synchronous throws and asynchronous callback rejections
    const consumerDeliver = function( consumerInvoke ){
        //Calling immediately so existing synchronous consumers retain their observable timing
        try {
            //Observing eventual failures without serializing unrelated launch consumers
            const resultData = consumerInvoke();
            void Promise.resolve( resultData ).catch( failureReport );

        } catch( consumerError ){
            //Reporting one failure while allowing remaining consumers to receive the event
            failureReport( consumerError );

        }

    };

    //Function for acquiring the browser queue lazily after at least one consumer is registered
    const connect = function(){
        //Rejecting unavailable or released resources before changing native browser ownership
        if ( disposedStatus || typeof queueData?.setConsumer !== 'function' ){
            //Passing the missing capability to the explicit API caller
            throw new LayerPwaError( 'PWA_CAPABILITY_UNAVAILABLE', 'Launch Queue is unavailable.' );

        }
        if ( connectedStatus ){
            //Completing an already connected registration
            return;

        }
        connectedStatus = true;
        queueData.setConsumer(function( /** @type {any} */ launchData ){
            //Ignoring late deliveries after the owning application has closed
            if ( disposedStatus ){
                //Completing the inactive delivery
                return;

            }
            let targetUrl = /** @type {string | null} */ (null);
            if ( typeof launchData?.targetURL === 'string' ){
                targetUrl = launchData.targetURL;

            }
            const normalizedData = Object.freeze({
                targetUrl,
                files: /** @type {readonly FileSystemHandle[]} */ (Object.freeze( Array.from( launchData?.files ?? [] ) ))
            });
            //Retaining cold-start events until onReady can register the application's consumers
            if (startupStatus && launchConsumer === null && defaultConsumer !== null) {
                pendingLaunch = normalizedData;

            }
            if (fileConsumer === null && normalizedData.files.length > 0) {
                if (pendingFiles.length >= 32) {
                    //Reporting bounded queue exhaustion instead of allocating indefinitely
                    failureReport(new LayerPwaError('PWA_LAUNCH_QUEUE_LIMIT', 'Too many pending file launches.'));

                } else {
                    pendingFiles.push(normalizedData);

                }

            }
            if ( fileConsumer !== null ){
                //Delivering file metadata even when this launch has no file handles
                const selectedConsumer = fileConsumer;
                consumerDeliver(function(){
                    //Calling the currently registered file adapter
                    return selectedConsumer( normalizedData.files, normalizedData.targetUrl );

                });

            }
            let selectedLaunchConsumer = defaultConsumer;
            if ( launchConsumer !== null ){
                //Giving an explicit application consumer priority over automatic URL navigation
                selectedLaunchConsumer = launchConsumer;

            }
            if ( selectedLaunchConsumer !== null ){
                //Delivering to the application or router without overwriting the file adapter
                const selectedConsumer = selectedLaunchConsumer;
                consumerDeliver(function(){
                    //Calling the selected launch adapter with an immutable envelope
                    return selectedConsumer( normalizedData );

                });

            }

        });

    };
    const broker = Object.freeze({
        /** @param {(data: LayerLaunchData) => unknown} consumer */
        setConsumer: function( consumer ){
            //Validating the callback before replacing the application-owned subscription
            if ( typeof consumer !== 'function' ){
                throw new TypeError( 'Application launch consumer must be a function.' );

            }
            launchConsumer = consumer;
            connect();
            if (pendingLaunch !== null) {
                //Replaying the latest startup envelope before automatic router readiness
                const replayData = pendingLaunch;
                pendingLaunch = null;
                consumerDeliver(function(){
                    //Delivering startup data to the newly selected application consumer
                    return consumer(replayData);

                });

            }

        },
        /** @param {(files: readonly FileSystemHandle[], targetUrl: string | null) => unknown} consumer */
        setFileConsumer: function( consumer ){
            //Validating the callback before replacing the file-owned subscription
            if ( typeof consumer !== 'function' ){
                throw new TypeError( 'File launch consumer must be a function.' );

            }
            fileConsumer = consumer;
            connect();
            for (const replayData of pendingFiles.splice(0)) {
                //Delivering queued native files exactly once to the first registered adapter
                consumerDeliver(function(){
                    //Forwarding the retained file metadata without a second native consumer
                    return consumer(replayData.files, replayData.targetUrl);

                });

            }

        },
        /** @param {(data: LayerLaunchData) => unknown} consumer */
        setDefaultConsumer: function( consumer ){
            //Registering router delivery without consuming the application's callback slot
            if ( typeof consumer !== 'function' ){
                throw new TypeError( 'Default launch consumer must be a function.' );

            }
            defaultConsumer = consumer;
            connect();

        },
        hasConsumer: function(){
            //Reporting manual URL ownership before the host flushes startup navigation
            return launchConsumer !== null;

        },
        startupComplete: function(){
            //Dropping only the already resolved cold-start URL, not undelivered file handles
            startupStatus = false;
            pendingLaunch = null;

        },
        dispose: function(){
            //Releasing callbacks while leaving the browser's unremovable native hook inert
            if ( disposedStatus ){
                //CallBack THE BOOLEAN
                return false;

            }
            disposedStatus = true;
            launchConsumer = null;
            fileConsumer = null;
            defaultConsumer = null;
            pendingLaunch = null;
            pendingFiles.length = 0;
            if ( queueData ){
                queueBrokers.delete( queueData );

            }

            //CallBack THE BOOLEAN
            return true;

        }
    });
    if ( queueData ){
        //Recording this queue's single document-owned native adapter
        queueBrokers.set( queueData, broker );

    }

    //CallBack THE OBJECT
    return broker;

};
