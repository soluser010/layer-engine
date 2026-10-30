/**
 * @typedef {{connect: () => Promise<unknown>, quit: () => Promise<unknown>, destroy?: () => void, readonly isOpen?: boolean, readonly isReady?: boolean, on: (eventName: string, handler: (...argumentItemsData: any[]) => void) => unknown, publish: (channelName: string, messageData: string) => Promise<number>, subscribe: (channelName: string, listener: (messageData: string) => void) => Promise<unknown>, unsubscribe: (channelName: string) => Promise<unknown>}} LayerRedisClient
 */

/**
 * @param {unknown} routingData
 */
function routingDataNormalize(routingData) {
    //Checking Redis input before it can select local stream subscribers.
    if (typeof routingData !== 'object' || routingData === null || Array.isArray(routingData)) {
        return null;

    }

    const routingRecord = /** @type {Record<string, unknown>} */ (routingData);

    if (typeof routingRecord.eventId !== 'string' ||
        typeof routingRecord.tenantKey !== 'string' ||
        typeof routingRecord.channel !== 'string' ||
        routingRecord.eventId.length < 1 ||
        routingRecord.tenantKey.length < 1 ||
        routingRecord.eventId.length > 160 ||
        routingRecord.tenantKey.length > 160 ||
        !/^[a-zA-Z0-9:_-]+$/.test(routingRecord.channel)) {
        return null;

    }

    return Object.freeze({
        eventId: routingRecord.eventId,
        tenantKey: routingRecord.tenantKey,
        channel: routingRecord.channel
    });

}

/**
 * Redis delivery is optional. Managed hosts use backgroundConnect and durable fallback.
 * @param {object} busOptions
 * @param {string} [busOptions.url]
 * @param {Record<string, unknown>} [busOptions.clientOptions]
 * @param {string} [busOptions.namespace]
 * @param {number} [busOptions.connectionTimeoutMs]
 * @param {number} [busOptions.reconnectAttempts]
 * @param {boolean} [busOptions.backgroundConnect]
 * @param {(clientOptions: Record<string, unknown>) => LayerRedisClient} [busOptions.clientCreate]
 * @param {{record: (diagnosticData: Record<string, unknown>) => void}} [busOptions.diagnostics]
 */
