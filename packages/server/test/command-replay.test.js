import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {Pool} from 'pg';
import {layerDatabaseMigrate, layerPgliteDatabaseCreate, layerPostgresDatabaseCreate} from '@solcorp/layer-database';
import {layerOperationExecutorCreate, layerOperationRegistryCreate} from '../src/index.js';

/** @param {any} databaseData */
const replayFixtureCreate = function( databaseData ){
    let handlerCallsData = 0;
    let authorizeAllowedData = true;
    const registryData = layerOperationRegistryCreate();

    //Keeping both operations identical so operation identity is the only replay difference
    for ( const operationData of ['messages.send', 'messages.edit'] ){
        registryData.define({
            name: operationData,
            type: 'command',
            auth: 'bearer',
            transaction: true,
            inputSchema: {type: 'object'},
            outputSchema: {type: 'object'},
            authorize(){
                //Rechecking current object access even for an already committed command
                return authorizeAllowedData;

            },
            async handler( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
                //Counting actual handler executions rather than only stored results
                handlerCallsData += 1;
                await new Promise(function( resolveData ){
                    //Keeping the first transaction open while another worker attempts replay
                    setTimeout( resolveData, 25 );

                });

                //CallBack THE OBJECT
                return {user: contextData.security.userId, text: payloadData.text};

            }
        });

    }

    const executorData = layerOperationExecutorCreate({
        operationRegistry: registryData,
        database: databaseData,
        security: {
            async contextResolve( /** @type {any} */ requestData ){
                //Supplying verified fixture identities without deriving ownership from payload
                return {
                    authenticationType: requestData.headers.auth ?? 'bearer',
                    userId: requestData.headers.user ?? 'alice',
                    tenantId: requestData.headers.tenant ?? 'first',
                    credentialId: requestData.headers.credential ?? 'credential-a',
                    sessionId: null
                };

            }
        },
        rateLimiter: {async consume(){
            //Keeping this regression focused on transactional isolation
            return {allowed: true};

        }},
        diagnostics: {record(){
            //The fixture intentionally retains no payload diagnostics

        }}
    });

    //CallBack THE OBJECT
    return {
        execute( payloadData = {commandId: 'command-1', text: 'private'}, headersData = {}, operationData = 'messages.send' ){
            //Giving every retry its own transport request ID
            return executorData.execute({
                request: {protocol: 1, requestId: randomUUID(), type: 'command', operation: operationData, payload: payloadData},
                headers: headersData,
                remoteAddress: '127.0.0.1'
            });

        },
        calls(){
            //CallBack THE NUMBER
            return handlerCallsData;

        },
        deny(){
            //Simulating revoked object permissions before a replay
            authorizeAllowedData = false;

        }
    };

};

