import assert from 'node:assert/strict';
import {
    mkdtemp,
    readFile,
    rm
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    layerDatabaseSchemaDefine,
    layerTableDefine
} from '@solcorp/layer-database';
import {
    layerApplicationServerRuntimeCreate,
    layerConfigValidate,
    layerInfrastructureDatabaseRuntimeCreate
} from '../src/index.js';
import {layerInfrastructureVersionsProbe} from '../src/application-server-runtime.js';

test('application server runtime wires embedded storage and Redis acceleration lifecycle', async function(){
    const stateDirectoryData = await mkdtemp( path.join( tmpdir(), 'layer-server-runtime-' ) );
    const redisValueMapData = new Map();
    const redisListenersData = new Map();
    let redisConnectCountData = Number( 0 );
    let redisConnectionFailData = function(){
        //Waiting for the first connect attempt to expose its rejection callback

    };
    let redisQuitCountData = Number( 0 );
    let applicationStartCountData = Number( 0 );
    let applicationStopCountData = Number( 0 );
    let applicationReadyStatusData = false;
    let applicationContextData = /** @type {Record<string, any> | null} */ (null);
    const redisClientData = {
        isOpen: false,
        isReady: false,
        on( /** @type {string} */ eventNameData, /** @type {Function} */ listenerData ){
            redisListenersData.set( eventNameData, listenerData );

            return this;
        },
        async connect(){
            redisConnectCountData += Number( 1 );

            if ( redisConnectCountData === Number( 1 ) ){
                await new Promise(function( _resolveData, rejectData ){
                    //Holding Redis unavailable until the test proves the application already started
                    redisConnectionFailData = function(){
                        //Releasing the first failed series so background polling can retry
                        rejectData( new Error( 'Redis startup unavailable' ) );

                    };

                });

            }

            this.isOpen = true;
            this.isReady = true;
            redisListenersData.get( 'ready' )?.();
        },
        async quit(){
            redisQuitCountData += Number( 1 );
            this.isOpen = false;
            this.isReady = false;
            redisListenersData.get( 'end' )?.();
        },
        destroy(){
            this.isOpen = false;
            this.isReady = false;
            redisListenersData.get( 'end' )?.();
        },
        async get( /** @type {string} */ keyData ){
            return redisValueMapData.get( keyData ) ?? null;
        },
        async set( /** @type {string} */ keyData, /** @type {string} */ valueData ){
            redisValueMapData.set( keyData, valueData );

            return 'OK';
        },
        async sAdd(){
            return 1;
        },
        async zAdd(){
            return 1;
        },
        async zRem(){
            return 1;
        },
        async zRemRangeByScore(){
            return 0;
        },
        async zRangeByScore(){
            return [];
        },
        async pExpire(){
            return true;
        },
        async eval(){
            return [1, 99, 0];
        }
    };
    let redisClientOptionsData = /** @type {Record<string, unknown> | null} */ (null);
    const configurationData = layerConfigValidate({
        appName: 'runtime-test',
        redis: {
            host: '127.0.0.1',
            port: 6379,
            password: null,
            tls: {
                mode: 'disable'
            }
        }
    });

    try {
        const runtimeData = await layerApplicationServerRuntimeCreate({
            rootDirectory: stateDirectoryData,
            stateDirectory: stateDirectoryData,
            configuration: configurationData,
            databaseSchema: layerDatabaseSchemaDefine([]),
            context: Object.freeze({workerId: 'worker-1'}),
            redisClientCreate( clientOptionsData ){
                redisClientOptionsData = clientOptionsData;

                return redisClientData;
            },
            async applicationServerCreate( contextData ){
                applicationContextData = contextData;

                return Object.freeze({
                    async start( listenOptionsData ){
                        assert.deepEqual( listenOptionsData, {
                            host: '127.0.0.1',
                            port: 8787
                        });
                        applicationStartCountData += Number( 1 );
                        applicationReadyStatusData = true;
                    },
                    async stop(){
                        applicationStopCountData += Number( 1 );
                        applicationReadyStatusData = false;
                    },
                    isReady(){
                        return applicationReadyStatusData;
                    }
                });
            }
        });

        assert.equal( runtimeData.isReady(), false );
        await runtimeData.start({host: '127.0.0.1', port: 8787});
        assert.equal( runtimeData.isReady(), true );
        assert.ok( applicationContextData );
        assert.equal( applicationContextData.redis.configured, true );
        //Serving through SQL fallback while the failed initial Redis series is retried in the background
        assert.equal( applicationContextData.redis.isReady(), false );
        redisConnectionFailData();
        await new Promise(function( resolveData ){
            //Allowing the one-second managed recovery poll to reconnect without restarting the host
            setTimeout( resolveData, 1200 );

        });
        assert.equal( applicationContextData.redis.isReady(), true );
        assert.equal( typeof applicationContextData.queryCache.execute, 'function' );
        assert.equal( typeof applicationContextData.rateLimiter.consume, 'function' );
        assert.equal( typeof applicationContextData.leases.acquire, 'function' );
        assert.equal( applicationContextData.coordination.leases, applicationContextData.leases );
        assert.equal( typeof applicationContextData.coordination.locks.acquire, 'function' );
        assert.equal( typeof applicationContextData.coordination.presence.touch, 'function' );
        assert.equal( applicationContextData.identity.accelerated, true );
        assert.equal( redisClientOptionsData?.password, undefined );
        assert.equal( redisClientOptionsData?.disableOfflineQueue, true );
        const identityStoresData = applicationContextData.identity.create({
            sessions: {
                async resolve(){
                    return {
                        id: 'session-1',
                        status: 'active',
                        expiresAt: Date.now() + Number( 60000 )
                    };
                },
                async revoke(){
                    return true;
                },
                cacheTagCreate(){
                    return 'session:test';
                }
            },
            apiKeys: {
                async resolve(){
                    return {
                        id: 'api-key-1',
                        status: 'active',
                        expiresAt: Date.now() + Number( 60000 )
                    };
                },
                async revoke(){
                    return true;
                },
                async revokeWithCacheTag(){
                    return {
                        revoked: true,
                        cacheTag: `api-key:${'a'.repeat( 64 )}`
                    };
                }
            }
        });
        assert.equal( (await identityStoresData.sessions.resolve( 'test-session' )).id, 'session-1' );
        assert.equal( (await identityStoresData.apiKeys.resolve( 'a'.repeat( 64 ) )).id, 'api-key-1' );
        assert.equal( await identityStoresData.sessions.revoke( 'test-session' ), true );
        assert.equal( await identityStoresData.apiKeys.revoke( 'api-key-1' ), true );
        assert.equal( redisConnectCountData, 2 );
        assert.equal( applicationStartCountData, 1 );

        await runtimeData.stop();
        await runtimeData.stop();
        assert.equal( runtimeData.isReady(), false );
        assert.equal( applicationStopCountData, 1 );
        assert.equal( redisQuitCountData, 1 );

    } finally {
        await rm( stateDirectoryData, {recursive: true, force: true} );

    }
});

