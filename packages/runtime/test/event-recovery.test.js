import assert from 'node:assert/strict';
import test from 'node:test';
import {layerEventRuntimeCreate, layerPostEventStreamCreate, LayerRuntimeError} from '../src/index.js';
import {layerEventAbortableWait, layerRecoveryChannelsRead} from '../src/event-recovery.js';


const channelName = 'test:recovery';
const requestId = '11111111-1111-4111-8111-111111111111';


/** @param {Record<string, any>} [overrides] */
const recoveryFixtureCreate = function( overrides = {} ){
    //Preparing independent durable state and cancellation for each isolated runtime
    const state = {sequence: 1, syncs: 0, opens: /** @type {number[]} */ ([]), applied: /** @type {number[]} */ ([])};
    const abortController = new AbortController();
    const runtime = layerEventRuntimeCreate({
        channels: [channelName],
        cursorRead: function(){
            //Reading the last confirmed snapshot or event position
            return {[channelName]: state.sequence};

        },
        cursorWrite: function( _channel, sequence ){
            //Confirming persistence before the runtime acknowledges an event
            state.sequence = sequence;

        },
        eventApply: function( eventData ){
            //Recording effects so duplicate deliveries can be detected
            state.applied.push( Number( eventData.sequence ) );

        },
        syncHandle: function(){
            //Installing a fixture snapshot at a known consistent sequence
            state.syncs += 1;
            state.sequence = 10;

        },
        stream: {async open(/** @type {any} */ streamData ){
            //Simulating an expired initial replay followed by a healthy delivery
            state.opens.push( streamData.cursor[channelName] );
            if ( state.opens.length === 1 ){
                throw new LayerRuntimeError( 'CURSOR_EXPIRED', 'Snapshot required.', {
                    status: 409, details: {channels: [channelName]}
                });

            }

            await streamData.eventHandle({channel: channelName, sequence: 11});
            abortController.abort();

        }},
        ...overrides
    });

    //Returning fixture controls without sharing mutable state between tests
    return {state, abortController, runtime};

};

test( 'HTTP 409 recovery reloads durable cursor, reapplies auth and deduplicates later events', async function(){
    //Launching the same contract used by the generated application runtime
    const fixture = recoveryFixtureCreate();
    await fixture.runtime.run({signal: fixture.abortController.signal});

    //Checking that the next open uses the snapshot position instead of the expired cursor
    assert.deepEqual( fixture.state.opens, [1, 10] );
    assert.equal( fixture.state.syncs, 1 );
    assert.deepEqual( fixture.state.applied, [11] );

});

test( 'snapshot-required updates both reconnect cursor and lagging multi-tab request cursor', async function(){
    //Exercising both single-tab reconnect and a minimum peer cursor supplied at election
    for ( const withPeer of [false, true] ){
        let sequence = 1;
        const opens = /** @type {number[]} */ ([]);
        const controller = new AbortController();
        const runtime = layerEventRuntimeCreate({
            channels: [channelName],
            cursorRead: function(){
                //Returning the cursor committed by the domain snapshot hook
                return {[channelName]: sequence};

            },
            cursorWrite: function(){
                //This fixture performs no new domain-event writes

            },
            eventApply: function(){
                //This fixture reconnects without delivering a domain event

            },
            syncHandle: function(){
                //Installing the snapshot before the first connection ends
                sequence = 10;

            },
            random: function(){
                //Keeping the reconnect delay deterministic
                return 0;

            },
            stream: {async open(/** @type {any} */ streamData ){
                //Ending the first stream after its snapshot control record
                opens.push( streamData.cursor[channelName] );
                if ( opens.length === 1 ){
                    await streamData.controlHandle({type: 'snapshot-required', channels: [channelName]});
                    return;

                }

                controller.abort();

            }}
        });
        const options = /** @type {any} */ ({signal: controller.signal});
        if ( withPeer ){
            options.requestCursor = {[channelName]: 0};

        }

        //Checking that reconnect no longer repeats a permanently captured requestCursor
        await runtime.run( options );
        assert.equal( opens[1], 10 );
        assert.equal( opens[0], Number( withPeer === false ) );

    }

});

