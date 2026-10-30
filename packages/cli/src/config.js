import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parse} from 'acorn';
import {
    LayerAuthError,
    layerAuthConfigurationCreate,
    layerAuthConfigurationRedact
} from '@solcorp/layer-auth/server';
import {LayerCliError} from './cli-error.js';
import {LayerError} from '@solcorp/layer-protocol';
import {LayerPwaError, layerLinksConfigurationCreate, layerUpdatesConfigurationCreate} from '@solcorp/layer-pwa';
import {layerNotificationsConfigurationCreate} from '@solcorp/layer-notifications';
import {layerSecurityConfigurationCreate} from './content-security-policy.js';
import {layerCssConfigurationCreate} from './css-build.js';
import {
    layerDatabaseConfigurationCreate,
    layerInfrastructureConfigurationRedact,
    layerRedisConfigurationCreate,
    layerRuntimeConfigurationCreate
} from './infrastructure-config.js';

const configurationFields = Object.freeze([
    'appName',
    'appVersion',
    'auth',
    'css',
    'database',
    'deployment',
    'development',
    'links',
    'notifications',
    'outputDirectory',
    'publicDirectory',
    'redis',
    'runtime',
    'security',
    'sourceDirectory',
    'updates'
]);
const deploymentDependencyNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/;
const deploymentDependencyVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const deploymentDomainPattern = /^(?:localhost|(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;

/**
 * @param {LayerCliError} configurationError
 * @returns {string | null}
 */
function configurationErrorPathCreate( configurationError ){
    //Using an explicitly prepared path before deriving one from a legacy message
    const configurationDetailsData = configurationError.details;

    if ( configurationDetailsData !== null && typeof configurationDetailsData.path === String( 'string' ) ){
        return String( configurationDetailsData.path );

    }

    //Reading a leading dotted path such as database.postgres[0].tls.mode
    const messagePathMatch = /^([A-Za-z][A-Za-z0-9]*(?:(?:\.[A-Za-z][A-Za-z0-9]*)|(?:\[[0-9]+\]))*)\b/u.exec(
        String( configurationError.message )
    );

    if ( messagePathMatch !== null ){
        const messagePathData = String( messagePathMatch[1] );

        //Accepting either a nested path or one known root configuration field
        if ( messagePathData.includes( '.' ) || configurationFields.includes( messagePathData ) ){
            return messagePathData;

        }

    }

    //Connecting a single unknown field to the object named by the validator message
    const unknownFieldsData = configurationDetailsData?.fields;

    if ( Array.isArray( unknownFieldsData ) && Number( unknownFieldsData.length ) === Number( 1 ) ){
        const unknownFieldData = unknownFieldsData[0];

        if ( typeof unknownFieldData === String( 'string' ) && /^[A-Za-z][A-Za-z0-9]*$/u.test( unknownFieldData ) ){
            if ( String( configurationError.message ).startsWith( String( 'database configuration' ) ) ){
                return `database.${String( unknownFieldData )}`;

            }

            if ( String( configurationError.message ).startsWith( String( 'redis configuration' ) ) ){
                return `redis.${String( unknownFieldData )}`;

            }

            return String( unknownFieldData );

        }

    }

    //CallBack THE OBJECT
    return null;

}

/**
 * @param {LayerCliError} configurationError
 * @param {string | null} configurationPathData
 * @returns {readonly string[]}
 */
function configurationErrorSuggestionsCreate( configurationError, configurationPathData ){
    //Providing password repairs without ever reading or reflecting the secret value
    if ( configurationPathData?.endsWith( String( '.password.env' ) ) === true ){
        let environmentVariableData = String( 'LAYER_POSTGRES_PASSWORD' );

        //Selecting the documented secret name for the configured infrastructure service
        if ( configurationPathData.startsWith( String( 'redis.' ) ) ){
            environmentVariableData = String( 'LAYER_REDIS_PASSWORD' );

        }

        return Object.freeze([
            `Use password: {env: '${String( environmentVariableData )}'} with an uppercase ENV variable name.`,
            String( 'For a passwordless loopback service use password: null.' )
        ]);

    }

    //Providing the complete supported TLS modes and the local plaintext restriction
    if ( configurationPathData?.endsWith( String( '.tls.mode' ) ) === true ){
        return Object.freeze([
            String( "Use tls.mode: 'disable', 'require', or 'verify-full'." ),
            String( "Use 'disable' only with 127.0.0.1, localhost, or ::1." )
        ]);

    }

    //Explaining how an external database can be disabled intentionally
    if ( configurationPathData === String( 'database.postgres' ) ){
        return Object.freeze([
            String( 'Use database.postgres: [] to enable the single-worker embedded PGlite mode.' )
        ]);

    }

    //Explaining strict unknown-field validation without guessing a replacement name
    if ( String( configurationError.message ).includes( String( 'unknown fields' ) ) ){
        return Object.freeze([
            String( 'Remove the unknown field or replace it with a documented layer.config.js field.' )
        ]);

    }

    //Providing the intentional disable value for optional production backend code
    if ( configurationPathData === String( 'deployment.serverEntry' ) ){
        return Object.freeze([
            String( 'Use deployment.serverEntry: null for a static PWA without a Node backend.' )
        ]);

    }

    //Keeping package-provided Auth repair instructions when the CLI has no narrower suggestion
    const packageSuggestionsData = configurationError.details?.suggestions;

    if ( Array.isArray( packageSuggestionsData ) === true ){
        return Object.freeze(packageSuggestionsData.map(function packageSuggestionNormalize( suggestionData ){
            return String( suggestionData );

        }));

    }

    //CallBack THE OBJECT
    return Object.freeze([]);

}

/**
 * @param {string} configurationPathData
 * @returns {readonly (string | number)[]}
 */
function configurationPathSegmentsCreate( configurationPathData ){
    //Converting dotted properties and array indexes into an ordered traversal path
    const pathSegmentsData = /** @type {(string | number)[]} */ ([]);
    const pathTokenPattern = /([A-Za-z][A-Za-z0-9-]*)|\[([0-9]+)\]/gu;

    for ( const pathTokenMatch of configurationPathData.matchAll( pathTokenPattern ) ){
        if ( pathTokenMatch[1] !== undefined ){
            pathSegmentsData.push( String( pathTokenMatch[1] ) );

        } else {
            pathSegmentsData.push( Number( pathTokenMatch[2] ) );

        }

    }

    //CallBack THE OBJECT
    return Object.freeze( pathSegmentsData );

}

/**
 * @param {any} programData
 * @param {string} configurationPathData
 * @returns {{line: number, column: number} | null}
 */
function configurationPropertyLocationCreate( programData, configurationPathData ){
    //Returning no source location when parsing did not produce a static program
    if ( programData === null || typeof programData !== String( 'object' ) || Array.isArray( programData.body ) === false ){
        return null;

    }

    //Finding the direct export default object used by generated Layer configurations
    const exportStatementData = programData.body.find(function configurationExportFind( /** @type {any} */ statementData ){
        //Selecting only the ESM configuration boundary without executing its expression
        return statementData.type === String( 'ExportDefaultDeclaration' );

    });
    let currentNodeData = exportStatementData?.declaration;
    let propertyNodeData = null;

    //Following only static object properties and array indexes without evaluating configuration code
    for ( const pathSegmentData of configurationPathSegmentsCreate( configurationPathData ) ){
        if ( typeof pathSegmentData === String( 'number' ) ){
            if ( currentNodeData?.type !== String( 'ArrayExpression' ) ){
                return null;

            }

            currentNodeData = currentNodeData.elements[pathSegmentData];
            continue;

        }

        if ( currentNodeData?.type !== String( 'ObjectExpression' ) ){
            return null;

        }

        propertyNodeData = currentNodeData.properties.find(function configurationPropertyFind( /** @type {any} */ candidatePropertyData ){
            //Rejecting dynamic property shapes that cannot produce a reliable source location
            if ( candidatePropertyData.type !== String( 'Property' ) || candidatePropertyData.computed === true ){
                return false;

            }

            const propertyNameData = candidatePropertyData.key.name ?? candidatePropertyData.key.value;

            return String( propertyNameData ) === String( pathSegmentData );

        });

        if ( propertyNodeData === undefined ){
            return null;

        }

        currentNodeData = propertyNodeData.value;

    }

    //Checking the Acorn location before converting its zero-based column for developers
    if ( propertyNodeData?.key?.loc?.start === undefined ){
        return null;

    }

    //CallBack THE OBJECT
    return {
        line: Number( propertyNodeData.key.loc.start.line ),
        column: Number( propertyNodeData.key.loc.start.column ) + Number( 1 )
    };

}

/**
 * @param {LayerCliError} configurationError
 * @param {any} programData
 * @returns {LayerCliError}
 */
function configurationErrorEnrich( configurationError, programData ){
    //Getting the declarative field and its static source position when available
    const configurationPathData = configurationErrorPathCreate( configurationError );
    let configurationLocationData = null;

    if ( configurationPathData !== null ){
        configurationLocationData = configurationPropertyLocationCreate( programData, configurationPathData );

    }

    //Creating safe repair instructions independently from the rejected field value
    const configurationSuggestionsData = configurationErrorSuggestionsCreate(
        configurationError,
        configurationPathData
    );

    //CallBack THE OBJECT
    return new LayerCliError(
        String( configurationError.code ),
        String( configurationError.message ),
        Object.freeze({
            ...(configurationError.details ?? {}),
            file: String( 'layer.config.js' ),
            path: configurationPathData,
            line: configurationLocationData?.line ?? null,
            column: configurationLocationData?.column ?? null,
            suggestions: configurationSuggestionsData,
            documentation: String( 'docs/ru/reference.md' )
        })
    );

}

/**
 * @param {unknown} valueData
 * @returns {valueData is Record<string, unknown>}
 */
function plainObjectCheck(valueData) {
    //Checking configuration records without accepting arrays or null.
    return typeof valueData === 'object' && valueData !== null && !Array.isArray(valueData);

}

/**
 * @param {unknown} directoryData
 * @param {string} fieldName
 */
function relativeDirectoryNormalize(directoryData, fieldName) {
    //Checking a project-owned relative directory before path resolution.
    if (typeof directoryData !== 'string' || directoryData.length < 1 || directoryData.length > 200 ||
        path.isAbsolute(directoryData) || directoryData.includes('\0')) {
        throw new LayerCliError('CLI_CONFIG_INVALID', `${fieldName} must be a relative directory.`);

    }

    const normalizedDirectory = directoryData.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');

    if (normalizedDirectory === '' || normalizedDirectory === '.' || normalizedDirectory.split('/').includes('..')) {
        throw new LayerCliError('CLI_CONFIG_INVALID', `${fieldName} must stay inside the project.`);

    }

    return normalizedDirectory;

}

/**
 * @param {unknown} deploymentInput
 */
function deploymentConfigurationCreate( deploymentInput ){
    //Getting the optional production configuration without accepting inherited defaults
    const deploymentData = /** @type {Record<string, unknown>} */ (deploymentInput ?? {});

    //Checking the deployment object and rejecting misspelled production fields
    if (
        plainObjectCheck( deploymentData ) === false ||
        Object.keys( deploymentData ).some(function deploymentFieldFind( fieldName ){
            //Finding fields outside the portable production bundle contract
            return [
                'dependencies',
                'domain',
                'originPort',
                'serverEntry'
            ].includes( fieldName ) === false;

        })
    ){
        //Passing the invalid production configuration to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'deployment configuration is invalid.' );

    }

    //Getting the public hostname and private origin configuration
    const deploymentDomainInput = deploymentData.domain ?? null;
    const deploymentOriginPort = deploymentData.originPort ?? 8787;
    const deploymentServerEntryInput = deploymentData.serverEntry ?? null;

    //Checking the optional hostname before it can reach a generated Caddyfile
    if (
        deploymentDomainInput !== null &&
        (
            typeof deploymentDomainInput !== 'string' ||
            deploymentDomainPattern.test( deploymentDomainInput ) === false
        )
    ){
        //Passing the unsafe hostname to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'deployment.domain must be null or a safe ASCII hostname.' );

    }

    //Checking the private Node origin port
    if (
        Number.isInteger( deploymentOriginPort ) === false ||
        Number( deploymentOriginPort ) < Number( 1024 ) ||
        Number( deploymentOriginPort ) > Number( 65535 )
    ){
        //Passing the invalid origin port to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'deployment.originPort must be between 1024 and 65535.' );

    }

    let deploymentServerEntry = null;

    //Normalizing the optional server entry relative to the configured source directory
    if ( deploymentServerEntryInput !== null ){
        if ( typeof deploymentServerEntryInput !== 'string' ){
            //Passing a non-string server entry to the CLI boundary
            throw new LayerCliError( 'CLI_CONFIG_INVALID', 'deployment.serverEntry must identify a JavaScript module.' );

        }

        const normalizedServerEntry = relativeDirectoryNormalize(
            deploymentServerEntryInput,
            'deployment.serverEntry'
        );

        //Checking the executable JavaScript extension before bundling server code
        if ( /\.(?:js|mjs)$/.test( normalizedServerEntry ) === false ){
            //Passing the unsupported server entry to the CLI boundary
            throw new LayerCliError( 'CLI_CONFIG_INVALID', 'deployment.serverEntry must identify a JavaScript module.' );

        }

        deploymentServerEntry = normalizedServerEntry;

    }

    //Getting the explicit external runtime dependencies
    const deploymentDependenciesInput = deploymentData.dependencies ?? {};

    //Checking the dependency dictionary before reading package names
    if ( plainObjectCheck( deploymentDependenciesInput ) === false ){
        //Passing the invalid dependency dictionary to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'deployment.dependencies must be an object.' );

    }

    const deploymentDependencies = /** @type {Record<string, string>} */ ({});

    //Validating every external dependency as an exact immutable npm version
    for ( const [dependencyName, dependencyVersion] of Object.entries( deploymentDependenciesInput ) ){
        if (
            deploymentDependencyNamePattern.test( dependencyName ) === false ||
            typeof dependencyVersion !== 'string' ||
            deploymentDependencyVersionPattern.test( dependencyVersion ) === false
        ){
            //Passing mutable or malformed dependency metadata to the CLI boundary
            throw new LayerCliError(
                'CLI_CONFIG_INVALID',
                'deployment.dependencies require valid package names and exact versions.'
            );

        }

        deploymentDependencies[dependencyName] = dependencyVersion;

    }

    //CallBack THE OBJECT
    return Object.freeze({
        domain: deploymentDomainInput,
        serverEntry: deploymentServerEntry,
        originPort: Number( deploymentOriginPort ),
        dependencies: Object.freeze( deploymentDependencies )
    });

}

/**
 * @param {unknown} configData
 */
export function layerConfigValidate(configData) {
    //Checking the configuration object and rejecting misspelled fields.
    if (!plainObjectCheck(configData)) {
        throw new LayerCliError('CLI_CONFIG_INVALID', 'layer.config.js must export an object.');

    }

    const unknownFields = Object.keys(configData).filter(function unknownConfigurationFieldFind(fieldName) {
        //Finding fields outside the stable Layer configuration contract.
        return !configurationFields.includes(fieldName);

    });

    if (unknownFields.length > 0) {
        throw new LayerCliError('CLI_CONFIG_INVALID', 'Configuration contains unknown fields.', {
            fields: unknownFields
        });

    }

    const appName = configData.appName;
    const appVersion = configData.appVersion ?? '0.1.0';
    const sourceDirectory = relativeDirectoryNormalize(configData.sourceDirectory ?? 'src', 'sourceDirectory');
    const publicDirectory = relativeDirectoryNormalize(configData.publicDirectory ?? 'public', 'publicDirectory');
    const outputDirectory = relativeDirectoryNormalize(configData.outputDirectory ?? 'dist', 'outputDirectory');

    if (typeof appName !== 'string' || !/^[a-z][a-z0-9-]{1,79}$/.test(appName) ||
        typeof appVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(appVersion)) {
        throw new LayerCliError('CLI_CONFIG_INVALID', 'appName or appVersion is invalid.');

    }

    if (new Set([sourceDirectory, publicDirectory, outputDirectory]).size !== 3) {
        throw new LayerCliError('CLI_CONFIG_INVALID', 'Source, public, and output directories must be different.');

    }

    const developmentData = configData.development ?? {};

    if (!plainObjectCheck(developmentData) || Object.keys(developmentData).some(function developmentFieldFind(fieldName) {
        //Finding fields outside the local development host contract.
        return !['host', 'port', 'https', 'liveReload'].includes(fieldName);

    })) {
        throw new LayerCliError('CLI_CONFIG_INVALID', 'development configuration is invalid.');

    }

    const developmentHost = developmentData.host ?? '127.0.0.1';
    const developmentPort = developmentData.port ?? 5173;
    const developmentHttps = developmentData.https ?? false;
    const developmentLiveReload = developmentData.liveReload ?? true;

    if (!['127.0.0.1', 'localhost', '::1'].includes(String(developmentHost)) ||
        !Number.isInteger(developmentPort) || Number(developmentPort) < 1024 || Number(developmentPort) > 65535 ||
        typeof developmentLiveReload !== 'boolean') {
        throw new LayerCliError('CLI_CONFIG_INVALID', 'development host, port, or HTTPS setting is invalid.');

    }

    let developmentHttpsData = /** @type {false | Readonly<{keyFile: string, certificateFile: string}>} */ (false);

    if (developmentHttps !== false) {
        if (!plainObjectCheck(developmentHttps) || Object.keys(developmentHttps).some(function developmentHttpsFieldFind(fieldName) {
            //Rejecting unknown TLS fields before reading any local certificate file.
            return !['certificateFile', 'keyFile'].includes(fieldName);

        })) {
            throw new LayerCliError('CLI_CONFIG_INVALID', 'development HTTPS requires keyFile and certificateFile.');

        }

        const keyFile = relativeDirectoryNormalize(developmentHttps.keyFile, 'development.https.keyFile');
        const certificateFile = relativeDirectoryNormalize(developmentHttps.certificateFile, 'development.https.certificateFile');

        if (keyFile === certificateFile) {
            throw new LayerCliError('CLI_CONFIG_INVALID', 'Development HTTPS key and certificate files must be different.');

        }

        developmentHttpsData = Object.freeze({
            keyFile,
            certificateFile
        });

    }

    //Creating the headless Auth configuration before infrastructure and runtime settings
    let authConfiguration = /** @type {null | Readonly<Record<string, any>>} */ (null);

    try {
        if ( configData.auth !== null && configData.auth !== undefined ){
            authConfiguration = layerAuthConfigurationCreate(
                /** @type {Readonly<Record<string, unknown>>} */ (configData.auth)
            );

        }

    } catch( authConfigurationError ){
        if ( authConfigurationError instanceof LayerAuthError ){
            throw new LayerCliError(
                String( 'CLI_CONFIG_INVALID' ),
                String( authConfigurationError.message ),
                authConfigurationError.details
            );

        }

        throw authConfigurationError;

    }

    //Creating the portable production bundle and server infrastructure configuration
    const deploymentConfiguration = deploymentConfigurationCreate( configData.deployment );
    let notificationsConfiguration;

    //Validating server-only push settings with source-addressable safe diagnostics
    try {
        notificationsConfiguration = layerNotificationsConfigurationCreate( configData.notifications );

        if ( notificationsConfiguration !== null && deploymentConfiguration.serverEntry === null ){
            throw new LayerCliError( 'CLI_CONFIG_INVALID', 'notifications requires deployment.serverEntry.', {path: 'deployment.serverEntry'} );

        }

    } catch( error ){
        if ( error instanceof LayerError ){
            throw new LayerCliError( 'CLI_CONFIG_INVALID', error.message, error.details );

        }

        throw error;

    }
    const databaseConfiguration = layerDatabaseConfigurationCreate( configData.database );
    const redisConfiguration = layerRedisConfigurationCreate( configData.redis );
    const runtimeConfiguration = layerRuntimeConfigurationCreate( configData.runtime, databaseConfiguration );

    //Creating additive browser resource permissions after the strict subsystem validation
    const securityConfiguration = layerSecurityConfigurationCreate( configData.security );
    /** @type {import('@solcorp/layer-pwa').LayerLinksConfiguration} */
    let linksConfiguration;
    let updatesConfiguration;
    try {
        //Validating development origins; production build repeats the stricter boundary
        linksConfiguration = layerLinksConfigurationCreate(configData.links, {development: true});
        updatesConfiguration = layerUpdatesConfigurationCreate(configData.updates);

    } catch (linksError) {
        //Translating shared PWA errors into source-addressable CLI diagnostics
        if (linksError instanceof LayerPwaError) {
            throw new LayerCliError('CLI_CONFIG_INVALID', linksError.message, linksError.details);

        }
        throw linksError;

    }
    let effectiveSecurity = securityConfiguration;
    if (linksConfiguration.external.allowedOrigins.length > 0) {
        //Adding only iframe permissions; unrelated resource directives stay unchanged
        effectiveSecurity = layerSecurityConfigurationCreate({
            ...securityConfiguration,
            csp: {sources: {
                ...securityConfiguration.csp.sources,
                'frame-src': [...new Set([
                    ...(securityConfiguration.csp.sources['frame-src'] ?? []),
                    ...linksConfiguration.external.allowedOrigins
                ])]
            }}
        });

    }

    return Object.freeze({
        appName,
        appVersion,
        css: layerCssConfigurationCreate(configData.css),
        auth: authConfiguration,
        notifications: notificationsConfiguration,
        sourceDirectory,
        publicDirectory,
        outputDirectory,
        deployment: deploymentConfiguration,
        database: databaseConfiguration,
        redis: redisConfiguration,
        runtime: runtimeConfiguration,
        security: effectiveSecurity,
        links: linksConfiguration,
        updates: updatesConfiguration,
        development: Object.freeze({
            host: String(developmentHost),
            port: Number(developmentPort),
            https: developmentHttpsData,
            liveReload: Boolean(developmentLiveReload)
        })
    });

}

/**
 * @param {ReturnType<typeof layerConfigValidate>} configData
 */
export function layerConfigPublicCreate( configData ){
    //Redacting infrastructure credentials before diagnostics or inspect output
    const publicInfrastructureData = layerInfrastructureConfigurationRedact(
        configData.database,
        configData.redis
    );
    let publicNotificationsData = /** @type {{webPush: {enabled: boolean}} | null} */ (null);

    if ( configData.notifications !== null ){
        publicNotificationsData = {webPush: {enabled: true}};

    }

    //CallBack THE OBJECT
    return Object.freeze({
        ...configData,
        auth: layerAuthConfigurationRedact( configData.auth ),
        notifications: publicNotificationsData,
        database: publicInfrastructureData.database,
        redis: publicInfrastructureData.redis
    });

}

/**
 * @param {string} rootDirectory
 */
export async function layerConfigLoad(rootDirectory) {
    const configurationPath = path.join(rootDirectory, 'layer.config.js');
    let configurationProgramData = /** @type {any} */ (null);

    try {
        //Reading the configuration once for syntax diagnostics and the following ESM import
        const configurationSourceData = await readFile( configurationPath, 'utf8' );

        //Parsing source positions without executing project code
        configurationProgramData = parse( configurationSourceData, {
            ecmaVersion: 'latest',
            sourceType: 'module',
            locations: true
        });

        //Loading trusted project configuration as an ESM module.
        const configurationModule = await import(`${pathToFileURL(configurationPath).href}?layer=${Date.now()}`);

        return layerConfigValidate(configurationModule.default);

    } catch (configurationError) {
        if (configurationError instanceof LayerCliError) {
            //Passing an expected validation failure with its safe file, field, and repair context
            throw configurationErrorEnrich( configurationError, configurationProgramData );

        }

        //Converting a JavaScript syntax location into a bounded configuration diagnostic
        if (
            configurationError instanceof SyntaxError &&
            typeof /** @type {any} */ (configurationError).loc?.line === String( 'number' )
        ){
            throw new LayerCliError(
                String( 'CLI_CONFIG_LOAD_FAILED' ),
                String( 'layer.config.js contains invalid JavaScript syntax.' ),
                Object.freeze({
                    file: String( 'layer.config.js' ),
                    line: Number( /** @type {any} */ (configurationError).loc.line ),
                    column: Number( /** @type {any} */ (configurationError).loc.column ) + Number( 1 ),
                    suggestions: Object.freeze([
                        String( 'Correct the JavaScript syntax near this position and run the command again.' )
                    ]),
                    documentation: String( 'docs/ru/reference.md' )
                })
            );

        }

        throw new LayerCliError('CLI_CONFIG_LOAD_FAILED', 'layer.config.js could not be loaded.', {
            file: String( 'layer.config.js' ),
            suggestions: Object.freeze([
                String( 'Confirm that layer.config.js exists, exports one default object, and imports only available modules.' )
            ]),
            documentation: String( 'docs/ru/reference.md' )
        });

    }

}
