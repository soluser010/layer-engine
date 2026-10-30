import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {layerAuthenticationCreate} from '../../security/src/authentication.js';
import {layerAuthSessionRepositoryCreate, layerDatabaseMigrate} from '../src/index.js';

const dayMillisecondsData = 86400000;
const issuedAtData = Date.parse( '2026-10-01T12:00:00Z' );


/**
 * @param {import('node:test').TestContext} testContextData
 * @param {boolean} [legacySeedStatusData]
 */
async function activityFixtureCreate( testContextData, legacySeedStatusData = false ){
    //Creating an isolated real SQL engine; only its test clock is substituted.
    const databaseData = new PGlite();
    let currentTimeData = issuedAtData;
    testContextData.after( function databaseClose(){
        //Closing the private SQL engine after success or assertion failure.
        return databaseData.close();

    });
    const databaseAdapterData = {
        kind: /** @type {const} */ ('embedded'),
        systemSchema: 'layer_session_activity',

        async query( /** @type {{text: string, values: readonly unknown[]}} */ queryData ){
            //Seeding pre-upgrade records immediately before the actual migration nine runs.
            if ( legacySeedStatusData === true && queryData.text.includes( 'ADD COLUMN idle_lifetime_ms' ) ){
                for ( const sessionStatusData of ['active', 'revoked', 'expired'] ){
                    let expiryData = issuedAtData + 7 * dayMillisecondsData;
                    let persistedStatusData = 'active';

                    if ( sessionStatusData === 'expired' ){
                        expiryData = issuedAtData - 1;

                    }

                    if ( sessionStatusData === 'revoked' ){
                        persistedStatusData = 'revoked';

                    }
                    await databaseData.query(
                        `INSERT INTO layer_session_activity.sys_sessions
                            (session_hash, session_id, user_id, csrf_hash, status, managed, expires_at,
                             idle_expires_at, absolute_expires_at, last_seen_at)
                         VALUES ($6, $1, 'legacy-user', 'hash', $2, true, $3, $3, $4, $5)`,
                        [sessionStatusData, persistedStatusData,
                            new Date( expiryData ), new Date( issuedAtData + 30 * dayMillisecondsData ),
                            new Date( expiryData - 7 * dayMillisecondsData ),
                            createHmac( 'sha256', 'test-session-pepper-with-no-production-access' )
                                .update( `legacy-session-token-${sessionStatusData}` ).digest( 'hex' )]
                    );

                }

            }

            //Using simple queries for migration batches and bound parameters for runtime SQL.
            if ( queryData.values.length === 0 ){
                const batchResultData = await databaseData.exec( queryData.text );
                const lastResultData = batchResultData.at( -1 );
                return {rows: /** @type {any[]} */ (lastResultData?.rows ?? []), rowCount: lastResultData?.affectedRows ?? 0};

            }

            const valuesData = [...queryData.values];
            let sqlData = queryData.text;

            //Advancing SQL time without waiting days or changing the operating system clock.
            if ( /(?:now|statement_timestamp|clock_timestamp)\(\)/u.test( sqlData ) ){
                valuesData.push( currentTimeData );
                sqlData = sqlData.replace( /(?:now|statement_timestamp|clock_timestamp)\(\)/gu, `to_timestamp($${valuesData.length}::double precision / 1000)` );

            }

            const queryResultData = await databaseData.query( sqlData, valuesData );
            return {rows: /** @type {any[]} */ (queryResultData.rows), rowCount: queryResultData.affectedRows ?? queryResultData.rows.length};

        },

        async transaction( /** @type {Function} */ handlerData ){
            //Keeping framework migrations transactional on the isolated test database.
            await databaseData.exec( 'BEGIN' );

            try {
                const transactionResultData = await handlerData( databaseAdapterData );
                await databaseData.exec( 'COMMIT' );
                return transactionResultData;

            } catch( transactionError ){
                await databaseData.exec( 'ROLLBACK' );
                throw transactionError;

            }

        }
    };
    await layerDatabaseMigrate( databaseAdapterData );
    const repositoryOptionsData = {
        database: databaseAdapterData,
        sessionPepper: 'test-session-pepper-with-no-production-access',
        clock(){
            //Providing deterministic issuance time without changing system time.
            return currentTimeData;

        }
    };
    const repositoryData = layerAuthSessionRepositoryCreate( repositoryOptionsData );

    //Returning separate repositories to model independent workers sharing durable session state.
    return {
        database: databaseData,
        adapter: databaseAdapterData,
        repository: repositoryData,
        secondRepository: layerAuthSessionRepositoryCreate( repositoryOptionsData ),
        clock: repositoryOptionsData.clock,
        timeSet( /** @type {number} */ timestampData ){
            //Moving only the fixture clock used by SQL and credential validation.
            currentTimeData = timestampData;

        },
        async issue( idleLifetimeData = 7 * dayMillisecondsData, absoluteLifetimeData = 30 * dayMillisecondsData ){
            //Issuing one managed session with the policy chosen at sign-in.
            return repositoryData.issue({
                userId: 'activity-user',
                permissions: ['chat.read'],
                idleLifetimeMs: idleLifetimeData,
                idleExpiresAt: currentTimeData + idleLifetimeData,
                absoluteExpiresAt: currentTimeData + absoluteLifetimeData
            });

        },
        async row( /** @type {string} */ identifierData ){
            //Inspecting durable deadlines and physical row revision without reading credentials.
            const rowResultData = await databaseData.query(
                'SELECT idle_expires_at, absolute_expires_at, expires_at, last_seen_at, idle_lifetime_ms, xmin::text AS revision FROM layer_session_activity.sys_sessions WHERE session_id = $1',
                [identifierData]
            );
            return /** @type {any} */ (rowResultData.rows[0]);

        }
    };

}

