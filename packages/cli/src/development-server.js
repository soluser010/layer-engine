import {request as httpRequest} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {LayerCliError} from './cli-error.js';

const hopByHopHeaders = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade'
]);

/**
 * @typedef {Readonly<{
 *     start: (listenOptions: {host: string, port: number}) => Promise<void>,
 *     stop: (shutdownOptions?: {deadlineMs?: number}) => Promise<void>,
 *     isReady: () => boolean
 * }>} LayerDevelopmentServerRuntime
 */

/**
 * @param {unknown} runtimeData
 * @returns {asserts runtimeData is LayerDevelopmentServerRuntime}
 */
function serverRuntimeAssert(runtimeData) {
    if (runtimeData === null || typeof runtimeData !== 'object' ||
        typeof /** @type {Record<string, unknown>} */ (runtimeData).start !== 'function' ||
        typeof /** @type {Record<string, unknown>} */ (runtimeData).stop !== 'function' ||
        typeof /** @type {Record<string, unknown>} */ (runtimeData).isReady !== 'function') {
        throw new LayerCliError(
            'CLI_DEV_SERVER_INVALID',
            'layerServerCreate(context) returned an invalid lifecycle.'
        );

    }

}

/**
 * @param {import('node:http').IncomingHttpHeaders} sourceHeaders
 */
function proxyRequestHeadersCreate(sourceHeaders) {
    const proxyHeaders = /** @type {Record<string, string | string[]>} */ ({});

    for (const [headerName, headerValue] of Object.entries(sourceHeaders)) {
        if (headerValue === undefined || hopByHopHeaders.has(headerName.toLowerCase())) {
            continue;

        }

        proxyHeaders[headerName] = headerValue;

    }

    return proxyHeaders;

}

/**
 * @param {import('node:http').IncomingHttpHeaders} sourceHeaders
 * @param {import('node:http').ServerResponse} responseData
 */
function proxyResponseHeadersApply(sourceHeaders, responseData) {
    //Copying only end-to-end response headers to the browser-facing connection.
    for (const [headerName, headerValue] of Object.entries(sourceHeaders)) {
        if (headerValue === undefined || hopByHopHeaders.has(headerName.toLowerCase())) {
            continue;

        }

        responseData.setHeader(headerName, headerValue);

    }

}

/**
 * @param {object} serverOptions
 * @param {string} serverOptions.rootDirectory
 * @param {ReturnType<typeof import('./config.js').layerConfigValidate>} serverOptions.config
 */
