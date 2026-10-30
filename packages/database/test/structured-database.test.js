import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LAYER_DATABASE_COLUMN_TYPES,
    LAYER_DATABASE_TABLE_SCOPES,
    LayerDatabaseError,
    layerDatabaseFacadeCreate,
    layerDatabaseSchemaDefinitionCheck,
    layerDatabaseSchemaDeclarationsCreate,
    layerDatabaseSchemaDefine,
    layerTableDefine
} from '../src/index.js';


//Function for creating the application database schema used by CRUD tests
const applicationSchemaCreate = function(){
    //Creating one tenant-owned message table with generated and typed columns
    const messageTableData = layerTableDefine({
        name: 'messages',
        scope: 'tenant',
        primaryKey: 'id',
        columns: {
            id: {
                type: 'uuid',
                generated: 'uuid'
            },
            chatId: {
                type: 'string'
            },
            text: {
                type: 'string'
            },
            score: {
                type: 'integer',
                nullable: true
            },
            metadata: {
                type: 'json',
                nullable: true
            },
            createdAt: {
                type: 'timestamp'
            }
        }
    });

    //CallBack THE OBJECT
    return layerDatabaseSchemaDefine([
        messageTableData
    ]);

};

/**
 * @param {(queryData: {text: string, values: readonly unknown[], consistency?: string}) => {rows?: Record<string, unknown>[], rowCount?: number | null}} [resultCreate]
 */
function databaseFakeCreate( resultCreate = function defaultResultCreate(){
    //Returning an empty successful result for queries without a dedicated fixture
    return {
        rows: [],
        rowCount: 0
    };

} ){
    const queryCallsData = /** @type {{text: string, values: readonly unknown[], consistency?: string}[]} */ ([]);
    let transactionCountData = Number( 0 );
    const databaseData = {
        kind: /** @type {'postgres'} */ ('postgres'),
        systemSchema: 'layer_message_service',

        async query( /** @type {{text: string, values: readonly unknown[], consistency?: string}} */ queryData ){
            //Recording SQL text and values separately for injection assertions
            queryCallsData.push( queryData );

            const resultData = resultCreate( queryData );

            //CallBack THE OBJECT
            return {
                rows: resultData.rows ?? [],
                rowCount: resultData.rowCount ?? 0
            };

        },

        /**
         * @template ResultData
         * @param {(transactionDatabaseData: any) => Promise<ResultData>} transactionHandlerData
         * @returns {Promise<ResultData>}
         */
        async transaction( transactionHandlerData ){
            //Recording one transaction allocation and reusing the isolated fake adapter
            transactionCountData += Number( 1 );

            //CallBack THE OBJECT
            return transactionHandlerData( databaseData );

        }
    };

    //CallBack THE OBJECT
    return {
        database: databaseData,
        queryCalls: queryCallsData,
        transactionCountGet(){
            //CallBack THE NUMBER
            return transactionCountData;

        }
    };

}

test('database schema generates stable row insert update filter and result declarations', function(){
    const declarationSourceData = layerDatabaseSchemaDeclarationsCreate( applicationSchemaCreate() );

    assert.match( declarationSourceData, /export interface MessagesRow/ );
    assert.match( declarationSourceData, /readonly id: string;/ );
    assert.match( declarationSourceData, /readonly score: number \| null;/ );
    assert.match( declarationSourceData, /readonly metadata: LayerJsonValue \| null;/ );
    assert.match( declarationSourceData, /export interface MessagesInsert/ );
    assert.doesNotMatch( declarationSourceData, /MessagesInsert \{[^}]*readonly id:/s );
    assert.match( declarationSourceData, /readonly score\?: number \| null;/ );
    assert.match( declarationSourceData, /export type MessagesFilter/ );
    assert.match( declarationSourceData, /scope: "tenant";/ );
    assert.match( declarationSourceData, /export type LayerDatabaseResult/ );
    assert.equal( declarationSourceData.endsWith( '\n' ), true );
    assert.throws(
        () => layerDatabaseSchemaDeclarationsCreate(/** @type {any} */ ({tables: []})),
        TypeError
    );

});

