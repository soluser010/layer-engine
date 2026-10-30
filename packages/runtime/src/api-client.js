import {LAYER_PROTOCOL_VERSION} from '@solcorp/layer-protocol/constants';
import {layerProtocolDataValidatorCreate} from '@solcorp/layer-protocol/data-validator';
import {LayerRuntimeError} from './runtime-error.js';

const operationNamePattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
const requestIdentifierPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {Response} responseData
 * @param {number} maximumBytes
 * @param {string} requestIdentifier
 */
async function responseJsonRead(responseData, maximumBytes, requestIdentifier) {
    const contentType = responseData.headers.get('content-type') ?? '';
    const declaredLength = Number(responseData.headers.get('content-length'));

    //Rejecting non-JSON and declared oversized responses before buffering bytes.
    if (!contentType.toLowerCase().startsWith('application/json')) {
        throw new LayerRuntimeError('API_RESPONSE_MEDIA_INVALID', 'The API response must be JSON.', {
            requestId: requestIdentifier,
            status: responseData.status
        });

    }

    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
        throw new LayerRuntimeError('API_RESPONSE_TOO_LARGE', 'The API response exceeds the configured limit.', {
            requestId: requestIdentifier,
            status: responseData.status
        });

    }

    if (responseData.body === null) {
        throw new LayerRuntimeError('API_RESPONSE_INVALID', 'The API response body is unavailable.', {
            requestId: requestIdentifier,
            status: responseData.status
        });

    }

    const responseReader = responseData.body.getReader();
    const textDecoder = new TextDecoder();
    let responseBytes = 0;
    let responseText = '';

    try {
        while (true) {
            const readResult = await responseReader.read();

            if (readResult.done) {
                break;

            }

            responseBytes += readResult.value.byteLength;

            if (responseBytes > maximumBytes) {
                await responseReader.cancel();
                throw new LayerRuntimeError('API_RESPONSE_TOO_LARGE', 'The API response exceeds the configured limit.', {
                    requestId: requestIdentifier,
                    status: responseData.status
                });

            }

            responseText += textDecoder.decode(readResult.value, {stream: true});

        }

        responseText += textDecoder.decode();

    } finally {
        responseReader.releaseLock();

    }

    try {
        //Parsing only after the complete bounded UTF-8 response has arrived.
        return JSON.parse(responseText);

    } catch (parseError) {
        throw new LayerRuntimeError('API_RESPONSE_INVALID', 'The API response contains invalid JSON.', {
            cause: parseError,
            requestId: requestIdentifier,
            status: responseData.status
        });

    }

}

/**
 * @param {Headers} responseHeaders
 */
function retryAfterMillisecondsGet(responseHeaders) {
    const retryAfter = responseHeaders.get('retry-after');

    if (retryAfter === null) {
        return 0;

    }

    const retrySeconds = Number(retryAfter);

    //Accepting only bounded delta-seconds from the trusted application origin.
    if (!Number.isFinite(retrySeconds) || retrySeconds <= 0) {
        return 0;

    }

    return Math.min(3600000, Math.ceil(retrySeconds * 1000));

}

/**
 * @param {unknown} payloadData
 */
function requestPayloadValidate(payloadData) {
    //Keeping every application payload inside the protocol object boundary.
    if (typeof payloadData !== 'object' || payloadData === null || Array.isArray(payloadData)) {
        throw new TypeError('Layer API payload must be an object.');

    }

}

/**
 * @param {object} clientOptions
 * @param {string} [clientOptions.apiUrl]
 * @param {typeof fetch} [clientOptions.fetchImplementation]
 * @param {() => string} clientOptions.requestIdCreate
 * @param {() => string | null | Promise<string | null>} [clientOptions.csrfTokenGet]
 * @param {number} [clientOptions.maximumResponseBytes]
 * @param {number} [clientOptions.timeoutMs]
 */
