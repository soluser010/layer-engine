import {LayerRuntimeError} from './runtime-error.js';
import {
    layerEventAbortableWait,
    layerEventTerminalFailureCheck,
    layerRecoveryChannelsRead
} from './event-recovery.js';

/**
 * @param {number} delayMs
 * @param {AbortSignal} abortSignal
 */
async function abortableDelay(delayMs, abortSignal) {
    await new Promise(function delayWait(resolve, reject) {
        //Rejecting before timer allocation when shutdown already started.
        if (abortSignal.aborted) {
            reject(abortSignal.reason);

            return;

        }

        const delayIdentifier = setTimeout(function delayComplete() {
            //Removing the abort listener before reconnect work resumes.
            cleanup();
            resolve(undefined);

        }, delayMs);
        const abortHandle = function delayAbort() {
            //Cancelling the pending reconnect delay with the original abort reason.
            cleanup();
            reject(abortSignal.reason);

        };
        const cleanup = function delayCleanup() {
            //Releasing both timer and signal resources for the winning path.
            clearTimeout(delayIdentifier);
            abortSignal.removeEventListener('abort', abortHandle);

        };

        abortSignal.addEventListener('abort', abortHandle, {
            once: true
        });

    });

}

/**
 * @param {object} runtimeOptions
 * @param {readonly string[]} runtimeOptions.channels
 * @param {{open: Function}} runtimeOptions.stream
 * @param {() => Promise<Record<string, number>> | Record<string, number>} runtimeOptions.cursorRead
 * @param {(channelName: string, sequence: number) => Promise<void> | void} runtimeOptions.cursorWrite
 * @param {(eventData: Record<string, unknown>) => Promise<void> | void} runtimeOptions.eventApply
 * @param {(gapData: {channel: string, cursor: number, receivedSequence: number, signal?: AbortSignal}) => Promise<void | {cursor: number}> | void | {cursor: number}} runtimeOptions.syncHandle
 * @param {(controlData: Record<string, unknown>) => Promise<void> | void} [runtimeOptions.controlHandle]
 * @param {(failureData: {error: unknown, attempt: number, retryDelayMs: number}) => Promise<boolean> | boolean} [runtimeOptions.failureHandle]
 * @param {() => number} [runtimeOptions.random]
 */
