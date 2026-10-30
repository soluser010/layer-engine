import path from 'node:path';
import {isIP} from 'node:net';
import {LayerCliError} from './cli-error.js';

const environmentVariablePattern = /^[A-Z][A-Z0-9_]{1,127}$/;
const infrastructureNamePattern = /^[a-z][a-z0-9-]{0,79}$/;
const hostNamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * @typedef {string | Readonly<{env: string}>} LayerSecretConfiguration
 * @typedef {Readonly<{
 *     mode: 'disable' | 'require' | 'verify-full',
 *     serverName: string | null,
 *     caFile: string | null
 * }>} LayerTlsConfiguration
 * @typedef {Readonly<{
 *     name: string,
 *     role: 'primary' | 'replica',
 *     host: string,
 *     port: number,
 *     database: string,
 *     username: string,
 *     password: LayerSecretConfiguration | null,
 *     tls: LayerTlsConfiguration
 * }>} LayerPostgresConnectionConfiguration
 * @typedef {Readonly<{
 *     embedded: Readonly<{dataDirectory: string | null}>,
 *     postgres: readonly LayerPostgresConnectionConfiguration[],
 *     schema: Readonly<{file: string, synchronization: 'additive'}>,
 *     replica: Readonly<{maximumLagMs: number}>,
 *     pool: Readonly<{maximumConnectionsPerWorker: number, connectionBudget: number | null}>
 * }>} LayerDatabaseConfiguration
 * @typedef {Readonly<{
 *     host: string,
 *     port: number,
 *     username: string | null,
 *     password: LayerSecretConfiguration | null,
 *     database: number,
 *     tls: LayerTlsConfiguration
 * }>} LayerRedisConfiguration
 * @typedef {Readonly<{
 *     workers: Readonly<{minimum: number, maximum: number | 'auto'}>
 * }>} LayerRuntimeConfiguration
 */

/**
 * @param {unknown} valueData
 * @returns {valueData is Record<string, unknown>}
 */
function plainObjectCheck( valueData ){
    //Checking configuration records without accepting arrays or null
    return typeof valueData === 'object' && valueData !== null && Array.isArray( valueData ) === false;

}

/**
 * @param {Record<string, unknown>} objectData
 * @param {readonly string[]} fieldsData
 * @param {string} subjectData
 */
function unknownFieldsAssert( objectData, fieldsData, subjectData ){
    //Getting fields outside the declared infrastructure contract
    const unknownFieldsData = Object.keys( objectData ).filter(function infrastructureUnknownFieldFind( fieldNameData ){
        //Checking the current field against the supported configuration fields
        return fieldsData.includes( fieldNameData ) === false;

    });

    //Checking unknown fields before normalizing configuration values
    if ( Number( unknownFieldsData.length ) > Number( 0 ) ){
        //Passing the invalid infrastructure configuration to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', `${String( subjectData )} contains unknown fields.`, {
            fields: unknownFieldsData
        });

    }

}

/**
 * @param {unknown} valueData
 * @param {string} fieldNameData
 * @param {number} minimumData
 * @param {number} maximumData
 * @returns {number}
 */
function boundedIntegerNormalize( valueData, fieldNameData, minimumData, maximumData ){
    //Checking the bounded integer before it can control a network or runtime resource
    if (
        Number.isInteger( valueData ) === false ||
        Number( valueData ) < Number( minimumData ) ||
        Number( valueData ) > Number( maximumData )
    ){
        //Passing the invalid bounded integer to the CLI boundary
        throw new LayerCliError(
            'CLI_CONFIG_INVALID',
            `${String( fieldNameData )} must be between ${Number( minimumData )} and ${Number( maximumData )}.`
        );

    }

    //CallBack THE NUMBER
    return Number( valueData );

}

/**
 * @param {unknown} valueData
 * @param {string} fieldNameData
 * @returns {string}
 */
