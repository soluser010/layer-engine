import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {createClient} from 'redis';
import {layerIdentityCacheCreate} from '../../security/src/identity-cache.js';
import {
    layerCacheInvalidationSynchronizerCreate,
    layerRedisQueryCacheCreate
} from '../src/index.js';

const requestCreate = function( payloadData = {}, ttlMsData = 30000 ){
    //Using one tag shared by entries with deliberately different lifetimes
    return {operation: 'messages.list', payload: payloadData, security: {},
        metadata: {scope: 'global', tags: ['messages'], ttlMs: ttlMsData}};

};

/** @param {string} namespaceData @param {any} clientData */
const namespaceClean = async function( namespaceData, clientData ){
    //Removing only this test namespace without flushing the shared Redis service
    if ( clientData.isOpen === false ){
        await clientData.connect();

    }

    const keysData = [];

    for await ( const batchData of clientData.scanIterator({MATCH: `${namespaceData}:*`, COUNT: 100}) ){
        keysData.push( ...batchData );

    }

    if ( keysData.length > 0 ){
        await clientData.del( keysData );

    }

    await clientData.quit();

};

test( 'Redis preserves long tag TTL and rejects stale query and identity fills after invalidation', {
    skip: process.env.LAYER_TEST_LOCAL_REDIS !== '1', timeout: 20000
}, async function(){
    //Executing the actual Lua scripts on the local service, not a script-shaped mock
    const namespaceData = `layer:audit:${randomUUID()}`;
    const clientData = createClient({socket: {host: '127.0.0.1', port: 6379, connectTimeout: 2000, reconnectStrategy: false}, database: 15, RESP: 2});
    clientData.on( 'error', function(){
        //Connection failures are surfaced by the awaited test operation

    });
    await clientData.connect();
    const cacheData = layerRedisQueryCacheCreate({redis: clientData, namespace: namespaceData});

    try {
        const longRequestData = requestCreate({page: 1});
        const shortRequestData = requestCreate({page: 2}, 200);
        await cacheData.write( longRequestData, 'long' );
        await cacheData.write( shortRequestData, 'short' );
        const tagKeysData = await clientData.keys( `${namespaceData}:v3:tag:*` );
        assert.equal( tagKeysData.length, 1 );
        assert.equal( await clientData.pTTL( String( tagKeysData[0] ) ) > 25000, true );
        await new Promise(function( resolveData ){
            //Letting only the short entry expire while the shared tag must remain
            setTimeout( resolveData, 250 );

        });
        assert.equal( (await cacheData.read( shortRequestData )).hit, false );
        await cacheData.invalidate({...longRequestData, tags: ['messages']});
        assert.equal( (await cacheData.read( longRequestData )).hit, false );

        //A loader that observed the old SQL state cannot publish after an invalidation
        const loadStartedData = Promise.withResolvers();
        const loadResultData = Promise.withResolvers();
        const executionData = cacheData.execute( longRequestData, async function(){
            //Pausing the source read until a later mutation has invalidated this tag
            loadStartedData.resolve( undefined );

            return loadResultData.promise;

        });
        await loadStartedData.promise;
        await cacheData.invalidate({...longRequestData, tags: ['messages']});
        loadResultData.resolve( 'old' );
        assert.equal( await executionData, 'old' );
        assert.equal( (await cacheData.read( longRequestData )).hit, false );
        assert.equal( await cacheData.execute( longRequestData, async function(){
            //Returning the authoritative value for the first load after invalidation
            return 'fresh';

        }), 'fresh' );
        assert.equal( (await cacheData.read( longRequestData )).value, 'fresh' );

        //The same generation fence protects durable identities resolved concurrently with revoke
        const identityStartedData = Promise.withResolvers();
        const identityReadData = Promise.withResolvers();
        let revokedStatusData = false;
        const identityCacheData = layerIdentityCacheCreate({cache: cacheData, sessions: {
            async resolve(){
                //Holding the old identity snapshot across a concurrent revocation
                if ( revokedStatusData ){
                    return null;

                }

                identityStartedData.resolve( undefined );

                return identityReadData.promise;

            },
            async revoke(){
                //Changing the durable identity before cache invalidation
                revokedStatusData = true;

                return true;

            },
            cacheTagCreate(){
                //Using a fixed test-only identity tag within this isolated namespace
                return 'session:test';

            }
        }, apiKeys: {
            resolve: async function(){
                //Leaving unrelated API-key identities absent in this session scenario
                return null;

            },
            revokeWithCacheTag: async function(){
                //Reporting no API-key mutation in this session-only fixture
                return {revoked: false, cacheTag: null};

            }
        }});
        const identityResultData = identityCacheData.sessions.resolve( 'test' );
        await identityStartedData.promise;
        await identityCacheData.sessions.revoke( 'test' );
        identityReadData.resolve({status: 'active', expiresAt: Date.now() + 30000});
        await identityResultData;
        assert.equal( await identityCacheData.sessions.resolve( 'test' ), null );

    } finally {
        await namespaceClean( namespaceData, clientData );

    }

});

