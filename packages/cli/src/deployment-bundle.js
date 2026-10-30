import {spawn} from 'node:child_process';
import {
    mkdtemp,
    readFile,
    rm,
    stat,
    writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild-wasm';
import {LayerCliError} from './cli-error.js';
import {layerContentSecurityPolicyCreate, layerPermissionsPolicyCreate} from './content-security-policy.js';
import {layerEnvironmentRequestPathPattern, layerPrivateArtifactRequestPaths} from './private-artifacts.js';

const deploymentLockCache = new Map();
const deploymentRunnerFile = fileURLToPath( new URL( './deployment-runner.js', import.meta.url ) );
const applicationServerRuntimeFile = fileURLToPath( new URL( './application-server-runtime.js', import.meta.url ) );
const authPackageEntryFile = fileURLToPath( import.meta.resolve( '@solcorp/layer-auth/server' ) );
const notificationsPackageEntryFile = fileURLToPath( import.meta.resolve( '@solcorp/layer-notifications' ) );
const databasePackageEntryFile = fileURLToPath( import.meta.resolve( '@solcorp/layer-database' ) );
const eventsPackageEntryFile = fileURLToPath( import.meta.resolve( '@solcorp/layer-events' ) );
const securityPackageEntryFile = fileURLToPath( import.meta.resolve( '@solcorp/layer-security' ) );
const pglitePackageDirectory = path.dirname( fileURLToPath( import.meta.resolve( '@electric-sql/pglite' ) ) );
const deploymentRuntimeDependencies = Object.freeze({
    tar: '7.5.22',
    yauzl: '3.4.0'
});
const deploymentServerDependencies = Object.freeze({
    '@electric-sql/pglite': '0.5.8',
    pg: '8.16.3'
});
const deploymentAuthDependencies = Object.freeze({
    '@node-rs/argon2': '2.2.1',
    nodemailer: '10.2.1'
});
const deploymentOAuthDependencies = Object.freeze({
    'oidc-provider': '9.12.2'
});
const caddyVersion = String( '2.11.4' );
const caddyReleaseBaseUrl = String( 'https://github.com/caddyserver/caddy/releases/download/v2.11.4/' );
const caddyAssets = Object.freeze({
    'linux-x64': Object.freeze({
        archive: 'tar.gz',
        url: caddyReleaseBaseUrl + String( 'caddy_2.11.4_linux_amd64.tar.gz' ),
        sha512: '8220d1f013b6f27510247b2360c9e0ca9f018feebd82515f07635318b34ff9777ccc8fd0b6e6f2486ce3a33fe389fbb7db12d05baa474f4587509fb4f5ebf1c9'
    }),
    'linux-arm64': Object.freeze({
        archive: 'tar.gz',
        url: caddyReleaseBaseUrl + String( 'caddy_2.11.4_linux_arm64.tar.gz' ),
        sha512: 'd5a7c423853c24a799765e0e8210d5c7c22a8f56ed37a3cae2fb9f58be138853c02b4efd6b59d576e6d8c7c0d30b9c1592deeaa6a536ff69bcca23b8c1ea709c'
    }),
    'win32-x64': Object.freeze({
        archive: 'zip',
        url: caddyReleaseBaseUrl + String( 'caddy_2.11.4_windows_amd64.zip' ),
        sha512: 'cd5ccfd86a4b40732cf715890d0dca5bf3f63adefec5a7914de85adf240c60ce7e5d2791631b88ef9758e46b23bb1730e020b9c5d696889740b284ffd4788e35'
    }),
    'win32-arm64': Object.freeze({
        archive: 'zip',
        url: caddyReleaseBaseUrl + String( 'caddy_2.11.4_windows_arm64.zip' ),
        sha512: '582ad4657223ecd52a627d88b9d5a0cc051a0289546427659e878c57db3b4f44cedf9edd8ad6efcf29aa20a156d72626db00dfb64caccfe207bbebea2a0773c4'
    })
});

/**
 * @typedef {object} LayerDeploymentConfiguration
 * @property {string} appName
 * @property {string} appVersion
 * @property {{domain: string | null, serverEntry: string | null, originPort: number, dependencies: Readonly<Record<string, string>>}} deployment
 * @property {Readonly<Record<string, any>>} database
 * @property {Readonly<Record<string, any>> | null} auth
 * @property {Readonly<Record<string, any>> | null} notifications
 * @property {Readonly<Record<string, any>> | null} redis
 * @property {Readonly<Record<string, any>>} runtime
 * @property {ReturnType<typeof import('./content-security-policy.js').layerSecurityConfigurationCreate>} security
 */

/**
 * @typedef {object} LayerDeploymentBuildOptions
 * @property {string} rootDirectory
 * @property {string} sourceDirectory
 * @property {LayerDeploymentConfiguration} config
 * @property {boolean} [dryRun]
 */

//Function for creating the generated deployment package
/** @param {LayerDeploymentConfiguration} configurationData */
const deploymentPackageCreate = function( configurationData ){
    //Combining engine-owned bootstrap dependencies with explicit server externals
    const deploymentDependencies = /** @type {Record<string, string>} */ ({
        ...deploymentRuntimeDependencies,
        ...configurationData.deployment.dependencies
    });

    //Installing database drivers only when the portable bundle contains a Node backend
    if ( configurationData.deployment.serverEntry !== null ){
        Object.assign( deploymentDependencies, deploymentServerDependencies );
        if ( configurationData.notifications !== null && configurationData.notifications !== undefined ){
            deploymentDependencies['web-push'] = '3.6.7';

        }

        if ( configurationData.redis !== null ){
            deploymentDependencies.redis = '6.2.1';

        }

        if ( configurationData.auth !== null ){
            Object.assign( deploymentDependencies, deploymentAuthDependencies );

            if ( configurationData.auth.oauth !== null ){
                Object.assign( deploymentDependencies, deploymentOAuthDependencies );

            }

        }

    }

    //CallBack THE OBJECT
    return {
        name: configurationData.appName + String( '-deployment' ),
        version: configurationData.appVersion,
        private: true,
        type: 'module',
        imports: {
            '#layer/operations': './_layer/operations.mjs'
        },
        packageManager: 'npm@11.16.0',
        engines: {
            node: '>=24.22.1 <25',
            npm: '>=11 <12'
        },
        scripts: {
            start: 'node --env-file-if-exists=.env ./_layer/deployment/run.mjs',
            check: 'node --env-file-if-exists=.env ./_layer/deployment/run.mjs --check'
        },
        dependencies: deploymentDependencies
    };

};

//Function for running npm package-lock generation
/**
 * @param {Readonly<Record<string, any>>} packageData
 * @param {boolean} dryRunStatus
 */
const deploymentPackageLockCreate = async function( packageData, dryRunStatus ){
    const dependencyCacheKey = JSON.stringify( packageData.dependencies );

    //Reusing one immutable lock within a build/watch process
    if ( deploymentLockCache.has( dependencyCacheKey ) === true ){
        //CallBack THE STRING
        return deploymentLockCache.get( dependencyCacheKey );

    }

    //Returning a side-effect-free preview lock during inspect/docs/dry-run commands
    if ( dryRunStatus === true ){
        //CallBack THE STRING
        return JSON.stringify({
            name: packageData.name,
            version: packageData.version,
            lockfileVersion: 3,
            requires: true,
            packages: {
                '': {
                    name: packageData.name,
                    version: packageData.version,
                    dependencies: packageData.dependencies,
                    engines: packageData.engines
                }
            }
        }, null, 4) + String( '\n' );

    }

    const packageLockDirectory = await mkdtemp( path.join( os.tmpdir(), 'layer-deployment-lock-' ) );

    try {
        //Writing only the generated production package into the isolated npm directory
        await writeFile(
            path.join( packageLockDirectory, 'package.json' ),
            JSON.stringify( packageData, null, 4) + String( '\n' ),
            'utf8'
        );

        let npmExecutableData = String( 'npm' );
        let npmArgumentItemsData = [
            'install',
            '--package-lock-only',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund'
        ];

        //Using the exact npm installation that invoked Layer CLI
        if ( typeof process.env.npm_execpath === 'string' && process.env.npm_execpath.length > Number( 0 ) ){
            const npmExecutionPath = String( process.env.npm_execpath );
            npmExecutableData = process.execPath;
            npmArgumentItemsData = [
                npmExecutionPath,
                ...npmArgumentItemsData
            ];

        } else if ( process.platform === String( 'win32' ) ){
            npmExecutableData = process.execPath;
            npmArgumentItemsData = [
                path.join( path.dirname( process.execPath ), 'node_modules', 'npm', 'bin', 'npm-cli.js' ),
                ...npmArgumentItemsData
            ];

        }

        const npmLockResult = await /** @type {Promise<{code: number | null, error: string}>} */ (new Promise(function packageLockWait( resolve, reject ){
            //Launching npm without a shell or inherited interactive input
            const npmProcessData = spawn( npmExecutableData, npmArgumentItemsData, {
                cwd: packageLockDirectory,
                stdio: ['ignore', 'ignore', 'pipe'],
                windowsHide: true
            });
            let npmErrorData = String();

            npmProcessData.stderr.on( 'data', function npmErrorCollect( chunkData ){
                //Keeping one bounded error tail without printing registry credentials
                npmErrorData = String( npmErrorData + chunkData ).slice( -4096 );

            });
            npmProcessData.once( 'error', reject );
            npmProcessData.once( 'exit', function npmLockResolve( npmExitCode ){
                //Returning the bounded package-lock operation result
                resolve({
                    code: npmExitCode,
                    error: npmErrorData
                });

            });

        }));

        if ( npmLockResult.code !== Number( 0 ) ){
            //Passing a stable build failure without exposing registry output
            throw new LayerCliError(
                'CLI_BUILD_DEPLOYMENT_LOCK_FAILED',
                'Deployment package-lock.json could not be generated.'
            );

        }

        const packageLockSource = await readFile( path.join( packageLockDirectory, 'package-lock.json' ), 'utf8' );

        //Caching the exact lock for subsequent watch builds
        deploymentLockCache.set( dependencyCacheKey, packageLockSource );

        //CallBack THE STRING
        return packageLockSource;

    } finally {
        //Removing the isolated npm workspace after lock generation
        await rm( packageLockDirectory, {recursive: true, force: true} );

    }

};

//Function for creating a production Caddyfile
/**
 * @param {boolean} serverEntryStatus
 * @param {Readonly<Record<string, any>> | null} authConfigurationData
 * @param {unknown} securityConfigurationData
 */
const deploymentCaddyfileCreate = function( serverEntryStatus, authConfigurationData, securityConfigurationData ){
    //Rendering the configured production policy from the same validated resource permissions as development
    const contentSecurityPolicyData = layerContentSecurityPolicyCreate( securityConfigurationData, 'production' );
    const permissionsPolicyData = layerPermissionsPolicyCreate( securityConfigurationData );
    //Sharing the protected environment pattern and artifact paths with the development host
    const environmentMatcherData = '@layerEnvironment path_regexp layerEnvironment ' +
        JSON.stringify( '(?i)' + String( layerEnvironmentRequestPathPattern ) );
    const privateMatcherData = '@layerPrivate path ' + layerPrivateArtifactRequestPaths.join( ' ' );

    //Preparing optional private backend and interoperability routes
    let apiRouteData = String();
    let apiMatcherData = String();
    let authRoutePathsData = String();

    //Adding only configured OAuth interoperability paths to the private backend matcher
    if ( authConfigurationData?.oauth !== null && authConfigurationData?.oauth !== undefined ){
        authRoutePathsData = String(
            ' /.well-known/openid-configuration' +
            ' /.well-known/oauth-authorization-server' +
            ' /oauth/*' +
            ` ${String( authConfigurationData.oauth.interactionUrl )}` +
            ` ${String( authConfigurationData.oauth.interactionUrl )}/*`
        );

    }

    //Adding the declared API, health, and optional OAuth proxy for full-stack applications
    if ( serverEntryStatus === true ){
        //Defining the backend matcher at site scope rather than inside the explicit routing block
        apiMatcherData = '@layerBackend path /api /health/*' + String( authRoutePathsData );
        apiRouteData = String( `
    handle @layerBackend {
        request_body {
            max_size 256KB
        }

        reverse_proxy {$LAYER_UPSTREAMS:127.0.0.1:8787} {
            lb_policy least_conn
            flush_interval -1
            health_uri /health/ready
            health_interval 10s
            transport http {
                dial_timeout 3s
                response_header_timeout 15s
                keepalive 4s
            }
        }
    }
` );

    }

    //CallBack THE STRING
    return String( `{
    admin 127.0.0.1:{$LAYER_CADDY_ADMIN_PORT:2019}
    http_port {$LAYER_HTTP_PORT:80}
    https_port {$LAYER_HTTPS_PORT:443}
    log default {
        format filter {
            wrap json
            fields {
                request>headers delete
                request>uri regexp "[?].*$" ""
            }
        }
    }
    servers {
        max_header_size 32KB
        timeouts {
            read_body 15s
            read_header 10s
            write 30s
            idle 2m
        }
    }
}

http://{$LAYER_DOMAIN}:{$LAYER_HTTP_PORT:80} {
    ${String( environmentMatcherData )}
    ${String( privateMatcherData )}
    route {
        respond @layerEnvironment 404
        respond @layerPrivate 404
        redir https://{$LAYER_DOMAIN}:{$LAYER_HTTPS_PORT:443}{uri} permanent
    }
}

https://{$LAYER_DOMAIN}:{$LAYER_HTTPS_PORT:443} {
    encode zstd gzip

    header {
        -Server
        Content-Security-Policy "${String( contentSecurityPolicyData )}"
        Cross-Origin-Opener-Policy "same-origin"
        Cross-Origin-Resource-Policy "same-origin"
        Permissions-Policy "${String( permissionsPolicyData )}"
        Referrer-Policy "no-referrer"
        Strict-Transport-Security "max-age=63072000; includeSubDomains"
        X-Content-Type-Options "nosniff"
    }
${String( apiMatcherData )}
    ${String( environmentMatcherData )}
    ${String( privateMatcherData )}

    @layerMutable path / /index.html /manifest.webmanifest /layer-service-worker.js /_layer/shell.html /_layer/version.json /_layer/routes.json /_layer/layouts.json /_layer/application.mjs /_layer/operations.mjs /_layer/navigation.js
    header @layerMutable Cache-Control "no-cache"

    @layerDocuments path_regexp layerDocuments [.]html$
    header @layerDocuments Cache-Control "no-cache"

    @layerImmutable path /_layer/components/* /_layer/layouts/* /_layer/assets/*
    header @layerImmutable Cache-Control "public, max-age=31536000, immutable"

    root * "{$LAYER_BUNDLE_ROOT}"

    @layerAssociations path /.well-known/assetlinks.json /.well-known/apple-app-site-association /.well-known/windows-app-web-link /.well-known/web-app-origin-association
    @layerUpdates path /_layer/version.json /_layer/update.json
    @layerNavigation {
        method GET HEAD
        header Accept *text/html*
    }

    route {
        respond @layerEnvironment 404
        respond @layerPrivate 404
${apiRouteData}
        handle @layerUpdates {
            header Content-Type application/json
            header Cache-Control "no-store"
            file_server
        }
        handle @layerAssociations {
            header Content-Type application/json
            header Cache-Control "no-cache"
            file_server
        }
        handle @layerNavigation {
            try_files {path} {path}/index.html /_layer/shell.html
            file_server
        }

        handle {
            file_server
        }
    }
}
` );

};

//Function for creating the optional Node server bundle
/** @param {LayerDeploymentBuildOptions} buildOptionsData */
const deploymentServerBundleCreate = async function( buildOptionsData ){
    //Returning an empty artifact set for a static-only PWA
    if ( buildOptionsData.config.deployment.serverEntry === null ){
        //CallBack THE OBJECT
        return {};

    }

    const serverEntryFile = path.resolve(
        buildOptionsData.sourceDirectory,
        buildOptionsData.config.deployment.serverEntry
    );
    const databaseSchemaFile = path.resolve(
        buildOptionsData.rootDirectory,
        buildOptionsData.config.database.schema.file
    );
    const serverEntryRelativePath = path.relative( buildOptionsData.sourceDirectory, serverEntryFile );
    const databaseSchemaRelativePath = path.relative( buildOptionsData.rootDirectory, databaseSchemaFile );
    const serverEntryStatus = await stat( serverEntryFile ).catch(function serverEntryMissing( serverEntryError ){
        //Returning explicit absence for one missing server entry
        if ( serverEntryError.code === String( 'ENOENT' ) ){
            return null;

        }

        //Passing unexpected filesystem failures to the build boundary
        throw serverEntryError;

    });
    const databaseSchemaStatus = await stat( databaseSchemaFile ).catch(function databaseSchemaMissing( databaseSchemaError ){
        //Returning explicit absence for one missing declarative schema module
        if ( databaseSchemaError.code === String( 'ENOENT' ) ){
            return null;

        }

        throw databaseSchemaError;

    });

    //Checking the resolved source boundary and the required server module
    if (
        serverEntryRelativePath === String() ||
        serverEntryRelativePath.startsWith( '..' ) ||
        path.isAbsolute( serverEntryRelativePath ) ||
        serverEntryStatus === null ||
        serverEntryStatus.isFile() === false
    ){
        //Passing the unsafe or absent entry to the CLI boundary
        throw new LayerCliError(
            'CLI_BUILD_SERVER_ENTRY_INVALID',
            'deployment.serverEntry must identify a file inside the configured source directory.'
        );

    }

    //Checking the declarative schema remains inside the application project
    if (
        databaseSchemaRelativePath === String() ||
        databaseSchemaRelativePath.startsWith( '..' ) ||
        path.isAbsolute( databaseSchemaRelativePath ) ||
        databaseSchemaStatus === null ||
        databaseSchemaStatus.isFile() === false
    ){
        throw new LayerCliError(
            'CLI_BUILD_DATABASE_SCHEMA_INVALID',
            'database.schema.file must identify a file inside the application project.'
        );

    }

    const externalDependenciesData = Object.keys( buildOptionsData.config.deployment.dependencies );
    const serverExternalDependenciesData = [
        ...externalDependenciesData,
        'pg',
        '@node-rs/argon2',
        'oidc-provider'
    ];

    if ( buildOptionsData.config.auth !== null ){
        serverExternalDependenciesData.push( 'nodemailer' );

    }

    if ( buildOptionsData.config.redis !== null ){
        serverExternalDependenciesData.push( 'redis' );

    }
    //Leaving the CJS encryption dependency external; disabled apps never load it
    serverExternalDependenciesData.push( 'web-push' );
    const serverEntryImportData = './' + String( path.relative(
        buildOptionsData.rootDirectory,
        serverEntryFile
    ) ).replaceAll( '\\', '/' );
    const databaseSchemaImportData = './' + String( databaseSchemaRelativePath ).replaceAll( '\\', '/' );
    const applicationRuntimeImportData = String( path.relative(
        buildOptionsData.rootDirectory,
        applicationServerRuntimeFile
    ) ).replaceAll( '\\', '/' );
    let normalizedApplicationRuntimeImportData = applicationRuntimeImportData;

    if ( normalizedApplicationRuntimeImportData.startsWith( '.' ) === false ){
        normalizedApplicationRuntimeImportData = './' + normalizedApplicationRuntimeImportData;

    }

    const serverConfigurationData = {
        appName: buildOptionsData.config.appName,
        appVersion: buildOptionsData.config.appVersion,
        auth: buildOptionsData.config.auth,
        notifications: buildOptionsData.config.notifications,
        database: buildOptionsData.config.database,
        redis: buildOptionsData.config.redis,
        runtime: buildOptionsData.config.runtime
    };
    const serverBootstrapSourceData = `
import {layerApplicationServerRuntimeCreate as layerRuntimeCreate} from ${JSON.stringify( normalizedApplicationRuntimeImportData )};
import {layerServerCreate as applicationServerCreate} from ${JSON.stringify( serverEntryImportData )};
import {databaseSchema} from ${JSON.stringify( databaseSchemaImportData )};

const serverConfiguration = Object.freeze(${JSON.stringify( serverConfigurationData )});

export async function layerServerCreate(contextData) {
    return layerRuntimeCreate({
        rootDirectory: contextData.rootDirectory,
        stateDirectory: contextData.stateDirectory,
        configuration: serverConfiguration,
        databaseSchema,
        applicationServerCreate,
        context: contextData
    });
}
`;
    const serverBuildResult = await build({
        stdin: {
            contents: serverBootstrapSourceData,
            resolveDir: buildOptionsData.rootDirectory,
            sourcefile: 'layer-server-bootstrap.mjs',
            loader: 'js'
        },
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: ['node24'],
        write: false,
        sourcemap: 'external',
        sourcesContent: false,
        external: [
            ...serverExternalDependenciesData
        ],
        alias: {
            '@solcorp/layer-auth/server': authPackageEntryFile,
            '@solcorp/layer-notifications': notificationsPackageEntryFile,
            '@solcorp/layer-database': databasePackageEntryFile,
            '@solcorp/layer-events': eventsPackageEntryFile,
            '@solcorp/layer-security': securityPackageEntryFile
        },
        logLevel: 'silent',
        outfile: 'application.mjs'
    });
    const serverArtifactsData = /** @type {Record<string, string | Buffer>} */ ({});

    //Mapping the deterministic server output and source map into the deployment directory
    for ( const outputFileData of serverBuildResult.outputFiles ?? [] ){
        let artifactNameData = '_layer/server/application.mjs';

        if ( outputFileData.path.endsWith( '.map' ) ){
            artifactNameData += String( '.map' );

        }

        serverArtifactsData[artifactNameData] = outputFileData.text;

    }

    const serverBundleSource = serverArtifactsData['_layer/server/application.mjs'];

    //Checking the required named factory without executing trusted project code during build
    if (
        typeof serverBundleSource !== 'string' ||
        /export\s*\{[^}]*layerServerCreate/s.test( serverBundleSource ) === false
    ){
        //Passing the incomplete server contract to the CLI boundary
        throw new LayerCliError(
            'CLI_BUILD_SERVER_ENTRY_INVALID',
            'deployment.serverEntry must export layerServerCreate(context).'
        );

    }

    //Copying the exact PGlite runtime payloads beside the bundled server module
    for ( const pgliteAssetNameData of ['initdb.wasm', 'pglite.data', 'pglite.wasm'] ){
        serverArtifactsData[`_layer/server/${String( pgliteAssetNameData )}`] = await readFile(
            path.join( pglitePackageDirectory, pgliteAssetNameData )
        );

    }

    //CallBack THE OBJECT
    return serverArtifactsData;

};

//Function for creating every portable deployment artifact
/** @param {LayerDeploymentBuildOptions} buildOptionsData */
export const layerDeploymentBundleCreate = async function( buildOptionsData ){
    //Creating the package contract before generating its immutable npm lock
    const deploymentPackageData = deploymentPackageCreate( buildOptionsData.config );
    const deploymentPackageSource = JSON.stringify( deploymentPackageData, null, 4) + String( '\n' );
    const deploymentPackageLockSource = await deploymentPackageLockCreate(
        deploymentPackageData,
        buildOptionsData.dryRun === true
    );
    const serverEntryStatus = buildOptionsData.config.deployment.serverEntry !== null;
    const serverArtifactsData = await deploymentServerBundleCreate( buildOptionsData );
    const deploymentRunnerSource = await readFile( deploymentRunnerFile, 'utf8' );
    const runtimeVersionSource = await readFile( new URL( './runtime-version.js', import.meta.url ), 'utf8' );
    const deploymentManifestSource = JSON.stringify({
        appName: buildOptionsData.config.appName,
        appVersion: buildOptionsData.config.appVersion,
        domain: buildOptionsData.config.deployment.domain,
        originPort: buildOptionsData.config.deployment.originPort,
        serverEntry: serverEntryStatus,
        workers: {
            ...buildOptionsData.config.runtime.workers,
            maximumConnectionsPerWorker: buildOptionsData.config.database.pool.maximumConnectionsPerWorker,
            connectionBudget: buildOptionsData.config.database.pool.connectionBudget
        },
        caddy: {
            version: caddyVersion,
            assets: caddyAssets
        }
    }, null, 4) + String( '\n' );
    const environmentExampleSource = [
        'LAYER_DOMAIN=' + String( buildOptionsData.config.deployment.domain ?? 'app.example.com' ),
        'LAYER_HTTP_PORT=80',
        'LAYER_HTTPS_PORT=443',
        'LAYER_ORIGIN_PORT=' + String( buildOptionsData.config.deployment.originPort ),
        '# LAYER_CADDY_ADMIN_PORT=8788',
        'LAYER_STATE_DIRECTORY=',
        '# Optional Web Push: stable values, never commit secrets.',
        '# LAYER_PUSH_PUBLIC_KEY=',
        '# LAYER_PUSH_PRIVATE_KEY=',
        '# LAYER_NOTIFICATIONS_SECRET=',
        ''
    ].join( String( '\n' ) );

    //CallBack THE OBJECT
    return {
        'package.json': deploymentPackageSource,
        'package-lock.json': deploymentPackageLockSource,
        'Caddyfile': deploymentCaddyfileCreate( serverEntryStatus, buildOptionsData.config.auth, buildOptionsData.config.security ),
        '.env.example': environmentExampleSource,
        '_layer/deployment.json': deploymentManifestSource,
        '_layer/deployment/run.mjs': deploymentRunnerSource,
        '_layer/deployment/runtime-version.js': runtimeVersionSource,
        ...serverArtifactsData
    };

};