function relativeFileNormalize( valueData, fieldNameData ){
    //Checking a project-owned file before resolving it during build or startup
    if (
        typeof valueData !== 'string' ||
        Number( valueData.length ) < Number( 1 ) ||
        Number( valueData.length ) > Number( 240 ) ||
        path.isAbsolute( valueData ) === true ||
        valueData.includes( '\0' ) === true
    ){
        //Passing the unsafe file location to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', `${String( fieldNameData )} must be a project-relative file.` );

    }

    //Getting one portable file representation before traversal checks
    const normalizedFileData = String( valueData ).replaceAll( '\\', '/' ).replace(/^\.\//, '');

    //Checking the normalized path remains inside the project
    if (
        normalizedFileData.length === 0 ||
        normalizedFileData.split( '/' ).includes( '..' ) === true
    ){
        //Passing the traversing file location to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', `${String( fieldNameData )} must stay inside the project.` );

    }

    //CallBack THE STRING
    return normalizedFileData;

}

/**
 * @param {unknown} secretInputData
 * @param {string} fieldNameData
 * @returns {string | Readonly<{env: string}> | null}
 */
function secretConfigurationCreate( secretInputData, fieldNameData ){
    //Allowing an omitted Redis password while requiring PostgreSQL callers to check their own contract
    if ( secretInputData === null || secretInputData === undefined ){
        //CallBack THE OBJECT
        return null;

    }

    //Allowing literal secrets for local development without transforming their value
    if ( typeof secretInputData === 'string' ){
        //Checking an empty literal before recording it in trusted configuration
        if ( Number( secretInputData.length ) < Number( 1 ) || Number( secretInputData.length ) > Number( 4096 ) ){
            //Passing the invalid secret to the CLI boundary
            throw new LayerCliError( 'CLI_CONFIG_INVALID', `${String( fieldNameData )} is invalid.` );

        }

        //CallBack THE STRING
        return secretInputData;

    }

    //Checking the declarative environment reference before reading its name
    if ( plainObjectCheck( secretInputData ) === false ){
        //Passing the invalid secret reference to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', `${String( fieldNameData )} must be a string or ENV reference.` );

    }

    unknownFieldsAssert( secretInputData, ['env'], fieldNameData );

    //Checking the environment variable identifier without reading the secret itself
    if ( typeof secretInputData.env !== 'string' || environmentVariablePattern.test( secretInputData.env ) === false ){
        //Passing the invalid secret reference to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', `${String( fieldNameData )}.env is invalid.` );

    }

    //CallBack THE OBJECT
    return Object.freeze({
        env: String( secretInputData.env )
    });

}

/**
 * @param {unknown} hostInputData
 * @param {string} fieldNameData
 * @returns {string}
 */
function hostNormalize( hostInputData, fieldNameData ){
    //Checking the host string boundary before classifying its network form
    if (
        typeof hostInputData !== 'string' ||
        Number( hostInputData.length ) < Number( 1 ) ||
        Number( hostInputData.length ) > Number( 253 )
    ){
        //Passing the invalid host to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', `${String( fieldNameData )} is invalid.` );

    }

    //Getting a normalized IPv6 candidate without URL-style brackets
    let normalizedHostData = String( hostInputData ).toLowerCase();

    if ( normalizedHostData.startsWith( '[' ) === true && normalizedHostData.endsWith( ']' ) === true ){
        normalizedHostData = normalizedHostData.slice( 1, -1 );

    }

    const ipVersionData = Number( isIP( normalizedHostData ) );
    const numericHostStatusData = /^[0-9.]+$/.test( normalizedHostData );

    //Checking hostnames separately so malformed numeric IPv4 text cannot pass as DNS
    if (
        ipVersionData === Number( 0 ) &&
        (numericHostStatusData === true || hostNamePattern.test( normalizedHostData ) === false)
    ){
        //Passing the malformed IP address or hostname to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', `${String( fieldNameData )} is invalid.` );

    }

    //CallBack THE STRING
    return normalizedHostData;

}

/**
 * @param {string} hostData
 * @returns {boolean}
 */
function loopbackHostCheck( hostData ){
    //Checking the supported loopback host forms used by development services
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes( String( hostData ).toLowerCase() );

}

/**
 * @param {unknown} tlsInputData
 * @param {string} hostData
 * @param {string} fieldNameData
 * @returns {LayerTlsConfiguration}
 */
function tlsConfigurationCreate( tlsInputData, hostData, fieldNameData ){
    //Creating a secure default for remote services and a local default for loopback development
    let defaultModeData = /** @type {'disable' | 'verify-full'} */ ('verify-full');

    if ( loopbackHostCheck( hostData ) === true ){
        defaultModeData = 'disable';

    }

    const tlsData = tlsInputData ?? {
        mode: defaultModeData
    };

    //Checking the TLS record before reading certificate options
    if ( plainObjectCheck( tlsData ) === false ){
        //Passing the invalid TLS configuration to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', `${String( fieldNameData )} must be an object.` );

    }

    unknownFieldsAssert( tlsData, ['caFile', 'mode', 'serverName'], fieldNameData );

    //Getting the declared TLS mode and optional verification values
    const modeData = tlsData.mode ?? defaultModeData;
    const serverNameInputData = tlsData.serverName ?? null;
    const caFileInputData = tlsData.caFile ?? null;

    //Checking the TLS mode and refusing plaintext connections to remote infrastructure
    if (
        ['disable', 'require', 'verify-full'].includes( String( modeData ) ) === false ||
        (String( modeData ) === String( 'disable' ) && loopbackHostCheck( hostData ) === false)
    ){
        //Passing the insecure TLS configuration to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', `${String( fieldNameData )}.mode is invalid for this host.` );

    }

    let serverNameData = null;
    let caFileData = null;

    //Normalizing the optional TLS server name used for certificate verification
    if ( serverNameInputData !== null ){
        serverNameData = hostNormalize( serverNameInputData, `${String( fieldNameData )}.serverName` );

    }

    //Normalizing the optional private certificate authority file
    if ( caFileInputData !== null ){
        caFileData = relativeFileNormalize( caFileInputData, `${String( fieldNameData )}.caFile` );

    }

    //CallBack THE OBJECT
    return Object.freeze({
        mode: /** @type {'disable' | 'require' | 'verify-full'} */ (modeData),
        serverName: serverNameData,
        caFile: caFileData
    });

}

/**
 * @param {unknown} databaseInputData
 * @returns {LayerDatabaseConfiguration}
 */
export function layerDatabaseConfigurationCreate( databaseInputData ){
    //Getting the complete default database configuration for a new or existing application
    const databaseData = databaseInputData ?? {};

    //Checking the database record before normalizing nested contracts
    if ( plainObjectCheck( databaseData ) === false ){
        //Passing the invalid database configuration to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'database configuration must be an object.' );

    }

    unknownFieldsAssert( databaseData, ['embedded', 'pool', 'postgres', 'replica', 'schema'], 'database configuration' );

    //Getting and checking the embedded system storage configuration
    const embeddedInputData = databaseData.embedded ?? {};

    if ( plainObjectCheck( embeddedInputData ) === false ){
        //Passing the invalid embedded configuration to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'database.embedded must be an object.' );

    }

    unknownFieldsAssert( embeddedInputData, ['dataDirectory'], 'database.embedded' );

    const embeddedDirectoryInputData = embeddedInputData.dataDirectory ?? null;
    let embeddedDirectoryData = null;

    //Normalizing an explicitly project-relative development data directory
    if ( embeddedDirectoryInputData !== null ){
        embeddedDirectoryData = relativeFileNormalize( embeddedDirectoryInputData, 'database.embedded.dataDirectory' );

    }

    //Getting and checking PostgreSQL connection records
    const postgresInputData = databaseData.postgres ?? [];

    if ( Array.isArray( postgresInputData ) === false ){
        //Passing the invalid PostgreSQL collection to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'database.postgres must be an array.' );

    }

    const postgresNamesData = new Set();
    const postgresConnectionsData = [];
    let primaryCountData = Number( 0 );

    //Normalizing every connection in the one logical PostgreSQL cluster
    for ( const [connectionIndexData, connectionInputData] of postgresInputData.entries() ){
        if ( plainObjectCheck( connectionInputData ) === false ){
            //Passing the invalid connection record to the CLI boundary
            throw new LayerCliError( 'CLI_CONFIG_INVALID', `database.postgres[${Number( connectionIndexData )}] must be an object.` );

        }

        unknownFieldsAssert(
            connectionInputData,
            ['database', 'host', 'name', 'password', 'port', 'role', 'tls', 'username'],
            `database.postgres[${Number( connectionIndexData )}]`
        );

        //Getting the connection identity and endpoint fields
        const connectionNameData = connectionInputData.name;
        const connectionRoleData = connectionInputData.role;
        const connectionHostData = hostNormalize(
            connectionInputData.host,
            `database.postgres[${Number( connectionIndexData )}].host`
        );

        //Checking the stable connection identity and role before registering it
        if (
            typeof connectionNameData !== 'string' ||
            infrastructureNamePattern.test( connectionNameData ) === false ||
            postgresNamesData.has( connectionNameData ) === true
        ){
            //Passing duplicate or malformed connection metadata to the CLI boundary
            throw new LayerCliError( 'CLI_CONFIG_INVALID', 'Every PostgreSQL connection requires a unique safe name.' );

        }

        if ( ['primary', 'replica'].includes( String( connectionRoleData ) ) === false ){
            //Passing the unsupported database role to the CLI boundary
            throw new LayerCliError( 'CLI_CONFIG_INVALID', 'PostgreSQL role must be primary or replica.' );

        }

        //Counting the writable server before validating the complete topology
        if ( String( connectionRoleData ) === String( 'primary' ) ){
            primaryCountData += Number( 1 );

        }

        //Checking database and account identifiers before creating connection options
        if (
            typeof connectionInputData.database !== 'string' ||
            /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test( connectionInputData.database ) === false ||
            typeof connectionInputData.username !== 'string' ||
            /^[A-Za-z_][A-Za-z0-9_.$-]{0,62}$/.test( connectionInputData.username ) === false
        ){
            //Passing unsafe PostgreSQL account metadata to the CLI boundary
            throw new LayerCliError( 'CLI_CONFIG_INVALID', 'PostgreSQL database or username is invalid.' );

        }

        const connectionPasswordData = secretConfigurationCreate(
            connectionInputData.password,
            `database.postgres[${Number( connectionIndexData )}].password`
        );

        //Allowing passwordless PostgreSQL only for a loopback development endpoint
        if ( connectionPasswordData === null && loopbackHostCheck( connectionHostData ) === false ){
            //Passing the unauthenticated remote PostgreSQL endpoint to the CLI boundary
            throw new LayerCliError( 'CLI_CONFIG_INVALID', 'Remote PostgreSQL connections require a password.' );

        }

        postgresNamesData.add( connectionNameData );
        postgresConnectionsData.push( Object.freeze({
            name: String( connectionNameData ),
            role: /** @type {'primary' | 'replica'} */ (connectionRoleData),
            host: connectionHostData,
            port: boundedIntegerNormalize(
                connectionInputData.port,
                `database.postgres[${Number( connectionIndexData )}].port`,
                1,
                65535
            ),
            database: String( connectionInputData.database ),
            username: String( connectionInputData.username ),
            password: connectionPasswordData,
            tls: tlsConfigurationCreate(
                connectionInputData.tls,
                connectionHostData,
                `database.postgres[${Number( connectionIndexData )}].tls`
            )
        }) );

    }

    //Checking the external cluster has one and only one writable server
    if ( Number( postgresConnectionsData.length ) > Number( 0 ) && Number( primaryCountData ) !== Number( 1 ) ){
        //Passing the invalid cluster topology to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'database.postgres requires exactly one primary.' );

    }

    //Getting and checking the declarative application schema configuration
    const schemaInputData = databaseData.schema ?? {};

    if ( plainObjectCheck( schemaInputData ) === false ){
        //Passing the invalid schema configuration to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'database.schema must be an object.' );

    }

    unknownFieldsAssert( schemaInputData, ['file', 'synchronization'], 'database.schema' );

    const schemaFileData = relativeFileNormalize(
        schemaInputData.file ?? 'src/server/database.js',
        'database.schema.file'
    );
    const synchronizationData = schemaInputData.synchronization ?? 'additive';

    //Checking the only safe automatic schema synchronization strategy
    if ( String( synchronizationData ) !== String( 'additive' ) ){
        //Passing the unsafe synchronization strategy to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'database.schema.synchronization must be additive.' );

    }

    //Getting and checking replica health policy
    const replicaInputData = databaseData.replica ?? {};

    if ( plainObjectCheck( replicaInputData ) === false ){
        //Passing the invalid replica configuration to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'database.replica must be an object.' );

    }

    unknownFieldsAssert( replicaInputData, ['maximumLagMs'], 'database.replica' );

    //Getting and checking the shared connection budget
    const poolInputData = databaseData.pool ?? {};

    if ( plainObjectCheck( poolInputData ) === false ){
        //Passing the invalid pool configuration to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'database.pool must be an object.' );

    }

    unknownFieldsAssert( poolInputData, ['connectionBudget', 'maximumConnectionsPerWorker'], 'database.pool' );

    const maximumConnectionsPerWorkerData = boundedIntegerNormalize(
        poolInputData.maximumConnectionsPerWorker ?? 5,
        'database.pool.maximumConnectionsPerWorker',
        1,
        100
    );
    const connectionBudgetInputData = poolInputData.connectionBudget ?? null;
    let connectionBudgetData = null;

    //Normalizing the optional total connection budget used by automatic workers
    if ( connectionBudgetInputData !== null ){
        connectionBudgetData = boundedIntegerNormalize(
            connectionBudgetInputData,
            'database.pool.connectionBudget',
            maximumConnectionsPerWorkerData,
            10000
        );

    }

    //CallBack THE OBJECT
    return Object.freeze({
        embedded: Object.freeze({
            dataDirectory: embeddedDirectoryData
        }),
        postgres: Object.freeze( postgresConnectionsData ),
        schema: Object.freeze({
            file: schemaFileData,
            synchronization: /** @type {'additive'} */ (synchronizationData)
        }),
        replica: Object.freeze({
            maximumLagMs: boundedIntegerNormalize(
                replicaInputData.maximumLagMs ?? 2000,
                'database.replica.maximumLagMs',
                0,
                600000
            )
        }),
        pool: Object.freeze({
            maximumConnectionsPerWorker: maximumConnectionsPerWorkerData,
            connectionBudget: connectionBudgetData
        })
    });

}

/**
 * @param {unknown} redisInputData
 * @returns {LayerRedisConfiguration | null}
 */
export function layerRedisConfigurationCreate( redisInputData ){
    //Keeping Redis optional because PostgreSQL remains the source of truth and fallback
    if ( redisInputData === null || redisInputData === undefined ){
        //CallBack THE OBJECT
        return null;

    }

    //Checking the Redis record before normalizing its network settings
    if ( plainObjectCheck( redisInputData ) === false ){
        //Passing the invalid Redis configuration to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'redis configuration must be an object or null.' );

    }

    unknownFieldsAssert( redisInputData, ['database', 'host', 'password', 'port', 'tls', 'username'], 'redis configuration' );

    //Getting the remote endpoint before selecting secure defaults
    const redisHostData = hostNormalize( redisInputData.host, 'redis.host' );
    const redisUsernameInputData = redisInputData.username ?? null;

    //Checking the optional ACL username before passing it to the Redis client
    if (
        redisUsernameInputData !== null &&
        (typeof redisUsernameInputData !== 'string' || Number( redisUsernameInputData.length ) < Number( 1 ) || Number( redisUsernameInputData.length ) > Number( 128 ))
    ){
        //Passing the invalid Redis account to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'redis.username is invalid.' );

    }

    let redisUsernameData = null;

    //Copying the optional Redis ACL identity without stringifying null
    if ( redisUsernameInputData !== null ){
        redisUsernameData = String( redisUsernameInputData );

    }

    //CallBack THE OBJECT
    return Object.freeze({
        host: redisHostData,
        port: boundedIntegerNormalize( redisInputData.port, 'redis.port', 1, 65535 ),
        username: redisUsernameData,
        password: secretConfigurationCreate( redisInputData.password, 'redis.password' ),
        database: boundedIntegerNormalize( redisInputData.database ?? 0, 'redis.database', 0, 15 ),
        tls: tlsConfigurationCreate( redisInputData.tls, redisHostData, 'redis.tls' )
    });

}

/**
 * @param {unknown} runtimeInputData
 * @param {LayerDatabaseConfiguration} databaseConfigurationData
 * @returns {LayerRuntimeConfiguration}
 */
export function layerRuntimeConfigurationCreate( runtimeInputData, databaseConfigurationData ){
    //Getting the default single-worker runtime before validating optional scaling
    const runtimeData = runtimeInputData ?? {};

    if ( plainObjectCheck( runtimeData ) === false ){
        //Passing the invalid runtime configuration to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'runtime configuration must be an object.' );

    }

    unknownFieldsAssert( runtimeData, ['workers'], 'runtime configuration' );

    //Getting and checking the worker range
    const workersInputData = runtimeData.workers ?? {};

    if ( plainObjectCheck( workersInputData ) === false ){
        //Passing the invalid worker configuration to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'runtime.workers must be an object.' );

    }

    unknownFieldsAssert( workersInputData, ['maximum', 'minimum'], 'runtime.workers' );

    const minimumWorkersData = boundedIntegerNormalize(
        workersInputData.minimum ?? 1,
        'runtime.workers.minimum',
        1,
        256
    );
    const maximumWorkersInputData = workersInputData.maximum ?? 1;
    /** @type {number | 'auto'} */
    let maximumWorkersData;

    //Normalizing a fixed maximum or the resource-aware automatic worker mode
    if ( String( maximumWorkersInputData ) === String( 'auto' ) ){
        maximumWorkersData = 'auto';

    } else {
        maximumWorkersData = boundedIntegerNormalize(
            maximumWorkersInputData,
            'runtime.workers.maximum',
            1,
            256
        );

    }

    const postgresConnectionsData = /** @type {readonly unknown[]} */ (databaseConfigurationData.postgres);
    const poolConfigurationData = /** @type {Readonly<{connectionBudget: number | null}>} */ (databaseConfigurationData.pool);

    //Preventing multiple processes from opening the single-user embedded database
    if (
        Number( postgresConnectionsData.length ) === Number( 0 ) &&
        (Number( minimumWorkersData ) > Number( 1 ) || maximumWorkersData === 'auto' || Number( maximumWorkersData ) > Number( 1 ))
    ){
        //Passing the unsupported embedded cluster request to the CLI boundary
        throw new LayerCliError( 'DATABASE_CLUSTER_REQUIRED', 'Multiple workers require an external PostgreSQL primary.' );

    }

    //Checking a fixed worker range before using it for process supervision
    if ( maximumWorkersData !== 'auto' && Number( minimumWorkersData ) > Number( maximumWorkersData ) ){
        //Passing the inverted worker range to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'runtime.workers.minimum cannot exceed maximum.' );

    }

    //Requiring an explicit connection budget before calculating an automatic worker maximum
    if ( maximumWorkersData === 'auto' && poolConfigurationData.connectionBudget === null ){
        //Passing the incomplete automatic scaling contract to the CLI boundary
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'runtime.workers.maximum auto requires database.pool.connectionBudget.' );

    }

    //CallBack THE OBJECT
    return Object.freeze({
        workers: Object.freeze({
            minimum: minimumWorkersData,
            maximum: maximumWorkersData
        })
    });

}