test( 'Redis reconnect waits for every invalidation batch before serving cached data', {
    skip: process.env.LAYER_TEST_LOCAL_REDIS !== '1', timeout: 20000
}, async function(){
    //Closing only this application's Redis connection while preserving the shared server and cache
    const namespaceData = `layer:audit:${randomUUID()}`;
    const clientData = createClient({socket: {host: '127.0.0.1', port: 6379, connectTimeout: 2000, reconnectStrategy: false}, database: 15, RESP: 2, disableOfflineQueue: true});
    let versionData = 0;
    clientData.on( 'error', function(){
        //Invalidating transport ownership when a command connection fails
        versionData += 1;

    });
    clientData.on( 'ready', function(){
        //Requiring a new replay pass even when Redis becomes reachable again
        versionData += 1;

    });
    clientData.on( 'end', function(){
        //Dropping readiness immediately on explicit disconnect
        versionData += 1;

    });
    let synchronizerData = /** @type {ReturnType<typeof layerCacheInvalidationSynchronizerCreate> | null} */ (null);
    const cacheData = layerRedisQueryCacheCreate({redis: clientData, namespace: namespaceData, isReady(){
        //Sharing the managed runtime rule: transport and invalidation replay must both be ready
        return clientData.isReady && synchronizerData?.isReady() === true;

    }});
    const recordsData = /** @type {Record<string, any>[]} */ ([]);
    const readCursorsData = /** @type {number[]} */ ([]);
    synchronizerData = layerCacheInvalidationSynchronizerCreate({cache: cacheData, batchSize: 2, pollIntervalMs: 60000,
        connectionVersionRead(){
            //Identifying the connection used for this replay pass
            return versionData;

        },
        beforeSynchronize: async function(){
            //Declining replay while the actual Redis socket is closed
            return clientData.isReady;

        },
        repository: {async readAfter( replayData ){
            //Serving multiple durable batches while asserting that cache reads stay disabled
            readCursorsData.push( replayData.cursor );
            assert.equal( synchronizerData?.isReady(), false );

            return recordsData.filter(function( recordData ){
                //Selecting only journal entries after the acknowledged cursor
                return recordData.invalidationId > replayData.cursor;

            }).slice( 0, replayData.limit );

        }}});

    try {
        await clientData.connect();
        await synchronizerData.start();
        await cacheData.write( requestCreate(), 'old' );
        clientData.destroy();
        assert.equal( synchronizerData.isReady(), false );
        assert.equal( await cacheData.execute( requestCreate(), async function(){
            //Serving the durable fallback without contacting the disconnected cache
            return 'durable';

        }), 'durable' );
        await assert.rejects( cacheData.generationRead(), /CACHE_UNAVAILABLE/ );
        assert.equal( await cacheData.write( requestCreate(), 'wrong' ), false );

        for ( let indexData = 1; indexData <= 5; indexData += 1 ){
            recordsData.push({invalidationId: indexData, scope: 'global', tags: ['messages']});

        }

        await assert.rejects( synchronizerData.synchronize(), /CACHE_UNAVAILABLE/ );
        await clientData.connect();
        assert.equal( (await cacheData.read( requestCreate() )).hit, false );
        readCursorsData.length = 0;
        assert.equal( await synchronizerData.synchronize(), 5 );
        assert.deepEqual( readCursorsData, [0, 2, 4] );
        assert.equal( synchronizerData.isReady(), true );
        assert.equal( (await cacheData.read( requestCreate() )).hit, false );
        assert.equal( await cacheData.invalidationCursorRead(), 5 );

    } finally {
        await synchronizerData.stop();
        await namespaceClean( namespaceData, clientData );

    }

});

test( 'Invalidation catch-up retains not-ready state for bounded backlog and reconnect during replay', async function(){
    //Proving bounded replay without treating one full batch as the end of the journal
    let versionData = 0;
    let checkpointData = 0;
    let changeVersionStatusData = false;
    const synchronizerData = layerCacheInvalidationSynchronizerCreate({batchSize: 1, pollIntervalMs: 60000,
        connectionVersionRead(){
            //Exposing a controllable transport generation for the replay race
            return versionData;

        },
        cache: {
            async invalidate(){
                //Simulating a disconnect during one in-flight invalidation
                if ( changeVersionStatusData ){
                    versionData += 1;
                    changeVersionStatusData = false;

                }

            },
            async invalidationCursorRead(){
                //Reloading the last acknowledged journal position after failure
                return checkpointData;

            },
            async invalidationCursorWrite( cursorData ){
                //Acknowledging only a completely invalidated batch
                checkpointData = cursorData;

            }
        }, repository: {async readAfter( replayData ){
            //Producing one record beyond the bounded single-pass limit
            if ( replayData.cursor < 101 ){
                return [{invalidationId: replayData.cursor + 1, scope: 'global', tags: ['messages']}];

            }

            return [];

        }}});

    try {
        await synchronizerData.start();
        assert.equal( checkpointData, 100 );
        assert.equal( synchronizerData.isReady(), false );
        changeVersionStatusData = true;
        await assert.rejects( synchronizerData.synchronize(), /CACHE_UNAVAILABLE/ );
        assert.equal( synchronizerData.isReady(), false );
        await synchronizerData.synchronize();
        assert.equal( synchronizerData.isReady(), true );
        assert.equal( checkpointData, 101 );

    } finally {
        await synchronizerData.stop();

    }

});
