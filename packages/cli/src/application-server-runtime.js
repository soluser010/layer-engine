import {
    createHash,
    randomBytes,
    randomUUID
} from 'node:crypto';
import {
    mkdir,
    readFile,
    stat,
    writeFile
} from 'node:fs/promises';
import path from 'node:path';
import {layerNotificationsRuntimeCreate} from '@solcorp/layer-notifications';
import {
    layerAuthMailDeliveryCreate,
    layerAuthMailQueueCreate,
    layerAuthOidcAdapterFactoryCreate,
    layerAuthOAuthSigningJwksCreate,
    layerAuthSecretEnvelopeCreate,
    layerAuthServerRuntimeCreate
} from '@solcorp/layer-auth/server';
import {
    layerApiKeyRepositoryCreate,
    layerAuditRepositoryCreate,
    layerAuthChallengeRepositoryCreate,
    layerAuthExternalIdentityRepositoryCreate,
    layerAuthInvitationRepositoryCreate,
    layerAuthMailRepositoryCreate,
    layerAuthPasskeyRepositoryCreate,
    layerAuthSessionRepositoryCreate,
    layerAuthRoleRepositoryCreate,
    layerAuthTotpRepositoryCreate,
    layerAuthUserRepositoryCreate,
    layerCacheInvalidationRepositoryCreate,
    layerDatabaseLeaseManagerCreate,
    layerDatabaseRateLimiterCreate,
    layerDatabaseFacadeCreate,
    layerDatabaseSchemaDefine,
    layerDatabaseLegacyMigrate,
    layerDatabaseMigrate,
    layerDatabaseSchemaSynchronize,
    layerPgliteDatabaseCreate,
    layerPostgresClusterCreate,
    layerSystemSchemaNameCreate
} from '@solcorp/layer-database';
import {
    layerCacheInvalidationSynchronizerCreate,
    layerDatabaseEventBusCreate,
    layerHybridEventBusCreate,
    layerRedisCoordinationCreate,
    layerRedisEventBusCreate,
    layerRedisQueryCacheCreate
} from '@solcorp/layer-events';
import {
    layerIdentityCacheCreate,
    layerRateLimiterFailoverCreate,
    layerRedisRateLimiterCreate
} from '@solcorp/layer-security';

const certificateMaximumBytes = Number( 1024 * 1024 );
const redisReconnectAttempts = Number( 3 );

/** @param {string} applicationNameData */
function rateLimitKeyPrefixCreate( applicationNameData ){
    const applicationIdentityData = createHash( 'sha256' )
        .update( applicationNameData, 'utf8' )
        .digest( 'hex' )
        .slice( Number( 0 ), Number( 24 ) );

    return `layer:${String( applicationIdentityData )}:rate`;

}

/** @param {string} applicationNameData */
function queryCacheNamespaceCreate( applicationNameData ){
    const applicationIdentityData = createHash( 'sha256' )
        .update( applicationNameData, 'utf8' )
        .digest( 'hex' )
        .slice( Number( 0 ), Number( 24 ) );

    return `layer:${String( applicationIdentityData )}:cache`;

}

/** @param {string} applicationNameData */
function coordinationNamespaceCreate( applicationNameData ){
    const applicationIdentityData = createHash( 'sha256' )
        .update( applicationNameData, 'utf8' )
        .digest( 'hex' )
        .slice( Number( 0 ), Number( 24 ) );

    return `layer:${String( applicationIdentityData )}:coordination`;

}

/**
 * @typedef {Readonly<{
 *     kind: 'embedded' | 'postgres',
 *     systemSchema: string,
 *     connect: () => Promise<void>,
 *     query: (queryData: {text: string, values: readonly unknown[], consistency?: 'strong' | 'eventual'}) => Promise<{rows: Record<string, unknown>[], rowCount: number | null}>,
 *     transaction: <ResultData>(handlerData: (transactionData: any) => Promise<ResultData>) => Promise<ResultData>,
 *     healthCheck: () => Promise<boolean>,
 *     close: () => Promise<void>,
 *     isReady: () => boolean
 * }>} LayerInfrastructureDatabase
 */

/**
 * @typedef {Readonly<{
 *     start: (listenOptionsData: {host: string, port: number}) => Promise<void>,
 *     stop: (shutdownOptionsData?: {deadlineMs?: number}) => Promise<void>,
 *     isReady: () => boolean
 * }>} LayerApplicationServerRuntime
 */

/**
 * @param {string | Readonly<{env: string}> | null} secretConfigurationData
 * @param {Record<string, string | undefined>} environmentData
 * @returns {string | undefined}
 */
function secretValueRead( secretConfigurationData, environmentData ){
    //Passing an explicitly passwordless loopback connection to the driver
    if ( secretConfigurationData === null ){
        //CallBack THE UNDEFINED
        return undefined;

    }

    //Returning a development-only literal without transforming its secret value
    if ( typeof secretConfigurationData === 'string' ){
        return secretConfigurationData;

    }

    const environmentNameData = secretConfigurationData.env;
    const secretValueData = environmentData[environmentNameData];

    //Failing closed when an external dependency secret is unavailable
    if ( typeof secretValueData !== 'string' || Number( secretValueData.length ) < Number( 1 ) ){
        const secretErrorData = new Error( 'A required database secret is unavailable.' );
        Object.defineProperty( secretErrorData, 'code', {
            value: 'DATABASE_SECRET_UNAVAILABLE',
            enumerable: true
        });

        throw secretErrorData;

    }

    return secretValueData;

}

/**
 * @param {Readonly<Record<string, any>>} authConfigurationData
 * @param {string} stateDirectoryData
 * @param {'development' | 'production'} environmentNameData
 * @param {Record<string, string | undefined>} environmentData
 */
