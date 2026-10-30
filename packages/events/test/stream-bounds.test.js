import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setTimeout as delayWait} from 'node:timers/promises';
import test from 'node:test';
import {layerEventStreamManagerCreate} from '../src/event-stream-manager.js';


//Function for creating an intentionally non-reading SSE peer
/** @param {Partial<Parameters<typeof layerEventStreamManagerCreate>[0]>} [overridesData] */
const slowStreamFixtureCreate = function( overridesData = {} ){
    //Keeping socket lifecycle observable without retaining written payloads in the fixture
    const responseData = Object.assign( new EventEmitter(), {
        destroyed: false,
        writableEnded: false,
        writeHead(){
            //Accepting headers without a network listener

        },
        flushHeaders(){
            //Accepting the stream handshake

        },
        /** @returns {boolean} */
        write(){
            //Holding backpressure until the peer is closed
            return false;

        },
        end(){
            //Emitting native closure once
            if ( this.writableEnded === false ){
                this.writableEnded = true;
                responseData.emit( 'close' );

            }

        },
        destroy(){
            //Marking failure before waking close listeners
            this.destroyed = true;
            this.end();

        }
    });
    const managerData = layerEventStreamManagerCreate({
        heartbeatMs: 10,
        maxQueuedEvents: 4,
        maxQueuedBytes: 2048,
        writeTimeoutMs: 40,
        eventRepository: {
            async replay(){
                //Returning an empty consistent starting journal
                return {hasMore: false, events: []};

            }
        },
        diagnostics: {
            record(){
                //Discarding bounded technical telemetry in this fixture

            }
        },
        ...overridesData
    });
    const openedData = managerData.open({
        response: /** @type {any} */ (responseData),
        authorization: {tenantKey: 'tenant', userId: 'user', channels: ['messages']},
        cursor: null,
        remoteAddress: '127.0.0.1',
        requestId: 'test-stream'
    });

    //CallBack THE OBJECT
    return {response: responseData, manager: managerData, opened: openedData};

};

test( 'SSE closes a non-reading peer and releases its stream slot', async function( contextData ){
    //Allowing a stalled write to exercise the configured deadline
    const fixtureData = slowStreamFixtureCreate();
    contextData.after(function(){
        //Closing the fixture even when a regression assertion fails
        fixtureData.response.destroy();

    });
    await delayWait( 150 );
    assert.equal( fixtureData.manager.activeCount(), 0 );
    assert.equal( fixtureData.response.destroyed, true );
    await fixtureData.opened;
    assert.equal( fixtureData.response.listenerCount( 'drain' ), 0 );
    assert.equal( fixtureData.response.listenerCount( 'error' ), 0 );

});

test( 'SSE overflow disconnects the slow subscriber instead of retaining every event', async function( contextData ){
    //Letting the replay handshake finish before publishing a synchronous burst
    const fixtureData = slowStreamFixtureCreate();
    contextData.after(function(){
        //Closing the fixture without leaving heartbeat timers behind
        fixtureData.response.destroy();

    });
    await delayWait( 0 );
    for ( let sequenceData = 1; sequenceData <= 100; sequenceData += 1 ){
        fixtureData.manager.dispatch( 'tenant', {
            eventId: `event-${sequenceData}`,
            channel: 'messages',
            sequence: sequenceData,
            entityRevision: sequenceData,
            type: 'message.created',
            payload: {text: 'bounded'},
            occurredAt: '2026-10-25T00:00:00Z'
        });

    }

    //Checking immediate overload rejection independently of the later write deadline
    assert.equal( fixtureData.response.destroyed, true );
    await fixtureData.opened;
    assert.equal( fixtureData.manager.activeCount(), 0 );

});

test( 'SSE drain finishes even when the peer never acknowledges backpressure', async function( contextData ){
    //Keeping the stream open until the explicit server drain rather than waiting for heartbeats
    const fixtureData = slowStreamFixtureCreate({heartbeatMs: 60000});
    contextData.after(function(){
        //Closing owned resources on any assertion failure
        fixtureData.response.destroy();

    });
    await delayWait( 0 );
    const startTimeData = Date.now();
    await fixtureData.manager.drain();
    await fixtureData.opened;
    assert.ok( Date.now() - startTimeData < 1000 );
    assert.equal( fixtureData.manager.activeCount(), 0 );
    assert.equal( fixtureData.response.listenerCount( 'drain' ), 0 );

});

