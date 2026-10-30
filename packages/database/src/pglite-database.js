import {randomUUID} from 'node:crypto';
import {
    mkdir,
    open,
    readFile,
    unlink
} from 'node:fs/promises';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {layerSystemSchemaNameAssert} from './system-schema.js';

/**
 * The embedded driver boundary intentionally excludes upstream WASM implementation types.
 * @typedef {{rows: unknown[], rowCount?: number, affectedRows?: number}} LayerPgliteDriverResult
 * @typedef {object} LayerPgliteDriverQueries
 * @property {(textData: string, valuesData: unknown[]) => Promise<LayerPgliteDriverResult>} query
 * @property {(textData: string) => Promise<LayerPgliteDriverResult[]>} exec
 * @typedef {LayerPgliteDriverQueries & {
 *     transaction: <T>(handlerData: (transactionData: LayerPgliteDriverQueries) => Promise<T>) => Promise<T>,
 *     close: () => Promise<void>
 * }} LayerPgliteDriver
 */

/**
 * @typedef {object} LayerPgliteQuery
 * @property {string} text
 * @property {readonly unknown[]} values
 * @typedef {object} LayerPgliteTransactionClient
 * @property {'embedded'} kind
 * @property {string} systemSchema
 * @property {(queryData: LayerPgliteQuery) => Promise<{rows: Record<string, unknown>[], rowCount: number | null}>} query
 */

/**
 * @param {unknown} queryData
 * @returns {asserts queryData is LayerPgliteQuery}
 */
function pgliteQueryAssert( queryData ){
    //Checking the query object before reaching the embedded PostgreSQL runtime
    if ( queryData === null || typeof queryData !== 'object' || Array.isArray( queryData ) === true ){
        //Passing the invalid SQL contract to the database boundary
        throw new TypeError( 'SQL query data must be an object.' );

    };

    const queryRecordData = /** @type {Record<string, unknown>} */ (queryData);

    //Checking explicit SQL text and values to prevent payload interpolation
    if (
        typeof queryRecordData.text !== 'string' ||
        Number( queryRecordData.text.trim().length ) === Number( 0 ) ||
        Array.isArray( queryRecordData.values ) === false
    ){
        //Passing the invalid SQL contract to the database boundary
        throw new TypeError( 'SQL query data requires text and values.' );

    };

}

/**
 * @param {string} queryTextData
 * @returns {boolean}
 */
function multipleStatementsCheck( queryTextData ){
    //Counting non-empty statement sections used by trusted migration SQL
    const statementSectionsData = String( queryTextData ).split( ';' ).filter(function statementSectionFind( statementData ){
        //Checking the current SQL section contains executable text
        return Number( statementData.trim().length ) > Number( 0 );

    });

    //CallBack THE BOOLEAN
    return Number( statementSectionsData.length ) > Number( 1 );

}

/**
 * @param {LayerPgliteDriverQueries} queryTargetData
 * @param {LayerPgliteQuery} queryData
 */
async function pgliteQueryExecute( queryTargetData, queryData ){
    pgliteQueryAssert( queryData );

    //Using the simple protocol only for trusted multi-statement migrations without parameters
    if ( Number( queryData.values.length ) === Number( 0 ) && multipleStatementsCheck( queryData.text ) === true ){
        const statementResultsData = await queryTargetData.exec( queryData.text );
        const finalStatementResultData = statementResultsData.at( -1 );

        //CallBack THE OBJECT
        return {
            rows: /** @type {Record<string, unknown>[]} */ (finalStatementResultData?.rows ?? []),
            rowCount: finalStatementResultData?.rowCount ?? finalStatementResultData?.affectedRows ?? 0
        };

    }

    //Sending one parameterized statement through the extended query protocol
    const queryResultData = await queryTargetData.query( queryData.text, [...queryData.values] );

    //CallBack THE OBJECT
    return {
        rows: /** @type {Record<string, unknown>[]} */ (queryResultData.rows),
        rowCount: queryResultData.rowCount ?? queryResultData.affectedRows ?? 0
    };

}

/**
 * @param {object} databaseOptions
 * @param {string} databaseOptions.dataDirectory
 * @param {string} databaseOptions.systemSchema
 * @param {(dataDirectory: string) => Promise<LayerPgliteDriver>} [databaseOptions.pgliteCreate]
 */
