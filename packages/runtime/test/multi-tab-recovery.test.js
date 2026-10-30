import assert from 'node:assert/strict';
import test from 'node:test';
import {layerMultiTabEventsCreate, LayerRuntimeError} from '../src/index.js';


const channelName = 'test:recovery';


/** @param {number} sequence */
const eventCreate = function( sequence ){
    //Creating a protocol-valid event so sibling validation is exercised too
    return {
        eventId: '11111111-1111-4111-8111-111111111111', channel: channelName,
        sequence, entityRevision: sequence, type: 'record.changed', payload: {}, occurredAt: '2026-10-20T12:00:00.000Z'
    };

};

/** @param {Record<string, any>} [overrides] */
const followerFixtureCreate = function( overrides = {} ){
    //Capturing sibling messages without opening a real network or shared database
    let handler = /** @type {((data: MessageEvent) => void) | null} */ (null);
    let cursor = 1;
    const errors = /** @type {any[]} */ ([]);
    const applied = /** @type {number[]} */ ([]);
    const messages = /** @type {any[]} */ ([]);
    const state = {closed: 0, synced: 0};
    const coordinator = layerMultiTabEventsCreate({
        originKey: 'fixture', channels: [channelName], tabIdCreate: function(){
            //Keeping the follower identity distinct from the synthetic leader
            return 'follower';

        },
        cursorRead: function(){
            //Reading a shared durable cursor only during initialization or explicit snapshot recovery
            return {[channelName]: cursor};

        },
        eventReceive: function( eventData ){
            //Recording ordered per-tab effects rather than overwriting the leader's shared cursor
            applied.push( Number( eventData.sequence ) );

        },
        syncHandle: function(){
            //Installing a domain snapshot before later sibling events may be applied
            state.synced += 1;
            cursor = 10;

        },
        failureHandle: function( errorData ){
            //Keeping failures observable without throwing inside a BroadcastChannel callback
            errors.push( errorData );

        },
        streamRun: async function(){
            //A waiting follower never owns the stream in this fixture
            assert.fail( 'The follower must not open a second stream.' );

        },
        lockManager: {request: async function( _name, options ){
            //Holding the follower in the native lock queue until its lifecycle is cancelled
            await new Promise(function( resolve ){
                //Waiting for lock cancellation without granting leadership
                options.signal.addEventListener( 'abort', function(){
                    //Completing the cancelled lock wait
                    resolve( undefined );

                }, {once: true} );

            });

        }},
        broadcastChannelCreate: function(){
            //Returning an isolated channel facade with explicit cleanup counters
            return {
                postMessage: function( messageData ){
                    //Recording outgoing coordination metadata
                    messages.push( messageData );

                },
                addEventListener: function( _name, listener ){
                    //Retaining the fixture's active message listener
                    handler = listener;

                },
                removeEventListener: function(){
                    //Removing the listener owned by this channel
                    handler = null;

                },
                close: function(){
                    //Recording channel release for teardown assertions
                    state.closed += 1;

                }
            };

        },
        ...overrides
    });

    //Exposing only fixture controls needed to deliver a bounded sibling message
    return {coordinator, state, errors, applied, messages,
        send: function( messageData = {} ){
            handler?.( /** @type {MessageEvent} */ ({data: {tabId: 'leader', ...messageData}}) );

        },
        cursorSet: function( /** @type {number} */ sequence ){
            //Simulating a cursor advanced by another tab
            cursor = sequence;

        }
    };

};

const messagesFlush = async function(){
    //Allowing promise-based sibling processing and hook continuations to settle deterministically
    for ( let turnIndex = 0; turnIndex < 12; turnIndex += 1 ){
        await new Promise(function( resolve ){
            //Resuming after queued promise continuations
            setImmediate( resolve );

        });

    }

};

test( 'followers apply their own snapshot before queued events and ignore duplicate delivery', async function(){
    //Queuing snapshot and later events as native BroadcastChannel would deliver them
    const fixture = followerFixtureCreate();
    await fixture.coordinator.start();
    fixture.send({type: 'snapshot-required', channels: [channelName]});
    fixture.send({type: 'event', event: eventCreate( 11 )});
    fixture.send({type: 'event', event: eventCreate( 11 )});
    await messagesFlush();

    //Checking that advancing shared storage alone was not mistaken for applying a tab's state
    assert.equal( fixture.state.synced, 1 );
    assert.deepEqual( fixture.applied, [11] );
    assert.deepEqual( fixture.errors, [] );
    await fixture.coordinator.stop();
    assert.equal( fixture.state.closed, 1 );

});

