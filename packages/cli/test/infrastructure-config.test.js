import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LayerCliError,
    layerConfigPublicCreate,
    layerConfigValidate,
    layerInfrastructureConfigurationRedact,
    layerProductionSecretsAssert
} from '../src/index.js';


//Function for creating one valid external infrastructure configuration
const externalInfrastructureConfigCreate = function(){
    //CallBack THE OBJECT
    return {
        appName: 'message-service',
        database: {
            postgres: [{
                name: 'primary',
                role: 'primary',
                host: 'database.example.com',
                port: 5432,
                database: 'layer_application',
                username: 'layer_application',
                password: {
                    env: 'LAYER_POSTGRES_PRIMARY_PASSWORD'
                }
            }, {
                name: 'replica-one',
                role: 'replica',
                host: '2001:db8::10',
                port: 5432,
                database: 'layer_application',
                username: 'layer_application_read',
                password: {
                    env: 'LAYER_POSTGRES_REPLICA_PASSWORD'
                },
                tls: {
                    mode: 'verify-full',
                    serverName: 'replica.example.com',
                    caFile: 'certificates/postgres-ca.pem'
                }
            }],
            pool: {
                maximumConnectionsPerWorker: 5,
                connectionBudget: 40
            }
        },
        redis: {
            host: 'cache.example.com',
            port: 6379,
            username: 'layer_application',
            password: {
                env: 'LAYER_REDIS_PASSWORD'
            },
            database: 2
        },
        runtime: {
            workers: {
                minimum: 2,
                maximum: 'auto'
            }
        }
    };

};

test('infrastructure config defaults to one embedded worker', function(){
    //Creating the default application configuration without external services
    const configData = layerConfigValidate({
        appName: 'embedded-application'
    });

    //Checking the embedded runtime remains local and single-process by default
    assert.deepEqual( configData.database.postgres, [] );
    assert.deepEqual( configData.database.embedded, {
        dataDirectory: null
    });
    assert.deepEqual( configData.runtime.workers, {
        minimum: 1,
        maximum: 1
    });
    assert.equal( configData.redis, null );

});

test('infrastructure config accepts one primary, replicas, Redis, TLS, and auto workers', function(){
    //Normalizing a complete external topology through the public config boundary
    const configData = layerConfigValidate( externalInfrastructureConfigCreate() );
    const primaryConnectionData = configData.database.postgres[0];
    const replicaConnectionData = configData.database.postgres[1];

    assert.ok( primaryConnectionData );
    assert.ok( replicaConnectionData );

    //Checking network identities, secure defaults, and worker policy
    assert.equal( configData.database.postgres.length, 2 );
    assert.equal( primaryConnectionData.role, 'primary' );
    assert.equal( primaryConnectionData.tls.mode, 'verify-full' );
    assert.equal( replicaConnectionData.host, '2001:db8::10' );
    assert.equal( configData.database.replica.maximumLagMs, 2000 );
    assert.equal( configData.redis?.tls.mode, 'verify-full' );
    assert.deepEqual( configData.runtime.workers, {
        minimum: 2,
        maximum: 'auto'
    });

});

test('infrastructure config permits passwordless loopback services only', function(){
    //Creating the local stable stand without PostgreSQL or Redis passwords
    const configData = layerConfigValidate({
        appName: 'local-stable-stand',
        database: {
            postgres: [{
                name: 'primary',
                role: 'primary',
                host: '127.0.0.1',
                port: 5432,
                database: 'layer_stable_messenger',
                username: 'postgres',
                password: null,
                tls: {
                    mode: 'disable'
                }
            }]
        },
        redis: {
            host: 'localhost',
            port: 6379,
            username: null,
            password: null,
            database: 15,
            tls: {
                mode: 'disable'
            }
        }
    });

    //Checking local absence remains explicit through runtime and diagnostics
    assert.equal( configData.database.postgres[0]?.password, null );
    assert.equal( configData.redis?.password, null );
    assert.equal( layerConfigPublicCreate( configData ).database.postgres[0]?.password, null );
    assert.doesNotThrow(function productionLoopbackSecretsAssert(){
        //Applying the production policy to the loopback-only stable stand
        layerProductionSecretsAssert( configData.database, configData.redis );

    });

    //Checking the same unauthenticated contract cannot be moved to a remote host
    assert.throws(function remotePasswordlessPostgresValidate(){
        //Validating a remote endpoint without authentication data
        layerConfigValidate({
            appName: 'remote-passwordless',
            database: {
                postgres: [{
                    name: 'primary',
                    role: 'primary',
                    host: 'database.example.com',
                    port: 5432,
                    database: 'layer_application',
                    username: 'layer_application',
                    password: null
                }]
            }
        });

    }, function remotePasswordlessErrorCheck( errorData ){
        //Checking the stable configuration failure code
        return errorData instanceof LayerCliError && errorData.code === 'CLI_CONFIG_INVALID';

    });

});

