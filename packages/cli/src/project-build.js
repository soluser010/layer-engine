import {createHash} from 'node:crypto';
import {
    cp,
    lstat,
    mkdir,
    readdir,
    readFile,
    rename,
    rm,
    stat,
    writeFile
} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild-wasm';
import {
    layerComponentCompile,
    layerComponentRouteExtract,
    layerJavascriptComponentCompile,
    layerOperationContractsCompile
} from '@solcorp/layer-compiler';
import {layerProtocolValidatorCreate} from '@solcorp/layer-protocol';
import {
    layerVersionManifestValidate,
    layerWebAppManifestValidate,
    LAYER_UPDATE_BUILD_PLACEHOLDER
} from '@solcorp/layer-pwa';
import {layerRouteManifestCreate} from '@solcorp/layer-router';
import {layerApplicationBundleCreate} from './application-bundle.js';
import {LayerCliError} from './cli-error.js';
import {frameworkVersionsRead} from './package-versions.js';
import {layerComponentBundleCreate} from './component-bundle.js';
import {layerConfigValidate} from './config.js';
import {layerDocumentationGenerate} from './documentation.js';
import {layerProductionSecretsAssert} from './infrastructure-config.js';
import {layerOperationFacadeCreate} from './operation-facade.js';
import {layerDeploymentBundleCreate} from './deployment-bundle.js';
import {layerServiceWorkerBundleCreate} from './service-worker-bundle.js';
import {layerNavigationBootstrapCreate} from './navigation-bootstrap.js';
import {layerStaticSsrDocumentsCreate} from './ssr-document.js';
import {layerEnvironmentRequestPathCheck} from './private-artifacts.js';
import {layerCssBuild, layerPublicCssBuild} from './css-build.js';
import {LayerPwaError, layerLinkAssociationDocumentsCreate, layerLinksConfigurationCreate} from '@solcorp/layer-pwa';

const databasePackageEntryFile = fileURLToPath( import.meta.resolve( '@solcorp/layer-database' ) );
const publicPrecacheFileLimit = 2048;
const publicPrecacheSingleFileByteLimit = 2 * 1024 * 1024;
const publicPrecacheTotalByteLimit = 16 * 1024 * 1024;
const authBrowserDeclarationSource = `import type {layerAuthBrowserCreate} from '@solcorp/layer-auth/browser';
import type {layerLinksCreate} from '@solcorp/layer-runtime';
import type {layerApplicationUpdatesCreate} from '@solcorp/layer-pwa';

declare global {
    interface Window {
        readonly layer: Record<string, any> & {
            readonly auth: ReturnType<typeof layerAuthBrowserCreate>;
            readonly links: ReturnType<typeof layerLinksCreate>;
            readonly pwa: Record<string, any> & {readonly update: Pick<ReturnType<typeof layerApplicationUpdatesCreate>,
                'check' | 'getState' | 'activate' | 'subscribe' | 'dismiss' | 'show'>};
        };
    }
}

export {};
`;

/**
 * @typedef {object} LayerBuildResult
 * @property {string} rootDirectory
 * @property {string} outputDirectory
 * @property {ReturnType<typeof layerConfigValidate>} config
 * @property {readonly Readonly<Record<string, unknown>>[]} routes
 * @property {readonly Readonly<Record<string, unknown>>[]} layouts
 * @property {readonly Readonly<Record<string, unknown>>[]} operations
 * @property {readonly string[]} artifacts
 * @property {Readonly<Record<string, string>>} integrity
 * @property {string} documentation
 * @property {boolean} dryRun
 */

/**
 * @param {string | Buffer} contentData
 */
function contentHashCreate(contentData) {
    //Producing a stable integrity identifier from the exact artifact content.
    return createHash('sha256').update(contentData).digest('hex');

}

/**
 * @param {string | Buffer} contentData
 */
function contentIntegrityCreate(contentData) {
    //Producing browser-compatible Subresource Integrity data for the Service Worker.
    return `sha256-${createHash('sha256').update(contentData).digest('base64')}`;

}

/**
 * @param {string} publicDirectory
 */
async function publicPrecacheAssetsRead(publicDirectory) {
    const assetsDirectory = path.join(publicDirectory, 'assets');
    const assetsStatus = await lstat(assetsDirectory).catch(function publicAssetsMissing(assetsError) {
        //An application without public/assets keeps the existing runtime-only precache.
        if (/** @type {NodeJS.ErrnoException} */ (assetsError).code === 'ENOENT') {
            return null;

        }

        throw assetsError;

    });

    if (assetsStatus === null) {
        return [];

    }

    if (assetsStatus.isDirectory() === false || assetsStatus.isSymbolicLink() === true) {
        throw new LayerCliError('CLI_BUILD_PUBLIC_ASSETS_INVALID', 'public/assets must be a regular directory.');

    }

    const precacheAssets = /** @type {{url: string, hash: string, required: true, policy: 'immutable'}[]} */ ([]);
    const pendingDirectories = [assetsDirectory];
    let totalBytes = 0;

    while (pendingDirectories.length > 0) {
        const currentDirectory = pendingDirectories.pop();

        if (currentDirectory === undefined) {
            continue;

        }

        const entries = await readdir(currentDirectory, {withFileTypes: true});

        for (const entryData of entries.sort(function publicAssetNameCompare(leftEntry, rightEntry) {
            //Making the generated manifest independent of filesystem enumeration order.
            return leftEntry.name < rightEntry.name ? -1 : leftEntry.name > rightEntry.name ? 1 : 0;

        })) {
            const entryFile = path.join(currentDirectory, entryData.name);

            //Skipping environment files before reading bytes or creating offline integrity entries
            if ( layerEnvironmentRequestPathCheck( '/' + path.relative( publicDirectory, entryFile ).replaceAll( '\\', '/' ) ) ){
                //Next the cycle
                continue;

            }

            if (!/^[A-Za-z0-9][A-Za-z0-9._&-]*$/u.test(entryData.name) || entryData.isSymbolicLink() === true) {
                throw new LayerCliError('CLI_BUILD_PUBLIC_ASSETS_INVALID', 'public/assets contains an unsafe name or link.');

            }

            if (entryData.isDirectory() === true) {
                pendingDirectories.push(entryFile);

                continue;

            }

            if (entryData.isFile() === false) {
                throw new LayerCliError('CLI_BUILD_PUBLIC_ASSETS_INVALID', 'public/assets contains a non-file entry.');

            }

            const assetStatus = await lstat(entryFile);

            if (assetStatus.isFile() === false || assetStatus.size > publicPrecacheSingleFileByteLimit) {
                throw new LayerCliError('CLI_BUILD_PUBLIC_ASSETS_LIMIT', 'A public/assets file exceeds the offline precache limit.');

            }

            totalBytes += assetStatus.size;

            if (precacheAssets.length >= publicPrecacheFileLimit || totalBytes > publicPrecacheTotalByteLimit) {
                throw new LayerCliError('CLI_BUILD_PUBLIC_ASSETS_LIMIT', 'public/assets exceeds the offline precache budget.');

            }

            const relativeAssetName = path.relative(publicDirectory, entryFile).replaceAll('\\', '/');
            const assetContent = await readFile(entryFile);

            if (assetContent.byteLength !== assetStatus.size) {
                throw new LayerCliError('CLI_BUILD_PUBLIC_ASSETS_INVALID', 'A public/assets file changed during the build.');

            }

            precacheAssets.push({
                url: `/${relativeAssetName}`,
                hash: contentIntegrityCreate(assetContent),
                required: true,
                policy: 'immutable'
            });

        }

    }

    return precacheAssets.sort(function publicAssetUrlCompare(leftAsset, rightAsset) {
        //Keeping the manifest stable across nested directory traversal.
        return leftAsset.url < rightAsset.url ? -1 : leftAsset.url > rightAsset.url ? 1 : 0;

    });

}