test( 'application runtime provisions Layer Auth with a persistent development secret', async function(){
    const stateDirectoryData = await mkdtemp( path.join( tmpdir(), 'layer-auth-runtime-' ) );
    const configurationData = layerConfigValidate({
        appName: 'runtime-auth',
        auth: {
            enabled: true,
            registration: {mode: 'open'},
            identifiers: {email: true, username: false}
        }
    });
    let applicationReadyStatusData = false;
    let authRuntimeData = /** @type {Record<string, any> | null} */ (null);

    try {
        const runtimeData = await layerApplicationServerRuntimeCreate({
            rootDirectory: stateDirectoryData,
            stateDirectory: stateDirectoryData,
            configuration: configurationData,
            databaseSchema: layerDatabaseSchemaDefine([]),
            context: Object.freeze({
                environment: 'development',
                workerId: 'worker-auth-development'
            }),
            async applicationServerCreate( contextData ){
                const applicationContextData = /** @type {any} */ (contextData);
                assert.equal( applicationContextData.auth.enabled, true );

                authRuntimeData = applicationContextData.auth.create({
                    allowedOrigins: ['http://127.0.0.1'],
                    secureCookies: false
                });

                return Object.freeze({
                    async start(){
                        applicationReadyStatusData = true;

                    },
                    async stop(){
                        applicationReadyStatusData = false;

                    },
                    isReady(){
                        return applicationReadyStatusData;

                    }
                });

            }
        });

        await runtimeData.start({host: '127.0.0.1', port: 8787});

        const developmentSecretData = String(
            await readFile( path.join( stateDirectoryData, 'auth', 'secret' ), 'utf8' )
        ).trim();

        assert.ok( authRuntimeData );
        assert.equal( authRuntimeData.operations.length, 10 );
        assert.equal( typeof authRuntimeData.security.contextResolve, 'function' );
        assert.equal( typeof authRuntimeData.contextExtend, 'function' );
        assert.equal( developmentSecretData.length >= 32, true );

        await runtimeData.stop();

    } finally {
        await rm( stateDirectoryData, {recursive: true, force: true} );

    }

});