//Function for resolving or creating the server-only Auth secret
async function authSecretValueRead( authConfigurationData, stateDirectoryData, environmentNameData, environmentData ){
    const secretConfigurationData = authConfigurationData.secret;
    let authSecretData = /** @type {string | undefined} */ (undefined);

    //Resolving an explicit ENV reference without copying it into diagnostics
    if ( secretConfigurationData !== null ){
        authSecretData = environmentData[secretConfigurationData.env];

    } else if ( environmentNameData === String( 'development' ) ){
        const authStateDirectoryData = path.join( stateDirectoryData, 'auth' );
        const authSecretFileData = path.join( authStateDirectoryData, 'secret' );

        await mkdir( authStateDirectoryData, {recursive: true} );

        try {
            //Reusing the persistent development secret across rebuilds and restarts
            authSecretData = String( await readFile( authSecretFileData, 'utf8' ) ).trim();

        } catch( secretReadErrorData ){
            if ( /** @type {NodeJS.ErrnoException} */ (secretReadErrorData).code !== String( 'ENOENT' ) ){
                throw secretReadErrorData;

            }

            const generatedSecretData = randomBytes( 48 ).toString( 'base64url' );

            try {
                //Claiming the development secret file without overwriting another process
                await writeFile( authSecretFileData, generatedSecretData, {
                    encoding: 'utf8',
                    flag: 'wx',
                    mode: 384
                });
                authSecretData = generatedSecretData;

            } catch( secretCreateErrorData ){
                if ( /** @type {NodeJS.ErrnoException} */ (secretCreateErrorData).code !== String( 'EEXIST' ) ){
                    throw secretCreateErrorData;

                }

                //Loading the secret created concurrently by the first local process
                authSecretData = String( await readFile( authSecretFileData, 'utf8' ) ).trim();

            }

        }

    }

    //Failing closed when production has no ENV secret or state is corrupted
    if ( authSecretData === undefined || Number( authSecretData.length ) < Number( 32 ) ){
        const authSecretErrorData = new Error( 'Layer Auth requires a server secret of at least 32 characters.' );
        Object.defineProperty( authSecretErrorData, 'code', {
            value: 'AUTH_SECRET_UNAVAILABLE',
            enumerable: true
        });

        throw authSecretErrorData;

    }

    //CallBack THE STRING
    return String( authSecretData );

}

/**
 * @param {string} stateDirectoryData
 * @param {{seal: Function, open: Function}} envelopeData
 */
//Function for resolving or creating encrypted persistent OAuth signing keys
async function authOAuthSigningJwksRead( stateDirectoryData, envelopeData ){
    const authStateDirectoryData = path.join( stateDirectoryData, 'auth' );
    const signingKeyFileData = path.join( authStateDirectoryData, 'oauth-signing-jwks' );
    const signingEnvelopePurposeData = String( 'oauth-signing-jwks' );
    /** @type {any} */
    let signingJwksData;

    await mkdir( authStateDirectoryData, {recursive: true} );

    try {
        //Opening the key with the application Auth secret after every restart
        const encryptedSigningJwksData = await readFile( signingKeyFileData );
        signingJwksData = envelopeData.open(
            encryptedSigningJwksData,
            signingEnvelopePurposeData
        );

    } catch( signingKeyReadErrorData ){
        if ( /** @type {NodeJS.ErrnoException} */ (signingKeyReadErrorData).code !== String( 'ENOENT' ) ){
            throw signingKeyReadErrorData;

        }

        const generatedSigningJwksData = await layerAuthOAuthSigningJwksCreate();
        const encryptedSigningJwksData = envelopeData.seal(
            generatedSigningJwksData,
            signingEnvelopePurposeData
        );

        try {
            //Claiming the key file atomically so concurrent workers share one signer
            await writeFile( signingKeyFileData, encryptedSigningJwksData, {
                flag: 'wx',
                mode: 384
            });
            signingJwksData = generatedSigningJwksData;

        } catch( signingKeyCreateErrorData ){
            if ( /** @type {NodeJS.ErrnoException} */ (signingKeyCreateErrorData).code !== String( 'EEXIST' ) ){
                throw signingKeyCreateErrorData;

            }

            //Opening the key created by the first worker without regenerating it
            signingJwksData = envelopeData.open(
                await readFile( signingKeyFileData ),
                signingEnvelopePurposeData
            );

        }

    }

    if (
        signingJwksData === null ||
        typeof signingJwksData !== String( 'object' ) ||
        Array.isArray( signingJwksData.keys ) === false ||
        Number( signingJwksData.keys.length ) < Number( 1 ) ||
        signingJwksData.keys.some(function signingKeyCheck( /** @type {any} */ signingKeyData ){
            return (
                signingKeyData === null ||
                typeof signingKeyData !== String( 'object' ) ||
                typeof signingKeyData.kid !== String( 'string' ) ||
                typeof signingKeyData.d !== String( 'string' ) ||
                signingKeyData.alg !== String( 'ES256' ) ||
                signingKeyData.use !== String( 'sig' )
            );

        }) === true
    ){
        const signingKeyErrorData = new Error( 'Layer Auth OAuth signing keys are invalid.' );
        Object.defineProperty( signingKeyErrorData, 'code', {
            value: 'AUTH_OAUTH_SIGNING_KEY_INVALID',
            enumerable: true
        });

        throw signingKeyErrorData;

    }

    //CallBack THE OBJECT
    return Object.freeze({
        keys: Object.freeze(signingJwksData.keys.map(function signingKeyFreeze( /** @type {any} */ signingKeyData ){
            return Object.freeze({...signingKeyData});

        }))
    });

}

/**
 * @param {string} rootDirectoryData
 * @param {Readonly<{mode: 'disable' | 'require' | 'verify-full', serverName: string | null, caFile: string | null}>} tlsConfigurationData
 */