test('infrastructure config rejects unsafe topology, hosts, secrets, and worker ranges', function(){
    const invalidConfigurationsData = [
        {
            appName: 'invalid-host',
            database: {
                postgres: [{
                    name: 'primary',
                    role: 'primary',
                    host: '999.999.999.999',
                    port: 5432,
                    database: 'layer_application',
                    username: 'layer_application',
                    password: 'development-only'
                }]
            }
        },
        {
            appName: 'replica-without-primary',
            database: {
                postgres: [{
                    name: 'replica',
                    role: 'replica',
                    host: 'database.example.com',
                    port: 5432,
                    database: 'layer_application',
                    username: 'layer_application',
                    password: 'development-only'
                }]
            }
        },
        {
            appName: 'plaintext-remote',
            redis: {
                host: 'cache.example.com',
                port: 6379,
                password: 'development-only',
                tls: {
                    mode: 'disable'
                }
            }
        },
        {
            appName: 'empty-secret',
            redis: {
                host: '127.0.0.1',
                port: 6379,
                password: ''
            }
        },
        {
            appName: 'embedded-cluster',
            runtime: {
                workers: {
                    minimum: 2,
                    maximum: 2
                }
            }
        },
        {
            appName: 'auto-without-budget',
            database: {
                ...externalInfrastructureConfigCreate().database,
                pool: {
                    maximumConnectionsPerWorker: 5,
                    connectionBudget: null
                }
            },
            runtime: {
                workers: {
                    minimum: 1,
                    maximum: 'auto'
                }
            }
        },
        {
            appName: 'invalid-ca-path',
            redis: {
                host: 'cache.example.com',
                port: 6379,
                password: {
                    env: 'LAYER_REDIS_PASSWORD'
                },
                tls: {
                    mode: 'verify-full',
                    caFile: '../private-ca.pem'
                }
            }
        }
    ];

    //Checking every unsafe topology fails before any network connection is created
    for ( const invalidConfigurationData of invalidConfigurationsData ){
        assert.throws(function invalidInfrastructureConfigValidate(){
            //Validating the current rejected infrastructure shape
            layerConfigValidate( invalidConfigurationData );

        }, LayerCliError);

    }

});

test('production secrets require ENV references and inspect data is redacted', function(){
    //Creating a valid development configuration with literal local secrets
    const literalSecretConfigData = layerConfigValidate({
        appName: 'literal-secret-test',
        database: {
            postgres: [{
                name: 'primary',
                role: 'primary',
                host: '127.0.0.1',
                port: 5432,
                database: 'layer_application',
                username: 'layer_application',
                password: 'literal-postgres-secret'
            }]
        },
        redis: {
            host: '127.0.0.1',
            port: 6379,
            password: 'literal-redis-secret'
        }
    });

    //Checking production build rejects literal credentials without serializing them
    assert.throws(function productionLiteralSecretsAssert(){
        //Applying the production-only secret policy
        layerProductionSecretsAssert( literalSecretConfigData.database, literalSecretConfigData.redis );

    }, function productionLiteralErrorCheck( errorData ){
        //Checking the stable error without matching either secret value
        return errorData instanceof LayerCliError && errorData.code === 'CLI_PRODUCTION_SECRET_LITERAL';

    });

    //Creating diagnostics-safe copies while keeping trusted runtime configuration unchanged
    const publicInfrastructureData = layerInfrastructureConfigurationRedact(
        literalSecretConfigData.database,
        literalSecretConfigData.redis
    );
    const publicConfigData = layerConfigPublicCreate( literalSecretConfigData );
    const publicConfigSourceData = JSON.stringify( publicConfigData );
    const publicPrimaryConnectionData = publicInfrastructureData.database.postgres[0];
    const trustedPrimaryConnectionData = literalSecretConfigData.database.postgres[0];

    assert.ok( publicPrimaryConnectionData );
    assert.ok( trustedPrimaryConnectionData );

    assert.equal( publicPrimaryConnectionData.password, '[REDACTED]' );
    assert.equal( publicInfrastructureData.redis?.password, '[REDACTED]' );
    assert.equal( publicConfigSourceData.includes( 'literal-postgres-secret' ), false );
    assert.equal( publicConfigSourceData.includes( 'literal-redis-secret' ), false );
    assert.equal( trustedPrimaryConnectionData.password, 'literal-postgres-secret' );

    //Checking ENV-backed production credentials remain accepted and diagnosable by name
    const environmentSecretConfigData = layerConfigValidate( externalInfrastructureConfigCreate() );
    layerProductionSecretsAssert( environmentSecretConfigData.database, environmentSecretConfigData.redis );

    const environmentPublicConfigData = layerConfigPublicCreate( environmentSecretConfigData );
    const environmentPrimaryConnectionData = environmentPublicConfigData.database.postgres[0];

    assert.ok( environmentPrimaryConnectionData );

    assert.deepEqual( environmentPrimaryConnectionData.password, {
        env: 'LAYER_POSTGRES_PRIMARY_PASSWORD'
    });

});
