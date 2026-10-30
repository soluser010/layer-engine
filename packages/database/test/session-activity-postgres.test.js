import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {Pool} from 'pg';
import {layerAuthSessionRepositoryCreate, layerDatabaseMigrate, layerPostgresDatabaseCreate} from '../src/index.js';

test( 'PostgreSQL session activity serializes workers and rejects revocation or expiry while waiting', {
    skip: process.env.LAYER_TEST_LOCAL_POSTGRES !== '1',
    timeout: 30000
}, async function(){
    //Using only the explicitly enabled local test service and a fresh disposable schema.
    const schemaData = `layer_session_test_${randomUUID().replaceAll( '-', '' )}`;
    const applicationNameData = schemaData;
    const poolData = new Pool({
        host: '127.0.0.1',
        port: 5432,
        database: 'postgres',
        user: 'postgres',
        max: 4,
        connectionTimeoutMillis: 2000,
        statement_timeout: 10000,
        application_name: applicationNameData
    });
    const databaseData = layerPostgresDatabaseCreate({
        connectionOptions: {host: '127.0.0.1'},
        systemSchema: schemaData,
        poolCreate(){
            //Sharing a bounded pool while concurrent operations use separate PostgreSQL connections.
            return poolData;

        }
    });

    try {
        await databaseData.connect();
        await layerDatabaseMigrate( databaseData );
        const repositoryOptionsData = {
            database: databaseData,
            sessionPepper: 'test-only-session-pepper-never-used-by-applications'
        };
        const firstRepositoryData = layerAuthSessionRepositoryCreate( repositoryOptionsData );
        const secondRepositoryData = layerAuthSessionRepositoryCreate( repositoryOptionsData );
        const sessionData = await firstRepositoryData.issue({
            userId: 'postgres-test-user',
            idleLifetimeMs: 3600000,
            idleExpiresAt: Date.now() + 3600000,
            absoluteExpiresAt: Date.now() + 86400000
        });
        await poolData.query( `UPDATE "${schemaData}".sys_sessions SET last_seen_at = now() - INTERVAL '10 minutes'` );

        //Proving concurrent worker requests renew once without deadlocks or lost state.
        const workerResultsData = await Promise.all([
            firstRepositoryData.touch( sessionData.sessionToken ),
            secondRepositoryData.touch( sessionData.sessionToken )
        ]);
        assert.deepEqual( workerResultsData, [true, true] );
        const originalRevisionData = await poolData.query( `SELECT xmin::text AS revision FROM "${schemaData}".sys_sessions` );
        await firstRepositoryData.touch( sessionData.sessionToken );
        const repeatedRevisionData = await poolData.query( `SELECT xmin::text AS revision FROM "${schemaData}".sys_sessions` );
        assert.deepEqual( repeatedRevisionData.rows, originalRevisionData.rows );

        const blockerData = await poolData.connect();

        try {
            //Holding an uncommitted revocation while a second connection tries to record activity.
            await blockerData.query( 'BEGIN' );
            await blockerData.query( `UPDATE "${schemaData}".sys_sessions SET status = 'revoked'` );
            const pendingTouchData = secondRepositoryData.touch( sessionData.sessionToken );
            await activityLockWait( poolData, applicationNameData );
            await blockerData.query( 'COMMIT' );
            assert.equal( await pendingTouchData, false );

            //Issuing another session, then holding its row lock past a near idle deadline.
            const expiringSessionData = await firstRepositoryData.issue({
                userId: 'postgres-test-user',
                idleLifetimeMs: 3600000,
                idleExpiresAt: Date.now() + 3600000,
                absoluteExpiresAt: Date.now() + 86400000
            });
            await poolData.query(
                `UPDATE "${schemaData}".sys_sessions SET idle_expires_at = now() + INTERVAL '1 second',
                    last_seen_at = now() - INTERVAL '10 minutes' WHERE session_id = $1`,
                [expiringSessionData.sessionId]
            );
            await blockerData.query( 'BEGIN' );
            await blockerData.query( `SELECT 1 FROM "${schemaData}".sys_sessions WHERE session_id = $1 FOR UPDATE`, [expiringSessionData.sessionId] );
            const expiringTouchData = secondRepositoryData.touch( expiringSessionData.sessionToken );
            await activityLockWait( poolData, applicationNameData );
            await delay( 1100 );
            await blockerData.query( 'COMMIT' );
            assert.equal( await expiringTouchData, false );
            assert.equal( await firstRepositoryData.resolve( expiringSessionData.sessionToken ), null );

        } finally {
            //Releasing a test lock even if an assertion fails before committing.
            await blockerData.query( 'ROLLBACK' );
            blockerData.release();

        }

    } finally {
        //Dropping only the validated, newly generated test schema, never application data.
        if ( /^layer_session_test_[a-f0-9]{32}$/u.test( schemaData ) === true && databaseData.isReady() === true ){
            await poolData.query( `DROP SCHEMA IF EXISTS "${schemaData}" CASCADE` );

        }

        await databaseData.close();

    }

});

/**
 * @param {Pool} poolData
 * @param {string} applicationNameData
 */
async function activityLockWait( poolData, applicationNameData ){
    //Waiting for observed PostgreSQL lock contention instead of assuming scheduler timing.
    for ( let attemptIndexData = 0; attemptIndexData < 100; attemptIndexData += 1 ){
        const waitingResultData = await poolData.query(
            "SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
            [applicationNameData]
        );

        if ( waitingResultData.rows.length > 0 ){
            return;

        }

        await delay( 20 );

    }

    //Failing explicitly when the concurrent request did not reach the intended race.
    throw new Error( 'Session activity did not reach the expected PostgreSQL row lock.' );

}
