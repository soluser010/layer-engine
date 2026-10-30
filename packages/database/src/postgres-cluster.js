import {LayerDatabaseError} from './database-error.js';
import {layerPostgresDatabaseCreate} from './postgres-database.js';
import {layerSystemSchemaNameAssert} from './system-schema.js';

/**
 * @typedef {object} LayerClusterQuery
 * @property {string} text
 * @property {readonly unknown[]} values
 * @property {'strong' | 'eventual'} [consistency]
 * @typedef {object} LayerClusterQueryResult
 * @property {Record<string, unknown>[]} rows
 * @property {number | null} rowCount
 * @typedef {object} LayerClusterDatabase
 * @property {'postgres'} kind
 * @property {string} systemSchema
 * @property {() => Promise<void>} connect
 * @property {(queryData: LayerClusterQuery) => Promise<LayerClusterQueryResult>} query
 * @property {<ResultData>(handlerData: (transactionClientData: any) => Promise<ResultData>) => Promise<ResultData>} transaction
 * @property {() => Promise<boolean>} healthCheck
 * @property {() => Promise<void>} close
 * @property {() => boolean} isReady
 * @typedef {object} LayerClusterConnection
 * @property {string} name
 * @property {'primary' | 'replica'} role
 * @property {import('pg').PoolConfig} connectionOptions
 * @typedef {object} LayerClusterConnectionState
 * @property {LayerClusterConnection} config
 * @property {LayerClusterDatabase | null} database
 * @property {boolean} healthy
 * @property {number} lagMs
 */

/**
 * @param {string} codeData
 * @param {string} messageData
 * @returns {never}
 */
function clusterErrorThrow( codeData, messageData ){
    //Passing a stable topology failure without connection details
    throw new LayerDatabaseError( codeData, messageData );

}

/**
 * @param {unknown} valueData
 * @returns {valueData is Record<string, unknown>}
 */
function plainObjectCheck( valueData ){
    //Checking cluster records without accepting arrays or null
    return typeof valueData === 'object' && valueData !== null && Array.isArray( valueData ) === false;

}

/** @param {unknown} errorData */
const connectionFailureCheck = function( errorData ){
    //Keeping statement errors separate from transport loss and server shutdown
    const errorCodeData = /** @type {{code?: unknown} | null} */ (errorData)?.code;

    if ( typeof errorCodeData === 'string' && /^[0-9A-Z]{5}$/.test( errorCodeData ) ){
        //SQLSTATE 08 denotes connection failure; these 57P codes denote unavailable servers
        return errorCodeData.startsWith( '08' ) || ['57P01', '57P02', '57P03', '57P04'].includes( errorCodeData );

    }

    //Unknown driver/transport failures remain fail-closed until the next health probe
    return true;

};

/**
 * @param {LayerClusterDatabase} databaseData
 * @returns {Promise<boolean>}
 */
async function recoveryStatusRead( databaseData ){
    //Asking PostgreSQL for its actual recovery role instead of trusting configuration
    const roleResultData = await databaseData.query({
        text: 'SELECT pg_is_in_recovery() AS in_recovery',
        values: [],
        consistency: 'strong'
    });

    //Checking the server returned an explicit PostgreSQL boolean
    if ( typeof roleResultData.rows[0]?.in_recovery !== 'boolean' ){
        return clusterErrorThrow( 'DATABASE_TOPOLOGY_INVALID', 'PostgreSQL role probe returned an invalid result.' );

    }

    //CallBack THE BOOLEAN
    return roleResultData.rows[0].in_recovery;

}

/**
 * @param {LayerClusterDatabase} databaseData
 * @returns {Promise<number>}
 */
async function replicaLagRead( databaseData ){
    //Reading replay delay in milliseconds while treating an idle replica as zero lag
    const lagResultData = await databaseData.query({
        text: `
            SELECT COALESCE(
                EXTRACT(EPOCH FROM (clock_timestamp() - pg_last_xact_replay_timestamp())) * 1000,
                0
            ) AS lag_ms
        `,
        values: [],
        consistency: 'strong'
    });
    const lagData = Number( lagResultData.rows[0]?.lag_ms );

    //Checking lag before it can control eventual-consistency routing
    if ( Number.isFinite( lagData ) === false || Number( lagData ) < Number( 0 ) ){
        return clusterErrorThrow( 'DATABASE_REPLICA_UNHEALTHY', 'PostgreSQL replica lag probe returned an invalid result.' );

    }

    //CallBack THE NUMBER
    return lagData;

}