async function postgresTlsOptionsCreate( rootDirectoryData, tlsConfigurationData ){
    //Returning explicit plaintext only for the validated loopback development contract
    if ( tlsConfigurationData.mode === 'disable' ){
        return false;

    }

    let certificateAuthorityData;

    //Reading a bounded operator-provided certificate authority when configured
    if ( tlsConfigurationData.caFile !== null ){
        const certificateFileData = path.resolve( rootDirectoryData, tlsConfigurationData.caFile );
        const relativeCertificateFileData = path.relative( rootDirectoryData, certificateFileData );

        if (
            relativeCertificateFileData.startsWith( '..' ) === true ||
            path.isAbsolute( relativeCertificateFileData ) === true
        ){
            throw new Error( 'DATABASE_TLS_CERTIFICATE_INVALID' );

        }

        const certificateStatusData = await stat( certificateFileData );

        if ( certificateStatusData.isFile() === false || Number( certificateStatusData.size ) > certificateMaximumBytes ){
            throw new Error( 'DATABASE_TLS_CERTIFICATE_INVALID' );

        }

        certificateAuthorityData = await readFile( certificateFileData, 'utf8' );

    }

    const tlsOptionsData = /** @type {{rejectUnauthorized: boolean, ca?: string, servername?: string}} */ ({
        rejectUnauthorized: tlsConfigurationData.mode === 'verify-full'
    });

    if ( certificateAuthorityData !== undefined ){
        tlsOptionsData.ca = certificateAuthorityData;

    }

    if ( tlsConfigurationData.serverName !== null ){
        tlsOptionsData.servername = tlsConfigurationData.serverName;

    }

    return tlsOptionsData;

}

/**
 * @param {object} redisOptionsData
 * @param {string} redisOptionsData.rootDirectory
 * @param {Readonly<Record<string, any>> | null} redisOptionsData.configuration
 * @param {Record<string, string | undefined>} redisOptionsData.environment
 * @param {(clientOptionsData: Record<string, unknown>) => any} [redisOptionsData.clientCreate]
 */
async function redisRuntimeCreate( redisOptionsData ){
    const redisConfigurationData = redisOptionsData.configuration;

    if ( redisConfigurationData === null ){
        return null;

    }

    let redisClientCreateData = redisOptionsData.clientCreate;

    if ( redisClientCreateData === undefined ){
        const redisModuleData = await import( 'redis' );
        redisClientCreateData = redisModuleData.createClient;

    }
    const redisTlsData = await postgresTlsOptionsCreate(
        redisOptionsData.rootDirectory,
        redisConfigurationData.tls
    );
    const redisSocketData = /** @type {Record<string, unknown>} */ ({
        host: redisConfigurationData.host,
        port: redisConfigurationData.port,
        connectTimeout: Number( 5000 ),
        reconnectStrategy( /** @type {number} */ retryCountData ){
            if ( Number( retryCountData ) >= Number( redisReconnectAttempts ) ){
                return new Error( 'Redis reconnect attempts are exhausted.' );

            }

            return Math.min( Number( 100 ) * (Number( 2 ) ** Number( retryCountData )), Number( 1000 ) );

        }
    });

    if ( redisTlsData !== false ){
        Object.assign( redisSocketData, redisTlsData, {
            tls: true
        });

    }

    const redisClientOptionsData = Object.freeze({
        socket: redisSocketData,
        username: redisConfigurationData.username ?? undefined,
        password: secretValueRead( redisConfigurationData.password, redisOptionsData.environment ),
        database: redisConfigurationData.database,
        RESP: 2,
        disableOfflineQueue: true
    });
    const redisClientData = redisClientCreateData( redisClientOptionsData );
    let readyStatusData = false;
    let connectedStatusData = false;
    let connectionVersionData = 0;
    let stoppedStatusData = false;

    redisClientData.on( 'error', function redisRuntimeErrorHandle(){
        readyStatusData = false;
        connectionVersionData += 1;

    });
    redisClientData.on( 'ready', function redisRuntimeReadyHandle(){
        readyStatusData = true;
        connectionVersionData += 1;

    });
    redisClientData.on( 'end', function redisRuntimeEndHandle(){
        readyStatusData = false;
        connectedStatusData = false;
        connectionVersionData += 1;

    });

    return Object.freeze({
        client: redisClientData,
        connectionOptions: redisClientOptionsData,
        versionRead(){
            //Invalidating cache readiness immediately on a transport lifecycle change
            return connectionVersionData;

        },

        async start(){
            //Preventing a late synchronizer pass from reopening a stopped dependency
            if ( stoppedStatusData ){
                return false;

            }

            if ( connectedStatusData === true ){
                if ( redisClientData.isOpen === false ){
                    connectedStatusData = false;

                } else {
                    return readyStatusData;

                }

            }

            try {
                await redisClientData.connect();
                connectedStatusData = true;
                readyStatusData = redisClientData.isReady === true;

            } catch( redisStartErrorData ){
                readyStatusData = false;

                if ( redisClientData.isOpen === true ){
                    redisClientData.destroy();

                }

                void redisStartErrorData;

            }

            return readyStatusData;

        },

        async stop(){
            //Cancelling native retry timers when shutdown races the first connection
            stoppedStatusData = true;
            readyStatusData = false;

            if ( redisClientData.isOpen === false ){
                connectedStatusData = false;

                return;

            }

            connectedStatusData = false;

            if ( redisClientData.isReady === true ){
                await redisClientData.quit().catch(function redisStopFailureHandle(){
                    //Destroying a half-closed client without delaying application shutdown
                    if ( redisClientData.isOpen === true ){
                        redisClientData.destroy();

                    }

                });

                return;

            }

            redisClientData.destroy();


        },

        isReady(){
            return readyStatusData === true && redisClientData.isReady === true;

        }
    });

}

