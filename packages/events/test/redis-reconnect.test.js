import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {createClient} from 'redis';
import {layerRedisEventBusCreate} from '../src/redis-event-bus.js';
import {layerHybridEventBusCreate} from '../src/hybrid-event-bus.js';
import {layerCacheInvalidationSynchronizerCreate} from '../src/cache-invalidation-synchronizer.js';

/** @param {() => boolean} conditionData */
async function conditionWait( conditionData ){
    //Waiting for observed lifecycle progress rather than relying on one fixed network delay
    const deadlineData = Date.now() + 10000;

    while ( conditionData() === false ){
        assert.ok( Date.now() < deadlineData, 'Lifecycle did not recover before the deadline.' );
        await delay( 20 );

    }

}

test( 'Redis recovery does not delay durable startup/publish and cancels pending connect on stop', async function(){
    //Holding both sockets indefinitely to prove neither startup nor shutdown depends on Redis readiness
    const clientsData = /** @type {any[]} */ ([]);
    const busData = layerRedisEventBusCreate({url: 'redis://unused', backgroundConnect: true,
        clientCreate(){
            //Supplying a deliberately stalled network transport with observable cancellation
            const clientData = Object.assign( new EventEmitter(), {isOpen: true, isReady: false,
                connect(){
                    //Never resolving until the bus cancels its own bounded wait
                    return new Promise(function(){
                        //Leaving this transport stalled without keeping the Node event loop alive

                    });

                },
                destroy(){
                    //Recording cancellation of a half-open client
                    clientData.isOpen = false;

                }, quit: async function(){
                    //Providing compatibility with the injected client contract

                }, publish: async function(){
                    //Returning a harmless count for an unused publish path
                    return 0;

                }, subscribe: async function(){
                    //Keeping the fixture subscription inert

                }, unsubscribe: async function(){
                    //Keeping the fixture subscription cleanup inert

                }});
            clientsData.push( clientData );
            return clientData;

        }});
    let fallbackCountData = 0;
    const hybridData = layerHybridEventBusCreate({primary: busData, fallback: {
        async start(){
            //Making durable storage independently available

        }, async stop(){
            //Leaving the fixture without external resources

        }, isReady(){
            //Reporting only durable readiness
            return true;

        }, async publish(){
            //Observing delivery while optional Redis is still connecting
            fallbackCountData += 1;

        }
    }});
    await hybridData.start(function(){
        //Accepting routes without application side effects

    });
    assert.equal( hybridData.isReady(), true );
    assert.equal( hybridData.isAccelerated(), false );
    await hybridData.publish({eventId: 'event', tenantKey: 'tenant', channel: 'chat'});
    assert.equal( fallbackCountData, 1 );
    await conditionWait(function(){
        //Waiting for both pending sockets before verifying cancellation
        return clientsData.length === 2;

    });
    await hybridData.stop();
    assert.equal( clientsData.length, 2 );
    assert.ok( clientsData.every(function( clientData ){
        //Requiring all pending sockets to be cancelled
        return clientData.isOpen === false;

    }) );
    await delay( 1100 );
    assert.equal( clientsData.length, 2 );
    assert.equal( busData.isReady(), false );

});

test( 'Background invalidation startup does not recreate its timer after stop', async function(){
    //Stopping during the initial pass must not install a new polling loop afterwards
    let releaseData = function(){
        //Providing a safe initial resolver before the hook starts

    };
    let attemptsData = 0;
    const synchronizerData = layerCacheInvalidationSynchronizerCreate({pollIntervalMs: 100,
        beforeSynchronize(){
            //Holding the first transport attempt until stop is already waiting
            attemptsData += 1;
            return new Promise(function( resolveData ){
                //Exposing dependency failure to complete the pending pass
                releaseData = function(){
                    //Returning unavailable without touching the durable cursor
                    resolveData( false );

                };

            });

        }, repository: {async readAfter(){
            //Returning an empty journal for the unused ready path
            return [];

        }}, cache: {async invalidate(){
            //Leaving fixture invalidation inert

        }, async invalidationCursorRead(){
            //Providing a fresh durable checkpoint
            return 0;

        }, async invalidationCursorWrite(){
            //Leaving fixture cursor writes inert

        }}});
    await synchronizerData.start({background: true});
    const stopData = synchronizerData.stop();
    releaseData();
    await stopData;
    await delay( 250 );
    assert.equal( attemptsData, 1 );
    assert.equal( synchronizerData.isReady(), false );

});

test( 'Stopping between socket creation and queued connect cannot reopen retired sockets', async function(){
    //Exercising the microtask boundary before the transport action actually begins
    let connectCountData = 0;
    const clientsData = /** @type {any[]} */ ([]);
    const busData = layerRedisEventBusCreate({url: 'redis://unused', backgroundConnect: true,
        clientCreate(){
            //Supplying only methods used before a cancelled connection starts
            const clientData = Object.assign( new EventEmitter(), {isOpen: false, isReady: false,
                async connect(){
                    //Detecting an illegal late connection after shutdown
                    connectCountData += 1;
                    clientData.isOpen = true;

                }, destroy(){
                    //Closing the injected transport if a regression opens it
                    clientData.isOpen = false;

                }});
            clientsData.push( clientData );
            return /** @type {any} */ (clientData);

        }});
    await busData.start(function(){
        //Ignoring routes in this connection-ordering test

    });
    await busData.stop();
    await delay( 20 );
    assert.ok( clientsData.length <= 2 );
    assert.equal( connectCountData, 0 );
    assert.ok( clientsData.every(function( clientData ){
        //Verifying stop left every transport closed
        return !clientData.isOpen;

    }) );

});

