import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {layerDatabaseMigrate} from '@solcorp/layer-database';
import {
    LAYER_ERROR_CODES,
    LAYER_PROTOCOL_VERSION,
    LayerError,
    layerErrorResponseDataCreate,
    layerProtocolValidatorCreate,
    layerSuccessResponseDataCreate
} from '@solcorp/layer-protocol';
import {
    layerClientAddressResolve,
    layerTrustedProxyCreate
} from './client-address.js';
import {layerRequestBodyRead} from './request-body.js';
import {layerResponseEffectsCreate} from './response-effects.js';
import {layerRequestFailureDescribe} from './request-failure.js';

/**
 * @typedef {object} LayerRuntimeTransactionClient
 * @property {(queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, unknown>[], rowCount: number | null}>} query
 * @typedef {object} LayerRuntimeDatabase
 * @property {() => Promise<void>} connect
 * @property {() => Promise<void>} close
 * @property {(queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, unknown>[], rowCount: number | null}>} query
 * @property {<ResultData>(handler: (transactionClient: LayerRuntimeTransactionClient) => Promise<ResultData>) => Promise<ResultData>} transaction
 */

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} statusCode
 * @param {unknown} responseData
 * @param {Record<string, string | readonly string[]>} [headersData]
 */
function jsonResponseSend(response, statusCode, responseData, headersData = {}) {
    //Avoiding writes after a client disconnect or a response already completed by an extension
    if ( response.destroyed || response.writableEnded || response.headersSent ){
        return;

    }

    //Serializing once so the declared response length matches emitted bytes.
    const serializedResponse = JSON.stringify(responseData);

    response.writeHead(statusCode, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(serializedResponse).toString(),
        'x-content-type-options': 'nosniff',
        ...headersData
    });
    response.end(serializedResponse);

}

/**
 * @param {unknown} requestData
 * @returns {string}
 */
function safeRequestIdentifierGet(requestData) {
    //Getting only a UUID-shaped identifier for public error correlation.
    if (typeof requestData === 'object' && requestData !== null && !Array.isArray(requestData)) {
        const requestIdentifier = /** @type {Record<string, unknown>} */ (requestData).requestId;

        if (typeof requestIdentifier === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestIdentifier)) {
            return requestIdentifier;

        }

    }

    return randomUUID();

}

/**
 * @param {object} runtimeOptions
 * @param {ReturnType<typeof import('../operation-registry.js').layerOperationRegistryCreate>} runtimeOptions.operationRegistry
 * @param {{execute: Function}} runtimeOptions.operationExecutor
 * @param {{record: (diagnosticData: Record<string, unknown>) => void}} runtimeOptions.diagnostics
 * @param {LayerRuntimeDatabase | null} [runtimeOptions.database]
 * @param {{open: Function, drain: Function} | null} [runtimeOptions.eventStream]
 * @param {{start: Function, stop: Function, isReady: Function} | null} [runtimeOptions.eventDistribution]
 * @param {() => boolean | Promise<boolean>} [runtimeOptions.readinessCheck]
 * @param {number} [runtimeOptions.maximumBodyBytes]
 * @param {number} [runtimeOptions.maximumBodyDepth]
 * @param {number} [runtimeOptions.requestTimeoutMs]
 * @param {boolean} [runtimeOptions.secureCookies]
 * @param {readonly ((request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => boolean | Promise<boolean>)[]} [runtimeOptions.requestHandlers]
 * @param {null | {addresses: readonly string[], header?: 'forwarded' | 'x-forwarded-for', maximumHops?: number}} [runtimeOptions.trustedProxy]
 */