/**
 * @param {string} rootDirectoryData
 * @param {ReturnType<typeof layerConfigValidate>} configurationData
 */
async function databaseDeclarationSourceCreate( rootDirectoryData, configurationData ){
    const schemaFileData = path.resolve(
        rootDirectoryData,
        configurationData.database.schema.file
    );
    const relativeSchemaFileData = path.relative( rootDirectoryData, schemaFileData );

    if (
        relativeSchemaFileData.startsWith( '..' ) === true ||
        path.isAbsolute( relativeSchemaFileData ) === true
    ){
        throw new LayerCliError(
            'CLI_BUILD_DATABASE_SCHEMA_INVALID',
            'database.schema.file must stay inside the application project.'
        );

    }

    const schemaStatusData = await stat( schemaFileData ).catch(function schemaFileMissing( schemaErrorData ){
        if ( /** @type {NodeJS.ErrnoException} */ (schemaErrorData).code === 'ENOENT' ){
            return null;

        }

        throw schemaErrorData;

    });

    if ( schemaStatusData === null || schemaStatusData.isFile() === false ){
        throw new LayerCliError(
            'CLI_BUILD_DATABASE_SCHEMA_INVALID',
            'database.schema.file must identify a readable schema module.'
        );

    }

    const normalizedSchemaImportData = './' + String( relativeSchemaFileData ).replaceAll( '\\', '/' );
    const schemaEntrySourceData = `
import {layerDatabaseSchemaDeclarationsCreate} from '@solcorp/layer-database';
import {databaseSchema} from ${JSON.stringify( normalizedSchemaImportData )};

export const declarationSource = layerDatabaseSchemaDeclarationsCreate(databaseSchema);
`;

    try {
        const schemaBuildResultData = await build({
            stdin: {
                contents: schemaEntrySourceData,
                resolveDir: rootDirectoryData,
                sourcefile: 'layer-database-declarations.mjs',
                loader: 'js'
            },
            bundle: true,
            format: 'esm',
            platform: 'node',
            target: ['node24'],
            write: false,
            alias: {
                '@solcorp/layer-database': databasePackageEntryFile
            },
            logLevel: 'silent',
            outfile: 'database-declarations.mjs'
        });
        const schemaBundleData = schemaBuildResultData.outputFiles?.[0]?.text;

        if ( typeof schemaBundleData !== 'string' || Number( schemaBundleData.length ) < Number( 1 ) ){
            throw new Error( 'Database schema declaration bundle is empty.' );

        }

        const schemaModuleData = await import(
            `data:text/javascript;base64,${String( Buffer.from( schemaBundleData, 'utf8' ).toString( 'base64' ) )}`
        );

        if ( typeof schemaModuleData.declarationSource !== 'string' ){
            throw new Error( 'Database schema declaration output is invalid.' );

        }

        return schemaModuleData.declarationSource;

    } catch( schemaBuildErrorData ){
        let failureReasonData = String( 'Database schema could not be compiled.' );

        if ( schemaBuildErrorData instanceof Error ){
            failureReasonData = schemaBuildErrorData.message.slice( Number( 0 ), Number( 300 ) );

        }

        throw new LayerCliError(
            'CLI_BUILD_DATABASE_SCHEMA_INVALID',
            'Database schema declarations could not be generated.',
            {
                reason: failureReasonData
            }
        );

    }

}

/**
 * @param {string} manifestSource
 * @param {string} manifestFile
 */