/** @param {Awaited<ReturnType<typeof activityFixtureCreate>>} fixtureData */
function activitySecurityCreate( fixtureData ){
    //Using the actual security boundary so invalid requests never count as activity.
    return layerAuthenticationCreate({
        allowedOrigins: ['https://app.example.test'],
        sessionResolve: fixtureData.repository.resolve,
        sessionTouch( tokenData ){
            //Passing verified activity to the durable primary repository.
            return fixtureData.repository.touch( tokenData, 300000 );

        },
        clock: fixtureData.clock
    });

}

/** @param {{sessionToken: string, csrfToken: string}} sessionData */
function activityRequestCreate( sessionData ){
    //Preparing a same-origin API request with the matching opaque session and CSRF proof.
    return {
        auth: /** @type {const} */ ('session'),
        permissions: ['chat.read'],
        remoteAddress: '127.0.0.1',
        headers: {
            origin: 'https://app.example.test',
            cookie: `layer_session=${sessionData.sessionToken}`,
            'x-layer-csrf': sessionData.csrfToken
        }
    };

}

test( 'daily verified activity survives day seven but never extends the absolute day thirty limit', async function( testContextData ){
    const fixtureData = await activityFixtureCreate( testContextData );
    const sessionData = await fixtureData.issue();
    const securityData = activitySecurityCreate( fixtureData );

    //Reproducing daily API use across the original seven-day failure boundary.
    for ( let dayIndexData = 1; dayIndexData < 30; dayIndexData += 1 ){
        fixtureData.timeSet( issuedAtData + dayIndexData * dayMillisecondsData );
        await securityData.contextResolve( activityRequestCreate( sessionData ) );
        const rowData = await fixtureData.row( sessionData.sessionId );
        const expectedExpiryData = Math.min( issuedAtData + 30 * dayMillisecondsData, fixtureData.clock() + 7 * dayMillisecondsData );
        assert.equal( rowData.idle_expires_at.getTime(), expectedExpiryData );
        assert.equal( rowData.expires_at.getTime(), expectedExpiryData );
        assert.equal( rowData.last_seen_at.getTime(), fixtureData.clock() );
        assert.equal( Number( rowData.idle_lifetime_ms ), 7 * dayMillisecondsData );

    }

    //Rejecting both resolution and renewal at the absolute boundary.
    fixtureData.timeSet( issuedAtData + 30 * dayMillisecondsData );
    await assert.rejects( securityData.contextResolve( activityRequestCreate( sessionData ) ), {code: 'AUTH_REQUIRED'} );
    assert.equal( await fixtureData.repository.touch( sessionData.sessionToken ), false );

});