test( 'replay advances the wire cursor while still observing duplicates needed by followers', async function(){
    //Starting the leader ahead of the follower's requested replay position
    const observed = /** @type {number[]} */ ([]);
    const opens = /** @type {number[]} */ ([]);
    const controller = new AbortController();
    const fixture = recoveryFixtureCreate({
        cursorRead: function(){
            //Keeping leader state ahead of the replayed duplicate
            return {[channelName]: 10};

        },
        stream: {async open(/** @type {any} */ streamData ){
            //Replaying a duplicate once and inspecting the following reconnect
            opens.push( streamData.cursor[channelName] );
            if ( opens.length === 1 ){
                await streamData.eventHandle({channel: channelName, sequence: 3});
                return;

            }

            controller.abort();

        }},
        random: function(){
            //Keeping the transport retry short and deterministic
            return 0;

        }
    });
    await fixture.runtime.run({
        signal: controller.signal,
        requestCursor: {[channelName]: 2},
        eventObserve: function( eventData ){
            //Recording replay delivery without applying it twice to the leader
            observed.push( Number( eventData.sequence ) );

        }
    });

    //Checking that the follower receives its replay while the leader skips duplicate effects
    assert.deepEqual( opens, [2, 3] );
    assert.deepEqual( observed, [3] );
    assert.deepEqual( fixture.state.applied, [] );

});

test( 'snapshot recovery is bounded and a retry callback cannot override terminal recovery errors', async function(){
    //Simulating a domain hook that returns without installing a usable snapshot
    let syncCount = 0;
    const fixture = recoveryFixtureCreate({
        syncHandle: function(){
            //Counting repeated no-progress recoveries without advancing the durable position
            syncCount += 1;

        },
        stream: {async open(){
            //Keeping the server cursor expired on every connection
            throw new LayerRuntimeError( 'CURSOR_EXPIRED', 'Expired.', {status: 409, details: {channels: [channelName]}} );

        }},
        failureHandle: function(){
            //Attempting to override the framework's recovery safety boundary
            return true;

        }
    });

    //Checking the bounded terminal failure rather than a permanent busy loop
    await assert.rejects( fixture.runtime.run({signal: fixture.abortController.signal}), {code: 'STREAM_RECOVERY_STALLED'} );
    assert.equal( syncCount, 3 );

});

test( 'foreign recovery channels and regressing snapshots fail closed', async function(){
    //Rejecting unauthorized or malformed recovery metadata before domain operations run
    for ( const channels of [null, [], ['other:user'], [1], Array( 101 ).fill( channelName )] ){
        assert.throws(function(){
            //Validating only this stream's subscriptions
            layerRecoveryChannelsRead( channels, [channelName] );

        }, {code: 'STREAM_RECOVERY_INVALID'} );

    }

    //Checking that malformed persisted snapshot results cannot reset an existing cursor
    for ( const sequence of [-1, NaN, 0, undefined, '10'] ){
        let reads = 0;
        const fixture = recoveryFixtureCreate({
            cursorRead: function(){
                //Returning a valid initial cursor and an invalid subsequent snapshot cursor
                reads += 1;
                if ( reads === 1 ){
                    return {[channelName]: 1};

                }

                return {[channelName]: sequence};

            }
        });
        await assert.rejects( fixture.runtime.run({signal: fixture.abortController.signal}), {code: 'STREAM_RECOVERY_INVALID'} );

    }

});