test('declarative schema rejects forged, reserved, duplicate, and incompatible definitions', function(){
    //Checking schema ownership cannot be forged with a plain payload object
    assert.throws(function forgedSchemaCreate(){
        //Creating a schema from an object that did not pass through layerTableDefine
        layerDatabaseSchemaDefine([
            /** @type {any} */ ({
                name: 'messages',
                scope: 'tenant',
                primaryKey: 'id',
                columns: []
            })
        ]);

    }, TypeError);

    const invalidDefinitionsData = [{
        name: 'sys_sessions',
        scope: 'global',
        primaryKey: 'id',
        columns: {
            id: {
                type: 'uuid'
            }
        }
    }, {
        name: 'messages',
        scope: 'tenant',
        primaryKey: 'id',
        columns: {
            id: {
                type: 'string',
                nullable: true
            }
        }
    }, {
        name: 'messages',
        scope: 'tenant',
        primaryKey: 'id',
        columns: {
            id: {
                type: 'string'
            },
            createdAt: {
                type: 'timestamp'
            },
            created_at: {
                type: 'timestamp'
            }
        }
    }, {
        name: 'messages',
        scope: 'user',
        primaryKey: 'id',
        columns: {
            id: {
                type: 'integer',
                generated: 'uuid'
            }
        }
    }];

    //Checking every unsafe schema shape fails before SQL planning
    for ( const invalidDefinitionData of invalidDefinitionsData ){
        assert.throws(function invalidTableDefine(){
            //Validating the current rejected table declaration
            layerTableDefine( /** @type {any} */ (invalidDefinitionData) );

        }, TypeError);

    }

});

test('declarative schema normalizes every supported literal default and generation strategy', function(){
    const tableData = layerTableDefine({
        name: 'configuration',
        scope: 'global',
        primaryKey: 'id',
        columns: {
            id: {type: 'uuid', generated: 'uuid'},
            sequence: {type: 'integer', generated: 'identity'},
            title: {type: 'string', default: 'Layer'},
            retries: {type: 'integer', default: 3},
            ratio: {type: 'number', default: 1.5},
            enabled: {type: 'boolean', default: true},
            createdAt: {type: 'timestamp', default: '2026-09-21T10:00:00.000Z'},
            metadata: {type: 'json', default: {source: 'test'}},
            optional: {type: 'string', nullable: true, default: null},
            referenceId: {type: 'uuid', default: '018f6b65-4d1f-7c90-8a3b-3148beae7d00'}
        }
    });
    const schemaData = layerDatabaseSchemaDefine([tableData]);
    const columnsByNameData = new Map( tableData.columns.map(function columnMapCreate( columnData ){
        return [columnData.name, columnData];
    }) );

    assert.equal( layerDatabaseSchemaDefinitionCheck( schemaData ), true );
    assert.equal( layerDatabaseSchemaDefinitionCheck({tables: []}), false );
    assert.deepEqual( LAYER_DATABASE_COLUMN_TYPES, [
        'boolean',
        'integer',
        'json',
        'number',
        'string',
        'timestamp',
        'uuid'
    ] );
    assert.deepEqual( LAYER_DATABASE_TABLE_SCOPES, ['global', 'tenant', 'user'] );
    assert.equal( columnsByNameData.get( 'createdAt' )?.databaseName, 'created_at' );
    assert.equal( columnsByNameData.get( 'optional' )?.default, null );
    assert.equal( columnsByNameData.get( 'referenceId' )?.default, '018f6b65-4d1f-7c90-8a3b-3148beae7d00' );
    assert.deepEqual( columnsByNameData.get( 'metadata' )?.default, {source: 'test'} );
    assert.equal( Object.isFrozen( schemaData.tables ), true );

    assert.throws(() => layerDatabaseSchemaDefine(/** @type {any} */ ({})), TypeError);
    assert.throws(() => layerDatabaseSchemaDefine([tableData, tableData]), TypeError);
    assert.throws(() => layerTableDefine(/** @type {any} */ (null)), TypeError);
    assert.throws(() => layerTableDefine(/** @type {any} */ ({
        name: 'configuration',
        scope: 'global',
        primaryKey: 'id',
        columns: {},
        unknown: true
    })), TypeError);
    assert.throws(() => layerTableDefine(/** @type {any} */ ({
        name: 'Invalid-Name',
        scope: 'unknown',
        primaryKey: 'id',
        columns: {id: {type: 'string'}}
    })), TypeError);
    assert.throws(() => layerTableDefine(/** @type {any} */ ({
        name: 'configuration',
        scope: 'global',
        primaryKey: 'id',
        columns: []
    })), TypeError);
    assert.throws(() => layerTableDefine({
        name: 'configuration',
        scope: 'global',
        primaryKey: 'id',
        columns: {}
    }), TypeError);

    for ( const invalidColumnData of [
        /** @type {any} */ (null),
        {type: 'unknown'},
        {type: 'string', nullable: 'yes'},
        {type: 'string', generated: 'unknown'},
        {type: 'string', generated: 'uuid'},
        {type: 'uuid', generated: 'uuid', default: '018f6b65-4d1f-7c90-8a3b-3148beae7d00'},
        {type: 'string', default: 1},
        {type: 'uuid', default: 'invalid'},
        {type: 'integer', default: 1.5},
        {type: 'number', default: Number.POSITIVE_INFINITY},
        {type: 'boolean', default: 'true'},
        {type: 'timestamp', default: 'invalid'},
        {type: 'json', default: undefined},
        {type: 'string', default: null},
        {type: 'string', unknown: true}
    ] ){
        assert.throws(() => layerTableDefine(/** @type {any} */ ({
            name: 'configuration',
            scope: 'global',
            primaryKey: 'id',
            columns: {
                id: invalidColumnData
            }
        })), TypeError);
    }
});

