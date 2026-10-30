import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LayerDatabaseError,
    layerPostgresClusterCreate
} from '../src/index.js';


/**
 * @param {object} fakeOptionsData
 * @param {boolean} fakeOptionsData.recovery
 * @param {number} [fakeOptionsData.lagMs]
 * @param {boolean} [fakeOptionsData.applicationFailure]
 * @param {boolean} [fakeOptionsData.healthFailure]
 */
function clusterDatabaseFakeCreate( fakeOptionsData ){
    const queryCallsData = /** @type {{text: string, values: readonly unknown[], consistency?: string}[]} */ ([]);
    let connectedStatusData = false;
    let closedStatusData = false;
    let transactionCountData = Number( 0 );

    //CallBack THE OBJECT
    return {
        database: {
            kind: /** @type {'postgres'} */ ('postgres'),
            systemSchema: 'layer_cluster_test',

            async connect(){
                //Marking this controlled adapter ready for role probes
                connectedStatusData = true;

            },

            async query( /** @type {{text: string, values: readonly unknown[], consistency?: 'strong' | 'eventual'}} */ queryData ){
                //Recording routed queries for primary and replica assertions
                queryCallsData.push( queryData );

                if ( queryData.text.includes( 'pg_is_in_recovery' ) === true ){
                    return {
                        rows: [{
                            in_recovery: fakeOptionsData.recovery
                        }],
                        rowCount: 1
                    };

                }

                if ( queryData.text.includes( 'pg_last_xact_replay_timestamp' ) === true ){
                    return {
                        rows: [{
                            lag_ms: fakeOptionsData.lagMs ?? 0
                        }],
                        rowCount: 1
                    };

                }

                if ( fakeOptionsData.applicationFailure === true ){
                    throw new Error( 'application query failed' );

                }

                return {
                    rows: [{
                        source: fakeOptionsData.recovery === true ? 'replica' : 'primary'
                    }],
                    rowCount: 1
                };

            },

            /**
             * @template ResultData
             * @param {(transactionClientData: any) => Promise<ResultData>} transactionHandlerData
             * @returns {Promise<ResultData>}
             */
            async transaction( transactionHandlerData ){
                //Recording that transactions never use replica adapters
                transactionCountData += Number( 1 );

                //CallBack THE OBJECT
                return transactionHandlerData({
                    kind: 'postgres',
                    systemSchema: 'layer_cluster_test',
                    query: this.query
                });

            },

            async healthCheck(){
                //Simulating a transport health failure when requested by the test
                if ( fakeOptionsData.healthFailure === true ){
                    throw new Error( 'health failed' );

                }

                //CallBack THE BOOLEAN
                return true;

            },

            async close(){
                //Marking the controlled pool closed for lifecycle assertions
                connectedStatusData = false;
                closedStatusData = true;

            },

            isReady(){
                //CallBack THE BOOLEAN
                return connectedStatusData === true && closedStatusData === false;

            }
        },
        queryCalls: queryCallsData,
        transactionCountGet(){
            //CallBack THE NUMBER
            return transactionCountData;

        },
        closedStatusGet(){
            //CallBack THE BOOLEAN
            return closedStatusData;

        }
    };

}

//Function for creating one primary and one replica cluster fixture
const clusterFixtureCreate = function( replicaOptionsData = {} ){
    const primaryFakeData = clusterDatabaseFakeCreate({
        recovery: false
    });
    const replicaFakeData = clusterDatabaseFakeCreate({
        recovery: true,
        ...replicaOptionsData
    });
    const databaseMapData = new Map([
        ['primary', primaryFakeData],
        ['replica-one', replicaFakeData]
    ]);
    const clusterData = layerPostgresClusterCreate({
        connections: [{
            name: 'primary',
            role: 'primary',
            connectionOptions: {
                host: 'primary.example.com'
            }
        }, {
            name: 'replica-one',
            role: 'replica',
            connectionOptions: {
                host: 'replica.example.com'
            }
        }],
        systemSchema: 'layer_cluster_test',
        maximumConnectionsPerWorker: 5,
        maximumLagMs: 2000,
        databaseCreate( connectionData ){
            //Getting the controlled adapter for the configured connection name
            const fakeData = databaseMapData.get( connectionData.name );

            if ( fakeData === undefined ){
                throw new Error( 'Missing fake database.' );

            }

            //CallBack THE OBJECT
            return fakeData.database;

        }
    });

    //CallBack THE OBJECT
    return {
        cluster: clusterData,
        primary: primaryFakeData,
        replica: replicaFakeData
    };

};

