import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {
    chmod,
    copyFile,
    mkdir,
    open,
    readFile,
    rename,
    rm,
    stat,
    writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    monitorEventLoopDelay,
    performance
} from 'node:perf_hooks';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {layerNodeVersionSupported} from './runtime-version.js';

const caddyDownloadMaximumBytes = Number( 128 * 1024 * 1024 );
const deploymentDomainPattern = /^(?:localhost|(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;
const deploymentWorkerMetricContractData = Object.freeze({
    resolutionMs: Number( 10 ),
    intervalMs: Number( 5000 ),
    overloadUtilization: Number( 0.7 ),
    overloadDelayMs: Number( 50 ),
    quietUtilization: Number( 0.3 ),
    quietDelayMs: Number( 20 ),
    scaleUpIntervals: Number( 3 ),
    scaleDownIntervals: Number( 24 ),
    scaleUpCooldownMs: Number( 30000 ),
    scaleDownCooldownMs: Number( 120000 )
});

/** @typedef {Error & {code: string}} LayerDeploymentError */
/** @typedef {{archive: string, url: string, sha512: string}} LayerCaddyAsset */
/** @typedef {{appName: string, appVersion: string, domain: string | null, originPort: number, serverEntry: boolean, workers?: {minimum: number, maximum: number | 'auto', maximumConnectionsPerWorker?: number, connectionBudget?: number | null}, caddy: {version: string, assets: Record<string, LayerCaddyAsset>}}} LayerDeploymentData */
/** @typedef {{cwd?: string, env?: NodeJS.ProcessEnv, stdio?: any}} LayerDeploymentProcessOptions */
/** @typedef {{code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string}} LayerDeploymentProcessResult */
/** @typedef {{start: (optionsData: {host: string, port: number}) => Promise<void>, stop: (optionsData: {deadlineMs: number}) => Promise<void>, isReady: () => boolean}} LayerServerRuntime */

//Function for getting the worker metric and autoscale contract
export const deploymentWorkerMetricContractGet = function(){
    //Returning the shared immutable values used by metrics, scaling, and regression tests
    return deploymentWorkerMetricContractData;

};

//Function for creating a bounded deployment error
/**
 * @param {string} errorCodeData
 * @param {string} messageData
 * @returns {LayerDeploymentError}
 */
const deploymentErrorCreate = function( errorCodeData, messageData ){
    //Creating the public failure without attaching secrets or internal stack metadata
    const deploymentError = /** @type {LayerDeploymentError} */ (new Error( String( messageData ) ));
    deploymentError.code = String( errorCodeData );

    //CallBack THE OBJECT
    return deploymentError;

};

//Function for creating a SHA-256 file digest
/** @param {string} filePathData */
const deploymentFileDigestCreate = async function( filePathData ){
    //Getting the immutable deployment file before checking its build record
    const fileBufferData = await readFile( filePathData );

    //CallBack THE STRING
    return createHash( 'sha256' ).update( fileBufferData ).digest( 'hex' );

};

//Function for running one bounded child process
/**
 * @param {string} executableData
 * @param {readonly string[]} argumentItemsData
 * @param {LayerDeploymentProcessOptions} [processOptionsData]
 * @returns {Promise<LayerDeploymentProcessResult>}
 */
const deploymentProcessRun = function( executableData, argumentItemsData, processOptionsData = {} ){
    //CallBack THE PROMISE
    return new Promise(function deploymentProcessWait( resolve, reject ){
        //Launching the deployment dependency without a shell command boundary
        const childProcessData = spawn( executableData, argumentItemsData, {
            cwd: processOptionsData.cwd,
            env: processOptionsData.env ?? process.env,
            stdio: processOptionsData.stdio ?? ['ignore', 'pipe', 'pipe'],
            windowsHide: true
        });
        let standardOutputData = String();
        let standardErrorData = String();

        //Collecting bounded diagnostic output when the child is not attached to the terminal
        if ( childProcessData.stdout !== null ){
            childProcessData.stdout.on( 'data', function processOutputCollect( chunkData ){
                //Keeping only a bounded tail for safe startup diagnostics
                standardOutputData = String( standardOutputData + chunkData ).slice( -8192 );

            });

        }

        if ( childProcessData.stderr !== null ){
            childProcessData.stderr.on( 'data', function processErrorCollect( chunkData ){
                //Keeping only a bounded tail without printing environment variables
                standardErrorData = String( standardErrorData + chunkData ).slice( -8192 );

            });

        }

        childProcessData.once( 'error', function processLaunchReject( processError ){
            //Passing process launch failures to the deployment boundary
            reject( processError );

        });
        childProcessData.once( 'exit', function processExitResolve( processCode, processSignal ){
            //Returning the complete bounded process result
            resolve({
                code: processCode,
                signal: processSignal,
                stdout: standardOutputData,
                stderr: standardErrorData
            });

        });

    });

};

//Function for getting the npm executable invocation
const deploymentNpmCommandCreate = function(){
    //Using the exact npm CLI that launched the package script when it is available
    if ( typeof process.env.npm_execpath === 'string' && process.env.npm_execpath.length > Number( 0 ) ){
        const npmExecutionPath = String( process.env.npm_execpath );
        //CallBack THE OBJECT
        return {
            executable: process.execPath,
            prefix: [npmExecutionPath]
        };

    }

    let npmExecutable = String( 'npm' );
    let npmPrefixData = /** @type {string[]} */ ([]);

    //Selecting the installed npm JavaScript entry without invoking a Windows command shell
    if ( process.platform === String( 'win32' ) ){
        npmExecutable = process.execPath;
        npmPrefixData = [
            path.join( path.dirname( process.execPath ), 'node_modules', 'npm', 'bin', 'npm-cli.js' )
        ];

    }

    //CallBack THE OBJECT
    return {
        executable: npmExecutable,
        prefix: npmPrefixData
    };

};

//Function for checking Node and npm production versions
/** @param {string} bundleRootData */
const deploymentRuntimeCheck = async function( bundleRootData ){
    //Checking the patched release floor before loading deployment dependencies
    if ( layerNodeVersionSupported( process.versions.node ) === false ){
        //Passing the unsupported runtime to the deployment boundary
        throw deploymentErrorCreate( 'DEPLOY_NODE_UNSUPPORTED', `Layer requires Node.js >=24.22.1 <25; found ${process.versions.node}. Install a patched Node.js 24 release and restart all workers.` );

    }

    //Getting the active npm version through the same executable used for installation
    const npmCommandData = deploymentNpmCommandCreate();
    const npmVersionResult = await deploymentProcessRun(
        npmCommandData.executable,
        [...npmCommandData.prefix, '--version'],
        {cwd: bundleRootData}
    );
    const npmMajorVersion = Number( npmVersionResult.stdout.trim().split( '.' )[0] );

    //Checking the npm baseline before the lockfile can be interpreted
    if ( npmVersionResult.code !== Number( 0 ) || npmMajorVersion !== Number( 11 ) ){
        //Passing the unsupported package manager to the deployment boundary
        throw deploymentErrorCreate( 'DEPLOY_NPM_UNSUPPORTED', 'Layer deployment requires npm 11.' );

    }

};

//Function for acquiring one filesystem installation lease
/** @param {string} leasePathData */
const deploymentLeaseAcquire = async function( leasePathData ){
    const leaseStartedAt = Date.now();

    //Waiting for another bounded installer instead of racing npm ci
    while ( Date.now() - leaseStartedAt < Number( 120000 ) ){
        try {
            //Creating the lease atomically for the current process
            const leaseFileData = await open( leasePathData, 'wx' );
            await leaseFileData.writeFile( JSON.stringify({
                pid: process.pid,
                createdAt: new Date().toISOString()
            }) );

            //CallBack THE OBJECT
            return leaseFileData;

        } catch( leaseError ){
            const leaseFailure = /** @type {NodeJS.ErrnoException} */ (leaseError);

            if ( leaseFailure.code !== String( 'EEXIST' ) ){
                //Passing unexpected filesystem failures to the deployment boundary
                throw leaseError;

            }

            const leaseStatusData = await stat( leasePathData ).catch(function missingLeaseHandle( missingLeaseError ){
                //Tolerating a lease removed between the exclusive-open failure and inspection
                if ( missingLeaseError.code === String( 'ENOENT' ) ){
                    return null;

                }

                //Passing unexpected lease inspection failures to the caller
                throw missingLeaseError;

            });

            //Removing a stale installer lease after ten minutes
            if ( leaseStatusData !== null && Date.now() - leaseStatusData.mtimeMs > Number( 600000 ) ){
                await rm( leasePathData, {force: true} );

                continue;

            }

            //Waiting briefly before checking the active installer again
            await new Promise(function deploymentLeaseDelay( resolve ){
                //Scheduling one bounded retry without blocking the Node event loop
                setTimeout( resolve, Number( 250 ) );

            });

        }

    }

    //Passing the exhausted installation wait to the deployment boundary
    throw deploymentErrorCreate( 'DEPLOY_INSTALL_LOCKED', 'The deployment dependency installation is locked.' );

};

//Function for checking whether the exact locked dependency tree is ready
/**
 * @param {string} bundleRootData
 * @param {string} packageLockDigest
 * @param {string} installationMarkerPath
 */
const deploymentDependenciesCheck = async function( bundleRootData, packageLockDigest, installationMarkerPath ){
    let installationMarkerData = null;

    try {
        //Reading the marker created only after a successful npm ci
        installationMarkerData = JSON.parse( await readFile( installationMarkerPath, 'utf8' ) );

    } catch( markerReadError ){
        const markerReadFailure = /** @type {NodeJS.ErrnoException} */ (markerReadError);
        //Tolerating only an absent or malformed marker so npm can repair the environment
        if ( markerReadFailure.code !== String( 'ENOENT' ) && markerReadFailure instanceof SyntaxError === false ){
            throw markerReadError;

        }

    }

    //Rejecting a missing or stale marker before asking npm to inspect the dependency tree
    if ( installationMarkerData === null || installationMarkerData.lockDigest !== packageLockDigest ){
        //CallBack THE BOOLEAN
        return false;

    }

    const npmCommandData = deploymentNpmCommandCreate();
    const npmListResult = await deploymentProcessRun(
        npmCommandData.executable,
        [
            ...npmCommandData.prefix,
            'ls',
            '--omit=dev',
            '--all',
            '--json'
        ],
        {cwd: bundleRootData}
    );

    //CallBack THE BOOLEAN
    return npmListResult.code === Number( 0 );

};

//Function for checking and installing locked production dependencies
/**
 * @param {string} bundleRootData
 * @param {string} stateDirectoryData
 */
const deploymentDependenciesEnsure = async function( bundleRootData, stateDirectoryData ){
    const packageLockDigest = await deploymentFileDigestCreate( path.join( bundleRootData, 'package-lock.json' ) );
    const installationMarkerPath = path.join( bundleRootData, 'node_modules', '.layer-install.json' );

    //Returning without registry access when npm confirms the exact locked tree
    if ( await deploymentDependenciesCheck( bundleRootData, packageLockDigest, installationMarkerPath ) === true ){
        //CallBack THE BOOLEAN
        return false;

    }

    await mkdir( stateDirectoryData, {recursive: true} );
    const installationLeasePath = path.join( stateDirectoryData, 'install.lock' );
    const installationLeaseFile = await deploymentLeaseAcquire( installationLeasePath );

    try {
        //Checking again after the lease because another launcher may have completed installation
        if ( await deploymentDependenciesCheck( bundleRootData, packageLockDigest, installationMarkerPath ) === true ){
            //CallBack THE BOOLEAN
            return false;

        }

        //Launching the immutable production dependency installation
        const npmCommandData = deploymentNpmCommandCreate();
        const npmInstallResult = await deploymentProcessRun(
            npmCommandData.executable,
            [
                ...npmCommandData.prefix,
                'ci',
                '--omit=dev',
                '--ignore-scripts',
                '--no-audit',
                '--no-fund'
            ],
            {
                cwd: bundleRootData,
                stdio: 'inherit'
            }
        );

        if ( npmInstallResult.code !== Number( 0 ) ){
            //Passing the failed immutable install to the deployment boundary
            throw deploymentErrorCreate( 'DEPLOY_DEPENDENCIES_FAILED', 'Locked deployment dependencies could not be installed.' );

        }

        const npmCommandDataAfterInstall = deploymentNpmCommandCreate();
        const npmListResult = await deploymentProcessRun(
            npmCommandDataAfterInstall.executable,
            [
                ...npmCommandDataAfterInstall.prefix,
                'ls',
                '--omit=dev',
                '--all',
                '--json'
            ],
            {cwd: bundleRootData}
        );

        if ( npmListResult.code !== Number( 0 ) ){
            //Refusing to mark a partial or invalid npm tree as installed
            throw deploymentErrorCreate( 'DEPLOY_DEPENDENCIES_FAILED', 'Locked deployment dependencies could not be verified.' );

        }

        //Recording the exact lock only after every dependency was installed
        await writeFile( installationMarkerPath, JSON.stringify({
            lockDigest: packageLockDigest,
            installedAt: new Date().toISOString()
        }, null, 4) + String( '\n' ), 'utf8' );

        //CallBack THE BOOLEAN
        return true;

    } finally {
        //Releasing the installer lease for another process or deployment version
        await installationLeaseFile.close();
        await rm( installationLeasePath, {force: true} );

    }

};

//Function for selecting the pinned Caddy asset for the current platform
/**
 * @param {LayerDeploymentData} deploymentData
 * @param {NodeJS.Platform} [platformData]
 * @param {string} [architectureData]
 */
export const deploymentCaddyAssetGet = function( deploymentData, platformData = process.platform, architectureData = process.arch ){
    const platformIdentifier = String( platformData ) + String( '-' ) + String( architectureData );
    const caddyAssetData = deploymentData.caddy.assets[platformIdentifier];

    //Checking the explicitly supported Linux and Windows platform matrix
    if ( caddyAssetData === undefined ){
        throw deploymentErrorCreate(
            'DEPLOY_PLATFORM_UNSUPPORTED',
            'Caddy is unavailable for this operating system or architecture.'
        );

    }

    //CallBack THE OBJECT
    return caddyAssetData;

};

//Function for checking one archive entry against the executable allowlist
/**
 * @param {string} archiveEntryPathData
 * @param {string} expectedExecutableData
 */
export const deploymentArchiveEntryAllowed = function( archiveEntryPathData, expectedExecutableData ){
    //CallBack THE BOOLEAN
    return (
        archiveEntryPathData === expectedExecutableData &&
        path.posix.basename( archiveEntryPathData ) === archiveEntryPathData
    );

};

//Function for checking one downloaded Caddy archive digest
/**
 * @param {Buffer} archiveBufferData
 * @param {string} expectedDigestData
 */
export const deploymentCaddyArchiveVerify = function( archiveBufferData, expectedDigestData ){
    const archiveDigestData = createHash( 'sha512' ).update( archiveBufferData ).digest( 'hex' );

    if ( archiveDigestData !== expectedDigestData ){
        //Passing the corrupted or substituted release archive to the deployment boundary
        throw deploymentErrorCreate( 'DEPLOY_CADDY_INTEGRITY_FAILED', 'Caddy release integrity verification failed.' );

    }

};

//Function for downloading one release asset through approved HTTPS redirects
/**
 * @param {string} assetUrlData
 * @param {string} outputPathData
 * @param {{fetchImplementation?: typeof fetch, maximumBytes?: number}} [downloadOptionsData]
 */
export const deploymentDownloadCreate = async function( assetUrlData, outputPathData, downloadOptionsData = {} ){
    let requestUrlData = new URL( assetUrlData );
    const fetchImplementation = downloadOptionsData.fetchImplementation ?? fetch;
    const maximumBytes = downloadOptionsData.maximumBytes ?? caddyDownloadMaximumBytes;

    //Following only a bounded set of official GitHub release redirects
    for ( let redirectNumber = Number( 0 ); redirectNumber <= Number( 5 ); redirectNumber++ ){
        const hostnameData = requestUrlData.hostname.toLowerCase();
        const approvedHostnameStatus =
            hostnameData === String( 'github.com' ) ||
            hostnameData.endsWith( String( '.githubusercontent.com' ) );

        if ( requestUrlData.protocol !== String( 'https:' ) || approvedHostnameStatus === false ){
            //Passing the unsafe redirect target to the deployment boundary
            throw deploymentErrorCreate( 'DEPLOY_CADDY_DOWNLOAD_DENIED', 'Caddy download left the approved HTTPS hosts.' );

        }

        const downloadController = new AbortController();
        const downloadTimeout = setTimeout(function caddyDownloadAbort(){
            //Stopping a stalled release download after thirty seconds
            downloadController.abort();

        }, Number( 30000 ) );
        let downloadResponse;

        try {
            //Requesting the pinned release asset without automatic redirects
            downloadResponse = await fetchImplementation( requestUrlData, {
                redirect: 'manual',
                signal: downloadController.signal
            });

        } catch{
            //Converting network, abort, and stream setup failures into one safe code
            throw deploymentErrorCreate( 'DEPLOY_CADDY_DOWNLOAD_FAILED', 'Caddy release asset could not be downloaded.' );

        } finally {
            //Removing the download deadline after the HTTP operation settles
            clearTimeout( downloadTimeout );

        }

        if ( downloadResponse.status >= Number( 300 ) && downloadResponse.status < Number( 400 ) ){
            const redirectLocationData = downloadResponse.headers.get( 'location' );

            if ( redirectLocationData === null ){
                //Passing the malformed release redirect to the deployment boundary
                throw deploymentErrorCreate( 'DEPLOY_CADDY_DOWNLOAD_FAILED', 'Caddy download returned an empty redirect.' );

            }

            await downloadResponse.body?.cancel();
            requestUrlData = new URL( redirectLocationData, requestUrlData );

            continue;

        }

        if ( downloadResponse.ok === false ){
            //Passing the bounded release failure to the deployment boundary
            throw deploymentErrorCreate( 'DEPLOY_CADDY_DOWNLOAD_FAILED', 'Caddy release asset could not be downloaded.' );

        }

        const contentLengthData = Number( downloadResponse.headers.get( 'content-length' ) ?? Number( 0 ) );

        if ( contentLengthData > maximumBytes ){
            //Passing the oversized release asset to the deployment boundary
            throw deploymentErrorCreate( 'DEPLOY_CADDY_DOWNLOAD_OVERSIZED', 'Caddy release asset exceeds the download limit.' );

        }

        if ( downloadResponse.body === null ){
            //Passing an empty successful response to the deployment boundary
            throw deploymentErrorCreate( 'DEPLOY_CADDY_DOWNLOAD_FAILED', 'Caddy release asset returned an empty body.' );

        }

        const downloadReader = downloadResponse.body.getReader();
        const archiveChunksData = /** @type {Uint8Array[]} */ ([]);
        let archiveSizeData = Number( 0 );

        try {
            //Reading the response incrementally so chunked downloads cannot bypass the size limit
            while ( true ){
                const downloadChunkData = await downloadReader.read();

                if ( downloadChunkData.done === true ){
                    break;

                }

                archiveSizeData += downloadChunkData.value.byteLength;

                if ( archiveSizeData > maximumBytes ){
                    await downloadReader.cancel();
                    throw deploymentErrorCreate( 'DEPLOY_CADDY_DOWNLOAD_OVERSIZED', 'Caddy release asset exceeds the download limit.' );

                }

                archiveChunksData.push( downloadChunkData.value );

            }

        } catch( downloadStreamError ){
            if ( /** @type {Partial<LayerDeploymentError>} */ (downloadStreamError).code === String( 'DEPLOY_CADDY_DOWNLOAD_OVERSIZED' ) ){
                throw downloadStreamError;

            }

            //Converting interrupted response bodies into the stable download code
            throw deploymentErrorCreate( 'DEPLOY_CADDY_DOWNLOAD_FAILED', 'Caddy release asset download was interrupted.' );

        }

        const archiveBufferData = Buffer.concat( archiveChunksData.map(function archiveChunkConvert( chunkData ){
            //Converting each bounded Web stream chunk without copying unrelated memory
            return Buffer.from( chunkData.buffer, chunkData.byteOffset, chunkData.byteLength );

        }), archiveSizeData );

        if ( archiveBufferData.length > maximumBytes ){
            //Passing the oversized streamed asset to the deployment boundary
            throw deploymentErrorCreate( 'DEPLOY_CADDY_DOWNLOAD_OVERSIZED', 'Caddy release asset exceeds the download limit.' );

        }

        //Writing the complete bounded archive after the response is verified
        await writeFile( outputPathData, archiveBufferData );

        //CallBack THE OBJECT
        return archiveBufferData;

    }

    //Passing the exhausted redirect chain to the deployment boundary
    throw deploymentErrorCreate( 'DEPLOY_CADDY_DOWNLOAD_FAILED', 'Caddy release asset exceeded the redirect limit.' );

};

//Function for getting the platform-specific Caddy executable name
const deploymentCaddyExecutableNameGet = function(){
    let executableNameData = String( 'caddy' );

    //Selecting the executable suffix required by Windows process creation
    if ( process.platform === String( 'win32' ) ){
        executableNameData = String( 'caddy.exe' );

    }

    //CallBack THE STRING
    return executableNameData;

};

//Function for extracting the single Caddy executable
/**
 * @param {string} archivePathData
 * @param {string} targetDirectoryData
 * @param {LayerCaddyAsset} assetData
 */
const deploymentCaddyArchiveExtract = async function( archivePathData, targetDirectoryData, assetData ){
    const executableNameData = deploymentCaddyExecutableNameGet();
    const executablePathData = path.join( targetDirectoryData, executableNameData );

    //Creating an empty extraction boundary owned by the current release
    await rm( targetDirectoryData, {recursive: true, force: true} );
    await mkdir( targetDirectoryData, {recursive: true} );

    if ( assetData.archive === String( 'tar.gz' ) ){
        //Loading the locked TAR implementation only after npm ci succeeds
        const tarModuleData = await import( 'tar' );
        await tarModuleData.extract({
            file: archivePathData,
            cwd: targetDirectoryData,
            filter( archiveEntryPath ){
                //Extracting only the root Caddy executable from the official archive
                return deploymentArchiveEntryAllowed( archiveEntryPath, 'caddy' );

            },
            preservePaths: false,
            strict: true
        });

    } else {
        //Loading the locked ZIP implementation only after npm ci succeeds
        const yauzlModuleData = await import( 'yauzl' );

        await new Promise(function caddyZipExtractWait( resolve, reject ){
            //Opening the verified archive with lazy entry reading
            yauzlModuleData.open( archivePathData, {lazyEntries: true}, function caddyZipOpen( zipOpenError, zipFileData ){
                if ( zipOpenError !== null || zipFileData === undefined ){
                    //Passing the invalid ZIP archive to the deployment boundary
                    reject( zipOpenError ?? deploymentErrorCreate( 'DEPLOY_CADDY_ARCHIVE_INVALID', 'Caddy ZIP archive is invalid.' ) );

                    return;

                }

                let executableFoundStatus = false;

                zipFileData.on( 'entry', function caddyZipEntryRead( zipEntryData ){
                    //Ignoring every archive entry outside the expected root executable
                    if ( deploymentArchiveEntryAllowed( zipEntryData.fileName, 'caddy.exe' ) === false ){
                        zipFileData.readEntry();

                        return;

                    }

                    if ( executableFoundStatus === true ){
                        //Passing a duplicate executable entry to the deployment boundary
                        reject( deploymentErrorCreate( 'DEPLOY_CADDY_ARCHIVE_INVALID', 'Caddy ZIP archive contains duplicate executables.' ) );
                        zipFileData.close();

                        return;

                    }

                    executableFoundStatus = true;
                    zipFileData.openReadStream( zipEntryData, function caddyZipStreamOpen( streamOpenError, archiveStreamData ){
                        if ( streamOpenError !== null || archiveStreamData === undefined ){
                            //Passing the archive stream failure to the deployment boundary
                            reject( streamOpenError ?? deploymentErrorCreate( 'DEPLOY_CADDY_ARCHIVE_INVALID', 'Caddy ZIP executable is unavailable.' ) );

                            return;

                        }

                        const executableChunksData = /** @type {Buffer[]} */ ([]);
                        let executableSizeData = Number( 0 );

                        archiveStreamData.on( 'data', function caddyZipChunkRead( chunkData ){
                            //Bounding the extracted executable independently from the archive size
                            executableSizeData += chunkData.length;

                            if ( executableSizeData > caddyDownloadMaximumBytes ){
                                archiveStreamData.destroy(
                                    deploymentErrorCreate( 'DEPLOY_CADDY_ARCHIVE_INVALID', 'Caddy executable exceeds the extraction limit.' )
                                );

                                return;

                            }

                            executableChunksData.push( chunkData );

                        });
                        archiveStreamData.once( 'error', reject );
                        archiveStreamData.once( 'end', function caddyZipExecutableWrite(){
                            //Writing the complete executable after its bounded stream ends
                            writeFile( executablePathData, Buffer.concat( executableChunksData ) )
                                .then(function caddyZipWriteComplete(){
                                    //Closing the archive before completing extraction
                                    zipFileData.close();
                                    resolve( undefined );

                                })
                                .catch( reject );

                        });

                    });

                });
                zipFileData.once( 'error', reject );
                zipFileData.once( 'end', function caddyZipEntriesComplete(){
                    if ( executableFoundStatus === false ){
                        //Passing an archive without the expected executable to the boundary
                        reject( deploymentErrorCreate( 'DEPLOY_CADDY_ARCHIVE_INVALID', 'Caddy executable is missing from the ZIP archive.' ) );

                    }

                });
                zipFileData.readEntry();

            });

        });

    }

    const executableStatusData = await stat( executablePathData ).catch(function caddyExecutableMissing(){
        //Returning explicit absence for the archive validation below
        return null;

    });

    if ( executableStatusData === null || executableStatusData.isFile() === false ){
        //Passing the missing executable to the deployment boundary
        throw deploymentErrorCreate( 'DEPLOY_CADDY_ARCHIVE_INVALID', 'Caddy executable is missing from the release archive.' );

    }

    if ( process.platform !== String( 'win32' ) ){
        //Adding only the executable bits required by the deployment user
        await chmod( executablePathData, Number( 0o755 ) );

    }

    //CallBack THE STRING
    return executablePathData;

};

//Function for ensuring the pinned Caddy executable
/**
 * @param {LayerDeploymentData} deploymentData
 * @param {string} stateDirectoryData
 */
const deploymentCaddyEnsure = async function( deploymentData, stateDirectoryData ){
    const caddyAssetData = deploymentCaddyAssetGet( deploymentData );
    const executableNameData = deploymentCaddyExecutableNameGet();
    const caddyVersionDirectory = path.join( stateDirectoryData, 'caddy', deploymentData.caddy.version );
    const caddyExecutablePath = path.join(
        caddyVersionDirectory,
        String( process.platform ) + String( '-' ) + String( process.arch ),
        executableNameData
    );
    const existingExecutableStatus = await stat( caddyExecutablePath ).catch(function caddyExecutableMissing(){
        //Returning explicit absence so the pinned binary can be downloaded
        return null;

    });

    if ( existingExecutableStatus !== null && existingExecutableStatus.isFile() === true ){
        //CallBack THE STRING
        return caddyExecutablePath;

    }

    const caddyTemporaryDirectory = path.join(
        caddyVersionDirectory,
        String( '.download-' ) + String( process.pid ) + String( '-' ) + String( Date.now() )
    );
    const caddyArchivePath = path.join( caddyTemporaryDirectory, 'caddy.archive' );
    const caddyExtractDirectory = path.join( caddyTemporaryDirectory, 'extract' );

    //Creating one isolated directory for download and extraction
    await mkdir( caddyTemporaryDirectory, {recursive: true} );

    try {
        //Downloading and checking the exact official release archive
        const caddyArchiveBuffer = await deploymentDownloadCreate( caddyAssetData.url, caddyArchivePath );
        deploymentCaddyArchiveVerify( caddyArchiveBuffer, caddyAssetData.sha512 );

        const extractedExecutablePath = await deploymentCaddyArchiveExtract(
            caddyArchivePath,
            caddyExtractDirectory,
            caddyAssetData
        );
        const pendingExecutablePath = caddyExecutablePath + String( '.pending-' ) + String( process.pid );

        //Publishing the verified executable atomically under its immutable platform directory
        await mkdir( path.dirname( caddyExecutablePath ), {recursive: true} );
        await copyFile( extractedExecutablePath, pendingExecutablePath );

        if ( process.platform !== String( 'win32' ) ){
            await chmod( pendingExecutablePath, Number( 0o755 ) );

        }

        await rename( pendingExecutablePath, caddyExecutablePath ).catch(async function caddyPublishConflict( publishError ){
            const publishFailure = /** @type {NodeJS.ErrnoException} */ (publishError);

            //Accepting an executable concurrently published into the same pinned path
            if ( publishFailure.code === String( 'EEXIST' ) || publishFailure.code === String( 'EPERM' ) ){
                await rm( pendingExecutablePath, {force: true} );

                return;

            }

            throw publishError;

        });

    } finally {
        //Removing download archives whether installation succeeds or fails
        await rm( caddyTemporaryDirectory, {recursive: true, force: true} );

    }

    //CallBack THE STRING
    return caddyExecutablePath;

};

//Function for checking the installed Caddy release version
/**
 * @param {string} caddyExecutablePath
 * @param {LayerDeploymentData} deploymentData
 * @param {string} bundleRootData
 */
const deploymentCaddyVersionCheck = async function( caddyExecutablePath, deploymentData, bundleRootData ){
    //Running only the pinned executable selected from the persistent state directory
    const caddyVersionResult = await deploymentProcessRun(
        caddyExecutablePath,
        ['version'],
        {cwd: bundleRootData}
    );
    const expectedVersionPrefix = String( 'v' ) + String( deploymentData.caddy.version );

    if (
        caddyVersionResult.code !== Number( 0 ) ||
        caddyVersionResult.stdout.trim().startsWith( expectedVersionPrefix ) === false
    ){
        //Refusing a stale or replaced executable even when its path is version-scoped
        throw deploymentErrorCreate( 'DEPLOY_CADDY_VERSION_INVALID', 'The installed Caddy executable does not match the pinned release.' );

    }

};

//Function for getting the persistent deployment state directory
/** @param {LayerDeploymentData} deploymentData */
const deploymentStateDirectoryGet = function( deploymentData ){
    //Using the explicit operator path when one is configured
    if ( typeof process.env.LAYER_STATE_DIRECTORY === 'string' && process.env.LAYER_STATE_DIRECTORY.length > Number( 0 ) ){
        const configuredStateDirectory = String( process.env.LAYER_STATE_DIRECTORY );
        //CallBack THE STRING
        return path.resolve( configuredStateDirectory );

    }

    if ( process.platform === String( 'win32' ) ){
        const localApplicationDirectory = process.env.LOCALAPPDATA ?? path.join( os.homedir(), 'AppData', 'Local' );

        //CallBack THE STRING
        return path.join( localApplicationDirectory, 'Layer-Engine', deploymentData.appName );

    }

    const userStateDirectory = process.env.XDG_STATE_HOME ?? path.join( os.homedir(), '.local', 'state' );

    //CallBack THE STRING
    return path.join( userStateDirectory, 'layer-engine', deploymentData.appName );

};

//Function for checking every immutable deployment artifact
/** @param {string} bundleRootData */
export const deploymentIntegrityCheck = async function( bundleRootData ){
    const buildManifestPath = path.join( bundleRootData, '_layer', 'build.json' );
    const buildManifestData = JSON.parse( await readFile( buildManifestPath, 'utf8' ) );

    //Checking every recorded file without following paths outside the bundle
    for ( const [artifactName, expectedIntegrity] of Object.entries( buildManifestData.integrity ) ){
        const artifactPath = path.resolve( bundleRootData, artifactName );
        const artifactRelativePath = path.relative( bundleRootData, artifactPath );

        if ( artifactRelativePath.startsWith( '..' ) || path.isAbsolute( artifactRelativePath ) ){
            //Passing the unsafe build record to the deployment boundary
            throw deploymentErrorCreate( 'DEPLOY_INTEGRITY_INVALID', 'Deployment integrity metadata contains an unsafe path.' );

        }

        const artifactDigest = await deploymentFileDigestCreate( artifactPath );

        if ( expectedIntegrity !== String( 'sha256-' ) + String( artifactDigest ) ){
            //Passing the changed artifact to the deployment boundary
            throw deploymentErrorCreate( 'DEPLOY_INTEGRITY_FAILED', 'Deployment artifact integrity verification failed.' );

        }

    }

};

//Function for getting the deployment domain
/**
 * @param {{domain: string | null}} deploymentData
 * @param {Record<string, string | undefined>} [environmentData]
 */
export const deploymentDomainGet = function( deploymentData, environmentData = process.env ){
    const domainData = environmentData.LAYER_DOMAIN ?? deploymentData.domain;

    //Checking the runtime override with the same build-time hostname contract
    if ( typeof domainData !== 'string' || deploymentDomainPattern.test( domainData ) === false ){
        //Passing the absent or unsafe domain to the deployment boundary
        throw deploymentErrorCreate(
            'DEPLOY_DOMAIN_REQUIRED',
            'Set one safe deployment domain in layer.config.js or LAYER_DOMAIN.'
        );

    }

    //CallBack THE STRING
    return domainData;

};

//Function for getting a bounded public listener port
/**
 * @param {Record<string, string | undefined>} environmentData
 * @param {string} variableNameData
 * @param {number} defaultPortData
 */
export const deploymentPortGet = function( environmentData, variableNameData, defaultPortData ){
    const portInputData = environmentData[variableNameData] ?? defaultPortData;
    const portData = Number( portInputData );

    //Checking the complete integer representation before passing it to Caddy
    if (
        Number.isInteger( portData ) === false ||
        portData < Number( 1 ) ||
        portData > Number( 65535 ) ||
        String( portData ) !== String( portInputData )
    ){
        //Passing the invalid listener contract to the deployment boundary
        throw deploymentErrorCreate( 'DEPLOY_PORT_INVALID', 'Layer deployment listener ports must be integers between 1 and 65535.' );

    }

    //CallBack THE NUMBER
    return portData;

};

//Function for loading the optional bundled application server
/**
 * @param {string} bundleRootData
 * @param {LayerDeploymentData} deploymentData
 * @returns {Promise<LayerServerRuntime | null>}
 */
const deploymentServerCreate = async function(
    bundleRootData,
    /** @type {string} */ stateDirectoryData,
    deploymentData,
    /** @type {string} */ workerIdentifierData = `production-${String( process.pid )}`
){
    //Returning explicit absence for a static-only PWA
    if ( deploymentData.serverEntry === false ){
        //CallBack THE OBJECT
        return null;

    }

    const serverModulePath = path.join( bundleRootData, '_layer', 'server', 'application.mjs' );
    const serverModuleData = await import( pathToFileURL( serverModulePath ).href );

    if ( typeof serverModuleData.layerServerCreate !== String( 'function' ) ){
        //Passing the invalid server bundle to the deployment boundary
        throw deploymentErrorCreate( 'DEPLOY_SERVER_INVALID', 'Server entry must export layerServerCreate(context).' );

    }

    //Creating the application runtime from bounded public deployment metadata
    const serverRuntimeData = /** @type {LayerServerRuntime} */ (await serverModuleData.layerServerCreate( Object.freeze({
        appName: deploymentData.appName,
        appVersion: deploymentData.appVersion,
        environment: 'production',
        rootDirectory: bundleRootData,
        stateDirectory: stateDirectoryData,
        workerId: workerIdentifierData,
        trustedProxy: Object.freeze({
            addresses: Object.freeze(['loopback']),
            header: 'x-forwarded-for',
            maximumHops: 8
        })
    }) ));

    if (
        serverRuntimeData === null ||
        typeof serverRuntimeData !== String( 'object' ) ||
        typeof serverRuntimeData.start !== String( 'function' ) ||
        typeof serverRuntimeData.stop !== String( 'function' ) ||
        typeof serverRuntimeData.isReady !== String( 'function' )
    ){
        //Passing the incomplete application runtime to the deployment boundary
        throw deploymentErrorCreate( 'DEPLOY_SERVER_INVALID', 'layerServerCreate(context) returned an invalid lifecycle.' );

    }

    //CallBack THE OBJECT
    return serverRuntimeData;

};

//Function for creating one deterministic private worker endpoint list
/**
 * @param {number} originPortData
 * @param {number} workerCountData
 */
export const deploymentWorkerEndpointsCreate = function( originPortData, workerCountData ){
    if (
        Number.isInteger( originPortData ) === false ||
        Number.isInteger( workerCountData ) === false ||
        Number( workerCountData ) < Number( 1 ) ||
        Number( originPortData ) + Number( workerCountData ) - Number( 1 ) > Number( 65535 )
    ){
        throw deploymentErrorCreate( 'DEPLOY_WORKER_PORT_INVALID', 'Worker ports exceed the private listener range.' );

    }

    const workerEndpointsData = [];

    //Allocating consecutive loopback ports without exposing workers publicly
    for ( let workerIndexData = Number( 0 ); workerIndexData < Number( workerCountData ); workerIndexData += Number( 1 ) ){
        workerEndpointsData.push( Object.freeze({
            id: `worker-${Number( workerIndexData ) + Number( 1 )}`,
            host: '127.0.0.1',
            port: Number( originPortData ) + Number( workerIndexData )
        }) );

    }

    return Object.freeze( workerEndpointsData );

};

//Function for resolving the bounded production worker ceiling
/**
 * @param {NonNullable<LayerDeploymentData['workers']>} workersData
 * @param {{availableParallelism?: number, totalMemory?: number}} [resourceData]
 */
export const deploymentWorkerMaximumResolve = function( workersData, resourceData = {} ){
    if ( workersData.maximum !== 'auto' ){
        return Number( workersData.maximum );

    }

    const availableParallelismData = resourceData.availableParallelism ?? os.availableParallelism();
    const totalMemoryData = resourceData.totalMemory ?? os.totalmem();
    const connectionBudgetData = Number( workersData.connectionBudget );
    const connectionsPerWorkerData = Number( workersData.maximumConnectionsPerWorker );

    if (
        Number.isInteger( connectionBudgetData ) === false ||
        Number.isInteger( connectionsPerWorkerData ) === false ||
        Number( connectionBudgetData ) < Number( 1 ) ||
        Number( connectionsPerWorkerData ) < Number( 1 )
    ){
        throw deploymentErrorCreate( 'DEPLOY_WORKER_BUDGET_INVALID', 'Automatic workers require a database connection budget.' );

    }

    const cpuMaximumData = Math.max( Number( 1 ), Number( availableParallelismData ) - Number( 1 ) );
    const memoryReserveData = Number( 512 * 1024 * 1024 );
    const memoryPerWorkerData = Number( 256 * 1024 * 1024 );
    const memoryMaximumData = Math.max(
        Number( 1 ),
        Math.floor( (Number( totalMemoryData ) - Number( memoryReserveData )) / Number( memoryPerWorkerData ) )
    );
    const databaseMaximumData = Math.max(
        Number( 1 ),
        Math.floor( Number( connectionBudgetData ) / Number( connectionsPerWorkerData ) )
    );
    const automaticMaximumData = Math.min(
        Number( cpuMaximumData ),
        Number( memoryMaximumData ),
        Number( databaseMaximumData ),
        Number( 256 )
    );

    return Math.max( Number( workersData.minimum ), Number( automaticMaximumData ) );

};

//Function for selecting the first unused endpoint needed to restore worker capacity
/**
 * @param {readonly Readonly<{id: string, host: string, port: number}>[]} requiredEndpointsData
 * @param {readonly Readonly<{id: string, host: string, port: number}>[]} activeEndpointsData
 */
export const deploymentWorkerReplacementEndpointGet = function( requiredEndpointsData, activeEndpointsData ){
    const activeEndpointIdentifiersData = new Set( activeEndpointsData.map(function activeEndpointIdentifierRead( endpointData ){
        return endpointData.id;

    }) );

    return requiredEndpointsData.find(function requiredEndpointFind( endpointData ){
        return activeEndpointIdentifiersData.has( endpointData.id ) === false;

    }) ?? null;

};

//Function for running one application worker child process
const deploymentWorkerRun = async function(){
    const runnerFilePathData = fileURLToPath( import.meta.url );
    const bundleRootData = path.resolve( path.dirname( runnerFilePathData ), '..', '..' );
    const deploymentData = /** @type {LayerDeploymentData} */ (JSON.parse(
        await readFile( path.join( bundleRootData, '_layer', 'deployment.json' ), 'utf8' )
    ));
    const stateDirectoryData = deploymentStateDirectoryGet( deploymentData );
    const workerPortData = deploymentPortGet( process.env, 'LAYER_WORKER_PORT', Number( deploymentData.originPort ) );
    const workerIdentifierData = process.env.LAYER_WORKER_ID ?? `worker-${String( process.pid )}`;
    const serverRuntimeData = await deploymentServerCreate(
        bundleRootData,
        stateDirectoryData,
        deploymentData,
        workerIdentifierData
    );

    if ( serverRuntimeData === null ){
        throw deploymentErrorCreate( 'DEPLOY_WORKER_INVALID', 'Static deployments cannot start application workers.' );

    }

    await serverRuntimeData.start({
        host: '127.0.0.1',
        port: workerPortData
    });

    if ( serverRuntimeData.isReady() !== true ){
        await serverRuntimeData.stop({deadlineMs: Number( 10000 )} );
        throw deploymentErrorCreate( 'DEPLOY_SERVER_NOT_READY', 'Application worker did not become ready.' );

    }

    process.send?.({
        type: 'ready',
        workerId: workerIdentifierData,
        port: workerPortData
    });
    //Sampling below the quiet threshold so an idle worker can produce a valid scale-down signal
    const eventLoopDelayData = monitorEventLoopDelay({
        resolution: Number( deploymentWorkerMetricContractData.resolutionMs )
    });
    let priorEventLoopUtilizationData = performance.eventLoopUtilization();

    eventLoopDelayData.enable();

    const workerMetricsTimerData = setInterval(function workerMetricsPublish(){
        const currentUtilizationData = performance.eventLoopUtilization( priorEventLoopUtilizationData );
        priorEventLoopUtilizationData = performance.eventLoopUtilization();
        const delayMillisecondsData = Number( eventLoopDelayData.percentile( 95 ) ) / Number( 1000000 );

        process.send?.({
            type: 'metrics',
            workerId: workerIdentifierData,
            utilization: currentUtilizationData.utilization,
            delayMs: delayMillisecondsData
        });
        eventLoopDelayData.reset();

    }, Number( deploymentWorkerMetricContractData.intervalMs ) );
    let shutdownStatusData = false;

    const workerShutdownData = async function(){
        if ( shutdownStatusData === true ){
            return;

        }

        shutdownStatusData = true;
        clearInterval( workerMetricsTimerData );
        eventLoopDelayData.disable();
        await serverRuntimeData.stop({deadlineMs: Number( 10000 )} );
        process.send?.({
            type: 'stopped',
            workerId: workerIdentifierData
        });
    };

    for ( const signalNameData of ['SIGINT', 'SIGTERM'] ){
        process.once( signalNameData, function workerSignalHandle(){
            void workerShutdownData().then(function workerShutdownComplete(){
                process.exitCode = Number( 0 );

            }).catch(function workerShutdownFailed(){
                process.exitCode = Number( 1 );

            });

        });

    }

    //Keeping the worker process alive until its application listener is drained
    await new Promise(function workerExitWait( resolve ){
        process.once( 'beforeExit', resolve );

    });

};

//Function for supervising and scaling production worker processes
/**
 * @param {string} bundleRootData
 * @param {readonly Readonly<{id: string, host: string, port: number}>[]} initialEndpointsData
 * @param {{
 *     maximumEndpoints: readonly Readonly<{id: string, host: string, port: number}>[],
 *     onTopologyChange: (endpointsData: readonly Readonly<{id: string, host: string, port: number}>[]) => Promise<void>
 * }} supervisorOptionsData
 */
const deploymentWorkerSupervisorCreate = async function(
    bundleRootData,
    initialEndpointsData,
    supervisorOptionsData
){
    const runnerFileData = path.join( bundleRootData, '_layer', 'deployment', 'run.mjs' );
    const workerRecordsData = /** @type {{endpoint: Readonly<{id: string, host: string, port: number}>, process: import('node:child_process').ChildProcess, utilization: number, delayMs: number, stopping: boolean}[]} */ ([]);
    const recoveryTimersData = new Map();
    const minimumWorkerCountData = Number( initialEndpointsData.length );
    let autoscaleTimerData = /** @type {NodeJS.Timeout | null} */ (null);
    let stoppedStatusData = false;
    let scalingStatusData = false;
    let overloadedIntervalsData = Number( 0 );
    let quietIntervalsData = Number( 0 );
    let lastScaleAtData = Number( 0 );

    const activeEndpointsRead = function(){
        return Object.freeze( workerRecordsData.map(function activeEndpointRead( workerRecordData ){
            return workerRecordData.endpoint;

        }) );

    };

    const workerStopData = function( /** @type {{process: import('node:child_process').ChildProcess, stopping: boolean}} */ workerRecordData ){
        return new Promise(function workerStoppedWait( resolve ){
            workerRecordData.stopping = true;

            if ( workerRecordData.process.exitCode !== null ){
                resolve( undefined );

                return;

            }

            const forceTimerData = setTimeout(function workerForceStop(){
                workerRecordData.process.kill( 'SIGKILL' );

            }, Number( 15000 ) );

            workerRecordData.process.once( 'exit', function workerExitComplete(){
                clearTimeout( forceTimerData );
                resolve( undefined );

            });
            workerRecordData.process.kill( 'SIGTERM' );

        });

    };

    const workerStartData = async function( /** @type {Readonly<{id: string, host: string, port: number}>} */ workerEndpointData ){
        const workerProcessData = spawn(
            process.execPath,
            [runnerFileData, '--worker'],
            {
                cwd: bundleRootData,
                env: {
                    ...process.env,
                    LAYER_WORKER_ID: workerEndpointData.id,
                    LAYER_WORKER_PORT: String( workerEndpointData.port )
                },
                stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
                windowsHide: true
            }
        );
        const workerRecordData = {
            endpoint: workerEndpointData,
            process: workerProcessData,
            utilization: Number( 0 ),
            delayMs: Number( 0 ),
            stopping: false
        };
        const readyMessageData = await new Promise(function workerReadyWait( resolve, reject ){
            const startupTimerData = setTimeout(function workerStartupTimeout(){
                reject( deploymentErrorCreate( 'DEPLOY_WORKER_TIMEOUT', 'Application worker startup timed out.' ) );

            }, Number( 30000 ) );
            let readyStatusData = false;

            workerProcessData.once( 'error', function workerLaunchReject( workerLaunchErrorData ){
                clearTimeout( startupTimerData );
                reject( workerLaunchErrorData );

            });
            workerProcessData.once( 'exit', function workerEarlyExitReject(){
                if ( readyStatusData === true ){
                    return;

                }

                clearTimeout( startupTimerData );
                reject( deploymentErrorCreate( 'DEPLOY_WORKER_EXITED', 'Application worker exited during startup.' ) );

            });
            workerProcessData.on( 'message', function workerMessageHandle( messageData ){
                if ( typeof messageData !== 'object' || messageData === null ){
                    return;

                }

                const messageRecordData = /** @type {Record<string, unknown>} */ (messageData);

                if ( messageRecordData.type === 'metrics' ){
                    const utilizationData = Number( messageRecordData.utilization );
                    const delayData = Number( messageRecordData.delayMs );

                    if ( Number.isFinite( utilizationData ) === true && Number.isFinite( delayData ) === true ){
                        workerRecordData.utilization = utilizationData;
                        workerRecordData.delayMs = delayData;

                    }

                    return;

                }

                if ( messageRecordData.type === 'ready' ){
                    readyStatusData = true;
                    clearTimeout( startupTimerData );
                    resolve( messageData );

                }

            });

        });

        if ( /** @type {Record<string, unknown>} */ (readyMessageData).port !== workerEndpointData.port ){
            workerProcessData.kill( 'SIGTERM' );
            throw deploymentErrorCreate( 'DEPLOY_WORKER_INVALID', 'Application worker reported an invalid endpoint.' );

        }

        workerRecordsData.push( workerRecordData );
        workerProcessData.once( 'exit', function workerUnexpectedExitHandle(){
            const workerRecordIndexData = workerRecordsData.indexOf( workerRecordData );

            if ( workerRecordIndexData >= Number( 0 ) ){
                workerRecordsData.splice( workerRecordIndexData, Number( 1 ) );

            }

            if ( workerRecordData.stopping === true || stoppedStatusData === true ){
                return;

            }

            void workerTopologyRecoverData();

        });

        return workerRecordData;

    };

    /**
     * @param {Readonly<{id: string, host: string, port: number}>} workerEndpointData
     * @param {number} [recoveryAttemptData]
     */
    function workerRecoveryScheduleData( workerEndpointData, recoveryAttemptData = Number( 0 ) ){
        if (
            stoppedStatusData === true ||
            recoveryTimersData.has( workerEndpointData.id ) === true ||
            workerRecordsData.some(function activeWorkerMatch( workerRecordData ){
                return workerRecordData.endpoint.id === workerEndpointData.id;

            }) === true
        ){
            return;

        }

        const recoveryDelayData = Math.min(
            Number( 1000 ) * (Number( 2 ) ** Number( recoveryAttemptData )),
            Number( 30000 )
        );
        const recoveryTimerData = setTimeout(function workerRecoveryTimerHandle(){
            recoveryTimersData.delete( workerEndpointData.id );

            if ( stoppedStatusData === true ){
                return;

            }

            if ( scalingStatusData === true ){
                workerRecoveryScheduleData( workerEndpointData, recoveryAttemptData );

                return;

            }

            scalingStatusData = true;

            void workerStartData( workerEndpointData ).then(async function workerRecoveryReady(){
                try {
                    await supervisorOptionsData.onTopologyChange( activeEndpointsRead() );
                    overloadedIntervalsData = Number( 0 );
                    quietIntervalsData = Number( 0 );

                } catch( topologyErrorData ){
                    const recoveredWorkerData = workerRecordsData.find(function recoveredWorkerFind( workerRecordData ){
                        return workerRecordData.endpoint.id === workerEndpointData.id;

                    });

                    if ( recoveredWorkerData !== undefined ){
                        workerRecordsData.splice( workerRecordsData.indexOf( recoveredWorkerData ), Number( 1 ) );
                        await workerStopData( recoveredWorkerData );

                    }

                    throw topologyErrorData;

                }

            }).catch(function workerRecoveryFailed(){
                workerRecoveryScheduleData( workerEndpointData, Number( recoveryAttemptData ) + Number( 1 ) );

            }).finally(function workerRecoveryComplete(){
                scalingStatusData = false;

            });

        }, recoveryDelayData );

        recoveryTimerData.unref();
        recoveryTimersData.set( workerEndpointData.id, recoveryTimerData );

    }

    async function workerTopologyRecoverData(){
        if ( stoppedStatusData === true ){
            return;

        }

        await supervisorOptionsData.onTopologyChange( activeEndpointsRead() ).catch(function failedEndpointRemovalIgnore(){
            //Keeping recovery active while Caddy passive health checks isolate the failed endpoint

        });

        if ( Number( workerRecordsData.length ) >= Number( minimumWorkerCountData ) ){
            return;

        }

        const replacementEndpointData = deploymentWorkerReplacementEndpointGet(
            initialEndpointsData,
            activeEndpointsRead()
        );

        if ( replacementEndpointData !== null ){
            workerRecoveryScheduleData( replacementEndpointData );

        }

    }

    try {
        //Starting workers serially so database migration locks never create a startup stampede
        for ( const workerEndpointData of initialEndpointsData ){
            await workerStartData( workerEndpointData );

        }

    } catch( workerStartErrorData ){
        await Promise.all( workerRecordsData.map( workerStopData ) );

        throw workerStartErrorData;

    }

    const autoscaleEvaluateData = async function(){
        if ( stoppedStatusData === true || scalingStatusData === true || Number( workerRecordsData.length ) < Number( 1 ) ){
            return;

        }

        const averageUtilizationData = workerRecordsData.reduce(function utilizationTotalCreate( totalData, workerRecordData ){
            return Number( totalData ) + Number( workerRecordData.utilization );

        }, Number( 0 ) ) / Number( workerRecordsData.length );
        const maximumDelayData = Math.max( ...workerRecordsData.map(function workerDelayRead( workerRecordData ){
            return Number( workerRecordData.delayMs );

        }) );
        const overloadedStatusData = (
            Number( averageUtilizationData ) >= Number( deploymentWorkerMetricContractData.overloadUtilization ) ||
            Number( maximumDelayData ) >= Number( deploymentWorkerMetricContractData.overloadDelayMs )
        );
        const quietStatusData = (
            Number( averageUtilizationData ) < Number( deploymentWorkerMetricContractData.quietUtilization ) &&
            Number( maximumDelayData ) < Number( deploymentWorkerMetricContractData.quietDelayMs )
        );

        if ( overloadedStatusData === true ){
            overloadedIntervalsData += Number( 1 );

        } else {
            overloadedIntervalsData = Number( 0 );

        }

        if ( quietStatusData === true ){
            quietIntervalsData += Number( 1 );

        } else {
            quietIntervalsData = Number( 0 );

        }

        const currentTimeData = Date.now();
        const scaleUpReadyStatusData = (
            Number( overloadedIntervalsData ) >= Number( deploymentWorkerMetricContractData.scaleUpIntervals ) &&
            Number( workerRecordsData.length ) < Number( supervisorOptionsData.maximumEndpoints.length ) &&
            Number( currentTimeData ) - Number( lastScaleAtData ) >=
                Number( deploymentWorkerMetricContractData.scaleUpCooldownMs )
        );
        const scaleDownReadyStatusData = (
            Number( quietIntervalsData ) >= Number( deploymentWorkerMetricContractData.scaleDownIntervals ) &&
            Number( workerRecordsData.length ) > Number( minimumWorkerCountData ) &&
            Number( currentTimeData ) - Number( lastScaleAtData ) >=
                Number( deploymentWorkerMetricContractData.scaleDownCooldownMs )
        );

        if ( scaleUpReadyStatusData === true ){
            const nextEndpointData = deploymentWorkerReplacementEndpointGet(
                supervisorOptionsData.maximumEndpoints,
                activeEndpointsRead()
            );

            if ( nextEndpointData === null ){
                return;

            }

            scalingStatusData = true;

            try {
                const nextWorkerRecordData = await workerStartData( nextEndpointData );

                try {
                    await supervisorOptionsData.onTopologyChange( activeEndpointsRead() );

                } catch( topologyErrorData ){
                    workerRecordsData.pop();
                    await workerStopData( nextWorkerRecordData );

                    throw topologyErrorData;

                }

                lastScaleAtData = Date.now();
                overloadedIntervalsData = Number( 0 );

            } finally {
                scalingStatusData = false;

            }

            return;

        }

        if ( scaleDownReadyStatusData === true ){
            const removedWorkerRecordData = workerRecordsData.at( -1 );

            if ( removedWorkerRecordData === undefined ){
                return;

            }

            scalingStatusData = true;

            try {
                const nextEndpointsData = Object.freeze( activeEndpointsRead().slice( Number( 0 ), Number( -1 ) ) );
                await supervisorOptionsData.onTopologyChange( nextEndpointsData );
                workerRecordsData.pop();
                await workerStopData( removedWorkerRecordData );
                lastScaleAtData = Date.now();
                quietIntervalsData = Number( 0 );

            } finally {
                scalingStatusData = false;

            }

        }

    };

    return Object.freeze({
        autoscaleStart(){
            if (
                autoscaleTimerData !== null ||
                Number( supervisorOptionsData.maximumEndpoints.length ) <= Number( minimumWorkerCountData )
            ){
                return false;

            }

            autoscaleTimerData = setInterval(function autoscaleIntervalHandle(){
                void autoscaleEvaluateData().catch(function autoscaleFailureIgnore(){
                    //Keeping the last healthy topology when a scale action fails

                });

            }, Number( deploymentWorkerMetricContractData.intervalMs ) );

            return true;

        },

        async stop(){
            if ( stoppedStatusData === true ){
                return;

            }

            stoppedStatusData = true;

            if ( autoscaleTimerData !== null ){
                clearInterval( autoscaleTimerData );
                autoscaleTimerData = null;

            }

            for ( const recoveryTimerData of recoveryTimersData.values() ){
                clearTimeout( recoveryTimerData );

            }

            recoveryTimersData.clear();

            await Promise.all( workerRecordsData.map( workerStopData ) );
            workerRecordsData.length = Number( 0 );

        }
    });

};

//Function for launching the complete portable deployment
/** @param {{check?: boolean}} [runOptionsData] */
export const layerDeploymentRun = async function( runOptionsData = {} ){
    const runnerFilePath = fileURLToPath( import.meta.url );
    const bundleRootData = path.resolve( path.dirname( runnerFilePath ), '..', '..' );

    try {
        //Checking immutable build files before executing application server code
        await deploymentIntegrityCheck( bundleRootData );
        await deploymentRuntimeCheck( bundleRootData );

        const deploymentData = /** @type {LayerDeploymentData} */ (JSON.parse(
            await readFile( path.join( bundleRootData, '_layer', 'deployment.json' ), 'utf8' )
        ));
        const deploymentDomain = deploymentDomainGet( deploymentData );
        const deploymentHttpPort = deploymentPortGet( process.env, 'LAYER_HTTP_PORT', 80 );
        const deploymentHttpsPort = deploymentPortGet( process.env, 'LAYER_HTTPS_PORT', 443 );
        const deploymentOriginPort = deploymentPortGet(
            process.env,
            'LAYER_ORIGIN_PORT',
            Number( deploymentData.originPort )
        );
        const stateDirectoryData = deploymentStateDirectoryGet( deploymentData );
        let workerEndpointsData = /** @type {readonly Readonly<{id: string, host: string, port: number}>[]} */ (Object.freeze( [] ));
        let availableWorkerEndpointsData = /** @type {readonly Readonly<{id: string, host: string, port: number}>[]} */ (Object.freeze( [] ));

        //Preparing the initial worker topology before validating the edge configuration
        if ( deploymentData.serverEntry === true ){
            const workersData = deploymentData.workers ?? {
                minimum: Number( 1 ),
                maximum: Number( 1 )
            };
            const workerMaximumData = deploymentWorkerMaximumResolve( workersData );
            availableWorkerEndpointsData = deploymentWorkerEndpointsCreate(
                deploymentOriginPort,
                Number( workerMaximumData )
            );
            workerEndpointsData = Object.freeze(
                availableWorkerEndpointsData.slice( Number( 0 ), Number( workersData.minimum ) )
            );

        }

        const deploymentCaddyAdminPort = deploymentPortGet(
            process.env,
            'LAYER_CADDY_ADMIN_PORT',
            Number( deploymentOriginPort ) + Math.max(
                Number( 1 ),
                Number( availableWorkerEndpointsData.length )
            )
        );

        //Installing exact production dependencies before loading archive or server modules
        await deploymentDependenciesEnsure( bundleRootData, stateDirectoryData );

        //Getting one verified Caddy executable for the current platform
        const caddyExecutablePath = await deploymentCaddyEnsure( deploymentData, stateDirectoryData );
        await deploymentCaddyVersionCheck( caddyExecutablePath, deploymentData, bundleRootData );
        const caddyEnvironmentData = {
            ...process.env,
            LAYER_BUNDLE_ROOT: bundleRootData.replaceAll( '\\', '/' ),
            LAYER_DOMAIN: deploymentDomain,
            LAYER_HTTP_PORT: String( deploymentHttpPort ),
            LAYER_HTTPS_PORT: String( deploymentHttpsPort ),
            LAYER_ORIGIN_PORT: String( deploymentOriginPort ),
            LAYER_CADDY_ADMIN_PORT: String( deploymentCaddyAdminPort ),
            LAYER_UPSTREAMS: workerEndpointsData.map(function workerUpstreamCreate( workerEndpointData ){
                return `${String( workerEndpointData.host )}:${String( workerEndpointData.port )}`;

            }).join( ' ' ),
            XDG_DATA_HOME: path.join( stateDirectoryData, 'caddy-data' ),
            XDG_CONFIG_HOME: path.join( stateDirectoryData, 'caddy-config' )
        };
        const caddyConfigPath = path.join( bundleRootData, 'Caddyfile' );

        //Validating the generated edge configuration before starting application services
        const caddyValidationResult = await deploymentProcessRun(
            caddyExecutablePath,
            ['validate', '--config', caddyConfigPath, '--adapter', 'caddyfile'],
            {
                cwd: bundleRootData,
                env: caddyEnvironmentData
            }
        );

        if ( caddyValidationResult.code !== Number( 0 ) ){
            //Passing the invalid generated edge configuration to the deployment boundary
            throw deploymentErrorCreate( 'DEPLOY_CADDY_CONFIG_INVALID', 'Generated Caddy configuration validation failed.' );

        }

        //Stopping after complete preflight when the operator requested check mode
        if ( runOptionsData.check === true ){
            process.stdout.write( String( 'Layer deployment check passed.\n' ) );

            //CallBack THE OBJECT
            return Object.freeze({
                checked: true,
                domain: deploymentDomain,
                caddy: caddyExecutablePath
            });

        }

        let workerSupervisorData = null;

        //Starting independent private workers before public HTTPS is exposed
        if ( deploymentData.serverEntry === true ){
            workerSupervisorData = await deploymentWorkerSupervisorCreate(
                bundleRootData,
                workerEndpointsData,
                {
                    maximumEndpoints: availableWorkerEndpointsData,
                    async onTopologyChange( nextEndpointsData ){
                        const nextUpstreamsData = nextEndpointsData.map(function nextWorkerUpstreamCreate( workerEndpointData ){
                            return `${String( workerEndpointData.host )}:${String( workerEndpointData.port )}`;

                        }).join( ' ' );
                        const reloadEnvironmentData = {
                            ...caddyEnvironmentData,
                            LAYER_UPSTREAMS: nextUpstreamsData
                        };
                        const reloadResultData = await deploymentProcessRun(
                            caddyExecutablePath,
                            ['reload', '--config', caddyConfigPath, '--adapter', 'caddyfile'],
                            {
                                cwd: bundleRootData,
                                env: reloadEnvironmentData
                            }
                        );

                        if ( reloadResultData.code !== Number( 0 ) ){
                            throw deploymentErrorCreate( 'DEPLOY_CADDY_RELOAD_FAILED', 'Caddy topology reload failed.' );

                        }

                        caddyEnvironmentData.LAYER_UPSTREAMS = nextUpstreamsData;

                    }
                }
            );

        }

        //Launching Caddy in foreground under the deployment parent process
        const caddyProcessData = /** @type {import('node:child_process').ChildProcess} */ (spawn(
            caddyExecutablePath,
            ['run', '--config', caddyConfigPath, '--adapter', 'caddyfile'],
            {
                cwd: bundleRootData,
                env: caddyEnvironmentData,
                stdio: 'inherit',
                windowsHide: true
            }
        ));

        //Beginning adaptive checks only after Caddy owns the public listener lifecycle
        workerSupervisorData?.autoscaleStart();
        let shutdownStatus = false;

        const deploymentShutdown = async function(){
            //Preventing duplicate signal and child-exit shutdown paths
            if ( shutdownStatus === true ){
                return;

            }

            shutdownStatus = true;

            //Stopping the public edge before draining the private application origin
            if ( caddyProcessData.exitCode === null ){
                caddyProcessData.kill( 'SIGTERM' );

            }

            if ( workerSupervisorData !== null ){
                await workerSupervisorData.stop();

            }

        };

        //Connecting supported process signals to one graceful shutdown sequence
        for ( const signalNameData of ['SIGINT', 'SIGTERM'] ){
            process.once( signalNameData, function deploymentSignalHandle(){
                //Launching asynchronous drain without exposing an unhandled rejection
                void deploymentShutdown().catch(function deploymentShutdownError(){
                    //Showing only one stable shutdown code
                    process.stderr.write( String( 'Layer deployment failed: DEPLOY_SHUTDOWN_FAILED.\n' ) );
                    process.exitCode = Number( 1 );

                });

            });

        }

        //Waiting until Caddy exits or fails to launch
        const caddyExitResult = await /** @type {Promise<{code: number | null, signal: NodeJS.Signals | null}>} */ (new Promise(function caddyForegroundWait( resolve, reject ){
            caddyProcessData.once( 'error', function caddyLaunchReject( caddyLaunchError ){
                //Passing the edge launch failure to the deployment boundary
                reject( caddyLaunchError );

            });
            caddyProcessData.once( 'exit', function caddyExitResolve( caddyExitCode, caddyExitSignal ){
                //Returning the bounded edge exit result
                resolve({
                    code: caddyExitCode,
                    signal: caddyExitSignal
                });

            });

        }));

        await deploymentShutdown();

        if ( caddyExitResult.code !== Number( 0 ) && caddyExitResult.signal === null ){
            //Passing an unexpected public edge exit to the deployment boundary
            throw deploymentErrorCreate( 'DEPLOY_CADDY_EXITED', 'Caddy exited unexpectedly.' );

        }

        //CallBack THE OBJECT
        return Object.freeze({
            checked: false,
            domain: deploymentDomain,
            caddy: caddyExecutablePath
        });

    } catch( deploymentError ){
        const deploymentFailure = /** @type {Partial<LayerDeploymentError>} */ (deploymentError);
        let deploymentErrorCode = String( 'DEPLOY_INTERNAL_ERROR' );

        //Getting only the stable public code from the deployment failure
        if ( typeof deploymentFailure.code === 'string' ){
            deploymentErrorCode = deploymentFailure.code;

        }

        //Showing actionable runtime requirements without revealing arbitrary error messages
        if ( deploymentErrorCode === 'DEPLOY_NODE_UNSUPPORTED' ){
            process.stderr.write( `Required Node.js >=24.22.1 <25; found ${process.versions.node}. Install a patched Node.js 24 release and restart all workers.\n` );

        }

        //Showing only the stable failure code without stack, environment, or secret values
        process.stderr.write( String( 'Layer deployment failed: ' ) + String( deploymentErrorCode ) + String( '.\n' ) );

        //Passing the deployment failure to npm and external supervisors
        throw deploymentError;

    }

};

const commandPathData = process.argv[1] ?? String();
const directExecutionStatus =
    commandPathData.length > Number( 0 ) &&
    pathToFileURL( path.resolve( commandPathData ) ).href === import.meta.url;

//Launching the generated bundle only when this module is the process entry
if ( directExecutionStatus === true ){
    const checkStatus = process.argv.slice( 2 ).includes( String( '--check' ) );
    const workerStatus = process.argv.slice( 2 ).includes( String( '--worker' ) );

    /** @type {Promise<unknown>} */
    let commandPromiseData;

    //Selecting the isolated worker lifecycle only for supervisor-owned child processes
    if ( workerStatus === true ){
        commandPromiseData = deploymentWorkerRun();

    } else {
        commandPromiseData = layerDeploymentRun({check: checkStatus} );

    }

    await commandPromiseData.catch(function deploymentCommandReject(){
        //Returning one failed process status after the safe error code was written
        process.exitCode = Number( 1 );

    });

}