export function layerDevelopmentServerCreate(serverOptions) {
    const outputDirectory = path.resolve(
        serverOptions.rootDirectory,
        serverOptions.config.outputDirectory
    );
    const serverEntryEnabled = serverOptions.config.deployment.serverEntry !== null;
    const oauthConfigurationData = serverOptions.config.auth?.oauth ?? null;
    const originPort = serverOptions.config.deployment.originPort;
    const stateDirectory = path.resolve(
        process.env.LAYER_STATE_DIRECTORY ??
        path.join(serverOptions.rootDirectory, '.layer', 'state')
    );
    let activeRuntime = /** @type {LayerDevelopmentServerRuntime | null} */ (null);
    let activeIntegrity = /** @type {string | null} */ (null);
    let closedStatus = false;

    //Function for checking the private backend surface without exposing arbitrary paths
    const backendRequestPathCheck = function( /** @type {string} */ requestPathData ){
        if ( requestPathData === String( '/api' ) || requestPathData.startsWith( '/health/' ) === true ){
            return true;

        }

        if ( oauthConfigurationData === null ){
            return false;

        }

        if (
            requestPathData === String( '/.well-known/openid-configuration' ) ||
            requestPathData === String( '/.well-known/oauth-authorization-server' ) ||
            requestPathData.startsWith( '/oauth/' ) === true ||
            requestPathData === String( oauthConfigurationData.interactionUrl ) ||
            requestPathData.startsWith( String( oauthConfigurationData.interactionUrl ) + String( '/' ) ) === true
        ){
            return true;

        }

        //CallBack THE BOOLEAN
        return false;

    };

    /** @param {string} integrityData */
    async function serverRuntimeCreate(integrityData) {
        //Importing the freshly built server bundle under its content integrity identity.
        const serverModuleFile = path.join(outputDirectory, '_layer', 'server', 'application.mjs');
        const serverModuleUrl = `${pathToFileURL(serverModuleFile).href}?layer-dev=${encodeURIComponent(integrityData)}`;
        const serverModuleData = await import(serverModuleUrl);

        if (typeof serverModuleData.layerServerCreate !== 'function') {
            throw new LayerCliError(
                'CLI_DEV_SERVER_INVALID',
                'deployment.serverEntry must export layerServerCreate(context).'
            );

        }

        let runtimeData;

        try {
            //Creating trusted application code behind a stable development diagnostic boundary.
            runtimeData = await serverModuleData.layerServerCreate(Object.freeze({
                appName: serverOptions.config.appName,
                appVersion: serverOptions.config.appVersion,
                environment: 'development',
                rootDirectory: serverOptions.rootDirectory,
                stateDirectory,
                workerId: `development-${String( process.pid )}-${String( os.hostname() )}`,
                trustedProxy: Object.freeze({
                    addresses: Object.freeze(['loopback']),
                    header: 'x-forwarded-for',
                    maximumHops: 8
                })
            }));

        } catch( applicationCreateErrorData ){
            if ( applicationCreateErrorData instanceof LayerCliError ){
                throw applicationCreateErrorData;

            }

            throw new LayerCliError(
                'CLI_DEV_SERVER_CREATE_FAILED',
                'The development application server could not be created.'
            );

        }

        serverRuntimeAssert(runtimeData);

        return runtimeData;

    }

    return Object.freeze({
        enabled: serverEntryEnabled,

        /**
         * @param {Awaited<ReturnType<typeof import('./project-build.js').layerProjectBuild>>} buildResult
         */
        async update(buildResult) {
            if (!serverEntryEnabled || closedStatus) {
                return false;

            }

            const nextIntegrity = buildResult.integrity['_layer/server/application.mjs'];

            if (typeof nextIntegrity !== 'string') {
                throw new LayerCliError(
                    'CLI_DEV_SERVER_INVALID',
                    'The development server bundle is unavailable.'
                );

            }

            if (activeRuntime !== null && activeIntegrity === nextIntegrity) {
                return false;

            }

            const nextRuntime = await serverRuntimeCreate(nextIntegrity);
            const previousRuntime = activeRuntime;

            if (previousRuntime !== null) {
                await previousRuntime.stop({deadlineMs: 10000});

            }

            try {
                //Binding the application backend only to the private loopback origin.
                await nextRuntime.start({
                    host: '127.0.0.1',
                    port: originPort
                });

                if (nextRuntime.isReady() !== true) {
                    throw new LayerCliError(
                        'CLI_DEV_SERVER_NOT_READY',
                        'The development application server did not become ready.'
                    );

                }

            } catch (startupError) {
                await nextRuntime.stop({deadlineMs: 10000}).catch(function failedRuntimeStopIgnore() {
                    //Preserving the primary startup failure after best-effort cleanup.

                });

                if (previousRuntime !== null) {
                    await previousRuntime.start({
                        host: '127.0.0.1',
                        port: originPort
                    }).catch(function previousRuntimeRestartIgnore() {
                        //The next successful rebuild will create a fresh application runtime.

                    });

                }

                if ( startupError instanceof LayerCliError ){
                    throw startupError;

                }

                throw new LayerCliError(
                    'CLI_DEV_SERVER_START_FAILED',
                    'The development application server could not be started.'
                );

            }

            activeRuntime = nextRuntime;
            activeIntegrity = nextIntegrity;

            return true;

        },

        /**
         * @param {import('node:http').IncomingMessage} requestData
         * @param {import('node:http').ServerResponse} responseData
         * @param {string} requestPath
         * @param {'http' | 'https'} protocolName
         */
        requestHandle(requestData, responseData, requestPath, protocolName) {
            if ( serverEntryEnabled === false || backendRequestPathCheck( requestPath ) === false ){
                return false;

            }

            if (
                activeRuntime === null ||
                (requestPath.startsWith( '/health/' ) === false && activeRuntime.isReady() !== true)
            ) {
                responseData.statusCode = 503;
                responseData.setHeader('Content-Type', 'application/json; charset=utf-8');
                responseData.end('{"status":"not-ready"}');

                return true;

            }

            const proxyHeaders = proxyRequestHeadersCreate(requestData.headers);
            const remoteAddress = requestData.socket.remoteAddress ?? 'unknown';

            proxyHeaders.host = `127.0.0.1:${originPort}`;
            proxyHeaders['x-forwarded-for'] = remoteAddress;
            proxyHeaders['x-forwarded-proto'] = protocolName;

            /** @type {import('node:http').IncomingMessage | null} */
            let proxyResponseData = null;
            let downstreamClosedStatus = false;
            const proxyRequest = httpRequest({
                host: '127.0.0.1',
                port: originPort,
                method: requestData.method,
                path: requestData.url,
                headers: proxyHeaders
            }, function proxyResponseHandle(proxyResponse) {
                //Forwarding status, safe end-to-end headers, and streaming bodies without buffering SSE.
                proxyResponseData = proxyResponse;
                responseData.statusCode = proxyResponse.statusCode ?? 502;
                proxyResponseHeadersApply(proxyResponse.headers, responseData);
                responseData.flushHeaders();
                proxyResponse.pipe(responseData);

            });
            let proxyFailedStatus = false;

            proxyRequest.once('error', function proxyRequestErrorHandle() {
                //Returning one bounded gateway failure without writing after a streamed response.
                if (proxyFailedStatus || downstreamClosedStatus) {
                    return;

                }

                proxyFailedStatus = true;

                if (responseData.headersSent) {
                    responseData.destroy();

                    return;

                }

                responseData.statusCode = 502;
                responseData.setHeader('Content-Type', 'application/json; charset=utf-8');
                responseData.end('{"status":"bad-gateway"}');

            });
            requestData.once('aborted', function proxyRequestAbortHandle() {
                //Closing the private origin request when the browser disconnects early.
                proxyRequest.destroy();

            });
            responseData.once('close', function proxyResponseCloseHandle() {
                //Closing the private origin stream when the browser leaves before its response finishes.
                if (responseData.writableFinished) {
                    return;

                }

                downstreamClosedStatus = true;
                proxyResponseData?.destroy();
                proxyRequest.destroy();

            });
            requestData.pipe(proxyRequest);

            return true;

        },

        async close() {
            //Making shutdown idempotent before stopping the currently active application runtime.
            if (closedStatus) {
                return false;

            }

            closedStatus = true;

            if (activeRuntime !== null) {
                await activeRuntime.stop({deadlineMs: 10000});
                activeRuntime = null;
                activeIntegrity = null;

            }

            return true;

        }
    });

}