/**
 * @param {LayerDatabaseConfiguration} databaseConfigurationData
 * @param {LayerRedisConfiguration | null} redisConfigurationData
 */
export function layerProductionSecretsAssert( databaseConfigurationData, redisConfigurationData ){
    const postgresConnectionsData = /** @type {readonly Readonly<Record<string, unknown>>[]} */ (databaseConfigurationData.postgres);

    //Checking every production PostgreSQL password uses an environment reference
    for ( const connectionData of postgresConnectionsData ){
        //Checking passwordless production connections remain constrained to loopback
        if (
            connectionData.password === null &&
            typeof connectionData.host === 'string' &&
            loopbackHostCheck( connectionData.host ) === false
        ){
            //Passing the unauthenticated remote PostgreSQL endpoint to the CLI boundary
            throw new LayerCliError(
                'CLI_PRODUCTION_SECRET_REQUIRED',
                `PostgreSQL connection ${String( connectionData.name )} requires a password ENV reference.`
            );

        }

        if ( typeof connectionData.password === 'string' ){
            //Passing the literal production secret to the CLI boundary without exposing it
            throw new LayerCliError(
                'CLI_PRODUCTION_SECRET_LITERAL',
                `PostgreSQL connection ${String( connectionData.name )} must use a password ENV reference.`
            );

        }

    }

    //Checking the optional Redis password uses an environment reference in production
    if ( redisConfigurationData !== null && typeof redisConfigurationData.password === 'string' ){
        //Passing the literal production secret to the CLI boundary without exposing it
        throw new LayerCliError( 'CLI_PRODUCTION_SECRET_LITERAL', 'Redis must use a password ENV reference.' );

    }

}