export function layerApiClientCreate(clientOptions) {
    if (clientOptions === null || typeof clientOptions !== 'object' ||
        typeof clientOptions.requestIdCreate !== 'function') {
        throw new TypeError('Layer API client options are invalid.');

    }

    const apiUrl = clientOptions.apiUrl ?? '/api';
    const fetchImplementation = clientOptions.fetchImplementation ?? globalThis.fetch;
    const maximumResponseBytes = clientOptions.maximumResponseBytes ?? 1048576;
    const timeoutMs = clientOptions.timeoutMs ?? 10000;
    const protocolValidator = layerProtocolDataValidatorCreate();

    if (typeof apiUrl !== 'string' || apiUrl.length < 1 || typeof fetchImplementation !== 'function' ||
        !Number.isInteger(maximumResponseBytes) || maximumResponseBytes < 1024 || maximumResponseBytes > 16777216 ||
        !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) {
        throw new TypeError('Layer API client configuration is invalid.');

    }

    /**
     * @param {{type: 'query' | 'command' | 'sync', operation: string, payload: Record<string, unknown>, cursor?: string | Record<string, number> | null, signal?: AbortSignal, timeoutMs?: number}} requestOptions
     */
    async function requestSend(requestOptions) {
        requestPayloadValidate(requestOptions.payload);

        if (!operationNamePattern.test(requestOptions.operation) ||
            !['query', 'command', 'sync'].includes(requestOptions.type)) {
            throw new TypeError('Layer API request type or operation is invalid.');

        }

        const requestIdentifier = clientOptions.requestIdCreate();

        if (!requestIdentifierPattern.test(requestIdentifier)) {
            throw new TypeError('Layer API requestId factory returned an invalid UUID.');

        }

        const requestEnvelope = /** @type {Record<string, unknown>} */ ({
            protocol: LAYER_PROTOCOL_VERSION,
            requestId: requestIdentifier,
            type: requestOptions.type,
            operation: requestOptions.operation,
            payload: structuredClone(requestOptions.payload)
        });

        if (requestOptions.cursor !== undefined) {
            requestEnvelope.cursor = structuredClone(requestOptions.cursor);

        }

        if (!protocolValidator.requestValidate(requestEnvelope).valid) {
            throw new TypeError('Layer API request envelope is invalid.');

        }

        const requestHeaders = new Headers({
            accept: 'application/json',
            'content-type': 'application/json'
        });
        const cancellationAssert = function(){
            //Rejecting a cancelled request before token lookup or network transmission
            if ( requestOptions.signal?.aborted === true ){
                throw new LayerRuntimeError( 'API_ABORTED', 'The API request was cancelled.', {
                    requestId: requestIdentifier
                });

            }

        };
        cancellationAssert();
        let csrfToken;

        try {
            csrfToken = await clientOptions.csrfTokenGet?.();

        } catch( tokenErrorData ){
            //Preserving cancellation even if the asynchronous token provider also failed
            cancellationAssert();
            throw tokenErrorData;

        }

        cancellationAssert();

        if (csrfToken !== undefined && csrfToken !== null) {
            if (typeof csrfToken !== 'string' || csrfToken.length < 1 || csrfToken.length > 4096) {
                throw new TypeError('Layer API CSRF token is invalid.');

            }

            requestHeaders.set('x-layer-csrf', csrfToken);

        }

        const requestTimeoutMs = requestOptions.timeoutMs ?? timeoutMs;

        if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 100 || requestTimeoutMs > 120000) {
            throw new TypeError('Layer API request timeout is invalid.');

        }

        const requestController = new AbortController();
        let timeoutStatus = false;
        const externalAbortHandle = function externalRequestAbort() {
            //Forwarding caller cancellation without exposing its arbitrary reason.
            requestController.abort();

        };

        requestOptions.signal?.addEventListener('abort', externalAbortHandle, {once: true});
        const timeoutIdentifier = setTimeout(function requestTimeoutHandle() {
            //Stopping the transport at the declared operation deadline.
            timeoutStatus = true;
            requestController.abort();

        }, requestTimeoutMs);

        try {
            const responseData = await fetchImplementation(apiUrl, {
                method: 'POST',
                credentials: 'same-origin',
                headers: requestHeaders,
                body: JSON.stringify(requestEnvelope),
                signal: requestController.signal
            });
            const responseBody = await responseJsonRead(responseData, maximumResponseBytes, requestIdentifier);
            const responseRecord = /** @type {Record<string, any>} */ (responseBody);

            if (responseRecord.requestId !== requestIdentifier) {
                throw new LayerRuntimeError('API_RESPONSE_MISMATCH', 'The API response requestId does not match.', {
                    requestId: requestIdentifier,
                    status: responseData.status
                });

            }

            const errorValidation = protocolValidator.errorResponseValidate(responseBody);

            if (errorValidation.valid) {
                throw new LayerRuntimeError(responseRecord.error.code, responseRecord.error.message, {
                    requestId: requestIdentifier,
                    status: responseData.status,
                    retryable: responseRecord.error.retryable,
                    retryAfterMs: retryAfterMillisecondsGet(responseData.headers),
                    details: responseRecord.error.details
                });

            }

            if (!responseData.ok || !protocolValidator.successResponseValidate(responseBody).valid) {
                throw new LayerRuntimeError('API_RESPONSE_INVALID', 'The API response contract is invalid.', {
                    requestId: requestIdentifier,
                    status: responseData.status
                });

            }

            return Object.freeze({
                requestId: requestIdentifier,
                data: structuredClone(responseRecord.data),
                meta: Object.freeze(structuredClone(responseRecord.meta ?? {}))
            });

        } catch (requestError) {
            if (requestError instanceof LayerRuntimeError) {
                throw requestError;

            }

            if (timeoutStatus) {
                throw new LayerRuntimeError('API_TIMEOUT', 'The API request timed out.', {
                    cause: requestError,
                    requestId: requestIdentifier,
                    retryable: true,
                    status: 408
                });

            }

            if (requestController.signal.aborted) {
                throw new LayerRuntimeError('API_ABORTED', 'The API request was cancelled.', {
                    cause: requestError,
                    requestId: requestIdentifier
                });

            }

            throw new LayerRuntimeError('API_NETWORK_FAILED', 'The API request failed.', {
                cause: requestError,
                requestId: requestIdentifier,
                retryable: true
            });

        } finally {
            clearTimeout(timeoutIdentifier);
            requestOptions.signal?.removeEventListener('abort', externalAbortHandle);

        }

    }

    return Object.freeze({
        request: requestSend,

        /**
         * @param {string} operationName
         * @param {Record<string, unknown>} payloadData
         * @param {{signal?: AbortSignal, timeoutMs?: number}} [queryOptions]
         */
        async query(operationName, payloadData, queryOptions = {}) {
            //Executing the query before publishing explicit freshness metadata.
            const queryResult = await requestSend({
                type: 'query',
                operation: operationName,
                payload: payloadData,
                ...queryOptions
            });

            return Object.freeze({
                ...queryResult,
                status: 'network',
                stale: false
            });

        },

        /**
         * @param {string} operationName
         * @param {Record<string, unknown>} payloadData
         * @param {{commandId: string, baseRevision: number, signal?: AbortSignal, timeoutMs?: number}} commandOptions
         */
        async command(operationName, payloadData, commandOptions) {
            requestPayloadValidate(payloadData);

            if (Object.hasOwn(payloadData, 'commandId') || Object.hasOwn(payloadData, 'baseRevision') ||
                typeof commandOptions !== 'object' || commandOptions === null ||
                typeof commandOptions.commandId !== 'string' || commandOptions.commandId.length < 1 ||
                commandOptions.commandId.length > 160 || !Number.isSafeInteger(commandOptions.baseRevision) ||
                commandOptions.baseRevision < 0) {
                throw new TypeError('Layer API command options are invalid.');

            }

            const commandRequest = /** @type {{type: 'command', operation: string, payload: Record<string, unknown>, signal?: AbortSignal, timeoutMs?: number}} */ ({
                type: 'command',
                operation: operationName,
                payload: {
                    ...payloadData,
                    commandId: commandOptions.commandId,
                    baseRevision: commandOptions.baseRevision
                }
            });

            if (commandOptions.signal !== undefined) {
                commandRequest.signal = commandOptions.signal;

            }

            if (commandOptions.timeoutMs !== undefined) {
                commandRequest.timeoutMs = commandOptions.timeoutMs;

            }

            return requestSend(commandRequest);

        },

        /**
         * @param {string} operationName
         * @param {Record<string, unknown>} payloadData
         * @param {{cursor?: string | Record<string, number> | null, signal?: AbortSignal, timeoutMs?: number}} [syncOptions]
         */
        sync(operationName, payloadData, syncOptions = {}) {
            //Forwarding snapshot and cursor recovery through the same strict request path.
            return requestSend({
                type: 'sync',
                operation: operationName,
                payload: payloadData,
                ...syncOptions
            });

        }
    });

}