test( 'followers recover a missing event and announce their own applied cursor', async function(){
    //Simulating a shared database cursor already advanced by another tab
    const fixture = followerFixtureCreate();
    await fixture.coordinator.start();
    fixture.cursorSet( 20 );
    fixture.send({type: 'cursor-request'});
    fixture.send({type: 'event', event: eventCreate( 11 )});
    await messagesFlush();

    //Checking that election uses local application progress rather than an unrelated shared write
    assert.equal( fixture.messages[0].cursor[channelName], 1 );
    assert.equal( fixture.state.synced, 1 );
    assert.deepEqual( fixture.applied, [11] );
    await fixture.coordinator.stop();

});

test( 'an authorization failure cancels the follower and discards later queued events', async function(){
    //Refusing a snapshot because the current user lost access to the subscribed domain
    const fixture = followerFixtureCreate({syncHandle: function(){
        //Propagating channel access revocation
        throw new LayerRuntimeError( 'PERMISSION_DENIED', 'Denied.', {status: 403} );

    }});
    await fixture.coordinator.start();
    fixture.send({type: 'snapshot-required', channels: [channelName]});
    fixture.send({type: 'event', event: eventCreate( 2 )});
    await messagesFlush();
    assert.deepEqual( fixture.applied, [] );
    assert.equal( fixture.errors[0].status, 403 );
    await fixture.coordinator.stop();

});

test( 'an explicit snapshot cursor cannot be replaced by a newer shared cursor from another tab', async function(){
    //Applying a snapshot at ten while another tab has already persisted sequence twenty
    const fixture = followerFixtureCreate({syncHandle: function(){
        //Returning the exact installed snapshot position rather than the shared storage high watermark
        return {cursor: 10};

    }});
    await fixture.coordinator.start();
    fixture.cursorSet( 20 );
    fixture.send({type: 'snapshot-required', channels: [channelName]});
    fixture.send({type: 'event', event: eventCreate( 11 )});
    await messagesFlush();
    assert.deepEqual( fixture.applied, [11] );
    assert.deepEqual( fixture.errors, [] );
    await fixture.coordinator.stop();

});

test( 'stopping during a follower snapshot prevents late delivery and releases its channel', async function(){
    //Holding a snapshot hook that does not cooperate with AbortSignal
    const fixture = followerFixtureCreate({syncHandle: function(){
        return new Promise(function(){
            //Framework ownership must end without waiting forever for this application hook

        });

    }});
    await fixture.coordinator.start();
    fixture.send({type: 'snapshot-required', channels: [channelName]});
    fixture.send({type: 'event', event: eventCreate( 11 )});
    await messagesFlush();
    await fixture.coordinator.stop();
    assert.deepEqual( fixture.applied, [] );
    assert.equal( fixture.state.closed, 1 );
    assert.deepEqual( fixture.errors, [] );

});

test( 'malformed or foreign sibling snapshot metadata cannot load unauthorized channels', async function(){
    //Rejecting recovery injection before the domain snapshot hook runs
    const fixture = followerFixtureCreate();
    await fixture.coordinator.start();
    fixture.send({type: 'snapshot-required', channels: ['other:user']});
    await messagesFlush();
    assert.equal( fixture.state.synced, 0 );
    assert.equal( fixture.errors[0].code, 'STREAM_RECOVERY_INVALID' );
    await fixture.coordinator.stop();

});

test( 'leader snapshot recovery broadcasts only channel metadata and cleans up for re-election', async function(){
    //Electing one synthetic leader and observing the snapshot bridge passed to its runtime
    let runOptions = /** @type {any} */ (null);
    const fixture = followerFixtureCreate({
        lockManager: {request: async function( /** @type {string} */ _name, /** @type {any} */ _options, /** @type {Function} */ callback ){
            //Granting the lock to the first tab in this fixture
            await callback({});

        }},
        peerCollectionMs: 1,
        streamRun: async function( /** @type {any} */ options ){
            //Keeping the elected stream alive until its owner stops it
            runOptions = options;
            await new Promise(function( resolve ){
                //Waiting for the elected leader's lifecycle to end
                options.signal.addEventListener( 'abort', function(){
                    //Completing the stopped leader's stream
                    resolve( undefined );

                }, {once: true} );

            });

        }
    });
    await fixture.coordinator.start();
    while ( runOptions === null ){
        await messagesFlush();

    }

    fixture.cursorSet( 10 );
    await runOptions.snapshotObserve( [channelName] );
    const snapshotMessage = fixture.messages.find(function( messageData ){
        //Selecting the bridge message without relying on election-message ordering
        return messageData.type === 'snapshot-required';

    });
    assert.deepEqual( Object.keys( snapshotMessage ).sort(), ['channels', 'tabId', 'type'] );
    assert.deepEqual( snapshotMessage.channels, [channelName] );
    await fixture.coordinator.stop();
    assert.equal( fixture.coordinator.isStarted(), false );
    assert.equal( fixture.state.closed, 1 );

});