/**
 * @param {unknown} secretConfigurationData
 * @returns {string | Readonly<{env: string}> | null}
 */
function secretConfigurationRedact( secretConfigurationData ){
    //Keeping absence explicit without creating a placeholder secret
    if ( secretConfigurationData === null || secretConfigurationData === undefined ){
        //CallBack THE OBJECT
        return null;

    }

    //Keeping an environment variable name because it does not contain the secret value
    if (
        plainObjectCheck( secretConfigurationData ) === true &&
        typeof secretConfigurationData.env === 'string'
    ){
        //CallBack THE OBJECT
        return Object.freeze({
            env: String( secretConfigurationData.env )
        });

    }

    //Replacing every literal or malformed secret before diagnostics serialization
    return String( '[REDACTED]' );

}

/**
 * @param {LayerDatabaseConfiguration} databaseConfigurationData
 * @param {LayerRedisConfiguration | null} redisConfigurationData
 * @returns {Readonly<{database: LayerDatabaseConfiguration, redis: LayerRedisConfiguration | null}>}
 */
export function layerInfrastructureConfigurationRedact( databaseConfigurationData, redisConfigurationData ){
    const postgresConnectionsData = databaseConfigurationData.postgres;
    const publicPostgresConnectionsData = [];

    //Copying PostgreSQL diagnostics without literal passwords
    for ( const connectionData of postgresConnectionsData ){
        const publicPasswordData = secretConfigurationRedact( connectionData.password );

        //Keeping an allowed passwordless loopback connection explicit in diagnostics
        if ( publicPasswordData === null ){
            publicPostgresConnectionsData.push( Object.freeze({
                ...connectionData,
                password: null
            }) );

            //Next the cycle
            continue;

        }

        publicPostgresConnectionsData.push( Object.freeze({
            ...connectionData,
            password: publicPasswordData
        }) );

    }

    const publicDatabaseConfigurationData = Object.freeze({
        ...databaseConfigurationData,
        postgres: Object.freeze( publicPostgresConnectionsData )
    });
    let publicRedisConfigurationData = null;

    //Copying optional Redis diagnostics without its literal password
    if ( redisConfigurationData !== null ){
        publicRedisConfigurationData = Object.freeze({
            ...redisConfigurationData,
            password: secretConfigurationRedact( redisConfigurationData.password )
        });

    }

    //CallBack THE OBJECT
    return Object.freeze({
        database: publicDatabaseConfigurationData,
        redis: publicRedisConfigurationData
    });

}