export function layerHttpRuntimeCreate(runtimeOptions) {
    const protocolValidator = layerProtocolValidatorCreate();
    const maximumBodyBytes = runtimeOptions.maximumBodyBytes ?? 262144;
    const maximumBodyDepth = runtimeOptions.maximumBodyDepth ?? 32;
    const requestTimeoutMs = runtimeOptions.requestTimeoutMs ?? 20000;
    const secureCookiesStatusData = runtimeOptions.secureCookies ?? true;
    const trustedProxy = layerTrustedProxyCreate(runtimeOptions.trustedProxy);
    let readyStatus = false;
    let startedStatus = false;

    /**
     * @param {import('node:http').IncomingMessage} request
     */
    async function requestBodyReadWithinDeadline(request) {
        let timeoutIdentifier;
        const timeoutPromise = new Promise(function requestBodyDeadlineWait(resolve, reject) {
            //Enforcing an explicit body deadline independent of Node connection scans.
            timeoutIdentifier = setTimeout(function requestBodyDeadlineHandle() {
                //Rejecting with one bounded public timeout while leaving no application work running.
                reject(new LayerError(
                    LAYER_ERROR_CODES.TIMEOUT,
                    'The request body timed out.',
                    {
                        retryable: true,
                        status: 408
                    }
                ));

            }, requestTimeoutMs);

        });
        const bodyPromise = layerRequestBodyRead(request, {
            maximumBytes: maximumBodyBytes,
            maximumDepth: maximumBodyDepth
        });

        try {
            return await Promise.race([
                bodyPromise,
                timeoutPromise
            ]);

        } finally {
            //Removing the deadline after either complete input or timeout.
            clearTimeout(timeoutIdentifier);

        }

    }

    const httpServer = createServer(async function requestHandle(request, response) {
        //Normalizing the path without treating query parameters as routes.
        const requestPath = request.url?.split('?', 1)[0] ?? '/';

        //Serving dependency-independent liveness for process supervision.
        if (request.method === 'GET' && requestPath === '/health/live') {
            jsonResponseSend(response, 200, {
                status: 'live'
            });

            return;

        }

        //Serving readiness only after dependencies and listener startup complete.
        if (request.method === 'GET' && requestPath === '/health/ready') {
            let readinessStatus = 'not-ready';
            let readinessCode = 503;
            let dependenciesReady = true;

            //Checking live dependency state without exposing the underlying failure.
            if (readyStatus && runtimeOptions.readinessCheck !== undefined) {
                try {
                    dependenciesReady = await runtimeOptions.readinessCheck() === true;

                } catch {
                    dependenciesReady = false;

                }

            }

            //Returning a positive readiness result only after complete startup.
            if (readyStatus && dependenciesReady) {
                readinessStatus = 'ready';
                readinessCode = 200;

            }

            jsonResponseSend(response, readinessCode, {
                status: readinessStatus
            });

            return;

        }

        //Offering standard interoperability routes to explicitly installed handlers
        for (const requestHandlerData of runtimeOptions.requestHandlers ?? []) {
            try {
                const requestHandledStatusData = await requestHandlerData(request, response);

                if (requestHandledStatusData === true) {
                    return;

                }

            } catch( extensionError ){
                runtimeOptions.diagnostics.record({
                    level: 'error',
                    event: 'request.failed',
                    requestId: randomUUID(),
                    stage: 'extension',
                    status: 500,
                    code: LAYER_ERROR_CODES.INTERNAL_ERROR,
                    ...layerRequestFailureDescribe( extensionError )
                });
                jsonResponseSend(response, 500, {
                    status: 'internal-error'
                });
                return;

            }

        }

        //Hiding unrelated routes behind a small fixed response.
        if (requestPath !== '/api') {
            jsonResponseSend(response, 404, {
                status: 'not-found'
            });

            return;

        }

        //Restricting the application endpoint to POST only.
        if (request.method !== 'POST') {
            const requestIdentifier = randomUUID();
            const methodError = new LayerError(
                LAYER_ERROR_CODES.METHOD_NOT_ALLOWED,
                'The API endpoint requires POST.',
                {
                    status: 405
                }
            );

            jsonResponseSend(
                response,
                405,
                layerErrorResponseDataCreate({
                    requestId: requestIdentifier,
                    error: methodError
                }),
                {
                    allow: 'POST'
                }
            );

            return;

        }

        let requestData;
        let requestIdentifier = /** @type {string} */ (randomUUID());
        let requestStage = 'readiness';
        let operationName = /** @type {string | null} */ (null);

        try {
            //Rejecting application work while startup or drain is incomplete.
            if (!readyStatus) {
                throw new LayerError(
                    LAYER_ERROR_CODES.DEPENDENCY_UNAVAILABLE,
                    'The server is not ready.',
                    {
                        status: 503
                    }
                );

            }

            requestStage = 'body-read';
            requestData = await requestBodyReadWithinDeadline(request);
            requestIdentifier = safeRequestIdentifierGet(requestData);
            requestStage = 'protocol';
            let requestProtocol;

            //Reading the protocol value only from a parsed object envelope.
            if (typeof requestData === 'object' && requestData !== null && !Array.isArray(requestData)) {
                requestProtocol = /** @type {Record<string, unknown>} */ (requestData).protocol;

            }

            //Returning a dedicated version failure before general schema details.
            if (requestProtocol !== LAYER_PROTOCOL_VERSION) {
                throw new LayerError(
                    LAYER_ERROR_CODES.UNSUPPORTED_PROTOCOL,
                    'The protocol version is not supported.',
                    {
                        status: 400
                    }
                );

            }

            requestStage = 'envelope';
            const envelopeValidationResult = protocolValidator.requestValidate(requestData);

            //Stopping invalid envelopes before registry lookup or authentication.
            if (!envelopeValidationResult.valid) {
                const validationIssues = [];

                //Reducing schema diagnostics to stable non-sensitive fields.
                for (const validationError of envelopeValidationResult.errors) {
                    validationIssues.push({
                        path: validationError.instancePath,
                        keyword: validationError.keyword
                    });

                }

                throw new LayerError(
                    LAYER_ERROR_CODES.INVALID_ENVELOPE,
                    'The request envelope is invalid.',
                    {
                        details: {
                            issues: validationIssues
                        },
                        status: 400
                    }
                );

            }

            const typedRequestData = /** @type {{requestId: string, type: string, operation: string, payload: unknown, cursor?: string | Record<string, number> | null}} */ (requestData);
            operationName = typedRequestData.operation;
            requestStage = 'client-address';
            const clientAddress = layerClientAddressResolve(request, trustedProxy);

            //Opening the authorized persistent POST stream through its dedicated runtime.
            if (typedRequestData.type === 'events.open') {
                if (runtimeOptions.eventStream === null || runtimeOptions.eventStream === undefined) {
                    throw new LayerError(
                        LAYER_ERROR_CODES.DEPENDENCY_UNAVAILABLE,
                        'The event stream runtime is unavailable.',
                        {
                            status: 503
                        }
                    );

                }

                if (typeof typedRequestData.cursor === 'string') {
                    throw new LayerError(LAYER_ERROR_CODES.INVALID_ENVELOPE, 'Event streams require a channel cursor map.', {
                        status: 400
                    });

                }

                requestStage = 'stream-authorization';
                const streamAuthorization = await runtimeOptions.operationExecutor.execute({
                    request: typedRequestData,
                    headers: request.headers,
                    remoteAddress: clientAddress
                });

                requestStage = 'stream-open';
                await runtimeOptions.eventStream.open({
                    response,
                    authorization: streamAuthorization,
                    cursor: typedRequestData.cursor ?? null,
                    remoteAddress: clientAddress,
                    requestId: typedRequestData.requestId
                });

                return;

            }

            const responseEffectsData = layerResponseEffectsCreate({
                secure: Boolean( secureCookiesStatusData )
            });
            requestStage = 'operation';
            const operationResult = await runtimeOptions.operationExecutor.execute({
                request: typedRequestData,
                headers: request.headers,
                remoteAddress: clientAddress,
                responseEffects: responseEffectsData
            });
            requestStage = 'response';
            const responseData = layerSuccessResponseDataCreate({
                requestId: typedRequestData.requestId,
                data: operationResult,
                meta: {
                    serverTime: new Date().toISOString()
                }
            });

            jsonResponseSend(response, 200, responseData, responseEffectsData.headersGet());

        } catch (requestError) {
            //Recording transport facts before normalization removes the original technical cause
            const diagnosticData = {
                requestId: requestIdentifier,
                operation: operationName,
                stage: requestStage,
                requestComplete: request.complete,
                responseDestroyed: response.destroyed,
                responseEnded: response.writableEnded,
                responseHeadersSent: response.headersSent,
                ...layerRequestFailureDescribe( requestError )
            };

            //Treating only body-reader classified interruptions as expected transport cancellation
            if ( requestStage === 'body-read' && requestError instanceof LayerError &&
                requestError.code === LAYER_ERROR_CODES.REQUEST_ABORTED ){
                runtimeOptions.diagnostics.record({
                    ...diagnosticData,
                    level: 'info',
                    event: 'request.aborted',
                    code: LAYER_ERROR_CODES.REQUEST_ABORTED
                });

                //An already closed peer receives no invented HTTP 499 or duplicate error response
                jsonResponseSend( response, 400, layerErrorResponseDataCreate({
                    requestId: requestIdentifier,
                    error: requestError
                }) );
                return;

            }

            //Avoiding a second JSON response after an event stream has sent headers.
            if (response.headersSent) {
                runtimeOptions.diagnostics.record({
                    ...diagnosticData,
                    level: 'error',
                    event: 'event-stream.failed-after-open',
                    requestId: requestIdentifier,
                    status: 500
                });

                if (!response.writableEnded && !response.destroyed) {
                    response.end();

                }

                return;

            }

            let publicError;

            //Normalizing unknown failures before public serialization.
            if (requestError instanceof LayerError) {
                publicError = requestError;

            } else {
                publicError = new LayerError(
                    LAYER_ERROR_CODES.INTERNAL_ERROR,
                    'An internal error occurred.',
                    {
                        cause: requestError,
                        status: 500
                    }
                );

            }

            const errorResponseData = layerErrorResponseDataCreate({
                requestId: requestIdentifier,
                error: publicError
            });
            const responseHeaders = /** @type {Record<string, string>} */ ({});

            //Closing timed-out partial requests so unread bytes cannot retain a socket.
            if (publicError.status === 408) {
                responseHeaders.connection = 'close';
                response.shouldKeepAlive = false;
                //Cancelling pending body consumption only after the timeout response has been flushed
                response.once( 'finish', function(){
                    //Releasing an incomplete request reader after the timeout response is flushed
                    request.destroy();

                } );

            }

            //Adding standard retry guidance without exposing limiter identity.
            if (publicError.code === LAYER_ERROR_CODES.RATE_LIMITED && publicError.details?.retryAfterMs !== undefined) {
                responseHeaders['retry-after'] = String(
                    Math.max(1, Math.ceil(Number(publicError.details.retryAfterMs) / 1000))
                );

            }

            runtimeOptions.diagnostics.record({
                ...diagnosticData,
                level: 'error',
                event: 'request.failed',
                requestId: requestIdentifier,
                status: publicError.status,
                code: publicError.code
            });
            jsonResponseSend(response, publicError.status, errorResponseData, responseHeaders);

        }

    });

    httpServer.requestTimeout = requestTimeoutMs;
    httpServer.headersTimeout = Math.min(requestTimeoutMs, 10000);
    httpServer.keepAliveTimeout = 5000;
    httpServer.maxHeadersCount = 100;

    return Object.freeze({
        /**
         * @param {{host?: string, port?: number}} [listenOptions]
         */
        async start(listenOptions = {}) {
            //Preventing duplicate listeners and lifecycle races.
            if (startedStatus) {
                throw new Error('The HTTP runtime is already started.');

            }

            startedStatus = true;

            try {
                //Starting PostgreSQL and migrations before exposing readiness.
                if (runtimeOptions.database !== null && runtimeOptions.database !== undefined) {
                    await runtimeOptions.database.connect();
                    await layerDatabaseMigrate(runtimeOptions.database);

                }

                if (runtimeOptions.eventDistribution !== null && runtimeOptions.eventDistribution !== undefined) {
                    await runtimeOptions.eventDistribution.start();

                }

                runtimeOptions.operationRegistry.seal();

                await new Promise(function listenerStart(resolve, reject) {
                    //Waiting for exactly one startup result from the HTTP listener.
                    const listenError = function listenerErrorHandle(/** @type {Error} */ errorData) {
                        //Detaching the opposite startup listener before rejecting.
                        httpServer.off('listening', listenComplete);
                        reject(errorData);

                    };
                    const listenComplete = function listenerCompleteHandle() {
                        //Detaching the opposite startup listener before resolving.
                        httpServer.off('error', listenError);
                        resolve(undefined);

                    };

                    httpServer.once('error', listenError);
                    httpServer.once('listening', listenComplete);
                    httpServer.listen({
                        host: listenOptions.host ?? '127.0.0.1',
                        port: listenOptions.port ?? 8787
                    });

                });

                readyStatus = true;

            } catch (startupError) {
                startedStatus = false;

                if (runtimeOptions.eventDistribution !== null && runtimeOptions.eventDistribution !== undefined &&
                    runtimeOptions.eventDistribution.isReady()) {
                    await runtimeOptions.eventDistribution.stop();

                }

                if (runtimeOptions.database !== null && runtimeOptions.database !== undefined) {
                    await runtimeOptions.database.close();

                }

                throw startupError;

            }

        },

        /**
         * @param {{deadlineMs?: number}} [shutdownOptions]
         */
        async stop(shutdownOptions = {}) {
            //Removing readiness before draining requests and dependencies.
            readyStatus = false;

            if (!startedStatus) {
                return;

            }

            const deadlineMs = shutdownOptions.deadlineMs ?? 10000;

            if (runtimeOptions.eventStream !== null && runtimeOptions.eventStream !== undefined) {
                await runtimeOptions.eventStream.drain();

            }

            let deadlineIdentifier;
            const deadlinePromise = new Promise(function shutdownDeadlineWait(resolve) {
                //Scheduling the maximum graceful drain period.
                deadlineIdentifier = setTimeout(function shutdownDeadlineHandle() {
                    //Closing remaining sockets after the graceful deadline.
                    httpServer.closeAllConnections();
                    resolve(undefined);

                }, deadlineMs);

            });
            const closePromise = new Promise(function listenerCloseWait(resolve, reject) {
                //Waiting until the listener drains existing connections.
                httpServer.close(function listenerCloseHandle(closeError) {
                    //Propagating listener close failures to the lifecycle caller.
                    if (closeError !== undefined) {
                        reject(closeError);

                        return;

                    }

                    resolve(undefined);

                });

            });

            await Promise.race([
                closePromise,
                deadlinePromise
            ]);
            clearTimeout(deadlineIdentifier);
            startedStatus = false;

            if (runtimeOptions.eventDistribution !== null && runtimeOptions.eventDistribution !== undefined) {
                await runtimeOptions.eventDistribution.stop();

            }

            if (runtimeOptions.database !== null && runtimeOptions.database !== undefined) {
                await runtimeOptions.database.close();

            }

        },

        isReady() {
            //Reporting readiness for embedding hosts and tests.
            return readyStatus;

        },

        address() {
            //Returning the native listener address without transforming it.
            return httpServer.address();

        }
    });

}