test('Structured CRUD parameterizes filters and enforces tenant ownership', async function(){
    const maliciousChatIdentifierData = String( "chat-1' OR TRUE --" );
    const fakeData = databaseFakeCreate(function queryResultCreate( queryData ){
        //Returning one public row for the bounded select fixture
        if ( queryData.text.includes( 'SELECT' ) === true ){
            return {
                rows: [{
                    id: '018f6b65-4d1f-7c90-8a3b-3148beae7d00',
                    text: 'Hello'
                }],
                rowCount: 1
            };

        }

        return {
            rows: [],
            rowCount: 0
        };

    });
    const databaseFacadeData = layerDatabaseFacadeCreate({
        database: fakeData.database,
        schema: applicationSchemaCreate(),
        security: {
            tenantId: 'tenant-from-session',
            userId: 'user-from-session'
        }
    });
    const messageTableData = databaseFacadeData.table( 'messages' );
    const messagesData = await messageTableData.findMany({
        select: ['id', 'text'],
        where: databaseFacadeData.where.equal( 'chatId', maliciousChatIdentifierData ),
        orderBy: [{
            column: 'createdAt',
            direction: 'desc'
        }],
        limit: 50,
        consistency: 'eventual'
    });
    const queryData = fakeData.queryCalls[0];

    assert.ok( queryData );
    assert.equal( queryData.text.includes( maliciousChatIdentifierData ), false );
    assert.equal( queryData.text.includes( '"layer_message_service"."messages"' ), true );
    assert.equal( queryData.text.includes( '"sys_tenant_id"' ), true );
    assert.deepEqual( queryData.values, [
        maliciousChatIdentifierData,
        'tenant-from-session',
        50,
        0
    ]);
    assert.equal( queryData.consistency, 'eventual' );
    assert.deepEqual( messagesData, [{
        id: '018f6b65-4d1f-7c90-8a3b-3148beae7d00',
        text: 'Hello'
    }]);

    //Checking plain payload filter objects cannot bypass the descriptor factory
    await assert.rejects(function forgedFilterFind(){
        //Sending an untrusted filter-shaped payload to the structured query boundary
        return messageTableData.findMany({
            where: {
                operator: 'equal',
                column: 'chatId',
                value: 'chat-1'
            }
        });

    }, function forgedFilterErrorCheck( errorData ){
        //Checking the stable database error code
        return errorData instanceof LayerDatabaseError && errorData.code === 'DATABASE_QUERY_INVALID';

    });

});

