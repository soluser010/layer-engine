import {LAYER_PROTOCOL_VERSION} from '@solcorp/layer-protocol/constants';
import {layerProtocolDataValidatorCreate} from '@solcorp/layer-protocol/data-validator';
import {layerEventStreamParserCreate} from './event-stream-parser.js';
import {LayerRuntimeError} from './runtime-error.js';

/**
 * @param {Response} responseData
 * @param {readonly string[]} channels
 */
async function responseErrorCreate( responseData, channels ){
    //Preparing safe defaults before parsing a possibly non-JSON proxy failure
    let errorCode = 'STREAM_HTTP_ERROR';
    let errorMessage = 'The event stream request failed.';
    let requestIdentifier = null;
    let errorDetails = null;
    let retryableStatus = responseData.status === 429 || responseData.status === 503;

    try {
        //Bounding error bytes independently of a server-provided Content-Length
        const reader = responseData.body?.getReader();
        const chunks = [];
        let totalBytes = 0;
        if ( reader !== undefined ){
            try {
                while ( true ){
                    const chunkData = await reader.read();
                    if ( chunkData.done ){
                        break;

                    }

                    totalBytes += chunkData.value.byteLength;
                    if ( totalBytes > 16384 ){
                        //Rejecting oversized error envelopes instead of retaining arbitrary proxy output
                        throw new RangeError( 'The event stream error envelope is too large.' );

                    }

                    chunks.push( chunkData.value );

                }

            } finally {
                //Cancelling unread proxy output and releasing the reader on every error path
                try {
                    await reader.cancel();

                } catch( cancelError ){
                    //The primary parse or network failure already determines the public result
                    void cancelError;

                }

                reader.releaseLock();

            }

        }

        //Decoding only complete bounded error data before inspecting nested values
        const errorBytes = new Uint8Array( totalBytes );
        let offsetData = 0;
        for ( const chunkData of chunks ){
            errorBytes.set( chunkData, offsetData );
            offsetData += chunkData.byteLength;

        }

        const bodyData = JSON.parse( new TextDecoder().decode( errorBytes ) );
        const errorData = bodyData?.error;
        if ( errorData !== null && typeof errorData === 'object' && !Array.isArray( errorData ) ){
            //Preserving only bounded public error fields without copying stack, cause or arbitrary details
            if ( typeof errorData.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test( errorData.code ) ){
                errorCode = errorData.code;

            }

            if ( typeof errorData.message === 'string' && errorData.message.length <= 512 ){
                errorMessage = errorData.message;

            }

            if ( typeof errorData.retryable === 'boolean' ){
                retryableStatus = errorData.retryable;

            }

            //Keeping a validated request identifier for correlation without trusting it as identity
            if ( typeof bodyData.requestId === 'string' &&
                /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test( bodyData.requestId ) ){
                requestIdentifier = bodyData.requestId;

            }

            const recoveryChannels = errorData.details?.channels;
            if ( errorCode === 'CURSOR_EXPIRED' && responseData.status === 409 &&
                Array.isArray( recoveryChannels ) && recoveryChannels.length > 0 && recoveryChannels.length <= 100 &&
                recoveryChannels.every(function( channelName ){
                    //Accepting only channels already requested by this stream
                    return typeof channelName === 'string' && channels.includes( channelName );

                }) ){
                errorDetails = Object.freeze({channels: Object.freeze( [...new Set( recoveryChannels )] )});

            }

        }

    } catch( bodyError ){
        //Keeping the bounded HTTP fallback when proxy output is missing, oversized or malformed
        void bodyError;

    }

    //Honoring finite numeric retry guidance without accepting an unbounded delay
    const retryAfterSeconds = Number( responseData.headers.get( 'retry-after' ) );
    let retryAfterMs = 0;
    if ( Number.isFinite( retryAfterSeconds ) && retryAfterSeconds > 0 ){
        retryAfterMs = Math.min( retryAfterSeconds * 1000, 300000 );

    }

    //Returning a public transport error with the snapshot metadata required by recovery
    return new LayerRuntimeError( errorCode, errorMessage, {
        requestId: requestIdentifier,
        status: responseData.status,
        retryAfterMs,
        retryable: retryableStatus,
        details: errorDetails
    });

}

/**
 * @param {object} streamOptions
 * @param {string} streamOptions.apiUrl
 * @param {typeof fetch} [streamOptions.fetchImplementation]
 * @param {() => string} streamOptions.requestIdCreate
 * @param {() => string | Promise<string>} [streamOptions.csrfTokenGet]
 * @param {number} [streamOptions.inactivityTimeoutMs]
 */
