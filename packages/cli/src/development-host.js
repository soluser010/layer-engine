import {createServer as httpServerCreate} from 'node:http';
import {createServer as httpsServerCreate} from 'node:https';
import {
    lstat,
    readFile
} from 'node:fs/promises';
import path from 'node:path';
import {LayerCliError} from './cli-error.js';
import {layerConfigValidate} from './config.js';
import {layerDevelopmentLiveReloadCreate} from './development-live-reload.js';
import {layerLinkAssociationPathCheck, layerUpdateMetadataPathCheck} from '@solcorp/layer-pwa';
import {layerDevelopmentServerCreate} from './development-server.js';
import {layerDevelopmentWatchCreate} from './development.js';
import {layerContentSecurityPolicyCreate, layerPermissionsPolicyCreate, layerSecurityConfigurationCreate} from './content-security-policy.js';
import {layerPrivateArtifactRequestPathCheck} from './private-artifacts.js';

const contentTypes = /** @type {Readonly<Record<string, string>>} */ (Object.freeze({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2'
}));

/**
 * @param {import('node:http').ServerResponse} responseData
 * @param {string} contentSecurityPolicyData
 * @param {string | null} permissionsPolicyData
 */
const securityHeadersApply = function( responseData, contentSecurityPolicyData, permissionsPolicyData ){
    //Applying browser protections while allowing local visual tooling to inject development styles.
    responseData.setHeader( 'Cache-Control', 'no-store' );
    responseData.setHeader(
        'Content-Security-Policy',
        contentSecurityPolicyData
    );
    responseData.setHeader( 'Cross-Origin-Opener-Policy', 'same-origin' );
    responseData.setHeader( 'Referrer-Policy', 'no-referrer' );
    responseData.setHeader( 'X-Content-Type-Options', 'nosniff' );
    if ( permissionsPolicyData !== null ){
        //Applying explicit device permissions while leaving existing development defaults unchanged
        responseData.setHeader( 'Permissions-Policy', permissionsPolicyData );

    }

};

/**
 * @param {string} outputDirectory
 * @param {string} relativeFile
 */
function outputFileResolve(outputDirectory, relativeFile) {
    //Resolving one requested artifact while preserving the output boundary.
    const outputFile = path.resolve(outputDirectory, relativeFile);
    const relativeOutputFile = path.relative(outputDirectory, outputFile);

    if (relativeOutputFile === '' || relativeOutputFile.startsWith('..') || path.isAbsolute(relativeOutputFile)) {
        throw new LayerCliError('CLI_DEV_PATH_UNSAFE', 'Development request path escaped the build output.');

    }

    return outputFile;

}

/**
 * @param {string} outputDirectory
 * @param {string} relativeFile
 */
async function outputFileRead(outputDirectory, relativeFile) {
    const outputFile = outputFileResolve(outputDirectory, relativeFile);
    const fileStatus = await lstat(outputFile).catch(function developmentFileMissing(fileError) {
        if (/** @type {NodeJS.ErrnoException} */ (fileError).code === 'ENOENT') {
            return null;

        }

        throw fileError;

    });

    if (fileStatus?.isFile() !== true || fileStatus.isSymbolicLink()) {
        return null;

    }

    return Object.freeze({
        file: outputFile,
        content: await readFile(outputFile)
    });

}

/**
 * @param {{
 *     outputDirectory: string,
 *     liveReload?: ReturnType<typeof layerDevelopmentLiveReloadCreate> | null,
 *     serverProxy?: ReturnType<typeof layerDevelopmentServerCreate> | null,
 *     protocol?: 'http' | 'https'
 *     security?: Parameters<typeof layerContentSecurityPolicyCreate>[0]
 * }} handlerOptions
 */
