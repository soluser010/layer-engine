import {
    LAYER_ERROR_CODES,
    LayerError
} from '@solcorp/layer-protocol';
import {
    layerControlFrameCreate,
    layerEventFrameCreate,
    layerHeartbeatFrameCreate
} from './stream-codec.js';

/**
 * @typedef {{eventId: string, channel: string, sequence: number, entityRevision: number, type: string, payload: Record<string, unknown>, occurredAt: string}} LayerStreamEvent
 * @typedef {{tenantKey: string, userId: string, channels: readonly string[]}} LayerAuthorizedStream
 */

/**
 * @param {import('node:http').ServerResponse} response
 * @param {string} frameData
 * @param {number} timeoutMs
 */
async function responseFrameWrite(response, frameData, timeoutMs) {
    //Avoiding a drain wait on a response whose close event has already fired
    if ( response.destroyed || response.writableEnded ){
        throw new Error( 'The event stream is closed.' );

    }

    //Writing immediately when the Node response buffer still has capacity.
    if (response.write(frameData)) {
        return;

    }

    await new Promise(function responseDrainWait(resolve, reject) {
        //Waiting for backpressure relief or connection termination.
        const drainHandle = function responseDrainHandle() {
            //Detaching all competing listeners before resuming the queued frame.
            cleanup();
            resolve(undefined);

        };
        const closeHandle = function responseCloseHandle() {
            //Rejecting the queued frame when its response is already gone.
            cleanup();
            reject(new Error('The event stream closed during backpressure.'));

        };
        const errorHandle = function responseErrorHandle(/** @type {Error} */ errorData) {
            //Propagating the native stream failure after listener cleanup.
            cleanup();
            reject(errorData);

        };
        const cleanup = function responseWaitCleanup() {
            //Removing one-shot alternatives that did not win the wait.
            response.off('drain', drainHandle);
            response.off('close', closeHandle);
            response.off('error', errorHandle);
            clearTimeout( deadlineIdentifier );

        };

        //Bounding memory retention when the remote peer never resumes reading
        const deadlineIdentifier = setTimeout(function responseDrainTimeout(){
            //Ending the blocked write without waiting for a control frame to flush
            cleanup();
            reject( new Error( 'The event stream write deadline expired.' ) );
            response.destroy();

        }, timeoutMs);

        response.once('drain', drainHandle);
        response.once('close', closeHandle);
        response.once('error', errorHandle);
        //Covering synchronous closure during write before listeners were attached
        if ( response.destroyed || response.writableEnded ){
            closeHandle();

        }

    });

}

/**
 * @param {object} managerOptions
 * @param {{replay: Function}} managerOptions.eventRepository
 * @param {{record: (diagnosticData: Record<string, unknown>) => void}} managerOptions.diagnostics
 * @param {number} [managerOptions.heartbeatMs]
 * @param {number} [managerOptions.maxChannels]
 * @param {number} [managerOptions.maxReplayEvents]
 * @param {number} [managerOptions.maxStreamsPerUser]
 * @param {number} [managerOptions.maxStreamsPerIp]
 * @param {number} [managerOptions.maxQueuedEvents] Maximum pending events per subscriber, default 256.
 * @param {number} [managerOptions.maxQueuedBytes] Maximum serialized bytes per event/write queue, default 1 MiB.
 * @param {number} [managerOptions.writeTimeoutMs] Maximum blocked socket write, default 10 seconds.
 * @param {() => Date} [managerOptions.clock]
 */
