import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {Pool} from 'pg';
import {
    layerDatabaseMigrate,
    layerDatabaseSchemaApply,
    layerDatabaseSchemaDefine,
    layerDatabaseSchemaPlan,
    layerDatabaseSchemaSynchronize,
    layerPostgresDatabaseCreate,
    layerTableDefine
} from '../src/index.js';

/** @param {Record<string, any>} [extraColumnsData] @param {string} [textTypeData] */
const applicationSchemaCreate = function( extraColumnsData = {}, textTypeData = 'string' ){
    //Preparing trusted variants whose DDL plans differ but share one application namespace
    return layerDatabaseSchemaDefine([layerTableDefine({
        name: 'messages', scope: 'global', primaryKey: 'id',
        columns: {id: {type: 'integer', generated: 'identity'}, text: {type: textTypeData}, ...extraColumnsData}
    })]);

};

test( 'PostgreSQL migrations and distinct schema plans serialize on one connection and release locks after failure', {
    skip: process.env.LAYER_TEST_LOCAL_POSTGRES !== '1', timeout: 30000
}, async function(){
    const schemaData = `layer_ddl_test_${randomUUID().replaceAll( '-', '' )}`;
    const poolData = new Pool({host: '127.0.0.1', port: 5432, database: 'postgres', user: 'postgres', max: 4,
        connectionTimeoutMillis: 2000, statement_timeout: 10000, application_name: schemaData});
    const databaseData = layerPostgresDatabaseCreate({connectionOptions: {host: '127.0.0.1'}, systemSchema: schemaData,
        poolCreate(){
            //Allocating concurrent transactions from a bounded pool, as separate workers do
            return poolData;

        }});

    try {
        await databaseData.connect();

        //Concurrent first startup must create the namespace and each system migration exactly once
        const migrationResultsData = await Promise.all([layerDatabaseMigrate( databaseData ), layerDatabaseMigrate( databaseData )]);
        assert.deepEqual( migrationResultsData.map(function( resultData ){
            //Ignoring which worker acquired the lock first
            return resultData.length;

        }).sort(function( firstData, secondData ){
            //Comparing the applied counts independently of worker scheduling
            return firstData - secondData;

        }), [0, 10] );

        const baseSchemaData = applicationSchemaCreate();
        const expandedSchemaData = applicationSchemaCreate({note: {type: 'string', nullable: true}});
        await Promise.all([
            layerDatabaseSchemaSynchronize({database: databaseData, schema: baseSchemaData}),
            layerDatabaseSchemaSynchronize({database: databaseData, schema: expandedSchemaData})
        ]);
        assert.equal( (await layerDatabaseSchemaPlan({database: databaseData, schema: expandedSchemaData})).changes.length, 0 );

        //Two identical additions must re-read the catalog after waiting, not run stale ALTER TABLE
        const nextSchemaData = applicationSchemaCreate({note: {type: 'string', nullable: true}, flag: {type: 'boolean', nullable: true}});
        await Promise.all([
            layerDatabaseSchemaSynchronize({database: databaseData, schema: nextSchemaData}),
            layerDatabaseSchemaSynchronize({database: databaseData, schema: nextSchemaData})
        ]);

        //The second destructive approval must detect that the first worker changed the catalog
        const removalPlanData = await layerDatabaseSchemaPlan({database: databaseData, schema: expandedSchemaData});
        const approvalOptionsData = {database: databaseData, schema: expandedSchemaData,
            checksum: removalPlanData.checksum, confirmDataLoss: true};
        const applyResultsData = await Promise.allSettled([
            layerDatabaseSchemaApply( approvalOptionsData ), layerDatabaseSchemaApply( approvalOptionsData )
        ]);
        assert.equal( applyResultsData.filter(function( resultData ){
            //Counting the single approval which still matches the locked catalog
            return resultData.status === 'fulfilled';

        }).length, 1 );
        const refusedResultData = applyResultsData.find(function( resultData ){
            //Locating the stale approval to verify its safe conflict code
            return resultData.status === 'rejected';

        });
        assert.equal( /** @type {PromiseRejectedResult} */ (refusedResultData).reason.code, 'DATABASE_SCHEMA_CHECKSUM_MISMATCH' );

        //An incompatible plan remains durable without applying its unrelated additive column
        await poolData.query( `INSERT INTO "${schemaData}".messages (text) VALUES ($1)`, ['not-an-integer'] );
        const incompatibleSchemaData = applicationSchemaCreate({note: {type: 'string', nullable: true}, draft: {type: 'string', nullable: true}}, 'integer');
        const incompatiblePlanData = await layerDatabaseSchemaPlan({database: databaseData, schema: incompatibleSchemaData});
        await assert.rejects( layerDatabaseSchemaSynchronize({database: databaseData, schema: incompatibleSchemaData}), {code: 'DATABASE_SCHEMA_APPROVAL_REQUIRED'} );
        const recordedPlanData = await poolData.query( `SELECT checksum FROM "${schemaData}".sys_schema_changes WHERE checksum = $1`, [incompatiblePlanData.checksum] );
        assert.equal( recordedPlanData.rowCount, 1 );
        await assert.rejects( layerDatabaseSchemaApply({database: databaseData, schema: incompatibleSchemaData,
            checksum: incompatiblePlanData.checksum, confirmDataLoss: true}), {code: '22P02'} );
        const afterFailureData = await layerDatabaseSchemaPlan({database: databaseData, schema: expandedSchemaData});
        assert.equal( afterFailureData.changes.length, 0 );
        await layerDatabaseSchemaSynchronize({database: databaseData, schema: expandedSchemaData});

        //No session-level locks may survive on any returned pool connection
        const locksData = await poolData.query(`SELECT count(*)::integer AS count FROM pg_locks
            WHERE locktype = 'advisory' AND pid IN (SELECT pid FROM pg_stat_activity WHERE application_name = $1)`, [schemaData]);
        assert.equal( locksData.rows[0].count, 0 );

    } finally {
        //Removing only this explicitly created schema and leaving shared OpenServer services running
        await poolData.query( `DROP SCHEMA IF EXISTS "${schemaData}" CASCADE` );
        await databaseData.close();

    }

});