export function layerEventRuntimeCreate(runtimeOptions) {
    const randomValueCreate = runtimeOptions.random ?? Math.random;

    return Object.freeze({
        /**
         * @param {object} runOptions
         * @param {AbortSignal} runOptions.signal
         * @param {Readonly<Record<string, number>>} [runOptions.initialCursor]
         * @param {Readonly<Record<string, number>>} [runOptions.requestCursor]
         * @param {(eventData: Record<string, unknown>) => Promise<void> | void} [runOptions.eventObserve]
         * @param {(channels: readonly string[], cursor?: Readonly<Record<string, number>>) => Promise<void> | void} [runOptions.snapshotObserve]
         */
        async run( runOptions ){
            //Reading the durable application position separately from a lagging follower's replay position
            const storedCursor = runOptions.initialCursor ?? await runtimeOptions.cursorRead();
            const cursorData = /** @type {Record<string, number>} */ (Object.create( null ));
            const requestCursorData = /** @type {Record<string, number>} */ (Object.create( null ));
            for ( const channelName of runtimeOptions.channels ){
                //Normalizing only safe persisted sequences without accepting arbitrary cursor keys
                const channelCursor = storedCursor[channelName] ?? 0;
                cursorData[channelName] = 0;
                if ( Number.isSafeInteger( channelCursor ) && channelCursor >= 0 ){
                    cursorData[channelName] = channelCursor;

                }

                //Using a minimum peer cursor only as the initial wire position, not a permanent reconnect override
                const peerCursor = runOptions.requestCursor?.[channelName];
                requestCursorData[channelName] = cursorData[channelName];
                if ( peerCursor !== undefined && Number.isSafeInteger( peerCursor ) && peerCursor >= 0 ){
                    requestCursorData[channelName] = Math.min( peerCursor, cursorData[channelName] );

                }

            }

            //Bounding consecutive snapshot attempts independently of heartbeat-based transport retries
            let reconnectAttempt = 0;
            const snapshotAttempts = /** @type {Record<string, number>} */ (Object.create( null ));
            /** @param {readonly string[]} channels @param {number | null} receivedSequence */
            const snapshotRecover = async function( channels, receivedSequence ){
                //Preventing an invalid snapshot hook or continuously expired cursor from creating a hot loop
                for ( const channelName of channels ){
                    const attemptCount = (snapshotAttempts[channelName] ?? 0) + 1;
                    if ( attemptCount > 3 ){
                        //Bounding one stalled channel without blocking other channels' first snapshot
                        throw new LayerRuntimeError( 'STREAM_RECOVERY_STALLED', 'Snapshot recovery did not restore the event stream.' );

                    }

                    snapshotAttempts[channelName] = attemptCount;

                }

                //Applying the domain snapshot before reading and advancing its durable cursor
                for ( const channelName of channels ){
                    runOptions.signal.throwIfAborted();
                    const snapshotResult = await layerEventAbortableWait( runtimeOptions.syncHandle({
                        channel: channelName,
                        cursor: cursorData[channelName] ?? 0,
                        receivedSequence: receivedSequence ?? cursorData[channelName] ?? 0,
                        signal: runOptions.signal
                    }), runOptions.signal );
                    runOptions.signal.throwIfAborted();

                    //Requiring a confirmed, non-regressing cursor rather than inventing a server position
                    let sequenceData;
                    if ( snapshotResult !== undefined ){
                        //Using this tab's exact snapshot position instead of another tab's newer shared cursor
                        sequenceData = snapshotResult?.cursor;

                    } else {
                        //Preserving the original void hook contract for existing applications
                        const synchronizedCursor = await layerEventAbortableWait( runtimeOptions.cursorRead(), runOptions.signal );
                        sequenceData = synchronizedCursor[channelName];

                    }

                    runOptions.signal.throwIfAborted();
                    if ( typeof sequenceData !== 'number' || !Number.isSafeInteger( sequenceData ) || sequenceData < (cursorData[channelName] ?? 0) ){
                        //Rejecting a snapshot that cannot safely continue the current subscription
                        throw new LayerRuntimeError( 'STREAM_RECOVERY_INVALID', 'The snapshot cursor is invalid.' );

                    }

                    //Updating both local deduplication and the mutable wire cursor for the recovered channel
                    await runtimeOptions.cursorWrite( channelName, sequenceData );
                    runOptions.signal.throwIfAborted();
                    cursorData[channelName] = sequenceData;
                    requestCursorData[channelName] = sequenceData;

                }

                //Telling follower tabs to obtain their own authorized snapshot before consuming later events
                runOptions.signal.throwIfAborted();
                await runOptions.snapshotObserve?.( channels, {...cursorData} );
                runOptions.signal.throwIfAborted();

            };

            while ( !runOptions.signal.aborted ){
                //Tracking transport activity separately from successful domain progress
                let activityStatus = false;
                try {
                    await layerEventAbortableWait( runtimeOptions.stream.open({
                        channels: runtimeOptions.channels,
                        cursor: {...requestCursorData},
                        signal: runOptions.signal,
                        async eventHandle(/** @type {Record<string, unknown>} */ eventData ){
                            //Validating the subscribed channel and positive sequence before application effects
                            runOptions.signal.throwIfAborted();
                            const channelName = eventData.channel;
                            const eventSequence = eventData.sequence;
                            if ( typeof channelName !== 'string' || !Object.hasOwn( cursorData, channelName ) ||
                                typeof eventSequence !== 'number' || !Number.isSafeInteger( eventSequence ) || eventSequence < 1 ){
                                //Rejecting malformed deliveries without advancing any cursor
                                throw new LayerRuntimeError( 'STREAM_EVENT_INVALID', 'The event channel or sequence is invalid.' );

                            }

                            //Recovering the same snapshot contract for a live sequence gap
                            activityStatus = true;
                            if ( eventSequence > (cursorData[channelName] ?? 0) + 1 ){
                                await snapshotRecover( [channelName], eventSequence );

                            }

                            //Applying and persisting new events before advancing their in-memory acknowledgement
                            if ( eventSequence > (cursorData[channelName] ?? 0) ){
                                if ( eventSequence !== (cursorData[channelName] ?? 0) + 1 ){
                                    //Keeping unresolved gaps terminal to this delivery rather than skipping state
                                    throw new LayerRuntimeError( 'STREAM_GAP_UNRESOLVED', 'The event sequence gap remains unresolved.', {
                                        retryable: true
                                    });

                                }

                                await layerEventAbortableWait( runtimeOptions.eventApply( eventData ), runOptions.signal );
                                runOptions.signal.throwIfAborted();
                                await layerEventAbortableWait( runtimeOptions.cursorWrite( channelName, eventSequence ), runOptions.signal );
                                runOptions.signal.throwIfAborted();
                                cursorData[channelName] = eventSequence;
                                snapshotAttempts[channelName] = 0;

                            }

                            //Forwarding replay duplicates too, because a follower may still need them
                            await layerEventAbortableWait( runOptions.eventObserve?.( eventData ), runOptions.signal );
                            runOptions.signal.throwIfAborted();
                            requestCursorData[channelName] = Math.max( requestCursorData[channelName] ?? 0, eventSequence );

                        },
                        async controlHandle(/** @type {Record<string, unknown>} */ controlData ){
                            //Sharing snapshot recovery with pre-open HTTP failures and live sequence gaps
                            runOptions.signal.throwIfAborted();
                            activityStatus = true;
                            if ( controlData.type === 'snapshot-required' ){
                                const channelNames = layerRecoveryChannelsRead( controlData.channels, runtimeOptions.channels );
                                await snapshotRecover( channelNames, null );

                            }

                            //Preserving the application control hook after framework recovery succeeds
                            await layerEventAbortableWait( runtimeOptions.controlHandle?.( controlData ), runOptions.signal );

                        },
                        heartbeatHandle() {
                            //Resetting ordinary reconnect backoff without resetting the snapshot attempt budget
                            activityStatus = true;

                        }
                    }), runOptions.signal );

                    //Treating a clean stream end as a recoverable transport disconnect
                    throw new LayerRuntimeError( 'STREAM_DISCONNECTED', 'The event stream ended.', {retryable: true} );

                } catch( initialStreamError ){
                    //Ending ownership without scheduling a reconnect after logout, dispose or subscription replacement
                    if ( runOptions.signal.aborted ){
                        break;

                    }

                    //Converting only the explicit pre-open cursor failure into domain snapshot recovery
                    let streamError = initialStreamError;
                    if ( streamError instanceof LayerRuntimeError && streamError.code === 'CURSOR_EXPIRED' && streamError.status === 409 ){
                        try {
                            const channelNames = layerRecoveryChannelsRead( streamError.details?.channels, runtimeOptions.channels );
                            await snapshotRecover( channelNames, null );

                            //Reauthorizing through a fresh stream open after the confirmed snapshot
                            continue;

                        } catch( snapshotError ){
                            //Passing snapshot failures through the ordinary bounded failure policy
                            streamError = snapshotError;

                        }

                    }

                    //Ignoring completion from a hook whose owning subscription has already stopped
                    if ( runOptions.signal.aborted ){
                        break;

                    }

                    if ( activityStatus ){
                        reconnectAttempt = 0;

                    }

                    //Calculating jittered transport backoff while honoring server retry guidance
                    const exponentialDelay = Math.min( 30000, 500 * (2 ** reconnectAttempt) );
                    let retryDelayMs = Math.round( exponentialDelay * (0.5 + randomValueCreate()) );
                    let retryableStatus = !(streamError instanceof LayerRuntimeError) || streamError.retryable;
                    if ( streamError instanceof LayerRuntimeError && streamError.retryAfterMs > retryDelayMs ){
                        retryDelayMs = streamError.retryAfterMs;

                    }

                    //Allowing host retry policy without allowing authorization or recovery-boundary bypasses
                    if ( runtimeOptions.failureHandle !== undefined ){
                        retryableStatus = await layerEventAbortableWait( runtimeOptions.failureHandle({
                            error: streamError,
                            attempt: reconnectAttempt,
                            retryDelayMs
                        }), runOptions.signal );

                    }

                    if ( !retryableStatus || layerEventTerminalFailureCheck( streamError ) ){
                        //Passing terminal failures to the lifecycle owner without reopening the subscription
                        throw streamError;

                    }

                    //Waiting for the next owned connection attempt without retaining an aborted timer
                    reconnectAttempt += 1;
                    try {
                        await abortableDelay( retryDelayMs, runOptions.signal );

                    } catch( delayError ){
                        if ( !runOptions.signal.aborted ){
                            //Propagating an unexpected timer failure rather than hiding it as cancellation
                            throw delayError;

                        }

                    }

                }

            }

        }
    });

}