export function layerPostEventStreamCreate(streamOptions) {
    const fetchImplementation = streamOptions.fetchImplementation ?? globalThis.fetch;
    const inactivityTimeoutMs = streamOptions.inactivityTimeoutMs ?? 45000;
    const protocolValidator = layerProtocolDataValidatorCreate();

    return Object.freeze({
        /**
         * @param {object} openData
         * @param {readonly string[]} openData.channels
         * @param {Readonly<Record<string, number>>} openData.cursor
         * @param {AbortSignal} openData.signal
         * @param {(eventData: Record<string, unknown>) => void | Promise<void>} openData.eventHandle
         * @param {(controlData: Record<string, unknown>) => void | Promise<void>} openData.controlHandle
         * @param {() => void | Promise<void>} [openData.heartbeatHandle]
         */
        async open(openData) {
            const requestHeaders = new Headers({
                accept: 'text/event-stream',
                'content-type': 'application/json'
            });

            if (streamOptions.csrfTokenGet !== undefined) {
                requestHeaders.set('x-layer-csrf', await streamOptions.csrfTokenGet());

            }

            const requestData = {
                protocol: LAYER_PROTOCOL_VERSION,
                requestId: streamOptions.requestIdCreate(),
                type: 'events.open',
                operation: 'system.events.open',
                payload: {
                    channels: [...openData.channels]
                },
                cursor: openData.cursor
            };
            const responseData = await fetchImplementation(streamOptions.apiUrl, {
                method: 'POST',
                credentials: 'include',
                cache: 'no-store',
                headers: requestHeaders,
                body: JSON.stringify(requestData),
                signal: openData.signal
            });

            if (!responseData.ok) {
                throw await responseErrorCreate( responseData, openData.channels );

            }

            const responseType = responseData.headers.get('content-type')?.split(';', 1)[0]?.trim();

            if (responseType !== 'text/event-stream' || responseData.body === null) {
                throw new LayerRuntimeError('STREAM_INVALID_RESPONSE', 'The server did not return an event stream.', {
                    status: responseData.status
                });

            }

            const streamReader = responseData.body.getReader();
            const textDecoder = new TextDecoder();
            const parser = layerEventStreamParserCreate({
                async eventHandle(streamEvent) {
                    let parsedData;

                    try {
                        //Parsing only complete bounded SSE data records.
                        parsedData = /** @type {Record<string, unknown>} */ (JSON.parse(streamEvent.data));

                    } catch (eventParseError) {
                        throw new LayerRuntimeError('STREAM_EVENT_INVALID', 'An event stream record is invalid JSON.', {
                            cause: eventParseError
                        });

                    }

                    if (streamEvent.event === 'layer.event') {
                        const validationResult = protocolValidator.eventValidate(parsedData);

                        if (!validationResult.valid || parsedData.eventId !== streamEvent.id) {
                            throw new LayerRuntimeError('STREAM_EVENT_INVALID', 'A domain event record is invalid.');

                        }

                        await openData.eventHandle(parsedData);

                    } else if (streamEvent.event === 'layer.control') {
                        await openData.controlHandle(parsedData);

                    }

                },
                async commentHandle() {
                    //Forwarding heartbeat receipt without exposing comment contents.
                    await openData.heartbeatHandle?.();

                }
            });

            try {
                while (true) {
                    let timeoutIdentifier = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);
                    const inactivityPromise = new Promise(function inactivityWait(_resolve, reject) {
                        //Rejecting a stream that stops producing events or heartbeat comments.
                        timeoutIdentifier = setTimeout(function inactivityHandle() {
                            //Returning a retryable transport failure for reconnect policy.
                            reject(new LayerRuntimeError('STREAM_INACTIVE', 'The event stream heartbeat timed out.', {
                                retryable: true
                            }));

                        }, inactivityTimeoutMs);

                    });
                    let readResult;

                    try {
                        readResult = await Promise.race([
                            streamReader.read(),
                            inactivityPromise
                        ]);

                    } catch (streamReadError) {
                        if (streamReadError instanceof LayerRuntimeError && streamReadError.code === 'STREAM_INACTIVE') {
                            await streamReader.cancel(streamReadError);

                        }

                        throw streamReadError;

                    } finally {
                        clearTimeout(timeoutIdentifier);

                    }

                    if (readResult.done) {
                        await parser.finish();

                        break;

                    }

                    await parser.feed(textDecoder.decode(readResult.value, {
                        stream: true
                    }));

                }

            } finally {
                //Closing the body even when a parser or application callback fails before the transport ends
                try {
                    await streamReader.cancel();

                } catch( cancelError ){
                    //Preserving the primary failure when the transport is already aborted
                    void cancelError;

                }

                streamReader.releaseLock();

            }

        }
    });

}