/**
 * @param {object} clusterOptionsData
 * @param {readonly LayerClusterConnection[]} clusterOptionsData.connections
 * @param {string} clusterOptionsData.systemSchema
 * @param {number} [clusterOptionsData.maximumConnectionsPerWorker]
 * @param {number} [clusterOptionsData.maximumLagMs]
 * @param {string} [clusterOptionsData.applicationName]
 * @param {(connectionData: LayerClusterConnection, databaseOptionsData: Record<string, unknown>) => LayerClusterDatabase} [clusterOptionsData.databaseCreate]
 */
export const layerPostgresClusterCreate = function( clusterOptionsData ){
    //Checking the cluster contract before creating any connection pools
    if (
        plainObjectCheck( clusterOptionsData ) === false ||
        Array.isArray( clusterOptionsData.connections ) === false ||
        Number( clusterOptionsData.connections.length ) < Number( 1 )
    ){
        return clusterErrorThrow( 'DATABASE_CONFIGURATION_INVALID', 'PostgreSQL cluster configuration is invalid.' );

    }

    const systemSchemaData = layerSystemSchemaNameAssert( clusterOptionsData.systemSchema );
    const maximumConnectionsData = clusterOptionsData.maximumConnectionsPerWorker ?? 5;
    const maximumLagData = clusterOptionsData.maximumLagMs ?? 2000;
    const applicationNameData = clusterOptionsData.applicationName ?? 'layer-engine';

    //Checking bounded connection and replica lag budgets
    if (
        Number.isInteger( maximumConnectionsData ) === false ||
        Number( maximumConnectionsData ) < Number( 1 ) ||
        Number( maximumConnectionsData ) > Number( 100 ) ||
        Number.isInteger( maximumLagData ) === false ||
        Number( maximumLagData ) < Number( 0 ) ||
        Number( maximumLagData ) > Number( 600000 )
    ){
        return clusterErrorThrow( 'DATABASE_CONFIGURATION_INVALID', 'PostgreSQL cluster limits are invalid.' );

    }

    const connectionNamesData = new Set();
    const connectionStatesData = /** @type {LayerClusterConnectionState[]} */ ([]);
    let primaryCountData = Number( 0 );

    //Validating and preparing every configured connection in one logical cluster
    for ( const connectionData of clusterOptionsData.connections ){
        if (
            plainObjectCheck( connectionData ) === false ||
            typeof connectionData.name !== 'string' ||
            /^[a-z][a-z0-9-]{0,79}$/.test( connectionData.name ) === false ||
            connectionNamesData.has( connectionData.name ) === true ||
            (connectionData.role !== 'primary' && connectionData.role !== 'replica') ||
            plainObjectCheck( connectionData.connectionOptions ) === false
        ){
            return clusterErrorThrow( 'DATABASE_CONFIGURATION_INVALID', 'PostgreSQL cluster connection is invalid.' );

        }

        if ( connectionData.role === 'primary' ){
            primaryCountData += Number( 1 );

        }

        connectionNamesData.add( connectionData.name );
        connectionStatesData.push({
            config: /** @type {LayerClusterConnection} */ (connectionData),
            database: /** @type {LayerClusterDatabase | null} */ (null),
            healthy: false,
            lagMs: Number.POSITIVE_INFINITY
        });

    }

    //Requiring one configured primary without attempting automatic promotion
    if ( Number( primaryCountData ) !== Number( 1 ) ){
        return clusterErrorThrow( 'DATABASE_TOPOLOGY_INVALID', 'PostgreSQL cluster requires exactly one primary.' );

    }

    const databaseCreate = clusterOptionsData.databaseCreate ?? function clusterDatabaseCreate( connectionData, databaseOptionsData ){
        //Creating a bounded PostgreSQL pool for the current worker and server
        return /** @type {LayerClusterDatabase} */ (layerPostgresDatabaseCreate({
            connectionOptions: connectionData.connectionOptions,
            maxConnections: Number( databaseOptionsData.maximumConnections ),
            applicationName: String( databaseOptionsData.applicationName ),
            systemSchema: String( databaseOptionsData.systemSchema )
        }));

    };
    let connectedStatusData = false;
    let closedStatusData = false;
    let primaryReadyStatusData = false;
    let replicaCursorData = Number( 0 );

    //Function for getting the configured primary state
    const primaryStateGet = function(){
        const primaryStateData = connectionStatesData.find(function primaryStateFind( connectionStateData ){
            //Finding the only connection configured as writable primary
            return connectionStateData.config.role === 'primary';

        });

        if ( primaryStateData === undefined ){
            return clusterErrorThrow( 'DATABASE_TOPOLOGY_INVALID', 'PostgreSQL primary is unavailable.' );

        }

        //CallBack THE OBJECT
        return primaryStateData;

    };

    //Function for refreshing one connection role and health state
    const connectionHealthRefresh = async function( /** @type {LayerClusterConnectionState} */ connectionStateData ){
        try {
            //Recreating failed optional pools without reusing a closed adapter
            if ( connectionStateData.database === null ){
                connectionStateData.database = databaseCreate( connectionStateData.config, {
                    maximumConnections: maximumConnectionsData,
                    applicationName: `${String( applicationNameData )}:${String( connectionStateData.config.name )}`,
                    systemSchema: systemSchemaData
                });

                try {
                    await connectionStateData.database.connect();

                } catch( connectionStartErrorData ){
                    //Closing even a partially initialized pool before the next health retry
                    const failedDatabaseData = connectionStateData.database;
                    connectionStateData.database = null;
                    await failedDatabaseData.close();
                    throw connectionStartErrorData;

                }

            }

            const databaseData = connectionStateData.database;
            //Checking transport health before validating the configured server role
            await databaseData.healthCheck();

            const recoveryStatusData = await recoveryStatusRead( databaseData );

            if ( connectionStateData.config.role === 'primary' && recoveryStatusData === true ){
                return clusterErrorThrow( 'DATABASE_TOPOLOGY_INVALID', 'Configured PostgreSQL primary is in recovery.' );

            }

            if ( connectionStateData.config.role === 'replica' && recoveryStatusData === false ){
                return clusterErrorThrow( 'DATABASE_TOPOLOGY_INVALID', 'Configured PostgreSQL replica is writable.' );

            }

            let lagData = Number( 0 );

            if ( connectionStateData.config.role === 'replica' ){
                lagData = await replicaLagRead( databaseData );

            }

            connectionStateData.lagMs = lagData;
            connectionStateData.healthy = true;

        } catch( connectionErrorData ){
            connectionStateData.healthy = false;
            connectionStateData.lagMs = Number.POSITIVE_INFINITY;

            //The configured primary role is a readiness requirement and cannot silently degrade
            if ( connectionStateData.config.role === 'primary' ){
                primaryReadyStatusData = false;

                //Passing the primary failure to startup or health callers
                throw connectionErrorData;

            }

        }

    };

    //Function for selecting one healthy replica using round-robin order
    const healthyReplicaGet = function(){
        const replicaStatesData = connectionStatesData.filter(function replicaStateFilter( connectionStateData ){
            //Keeping only replicas below the configured replay lag threshold
            return (
                connectionStateData.config.role === 'replica' &&
                connectionStateData.healthy === true &&
                Number( connectionStateData.lagMs ) <= Number( maximumLagData )
            );

        });

        if ( Number( replicaStatesData.length ) === Number( 0 ) ){
            //CallBack THE OBJECT
            return null;

        }

        const selectedReplicaData = replicaStatesData[Number( replicaCursorData ) % Number( replicaStatesData.length )];
        replicaCursorData += Number( 1 );

        //CallBack THE OBJECT
        return selectedReplicaData ?? null;

    };

    //CallBack THE OBJECT
    return Object.freeze({
        kind: /** @type {'postgres'} */ ('postgres'),
        systemSchema: systemSchemaData,

        async connect(){
            //Preventing duplicate startup and reuse after cluster shutdown
            if ( connectedStatusData === true || closedStatusData === true ){
                return clusterErrorThrow( 'DATABASE_LIFECYCLE_INVALID', 'PostgreSQL cluster cannot connect in its current state.' );

            }

            try {
                //Creating and verifying every configured connection before readiness
                for ( const connectionStateData of connectionStatesData ){
                    await connectionHealthRefresh( connectionStateData );

                }

                primaryReadyStatusData = primaryStateGet().healthy === true;
                connectedStatusData = primaryReadyStatusData;

            } catch( clusterStartErrorData ){
                //Closing every pool created before the failed topology probe
                for ( const connectionStateData of [...connectionStatesData].reverse() ){
                    if ( connectionStateData.database !== null ){
                        await connectionStateData.database.close();

                    }

                }

                //Passing startup failure without leaving partial pools active
                throw clusterStartErrorData;

            }

        },

        /** @param {LayerClusterQuery} queryData */
        async query( queryData ){
            //Checking cluster readiness before routing a query
            if ( connectedStatusData === false || closedStatusData === true || primaryReadyStatusData === false ){
                return clusterErrorThrow( 'DATABASE_DEPENDENCY_UNAVAILABLE', 'PostgreSQL primary is not ready.' );

            }

            const consistencyData = queryData.consistency ?? 'strong';

            if ( consistencyData !== 'strong' && consistencyData !== 'eventual' ){
                return clusterErrorThrow( 'DATABASE_QUERY_INVALID', 'PostgreSQL query consistency is invalid.' );

            }

            //Trying one healthy replica only for explicit eventual consistency
            if ( consistencyData === 'eventual' ){
                const replicaStateData = healthyReplicaGet();

                if ( replicaStateData !== null && replicaStateData.database !== null ){
                    try {
                        //Sending the eventual query to the selected replica
                        return await replicaStateData.database.query( queryData );

                    } catch( replicaQueryErrorData ){
                        //Avoiding a second execution on primary for invalid SQL or domain constraints
                        if ( connectionFailureCheck( replicaQueryErrorData ) === false ){
                            throw replicaQueryErrorData;

                        }

                        //Removing the failed replica from routing before primary fallback
                        replicaStateData.healthy = false;
                        replicaStateData.lagMs = Number.POSITIVE_INFINITY;

                    }

                }

            }

            const primaryStateData = primaryStateGet();

            if ( primaryStateData.database === null ){
                return clusterErrorThrow( 'DATABASE_DEPENDENCY_UNAVAILABLE', 'PostgreSQL primary is not ready.' );

            }

            try {
                //Routing strong queries and replica fallbacks to the configured primary
                return await primaryStateData.database.query( queryData );

            } catch( primaryQueryErrorData ){
                //Constraint, syntax and cancellation errors do not make a live database unavailable
                if ( connectionFailureCheck( primaryQueryErrorData ) === true ){
                    primaryStateData.healthy = false;
                    primaryReadyStatusData = false;

                }

                //Passing the primary failure without promoting a replica
                throw primaryQueryErrorData;

            }

        },

        /**
         * @template ResultData
         * @param {(transactionClientData: any) => Promise<ResultData>} transactionHandlerData
         * @returns {Promise<ResultData>}
         */
        async transaction( transactionHandlerData ){
            //Checking the configured primary before allocating a write transaction
            if ( connectedStatusData === false || closedStatusData === true || primaryReadyStatusData === false ){
                return clusterErrorThrow( 'DATABASE_DEPENDENCY_UNAVAILABLE', 'PostgreSQL primary is not ready.' );

            }

            const primaryStateData = primaryStateGet();

            if ( primaryStateData.database === null ){
                return clusterErrorThrow( 'DATABASE_DEPENDENCY_UNAVAILABLE', 'PostgreSQL primary is not ready.' );

            }

            //Executing all transactional reads and writes on the configured primary
            return primaryStateData.database.transaction( transactionHandlerData );

        },

        async healthCheck(){
            //Preventing probes from recreating optional pools after shutdown
            if ( closedStatusData === true || connectedStatusData === false ){
                return false;

            }

            //Refreshing all configured roles while allowing unhealthy replicas to fall back
            for ( const connectionStateData of connectionStatesData ){
                await connectionHealthRefresh( connectionStateData );

            }

            primaryReadyStatusData = primaryStateGet().healthy === true;

            //CallBack THE BOOLEAN
            return primaryReadyStatusData;

        },

        async close(){
            //Making cluster shutdown idempotent for repeated lifecycle signals
            if ( closedStatusData === true ){
                return;

            }

            primaryReadyStatusData = false;
            connectedStatusData = false;
            closedStatusData = true;

            //Closing every created pool without exposing connection metadata
            for ( const connectionStateData of connectionStatesData ){
                if ( connectionStateData.database !== null ){
                    await connectionStateData.database.close();

                }

                connectionStateData.healthy = false;

            }

        },

        isReady(){
            //Reporting write readiness because reads cannot replace a lost primary
            return connectedStatusData === true && closedStatusData === false && primaryReadyStatusData === true;

        }
    });

};