test( 'authorization failures and missing application snapshot hooks never reconnect', async function(){
    //Applying the same terminal policy to stream authorization and snapshot API failures
    for ( const status of [401, 403] ){
        const fixture = recoveryFixtureCreate({
            syncHandle: function(){
                //Reporting the domain API's access denial rather than treating it as a network interruption
                throw new LayerRuntimeError( 'AUTH_REQUIRED', 'Denied.', {status} );

            },
            failureHandle: function(){
                //A host cannot override authorization by asking for another retry
                return true;

            }
        });
        await assert.rejects( fixture.runtime.run({signal: fixture.abortController.signal}), {status} );

    }

    const missingFixture = recoveryFixtureCreate({syncHandle: function(){
        //Matching generated applications that have no eventSync export
        throw new LayerRuntimeError( 'EVENT_SYNC_REQUIRED', 'Missing snapshot loader.' );

    }});
    await assert.rejects( missingFixture.runtime.run({signal: missingFixture.abortController.signal}), {code: 'EVENT_SYNC_REQUIRED'} );

});

test( 'stopping during an unresponsive snapshot hook releases ownership without a late reconnect', async function(){
    //Holding the application hook beyond subscription cancellation
    let hookStarted = /** @type {(() => void) | undefined} */ (undefined);
    const started = new Promise(function( resolve ){
        //Exposing a deterministic point at which cancellation must interrupt the hook wait
        hookStarted = function(){
            //Exposing a hook-start barrier without relying on timers
            resolve( undefined );

        };

    });
    const fixture = recoveryFixtureCreate({syncHandle: function(){
        //Simulating an application hook that ignores the supplied AbortSignal
        hookStarted?.();
        return new Promise(function(){
            //Leaving completion pending so only framework cancellation can release the run

        });

    }});
    const running = fixture.runtime.run({signal: fixture.abortController.signal});
    await started;
    fixture.abortController.abort();
    await running;
    assert.equal( fixture.state.opens.length, 1 );

    //Observing late failures after abort so they do not become unhandled rejections
    await assert.rejects( layerEventAbortableWait( Promise.resolve( 1 ), fixture.abortController.signal ), {name: 'AbortError'} );

});

test( 'POST errors preserve only bounded authorized recovery details and validated requestId', async function(){
    //Exercising both a legitimate cursor error and malformed proxy/server envelopes
    for ( const details of [{channels: [channelName, channelName], secret: 'private'}, {channels: ['other:user']}, null] ){
        const stream = layerPostEventStreamCreate({
            apiUrl: 'https://fixture.invalid/api',
            requestIdCreate: function(){
                //Providing the standard correlation identifier without performing a network request
                return requestId;

            },
            fetchImplementation: async function(){
                //Returning a synthetic server envelope that must not leak arbitrary details
                return new Response( JSON.stringify({requestId, error: {code: 'CURSOR_EXPIRED', retryable: false, details}}), {
                    status: 409, headers: {'content-type': 'application/json'}
                } );

            }
        });
        await assert.rejects( stream.open({
            channels: [channelName], cursor: {[channelName]: 1}, signal: new AbortController().signal,
            eventHandle: function(){
                //The server rejects before an SSE body exists

            },
            controlHandle: function(){
                //No control records are available before successful stream opening

            }
        }), function( errorData ){
            //Verifying that only an authorized channel list survives serialization
            const failure = /** @type {LayerRuntimeError} */ (errorData);
            assert.equal( failure.requestId, requestId );
            assert.equal( failure.status, 409 );
            if ( details !== null && details.channels.includes( channelName ) ){
                assert.deepEqual( failure.details, {channels: [channelName]} );

            } else {
                assert.equal( failure.details, null );

            }

            return true;

        } );

    }

});