test( 'command replay isolates actors and payloads, rejects legacy/anonymous replay and preserves current authorization', async function(){
    const directoryData = await mkdtemp( path.join( tmpdir(), 'layer-replay-' ) );
    const databaseData = layerPgliteDatabaseCreate({dataDirectory: path.join( directoryData, 'system' ), systemSchema: 'layer_replay_test'});

    try {
        //Running the real migration and repository against persistent embedded PostgreSQL
        await databaseData.connect();
        await layerDatabaseMigrate( databaseData );
        const fixtureData = replayFixtureCreate( databaseData );
        assert.deepEqual( await fixtureData.execute(), {user: 'alice', text: 'private'} );
        assert.deepEqual( await fixtureData.execute({text: 'private', commandId: 'command-1'}), {user: 'alice', text: 'private'} );
        await assert.rejects( fixtureData.execute(undefined, {user: 'bob'}), {code: 'REVISION_CONFLICT'} );
        await assert.rejects( fixtureData.execute({commandId: 'command-1', text: 'changed'}), {code: 'REVISION_CONFLICT'} );
        await assert.rejects( fixtureData.execute(undefined, {}, 'messages.edit'), {code: 'REVISION_CONFLICT'} );
        assert.equal( fixtureData.calls(), 1 );

        //A separate tenant has a separate command namespace, even with the same user ID
        await fixtureData.execute(undefined, {tenant: 'second'});
        assert.equal( fixtureData.calls(), 2 );

        //API keys belonging to one user cannot share each other's command results
        const keyPayloadData = {commandId: 'key-command', text: 'key-result'};
        await fixtureData.execute( keyPayloadData, {auth: 'api-key', credential: 'key-a'} );
        await assert.rejects( fixtureData.execute( keyPayloadData, {auth: 'api-key', credential: 'key-b'} ), {code: 'REVISION_CONFLICT'} );

        //Old records have no reliable actor or digest and must never be rebound from a retry
        await databaseData.query({
            text: `INSERT INTO "${databaseData.systemSchema}".sys_command_results (tenant_key, command_id, operation, result) VALUES ($1, $2, $3, $4::jsonb)`,
            values: ['first', 'legacy', 'messages.send', '{"secret":"legacy-owner"}']
        });
        await assert.rejects( fixtureData.execute({commandId: 'legacy', text: 'private'}), {code: 'REVISION_CONFLICT'} );
        const anonymousPayloadData = {commandId: 'anonymous', text: 'public'};
        await fixtureData.execute( anonymousPayloadData, {auth: 'anonymous'} );
        await assert.rejects( fixtureData.execute( anonymousPayloadData, {auth: 'anonymous'} ), {code: 'REVISION_CONFLICT'} );
        fixtureData.deny();
        await assert.rejects( fixtureData.execute(), {code: 'OBJECT_ACCESS_DENIED'} );

    } finally {
        //Removing only this test's newly created storage after releasing its process lock
        await databaseData.close();
        await rm( directoryData, {recursive: true, force: true} );

    }

});

test( 'PostgreSQL concurrent command retries execute once across worker connections', {
    skip: process.env.LAYER_TEST_LOCAL_POSTGRES !== '1', timeout: 30000
}, async function(){
    const schemaData = `layer_replay_test_${randomUUID().replaceAll( '-', '' )}`;
    const poolData = new Pool({host: '127.0.0.1', port: 5432, database: 'postgres', user: 'postgres', max: 4,
        connectionTimeoutMillis: 2000, statement_timeout: 10000});
    const databaseData = layerPostgresDatabaseCreate({
        connectionOptions: {host: '127.0.0.1'}, systemSchema: schemaData,
        poolCreate(){
            //Owning a bounded test pool without changing the shared PostgreSQL service
            return poolData;

        }
    });

    try {
        await databaseData.connect();
        await layerDatabaseMigrate( databaseData );
        const firstWorkerData = replayFixtureCreate( databaseData );
        const secondWorkerData = replayFixtureCreate( databaseData );

        //Concurrent identical commands wait for commit and see one durable result
        const resultsData = await Promise.all([firstWorkerData.execute(), secondWorkerData.execute()]);
        assert.deepEqual( resultsData, [{user: 'alice', text: 'private'}, {user: 'alice', text: 'private'}] );
        assert.equal( firstWorkerData.calls() + secondWorkerData.calls(), 1 );

        //Concurrent changes cannot enter the second handler after the first owns commandId
        const conflictingData = await Promise.allSettled([
            firstWorkerData.execute({commandId: 'conflict', text: 'one'}),
            secondWorkerData.execute({commandId: 'conflict', text: 'two'})
        ]);
        assert.equal( conflictingData.filter(function( resultData ){
            //Counting committed commands rather than relying on scheduler order
            return resultData.status === 'fulfilled';

        }).length, 1 );
        assert.equal( firstWorkerData.calls() + secondWorkerData.calls(), 2 );

    } finally {
        //Dropping only the UUID-named schema created for this regression
        await poolData.query( `DROP SCHEMA IF EXISTS "${schemaData}" CASCADE` );
        await databaseData.close();

    }

});