export function layerPgliteDatabaseCreate( databaseOptions ){
    //Checking the persistent data directory before creating filesystem state
    if (
        typeof databaseOptions?.dataDirectory !== 'string' ||
        path.isAbsolute( databaseOptions.dataDirectory ) === false ||
        Number( databaseOptions.dataDirectory.length ) < Number( 4 )
    ){
        //Passing the invalid embedded database location to the runtime boundary
        throw new TypeError( 'PGlite dataDirectory must be an absolute path.' );

    }

    const systemSchemaData = layerSystemSchemaNameAssert( databaseOptions.systemSchema );
    const dataDirectoryData = path.resolve( databaseOptions.dataDirectory );
    const lockFileData = `${String( dataDirectoryData )}.lock`;
    const lockTokenData = `${Number( process.pid )}:${String( randomUUID() )}`;
    const pgliteCreate = databaseOptions.pgliteCreate ?? async function pgliteRuntimeCreate( persistentDirectoryData ){
        //Creating the pinned embedded PostgreSQL runtime with filesystem persistence
        return PGlite.create( persistentDirectoryData );

    };
    let databaseRuntimeData = /** @type {LayerPgliteDriver | null} */ (null);
    let readyStatusData = false;
    let closedStatusData = false;
    let lockOwnedStatusData = false;

    //Function for releasing the embedded database ownership lock
    const dataDirectoryLockRelease = async function(){
        //Skipping lock cleanup when this runtime never acquired it
        if ( lockOwnedStatusData === false ){
            return;

        }

        try {
            //Reading the lock token before removing a file another process may own
            const currentLockTokenData = await readFile( lockFileData, 'utf8' );

            //Checking this runtime still owns the current lock file
            if ( String( currentLockTokenData ) === String( lockTokenData ) ){
                await unlink( lockFileData );

            }

        } catch( lockReleaseError ){
            //Ignoring only an already removed lock during idempotent shutdown
            if ( /** @type {NodeJS.ErrnoException} */ (lockReleaseError).code !== 'ENOENT' ){
                //Passing unexpected lock cleanup failures to the lifecycle caller
                throw lockReleaseError;

            }

        } finally {
            lockOwnedStatusData = false;

        }

    };

    //Function for creating a transaction adapter with the same system namespace
    const transactionClientCreate = function( /** @type {LayerPgliteDriverQueries} */ transactionData ){
        //CallBack THE OBJECT
        return Object.freeze({
            kind: 'embedded',
            systemSchema: systemSchemaData,

            /**
             * @param {LayerPgliteQuery} queryData
             */
            query( queryData ){
                //Routing the query through the active PGlite transaction
                return pgliteQueryExecute( transactionData, queryData );

            }
        });

    };

    //CallBack THE OBJECT
    return Object.freeze({
        kind: 'embedded',
        systemSchema: systemSchemaData,

        async connect(){
            //Preventing duplicate startup and reuse after final shutdown
            if ( readyStatusData === true || closedStatusData === true ){
                //Passing the invalid lifecycle transition to the runtime boundary
                throw new Error( 'The PGlite runtime cannot be connected in its current state.' );

            }

            //Creating the parent directory before atomically claiming database ownership
            await mkdir( path.dirname( dataDirectoryData ), {
                recursive: true
            });

            let lockHandleData;

            try {
                //Claiming exclusive ownership before PGlite opens the persistent data directory
                lockHandleData = await open( lockFileData, 'wx', 384 );
                await lockHandleData.writeFile( lockTokenData, 'utf8' );
                await lockHandleData.close();
                lockOwnedStatusData = true;

            } catch( lockError ){
                //Closing a partially opened lock handle before reporting the ownership conflict
                if ( lockHandleData !== undefined ){
                    await lockHandleData.close();

                }

                //Returning a stable error without exposing filesystem contents
                if ( /** @type {NodeJS.ErrnoException} */ (lockError).code === 'EEXIST' ){
                    throw new Error( 'PGLITE_DATA_DIRECTORY_LOCKED', {
                        cause: lockError
                    });

                }

                //Passing unexpected filesystem failures to the lifecycle caller
                throw lockError;

            }

            try {
                //Starting the embedded PostgreSQL runtime after the ownership lock is durable
                databaseRuntimeData = await pgliteCreate( dataDirectoryData );
                readyStatusData = true;

            } catch( databaseStartError ){
                //Releasing the ownership lock after a failed embedded runtime startup
                await dataDirectoryLockRelease();

                //Passing the startup failure to the lifecycle caller
                throw databaseStartError;

            }

        },

        /**
         * @param {LayerPgliteQuery} queryData
         */
        async query( queryData ){
            //Checking lifecycle readiness before sending an embedded query
            if ( readyStatusData === false || closedStatusData === true || databaseRuntimeData === null ){
                //Passing the invalid lifecycle query to the caller
                throw new Error( 'The PGlite runtime is not ready.' );

            }

            //CallBack THE OBJECT
            return pgliteQueryExecute( databaseRuntimeData, queryData );

        },

        /**
         * @template TransactionResult
         * @param {(transactionClient: LayerPgliteTransactionClient) => Promise<TransactionResult>} transactionHandlerData
         * @returns {Promise<TransactionResult>}
         */
        async transaction( transactionHandlerData ){
            //Checking lifecycle readiness and the transaction callback before allocation
            if (
                readyStatusData === false ||
                closedStatusData === true ||
                databaseRuntimeData === null ||
                typeof transactionHandlerData !== 'function'
            ){
                //Passing the invalid transaction request to the caller
                throw new Error( 'The PGlite transaction cannot be started.' );

            }

            //Executing the callback through PGlite's serialized transaction contract
            return databaseRuntimeData.transaction(async function embeddedTransactionExecute( transactionData ){
                //Creating the bounded Layer transaction adapter
                const transactionClientData = transactionClientCreate( transactionData );

                //CallBack THE OBJECT
                return transactionHandlerData( transactionClientData );

            });

        },

        async healthCheck(){
            //Checking live embedded connectivity without returning storage details
            await this.query({
                text: 'SELECT 1 AS health',
                values: []
            });

            //CallBack THE BOOLEAN
            return true;

        },

        async close(){
            //Making embedded shutdown idempotent for repeated lifecycle signals
            if ( closedStatusData === true ){
                return;

            }

            readyStatusData = false;
            closedStatusData = true;

            try {
                //Closing PostgreSQL before releasing exclusive filesystem ownership
                if ( databaseRuntimeData !== null ){
                    await databaseRuntimeData.close();
                    databaseRuntimeData = null;

                }

            } finally {
                //Releasing the data directory for the next clean application start
                await dataDirectoryLockRelease();

            }

        },

        isReady(){
            //Reporting embedded readiness without exposing the data directory
            return readyStatusData === true && closedStatusData === false;

        }
    });

}