test( 'application runtime persists encrypted OAuth signing keys across restarts', async function(){
    const stateDirectoryData = await mkdtemp( path.join( tmpdir(), 'layer-auth-oauth-runtime-' ) );
    const configurationData = layerConfigValidate({
        appName: 'runtime-auth-oauth',
        auth: {
            enabled: true,
            registration: {mode: 'open'},
            oauth: {
                issuer: 'http://127.0.0.1:8787',
                interactionUrl: '/auth/oauth',
                scopes: ['openid', 'offline_access'],
                clients: [{
                    id: 'browser-client',
                    type: 'public',
                    displayName: 'Browser client',
                    redirectUris: ['http://127.0.0.1:8787/auth/callback'],
                    grantTypes: ['authorization_code', 'refresh_token'],
                    scopes: ['openid', 'offline_access'],
                    dpop: 'required'
                }]
            }
        }
    });
    const signingKeyFileData = path.join( stateDirectoryData, 'auth', 'oauth-signing-jwks' );

    /** @returns {Promise<ReturnType<typeof layerApplicationServerRuntimeCreate> extends Promise<infer ValueData> ? ValueData : never>} */
    const runtimeCreateData = async function(){
        return layerApplicationServerRuntimeCreate({
            rootDirectory: stateDirectoryData,
            stateDirectory: stateDirectoryData,
            configuration: configurationData,
            databaseSchema: layerDatabaseSchemaDefine([]),
            context: Object.freeze({
                environment: 'development',
                workerId: `worker-auth-oauth-${String( Date.now() )}`
            }),
            async applicationServerCreate( contextData ){
                const applicationContextData = /** @type {any} */ (contextData);
                const authRuntimeData = applicationContextData.auth.create({
                    allowedOrigins: ['http://127.0.0.1:8787'],
                    secureCookies: false
                });

                assert.ok( authRuntimeData.oauth );
                assert.equal( authRuntimeData.http.requestHandlers.length, 1 );

                return Object.freeze({
                    async start(){},
                    async stop(){},
                    isReady(){
                        return true;
                    }
                });

            }
        });

    };

    try {
        const firstRuntimeData = await runtimeCreateData();
        await firstRuntimeData.start({host: '127.0.0.1', port: 8787});
        const firstEncryptedKeyData = await readFile( signingKeyFileData );
        await firstRuntimeData.stop();

        const secondRuntimeData = await runtimeCreateData();
        await secondRuntimeData.start({host: '127.0.0.1', port: 8787});
        const secondEncryptedKeyData = await readFile( signingKeyFileData );
        await secondRuntimeData.stop();

        assert.deepEqual( secondEncryptedKeyData, firstEncryptedKeyData );
        assert.equal( firstEncryptedKeyData.includes( Buffer.from( '"d"', 'utf8' ) ), false );
        assert.equal( firstEncryptedKeyData.includes( Buffer.from( 'ES256', 'utf8' ) ), false );

    } finally {
        await rm( stateDirectoryData, {recursive: true, force: true} );

    }

});