export function layerRedisEventBusCreate( busOptions ){
    //Bounding each connection series while allowing later background recovery
    const connectionTimeoutMs = busOptions.connectionTimeoutMs ?? 5000;
    const reconnectAttempts = busOptions.reconnectAttempts ?? 3;
    const backgroundConnectData = busOptions.backgroundConnect ?? false;
    const topicName = `${busOptions.namespace ?? 'layer-engine'}:events`;

    if ( (!busOptions.url && (!busOptions.clientOptions || typeof busOptions.clientOptions !== 'object' || Array.isArray( busOptions.clientOptions ))) ||
        !Number.isInteger( connectionTimeoutMs ) || connectionTimeoutMs < 100 || connectionTimeoutMs > 60000 ||
        !Number.isInteger( reconnectAttempts ) || reconnectAttempts < 0 || reconnectAttempts > 20 || typeof backgroundConnectData !== 'boolean' ){
        throw new TypeError( 'Redis event bus connection options or bounds are invalid.' );

    }

    const clientCreateData = busOptions.clientCreate ?? async function( optionsData ){
        //Loading the optional server dependency only when a Redis lifecycle actually starts
        const redisModuleData = await import( 'redis' );
        return /** @type {LayerRedisClient} */ (redisModuleData.createClient( optionsData ));

    };
    const sharedOptionsData = busOptions.clientOptions ?? {url: busOptions.url};
    let socketOptionsData = /** @type {object} */ ({});

    if ( typeof sharedOptionsData.socket === 'object' && sharedOptionsData.socket !== null ){
        //Preserving the configured TLS, host and port for every replacement pair
        socketOptionsData = sharedOptionsData.socket;

    }
    let runningStatusData = false;
    let readyStatusData = false;
    let generationData = 0;
    let failureCountData = 0;
    let retryTimerData = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
    let roundPromiseData = /** @type {Promise<void> | null} */ (null);
    let clientsData = /** @type {LayerRedisClient[]} */ ([]);
    let listenerData = /** @type {((routingData: {eventId: string, tenantKey: string, channel: string}) => void | Promise<void>) | null} */ (null);
    const pendingCancelsData = new Set();

    const diagnosticRecord = function(){
        //Exposing only a stable dependency code, never Redis credentials or remote messages
        busOptions.diagnostics?.record({level: 'warning', event: 'redis.event-bus.unavailable', code: 'DEPENDENCY_UNAVAILABLE'});

    };
    const clientsClose = function(){
        //Invalidating callbacks before destroying sockets, including half-open connections
        readyStatusData = false;
        generationData += 1;
        const closingData = clientsData;
        clientsData = [];

        for ( const clientData of closingData ){
            if ( clientData.destroy !== undefined ){
                if ( clientData.isOpen !== false ){
                    clientData.destroy();

                }

            } else {
                void clientData.quit().catch( diagnosticRecord );

            }

        }

        for ( const cancelData of pendingCancelsData ){
            cancelData();

        }

    };
    const boundedExecute = async function( /** @type {() => Promise<unknown>} */ actionData, /** @type {number} */ timeoutData ){
        //Bounding network waits and cancelling them immediately when this lifecycle ends
        const operationGenerationData = generationData;
        let timerData = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);
        let cancelData = function(){
            //Keeping cleanup valid before the cancellation promise installs its callback

        };
        const cancellationData = new Promise(function( _resolveData, rejectData ){
            //Sharing cancellation between connection and publish operations
            cancelData = function(){
                //Rejecting detached work without exposing a transport exception
                rejectData( new Error( 'Redis event bus operation interrupted.' ) );

            };
            pendingCancelsData.add( cancelData );
            timerData = setTimeout( cancelData, timeoutData );
            timerData.unref?.();

        });

        try {
            return await Promise.race([Promise.resolve().then(function(){
                //Preventing a queued connect from reopening sockets after stop cancelled this generation
                if ( !runningStatusData || generationData !== operationGenerationData ){
                    throw new Error( 'Redis event bus operation interrupted.' );

                }

                return actionData();

            }), cancellationData]);

        } finally {
            clearTimeout( timerData );
            pendingCancelsData.delete( cancelData );

        }

    };
    const recoverySchedule = function(){
        //Scheduling one capped exponential backoff with jitter, never a synchronous retry loop
        if ( !runningStatusData || retryTimerData !== null || roundPromiseData !== null ){
            return;

        }

        clientsClose();
        const maximumDelayData = Math.min( 1000 * (2 ** Math.min( failureCountData++, 5 )), 30000 );
        const delayData = Math.round( maximumDelayData * (0.8 + Math.random() * 0.2) );
        retryTimerData = setTimeout(function(){
            //Starting a fresh pair after the previous generation has been closed
            retryTimerData = null;
            void roundStart().catch( diagnosticRecord );

        }, delayData );
        retryTimerData.unref?.();

    };
    const roundStart = function(){
        //Deduplicating connection rounds across simultaneous publisher/subscriber failures
        if ( roundPromiseData !== null ){
            return roundPromiseData;

        }

        const roundGenerationData = ++generationData;
        roundPromiseData = Promise.resolve().then(async function(){
            //Creating a new pair only while this generation still owns the running lifecycle
            if ( !runningStatusData || generationData !== roundGenerationData ){
                return;

            }

            for ( let indexData = 0; indexData < 2; indexData += 1 ){
                const clientData = await clientCreateData({...sharedOptionsData, RESP: 2, disableOfflineQueue: true,
                    socket: {...socketOptionsData, connectTimeout: connectionTimeoutMs, reconnectStrategy( /** @type {number} */ retryData ){
                        //Limiting one native series; the outer lifecycle owns subsequent series
                        if ( retryData >= reconnectAttempts ){
                            //Ending this native series without ending the outer recovery lifecycle
                            return new Error( 'Redis reconnect attempts are exhausted.' );

                        }

                        return Math.min( 100 * (2 ** retryData), 1000 );

                    }}});

                if ( !runningStatusData || generationData !== roundGenerationData ){
                    //Leaving an unconnected client untouched when loading raced shutdown
                    return;

                }

                clientsData.push( clientData );
                const unavailableHandle = function(){
                    //Discarding notifications from an old socket or a stopped application
                    if ( runningStatusData && generationData === roundGenerationData ){
                        readyStatusData = false;
                        recoverySchedule();

                    }

                };
                clientData.on( 'error', unavailableHandle );
                clientData.on( 'end', unavailableHandle );
                clientData.on( 'reconnecting', unavailableHandle );

            }

            const [publisherData, subscriberData] = clientsData;

            if ( publisherData === undefined || subscriberData === undefined ){
                throw new Error( 'Redis connection generation was cancelled.' );

            }
            await boundedExecute(async function(){
                //Connecting both sockets concurrently without blocking the event loop
                await Promise.all([publisherData.connect(), subscriberData.connect()]);

            }, connectionTimeoutMs * (reconnectAttempts + 1) + 2000 );
            await boundedExecute(function(){
                //Restoring exactly one subscription before advertising accelerated delivery
                return subscriberData.subscribe( topicName, function( messageData ){
                    //Ignoring obsolete subscriptions and malformed routing envelopes
                    if ( !runningStatusData || generationData !== roundGenerationData || listenerData === null ){
                        return;

                    }

                    let parsedData;

                    try {
                        parsedData = JSON.parse( messageData );

                    } catch {
                        return;

                    }

                    const routingData = routingDataNormalize( parsedData );

                    if ( routingData !== null ){
                        void Promise.resolve().then(function(){
                            //Containing application callback failures without losing the Redis subscription
                            if ( runningStatusData && generationData === roundGenerationData ){
                                return listenerData?.( routingData );

                            }

                        }).catch( diagnosticRecord );

                    }

                });

            }, connectionTimeoutMs );

            if ( runningStatusData && generationData === roundGenerationData && clientsData.every(function( clientData ){
                //Requiring both transports to remain ready after subscribe acknowledgement
                return clientData.isReady !== false;

            }) ){
                readyStatusData = true;
                failureCountData = 0;

            }

        }).finally(function(){
            //Continuing recovery after a failed series, unless stop invalidated this generation
            roundPromiseData = null;

            if ( !readyStatusData ){
                recoverySchedule();

            }

        });
        return roundPromiseData;

    };

    return Object.freeze({
        async start( /** @type {NonNullable<typeof listenerData>} */ callbackData ){
            //Allowing legacy callers to await one series while managed hosts start immediately
            if ( runningStatusData ){
                throw new Error( 'The Redis event bus is already started.' );

            }

            runningStatusData = true;
            listenerData = callbackData;
            const connectionData = roundStart();

            if ( backgroundConnectData ){
                void connectionData.catch( diagnosticRecord );

            } else {
                await connectionData;

            }

        },
        async publish( /** @type {{eventId: string, tenantKey: string, channel: string}} */ routingData ){
            //Failing quickly so durable delivery remains authoritative during a Redis outage
            const normalizedData = routingDataNormalize( routingData );

            if ( normalizedData === null ){
                throw new TypeError( 'Redis event routing data is invalid.' );

            }

            if ( !readyStatusData ){
                throw new Error( 'The Redis event bus is not ready.' );

            }

            const publisherData = clientsData[0];

            if ( publisherData === undefined ){
                throw new Error( 'The Redis event bus is not ready.' );

            }

            try {
                await boundedExecute(function(){
                    //Bounding acknowledgement waits on a socket which may have silently stalled
                    return publisherData.publish( topicName, JSON.stringify( normalizedData ) );

                }, 1000 );

            } catch( publishErrorData ){
                readyStatusData = false;
                recoverySchedule();
                throw publishErrorData;

            }

        },
        async stop(){
            //Stopping timers and sockets even while the first connection is still pending
            runningStatusData = false;
            listenerData = null;
            clearTimeout( retryTimerData ?? undefined );
            retryTimerData = null;
            clientsClose();
            await roundPromiseData?.catch(function(){
                //Treating cancellation during shutdown as an expected lifecycle outcome

            });

        },
        isReady(){
            //Reporting readiness only for the current completely subscribed generation
            return runningStatusData && readyStatusData;

        }
    });

}