export function layerDevelopmentRequestHandlerCreate(handlerOptions) {
    const outputDirectory = path.resolve(handlerOptions.outputDirectory);
    const liveReload = handlerOptions.liveReload ?? null;
    const serverProxy = handlerOptions.serverProxy ?? null;
    const protocolName = handlerOptions.protocol ?? 'http';
    //Preparing the configured policy once before handling any browser request
    const securityConfigurationData = layerSecurityConfigurationCreate( handlerOptions.security );
    const contentSecurityPolicyData = layerContentSecurityPolicyCreate( securityConfigurationData, 'development' );
    //Leaving legacy development capability defaults unchanged unless explicitly configured
    let permissionsPolicyData = /** @type {string | null} */ (null);
    if ( securityConfigurationData.permissionsPolicy !== undefined ){
        permissionsPolicyData = layerPermissionsPolicyCreate( securityConfigurationData );

    }

    return async function layerDevelopmentRequestHandle(
        /** @type {import('node:http').IncomingMessage} */ requestData,
        /** @type {import('node:http').ServerResponse} */ responseData
    ) {
        securityHeadersApply( responseData, contentSecurityPolicyData, permissionsPolicyData );

        let requestUrl;

        try {
            //Parsing the path against a fixed local origin without trusting Host.
            requestUrl = new URL(requestData.url ?? '/', 'http://layer.local');

        } catch {
            responseData.statusCode = 400;
            responseData.end();

            return;

        }

        let requestPath;

        try {
            requestPath = decodeURIComponent(requestUrl.pathname);

        } catch {
            responseData.statusCode = 400;
            responseData.end();

            return;

        }

        if (requestPath.includes('\\') || requestPath.includes('\0')) {
            responseData.statusCode = 400;
            responseData.end();

            return;

        }

        //Rejecting protected files before backend forwarding or navigation fallback
        if ( layerPrivateArtifactRequestPathCheck( requestPath ) ){
            //Returning absence without reading or revealing any private file
            responseData.statusCode = 404;
            responseData.end();

            //Completing the protected request
            return;

        }

        //Passing only the declared backend surface through the private development origin.
        if (serverProxy?.requestHandle(requestData, responseData, requestPath, protocolName) === true) {
            return;

        }

        if (requestData.method !== 'GET' && requestData.method !== 'HEAD') {
            //Restricting all non-backend development routes to static resource reads.
            responseData.statusCode = 405;
            responseData.setHeader('Allow', 'GET, HEAD');
            responseData.end();

            return;

        }

        //Handling generated development resources before reading build artifacts.
        if (liveReload?.requestHandle(requestData, responseData, requestPath) === true) {
            return;

        }

        //Preventing internal development paths from falling back to the application shell.
        if (
            requestPath.startsWith('/_layer/dev') ||
            requestPath.startsWith('/_layer/server/') ||
            requestPath.startsWith('/_layer/deployment') ||
            requestPath === '/_layer/build.json' ||
            requestPath.endsWith('.d.ts') ||
            requestPath.endsWith('.d.mts') ||
            requestPath.endsWith('.map')
        ) {
            responseData.statusCode = 404;
            responseData.end();

            return;

        }

        const relativeRequestFile = requestPath.replace(/^\/+/, '') || 'index.html';
        let responseFile = await outputFileRead(outputDirectory, relativeRequestFile);
        const navigationStatus = path.extname(relativeRequestFile) === '' || requestData.headers.accept?.includes('text/html') === true;

        if (responseFile === null && navigationStatus && !layerLinkAssociationPathCheck(requestPath) &&
            !layerUpdateMetadataPathCheck(requestPath)) {
            //Serving a generated static route document before the clean client-side shell.
            responseFile = await outputFileRead(
                outputDirectory,
                path.posix.join(relativeRequestFile, 'index.html')
            );

            if (responseFile === null) {
                responseFile = await outputFileRead(outputDirectory, '_layer/shell.html');

            }

        }

        if (responseFile === null) {
            responseData.statusCode = 404;
            responseData.end();

            return;

        }

        let responseContentType = contentTypes[path.extname(responseFile.file).toLowerCase()] ?? 'application/octet-stream';
        if (layerUpdateMetadataPathCheck(requestPath)) {
            //Preventing stale release checks independently of Accept and request method
            responseData.setHeader('Cache-Control', 'no-store');

        }
        if (layerLinkAssociationPathCheck(requestPath)) {
            //Giving extensionless association documents the JSON MIME type
            responseContentType = 'application/json';
            responseData.setHeader('Cache-Control', 'no-cache');

        }
        let responseContent = responseFile.content;
        const documentNavigationStatus = requestData.headers['sec-fetch-dest'] === 'document' ||
            requestData.headers['sec-fetch-mode'] === 'navigate' ||
            requestData.headers.accept?.includes('text/html') === true;

        //Injecting only into navigations so Service Worker precache integrity remains unchanged.
        if (liveReload !== null && responseContentType.startsWith('text/html') && documentNavigationStatus) {
            responseContent = liveReload.documentInject(responseContent);

        }

        responseData.statusCode = 200;
        responseData.setHeader('Content-Type', responseContentType);
        responseData.setHeader('Content-Length', String(responseContent.byteLength));

        if (requestData.method === 'HEAD') {
            responseData.end();

            return;

        }

        responseData.end(responseContent);

    };

}

/**
 * @param {{
 *     rootDirectory: string,
 *     config: unknown,
 *     debounceMs?: number,
 *     watchCreate?: typeof import('node:fs').watch,
 *     onBuild?: (buildResult: Awaited<ReturnType<typeof import('./project-build.js').layerProjectBuild>>) => void | Promise<void>,
 *     onError?: (buildError: unknown) => void
 * }} hostOptions
 */
