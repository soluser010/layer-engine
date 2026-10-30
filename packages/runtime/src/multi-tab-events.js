import {layerProtocolDataValidatorCreate} from '@solcorp/layer-protocol/data-validator';
import {LayerRuntimeError} from './runtime-error.js';
import {layerEventAbortableWait, layerEventTerminalFailureCheck, layerRecoveryChannelsRead} from './event-recovery.js';


/**
 * @typedef {{request: (lockName: string, lockOptions: {mode: 'exclusive', signal: AbortSignal}, callback: (lockData: unknown) => Promise<void>) => Promise<void>}} LayerLockManager
 * @typedef {{postMessage: (messageData: unknown) => void, addEventListener: (eventName: 'message', handler: (eventData: MessageEvent) => void) => void, removeEventListener: (eventName: 'message', handler: (eventData: MessageEvent) => void) => void, close: () => void}} LayerBroadcastChannel
 */

/**
 * @param {object} coordinatorOptions
 * @param {string} coordinatorOptions.originKey
 * @param {readonly string[]} coordinatorOptions.channels
 * @param {() => Promise<Record<string, number>> | Record<string, number>} coordinatorOptions.cursorRead
 * @param {(eventData: Record<string, unknown>) => Promise<void> | void} coordinatorOptions.eventReceive
 * @param {(gapData: {channel: string, cursor: number, receivedSequence: number, signal?: AbortSignal}) => Promise<void | {cursor: number}> | void | {cursor: number}} [coordinatorOptions.syncHandle]
 * @param {(runData: {signal: AbortSignal, initialCursor: Readonly<Record<string, number>>, requestCursor?: Readonly<Record<string, number>>, eventObserve: (eventData: Record<string, unknown>) => Promise<void>, snapshotObserve?: (channels: readonly string[], cursor?: Readonly<Record<string, number>>) => Promise<void>}) => Promise<void>} coordinatorOptions.streamRun
 * @param {LayerLockManager} [coordinatorOptions.lockManager]
 * @param {(channelName: string) => LayerBroadcastChannel} [coordinatorOptions.broadcastChannelCreate]
 * @param {(errorData: unknown) => void} [coordinatorOptions.failureHandle]
 * @param {() => string} coordinatorOptions.tabIdCreate
 * @param {number} [coordinatorOptions.peerCollectionMs]
 */