test( 'Real Redis pub/sub recovers after exhausted retries and startup outage without restarting the host', {
    skip: process.env.LAYER_TEST_LOCAL_REDIS !== '1', timeout: 30000
}, async function(){
    //Injecting faults only into a private TCP proxy; the shared Redis service is never stopped
    let availableStatusData = true;
    const socketsData = new Set();
    const proxyData = net.createServer(function( socketData ){
        //Forwarding only this test's sockets to the existing local Redis instance
        socketsData.add( socketData );
        socketData.on( 'error', function(){
            //Containing intentional connection resets

        });
        socketData.on( 'close', function(){
            //Removing closed downstream sockets from the fault set
            socketsData.delete( socketData );

        });

        if ( availableStatusData === false ){
            socketData.destroy();
            return;

        }

        const upstreamData = net.connect({host: '127.0.0.1', port: 6379});
        socketsData.add( upstreamData );
        upstreamData.on( 'error', function(){
            //Closing the paired downstream if the local test service is unavailable
            socketData.destroy();

        });
        upstreamData.on( 'close', function(){
            //Releasing both sides after an injected transport fault
            socketsData.delete( upstreamData );
            socketData.destroy();

        });
        socketData.on( 'close', function(){
            //Avoiding orphaned upstream connections
            upstreamData.destroy();

        });
        socketData.pipe( upstreamData );
        upstreamData.pipe( socketData );

    });
    await new Promise(function( resolveData ){
        //Selecting a private ephemeral test port
        proxyData.listen( 0, '127.0.0.1', function(){
            //Continuing only after the proxy accepts connections
            resolveData( undefined );

        });

    });
    const portData = /** @type {net.AddressInfo} */ (proxyData.address()).port;
    const clientsData = /** @type {{readonly isOpen: boolean}[]} */ ([]);
    const retriesData = /** @type {number[]} */ ([]);
    let deliveriesData = 0;
    const busData = layerRedisEventBusCreate({backgroundConnect: true,
        namespace: `layer-recovery-${process.pid}`, clientOptions: {socket: {host: '127.0.0.1', port: portData}},
        clientCreate( optionsData ){
            //Recording native retries while using the real Node Redis client
            const socketData = /** @type {any} */ (optionsData.socket);
            const retryData = socketData.reconnectStrategy;
            socketData.reconnectStrategy = function( /** @type {number} */ countData ){
                //Verifying that recovery survives the old terminal retry threshold
                retriesData.push( countData );
                return retryData( countData );

            };
            const clientData = createClient( optionsData );
            clientsData.push( clientData );
            return clientData;

        }});

    try {
        for ( const startupOfflineData of [false, true] ){
            availableStatusData = !startupOfflineData;
            await busData.start(function(){
                //Counting routes to detect lost or duplicated subscriptions after recovery
                deliveriesData += 1;

            });

            if ( !startupOfflineData ){
                await conditionWait(function(){
                    //Waiting for the initial healthy subscription
                    return busData.isReady();

                });
                availableStatusData = false;

                for ( const socketData of socketsData ){
                    socketData.destroy();

                }

            }

            retriesData.length = 0;
            await conditionWait(function(){
                //Keeping the outage active beyond a complete native retry series
                return retriesData.includes( 3 );

            });
            assert.equal( busData.isReady(), false );
            availableStatusData = true;
            await conditionWait(function(){
                //Requiring automatic recovery without calling start a second time
                return busData.isReady();

            });
            const previousDeliveriesData = deliveriesData;
            await busData.publish({eventId: 'event', tenantKey: 'tenant', channel: 'chat'});
            await conditionWait(function(){
                //Checking that the replacement subscriber actually receives messages
                return deliveriesData > previousDeliveriesData;

            });
            await delay( 100 );
            assert.equal( deliveriesData, previousDeliveriesData + 1 );

            if ( !startupOfflineData ){
                //Blackholing acknowledgements without closing sockets to exercise the publish deadline
                for ( const socketData of socketsData ){
                    socketData.pause();

                }

                let ticksData = 0;
                const timerData = setInterval(function(){
                    //Proving ordinary event-loop work continues during the stalled network command
                    ticksData += 1;

                }, 25 );

                try {
                    await assert.rejects( busData.publish({eventId: 'stalled', tenantKey: 'tenant', channel: 'chat'}), /interrupted/ );
                    assert.ok( ticksData >= 5 );

                } finally {
                    clearInterval( timerData );

                }

                await conditionWait(function(){
                    //Recovering again after replacing the sockets with stalled acknowledgements
                    return busData.isReady();

                });

            }

            await busData.stop();
            assert.ok( clientsData.every(function( clientData ){
                //Requiring every retired connection to be closed
                return clientData.isOpen === false;

            }) );

        }

    } finally {
        await busData.stop();

        for ( const socketData of socketsData ){
            socketData.destroy();

        }

        await new Promise(function( resolveData ){
            //Releasing the private listener after all paired sockets close
            proxyData.close( resolveData );

        });

    }

});
