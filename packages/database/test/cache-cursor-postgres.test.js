import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {Pool} from 'pg';
import {layerCacheInvalidationRepositoryCreate} from '../src/cache-invalidation-repository.js';

test( 'PostgreSQL invalidation cursor cannot skip an older uncommitted record', {
    skip: process.env.LAYER_TEST_LOCAL_POSTGRES !== '1', timeout: 20000
}, async function(){
    //Creating an isolated journal with independent writer connections, matching multiple workers
    const schemaData = `layer_cache_${randomUUID().replaceAll( '-', '' )}`;
    const poolData = new Pool({host: '127.0.0.1', port: 5432, user: 'postgres', database: 'postgres', max: 4,
        connectionTimeoutMillis: 2000, statement_timeout: 5000});
    const firstClientData = await poolData.connect();
    const secondClientData = await poolData.connect();
    const repositoryCreate = function( /** @type {any} */ clientData ){
        //Binding each repository to its own transaction connection
        return layerCacheInvalidationRepositoryCreate({database: {systemSchema: schemaData,
            query( queryData ){
                //Keeping the journal lock and INSERT on that exact connection
                return clientData.query( queryData );

            }}});

    };
    const recordData = {eventId: 'first', scope: /** @type {const} */ ('global'), tenantId: null, userId: null, tags: ['messages']};

    try {
        await poolData.query( `CREATE SCHEMA "${schemaData}"` );
        await poolData.query( `CREATE TABLE "${schemaData}".sys_cache_invalidations (
            invalidation_id bigserial PRIMARY KEY, event_id text, cache_tags jsonb, occurred_at timestamptz DEFAULT now())` );
        await firstClientData.query( 'BEGIN' );
        await secondClientData.query( 'BEGIN' );
        const secondPidData = (await secondClientData.query( 'SELECT pg_backend_pid() AS pid' )).rows[0].pid;
        const firstIdData = await repositoryCreate( firstClientData ).record( recordData );
        let secondResolvedStatusData = false;
        const secondWriteData = repositoryCreate( secondClientData ).record({...recordData, eventId: 'second'}).then(function( identifierData ){
            //Observing completion without prematurely committing the second transaction
            secondResolvedStatusData = true;

            return identifierData;

        });
        //Observing the second writer actually waiting on PostgreSQL, not inferring it from a timer
        let blockedStatusData = false;

        for ( let attemptData = 0; attemptData < 50; attemptData += 1 ){
            const activityData = await poolData.query( 'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [secondPidData] );
            blockedStatusData = activityData.rows[0]?.wait_event_type === 'Lock';

            if ( blockedStatusData || secondResolvedStatusData ){
                break;

            }

            await new Promise(function( resolveData ){
                //Allowing PostgreSQL to report the second writer's advisory-lock wait
                setTimeout( resolveData, 10 );

            });

        }

        assert.equal( blockedStatusData, true );
        assert.equal( secondResolvedStatusData, false );
        assert.equal( (await repositoryCreate( poolData ).readAfter({cursor: 0})).length, 0 );
        await firstClientData.query( 'COMMIT' );
        const secondIdData = await secondWriteData;
        await secondClientData.query( 'COMMIT' );
        assert.equal( firstIdData < secondIdData, true );
        assert.equal( secondResolvedStatusData, true );
        const recordsData = await repositoryCreate( poolData ).readAfter({cursor: 0});
        assert.deepEqual( recordsData.map(function( itemData ){
            //Comparing application-visible journal order with transaction completion order
            return itemData.eventId;

        }), ['first', 'second'] );

    } finally {
        //Releasing both transactions before dropping only this test schema
        await firstClientData.query( 'ROLLBACK' );
        await secondClientData.query( 'ROLLBACK' );
        firstClientData.release();
        secondClientData.release();
        await poolData.query( `DROP SCHEMA IF EXISTS "${schemaData}" CASCADE` );
        await poolData.end();

    }

});