test( 'idle activity writes are throttled and concurrent workers cannot shorten expiry', async function( testContextData ){
    const fixtureData = await activityFixtureCreate( testContextData );
    const sessionData = await fixtureData.issue();
    const originalRowData = await fixtureData.row( sessionData.sessionId );

    //Checking repeated requests inside the interval do not create new row versions.
    fixtureData.timeSet( issuedAtData + 299999 );
    assert.equal( await fixtureData.repository.touch( sessionData.sessionToken ), true );
    assert.equal( (await fixtureData.row( sessionData.sessionId )).revision, originalRowData.revision );

    //Renewing from two independent repositories at the same interval boundary.
    fixtureData.timeSet( issuedAtData + 300000 );
    assert.deepEqual( await Promise.all([
        fixtureData.repository.touch( sessionData.sessionToken ),
        fixtureData.secondRepository.touch( sessionData.sessionToken )
    ]), [true, true] );
    const renewedRowData = await fixtureData.row( sessionData.sessionId );
    assert.equal( renewedRowData.idle_expires_at.getTime(), fixtureData.clock() + 7 * dayMillisecondsData );
    assert.notEqual( renewedRowData.revision, originalRowData.revision );

    //A clock regression or late request must not move activity or expiry backwards.
    fixtureData.timeSet( issuedAtData + 100000 );
    assert.equal( await fixtureData.repository.touch( sessionData.sessionToken ), true );
    assert.deepEqual( await fixtureData.row( sessionData.sessionId ), renewedRowData );

    //Capping an oversized interval so a short idle policy can still renew before expiring.
    const shortSessionData = await fixtureData.issue( 60000, 3600000 );
    fixtureData.timeSet( fixtureData.clock() + 30000 );
    assert.equal( await fixtureData.repository.touch( shortSessionData.sessionToken, 3600000 ), true );
    assert.equal( (await fixtureData.row( shortSessionData.sessionId )).idle_expires_at.getTime(), fixtureData.clock() + 60000 );

});

test( 'CSRF and permission failures never renew sessions; stale cached identities cannot resurrect them', async function( testContextData ){
    const fixtureData = await activityFixtureCreate( testContextData );
    const sessionData = await fixtureData.issue();
    const securityData = activitySecurityCreate( fixtureData );
    const requestData = activityRequestCreate( sessionData );
    const initialRowData = await fixtureData.row( sessionData.sessionId );
    fixtureData.timeSet( issuedAtData + dayMillisecondsData );

    //Rejecting untrusted origin, CSRF proof and unavailable permissions before activity writes.
    await assert.rejects( securityData.contextResolve({...requestData, headers: {...requestData.headers, origin: 'https://evil.example'}}), {code: 'CSRF_INVALID'} );
    await assert.rejects( securityData.contextResolve({...requestData, headers: {...requestData.headers, 'x-layer-csrf': 'wrong'}}), {code: 'CSRF_INVALID'} );
    await assert.rejects( securityData.contextResolve({...requestData, permissions: ['admin.write']}), {code: 'PERMISSION_DENIED'} );
    assert.deepEqual( await fixtureData.row( sessionData.sessionId ), initialRowData );

    //Simulating an identity cache that still holds a pre-revocation session snapshot.
    const cachedIdentityData = await fixtureData.repository.resolve( sessionData.sessionToken );
    assert.notEqual( cachedIdentityData, null );
    const cachedSecurityData = layerAuthenticationCreate({
        allowedOrigins: ['https://app.example.test'],
        sessionResolve(){
            //Returning the stale cache snapshot to exercise durable rejection.
            return cachedIdentityData;

        },
        sessionTouch: fixtureData.repository.touch,
        clock: fixtureData.clock
    });
    await fixtureData.repository.revokeById( sessionData.sessionId, 'activity-user' );
    await assert.rejects( cachedSecurityData.contextResolve( requestData ), {code: 'AUTH_REQUIRED'} );
    assert.equal( (await fixtureData.row( sessionData.sessionId )).idle_expires_at.getTime(), initialRowData.idle_expires_at.getTime() );

    //An expired idle deadline cannot be revived even while the absolute deadline is valid.
    const idleSessionData = await fixtureData.issue();
    fixtureData.timeSet( fixtureData.clock() + 7 * dayMillisecondsData );
    assert.equal( await fixtureData.repository.touch( idleSessionData.sessionToken ), false );
    assert.equal( await fixtureData.repository.resolve( idleSessionData.sessionToken ), null );
    assert.equal( await fixtureData.repository.touch( 'unknown-session-token-value' ), false );

});