/**
 * @param {object} databaseOptionsData
 * @param {string} databaseOptionsData.rootDirectory
 * @param {string} databaseOptionsData.stateDirectory
 * @param {Readonly<Record<string, any>>} databaseOptionsData.configuration
 * @param {Readonly<{tables: readonly Readonly<Record<string, unknown>>[]}>} databaseOptionsData.databaseSchema
 * @param {string} [databaseOptionsData.workerId]
 * @param {Record<string, string | undefined> | undefined} [databaseOptionsData.environment]
 * @param {(connectionData: any, databaseOptionsData: Record<string, unknown>) => any} [databaseOptionsData.databaseCreate]
 * @returns {Promise<LayerInfrastructureDatabase>}
 */
export async function layerInfrastructureDatabaseRuntimeCreate( databaseOptionsData ){
    const rootDirectoryData = path.resolve( databaseOptionsData.rootDirectory );
    const stateDirectoryData = path.resolve( databaseOptionsData.stateDirectory );
    const configurationData = databaseOptionsData.configuration;
    const databaseConfigurationData = configurationData.database;
    const systemSchemaData = layerSystemSchemaNameCreate( String( configurationData.appName ) );
    const environmentData = databaseOptionsData.environment ?? process.env;

    //Selecting embedded system storage only when no external PostgreSQL cluster is configured
    if ( Number( databaseConfigurationData.postgres.length ) === Number( 0 ) ){
        if ( Number( databaseOptionsData.databaseSchema.tables.length ) > Number( 0 ) ){
            const applicationDatabaseErrorData = new Error( 'Application tables require external PostgreSQL.' );
            Object.defineProperty( applicationDatabaseErrorData, 'code', {
                value: 'APPLICATION_DATABASE_REQUIRED',
                enumerable: true
            });

            throw applicationDatabaseErrorData;

        }

        let embeddedDirectoryData = path.join( stateDirectoryData, 'database', 'system' );

        if ( databaseConfigurationData.embedded.dataDirectory !== null ){
            embeddedDirectoryData = path.resolve(
                rootDirectoryData,
                databaseConfigurationData.embedded.dataDirectory
            );

        }

        return /** @type {LayerInfrastructureDatabase} */ (layerPgliteDatabaseCreate({
            dataDirectory: embeddedDirectoryData,
            systemSchema: systemSchemaData
        }));

    }

    const clusterConnectionsData = [];

    //Resolving secrets and TLS files only inside the trusted server process
    for ( const connectionConfigurationData of databaseConfigurationData.postgres ){
        clusterConnectionsData.push( Object.freeze({
            name: connectionConfigurationData.name,
            role: connectionConfigurationData.role,
            connectionOptions: Object.freeze({
                host: connectionConfigurationData.host,
                port: connectionConfigurationData.port,
                database: connectionConfigurationData.database,
                user: connectionConfigurationData.username,
                password: secretValueRead( connectionConfigurationData.password, environmentData ),
                ssl: await postgresTlsOptionsCreate( rootDirectoryData, connectionConfigurationData.tls ),
                connectionTimeoutMillis: Number( 5000 )
            })
        }) );

    }

    const clusterOptionsData = /** @type {Parameters<typeof layerPostgresClusterCreate>[0]} */ ({
        connections: Object.freeze( clusterConnectionsData ),
        systemSchema: systemSchemaData,
        maximumConnectionsPerWorker: databaseConfigurationData.pool.maximumConnectionsPerWorker,
        maximumLagMs: databaseConfigurationData.replica.maximumLagMs,
        applicationName: `${String( configurationData.appName )}:${String( databaseOptionsData.workerId ?? 'worker-1' )}`
    });

    if ( databaseOptionsData.databaseCreate !== undefined ){
        clusterOptionsData.databaseCreate = databaseOptionsData.databaseCreate;

    }

    return /** @type {LayerInfrastructureDatabase} */ (layerPostgresClusterCreate( clusterOptionsData ));

}

/**
 * @param {object} probeOptionsData
 * @param {string} probeOptionsData.rootDirectory
 * @param {Readonly<Record<string, any>>} probeOptionsData.configuration
 * @param {Record<string, string | undefined>} [probeOptionsData.environment]
 * @param {(clientOptionsData: Record<string, unknown>) => any} [probeOptionsData.redisClientCreate]
 * @param {(connectionData: any, databaseOptionsData: Record<string, unknown>) => any} [probeOptionsData.databaseCreate]
 */
export async function layerInfrastructureVersionsProbe( probeOptionsData ){
    const configurationData = probeOptionsData.configuration;
    const environmentData = probeOptionsData.environment ?? process.env;
    let postgresVersionData = null;
    let redisVersionData = null;

    //Reading the primary PostgreSQL version through the normal validated runtime path
    if ( Number( configurationData.database.postgres.length ) > Number( 0 ) ){
        const databaseOptionsData = /** @type {Parameters<typeof layerInfrastructureDatabaseRuntimeCreate>[0]} */ ({
            rootDirectory: probeOptionsData.rootDirectory,
            stateDirectory: probeOptionsData.rootDirectory,
            configuration: configurationData,
            databaseSchema: layerDatabaseSchemaDefine([]),
            workerId: 'doctor',
            environment: environmentData
        });

        if ( probeOptionsData.databaseCreate !== undefined ){
            databaseOptionsData.databaseCreate = probeOptionsData.databaseCreate;

        }

        const databaseRuntimeData = await layerInfrastructureDatabaseRuntimeCreate( databaseOptionsData );

        try {
            await databaseRuntimeData.connect();

            const versionResultData = await databaseRuntimeData.query({
                text: 'SHOW server_version',
                values: [],
                consistency: 'strong'
            });
            const versionValueData = versionResultData.rows[0]?.server_version;

            if ( typeof versionValueData !== 'string' || Number( versionValueData.length ) < Number( 1 ) ){
                throw new Error( 'INFRASTRUCTURE_VERSION_INVALID' );

            }

            postgresVersionData = versionValueData;

        } finally {
            await databaseRuntimeData.close();

        }

    }

    //Reading the optional Redis server version without exposing its connection secret
    if ( configurationData.redis !== null ){
        const redisOptionsData = /** @type {Parameters<typeof redisRuntimeCreate>[0]} */ ({
            rootDirectory: probeOptionsData.rootDirectory,
            configuration: configurationData.redis,
            environment: environmentData
        });

        if ( probeOptionsData.redisClientCreate !== undefined ){
            redisOptionsData.clientCreate = probeOptionsData.redisClientCreate;

        }

        const redisRuntimeData = await redisRuntimeCreate( redisOptionsData );

        if ( redisRuntimeData === null ){
            throw new Error( 'INFRASTRUCTURE_VERSION_INVALID' );

        }

        try {
            const redisReadyStatusData = await redisRuntimeData.start();

            if ( redisReadyStatusData === false ){
                throw new Error( 'INFRASTRUCTURE_UNAVAILABLE' );

            }

            const redisInformationData = await redisRuntimeData.client.info( 'server' );
            const redisVersionMatchData = /^redis_version:([^\r\n]+)$/m.exec( String( redisInformationData ) );

            if ( redisVersionMatchData === null ){
                throw new Error( 'INFRASTRUCTURE_VERSION_INVALID' );

            }

            redisVersionData = String( redisVersionMatchData[1] );

        } finally {
            await redisRuntimeData.stop();

        }

    }

    //CallBack THE OBJECT
    return Object.freeze({
        postgres: postgresVersionData,
        redis: redisVersionData
    });

}

