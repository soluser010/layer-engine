import {
    LAYER_ERROR_CODES,
    LayerError
} from '@solcorp/layer-protocol';
import {layerRequestBodyAbortCheck} from './request-failure.js';

/**
 * @param {unknown} inputData
 * @param {number} maximumDepth
 * @returns {boolean}
 */
function jsonDepthCheck(inputData, maximumDepth) {
    const pendingValues = [
        {
            value: inputData,
            depth: 1
        }
    ];

    //Walking parsed JSON iteratively to avoid recursive stack exhaustion.
    while (pendingValues.length > 0) {
        const currentItem = pendingValues.pop();

        if (currentItem === undefined) {
            continue;

        }

        if (currentItem.depth > maximumDepth) {
            return false;

        }

        if (typeof currentItem.value !== 'object' || currentItem.value === null) {
            continue;

        }

        for (const childValue of Object.values(currentItem.value)) {
            pendingValues.push({
                value: childValue,
                depth: currentItem.depth + 1
            });

        }

    }

    return true;

}

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {{maximumBytes: number, maximumDepth: number}} bodyOptions
 */
export async function layerRequestBodyRead(request, bodyOptions) {
    const contentType = request.headers['content-type'];

    //Requiring the exact JSON media type for the unified API endpoint.
    if (contentType === undefined || contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
        throw new LayerError(
            LAYER_ERROR_CODES.INVALID_ENVELOPE,
            'Content-Type application/json is required.',
            {
                status: 415
            }
        );

    }

    const contentLengthHeader = request.headers['content-length'];
    let contentLength = null;

    //Parsing an explicitly declared length without assuming its presence.
    if (contentLengthHeader !== undefined) {
        contentLength = Number(contentLengthHeader);

    }

    //Rejecting declared oversized or malformed bodies before reading the stream.
    if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength < 0)) {
        throw new LayerError(
            LAYER_ERROR_CODES.INVALID_ENVELOPE,
            'Content-Length is invalid.',
            {
                status: 400
            }
        );

    }

    if (contentLength !== null && contentLength > bodyOptions.maximumBytes) {
        throw new LayerError(
            LAYER_ERROR_CODES.REQUEST_TOO_LARGE,
            'The request body is too large.',
            {
                status: 413
            }
        );

    }

    const bodyChunks = [];
    let bodySize = 0;

    //Reading only within this transport boundary so dependency resets cannot be mistaken for client aborts
    try {
        for await (const bodyChunk of request) {
            let bodyBuffer;

            //Normalizing stream chunks before counting actual bytes.
            if (Buffer.isBuffer(bodyChunk)) {
                bodyBuffer = bodyChunk;

            } else {
                bodyBuffer = Buffer.from(bodyChunk);

            }

            bodySize += bodyBuffer.length;

            if (bodySize > bodyOptions.maximumBytes) {
                request.resume();

                throw new LayerError(
                    LAYER_ERROR_CODES.REQUEST_TOO_LARGE,
                    'The request body is too large.',
                    {
                        status: 413
                    }
                );

            }

            bodyChunks.push(bodyBuffer);

        }

    } catch( bodyReadError ){
        //Classifying an incomplete HTTP transport without treating it as an internal handler failure
        if ( layerRequestBodyAbortCheck( request, bodyReadError ) ){
            throw new LayerError( LAYER_ERROR_CODES.REQUEST_ABORTED, 'The request body was interrupted.', {
                cause: bodyReadError,
                status: 400
            });

        }

        //Preserving size, validation and unexpected runtime failures
        throw bodyReadError;

    }

    let bodyData;

    try {
        //Parsing UTF-8 JSON only after the complete bounded body arrives.
        bodyData = JSON.parse(Buffer.concat(bodyChunks, bodySize).toString('utf8'));

    } catch (bodyParseError) {
        throw new LayerError(
            LAYER_ERROR_CODES.INVALID_ENVELOPE,
            'The request body is not valid JSON.',
            {
                cause: bodyParseError,
                status: 400
            }
        );

    }

    //Checking object depth before schema compilation or application work.
    if (!jsonDepthCheck(bodyData, bodyOptions.maximumDepth)) {
        throw new LayerError(
            LAYER_ERROR_CODES.INVALID_ENVELOPE,
            'The request body exceeds the maximum depth.',
            {
                status: 400
            }
        );

    }

    return bodyData;

}