export async function layerDevelopmentHostCreate(hostOptions) {
    const rootDirectory = path.resolve(hostOptions.rootDirectory);
    const configData = layerConfigValidate(hostOptions.config);
    const outputDirectory = path.resolve(rootDirectory, configData.outputDirectory);
    /** @type {'http' | 'https'} */
    let protocolName;

    if (configData.development.https === false) {
        //Using plain HTTP only for the explicit loopback development contract.
        protocolName = 'http';

    } else {
        //Keeping the secure development listener as the default host contract.
        protocolName = 'https';

    }

    const developmentBackend = layerDevelopmentServerCreate({
        rootDirectory,
        config: configData
    });
    let liveReload = null;

    if (configData.development.liveReload) {
        //Creating development-only resources only for an explicitly enabled host.
        liveReload = layerDevelopmentLiveReloadCreate();

    }

    const requestHandle = layerDevelopmentRequestHandlerCreate({
        outputDirectory,
        liveReload,
        serverProxy: developmentBackend,
        security: configData.security,
        protocol: protocolName
    });
    const watchOptions = /** @type {Parameters<typeof layerDevelopmentWatchCreate>[0]} */ ({
        rootDirectory,
        config: configData,
        async onBuild(buildResult) {
            //Updating the optional private backend before publishing a browser revision.
            await developmentBackend.update(buildResult);
            liveReload?.buildReady();
            await hostOptions.onBuild?.(buildResult);

        },
        onError(buildError) {
            //Publishing a bounded failure while retaining the last working build.
            liveReload?.buildFailed(buildError);
            hostOptions.onError?.(buildError);

        }
    });

    if (hostOptions.debounceMs !== undefined) {
        watchOptions.debounceMs = hostOptions.debounceMs;

    }

    if (hostOptions.watchCreate !== undefined) {
        watchOptions.watchCreate = hostOptions.watchCreate;

    }

    let developmentWatch;

    try {
        //Building the first valid artifact set before opening the local listener.
        developmentWatch = await layerDevelopmentWatchCreate(watchOptions);

    } catch (buildError) {
        liveReload?.close();
        await developmentBackend.close();

        throw buildError;

    }
    /** @type {import('node:http').Server | import('node:https').Server} */
    let developmentServer;

    try {
        if (configData.development.https === false) {
            //Using plain HTTP only on a validated loopback development host.
            developmentServer = httpServerCreate(function developmentHttpRequestHandle(requestData, responseData) {
                void requestHandle(requestData, responseData).catch(function developmentRequestFailure() {
                    //Returning a bounded failure without exposing filesystem or stack data.
                    responseData.statusCode = 500;
                    responseData.end();

                });

            });

        } else {
            //Loading an explicitly configured local TLS identity for HTTPS development.
            const keyFile = path.resolve(rootDirectory, configData.development.https.keyFile);
            const certificateFile = path.resolve(rootDirectory, configData.development.https.certificateFile);
            const [keyData, certificateData] = await Promise.all([
                readFile(keyFile),
                readFile(certificateFile)
            ]);
            developmentServer = httpsServerCreate({
                key: keyData,
                cert: certificateData
            }, function developmentHttpsRequestHandle(requestData, responseData) {
                void requestHandle(requestData, responseData).catch(function developmentSecureRequestFailure() {
                    //Returning a bounded failure without exposing TLS or filesystem details.
                    responseData.statusCode = 500;
                    responseData.end();

                });

            });

        }

        const activeServer = developmentServer;

        await new Promise(function developmentServerListen(resolve, reject) {
            function serverListenError(/** @type {Error} */ errorData) {
                //Rejecting startup and removing the paired readiness listener.
                activeServer.off('listening', serverListenComplete);
                reject(errorData);

            }

            function serverListenComplete() {
                //Resolving startup and removing the paired error listener.
                activeServer.off('error', serverListenError);
                resolve(undefined);

            }

            //Binding only the validated loopback host from layer.config.js.
            activeServer.once('error', serverListenError);
            activeServer.once('listening', serverListenComplete);
            activeServer.listen(configData.development.port, configData.development.host);

        });

    } catch {
        developmentWatch.close();
        liveReload?.close();
        await developmentBackend.close();

        throw new LayerCliError('CLI_DEV_HOST_FAILED', 'Local development host could not start.', {
            host: configData.development.host,
            port: configData.development.port
        });

    }

    const activeServer = developmentServer;
    let closedStatus = false;
    const originData = `${protocolName}://${configData.development.host}:${configData.development.port}`;

    return Object.freeze({
        origin: originData,
        protocol: protocolName,
        host: configData.development.host,
        port: configData.development.port,
        async close() {
            //Closing the watcher and listener exactly once.
            if (closedStatus) {
                return false;

            }

            closedStatus = true;
            developmentWatch.close();
            liveReload?.close();

            const listenerClosePromise = new Promise(function developmentServerClose(resolve, reject) {
                //Waiting for all owned development connections to close.
                activeServer.close(function developmentServerCloseComplete(closeError) {
                    //Resolving only after Node releases the listener.
                    if (closeError !== undefined) {
                        reject(closeError);

                        return;

                    }

                    resolve(undefined);

                });

            });

            await Promise.all([
                listenerClosePromise,
                developmentBackend.close()
            ]);

            return true;

        }
    });

}
