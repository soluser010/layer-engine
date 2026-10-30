import {LAYER_ERROR_CODES, LayerError} from '@solcorp/layer-protocol';


const errorTypes = new Set([
    'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
    'URIError', 'AggregateError', 'AbortError', 'TimeoutError', 'LayerError'
]);
const technicalCodes = new Set([
    ...Object.values( LAYER_ERROR_CODES ), 'REQUEST_ABORTED', 'ABORT_ERR', 'ECONNRESET',
    'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
    'EAI_AGAIN', 'ERR_HTTP_HEADERS_SENT', 'ERR_STREAM_WRITE_AFTER_END', 'ERR_INVALID_ARG_TYPE'
]);


/** @param {unknown} codeData */
export const layerDiagnosticCodeCheck = function( codeData ){
    //Allowing known framework/transport codes and bounded PostgreSQL SQLSTATE identifiers only
    return typeof codeData === 'string' &&
        (technicalCodes.has( codeData ) || /^[0-9]{2}[A-Z0-9]{3}$/.test( codeData ));

};

/** @param {unknown} errorData */
export const layerRequestFailureDescribe = function( errorData ){
    //Keeping diagnostic facts separate from messages, SQL, URLs, headers and arbitrary properties
    const failureData = /** @type {Record<string, string>} */ ({errorType: 'Error'});
    const visitedErrors = new Set();
    let currentError = errorData;
    for ( let causeIndex = 0; causeIndex < 4; causeIndex += 1 ){
        //Stopping cyclic and primitive cause chains before examining any technical fields
        if ( currentError === null || typeof currentError !== 'object' || visitedErrors.has( currentError ) ){
            break;

        }

        visitedErrors.add( currentError );
        try {
            //Reading only allowlisted technical metadata from trusted runtime errors
            const typedError = /** @type {{name?: unknown, code?: unknown, cause?: unknown}} */ (currentError);
            let errorType = 'Error';
            if ( typeof typedError.name === 'string' && errorTypes.has( typedError.name ) ){
                errorType = typedError.name;

            }

            let typeField = 'causeType';
            let codeField = 'causeCode';
            if ( causeIndex === 0 ){
                typeField = 'errorType';
                codeField = 'errorCode';

            }

            failureData[typeField] = errorType;
            if ( layerDiagnosticCodeCheck( typedError.code ) ){
                failureData[codeField] = String( typedError.code );

            }

            //Following the private Layer cause accessor without making causes public or enumerable
            if ( currentError instanceof LayerError ){
                currentError = currentError.internalCauseGet();

            } else {
                currentError = typedError.cause;

            }

        } catch( inspectionError ){
            //A hostile getter cannot make failure reporting throw or expose its exception message
            void inspectionError;
            break;

        }

    }

    //CallBack THE OBJECT
    return failureData;

};

/** @param {import('node:http').IncomingMessage} requestData @param {unknown} errorData */
export const layerRequestBodyAbortCheck = function( requestData, errorData ){
    //Never disguising validation failures or completed requests as a disconnected client
    if ( requestData.complete === true || errorData instanceof LayerError ||
        errorData === null || typeof errorData !== 'object' ){
        return false;

    }

    //Recognizing transport failures only inside the request-body reader
    const failureCode = /** @type {{code?: unknown}} */ (errorData).code;
    return ['ECONNRESET', 'EPIPE', 'ABORT_ERR', 'ERR_STREAM_PREMATURE_CLOSE'].includes( String( failureCode ) );

};