test( 'application runtime requires an explicit production Auth secret', async function(){
    const stateDirectoryData = await mkdtemp( path.join( tmpdir(), 'layer-auth-production-' ) );
    const configurationData = layerConfigValidate({
        appName: 'runtime-auth-production',
        auth: {
            enabled: true,
            registration: {mode: 'disabled'}
        }
    });

    try {
        await assert.rejects(
            function productionAuthRuntimeCreate(){
                return layerApplicationServerRuntimeCreate({
                    rootDirectory: stateDirectoryData,
                    stateDirectory: stateDirectoryData,
                    configuration: configurationData,
                    databaseSchema: layerDatabaseSchemaDefine([]),
                    context: Object.freeze({
                        environment: 'production',
                        workerId: 'worker-auth-production'
                    }),
                    async applicationServerCreate(){
                        throw new Error( 'Application factory must not run without an Auth secret.' );

                    }
                });

            },
            function authSecretErrorCheck( errorData ){
                assert.equal( /** @type {any} */ (errorData).code, 'AUTH_SECRET_UNAVAILABLE' );

                return true;

            }
        );

    } finally {
        await rm( stateDirectoryData, {recursive: true, force: true} );

    }

});

test('application server runtime rejects invalid lifecycle and application tables in embedded mode', async function(){
    const stateDirectoryData = await mkdtemp( path.join( tmpdir(), 'layer-server-runtime-invalid-' ) );
    const configurationData = layerConfigValidate({appName: 'runtime-invalid'});

    try {
        await assert.rejects(() => layerApplicationServerRuntimeCreate({
            rootDirectory: stateDirectoryData,
            stateDirectory: stateDirectoryData,
            configuration: configurationData,
            databaseSchema: layerDatabaseSchemaDefine([]),
            context: Object.freeze({workerId: 'worker-1'}),
            async applicationServerCreate(){
                return /** @type {any} */ ({});
            }
        }), /invalid lifecycle/);

        await assert.rejects(() => layerApplicationServerRuntimeCreate({
            rootDirectory: stateDirectoryData,
            stateDirectory: stateDirectoryData,
            configuration: configurationData,
            databaseSchema: layerDatabaseSchemaDefine([
                layerTableDefine({
                    name: 'messages',
                    scope: 'global',
                    primaryKey: 'id',
                    columns: {
                        id: {
                            type: 'uuid',
                            generated: 'uuid'
                        }
                    }
                })
            ]),
            context: Object.freeze({workerId: 'worker-1'}),
            async applicationServerCreate(){
                return /** @type {any} */ ({});
            }
        }), function applicationDatabaseErrorCheck( errorData ){
            return /** @type {any} */ (errorData).code === 'APPLICATION_DATABASE_REQUIRED';
        });

    } finally {
        await rm( stateDirectoryData, {recursive: true, force: true} );

    }
});

