import {LayerRuntimeError} from './runtime-error.js';


/** @param {unknown} channelData @param {readonly string[]} allowedChannels */
export const layerRecoveryChannelsRead = function( channelData, allowedChannels ){
    //Checking bounded channel names before trusting a server or sibling-tab recovery request
    if ( !Array.isArray( channelData ) || channelData.length === 0 || channelData.length > 100 ){
        //Passing malformed recovery metadata to the owning runtime
        throw new LayerRuntimeError( 'STREAM_RECOVERY_INVALID', 'The snapshot channel list is invalid.' );

    }

    //Creating an allowlisted channel list without accepting prototype keys or foreign subscriptions
    const channelNames = /** @type {string[]} */ ([]);
    for ( const channelName of channelData ){
        //Checking every entry rather than silently accepting a partially valid recovery request
        if ( typeof channelName !== 'string' || !allowedChannels.includes( channelName ) ){
            //Passing an out-of-scope recovery request to the owner without requesting private data
            throw new LayerRuntimeError( 'STREAM_RECOVERY_INVALID', 'The snapshot channel is not subscribed.' );

        }

        //Adding each requested channel only once
        if ( !channelNames.includes( channelName ) ){
            channelNames.push( channelName );

        }

    }

    //CallBack THE OBJECT
    return channelNames;

};

/** @template ResultData @param {Promise<ResultData> | ResultData} pendingResult @param {AbortSignal} signal */
export const layerEventAbortableWait = async function( pendingResult, signal ){
    //Stopping ownership promptly even when an application hook does not observe cancellation
    return new Promise(function( resolve, rejected ){
        //Removing the signal listener on every terminal path while observing late hook rejections
        const abortHandle = function(){
            //Connecting cancellation and completion without running application code
            signal.removeEventListener( 'abort', abortHandle );
            rejected( signal.reason );

        };
        Promise.resolve( pendingResult ).then(function( resultData ){
            //Completing only the still-owned asynchronous action
            signal.removeEventListener( 'abort', abortHandle );
            resolve( resultData );

        }, function( operationError ){
            //Propagating the hook failure without creating an unhandled rejection after abort
            signal.removeEventListener( 'abort', abortHandle );
            rejected( operationError );

        });

        //Observing the pending promise even if ownership was cancelled before this adapter was called
        if ( signal.aborted ){
            abortHandle();

        } else {
            signal.addEventListener( 'abort', abortHandle, {once: true} );

        }

    });

};

/** @param {unknown} errorData */
export const layerEventTerminalFailureCheck = function( errorData ){
    //Keeping authorization and invalid recovery terminal even when a retry callback requests otherwise
    if ( typeof errorData !== 'object' || errorData === null ){
        //CallBack THE BOOLEAN
        return false;

    }

    //Reading only stable transport fields shared by application and runtime errors
    const failureData = /** @type {{status?: unknown, code?: unknown}} */ (errorData);
    return failureData.status === 401 || failureData.status === 403 ||
        ['EVENT_SYNC_REQUIRED', 'STREAM_RECOVERY_INVALID', 'STREAM_RECOVERY_STALLED'].includes( String( failureData.code ) );

};