export function layerEventStreamManagerCreate(managerOptions) {
    const heartbeatMs = managerOptions.heartbeatMs ?? 20000;
    const maxChannels = managerOptions.maxChannels ?? 50;
    const maxReplayEvents = managerOptions.maxReplayEvents ?? 1000;
    const maxStreamsPerUser = managerOptions.maxStreamsPerUser ?? 3;
    const maxStreamsPerIp = managerOptions.maxStreamsPerIp ?? 20;
    const maxQueuedEvents = managerOptions.maxQueuedEvents ?? 256;
    const maxQueuedBytes = managerOptions.maxQueuedBytes ?? 1048576;
    const writeTimeoutMs = managerOptions.writeTimeoutMs ?? 10000;

    //Rejecting disabled or excessive bounds instead of allowing unbounded subscriber retention
    for ( const [boundValue, maximumValue] of /** @type {const} */ ([[maxQueuedEvents, 4096], [maxQueuedBytes, 16777216], [writeTimeoutMs, 60000]]) ){
        if ( !Number.isSafeInteger( boundValue ) || boundValue < 1 || boundValue > maximumValue ){
            throw new TypeError( 'Event stream queue and write bounds are invalid.' );

        }

    }
    const clock = managerOptions.clock ?? function streamClockRead() {
        //Providing wall-clock time for heartbeat and diagnostics.
        return new Date();

    };
    const activeConnections = new Set();
    const userConnectionCount = new Map();
    const ipConnectionCount = new Map();
    let drainingStatus = false;

    /**
     * @param {Map<string, number>} countMap
     * @param {string} countKey
     * @param {number} deltaValue
     */
    function connectionCountChange(countMap, countKey, deltaValue) {
        const nextCount = Math.max(0, (countMap.get(countKey) ?? 0) + deltaValue);

        //Removing zero counters to keep bounded identity state.
        if (nextCount === 0) {
            countMap.delete(countKey);

        } else {
            countMap.set(countKey, nextCount);

        }

    }

    return Object.freeze({
        /**
         * @param {object} openData
         * @param {import('node:http').ServerResponse} openData.response
         * @param {LayerAuthorizedStream} openData.authorization
         * @param {Readonly<Record<string, number>> | null} openData.cursor
         * @param {string} openData.remoteAddress
         * @param {string} openData.requestId
         */
        async open(openData) {
            //Failing new streams while an instance is draining for deployment.
            if (drainingStatus) {
                throw new LayerError(LAYER_ERROR_CODES.DEPENDENCY_UNAVAILABLE, 'The event gateway is draining.', {
                    retryable: true,
                    status: 503
                });

            }

            const uniqueChannels = [...new Set(openData.authorization.channels)];

            if (uniqueChannels.length < 1 || uniqueChannels.length > maxChannels) {
                throw new LayerError(LAYER_ERROR_CODES.INVALID_PAYLOAD, 'The event channel count is invalid.', {
                    status: 400
                });

            }

            const userCount = userConnectionCount.get(openData.authorization.userId) ?? 0;
            const ipCount = ipConnectionCount.get(openData.remoteAddress) ?? 0;

            if (userCount >= maxStreamsPerUser || ipCount >= maxStreamsPerIp) {
                throw new LayerError(LAYER_ERROR_CODES.RATE_LIMITED, 'The event stream limit was exceeded.', {
                    details: {
                        retryAfterMs: heartbeatMs
                    },
                    status: 429
                });

            }

            const cursorData = /** @type {Record<string, number>} */ ({});

            //Normalizing a missing cursor to the beginning of each authorized channel.
            for (const channelName of uniqueChannels) {
                cursorData[channelName] = openData.cursor?.[channelName] ?? 0;

            }

            //Reserving stream capacity before asynchronous replay to prevent concurrent-open bypass
            connectionCountChange(userConnectionCount, openData.authorization.userId, 1);
            connectionCountChange(ipConnectionCount, openData.remoteAddress, 1);
            let replayResult;
            try {
                replayResult = await managerOptions.eventRepository.replay({
                    tenantKey: openData.authorization.tenantKey,
                    channels: uniqueChannels,
                    cursor: cursorData,
                    limit: maxReplayEvents
                });

            } catch( replayError ){
                //Releasing failed reservations before propagating the original dependency error
                connectionCountChange(userConnectionCount, openData.authorization.userId, -1);
                connectionCountChange(ipConnectionCount, openData.remoteAddress, -1);
                throw replayError;

            }

            //Discarding replay results when the HTTP peer disconnected during the database query
            if ( openData.response.destroyed || openData.response.writableEnded ){
                connectionCountChange(userConnectionCount, openData.authorization.userId, -1);
                connectionCountChange(ipConnectionCount, openData.remoteAddress, -1);
                return;

            }

            //Refusing a delayed handshake when shutdown started during its initial replay
            if ( drainingStatus ){
                connectionCountChange(userConnectionCount, openData.authorization.userId, -1);
                connectionCountChange(ipConnectionCount, openData.remoteAddress, -1);
                throw new LayerError(LAYER_ERROR_CODES.DEPENDENCY_UNAVAILABLE, 'The event gateway is draining.', {
                    retryable: true,
                    status: 503
                });

            }

            if (replayResult.hasMore) {
                //Releasing capacity when the caller must synchronize before opening a stream
                connectionCountChange(userConnectionCount, openData.authorization.userId, -1);
                connectionCountChange(ipConnectionCount, openData.remoteAddress, -1);
                throw new LayerError(LAYER_ERROR_CODES.CURSOR_EXPIRED, 'The event replay requires a snapshot.', {
                    details: {
                        channels: uniqueChannels
                    },
                    status: 409
                });

            }

            const channelSet = new Set(uniqueChannels);
            let closedStatus = false;
            let heartbeatIdentifier;
            let writeChain = Promise.resolve();
            let processChain = Promise.resolve();
            let pendingEventCount = 0;
            let pendingEventBytes = 0;
            let pendingWriteCount = 0;
            let pendingWriteBytes = 0;

            const connectionData = {
                tenantKey: openData.authorization.tenantKey,
                channels: channelSet,
                cursor: cursorData,
                terminate(){
                    //Destroying a blocked socket without waiting for its pending frame queue
                    openData.response.destroy();

                },
                close() {
                    //Ending this response after its queued control frame is written.
                    openData.response.end();

                },
                /**
                 * @param {string} frameData
                 */
                enqueue(frameData) {
                    //Dropping work after closure and bounding queued frames including heartbeats
                    if ( closedStatus || openData.response.destroyed || openData.response.writableEnded ){
                        return Promise.resolve();

                    }

                    const frameBytes = Buffer.byteLength( frameData );
                    if ( pendingWriteCount >= maxQueuedEvents || pendingWriteBytes + frameBytes > maxQueuedBytes ){
                        //Disconnecting only this slow subscriber so it can replay from its durable cursor
                        openData.response.destroy();
                        return Promise.resolve();

                    }

                    pendingWriteCount += 1;
                    pendingWriteBytes += frameBytes;
                    //Serializing writes to preserve replay and live-event order.
                    writeChain = writeChain.then(function frameWrite() {
                        //Skipping frames after this connection entered final cleanup.
                        if (closedStatus || openData.response.destroyed || openData.response.writableEnded) {
                            return undefined;

                        }

                        return responseFrameWrite(openData.response, frameData, writeTimeoutMs);

                    }).finally(function frameReservationRelease(){
                        //Releasing serialized-byte accounting on success, cancellation and failure
                        pendingWriteCount -= 1;
                        pendingWriteBytes -= frameBytes;

                    });
                    writeChain.catch(function streamWriteFailure(errorData) {
                        //Ending the connection after a failed or closed write.
                        managerOptions.diagnostics.record({
                            level: 'error',
                            event: 'event-stream.write-failed',
                            requestId: openData.requestId,
                            code: errorData.name
                        });
                        openData.response.destroy();

                    });

                    return writeChain;

                },
                /**
                 * @param {LayerStreamEvent} eventData
                 */
                async eventProcess(eventData) {
                    //Refusing additional work before capturing the payload in another queued closure
                    if ( closedStatus || openData.response.destroyed || openData.response.writableEnded ){
                        return;

                    }

                    const eventBytes = Buffer.byteLength( layerEventFrameCreate( eventData ) );
                    if ( pendingEventCount >= maxQueuedEvents || pendingEventBytes + eventBytes > maxQueuedBytes ){
                        //Preserving the durable journal while terminating an over-budget subscriber
                        openData.response.destroy();
                        return;

                    }

                    pendingEventCount += 1;
                    pendingEventBytes += eventBytes;
                    const processResult = processChain.then(async function eventApply() {
                        //Skipping abandoned work before issuing another replay query
                        if ( closedStatus || openData.response.destroyed || openData.response.writableEnded ){
                            return;

                        }

                        const lastSequence = cursorData[eventData.channel] ?? 0;

                        //Ignoring at-least-once duplicate delivery from Redis or replay.
                        if (eventData.sequence <= lastSequence) {
                            return;

                        }

                        let eventBatch = [eventData];

                        //Recovering a detected sequence gap from PostgreSQL before live delivery.
                        if (eventData.sequence !== lastSequence + 1) {
                            const gapReplay = await managerOptions.eventRepository.replay({
                                tenantKey: openData.authorization.tenantKey,
                                channels: [eventData.channel],
                                cursor: {
                                    [eventData.channel]: lastSequence
                                },
                                limit: maxReplayEvents
                            });

                            if (gapReplay.hasMore) {
                                await connectionData.enqueue(layerControlFrameCreate('snapshot-required', {
                                    channels: [eventData.channel]
                                }));
                                openData.response.end();

                                return;

                            }

                            eventBatch = gapReplay.events;

                        }

                        for (const replayEvent of eventBatch) {
                            //Discarding an in-flight query result after the subscriber disconnected
                            if ( closedStatus || openData.response.destroyed || openData.response.writableEnded ){
                                return;

                            }

                            const currentSequence = cursorData[replayEvent.channel] ?? 0;

                            if (replayEvent.sequence <= currentSequence) {
                                continue;

                            }

                            if (replayEvent.sequence !== currentSequence + 1) {
                                await connectionData.enqueue(layerControlFrameCreate('snapshot-required', {
                                    channels: [replayEvent.channel]
                                }));
                                openData.response.end();

                                return;

                            }

                            await connectionData.enqueue(layerEventFrameCreate(replayEvent));
                            cursorData[replayEvent.channel] = replayEvent.sequence;

                        }

                    }).finally(function eventReservationRelease(){
                        //Releasing references and queue accounting after every scheduled event
                        pendingEventCount -= 1;
                        pendingEventBytes -= eventBytes;

                    });

                    processChain = processResult.catch(function eventApplyFailure() {
                        //Keeping later events processable after one connection-local failure.

                    });

                    return processResult;

                }
            };

            activeConnections.add(connectionData);

            try {
                openData.response.writeHead(200, {
                    'cache-control': 'no-store, no-transform',
                    'content-type': 'text/event-stream; charset=utf-8',
                    'x-accel-buffering': 'no',
                    'x-content-type-options': 'nosniff'
                });
                openData.response.flushHeaders();
                const closePromise = new Promise(function streamCloseWait(resolve) {
                    //Observing closure before replay starts so an early disconnect cannot be missed.
                    openData.response.once('close', function streamCloseHandle() {
                        //Releasing the open request when Node reports socket closure.
                        resolve(undefined);

                    });

                });

                //Delivering durable replay before accepting the connection as caught up.
                for (const eventData of replayResult.events) {
                    await connectionData.eventProcess(eventData);

                }

                const raceReplay = await managerOptions.eventRepository.replay({
                    tenantKey: openData.authorization.tenantKey,
                    channels: uniqueChannels,
                    cursor: cursorData,
                    limit: maxReplayEvents
                });

                if (raceReplay.hasMore) {
                    await connectionData.enqueue(layerControlFrameCreate('snapshot-required', {
                        channels: uniqueChannels
                    }));
                    openData.response.end();

                    return;

                }

                //Closing the query-to-subscription race from the durable journal.
                for (const eventData of raceReplay.events) {
                    await connectionData.eventProcess(eventData);

                }

                heartbeatIdentifier = setInterval(function heartbeatSend() {
                    //Keeping intermediaries and client liveness detection active.
                    void connectionData.enqueue(layerHeartbeatFrameCreate(clock()));

                }, heartbeatMs);

                managerOptions.diagnostics.record({
                    level: 'info',
                    event: 'event-stream.open',
                    requestId: openData.requestId,
                    status: 200
                });

                //Holding the POST response until the client or server closes it.
                await closePromise;

            } finally {
                closedStatus = true;
                clearInterval(heartbeatIdentifier);
                activeConnections.delete(connectionData);
                connectionCountChange(userConnectionCount, openData.authorization.userId, -1);
                connectionCountChange(ipConnectionCount, openData.remoteAddress, -1);

            }

        },

        /**
         * @param {string} tenantKey
         * @param {LayerStreamEvent} eventData
         */
        dispatch(tenantKey, eventData) {
            //Routing confirmed events only to matching local tenant/channel streams.
            for (const connectionData of activeConnections) {
                if (connectionData.tenantKey === tenantKey && connectionData.channels.has(eventData.channel)) {
                    void connectionData.eventProcess(eventData).catch(function dispatchFailure(
                        /** @type {Error} */ errorData
                    ) {
                        //Recording only safe failure classification for this local subscriber.
                        managerOptions.diagnostics.record({
                            level: 'error',
                            event: 'event-stream.dispatch-failed',
                            code: errorData.name
                        });

                    });

                }

            }

        },

        async drain() {
            drainingStatus = true;
            const drainPromises = [];
            const drainingConnections = [...activeConnections];
            //Bounding the entire drain even when several frames precede the shutdown control frame
            const drainDeadline = setTimeout(function streamsDrainExpire(){
                //Closing remaining peers so shutdown cannot wait indefinitely for backpressure
                for ( const connectionData of drainingConnections ){
                    connectionData.terminate();

                }

            }, writeTimeoutMs);

            //Notifying active clients before ending every local stream.
            for (const connectionData of activeConnections) {
                const drainPromise = connectionData.enqueue(layerControlFrameCreate('server-drain', {
                    retryAfterMs: 500
                })).then(function drainedStreamClose() {
                    //Ending the response after its drain control event is flushed.
                    connectionData.close();

                });

                drainPromises.push(drainPromise);

            }

            try {
                await Promise.allSettled(drainPromises);

            } finally {
                clearTimeout( drainDeadline );

            }

        },

        activeCount() {
            //Reporting local stream count for health and deployment diagnostics.
            return activeConnections.size;

        }
    });

}