function webAppManifestSourceValidate(manifestSource, manifestFile, scopeExtensions = /** @type {readonly string[]} */ ([])) {
    //Checking the manifest byte budget before parsing untrusted project metadata.
    if (Buffer.byteLength(manifestSource, 'utf8') > 256 * 1024) {
        throw new LayerCliError('CLI_BUILD_MANIFEST_INVALID', 'The web app manifest exceeds 256 KiB.', {
            file: manifestFile
        });

    }

    let manifestInput;

    try {
        //Parsing strict JSON before passing the standard object to the PWA contract.
        manifestInput = JSON.parse(manifestSource);

    } catch (manifestParseError) {
        let failureReason = 'Invalid JSON.';

        if (manifestParseError instanceof Error) {
            failureReason = manifestParseError.message.slice(0, 300);

        }

        throw new LayerCliError('CLI_BUILD_MANIFEST_INVALID', 'The web app manifest JSON is invalid.', {
            file: manifestFile,
            reason: failureReason
        });

    }

    try {
        //Canonicalizing the standard manifest through the public PWA validation contract.
        //Preserving explicit launch policy and the identity's previous effective start URL
        if (manifestInput === null || typeof manifestInput !== 'object' || Array.isArray(manifestInput)) {
            //Rejecting primitive roots without reflecting their text in parser errors
            throw new TypeError('The manifest root must be an object.');

        }
        manifestInput.id ??= manifestInput.start_url;
        manifestInput.launch_handler ??= {client_mode: 'focus-existing'};
        if (scopeExtensions.length > 0) {
            //Merging configured origins without replacing author-owned manifest objects
            const existingOrigins = new Set((manifestInput.scope_extensions ?? []).map(function(/** @type {any} */ extensionData) {
                //Reading only origins; complete extension objects are validated below
                return extensionData.origin;

            }));
            manifestInput.scope_extensions ??= [];
            for (const originData of scopeExtensions) {
                //Adding only missing related origins
                if (!existingOrigins.has(originData)) {
                    manifestInput.scope_extensions.push({type: 'origin', origin: originData});

                }

            }

        }
        const manifestData = layerWebAppManifestValidate(manifestInput);

        return Object.freeze({
            manifest: manifestData,
            source: `${JSON.stringify(manifestData, null, 4)}\n`
        });

    } catch (manifestValidationError) {
        let failureReason = 'The manifest contract is invalid.';

        if (manifestValidationError instanceof Error) {
            failureReason = manifestValidationError.message.slice(0, 300);

        }

        throw new LayerCliError('CLI_BUILD_MANIFEST_INVALID', 'The web app manifest contract is invalid.', {
            file: manifestFile,
            reason: failureReason
        });

    }

}

/**
 * @param {string} publicDirectory
 */
