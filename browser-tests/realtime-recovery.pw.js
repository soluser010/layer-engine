import {expect, test} from '@playwright/test';


test( 'native multi-tab snapshot recovery preserves event order and re-elects a leader', async function( {context} ){
    //Opening two actual documents so browser Web Locks and BroadcastChannel perform coordination
    const leaderPage = await context.newPage();
    const followerPage = await context.newPage();
    for ( const page of [leaderPage, followerPage] ){
        await page.goto( '/browser-tests/harness.html' );
        await page.waitForFunction(function(){
            //Waiting for native ESM imports rather than injecting a replacement runtime
            return window.layerBrowser !== undefined;

        });

    }

    for ( const [index, page] of [leaderPage, followerPage].entries() ){
        await page.evaluate(async function( tabIndex ){
            //Keeping durable fixture state shared while application effects remain private to each document
            const api = window.layerBrowser;
            const channel = 'test:browser';
            const state = {sequence: 1, snapshots: 0, applied: [], opens: [], error: null};
            let currentStream = null;
            const cursorRead = function(){
                //Reading the shared durable position just as IndexedDB would provide it
                return {[channel]: Number( localStorage.getItem( 'recovery-sequence' ) ?? 1 )};

            };
            const snapshotApply = function(){
                //Applying an authorized fixture snapshot in this document before exposing its cursor
                state.snapshots += 1;
                state.sequence = 10;
                localStorage.setItem( 'recovery-sequence', String( Math.max( 10, cursorRead()[channel] ) ) );
                return {cursor: 10};

            };
            const coordinator = api.layerMultiTabEventsCreate({
                originKey: 'browser-recovery',
                channels: [channel],
                cursorRead,
                tabIdCreate: function(){
                    //Providing a stable per-document fixture identity
                    return 'tab-' + tabIndex;

                },
                peerCollectionMs: 500,
                lockManager: navigator.locks,
                broadcastChannelCreate: function( name ){
                    //Using the browser's real messaging channel
                    return new BroadcastChannel( name );

                },
                syncHandle: snapshotApply,
                eventReceive: function( eventData ){
                    //Recording per-tab effects after sibling validation and deduplication
                    state.applied.push( eventData.sequence );

                },
                failureHandle: function( errorData ){
                    //Retaining only a safe code for a failing browser assertion
                    state.error = errorData.code ?? errorData.name;

                },
                streamRun: async function( runOptions ){
                    //Running the actual cursor state machine while controlling only transport timing
                    const runtime = api.layerEventRuntimeCreate({
                        channels: [channel], cursorRead, syncHandle: snapshotApply,
                        cursorWrite: function( _channel, sequence ){
                            //Persisting progress monotonically across documents
                            localStorage.setItem( 'recovery-sequence', String( Math.max( sequence, cursorRead()[channel] ) ) );

                        },
                        eventApply: function( eventData ){
                            //Recording leader effects without relying on follower message ordering
                            state.applied.push( eventData.sequence );

                        },
                        stream: {async open( streamData ){
                            state.opens.push( streamData.cursor[channel] );
                            if ( localStorage.getItem( 'recovery-expired' ) !== 'yes' ){
                                //Expiring the initial replay exactly once across the origin
                                localStorage.setItem( 'recovery-expired', 'yes' );
                                throw new api.LayerRuntimeError( 'CURSOR_EXPIRED', 'Snapshot required.', {
                                    status: 409, details: {channels: [channel]}
                                } );

                            }

                            currentStream = streamData;
                            await new Promise(function( resolve ){
                                //Holding the elected connection until native lock ownership is released
                                streamData.signal.addEventListener( 'abort', function(){
                                    //Releasing the connection when its elected owner stops
                                    currentStream = null;
                                    resolve();

                                }, {once: true} );

                            });

                        }}
                    });
                    await runtime.run( runOptions );

                }
            });
            window.recoveryFixture = {state, coordinator, async publish( sequence ){
                //Delivering a protocol-valid event through the elected runtime
                if ( currentStream === null ){
                    throw new Error( 'The tab does not own a stream.' );

                }

                await currentStream.eventHandle({
                    eventId: '11111111-1111-4111-8111-111111111111',
                    channel, sequence, entityRevision: sequence, type: 'record.changed',
                    payload: {}, occurredAt: '2026-10-20T12:00:00.000Z'
                });

            }};
            await coordinator.start();

        }, index );

    }

    //Waiting for both tabs to install a snapshot before testing real sibling event delivery
    for ( const page of [leaderPage, followerPage] ){
        await expect.poll(async function(){
            //Reading observable state without inferring success from an open HTTP connection
            return page.evaluate(function(){
                //Reading document-specific snapshot progress
                return window.recoveryFixture.state.snapshots;

            });

        }).toBe( 1 );

    }

    await leaderPage.evaluate(async function(){
        //Publishing a new event and a duplicate through the leader's ordinary delivery path
        await window.recoveryFixture.publish( 11 );
        await window.recoveryFixture.publish( 11 );

    });
    for ( const page of [leaderPage, followerPage] ){
        await expect.poll(async function(){
            //Waiting for both local and sibling event application
            return page.evaluate(function(){
                //Returning this document's applied sequence list
                return window.recoveryFixture.state.applied;

            });

        }).toEqual( [11] );

    }

    //Releasing the actual browser lock and waiting for the follower to acquire it
    await leaderPage.evaluate(async function(){
        //Releasing native leadership without closing the document
        await window.recoveryFixture.coordinator.stop();

    });
    await expect.poll(async function(){
        //Waiting for the former follower to acquire leadership
        return followerPage.evaluate(function(){
            //Reading the new leader's initial replay position
            return window.recoveryFixture.state.opens;

        });

    }).toEqual( [11] );
    await followerPage.evaluate(async function(){
        //Continuing from the applied cursor after leader re-election without another expired replay
        await window.recoveryFixture.publish( 12 );

    });
    expect( await followerPage.evaluate(function(){
        //Checking effects after the leader handoff
        return window.recoveryFixture.state.applied;

    }) ).toEqual( [11, 12] );
    for ( const page of [leaderPage, followerPage] ){
        expect( await page.evaluate(function(){
            //Reading a safe failure identifier from this document
            return window.recoveryFixture.state.error;

        }) ).toBeNull();
        await page.evaluate(async function(){
            //Closing any remaining coordination resources
            await window.recoveryFixture.coordinator.stop();

        });

    }

});