test( 'SSE rejects invalid bounds and a single over-budget event', async function(){
    //Checking invalid configuration before the fixture creates timers or opens a stream
    for ( const invalidBoundsData of [{maxQueuedEvents: 0}, {maxQueuedBytes: Infinity}, {writeTimeoutMs: -1}] ){
        assert.throws(function(){
            //Exercising the public manager factory validation
            slowStreamFixtureCreate( invalidBoundsData );

        }, /bounds are invalid/ );

    }

    //Checking byte limits independently of the event count threshold
    const fixtureData = slowStreamFixtureCreate();
    await delayWait( 0 );
    fixtureData.manager.dispatch( 'tenant', {
        eventId: 'oversized', channel: 'messages', sequence: 1, entityRevision: 1,
        type: 'message.created', payload: {text: 'x'.repeat( 4096 )}, occurredAt: '2026-10-25T00:00:00Z'
    });
    assert.equal( fixtureData.response.destroyed, true );
    await fixtureData.opened;

});

test( 'concurrent SSE opens reserve capacity before database replay', async function(){
    //Holding replay so a second open races the first before headers can be written
    const replayDeferredData = Promise.withResolvers();
    const fixtureData = slowStreamFixtureCreate({
        maxStreamsPerUser: 1,
        eventRepository: {
            replay(){
                //Returning the same controlled dependency operation
                return replayDeferredData.promise;

            }
        }
    });
    try {
        await assert.rejects( fixtureData.manager.open({
            response: /** @type {any} */ (fixtureData.response),
            authorization: {tenantKey: 'tenant', userId: 'user', channels: ['messages']},
            cursor: null, remoteAddress: '127.0.0.1', requestId: 'racing-open'
        }), {code: 'RATE_LIMITED'} );

    } finally {
        //Simulating a disconnected peer while its first replay was still pending
        fixtureData.response.destroy();
        replayDeferredData.resolve({hasMore: false, events: []});
        await fixtureData.opened;

    }

    //Ensuring the aborted pre-header reservation did not become an active stream
    assert.equal( fixtureData.manager.activeCount(), 0 );

});

test( 'SSE replay finishing during shutdown cannot open a new connection', async function(){
    //Holding the initial query across drain without opening a response or heartbeat
    const replayDeferredData = Promise.withResolvers();
    const fixtureData = slowStreamFixtureCreate({
        eventRepository: {
            replay(){
                //Completing the database query only after shutdown has started
                return replayDeferredData.promise;

            }
        }
    });
    await fixtureData.manager.drain();
    replayDeferredData.resolve({hasMore: false, events: []});

    //Returning the bounded dependency response instead of starting an orphan stream
    await assert.rejects( fixtureData.opened, {code: 'DEPENDENCY_UNAVAILABLE', status: 503} );
    assert.equal( fixtureData.manager.activeCount(), 0 );
    assert.equal( fixtureData.response.listenerCount( 'close' ), 0 );

});

test( 'slow subscriber overflow does not block a healthy peer', async function( contextData ){
    //Sharing a manager while allowing one response to acknowledge writes immediately
    const slowData = slowStreamFixtureCreate({heartbeatMs: 60000, writeTimeoutMs: 1000});
    const healthyResponseData = new EventEmitter();
    const receivedFramesData = [];
    Object.assign( healthyResponseData, {
        destroyed: false,
        writableEnded: false,
        writeHead(){
            //Accepting response headers for the healthy subscriber

        },
        flushHeaders(){
            //Completing its handshake

        },
        write( /** @type {string} */ frameData ){
            //Recording delivery without applying backpressure
            receivedFramesData.push( frameData );
            return true;

        },
        end(){
            //Closing the fixture through the same event used by native HTTP
            healthyResponseData.emit( 'close' );

        },
        destroy(){
            //Closing on an unexpected transport error as well
            healthyResponseData.emit( 'close' );

        }
    });
    const healthyOpenData = slowData.manager.open({response: /** @type {any} */ (healthyResponseData),
        authorization: {tenantKey: 'tenant', userId: 'healthy-user', channels: ['messages']},
        cursor: null, remoteAddress: '127.0.0.2', requestId: 'healthy-stream'});
    contextData.after(function(){
        //Releasing both peers independently on test failure
        slowData.response.destroy();
        healthyResponseData.emit( 'close' );

    });
    await delayWait( 0 );
    for ( let sequenceData = 1; sequenceData <= 10; sequenceData += 1 ){
        slowData.manager.dispatch( 'tenant', {eventId: `event-${sequenceData}`, channel: 'messages', sequence: sequenceData,
            entityRevision: sequenceData, type: 'message.created', payload: {}, occurredAt: '2026-10-25T00:00:00Z'} );
        await delayWait( 0 );

    }

    //Requiring all healthy effects while only the permanently blocked peer is removed
    assert.equal( slowData.response.destroyed, true );
    assert.equal( receivedFramesData.length, 10 );
    assert.equal( slowData.manager.activeCount(), 1 );
    healthyResponseData.emit( 'close' );
    await healthyOpenData;
    await slowData.opened;

});