test( 'the actual POST transport recovers HTTP 409 and applies a replayed event once', async function(){
    //Connecting transport and recovery state machines rather than mocking their boundary error
    const controller = new AbortController();
    const requests = /** @type {any[]} */ ([]);
    const applied = /** @type {number[]} */ ([]);
    let sequence = 1;
    const stream = layerPostEventStreamCreate({
        apiUrl: 'https://fixture.invalid/api',
        requestIdCreate: function(){
            //Using a valid protocol correlation identifier
            return requestId;

        },
        fetchImplementation: async function( _url, options ){
            //Recording the exact cursor serialized into each POST envelope
            requests.push( JSON.parse( String( options?.body ) ) );
            if ( requests.length === 1 ){
                return new Response( JSON.stringify({requestId, error: {
                    code: 'CURSOR_EXPIRED', retryable: false, details: {channels: [channelName]}
                }}), {status: 409} );

            }

            //Delivering an at-least-once duplicate and a final fixture control record
            const eventData = {eventId: requestId, channel: channelName, sequence: 11, entityRevision: 11,
                type: 'record.changed', payload: {}, occurredAt: '2026-10-20T12:00:00.000Z'};
            const frame = 'id: ' + requestId + '\nevent: layer.event\ndata: ' + JSON.stringify( eventData ) + '\n\n';
            return new Response( frame + frame + 'event: layer.control\ndata: {"type":"fixture-end"}\n\n', {
                headers: {'content-type': 'text/event-stream'}
            } );

        }
    });
    const runtime = layerEventRuntimeCreate({
        channels: [channelName], stream,
        cursorRead: function(){
            //Exposing concurrent durable progress beyond the local snapshot
            return {[channelName]: sequence};

        },
        cursorWrite: function( _channel, value ){
            //Acknowledging the explicitly applied cursor
            sequence = value;

        },
        syncHandle: function(){
            //Returning a precise snapshot even if another tab already advanced shared storage
            sequence = 20;
            return {cursor: 10};

        },
        eventApply: function( eventData ){
            //Recording the application side effect exactly once
            applied.push( Number( eventData.sequence ) );

        },
        controlHandle: function(){
            //Ending the fixture after both duplicate deliveries were parsed
            controller.abort();

        }
    });
    await runtime.run({signal: controller.signal});
    assert.deepEqual( requests.map(function( requestData ){
        //Selecting wire positions to detect accidental reuse of the old or shared cursor
        return requestData.cursor[channelName];

    }), [1, 10] );
    assert.deepEqual( applied, [11] );

});

test( 'aborted hook waits still observe late rejection and unresponsive stream shutdown', async function(){
    //Cancelling before a promise rejects must never create an unhandled rejection
    const controller = new AbortController();
    controller.abort();
    await assert.rejects( layerEventAbortableWait( Promise.reject( new Error( 'late hook failure' ) ), controller.signal ), {name: 'AbortError'} );

    //A transport that ignores cancellation cannot retain the owning runtime forever
    const fixture = recoveryFixtureCreate({stream: {open: function(){
        return new Promise(function(){
            //Only ownership cancellation can complete this deliberately uncooperative transport

        });

    }}});
    const running = fixture.runtime.run({signal: fixture.abortController.signal});
    fixture.abortController.abort();
    await running;

});

test( 'snapshot retry budgets are independent across subscribed channels', async function(){
    //Recovering four unrelated channels must not exhaust a global three-attempt budget
    const channels = ['test:a', 'test:b', 'test:c', 'test:d'];
    const cursors = /** @type {Record<string, number>} */ ({});
    const controller = new AbortController();
    let opens = 0;
    const runtime = layerEventRuntimeCreate({
        channels,
        cursorRead: function(){
            //Returning safe initial positions for every requested channel
            return Object.fromEntries( channels.map(function( channel ){
                //Keeping this fixture's default position explicit
                return [channel, cursors[channel] ?? 1];

            }) );

        },
        cursorWrite: function( channel, sequence ){
            //Persisting each independently recovered snapshot position
            cursors[channel] = sequence;

        },
        syncHandle: function(){
            //Returning the exact applied position for the currently recovered channel
            return {cursor: 10};

        },
        eventApply: function(){
            //This fixture exercises only snapshot recovery

        },
        stream: {async open(){
            //Expiring a different channel on each of the first four opens
            const channel = channels[opens];
            opens += 1;
            if ( channel !== undefined ){
                throw new LayerRuntimeError( 'CURSOR_EXPIRED', 'Expired.', {status: 409, details: {channels: [channel]}} );

            }

            controller.abort();

        }}
    });
    await runtime.run({signal: controller.signal});
    assert.equal( opens, 5 );
    assert.deepEqual( Object.values( cursors ), [10, 10, 10, 10] );

});
