import {layerSystemSchemaNameAssert} from './system-schema.js';

/**
 * @typedef {object} LayerSqlQuery
 * @property {string} text
 * @property {readonly unknown[]} values
 */

/**
 * @typedef {object} LayerQueryResult
 * @property {Record<string, unknown>[]} rows
 * @property {number | null} rowCount
 */

/**
 * @typedef {object} LayerTransactionClient
 * @property {(queryData: LayerSqlQuery) => Promise<LayerQueryResult>} query
 */

/**
 * @param {unknown} queryData
 * @returns {asserts queryData is LayerSqlQuery}
 */
function sqlQueryAssert(queryData) {
    //Checking the query object before reaching the PostgreSQL driver.
    if (typeof queryData !== 'object' || queryData === null || Array.isArray(queryData)) {
        throw new TypeError('SQL query data must be an object.');

    }

    const queryRecord = /** @type {Record<string, unknown>} */ (queryData);

    //Checking explicit text and values to discourage payload interpolation.
    if (typeof queryRecord.text !== 'string' || queryRecord.text.trim().length === 0 || !Array.isArray(queryRecord.values)) {
        throw new TypeError('SQL query data requires text and values.');

    }

}

/**
 * @param {object} databaseOptions
 * @param {string} [databaseOptions.connectionString]
 * @param {import('pg').PoolConfig} [databaseOptions.connectionOptions]
 * @param {number} [databaseOptions.maxConnections]
 * @param {number} [databaseOptions.connectionTimeoutMs]
 * @param {number} [databaseOptions.statementTimeoutMs]
 * @param {string} [databaseOptions.applicationName]
 * @param {string} [databaseOptions.systemSchema]
 * @param {(poolOptions: import('pg').PoolConfig) => import('pg').Pool | Promise<import('pg').Pool>} [databaseOptions.poolCreate]
 */
export function layerPostgresDatabaseCreate(databaseOptions) {
    const maxConnections = databaseOptions.maxConnections ?? 10;
    const connectionTimeoutMs = databaseOptions.connectionTimeoutMs ?? 5000;
    const statementTimeoutMs = databaseOptions.statementTimeoutMs ?? 10000;
    const applicationName = databaseOptions.applicationName ?? 'layer-engine';
    const systemSchema = databaseOptions.systemSchema ?? 'layer_engine';
    const poolCreate = databaseOptions.poolCreate ?? null;

    //Checking database configuration before creating external resources
    if (
        (typeof databaseOptions.connectionString !== 'string' || databaseOptions.connectionString.length === 0) &&
        (typeof databaseOptions.connectionOptions !== 'object' || databaseOptions.connectionOptions === null)
    ){
        throw new TypeError('A PostgreSQL connection string or connection options are required.');

    }

    //Checking the app-specific system schema before creating SQL adapters
    if ( String( systemSchema ) !== String( 'layer_engine' ) ){
        layerSystemSchemaNameAssert( systemSchema );

    }

    if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 100) {
        throw new TypeError('maxConnections must be between 1 and 100.');

    }

    let databasePool = /** @type {import('pg').Pool | null} */ (null);
    let readyStatus = false;
    let closedStatus = false;

    /**
     * @param {import('pg').PoolClient | import('pg').Pool} queryTarget
     * @param {LayerSqlQuery} queryData
     * @returns {Promise<LayerQueryResult>}
     */
    async function queryExecute(queryTarget, queryData) {
        sqlQueryAssert(queryData);

        //Sending parameterized query text and values separately.
        const queryResult = await queryTarget.query(queryData.text, [...queryData.values]);

        return {
            rows: /** @type {Record<string, unknown>[]} */ (queryResult.rows),
            rowCount: queryResult.rowCount
        };

    }

    return Object.freeze({
        kind: 'postgres',
        systemSchema,

        async connect() {
            //Loading the PostgreSQL driver only when an external cluster is actually selected.
            if ( databasePool === null ){
                const poolOptionsData = {
                    ...databaseOptions.connectionOptions,
                    connectionString: databaseOptions.connectionString,
                    max: maxConnections,
                    connectionTimeoutMillis: connectionTimeoutMs,
                    statement_timeout: statementTimeoutMs,
                    application_name: applicationName
                };

                if ( poolCreate !== null ){
                    databasePool = await poolCreate( poolOptionsData );

                } else {
                    const postgresModuleData = await import( 'pg' );
                    databasePool = new postgresModuleData.Pool( poolOptionsData );

                }

                databasePool.on?.('error', function postgresPoolErrorHandle(){
                    //Removing readiness instead of letting an idle-client error terminate Node.
                    readyStatus = false;

                });

            }

            //Checking connectivity before marking the runtime ready.
            await queryExecute(databasePool, {
                text: 'SELECT 1 AS health',
                values: []
            });

            readyStatus = true;

        },

        /**
         * @param {LayerSqlQuery} queryData
         */
        async query(queryData) {
            //Rejecting queries before startup or after shutdown.
            if (!readyStatus || closedStatus || databasePool === null) {
                throw new Error('The PostgreSQL pool is not ready.');

            }

            return queryExecute(databasePool, queryData);

        },

        /**
         * @template TransactionResult
         * @param {(transactionClient: LayerTransactionClient) => Promise<TransactionResult>} transactionHandler
         * @returns {Promise<TransactionResult>}
         */
        async transaction(transactionHandler) {
            //Rejecting transactions before startup or after shutdown.
            if (!readyStatus || closedStatus || databasePool === null) {
                throw new Error('The PostgreSQL pool is not ready.');

            }

            const databaseClient = await databasePool.connect();
            const transactionClient = Object.freeze({
                kind: 'postgres',
                systemSchema,

                /**
                 * @param {LayerSqlQuery} queryData
                 */
                query(queryData) {
                    //Routing repository queries through the dedicated transaction connection.
                    return queryExecute(databaseClient, queryData);

                }
            });

            try {
                //Starting the database transaction before calling domain code.
                await databaseClient.query('BEGIN');

                const transactionResult = await transactionHandler(transactionClient);

                //Committing only after every awaited operation succeeds.
                await databaseClient.query('COMMIT');

                return transactionResult;

            } catch (transactionError) {
                try {
                    //Rolling back the failed transaction before releasing its connection.
                    await databaseClient.query('ROLLBACK');

                } catch (rollbackError) {
                    //Preserving the primary transaction error when rollback also fails.
                    void rollbackError;

                }

                throw transactionError;

            } finally {
                //Returning the dedicated client to the bounded pool.
                databaseClient.release();

            }

        },

        async healthCheck() {
            if ( closedStatus || databasePool === null ){
                throw new Error('The PostgreSQL pool is not ready.');

            }

            try {
                //Probing the pool directly so readiness can recover after transport return.
                await queryExecute(databasePool, {
                    text: 'SELECT 1 AS health',
                    values: []
                });
                readyStatus = true;

                return true;

            } catch ( healthErrorData ){
                readyStatus = false;

                throw healthErrorData;

            }

        },

        async close() {
            //Making shutdown idempotent for repeated lifecycle signals.
            if (closedStatus) {
                return;

            }

            readyStatus = false;
            closedStatus = true;
            if ( databasePool !== null ){
                await databasePool.end();
                databasePool = null;

            }

        },

        isReady() {
            //Reporting readiness without exposing pool configuration.
            return readyStatus && !closedStatus;

        }
    });

}