test( 'migration preserves old deadlines and derives each legacy idle policy without restoring sessions', async function( testContextData ){
    const fixtureData = await activityFixtureCreate( testContextData, true );

    //Checking actual upgrade data retains both original expiration boundaries and activity.
    for ( const sessionStatusData of ['active', 'revoked', 'expired'] ){
        const rowData = await fixtureData.row( sessionStatusData );
        let expectedExpiryData = issuedAtData + 7 * dayMillisecondsData;

        if ( sessionStatusData === 'expired' ){
            expectedExpiryData = issuedAtData - 1;

        }
        assert.equal( rowData.idle_expires_at.getTime(), expectedExpiryData );
        assert.equal( rowData.expires_at.getTime(), expectedExpiryData );
        assert.equal( rowData.absolute_expires_at.getTime(), issuedAtData + 30 * dayMillisecondsData );
        assert.equal( Number( rowData.idle_lifetime_ms ), 7 * dayMillisecondsData );
        assert.equal( rowData.last_seen_at.getTime(), expectedExpiryData - 7 * dayMillisecondsData );

    }

    //Verifying the completed migration remains idempotent on restart.
    assert.deepEqual( await layerDatabaseMigrate( fixtureData.adapter ), [] );

    //Renewing an existing live session while keeping expired and revoked records unusable.
    fixtureData.timeSet( issuedAtData + dayMillisecondsData );
    assert.equal( await fixtureData.repository.touch( 'legacy-session-token-active' ), true );
    assert.equal( (await fixtureData.row( 'active' )).idle_expires_at.getTime(), issuedAtData + 8 * dayMillisecondsData );
    assert.equal( await fixtureData.repository.touch( 'legacy-session-token-revoked' ), false );
    assert.equal( await fixtureData.repository.touch( 'legacy-session-token-expired' ), false );

});

test( 'activity hook fails closed on storage failure and ignores anonymous or bearer requests', async function( testContextData ){
    const fixtureData = await activityFixtureCreate( testContextData );
    const sessionData = await fixtureData.issue();
    const identityData = await fixtureData.repository.resolve( sessionData.sessionToken );
    let touchCountData = 0;
    const securityData = layerAuthenticationCreate({
        allowedOrigins: ['https://app.example.test'],
        sessionResolve: fixtureData.repository.resolve,
        bearerResolve(){
            //Reusing a valid identity shape for a separate non-cookie authentication method.
            return identityData;

        },
        sessionTouch(){
            //Simulating unavailable durable storage without accepting the cached identity.
            touchCountData += 1;
            throw new Error( 'Test storage unavailable' );

        },
        clock: fixtureData.clock
    });
    const requestData = activityRequestCreate( sessionData );
    await assert.rejects( securityData.contextResolve( requestData ), /Test storage unavailable/u );
    await assert.rejects( securityData.contextResolve({...requestData, auth: 'authenticated'}), /Test storage unavailable/u );
    await securityData.contextResolve({...requestData, auth: 'none'});
    await securityData.contextResolve({
        ...requestData,
        auth: 'bearer',
        headers: {authorization: 'Bearer test-opaque-bearer-token'}
    });
    assert.equal( touchCountData, 2 );
    assert.throws( function invalidActivityHookCreate(){
        //Rejecting a non-callable activity hook during security construction.
        layerAuthenticationCreate({sessionTouch: /** @type {any} */ (true)});

    }, TypeError );

});

test( 'session activity rejects malformed policy and interval without issuing credentials or touching state', async function( testContextData ){
    const fixtureData = await activityFixtureCreate( testContextData );

    //Rejecting out-of-range intervals and malformed opaque credentials at the repository boundary.
    for ( const intervalData of [0, 9999, 3600001, NaN, 10000.5] ){
        await assert.rejects( fixtureData.repository.touch( 'valid-token-length-for-test', intervalData ), TypeError );

    }

    for ( const tokenData of ['', 'short', 'a'.repeat( 513 ), null] ){
        await assert.rejects( fixtureData.repository.touch( /** @type {any} */ (tokenData) ), TypeError );

    }

    for ( const lifetimeData of [0, -1, NaN, 31536000001, 1.5] ){
        await assert.rejects( fixtureData.repository.issue({
            userId: 'activity-user',
            idleLifetimeMs: lifetimeData,
            idleExpiresAt: issuedAtData + dayMillisecondsData,
            absoluteExpiresAt: issuedAtData + 30 * dayMillisecondsData
        }), TypeError );

    }

});
