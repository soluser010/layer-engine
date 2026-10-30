import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild-wasm';
import {LayerCliError} from './cli-error.js';

const layerPwaEntryFile = fileURLToPath(import.meta.resolve('@solcorp/layer-pwa'));
const layerStorageEntryFile = fileURLToPath(import.meta.resolve('@solcorp/layer-storage'));

/**
 * @param {string} rootDirectory
 * @param {string} fileData
 */
function relativeFileNormalize(rootDirectory, fileData) {
    //Normalizing generated worker paths independently from the host platform.
    return path.relative(rootDirectory, fileData).replaceAll('\\', '/');

}

/**
 * @param {Readonly<Record<string, unknown>>} versionManifest
 * @param {Readonly<Record<string, unknown>>} webAppManifest
 * @param {string} appName
 * @param {{buildId: string, appKey: string, scope: string, development?: boolean} | undefined} deployment
 */
function serviceWorkerSourceCreate(versionManifest, webAppManifest, appName, deployment) {
    let shareTargetData = null;

    if (typeof webAppManifest.share_target === 'object' && webAppManifest.share_target !== null &&
    /** @type {Record<string, unknown>} */ (webAppManifest.share_target).method === 'POST') {
        //Embedding only a validated POST target that requires worker body capture.
        shareTargetData = webAppManifest.share_target;

    }

    //Embedding the already validated immutable install contract in the worker module.
    return `
import {layerServiceWorkerRuntimeCreate} from '@solcorp/layer-pwa';
import {
    layerWorkerOutboxDrainCreate,
    layerWorkerShareTargetCaptureCreate
} from '@solcorp/layer-storage';

const workerShareTarget = ${JSON.stringify(shareTargetData)};
let shareTargetCapture;

if (workerShareTarget !== null) {
    //Creating the bounded temporary inbox writer only for the declared POST target.
    shareTargetCapture = layerWorkerShareTargetCaptureCreate({
        appId: ${JSON.stringify(appName)},
        applicationOrigin: self.location.origin,
        shareTarget: workerShareTarget,
        shareIdCreate: () => crypto.randomUUID(),
        indexedDb: indexedDB
    });

}

const workerOutboxDrain = layerWorkerOutboxDrainCreate({
    appId: ${JSON.stringify(appName)},
    applicationOrigin: self.location.origin,
    indexedDb: indexedDB,
    fetchImplementation: fetch.bind(globalThis),
    requestIdCreate: () => crypto.randomUUID(),
    ownerIdCreate: () => crypto.randomUUID()
});

const outboxDrain = async function outboxDrainRun() {
    //Draining one bounded worker batch from the current user database.
    const drainResult = await workerOutboxDrain();

    if (drainResult.retryable > 0) {
        //Rejecting the sync event so the browser can apply its retry policy.
        throw new Error('Layer outbox still contains retryable commands.');

    }

    return drainResult;
};

const workerRuntimeOptions = {
    manifest: ${JSON.stringify(versionManifest)},
    deployment: ${JSON.stringify(deployment)},
    cacheStorage: caches,
    fetchImplementation: fetch.bind(globalThis),
    subtleCrypto: crypto.subtle,
    base64Encode: btoa.bind(globalThis),
    scope: self,
    applicationOrigin: self.location.origin,
    outboxDrain
};

if (workerShareTarget !== null) {
    //Connecting the exact manifest action to its temporary IndexedDB capture.
    workerRuntimeOptions.shareTarget = workerShareTarget;
    workerRuntimeOptions.shareTargetCapture = shareTargetCapture;

}

const workerRuntime = layerServiceWorkerRuntimeCreate(workerRuntimeOptions);

workerRuntime.attach();
`;

}

/**
 * @param {object} bundleOptions
 * @param {string} bundleOptions.rootDirectory
 * @param {Readonly<Record<string, unknown>>} bundleOptions.manifest
 * @param {Readonly<Record<string, unknown>>} bundleOptions.webAppManifest
 * @param {string} bundleOptions.appName
 * @param {string} bundleOptions.outputFile
 * @param {{buildId: string, appKey: string, scope: string, development?: boolean}} [bundleOptions.deployment]
 */
export async function layerServiceWorkerBundleCreate(bundleOptions) {
    try {
        const buildResult = await build({
            absWorkingDir: bundleOptions.rootDirectory,
            bundle: true,
            charset: 'utf8',
            entryPoints: ['layer-service-worker'],
            format: 'esm',
            legalComments: 'eof',
            logLevel: 'silent',
            outfile: path.join(bundleOptions.rootDirectory, bundleOptions.outputFile),
            platform: 'browser',
            sourcemap: 'linked',
            sourcesContent: false,
            target: ['es2022'],
            treeShaking: true,
            write: false,
            plugins: [{
                name: 'layer-service-worker',
                setup(buildApi) {
                    //Connecting the generated worker entry to the trusted PWA runtime.
                    buildApi.onResolve({filter: /^layer-service-worker$/}, function workerResolve() {
                        //Selecting the virtual Service Worker as the bundle root.
                        return {namespace: 'layer-service-worker', path: 'entry'};

                    });
                    buildApi.onResolve({filter: /^@solcorp\/layer-pwa$/, namespace: 'layer-service-worker'}, function pwaResolve() {
                        //Resolving the package implementation without a browser bare import.
                        return {namespace: 'file', path: layerPwaEntryFile};

                    });
                    buildApi.onResolve({filter: /^@solcorp\/layer-storage$/, namespace: 'layer-service-worker'}, function storageResolve() {
                        //Resolving the worker-safe IndexedDB outbox bridge.
                        return {namespace: 'file', path: layerStorageEntryFile};

                    });
                    buildApi.onLoad({filter: /.*/, namespace: 'layer-service-worker'}, function workerLoad() {
                        //Providing the generated worker source to the in-memory bundler.
                        return {
                            contents: serviceWorkerSourceCreate(
                                bundleOptions.manifest,
                                bundleOptions.webAppManifest,
                                bundleOptions.appName,
                                bundleOptions.deployment
                            ),
                            loader: 'js'
                        };

                    });

                }
            }]
        });
        const bundleArtifacts = /** @type {Record<string, string>} */ ({});

        for (const outputData of buildResult.outputFiles ?? []) {
            bundleArtifacts[relativeFileNormalize(bundleOptions.rootDirectory, outputData.path)] = outputData.text;

        }

        if (!Object.hasOwn(bundleArtifacts, bundleOptions.outputFile) ||
            !Object.hasOwn(bundleArtifacts, `${bundleOptions.outputFile}.map`)) {
            throw new Error('The Service Worker bundle did not produce its module and source map.');

        }

        return Object.freeze(bundleArtifacts);

    } catch (bundleError) {
        let failureReason = 'Unknown bundle failure.';

        //Publishing one bounded bundler reason without exposing internal objects.
        if (bundleError instanceof Error) {
            failureReason = bundleError.message.slice(0, 500);

        }

        throw new LayerCliError('CLI_BUILD_WORKER_BUNDLE_FAILED', 'The Service Worker could not be bundled.', {
            reason: failureReason
        });

    }

}