async function applicationShellCreate(publicDirectory) {
    const shellFile = path.join(publicDirectory, 'index.html');
    let shellSource;

    try {
        shellSource = await readFile(shellFile, 'utf8');

    } catch {
        throw new LayerCliError('CLI_BUILD_SHELL_REQUIRED', 'public/index.html is required for the PWA application shell.', {
            file: shellFile
        });

    }

    if (!/\sdata-layer-root(?:\s|=|>)/.test(shellSource)) {
        throw new LayerCliError('CLI_BUILD_SHELL_INVALID', 'The application shell requires one data-layer-root element.');

    }

    const applicationScript = '<script type="module" src="/_layer/application.mjs"></script>';
    const navigationScript = '<script src="/_layer/navigation.js"></script>';

    //Installing the small classic bootstrap before parsing any interactive prerendered body
    if (!shellSource.includes(navigationScript)) {
        if (!/<head(?:\s[^>]*)?>/iu.test(shellSource)) {
            throw new LayerCliError('CLI_BUILD_SHELL_INVALID', 'The application shell requires a head for early navigation.');

        }
        shellSource = shellSource.replace(/<head(?:\s[^>]*)?>/iu, '$&\n    ' + navigationScript);

    }

    //Installing the app shell before route CSS without permitting inline styles or disabling zoom
    const viewportStylesheet = '<link rel="stylesheet" href="/_layer/viewport.css">';
    //Loading viewer styling through an external integrity-checked resource
    const linksStylesheet = '<link rel="stylesheet" href="/_layer/links-viewer.css">';
    const updateStylesheet = '<link rel="stylesheet" href="/_layer/update-card.css">';
    if (!shellSource.includes(updateStylesheet)) {
        //Loading update visuals as an integrity-checked stylesheet under the existing CSP
        shellSource = shellSource.replace('</head>', '    ' + updateStylesheet + '\n</head>');

    }
    if (!shellSource.includes(linksStylesheet)) {
        shellSource = shellSource.replace('</head>', '    ' + linksStylesheet + '\n</head>');

    }
    if (!shellSource.includes(viewportStylesheet)) {
        shellSource = shellSource.replace('</head>', `    ${viewportStylesheet}\n</head>`);

    }

    const viewportMeta = '<meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-visual">';
    if (/<meta\b[^>]*\bname=["']viewport["'][^>]*>/iu.test(shellSource)) {
        shellSource = shellSource.replace(/<meta\b[^>]*\bname=["']viewport["'][^>]*>/iu, viewportMeta);

    } else {
        shellSource = shellSource.replace('</head>', `    ${viewportMeta}\n</head>`);

    }

    if (shellSource.includes(applicationScript)) {
        return shellSource;

    }

    if (!shellSource.includes('</body>')) {
        throw new LayerCliError('CLI_BUILD_SHELL_INVALID', 'The application shell requires a closing body element.');

    }

    //Injecting one external module without weakening a strict script-src policy.
    return shellSource.replace('</body>', `    ${applicationScript}\n</body>`);

}

/**
 * @param {readonly Readonly<Record<string, unknown>>[]} renderPlans
 */
function layoutStaticOutletCount(renderPlans) {
    let outletCount = 0;

    //Counting only outlets that are always present in the layout root plan.
    for (const renderPlan of renderPlans) {
        if (renderPlan.kind !== 'element') {
            continue;

        }

        let staticAttributes = [];

        //Reading only compiler-owned static attributes from element plans.
        if (Array.isArray(renderPlan.attributes)) {
            staticAttributes = renderPlan.attributes;

        }

        if (staticAttributes.some(function layoutOutletAttributeFind(attributeData) {
            //Recognizing the engine-owned static outlet marker only.
            return attributeData.name === 'data-layer-layout-outlet';

        })) {
            outletCount += 1;

        }

        if (Array.isArray(renderPlan.children)) {
            outletCount += layoutStaticOutletCount(renderPlan.children);

        }

    }

    return outletCount;

}

/**
 * @param {string} directoryData
 * @param {number} [maximumFiles]
 */
async function layerFilesDiscover(directoryData, maximumFiles = 10000) {
    const pendingDirectories = [directoryData];
    const layerFiles = [];

    while (pendingDirectories.length > 0) {
        const currentDirectory = pendingDirectories.pop();

        if (currentDirectory === undefined) {
            continue;

        }

        const directoryEntries = await readdir(currentDirectory, {
            withFileTypes: true
        });

        for (const directoryEntry of directoryEntries) {
            const entryPath = path.join(currentDirectory, directoryEntry.name);

            //Rejecting symlinks so discovery cannot leave the configured source tree.
            if (directoryEntry.isSymbolicLink()) {
                throw new LayerCliError('CLI_BUILD_SYMLINK_DENIED', 'Build source directories cannot contain symbolic links.', {
                    entry: entryPath
                });

            }

            if (directoryEntry.isDirectory()) {
                pendingDirectories.push(entryPath);

                continue;

            }

            if (directoryEntry.isFile() && /\.layer(?:\.js)?$/.test(directoryEntry.name)) {
                layerFiles.push(entryPath);

                if (layerFiles.length > maximumFiles) {
                    throw new LayerCliError('CLI_BUILD_LIMIT_EXCEEDED', 'Build contains more than 10000 Layer component files.');

                }

            }

        }

    }

    return layerFiles.sort(function layerFileCompare(firstFile, secondFile) {
        //Keeping build discovery deterministic across filesystems.
        return firstFile.localeCompare(secondFile);

    });

}

/**
 * @param {{rootDirectory: string, config: unknown, dryRun?: boolean, mode?: 'production' | 'development' | 'inspect', plugins?: readonly Readonly<Record<string, unknown>>[], operations?: readonly Readonly<Record<string, unknown>>[]}} buildOptions
 * @returns {Promise<Readonly<LayerBuildResult>>}
 */
export async function layerProjectBuild(buildOptions) {
    //Recording the versions that actually produce and execute this build
    const frameworkVersionsData = frameworkVersionsRead();
    if (buildOptions === null || typeof buildOptions !== 'object' || typeof buildOptions.rootDirectory !== 'string') {
        throw new LayerCliError('CLI_BUILD_INVALID', 'Build rootDirectory and config are required.');

    }

    const rootDirectory = path.resolve(buildOptions.rootDirectory);
    const configData = layerConfigValidate(buildOptions.config);

    //Checking production bundles never contain literal infrastructure secrets
    if ( (buildOptions.mode ?? 'production') === 'production' ){
        layerProductionSecretsAssert( configData.database, configData.redis );
        try {
            //Rejecting development-only plaintext link origins before production compilation
            layerLinksConfigurationCreate(configData.links);

        } catch (linksError) {
            //Keeping the shared link validator inside the CLI's safe diagnostic contract
            if (linksError instanceof LayerPwaError) {
                throw new LayerCliError('CLI_CONFIG_INVALID', linksError.message, linksError.details);

            }
            throw linksError;

        }

    }

    const sourceDirectory = path.resolve(rootDirectory, configData.sourceDirectory);
    const pagesDirectory = path.join(sourceDirectory, 'pages');
    const layoutsDirectory = path.join(sourceDirectory, 'layouts');
    const publicDirectory = path.resolve(rootDirectory, configData.publicDirectory);
    const outputDirectory = path.resolve(rootDirectory, configData.outputDirectory);
    const operationContractFile = path.join(sourceDirectory, 'operations.js');
    const databaseDeclarationSourceData = await databaseDeclarationSourceCreate( rootDirectory, configData );

    //Checking resolved directories before any destructive output operation.
    for (const controlledDirectory of [sourceDirectory, pagesDirectory, publicDirectory, outputDirectory]) {
        const relativeDirectory = path.relative(rootDirectory, controlledDirectory);

        if (relativeDirectory === '' || relativeDirectory.startsWith('..') || path.isAbsolute(relativeDirectory)) {
            throw new LayerCliError('CLI_BUILD_PATH_UNSAFE', 'Build directories must stay below the project root.');

        }

    }

    const pagesStatus = await stat(pagesDirectory).catch(function pagesDirectoryMissing(pagesError) {
        if (/** @type {NodeJS.ErrnoException} */ (pagesError).code === 'ENOENT') {
            return null;

        }

        throw pagesError;

    });

    if (pagesStatus?.isDirectory() !== true) {
        throw new LayerCliError('CLI_BUILD_NO_PAGES', 'A src/pages directory with at least one .layer page is required.');

    }

    const pageFiles = await layerFilesDiscover(pagesDirectory);

    if (pageFiles.length < 1) {
        throw new LayerCliError('CLI_BUILD_NO_PAGES', 'At least one .layer page is required.');

    }

    const operationContractStatus = await lstat(operationContractFile).catch(function operationContractMissing(operationError) {
        if (/** @type {NodeJS.ErrnoException} */ (operationError).code === 'ENOENT') {
            return null;

        }

        throw operationError;

    });
    let operationContracts = /** @type {readonly Readonly<Record<string, unknown>>[]} */ ([]);

    //Compiling the conventional contract module without importing project code.
    if (operationContractStatus !== null) {
        if (!operationContractStatus.isFile() || operationContractStatus.isSymbolicLink() ||
            operationContractStatus.size > 256 * 1024) {
            throw new LayerCliError(
                'CLI_OPERATION_CONTRACT_INVALID',
                'src/operations.js must be a regular file no larger than 256 KiB.'
            );

        }

        const operationContractSource = await readFile(operationContractFile, 'utf8');

        operationContracts = layerOperationContractsCompile(operationContractSource, {
            file: 'src/operations.js'
        });
        const protocolValidator = layerProtocolValidatorCreate();

        //Compiling both schemas now so invalid contracts cannot produce browser output.
        for (const operationData of operationContracts) {
            try {
                protocolValidator.schemaCompile(
                    /** @type {object | boolean} */ (operationData.inputSchema)
                );
                protocolValidator.schemaCompile(
                    /** @type {object | boolean} */ (operationData.outputSchema)
                );

            } catch (schemaError) {
                let schemaFailureReason = 'schema-invalid';

                //Exposing a bounded validator message without leaking an arbitrary thrown value.
                if (schemaError instanceof Error) {
                    schemaFailureReason = schemaError.message.slice(0, 300);

                }

                throw new LayerCliError(
                    'CLI_OPERATION_SCHEMA_INVALID',
                    'An operation contract contains an invalid JSON Schema.',
                    {
                        operation: operationData.name,
                        reason: schemaFailureReason
                    }
                );

            }

        }

    }

    const operationFacade = layerOperationFacadeCreate(operationContracts);
    const styleModuleDeclarationSource = `declare module '*.layer.css' {
    const classNames: Readonly<Record<string, string>>;
    export default classNames;
}

declare module '*.layer.module.css' {
    const classNames: Readonly<Record<string, string>>;
    export default classNames;
}

declare module '*.module.css' {
    const classNames: Readonly<Record<string, string>>;
    export default classNames;
}

declare module '*.global.layer.css' {
    const classNames: Readonly<Record<string, never>>;
    export default classNames;
}
`;

    const componentArtifacts = /** @type {Record<string, string>} */ ({});
    const routeSources = /** @type {{file: string, route: Readonly<Record<string, unknown>>, component: string, style: string}[]} */ ([]);

    for (const pageFile of pageFiles) {
        const componentSource = await readFile(pageFile, 'utf8');
        const relativePageFile = path.relative(rootDirectory, pageFile).replaceAll('\\', '/');
        let componentSuffix = '.layer';

        //Selecting the longest canonical component suffix.
        if (relativePageFile.endsWith('.layer.js')) {
            componentSuffix = '.layer.js';

        }
        const descriptiveIdentifier = relativePageFile
            .slice(0, -componentSuffix.length)
            .replace(/[^A-Za-z0-9._/-]/g, '-');
        const componentIdentifier = `${descriptiveIdentifier.slice(0, 140)}-${contentHashCreate(relativePageFile).slice(0, 12)}`;
        let componentData;
        /** @type {Readonly<Record<string, unknown>>} */
        let routeData;

        //Compiling dynamic route filenames under a safe collision-resistant component identity.
        if (componentSuffix === '.layer.js') {
            componentData = layerJavascriptComponentCompile(componentSource, {
                componentId: componentIdentifier,
                file: relativePageFile
            });
            routeData = /** @type {Readonly<Record<string, unknown>>} */ (
                componentData.module.metadata.page ?? {}
            );

        } else {
            componentData = layerComponentCompile(componentSource, {
                componentId: componentIdentifier,
                file: relativePageFile
            });
            routeData = layerComponentRouteExtract(componentData.script.source) ?? {};

        }
        const componentFile = `_layer/components/${contentHashCreate(relativePageFile).slice(0, 24)}.mjs`;
        const bundleArtifacts = await layerComponentBundleCreate({
            rootDirectory,
            sourceDirectory,
            pageFile,
            componentData,
            outputFile: componentFile,
            operationFacadeSource: operationFacade.runtimeSource
        });

        //Collecting both the executable component module and its linked source map.
        Object.assign(componentArtifacts, bundleArtifacts);
        routeSources.push(Object.freeze({
            file: relativePageFile,
            route: routeData,
            component: componentFile,
            style: componentFile.replace(/\.mjs$/, '.css')
        }));

    }

    const routeManifest = layerRouteManifestCreate(routeSources);
    const serializableRoutes = routeManifest.map(function routeSerialize(routeData) {
        const routeSource = /** @type {{component: string, style: string}} */ (routeSources.find(function routeSourceFind(sourceData) {
            //Connecting a validated route back to its compiled component artifact.
            return sourceData.file === routeData.file;

        }));

        return Object.freeze({
            id: routeData.id,
            file: routeData.file,
            component: routeSource.component,
            style: routeSource.style,
            path: routeData.path,
            render: routeData.render,
            layout: routeData.layout,
            auth: routeData.auth,
            permissions: routeData.permissions,
            preload: routeData.preload,
            guard: routeData.guard,
            offline: routeData.offline,
            cache: routeData.cache,
            metadata: routeData.metadata
        });

    });
    const layoutNames = [...new Set(routeManifest.map(function routeLayoutNameRead(routeData) {
        //Selecting only named layouts referenced by validated route metadata.
        return routeData.layout;

    }).filter(function routeLayoutNamePresent(layoutName) {
        //Omitting routes that mount directly into the application root.
        return layoutName !== null;

    }))].sort();
    const layoutRecords = [];

    for (const layoutName of layoutNames) {
        const layoutFile = path.join(layoutsDirectory, `${layoutName}.layer.js`);
        const layoutFileStatus = await lstat(layoutFile).catch(function layoutFileMissing(layoutError) {
            //Converting only a missing referenced layout into the stable build diagnostic.
            if (/** @type {NodeJS.ErrnoException} */ (layoutError).code === 'ENOENT') {
                return null;

            }

            throw layoutError;

        });

        if (layoutFileStatus === null || !layoutFileStatus.isFile() || layoutFileStatus.isSymbolicLink()) {
            throw new LayerCliError('CLI_BUILD_LAYOUT_MISSING', 'A referenced layout requires src/layouts/<name>.layer.js.', {
                layout: layoutName,
                file: layoutFile
            });

        }

        const relativeLayoutFile = path.relative(rootDirectory, layoutFile).replaceAll('\\', '/');
        const layoutSource = await readFile(layoutFile, 'utf8');
        const layoutIdentifier = `${relativeLayoutFile.slice(0, -'.layer.js'.length)}-${contentHashCreate(relativeLayoutFile).slice(0, 12)}`;
        const layoutComponentData = layerJavascriptComponentCompile(layoutSource, {
            componentId: layoutIdentifier,
            file: relativeLayoutFile
        });

        if (layoutComponentData.module.metadata.page !== undefined ||
            layoutStaticOutletCount(layoutComponentData.template) !== 1) {
            throw new LayerCliError('CLI_BUILD_LAYOUT_INVALID', 'A layout must omit page metadata and declare one static data-layer-layout-outlet.', {
                layout: layoutName,
                file: relativeLayoutFile
            });

        }

        const layoutComponentFile = `_layer/layouts/${contentHashCreate(relativeLayoutFile).slice(0, 24)}.mjs`;
        const layoutBundleArtifacts = await layerComponentBundleCreate({
            rootDirectory,
            sourceDirectory,
            pageFile: layoutFile,
            componentData: layoutComponentData,
            outputFile: layoutComponentFile,
            operationFacadeSource: operationFacade.runtimeSource
        });

        //Publishing layout code through the same compiler and declaration pipeline as pages.
        Object.assign(componentArtifacts, layoutBundleArtifacts);
        layoutRecords.push(Object.freeze({
            name: layoutName,
            file: relativeLayoutFile,
            component: layoutComponentFile,
            style: layoutComponentFile.replace(/\.mjs$/, '.css')
        }));

    }

    const serializableLayouts = Object.freeze(layoutRecords);
    const documentationData = layerDocumentationGenerate({
        appName: configData.appName,
        appVersion: configData.appVersion,
        routes: serializableRoutes,
        plugins: buildOptions.plugins ?? [],
        operations: buildOptions.operations ?? operationContracts
    });
    const publicStatus = await stat(publicDirectory).catch(function publicDirectoryMissing(publicError) {
        //Allowing the dedicated PWA shell diagnostic to report an absent directory.
        if (/** @type {NodeJS.ErrnoException} */ (publicError).code === 'ENOENT') {
            return null;

        }

        throw publicError;

    });

    if (publicStatus !== null && !publicStatus.isDirectory()) {
        throw new LayerCliError('CLI_BUILD_PUBLIC_INVALID', 'publicDirectory must be a directory.');

    }

    const shellSource = await applicationShellCreate(publicDirectory);
    const webAppManifestFile = path.join(publicDirectory, 'manifest.webmanifest');
    let webAppManifestSource;

    try {
        webAppManifestSource = await readFile(webAppManifestFile, 'utf8');

    } catch {
        throw new LayerCliError('CLI_BUILD_MANIFEST_REQUIRED', 'public/manifest.webmanifest is required for a PWA build.', {
            file: webAppManifestFile
        });

    }

    const validatedWebAppManifest = webAppManifestSourceValidate(webAppManifestSource, webAppManifestFile, configData.links.scopeExtensions);
    if ((buildOptions.mode ?? 'production') === 'production') {
        //Applying the same TLS boundary to author-owned manifest extensions
        const extensionOrigins = /** @type {any[]} */ (validatedWebAppManifest.manifest.scope_extensions ?? []).map(function(extensionData){
            //Extracting only already validated public origins
            return extensionData.origin;

        });
        try {
            //Rejecting development plaintext even if it was declared outside layer.config.js
            layerLinksConfigurationCreate({scopeExtensions: extensionOrigins});

        } catch (extensionError) {
            //Attaching this error to the actual manifest file rather than inventing a config line
            if (extensionError instanceof LayerPwaError) {
                throw new LayerCliError('CLI_BUILD_MANIFEST_INVALID', extensionError.message, {file: webAppManifestFile});

            }
            throw extensionError;

        }

    }
    const associationArtifacts = layerLinkAssociationDocumentsCreate(configData.links);
    if (Object.keys(associationArtifacts).length > 0) {
        //Preventing a copied public junction from redirecting generated writes outside staging
        const associationDirectory = path.join(publicDirectory, '.well-known');
        const directoryStatus = await lstat(associationDirectory).catch(function(directoryError){
            //Allowing only an absent container to be generated
            if (directoryError.code === 'ENOENT') {
                return null;

            }
            throw directoryError;

        });
        if (directoryStatus !== null && (!directoryStatus.isDirectory() || directoryStatus.isSymbolicLink())) {
            throw new LayerCliError('CLI_BUILD_ASSOCIATION_CONFLICT', 'The public .well-known directory must not be a file or symbolic link.', {file: associationDirectory});

        }

    }
    for (const associationFile of Object.keys(associationArtifacts)) {
        //Refusing to overwrite developer-owned files or symbolic links
        const existingFile = await lstat(path.join(publicDirectory, associationFile)).catch(function(associationError) {
            //Allowing only missing destinations
            if (associationError.code === 'ENOENT') {
                return null;

            }
            throw associationError;

        });
        if (existingFile !== null) {
            throw new LayerCliError('CLI_BUILD_ASSOCIATION_CONFLICT', 'Remove the public association file or disable its links.associations generator.', {
                file: path.join(publicDirectory, associationFile)
            });

        }

    }
    const updateAppKey = createHash('sha256').update(JSON.stringify({
        id: validatedWebAppManifest.manifest.id, scope: validatedWebAppManifest.manifest.scope
    })).digest('hex');
    const browserUpdates = {...configData.updates, appKey: updateAppKey};
    if (buildOptions.mode === 'development' && configData.development.liveReload) {
        //Leaving development revision ownership with live reload rather than the production updater
        browserUpdates.enabled = false;
        browserUpdates.ui = false;

    }
    const applicationArtifacts = await layerApplicationBundleCreate({
        rootDirectory,
        sourceDirectory,
        appName: configData.appName,
        appVersion: configData.appVersion,
        authEnabled: configData.auth !== null,
        routes: serializableRoutes,
        layouts: serializableLayouts,
        webAppManifest: validatedWebAppManifest.manifest,
        updates: browserUpdates,
        links: {
            external: configData.links.external,
            scopeExtensions: /** @type {any[]} */ (validatedWebAppManifest.manifest.scope_extensions ?? []).map(function(extensionData){
                //Keeping manifest-owned related origins in the same runtime policy as config-owned origins
                return extensionData.origin;

            })
        },
        outputFile: '_layer/application.mjs'
    });
    const ssrDocumentArtifacts = await layerStaticSsrDocumentsCreate({
        shellSource,
        routes: serializableRoutes,
        layouts: serializableLayouts,
        componentArtifacts
    });
    const applicationArtifactsData = /** @type {Record<string, string>} */ ({
        ...componentArtifacts,
        ...applicationArtifacts,
        ...ssrDocumentArtifacts,
        '_layer/navigation.js': '(' + layerNavigationBootstrapCreate.toString() + ')(window,' + JSON.stringify({
            scope: validatedWebAppManifest.manifest.scope,
            appKey: updateAppKey,
            matchers: routeManifest.map(function(routeData){
                //Reusing the authoritative compiled matchers without inventing another routing syntax
                return routeData.matcher.source;

            })
        }) + ');\n',
        '_layer/viewport.css': await readFile(new URL('./viewport-shell.css', import.meta.url), 'utf8'),
        '_layer/links-viewer.css': await readFile(new URL('./links-viewer.css', import.meta.url), 'utf8'),
        '_layer/update-card.css': await readFile(new URL('./update-card.css', import.meta.url), 'utf8'),
        ...associationArtifacts,
        'manifest.webmanifest': validatedWebAppManifest.source,
        '_layer/routes.json': `${JSON.stringify(serializableRoutes, null, 4)}\n`,
        '_layer/layouts.json': `${JSON.stringify(serializableLayouts, null, 4)}\n`,
        '_layer/styles.json': `${JSON.stringify({
            routes: serializableRoutes.map(function routeStyleCreate(routeData) {
                //Linking each route to its extracted stylesheet without source disclosure.
                return {
                    id: routeData.id,
                    path: routeData.path,
                    component: routeData.component,
                    style: routeData.style
                };

            }),
            layouts: serializableLayouts.map(function layoutStyleCreate(layoutData) {
                //Linking each named layout to its extracted stylesheet.
                return {
                    name: layoutData.name,
                    component: layoutData.component,
                    style: layoutData.style
                };

            })
        }, null, 4)}\n`,
        '_layer/styles.d.ts': styleModuleDeclarationSource,
        '_layer/database.d.ts': databaseDeclarationSourceData,
        '_layer/types/layer-auth.d.ts': authBrowserDeclarationSource,
        '_layer/operations.mjs': operationFacade.runtimeSource,
        '_layer/operations.d.mts': operationFacade.declarationSource,
        '_layer/operations.json': operationFacade.manifestSource,
        '_layer/API.md': documentationData
    });
    //Optimizing emitted styles after Layer scoping and before buildId, integrity and offline hashes
    for ( const artifactName of Object.keys( applicationArtifactsData ) ){
        if ( /\.css$/i.test( artifactName ) ){
            applicationArtifactsData[artifactName] = layerCssBuild( String(applicationArtifactsData[artifactName]), artifactName, configData.css );

        }

    }
    const publicCssArtifacts = /** @type {Record<string, string>} */ ({});
    if ( publicStatus !== null ){
        Object.assign( publicCssArtifacts, await layerPublicCssBuild( publicDirectory, configData.css ) );

    }
    const precacheArtifactNames = Object.keys(applicationArtifactsData).filter(function precacheArtifactSelect(artifactName) {
        //Keeping source maps, declarations, and developer documentation outside the mandatory offline install.
        return !artifactName.endsWith('.map') &&
            !artifactName.startsWith('.well-known/') &&
            !artifactName.endsWith('.d.ts') &&
            !artifactName.endsWith('.d.mts') &&
            artifactName !== '_layer/API.md' &&
            artifactName !== '_layer/styles.json' &&
            artifactName !== '_layer/operations.json';

    });
    const publicPrecacheAssets = (await publicPrecacheAssetsRead(publicDirectory)).map(function( assetData ){
        //Hashing the exact optimized public CSS that will overwrite the staging copy
        const cssContent = publicCssArtifacts[assetData.url.slice(1)];
        if ( cssContent !== undefined ){
            return {...assetData, hash: contentIntegrityCreate(cssContent)};

        }
        return assetData;

    });

    if (publicPrecacheAssets.some(function publicAssetConflictFind(assetData) {
        //Public assets must not shadow generated runtime files in the release.
        return Object.hasOwn(applicationArtifactsData, assetData.url.slice(1));

    })) {
        throw new LayerCliError('CLI_BUILD_PUBLIC_ASSETS_INVALID', 'public/assets conflicts with a generated artifact.');

    }

    let versionManifest = layerVersionManifestValidate({
        appVersion: configData.appVersion,
        runtimeVersion: frameworkVersionsData.runtimeVersion,
        compilerVersion: frameworkVersionsData.compilerVersion,
        protocolMin: 1,
        protocolMax: 1,
        schemaVersions: {
            engine: 1
        },
        minVersion: null,
        rollbackVersion: null,
        offlineShellUrl: '/_layer/shell.html',
        assets: [
            ...precacheArtifactNames.map(function precacheAssetCreate(artifactName) {
                //Declaring every runtime artifact under its same-origin production URL.
                const artifactContent = applicationArtifactsData[artifactName];
                let cachePolicy = 'immutable';

                if (artifactContent === undefined) {
                    throw new LayerCliError('CLI_BUILD_ARTIFACT_MISSING', 'A precache artifact is unavailable.');

                }

                //Keeping only the navigation fallback under the shell cache policy.
                if (artifactName === 'index.html') {
                    cachePolicy = 'shell';

                }

                return {
                    url: `/${artifactName}`,
                    hash: contentIntegrityCreate(artifactContent),
                    required: true,
                    policy: cachePolicy
                };

            }),
            ...publicPrecacheAssets
        ]
    });
    //Hashing canonical pre-injection resources and the complete worker program without a circular build ID
    const prototypeWorker = await layerServiceWorkerBundleCreate({
        rootDirectory, appName: configData.appName, manifest: versionManifest,
        webAppManifest: validatedWebAppManifest.manifest, outputFile: 'layer-service-worker.js',
        deployment: {buildId: LAYER_UPDATE_BUILD_PLACEHOLDER, appKey: updateAppKey,
            scope: String(validatedWebAppManifest.manifest.scope),
            development: buildOptions.mode === 'development' && configData.development.liveReload}
    });
    const buildHash = createHash('sha256');
    for (const artifactName of [...precacheArtifactNames].sort()) {
        //Including resource names and content without host paths, secrets or timestamps
        buildHash.update(JSON.stringify([artifactName, applicationArtifactsData[artifactName]]));

    }
    buildHash.update(JSON.stringify(publicPrecacheAssets));
    //Including public CSS outside /assets in release identity without expanding offline caching
    buildHash.update(JSON.stringify(Object.entries(publicCssArtifacts).sort()));
    buildHash.update(String(prototypeWorker['layer-service-worker.js']));
    const updateBuildId = buildHash.digest('hex');
    for (const artifactName of Object.keys(applicationArtifactsData)) {
        //Replacing the one reserved bootstrap marker only after the deterministic digest is fixed
        applicationArtifactsData[artifactName] = String(applicationArtifactsData[artifactName]).replaceAll(LAYER_UPDATE_BUILD_PLACEHOLDER, updateBuildId);

    }
    versionManifest = layerVersionManifestValidate({...versionManifest, assets: versionManifest.assets.map(function(assetData){
        //Recalculating integrity against final injected bytes, not the hash-placeholder prototype
        const finalContent = applicationArtifactsData[assetData.url.slice(1)];
        if (finalContent !== undefined) {
            return {...assetData, hash: contentIntegrityCreate(finalContent)};

        }
        return assetData;

    })});
    const versionManifestSource = `${JSON.stringify(versionManifest, null, 4)}\n`;
    const serviceWorkerArtifacts = await layerServiceWorkerBundleCreate({
        rootDirectory,
        appName: configData.appName,
        manifest: versionManifest,
        webAppManifest: validatedWebAppManifest.manifest,
        deployment: {buildId: updateBuildId, appKey: updateAppKey,
            scope: String(validatedWebAppManifest.manifest.scope),
            development: buildOptions.mode === 'development' && configData.development.liveReload},
        outputFile: 'layer-service-worker.js'
    });
    const deploymentArtifacts = await layerDeploymentBundleCreate({
        rootDirectory,
        sourceDirectory,
        config: configData,
        dryRun: buildOptions.dryRun === true
    });
    const generatedArtifacts = {
        ...publicCssArtifacts,
        ...applicationArtifactsData,
        ...serviceWorkerArtifacts,
        '_layer/version.json': versionManifestSource,
        '_layer/update.json': JSON.stringify({protocol: 1, buildId: updateBuildId,
            versionManifestHash: contentIntegrityCreate(versionManifestSource)}, null, 4) + '\n',
        ...deploymentArtifacts
    };
    const artifactIntegrity = Object.freeze(Object.fromEntries(Object.entries(generatedArtifacts).map(function artifactHashCreate([artifactName, artifactContent]) {
        //Recording a content hash for every generated artifact.
        return [artifactName, `sha256-${contentHashCreate(artifactContent)}`];

    })));
    const buildResult = Object.freeze({
        rootDirectory,
        outputDirectory,
        config: configData,
        routes: Object.freeze(serializableRoutes),
        layouts: serializableLayouts,
        operations: operationContracts,
        artifacts: Object.freeze(Object.keys(generatedArtifacts)),
        integrity: artifactIntegrity,
        documentation: documentationData,
        dryRun: buildOptions.dryRun === true
    });

    if (buildOptions.dryRun === true) {
        return buildResult;

    }

    const outputParentDirectory = path.dirname(outputDirectory);
    const outputDirectoryName = path.basename(outputDirectory);
    const outputStagingDirectory = path.join(
        outputParentDirectory,
        `.${outputDirectoryName}.layer-build-${process.pid}-${Date.now()}`
    );
    const outputBackupDirectory = path.join(
        outputParentDirectory,
        `.${outputDirectoryName}.layer-backup-${process.pid}-${Date.now()}`
    );

    //Creating the complete release beside the live output before replacing it
    await rm(outputStagingDirectory, {
        recursive: true,
        force: true
    });
    await mkdir(outputStagingDirectory, {recursive: true});

    if (publicStatus !== null) {
        await cp(publicDirectory, outputStagingDirectory, {
            recursive: true,
            errorOnExist: false,
            filter( publicFileData ){
                //Keeping environment files and directories out of the portable release
                const publicRequestPathData = '/' + path.relative( publicDirectory, publicFileData ).replaceAll( '\\', '/' );

                //CallBack THE BOOLEAN
                return layerEnvironmentRequestPathCheck( publicRequestPathData ) === false;

            }
        });

    }

    for (const [artifactName, artifactContent] of Object.entries(generatedArtifacts)) {
        const artifactFile = path.join(outputStagingDirectory, artifactName);
        await mkdir(path.dirname(artifactFile), {recursive: true});
        await writeFile(artifactFile, artifactContent);

    }

    await writeFile(path.join(outputStagingDirectory, '_layer/build.json'), `${JSON.stringify({
        appName: configData.appName,
        appVersion: configData.appVersion,
        integrity: artifactIntegrity
    }, null, 4)}\n`, 'utf8');

    const currentOutputStatus = await stat(outputDirectory).catch(function outputDirectoryMissing(outputError) {
        //Returning explicit absence while preserving unexpected filesystem failures.
        if (/** @type {NodeJS.ErrnoException} */ (outputError).code === 'ENOENT') {
            return null;

        }

        throw outputError;

    });

    try {
        //Moving the previous complete release aside only after staging succeeds
        if (currentOutputStatus !== null) {
            await rename(outputDirectory, outputBackupDirectory);

        }

        //Publishing the staged release through one same-filesystem rename
        await rename(outputStagingDirectory, outputDirectory);

    } catch (outputPublishError) {
        const backupStatus = await stat(outputBackupDirectory).catch(function outputBackupMissing() {
            //Returning explicit absence for rollback selection
            return null;

        });

        //Restoring the previous release when publishing the new directory fails
        if (backupStatus !== null) {
            await rename(outputBackupDirectory, outputDirectory);

        }

        throw outputPublishError;

    } finally {
        //Removing only task-owned staging and backup directories
        await rm(outputStagingDirectory, {
            recursive: true,
            force: true
        });
        await rm(outputBackupDirectory, {
            recursive: true,
            force: true
        });

    }

    return buildResult;

}