test( 'SQL statement failures preserve primary readiness and do not retry on another server', async function(){
    const fixtureData = clusterFixtureCreate();
    await fixtureData.cluster.connect();
    const originalPrimaryQueryData = fixtureData.primary.database.query;
    let errorCodeData = '23505';
    fixtureData.primary.database.query = async function( queryData ){
        //Simulating real PostgreSQL SQLSTATE failures on application statements only
        if ( queryData.text === 'SELECT invalid' ){
            throw Object.assign( new Error( 'Statement rejected' ), {code: errorCodeData} );

        }

        return originalPrimaryQueryData( queryData );

    };

    for ( const currentCodeData of ['23505', '23503', '42601', '42501', '40001', '40P01', '57014'] ){
        errorCodeData = currentCodeData;
        await assert.rejects( fixtureData.cluster.query({text: 'SELECT invalid', values: []}), {code: currentCodeData} );
        assert.equal( fixtureData.cluster.isReady(), true );
        await fixtureData.cluster.query({text: 'SELECT valid', values: []});

    }

    const callsBeforeData = fixtureData.primary.queryCalls.length;
    fixtureData.replica.database.query = async function(){
        //A query syntax error must not be executed again against primary
        throw Object.assign( new Error( 'Syntax rejected' ), {code: '42601'} );

    };
    await assert.rejects( fixtureData.cluster.query({text: 'invalid', values: [], consistency: 'eventual'}), {code: '42601'} );
    assert.equal( fixtureData.primary.queryCalls.length, callsBeforeData );
    errorCodeData = '08006';
    await assert.rejects( fixtureData.cluster.query({text: 'SELECT invalid', values: []}), {code: '08006'} );
    assert.equal( fixtureData.cluster.isReady(), false );
    await fixtureData.cluster.close();

});

test( 'optional replica connect failure closes its pool and recovers on a later health check', async function(){
    const primaryData = clusterDatabaseFakeCreate({recovery: false});
    const failedReplicaData = clusterDatabaseFakeCreate({recovery: true});
    const recoveredReplicaData = clusterDatabaseFakeCreate({recovery: true});
    let replicaCreationsData = 0;
    failedReplicaData.database.connect = async function(){
        //Failing before readiness while the adapter already owns a partially initialized pool
        throw Object.assign( new Error( 'Test transport failure' ), {code: 'ECONNREFUSED'} );

    };
    const clusterData = layerPostgresClusterCreate({
        systemSchema: 'layer_cluster_test',
        connections: [
            {name: 'primary', role: 'primary', connectionOptions: {host: 'primary.example.com'}},
            {name: 'replica-one', role: 'replica', connectionOptions: {host: 'replica.example.com'}}
        ],
        databaseCreate( connectionData ){
            //Returning a fresh optional adapter after the failed one has been closed
            if ( connectionData.role === 'primary' ){
                return primaryData.database;

            }

            replicaCreationsData += 1;

            if ( replicaCreationsData === 1 ){
                return failedReplicaData.database;

            }

            return recoveredReplicaData.database;

        }
    });

    await clusterData.connect();
    assert.equal( clusterData.isReady(), true );
    assert.equal( failedReplicaData.closedStatusGet(), true );
    assert.equal( (await clusterData.query({text: 'SELECT data', values: [], consistency: 'eventual'})).rows[0]?.source, 'primary' );
    await clusterData.healthCheck();
    assert.equal( replicaCreationsData, 2 );
    assert.equal( (await clusterData.query({text: 'SELECT data', values: [], consistency: 'eventual'})).rows[0]?.source, 'replica' );
    await clusterData.close();
    assert.equal( await clusterData.healthCheck(), false );
    assert.equal( replicaCreationsData, 2 );

});

test('PostgreSQL cluster routes strong writes to primary and eventual reads to replica', async function(){
    const fixtureData = clusterFixtureCreate();

    await fixtureData.cluster.connect();

    const strongResultData = await fixtureData.cluster.query({
        text: 'SELECT strong_data',
        values: [],
        consistency: 'strong'
    });
    const eventualResultData = await fixtureData.cluster.query({
        text: 'SELECT eventual_data',
        values: [],
        consistency: 'eventual'
    });

    assert.equal( strongResultData.rows[0]?.source, 'primary' );
    assert.equal( eventualResultData.rows[0]?.source, 'replica' );
    assert.equal( fixtureData.primary.queryCalls.some(function strongQueryFind( queryData ){
        //Finding the application strong query outside topology probes
        return queryData.text === 'SELECT strong_data';

    }), true );
    assert.equal( fixtureData.replica.queryCalls.some(function eventualQueryFind( queryData ){
        //Finding the application eventual query outside topology probes
        return queryData.text === 'SELECT eventual_data';

    }), true );

    await fixtureData.cluster.transaction(async function primaryTransactionExecute(){
        //CallBack THE STRING
        return String( 'committed' );

    });

    assert.equal( fixtureData.primary.transactionCountGet(), 1 );
    assert.equal( fixtureData.replica.transactionCountGet(), 0 );

    await fixtureData.cluster.close();

    assert.equal( fixtureData.primary.closedStatusGet(), true );
    assert.equal( fixtureData.replica.closedStatusGet(), true );

});