test('application server runtime cleans storage after factory and startup failures', async function(){
    const stateDirectoryData = await mkdtemp( path.join( tmpdir(), 'layer-server-runtime-failure-' ) );
    const configurationData = layerConfigValidate({appName: 'runtime-failure'});
    const schemaData = layerDatabaseSchemaDefine([]);

    try {
        await assert.rejects(() => layerApplicationServerRuntimeCreate({
            rootDirectory: stateDirectoryData,
            stateDirectory: stateDirectoryData,
            configuration: configurationData,
            databaseSchema: schemaData,
            context: Object.freeze({workerId: 'worker-1'}),
            async applicationServerCreate(){
                throw new Error( 'Application factory failed' );
            }
        }), /factory failed/);

        let stopCountData = Number( 0 );
        const runtimeData = await layerApplicationServerRuntimeCreate({
            rootDirectory: stateDirectoryData,
            stateDirectory: stateDirectoryData,
            configuration: configurationData,
            databaseSchema: schemaData,
            context: Object.freeze({workerId: 'worker-1'}),
            async applicationServerCreate(){
                return Object.freeze({
                    async start(){},
                    async stop(){
                        stopCountData += Number( 1 );
                    },
                    isReady(){
                        return false;
                    }
                });
            }
        });

        await assert.rejects(
            () => runtimeData.start({host: '127.0.0.1', port: 8787}),
            /did not become ready/
        );
        assert.equal( runtimeData.isReady(), false );
        assert.equal( stopCountData, 1 );

    } finally {
        await rm( stateDirectoryData, {recursive: true, force: true} );

    }
});

test('infrastructure runtime resolves external PostgreSQL secrets and verifies primary role', async function(){
    const capturedConnectionsData = /** @type {any[]} */ ([]);
    let closeCountData = Number( 0 );
    const configurationData = layerConfigValidate({
        appName: 'external-runtime',
        database: {
            postgres: [{
                name: 'primary',
                role: 'primary',
                host: '127.0.0.1',
                port: 5432,
                database: 'layer_application',
                username: 'layer_application',
                password: {
                    env: 'LAYER_TEST_POSTGRES_PASSWORD'
                },
                tls: {
                    mode: 'disable'
                }
            }]
        }
    });
    const databaseRuntimeData = await layerInfrastructureDatabaseRuntimeCreate({
        rootDirectory: process.cwd(),
        stateDirectory: process.cwd(),
        configuration: configurationData,
        databaseSchema: layerDatabaseSchemaDefine([]),
        environment: {
            LAYER_TEST_POSTGRES_PASSWORD: 'resolved-secret'
        },
        databaseCreate( connectionData, databaseOptionsData ){
            capturedConnectionsData.push({connectionData, databaseOptionsData});

            return {
                kind: /** @type {'postgres'} */ ('postgres'),
                systemSchema: String( databaseOptionsData.systemSchema ),
                async connect(){},
                async query( /** @type {any} */ queryData ){
                    if ( queryData.text.includes( 'pg_is_in_recovery' ) === true ){
                        return {rows: [{in_recovery: false}], rowCount: 1};

                    }

                    return {rows: [{value: 1}], rowCount: 1};
                },
                async transaction( /** @type {any} */ transactionHandlerData ){
                    return transactionHandlerData( this );
                },
                async healthCheck(){
                    return true;
                },
                async close(){
                    closeCountData += Number( 1 );
                },
                isReady(){
                    return true;
                }
            };
        }
    });

    await databaseRuntimeData.connect();
    assert.equal( databaseRuntimeData.isReady(), true );
    assert.equal( capturedConnectionsData.length, 1 );
    assert.equal( capturedConnectionsData[0].connectionData.connectionOptions.password, 'resolved-secret' );
    assert.equal( capturedConnectionsData[0].connectionData.connectionOptions.ssl, false );
    assert.equal( capturedConnectionsData[0].databaseOptionsData.maximumConnections, 5 );
    assert.deepEqual( await databaseRuntimeData.query({
        text: 'SELECT 1 AS value',
        values: []
    }), {rows: [{value: 1}], rowCount: 1} );

    await databaseRuntimeData.close();
    assert.equal( closeCountData, 1 );

    //Creating a second loopback runtime without authentication data
    const passwordlessConfigurationData = layerConfigValidate({
        appName: 'external-runtime-passwordless',
        database: {
            postgres: [{
                name: 'primary',
                role: 'primary',
                host: '127.0.0.1',
                port: 5432,
                database: 'layer_application',
                username: 'postgres',
                password: null,
                tls: {
                    mode: 'disable'
                }
            }]
        }
    });
    const passwordlessRuntimeData = await layerInfrastructureDatabaseRuntimeCreate({
        rootDirectory: process.cwd(),
        stateDirectory: process.cwd(),
        configuration: passwordlessConfigurationData,
        databaseSchema: layerDatabaseSchemaDefine([]),
        databaseCreate( connectionData, databaseOptionsData ){
            capturedConnectionsData.push({connectionData, databaseOptionsData});

            return {
                kind: /** @type {'postgres'} */ ('postgres'),
                systemSchema: String( databaseOptionsData.systemSchema ),
                async connect(){},
                async query(){
                    return {rows: [{in_recovery: false}], rowCount: 1};
                },
                async transaction( /** @type {any} */ transactionHandlerData ){
                    return transactionHandlerData( this );
                },
                async healthCheck(){
                    return true;
                },
                async close(){},
                isReady(){
                    return true;
                }
            };
        }
    });

    await passwordlessRuntimeData.connect();
    assert.equal( capturedConnectionsData[1].connectionData.connectionOptions.password, undefined );
    await passwordlessRuntimeData.close();
});