test('Structured CRUD normalizes safe PostgreSQL integer results', async function(){
    const fakeData = databaseFakeCreate(function queryResultCreate(){
        return {
            rows: [{score: '2', createdAt: new Date('2026-09-21T10:00:00.000Z')}],
            rowCount: 1
        };
    });
    const databaseFacadeData = layerDatabaseFacadeCreate({
        database: fakeData.database,
        schema: applicationSchemaCreate(),
        security: {tenantId: 'tenant-1', userId: 'user-1'}
    });

    assert.deepEqual(
        await databaseFacadeData.table( 'messages' ).findOne({select: ['score', 'createdAt']}),
        {score: 2, createdAt: '2026-09-21T10:00:00.000Z'}
    );

    const unsafeFakeData = databaseFakeCreate(function unsafeIntegerResultCreate(){
        return {rows: [{score: '9007199254740993'}], rowCount: 1};
    });
    const unsafeFacadeData = layerDatabaseFacadeCreate({
        database: unsafeFakeData.database,
        schema: applicationSchemaCreate(),
        security: {tenantId: 'tenant-1', userId: 'user-1'}
    });

    await assert.rejects(
        () => unsafeFacadeData.table( 'messages' ).findOne({select: ['score']}),
        (errorData) => errorData instanceof LayerDatabaseError && errorData.code === 'DATABASE_RESULT_INVALID'
    );
});