export function layerMultiTabEventsCreate( coordinatorOptions ){
    //Keeping application progress per tab even when IndexedDB cursors are shared
    const tabIdentifier = coordinatorOptions.tabIdCreate();
    const peerCollectionMs = coordinatorOptions.peerCollectionMs ?? 50;
    const protocolValidator = layerProtocolDataValidatorCreate();
    let abortController = /** @type {AbortController | null} */ (null);
    let runtimeTask = /** @type {Promise<void> | null} */ (null);
    let messageTask = Promise.resolve();

    /** @param {unknown} errorData */
    const failureReport = function( errorData ){
        //Containing telemetry failures so browser message callbacks never reject unobserved
        try {
            coordinatorOptions.failureHandle?.( errorData );

        } catch( reportingError ){
            //The host's failed error reporter cannot restore or authorize a subscription
            void reportingError;

        }

    };

    return Object.freeze({
        async start(){
            //Preventing overlapping lifecycle owners for one tab
            if ( abortController !== null ){
                throw new Error( 'Multi-tab events are already started.' );

            }

            //Creating cancellation before any storage, lock or channel work
            const localAbortController = new AbortController();
            abortController = localAbortController;
            const signal = localAbortController.signal;
            const localCursor = /** @type {Record<string, number>} */ (Object.create( null ));
            const storedCursor = await layerEventAbortableWait( coordinatorOptions.cursorRead(), signal );
            for ( const channelName of coordinatorOptions.channels ){
                const sequenceData = storedCursor[channelName];
                localCursor[channelName] = 0;
                if ( Number.isSafeInteger( sequenceData ) && sequenceData >= 0 ){
                    localCursor[channelName] = sequenceData;

                }

            }

            //Retaining independent streams when either coordination capability is unavailable
            const lockManager = coordinatorOptions.lockManager;
            const broadcastChannelCreate = coordinatorOptions.broadcastChannelCreate;
            if ( lockManager === undefined || broadcastChannelCreate === undefined ){
                runtimeTask = coordinatorOptions.streamRun({
                    signal,
                    initialCursor: localCursor,
                    async eventObserve(){
                        //Independent tabs have no followers to notify

                    }
                });
                void runtimeTask.catch(function( runtimeError ){
                    //Suppressing expected cancellation while retaining genuine independent-stream failures
                    if ( !signal.aborted ){
                        failureReport( runtimeError );

                    }

                });
                return;

            }

            //Keeping channels and listeners local to this lifecycle generation
            const broadcastChannel = broadcastChannelCreate( 'layer-events:' + coordinatorOptions.originKey );
            const peerCursorMap = new Map();
            let leaderStatus = false;

            /** @param {readonly string[]} channels @param {number | null} receivedSequence */
            const followerSnapshotRecover = async function( channels, receivedSequence ){
                //Requiring the application's authorized domain loader rather than trusting a peer's data or cursor
                if ( coordinatorOptions.syncHandle === undefined ){
                    throw new LayerRuntimeError( 'EVENT_SYNC_REQUIRED', 'The application must provide eventSync for snapshot recovery.' );

                }

                for ( const channelName of channels ){
                    signal.throwIfAborted();
                    const snapshotResult = await layerEventAbortableWait( coordinatorOptions.syncHandle({
                        channel: channelName,
                        cursor: localCursor[channelName] ?? 0,
                        receivedSequence: receivedSequence ?? localCursor[channelName] ?? 0,
                        signal
                    }), signal );
                    signal.throwIfAborted();

                    //Advancing only after this tab has applied its own snapshot
                    let sequenceData;
                    if ( snapshotResult !== undefined ){
                        //Keeping a concurrent shared cursor write from skipping events missing in this tab's snapshot
                        sequenceData = snapshotResult?.cursor;

                    } else {
                        //Supporting legacy application hooks that persist their cursor and return void
                        const synchronizedCursor = await layerEventAbortableWait( coordinatorOptions.cursorRead(), signal );
                        sequenceData = synchronizedCursor[channelName];

                    }

                    signal.throwIfAborted();
                    if ( typeof sequenceData !== 'number' || !Number.isSafeInteger( sequenceData ) || sequenceData < (localCursor[channelName] ?? 0) ){
                        throw new LayerRuntimeError( 'STREAM_RECOVERY_INVALID', 'The follower snapshot cursor is invalid.' );

                    }

                    localCursor[channelName] = sequenceData;

                }

            };

            /** @param {MessageEvent} messageEvent */
            const messageProcess = async function( messageEvent ){
                //Discarding stale lifecycle work and malformed sibling messages before dispatch
                if ( signal.aborted ){
                    return;

                }

                const messageData = messageEvent.data;
                if ( typeof messageData !== 'object' || messageData === null || Array.isArray( messageData ) ||
                    typeof messageData.tabId !== 'string' || messageData.tabId.length > 128 || messageData.tabId === tabIdentifier ){
                    return;

                }

                //Announcing this tab's applied position, not a cursor advanced by another tab
                if ( messageData.type === 'cursor-request' ){
                    broadcastChannel.postMessage({type: 'cursor', tabId: tabIdentifier, cursor: {...localCursor}});
                    return;

                }

                //Keeping only a bounded set of safe cursor records for leader election
                if ( messageData.type === 'cursor' ){
                    if ( typeof messageData.cursor !== 'object' || messageData.cursor === null ||
                        Array.isArray( messageData.cursor ) || peerCursorMap.size >= 100 ){
                        return;

                    }

                    const peerCursor = /** @type {Record<string, number>} */ (Object.create( null ));
                    for ( const channelName of coordinatorOptions.channels ){
                        const sequenceData = messageData.cursor[channelName];
                        if ( Number.isSafeInteger( sequenceData ) && sequenceData >= 0 ){
                            peerCursor[channelName] = sequenceData;

                        }

                    }

                    peerCursorMap.set( messageData.tabId, peerCursor );
                    return;

                }

                //Allowing only followers to consume a leader's serialized application deliveries
                if ( leaderStatus ){
                    return;

                }

                if ( messageData.type === 'snapshot-required' ){
                    const channelNames = layerRecoveryChannelsRead( messageData.channels, coordinatorOptions.channels );
                    await followerSnapshotRecover( channelNames, null );
                    return;

                }

                if ( messageData.type === 'event' ){
                    const eventData = messageData.event;
                    if ( !protocolValidator.eventValidate( eventData ).valid ||
                        !Object.hasOwn( localCursor, eventData.channel ) ){
                        throw new LayerRuntimeError( 'STREAM_EVENT_INVALID', 'The sibling event is invalid.' );

                    }

                    const channelName = String( eventData.channel );
                    const sequenceData = Number( eventData.sequence );
                    if ( sequenceData <= (localCursor[channelName] ?? 0) ){
                        return;

                    }

                    //Recovering missed messages before applying a later sibling delivery
                    if ( sequenceData > (localCursor[channelName] ?? 0) + 1 ){
                        await followerSnapshotRecover( [channelName], sequenceData );

                    }

                    if ( sequenceData <= (localCursor[channelName] ?? 0) ){
                        return;

                    }

                    if ( sequenceData !== (localCursor[channelName] ?? 0) + 1 ){
                        throw new LayerRuntimeError( 'STREAM_GAP_UNRESOLVED', 'The follower event gap remains unresolved.' );

                    }

                    //Awaiting application effects before accepting the next event from BroadcastChannel
                    signal.throwIfAborted();
                    await layerEventAbortableWait( coordinatorOptions.eventReceive( eventData ), signal );
                    signal.throwIfAborted();
                    localCursor[channelName] = sequenceData;

                }

            };

            /** @param {MessageEvent} messageEvent */
            const messageHandle = function( messageEvent ){
                //Serializing snapshot hooks and events to prevent application-state races
                messageTask = messageTask.then(function(){
                    //Dispatching only after the preceding sibling update settled
                    return messageProcess( messageEvent );

                }).catch(function( messageError ){
                    //Reporting only active-generation failures, not expected shutdown cancellation
                    if ( !signal.aborted ){
                        failureReport( messageError );
                        //Stopping all later sibling delivery after revocation or an invalid recovery boundary
                        if ( layerEventTerminalFailureCheck( messageError ) ){
                            localAbortController.abort( messageError );

                        }

                    }

                });

            };

            broadcastChannel.addEventListener( 'message', messageHandle );
            runtimeTask = lockManager.request( 'layer-events:' + coordinatorOptions.originKey, {
                mode: 'exclusive',
                signal
            }, async function(){
                //Collecting follower positions before opening the elected leader's replay stream
                signal.throwIfAborted();
                peerCursorMap.clear();
                broadcastChannel.postMessage({type: 'cursor-request', tabId: tabIdentifier});
                let collectionTimer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);
                try {
                    await layerEventAbortableWait( new Promise(function( resolve ){
                        //Allowing a bounded response window for active tabs
                        collectionTimer = setTimeout( resolve, peerCollectionMs );

                    }), signal );

                } finally {
                    //Removing the election timer immediately when the owning tab stops
                    clearTimeout( collectionTimer );

                }
                await messageTask;
                signal.throwIfAborted();

                //Using the minimum confirmed peer position for the first replay request only
                const minimumCursor = /** @type {Record<string, number>} */ (Object.create( null ));
                for ( const channelName of coordinatorOptions.channels ){
                    let sequenceData = localCursor[channelName] ?? 0;
                    for ( const peerCursor of peerCursorMap.values() ){
                        const peerSequence = peerCursor[channelName];
                        if ( peerSequence !== undefined && peerSequence < sequenceData ){
                            sequenceData = peerSequence;

                        }

                    }

                    minimumCursor[channelName] = sequenceData;

                }

                leaderStatus = true;
                await coordinatorOptions.streamRun({
                    signal,
                    initialCursor: {...localCursor},
                    requestCursor: minimumCursor,
                    async eventObserve( eventData ){
                        //Broadcasting only while this generation owns the leader lock
                        signal.throwIfAborted();
                        localCursor[String( eventData.channel )] = Math.max(
                            localCursor[String( eventData.channel )] ?? 0, Number( eventData.sequence )
                        );
                        broadcastChannel.postMessage({type: 'event', tabId: tabIdentifier, event: eventData});

                    },
                    async snapshotObserve( channels, snapshotCursor ){
                        //Requiring every follower to load its own authorized snapshot, without broadcasting private records
                        signal.throwIfAborted();
                        const channelNames = layerRecoveryChannelsRead( channels, coordinatorOptions.channels );
                        const synchronizedCursor = snapshotCursor ?? await layerEventAbortableWait( coordinatorOptions.cursorRead(), signal );
                        signal.throwIfAborted();
                        for ( const channelName of channelNames ){
                            localCursor[channelName] = synchronizedCursor[channelName] ?? localCursor[channelName] ?? 0;

                        }

                        broadcastChannel.postMessage({type: 'snapshot-required', tabId: tabIdentifier, channels: channelNames});

                    }
                });

            }).finally(function(){
                //Closing only this generation's resources after lock cancellation or stream failure
                leaderStatus = false;
                broadcastChannel.removeEventListener( 'message', messageHandle );
                broadcastChannel.close();

            });
            void runtimeTask.catch(function( runtimeError ){
                //Reporting terminal stream failures but not expected lock cancellation during stop
                if ( !signal.aborted ){
                    failureReport( runtimeError );

                }

            });

        },

        async stop(){
            //Releasing the lock and outstanding hooks before a replacement subscription can start
            if ( abortController === null ){
                return;

            }

            abortController.abort( new DOMException( 'The event runtime stopped.', 'AbortError' ) );
            try {
                await runtimeTask;
                await messageTask;

            } catch( runtimeError ){
                //The task's attached failure handler already reports genuine errors; stop cancellation is expected
                void runtimeError;

            } finally {
                abortController = null;
                runtimeTask = null;
                messageTask = Promise.resolve();

            }

        },

        isStarted(){
            //Reporting whether this tab still owns or awaits its lifecycle task
            return abortController !== null;

        }
    });

}