/**
 * @param {object} runtimeOptionsData
 * @param {string} runtimeOptionsData.rootDirectory
 * @param {string} runtimeOptionsData.stateDirectory
 * @param {Readonly<Record<string, any>>} runtimeOptionsData.configuration
 * @param {Readonly<{tables: readonly Readonly<Record<string, unknown>>[]}>} runtimeOptionsData.databaseSchema
 * @param {(contextData: Readonly<Record<string, unknown>>) => LayerApplicationServerRuntime | Promise<LayerApplicationServerRuntime>} runtimeOptionsData.applicationServerCreate
 * @param {Readonly<Record<string, unknown>>} runtimeOptionsData.context
 * @param {Record<string, string | undefined>} [runtimeOptionsData.environment]
 * @param {(clientOptionsData: Record<string, unknown>) => any} [runtimeOptionsData.redisClientCreate]
 * @param {(connectionData: any, databaseOptionsData: Record<string, unknown>) => any} [runtimeOptionsData.databaseCreate]
 */
export async function layerApplicationServerRuntimeCreate( runtimeOptionsData ){
    const configurationData = runtimeOptionsData.configuration;
    const infrastructureOptionsData = /** @type {Parameters<typeof layerInfrastructureDatabaseRuntimeCreate>[0]} */ ({
        rootDirectory: runtimeOptionsData.rootDirectory,
        stateDirectory: runtimeOptionsData.stateDirectory,
        configuration: configurationData,
        databaseSchema: runtimeOptionsData.databaseSchema,
        workerId: String( runtimeOptionsData.context.workerId ?? 'worker-1' ),
        environment: runtimeOptionsData.environment
    });

    if ( runtimeOptionsData.databaseCreate !== undefined ){
        infrastructureOptionsData.databaseCreate = runtimeOptionsData.databaseCreate;

    }

    const databaseRuntimeData = await layerInfrastructureDatabaseRuntimeCreate( infrastructureOptionsData );

    const applicationDatabaseData = layerDatabaseFacadeCreate({
        database: databaseRuntimeData,
        schema: runtimeOptionsData.databaseSchema
    });
    const rateLimitKeyPrefixData = rateLimitKeyPrefixCreate( String( configurationData.appName ) );
    const durableRateLimiterData = layerDatabaseRateLimiterCreate({
        database: databaseRuntimeData,
        keyPrefix: rateLimitKeyPrefixData
    });
    const leaseManagerData = layerDatabaseLeaseManagerCreate({
        database: databaseRuntimeData,
        owner: String( runtimeOptionsData.context.workerId ?? 'worker-1' )
    });
    const redisRuntimeOptionsData = /** @type {Parameters<typeof redisRuntimeCreate>[0]} */ ({
        rootDirectory: runtimeOptionsData.rootDirectory,
        configuration: configurationData.redis,
        environment: runtimeOptionsData.environment ?? process.env
    });

    if ( runtimeOptionsData.redisClientCreate !== undefined ){
        redisRuntimeOptionsData.clientCreate = runtimeOptionsData.redisClientCreate;

    }

    const redisRuntimeData = await redisRuntimeCreate( redisRuntimeOptionsData );
    let rateLimiterData = durableRateLimiterData;

    if ( redisRuntimeData !== null ){
        rateLimiterData = layerRateLimiterFailoverCreate({
            primary: layerRedisRateLimiterCreate({
                redis: /** @type {any} */ (redisRuntimeData.client),
                keyPrefix: rateLimitKeyPrefixData
            }),
            fallback: durableRateLimiterData,
            primaryReady: redisRuntimeData.isReady
        });

    }

    const databaseEventBusData = layerDatabaseEventBusCreate({
        database: databaseRuntimeData
    });
    let redisEventBusData = null;

    if ( redisRuntimeData !== null ){
        redisEventBusData = layerRedisEventBusCreate({
            clientOptions: redisRuntimeData.connectionOptions,
            backgroundConnect: true,
            namespace: `layer:${String( configurationData.appName )}`
        });

    }

    const eventBusData = layerHybridEventBusCreate({
        fallback: databaseEventBusData,
        primary: redisEventBusData
    });
    let queryCacheData = null;
    let redisCoordinationData = null;

    if ( redisRuntimeData !== null ){
        queryCacheData = layerRedisQueryCacheCreate({
            redis: /** @type {any} */ (redisRuntimeData.client),
            namespace: queryCacheNamespaceCreate( String( configurationData.appName ) ),
            isReady(){
                //Enabling cached data only after replay for the currently ready Redis connection
                return redisRuntimeData?.isReady() === true && cacheInvalidationSynchronizerData?.isReady() === true;

            }
        });
        redisCoordinationData = layerRedisCoordinationCreate({
            redis: /** @type {any} */ (redisRuntimeData.client),
            namespace: coordinationNamespaceCreate( String( configurationData.appName ) )
        });

    }
    let cacheInvalidationSynchronizerData = /** @type {ReturnType<typeof layerCacheInvalidationSynchronizerCreate> | null} */ (null);

    if ( queryCacheData !== null ){
        cacheInvalidationSynchronizerData = layerCacheInvalidationSynchronizerCreate({
            repository: layerCacheInvalidationRepositoryCreate({
                database: databaseRuntimeData
            }),
            cache: queryCacheData,
            connectionVersionRead(){
                //Matching replay readiness to the Redis transport that actually completed it
                return redisRuntimeData?.versionRead() ?? 0;

            },
            async beforeSynchronize(){
                return redisRuntimeData?.start();

            }
        });

    }
    const identityStoresCreateData = function( /** @type {any} */ identityOptionsData ){
        if (
            typeof identityOptionsData?.sessions?.resolve !== 'function' ||
            typeof identityOptionsData?.sessions?.revoke !== 'function' ||
            typeof identityOptionsData?.sessions?.cacheTagCreate !== 'function' ||
            typeof identityOptionsData?.apiKeys?.resolve !== 'function' ||
            typeof identityOptionsData?.apiKeys?.revoke !== 'function' ||
            typeof identityOptionsData?.apiKeys?.revokeWithCacheTag !== 'function'
        ){
            throw new TypeError( 'Identity stores are invalid.' );

        }

        if ( queryCacheData !== null ){
            return layerIdentityCacheCreate({
                cache: queryCacheData,
                sessions: identityOptionsData.sessions,
                apiKeys: identityOptionsData.apiKeys,
                maximumTtlMs: identityOptionsData.maximumTtlMs,
                diagnostics: identityOptionsData.diagnostics
            });

        }

        return Object.freeze({
            sessions: Object.freeze({
                resolve: identityOptionsData.sessions.resolve.bind( identityOptionsData.sessions ),
                revoke: identityOptionsData.sessions.revoke.bind( identityOptionsData.sessions )
            }),
            apiKeys: Object.freeze({
                resolve: identityOptionsData.apiKeys.resolve.bind( identityOptionsData.apiKeys ),
                revoke: identityOptionsData.apiKeys.revoke.bind( identityOptionsData.apiKeys )
            }),
            isBypassing(){
                return true;

            }
        });

    };
    let authContextData = /** @type {Readonly<Record<string, any>> | null} */ (null);
    const authRuntimeInstancesData = /** @type {any[]} */ ([]);

    //Creating Layer-owned identity repositories only when Auth is enabled
    if ( configurationData.auth !== null ){
        let environmentNameData = /** @type {'development' | 'production'} */ ('production');

        if ( runtimeOptionsData.context.environment === String( 'development' ) ){
            environmentNameData = 'development';

        }
        const authSecretData = await authSecretValueRead(
            configurationData.auth,
            runtimeOptionsData.stateDirectory,
            environmentNameData,
            runtimeOptionsData.environment ?? process.env
        );
        const authUsersData = layerAuthUserRepositoryCreate({
            database: databaseRuntimeData
        });
        const authSessionsData = layerAuthSessionRepositoryCreate({
            database: databaseRuntimeData,
            sessionPepper: authSecretData
        });
        const authRolesData = layerAuthRoleRepositoryCreate({
            database: databaseRuntimeData
        });
        const authApiKeysData = layerApiKeyRepositoryCreate({
            database: databaseRuntimeData
        });
        const authAuditData = layerAuditRepositoryCreate({
            database: databaseRuntimeData,
            auditPepper: authSecretData
        });
        const authChallengesData = layerAuthChallengeRepositoryCreate({
            database: databaseRuntimeData,
            challengePepper: authSecretData
        });
        const authInvitationsData = layerAuthInvitationRepositoryCreate({
            database: databaseRuntimeData,
            invitationPepper: authSecretData
        });
        const authMailRepositoryData = layerAuthMailRepositoryCreate({
            database: databaseRuntimeData
        });
        const authMailQueueData = layerAuthMailQueueCreate({
            repository: authMailRepositoryData,
            secret: authSecretData
        });
        const authSecretEnvelopeData = layerAuthSecretEnvelopeCreate({
            secret: authSecretData
        });
        let authOAuthSigningJwksData = null;

        //Persisting one signing identity across deploys only when OAuth is enabled
        if ( configurationData.auth.oauth !== null ){
            authOAuthSigningJwksData = await authOAuthSigningJwksRead(
                runtimeOptionsData.stateDirectory,
                authSecretEnvelopeData
            );

        }
        const authPasskeysData = layerAuthPasskeyRepositoryCreate({
            database: databaseRuntimeData
        });
        const authTotpData = layerAuthTotpRepositoryCreate({
            database: databaseRuntimeData,
            recoveryPepper: authSecretData
        });
        const authOidcAdapterData = layerAuthOidcAdapterFactoryCreate({
            database: databaseRuntimeData,
            envelope: authSecretEnvelopeData,
            pepper: authSecretData
        });
        const authExternalIdentitiesData = layerAuthExternalIdentityRepositoryCreate({
            database: databaseRuntimeData,
            envelope: authSecretEnvelopeData,
            subjectPepper: authSecretData
        });

        authContextData = Object.freeze({
            enabled: true,
            audit: authAuditData,

            /**
             * @param {{
             *     allowedOrigins: readonly string[],
             *     secureCookies?: boolean,
             *     authorizationResolve?: Function | null,
             *     bearerResolve?: Function,
             *     apiKeyResolve?: Function,
             *     mailRender?: Function,
             *     mailDiagnostics?: Function,
             *     oauthInteractionHandler?: Function
             *     phoneChallenge?: {start: Function, consume: Function}
             * }} authRuntimeOptionsData
             */
            create( authRuntimeOptionsData ){
                //Preventing duplicate operation registration and mail pollers in one worker
                if ( Number( authRuntimeInstancesData.length ) > Number( 0 ) ){
                    throw new TypeError( 'Layer Auth runtime can be created only once per worker.' );

                }

                //Defaulting production to __Host cookies and development to loopback cookies
                let secureCookiesStatusData = environmentNameData === String( 'production' );

                if ( authRuntimeOptionsData?.secureCookies !== undefined ){
                    secureCookiesStatusData = authRuntimeOptionsData.secureCookies;

                }

                //Preventing a production server from downgrading managed session cookies
                if ( environmentNameData === String( 'production' ) && secureCookiesStatusData !== true ){
                    throw new TypeError( 'Layer Auth production cookies must remain secure.' );

                }

                const authRuntimeCreateOptionsData = /** @type {Record<string, any>} */ ({
                    configuration: configurationData.auth,
                    users: authUsersData,
                    sessions: authSessionsData,
                    roles: authRolesData,
                    invitations: authInvitationsData,
                    apiKeys: authApiKeysData,
                    challenges: authChallengesData,
                    mailQueue: authMailQueueData,
                    passkeys: authPasskeysData,
                    totp: authTotpData,
                    externalIdentities: authExternalIdentitiesData,
                    secretEnvelope: authSecretEnvelopeData,
                    oauthAdapter: authOidcAdapterData,
                    oauthSecret: authSecretData,
                    oauthJwks: authOAuthSigningJwksData,
                    oauthEnvironment: runtimeOptionsData.environment ?? process.env,
                    auditTrail: authAuditData,
                    rateLimiter: rateLimiterData,
                    allowedOrigins: authRuntimeOptionsData?.allowedOrigins,
                    secureCookies: secureCookiesStatusData
                });

                if ( configurationData.auth.smtp !== null ){
                    let smtpPasswordData = /** @type {string | undefined} */ (undefined);
                    const smtpPasswordConfigurationData = configurationData.auth.smtp.password;

                    //Resolving the SMTP credential only inside the server worker
                    if ( smtpPasswordConfigurationData !== null ){
                        smtpPasswordData = (runtimeOptionsData.environment ?? process.env)[smtpPasswordConfigurationData.env];

                        if ( typeof smtpPasswordData !== 'string' || Number( smtpPasswordData.length ) < Number( 1 ) ){
                            const smtpSecretErrorData = new Error( 'Layer Auth SMTP password is unavailable.' );
                            Object.defineProperty( smtpSecretErrorData, 'code', {
                                value: 'AUTH_SMTP_SECRET_UNAVAILABLE',
                                enumerable: true
                            });

                            throw smtpSecretErrorData;

                        }

                    }

                    const mailDeliveryOptionsData = /** @type {Record<string, any>} */ ({
                        repository: authMailRepositoryData,
                        queue: authMailQueueData,
                        smtp: configurationData.auth.smtp,
                        password: smtpPasswordData,
                        workerId: `auth-mail-${String( process.pid )}-${String( randomUUID() )}`
                    });

                    if ( typeof authRuntimeOptionsData?.mailRender === 'function' ){
                        mailDeliveryOptionsData.render = authRuntimeOptionsData.mailRender;

                    }

                    if ( typeof authRuntimeOptionsData?.mailDiagnostics === 'function' ){
                        mailDeliveryOptionsData.diagnostics = authRuntimeOptionsData.mailDiagnostics;

                    }

                    authRuntimeCreateOptionsData.mailDelivery = layerAuthMailDeliveryCreate( /** @type {any} */ (mailDeliveryOptionsData) );

                }

                if ( authRuntimeOptionsData?.authorizationResolve !== undefined ){
                    authRuntimeCreateOptionsData.authorizationResolve = authRuntimeOptionsData.authorizationResolve;

                }

                if ( authRuntimeOptionsData?.phoneChallenge !== undefined ){
                    authRuntimeCreateOptionsData.phoneChallenge = authRuntimeOptionsData.phoneChallenge;

                }

                if ( authRuntimeOptionsData?.oauthInteractionHandler !== undefined ){
                    authRuntimeCreateOptionsData.oauthInteractionHandler = authRuntimeOptionsData.oauthInteractionHandler;

                }

                if ( authRuntimeOptionsData?.bearerResolve !== undefined ){
                    authRuntimeCreateOptionsData.bearerResolve = authRuntimeOptionsData.bearerResolve;

                }

                if ( authRuntimeOptionsData?.apiKeyResolve !== undefined ){
                    authRuntimeCreateOptionsData.apiKeyResolve = authRuntimeOptionsData.apiKeyResolve;

                }

                const authRuntimeData = layerAuthServerRuntimeCreate( /** @type {any} */ (authRuntimeCreateOptionsData) );
                authRuntimeInstancesData.push( authRuntimeData );

                //CallBack THE OBJECT
                return authRuntimeData;

            }
        });

    }

    //Creating optional push delivery without opening storage before migrations are ready
    let notificationsRuntimeData = null;

    if ( configurationData.notifications !== null && configurationData.notifications !== undefined ){
        notificationsRuntimeData = layerNotificationsRuntimeCreate({
            configuration: configurationData.notifications,
            applicationName: String( configurationData.appName ),
            database: databaseRuntimeData,
            workerId: String( runtimeOptionsData.context.workerId ?? 'worker-1' ),
            environment: runtimeOptionsData.environment ?? process.env,
            redis: redisRuntimeData
        });

    }

    const applicationContextData = Object.freeze({
        ...runtimeOptionsData.context,
        database: applicationDatabaseData,
        databaseRuntime: databaseRuntimeData,
        databaseSchema: runtimeOptionsData.databaseSchema,
        coordination: Object.freeze({
            leases: leaseManagerData,
            locks: redisCoordinationData?.locks ?? null,
            presence: redisCoordinationData?.presence ?? null
        }),
        eventBus: eventBusData,
        identity: Object.freeze({
            accelerated: queryCacheData !== null,
            create: identityStoresCreateData
        }),
        auth: authContextData,
        notifications: notificationsRuntimeData,
        leases: leaseManagerData,
        queryCache: queryCacheData,
        rateLimiter: rateLimiterData,
        redis: Object.freeze({
            configured: redisRuntimeData !== null,
            isReady: redisRuntimeData?.isReady ?? function redisUnavailable(){
                return false;

            }
        })
    });
    let applicationRuntimeData;

    try {
        applicationRuntimeData = await runtimeOptionsData.applicationServerCreate( applicationContextData );

    } catch( applicationCreateErrorData ){
        //Releasing embedded file ownership when trusted application setup fails.
        await databaseRuntimeData.close().catch(function databaseCreateCleanupIgnore(){
            //Preserving the application factory failure

        });

        throw applicationCreateErrorData;

    }

    if (
        applicationRuntimeData === null ||
        typeof applicationRuntimeData !== 'object' ||
        typeof applicationRuntimeData.start !== 'function' ||
        typeof applicationRuntimeData.stop !== 'function' ||
        typeof applicationRuntimeData.isReady !== 'function'
    ){
        await databaseRuntimeData.close().catch(function invalidLifecycleCleanupIgnore(){
            //Preserving the stable lifecycle contract error

        });

        throw new Error( 'layerServerCreate(context) returned an invalid lifecycle.' );

    }

    let startedStatusData = false;
    let stoppedStatusData = false;

    return Object.freeze({
        /** @param {{host: string, port: number}} listenOptionsData */
        async start( listenOptionsData ){
            //Starting durable storage and schema readiness before opening the application port
            await databaseRuntimeData.connect();

            try {
                await layerDatabaseLegacyMigrate( databaseRuntimeData );
                await layerDatabaseMigrate( databaseRuntimeData );

                if ( databaseRuntimeData.kind === 'postgres' ){
                    await layerDatabaseSchemaSynchronize({
                        database: databaseRuntimeData,
                        schema: runtimeOptionsData.databaseSchema
                    });

                }

                //Serving through durable fallback while optional Redis connects in the background
                await cacheInvalidationSynchronizerData?.start({background: true});

                //Starting Auth background lifecycles after schema readiness
                for ( const authRuntimeData of authRuntimeInstancesData ){
                    await authRuntimeData.start();

                }

                await applicationRuntimeData.start( listenOptionsData );

                if ( applicationRuntimeData.isReady() !== true ){
                    throw new Error( 'The application server did not become ready.' );

                }

                startedStatusData = true;
                await notificationsRuntimeData?.start();

            } catch( startupErrorData ){
                await notificationsRuntimeData?.stop().catch(function notificationsStartupCleanupIgnore(){
                    //Preserving the startup error while still closing application and SQL resources

                });
                await applicationRuntimeData.stop({deadlineMs: 10000}).catch(function applicationStopIgnore(){
                    //Preserving the primary startup failure after best-effort application cleanup

                });

                for ( const authRuntimeData of [...authRuntimeInstancesData].reverse() ){
                    await authRuntimeData.stop().catch(function authRuntimeStopIgnore(){
                        //Preserving the primary startup failure after Auth cleanup

                    });

                }
                await eventBusData.stop().catch(function eventBusStopIgnore(){
                    //Preserving the primary startup failure after best-effort event bus cleanup

                });
                await Promise.all([cacheInvalidationSynchronizerData?.stop(), redisRuntimeData?.stop()]).catch(function cacheInvalidationStopIgnore(){
                    //Preserving the primary startup failure after best-effort cache cleanup

                });
                await redisRuntimeData?.stop().catch(function redisStopIgnore(){
                    //Preserving the primary startup failure after best-effort Redis cleanup

                });
                await databaseRuntimeData.close().catch(function databaseStopIgnore(){
                    //Preserving the primary startup failure after best-effort database cleanup

                });

                throw startupErrorData;

            }

        },

        async stop( shutdownOptionsData = {} ){
            //Making application and storage shutdown idempotent across signal paths
            if ( stoppedStatusData === true ){
                return;

            }

            stoppedStatusData = true;
            startedStatusData = false;

            try {
                await applicationRuntimeData.stop(shutdownOptionsData);

            } finally {
                await notificationsRuntimeData?.stop().catch(function notificationsShutdownCleanupIgnore(){
                    //Completing the remaining cleanup after the push poll has already settled

                });
                try {
                    for ( const authRuntimeData of [...authRuntimeInstancesData].reverse() ){
                        await authRuntimeData.stop();

                    }

                } finally {
                    try {
                        await eventBusData.stop();

                    } finally {
                        try {
                            //Cancelling pending transport attempts while the synchronizer drains
                            await Promise.all([cacheInvalidationSynchronizerData?.stop(), redisRuntimeData?.stop()]);

                        } finally {
                            try {
                                await redisRuntimeData?.stop();

                            } finally {
                                await databaseRuntimeData.close();

                            }

                        }

                    }

                }

            }

        },

        isReady(){
            //Requiring both the application listener and its source of truth to be ready
            return (
                startedStatusData === true &&
                stoppedStatusData === false &&
                applicationRuntimeData.isReady() === true &&
                databaseRuntimeData.isReady() === true
            );

        }
    });

}