test('Structured CRUD composes bounded filters, findOne, count, exists, and eventual reads', async function(){
    const fakeData = databaseFakeCreate(function queryResultCreate( queryData ){
        if ( queryData.text.includes( 'COUNT(*)' ) === true ){
            return {rows: [{count: '2'}], rowCount: 1};

        }

        return {rows: [], rowCount: 0};
    });
    const databaseFacadeData = layerDatabaseFacadeCreate({
        database: fakeData.database,
        schema: applicationSchemaCreate(),
        security: {
            tenantId: 'tenant-1',
            userId: 'user-1'
        }
    });
    const messageTableData = databaseFacadeData.table( 'messages' );
    const compositeFilterData = databaseFacadeData.where.and(
        databaseFacadeData.where.notEqual( 'text', 'hidden' ),
        databaseFacadeData.where.or(
            databaseFacadeData.where.greaterThan( 'score', 1 ),
            databaseFacadeData.where.lessThan( 'score', 10 )
        ),
        databaseFacadeData.where.in( 'chatId', ['chat-1', 'chat-2'] ),
        databaseFacadeData.where.isNull( 'metadata' )
    );

    assert.deepEqual( await messageTableData.findMany({
        where: compositeFilterData,
        limit: 25,
        offset: 5,
        consistency: 'eventual'
    }), [] );
    const compositeQueryData = fakeData.queryCalls[0];

    assert.ok( compositeQueryData );
    assert.equal( compositeQueryData.consistency, 'eventual' );
    assert.match( compositeQueryData.text, /IS NULL/ );
    assert.match( compositeQueryData.text, / IN \(/ );
    assert.equal( await messageTableData.findOne({
        where: databaseFacadeData.where.equal( 'chatId', 'missing' ),
        limit: 99
    }), null );
    assert.equal( await messageTableData.count({
        where: databaseFacadeData.where.equal( 'score', null),
        consistency: 'eventual'
    }), 2 );
    assert.equal( await messageTableData.exists({
        where: databaseFacadeData.where.notEqual( 'score', null)
    }), true );

    for ( const invalidQueryData of [
        /** @type {any} */ (null),
        {limit: 0},
        {offset: -1},
        {orderBy: 'createdAt'},
        {orderBy: [{column: 'createdAt', direction: 'sideways'}]},
        {orderBy: [{column: 'unknown', direction: 'asc'}]},
        {consistency: 'stale'},
        {select: ['unknown']},
        {where: /** @type {any} */ ({operator: 'equal', column: 'chatId', value: 'chat-1'})},
        {where: databaseFacadeData.where.and(databaseFacadeData.where.equal('chatId', 'chat-1'))},
        {where: databaseFacadeData.where.in('chatId', [])},
        {where: databaseFacadeData.where.greaterThan('score', null)}
    ] ){
        await assert.rejects(() => messageTableData.findMany( invalidQueryData ), LayerDatabaseError);
    }

    await assert.rejects(
        () => messageTableData.count(/** @type {any} */ (null)),
        LayerDatabaseError
    );
    await assert.rejects(
        () => messageTableData.count({consistency: 'stale'}),
        LayerDatabaseError
    );
});

test('Structured CRUD injects ownership, generated values, and JSON parameters on insert', async function(){
    const fakeData = databaseFakeCreate(function insertResultCreate( queryData ){
        //Returning a deterministic inserted record while preserving generated UUID assertions
        return {
            rows: [{
                id: queryData.values[4],
                chatId: queryData.values[0],
                text: queryData.values[1],
                score: null,
                metadata: {
                    source: 'test'
                },
                createdAt: queryData.values[3]
            }],
            rowCount: 1
        };

    });
    const databaseFacadeData = layerDatabaseFacadeCreate({
        database: fakeData.database,
        schema: applicationSchemaCreate(),
        security: {
            tenantId: 'tenant-server-owned'
        }
    });
    const insertResultData = await databaseFacadeData.table( 'messages' ).insert({
        values: {
            chatId: 'chat-1',
            text: 'Message',
            metadata: {
                source: 'test'
            },
            createdAt: '2026-09-21T10:00:00.000Z'
        }
    });
    const queryData = fakeData.queryCalls[0];

    assert.ok( queryData );
    assert.ok( insertResultData );
    assert.equal( queryData.text.includes( '"sys_tenant_id"' ), true );
    assert.equal( queryData.text.includes( "'tenant-server-owned'" ), false );
    assert.equal( queryData.text.includes( '::jsonb' ), true );
    assert.equal( queryData.values.includes( 'tenant-server-owned' ), true );
    assert.match( String( insertResultData.id ), /^[0-9a-f-]{36}$/ );

    //Checking ownership-like and unknown developer fields never reach generated SQL
    await assert.rejects(function ownershipFieldInsert(){
        //Trying to provide a forged ownership field through mutation values
        return databaseFacadeData.table( 'messages' ).insert({
            values: {
                chatId: 'chat-1',
                text: 'Message',
                createdAt: '2026-09-21T10:00:00.000Z',
                sysTenantId: 'another-tenant'
            }
        });

    }, LayerDatabaseError);

});

test('Structured CRUD forbids unbounded mutations and limits explicit mass changes', async function(){
    const fakeData = databaseFakeCreate(function mutationResultCreate(){
        //Returning one affected record for update and hard-delete fixtures
        return {
            rows: [{
                id: '018f6b65-4d1f-7c90-8a3b-3148beae7d00',
                text: 'Changed'
            }],
            rowCount: 1
        };

    });
    const databaseFacadeData = layerDatabaseFacadeCreate({
        database: fakeData.database,
        schema: applicationSchemaCreate(),
        security: {
            tenantId: 'tenant-1'
        }
    });
    const messageTableData = databaseFacadeData.table( 'messages' );

    await assert.rejects(function unboundedUpdate(){
        //Trying to update without an explicit application filter
        return messageTableData.update({
            values: {
                text: 'Changed'
            }
        });

    }, function massMutationErrorCheck( errorData ){
        //Checking the stable protection against unrestricted mutations
        return errorData instanceof LayerDatabaseError && errorData.code === 'DATABASE_MASS_MUTATION_FORBIDDEN';

    });

    await assert.rejects(function unlimitedDelete(){
        //Trying to enable a mass delete without a bounded limit
        return messageTableData.delete({
            where: databaseFacadeData.where.equal( 'chatId', 'chat-1' ),
            allowMany: true
        });

    }, LayerDatabaseError);

    const updateResultData = await messageTableData.update({
        values: {
            text: 'Changed'
        },
        where: databaseFacadeData.where.equal( 'chatId', 'chat-1' ),
        allowMany: true,
        limit: 10,
        returning: ['id', 'text']
    });
    const updateQueryData = fakeData.queryCalls.at( -1 );

    assert.ok( updateQueryData );
    assert.equal( updateQueryData.text.includes( 'FOR UPDATE' ), true );
    assert.equal( updateQueryData.text.includes( 'LIMIT $4' ), true );
    assert.deepEqual( updateQueryData.values, [
        'Changed',
        'chat-1',
        'tenant-1',
        10
    ]);
    assert.deepEqual( updateResultData, [{
        id: '018f6b65-4d1f-7c90-8a3b-3148beae7d00',
        text: 'Changed'
    }]);

    await messageTableData.delete({
        where: databaseFacadeData.where.equal( 'id', '018f6b65-4d1f-7c90-8a3b-3148beae7d00' ),
        returning: ['id']
    });

    const deleteQueryData = fakeData.queryCalls.at( -1 );

    assert.ok( deleteQueryData );
    assert.equal( deleteQueryData.text.includes( 'DELETE FROM' ), true );
    assert.equal( deleteQueryData.text.includes( 'LIMIT $3' ), true );

});

test('Structured database requires external PostgreSQL and keeps raw SQL parameterized', async function(){
    const schemaData = applicationSchemaCreate();

    //Checking application tables cannot run inside the system-only embedded database
    assert.throws(function embeddedApplicationFacadeCreate(){
        //Creating an invalid application facade over a PGlite-shaped adapter
        layerDatabaseFacadeCreate({
            database: {
                kind: 'embedded',
                systemSchema: 'layer_embedded',
                async query(){
                    //Returning an unused empty result for adapter shape validation
                    return {
                        rows: [],
                        rowCount: 0
                    };

                }
            },
            schema: schemaData
        });

    }, function embeddedApplicationErrorCheck( errorData ){
        //Checking the stable external database requirement
        return errorData instanceof LayerDatabaseError && errorData.code === 'APPLICATION_DATABASE_REQUIRED';

    });

    const fakeData = databaseFakeCreate();
    const databaseFacadeData = layerDatabaseFacadeCreate({
        database: fakeData.database,
        schema: schemaData,
        security: {
            tenantId: 'tenant-1'
        }
    });
    const injectedValueData = String( "value'); DROP TABLE messages; --" );

    await databaseFacadeData.sql`SELECT ${injectedValueData} AS value`;

    const rawQueryData = fakeData.queryCalls[0];

    assert.ok( rawQueryData );
    assert.equal( rawQueryData.text, 'SELECT $1 AS value' );
    assert.deepEqual( rawQueryData.values, [injectedValueData] );

    //Checking transaction callbacks receive another facade instead of a query adapter
    await databaseFacadeData.transaction(async function structuredTransactionUse( transactionFacadeData ){
        assert.equal( 'query' in transactionFacadeData, false );
        assert.equal( typeof transactionFacadeData.table, 'function' );

        const countData = await transactionFacadeData.table( 'messages' ).count({
            where: transactionFacadeData.where.equal( 'chatId', 'chat-1' )
        });

        assert.equal( countData, 0 );

    });

    assert.equal( fakeData.transactionCountGet(), 1 );

});