test('PostgreSQL cluster excludes lagging and failed replicas with primary fallback', async function(){
    const laggingFixtureData = clusterFixtureCreate({
        lagMs: 5000
    });

    await laggingFixtureData.cluster.connect();

    const lagFallbackResultData = await laggingFixtureData.cluster.query({
        text: 'SELECT lag_fallback',
        values: [],
        consistency: 'eventual'
    });

    assert.equal( lagFallbackResultData.rows[0]?.source, 'primary' );
    assert.equal( laggingFixtureData.replica.queryCalls.some(function lagQueryFind( queryData ){
        //Checking the lagging replica never receives the application query
        return queryData.text === 'SELECT lag_fallback';

    }), false );

    await laggingFixtureData.cluster.close();

    const failedFixtureData = clusterFixtureCreate({
        applicationFailure: true
    });

    await failedFixtureData.cluster.connect();

    const failureFallbackResultData = await failedFixtureData.cluster.query({
        text: 'SELECT failure_fallback',
        values: [],
        consistency: 'eventual'
    });

    assert.equal( failureFallbackResultData.rows[0]?.source, 'primary' );
    assert.equal( failedFixtureData.replica.queryCalls.some(function failedQueryFind( queryData ){
        //Checking the failed replica received one application attempt before exclusion
        return queryData.text === 'SELECT failure_fallback';

    }), true );

    await failedFixtureData.cluster.close();

});

test('PostgreSQL cluster rejects a recovery primary and does not promote replicas', async function(){
    const primaryFakeData = clusterDatabaseFakeCreate({
        recovery: true
    });
    const clusterData = layerPostgresClusterCreate({
        connections: [{
            name: 'primary',
            role: 'primary',
            connectionOptions: {
                host: 'primary.example.com'
            }
        }],
        systemSchema: 'layer_cluster_test',
        databaseCreate(){
            //CallBack THE OBJECT
            return primaryFakeData.database;

        }
    });

    await assert.rejects(function invalidPrimaryConnect(){
        //Starting the cluster with a server that reports recovery mode
        return clusterData.connect();

    }, function invalidPrimaryErrorCheck( errorData ){
        //Checking topology failure remains stable and contains no connection secret
        return errorData instanceof LayerDatabaseError && errorData.code === 'DATABASE_TOPOLOGY_INVALID';

    });
    assert.equal( clusterData.isReady(), false );
    assert.equal( primaryFakeData.closedStatusGet(), true );

});

test('PostgreSQL cluster marks primary loss not-ready until operator recovery', async function(){
    const primaryFakeData = clusterDatabaseFakeCreate({
        recovery: false
    });
    const clusterData = layerPostgresClusterCreate({
        connections: [{
            name: 'primary',
            role: 'primary',
            connectionOptions: {
                host: 'primary.example.com'
            }
        }],
        systemSchema: 'layer_cluster_test',
        databaseCreate(){
            //CallBack THE OBJECT
            return primaryFakeData.database;

        }
    });

    await clusterData.connect();
    assert.equal( clusterData.isReady(), true );

    //Changing the controlled primary behavior after successful startup
    const failingPrimaryData = clusterDatabaseFakeCreate({
        recovery: false,
        applicationFailure: true
    });
    const failingClusterData = layerPostgresClusterCreate({
        connections: [{
            name: 'primary',
            role: 'primary',
            connectionOptions: {
                host: 'primary.example.com'
            }
        }],
        systemSchema: 'layer_cluster_test',
        databaseCreate(){
            //CallBack THE OBJECT
            return failingPrimaryData.database;

        }
    });

    await failingClusterData.connect();
    await assert.rejects(function primaryQueryExecute(){
        //Sending a strong query that simulates primary loss
        return failingClusterData.query({
            text: 'SELECT write_dependency',
            values: [],
            consistency: 'strong'
        });

    }, /application query failed/);
    assert.equal( failingClusterData.isReady(), false );
    await assert.rejects(function unavailableTransactionExecute(){
        //Checking no transaction is routed to a replica after primary loss
        return failingClusterData.transaction(async function unusedTransaction(){
            //CallBack THE BOOLEAN
            return true;

        });

    }, function primaryUnavailableErrorCheck( errorData ){
        //Checking the stable not-ready contract
        return errorData instanceof LayerDatabaseError && errorData.code === 'DATABASE_DEPENDENCY_UNAVAILABLE';

    });

    await clusterData.close();
    await failingClusterData.close();

});