test('infrastructure version probe reads PostgreSQL and Redis through managed lifecycles', async function(){
    const listenerMapData = new Map();
    let databaseCloseCountData = Number( 0 );
    let redisQuitCountData = Number( 0 );
    const configurationData = layerConfigValidate({
        appName: 'infrastructure-version-probe',
        database: {
            postgres: [{
                name: 'primary',
                role: 'primary',
                host: '127.0.0.1',
                port: 5432,
                database: 'layer_application',
                username: 'postgres',
                password: null,
                tls: {mode: 'disable'}
            }]
        },
        redis: {
            host: '127.0.0.1',
            port: 6379,
            username: null,
            password: null,
            database: 15,
            tls: {mode: 'disable'}
        }
    });
    const redisClientData = {
        isOpen: false,
        isReady: false,
        on( /** @type {string} */ eventNameData, /** @type {Function} */ listenerData ){
            listenerMapData.set( eventNameData, listenerData );

            return this;
        },
        async connect(){
            this.isOpen = true;
            this.isReady = true;
            listenerMapData.get( 'ready' )?.();
        },
        async info( /** @type {string} */ sectionData ){
            assert.equal( sectionData, 'server' );

            return '# Server\r\nredis_version:5.0.14.1\r\n';
        },
        async quit(){
            redisQuitCountData += Number( 1 );
            this.isOpen = false;
            this.isReady = false;
            listenerMapData.get( 'end' )?.();
        },
        destroy(){
            this.isOpen = false;
            this.isReady = false;
        }
    };

    const versionsData = await layerInfrastructureVersionsProbe({
        rootDirectory: process.cwd(),
        configuration: configurationData,
        environment: {},
        redisClientCreate(){
            return redisClientData;
        },
        databaseCreate( connectionData, databaseOptionsData ){
            assert.equal( connectionData.connectionOptions.password, undefined );

            return {
                kind: /** @type {'postgres'} */ ('postgres'),
                systemSchema: String( databaseOptionsData.systemSchema ),
                async connect(){},
                async query( /** @type {{text: string}} */ queryData ){
                    if ( queryData.text.includes( 'pg_is_in_recovery' ) === true ){
                        return {rows: [{in_recovery: false}], rowCount: 1};
                    }

                    assert.equal( queryData.text, 'SHOW server_version' );

                    return {rows: [{server_version: '14.2'}], rowCount: 1};
                },
                async transaction( /** @type {any} */ transactionHandlerData ){
                    return transactionHandlerData( this );
                },
                async healthCheck(){
                    return true;
                },
                async close(){
                    databaseCloseCountData += Number( 1 );
                },
                isReady(){
                    return true;
                }
            };
        }
    });

    assert.deepEqual( versionsData, {postgres: '14.2', redis: '5.0.14.1'} );
    assert.equal( databaseCloseCountData, 1 );
    assert.equal( redisQuitCountData, 1 );
});
