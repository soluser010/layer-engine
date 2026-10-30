/**
 * @param {object} synchronizerOptionsData
 * @param {{readAfter: (replayData: {cursor: number, limit: number}) => Promise<readonly Record<string, any>[]>}} synchronizerOptionsData.repository
 * @param {{invalidate: (invalidationData: Record<string, unknown>) => Promise<unknown>, invalidationCursorRead: () => Promise<number>, invalidationCursorWrite: (cursorData: number) => Promise<void>}} synchronizerOptionsData.cache
 * @param {number} [synchronizerOptionsData.pollIntervalMs]
 * @param {number} [synchronizerOptionsData.batchSize]
 * @param {{record: (diagnosticData: Record<string, unknown>) => void}} [synchronizerOptionsData.diagnostics]
 * @param {() => Promise<unknown>} [synchronizerOptionsData.beforeSynchronize]
 * @param {() => number} [synchronizerOptionsData.connectionVersionRead]
 */
export function layerCacheInvalidationSynchronizerCreate( synchronizerOptionsData ){
    const pollIntervalData = synchronizerOptionsData.pollIntervalMs ?? Number( 1000 );
    const batchSizeData = synchronizerOptionsData.batchSize ?? Number( 100 );
    const connectionVersionReadData = synchronizerOptionsData.connectionVersionRead ?? function(){
        //Standalone callers may manage a fixed connection externally
        return 0;

    };

    if (
        typeof synchronizerOptionsData.repository?.readAfter !== 'function' ||
        typeof synchronizerOptionsData.cache?.invalidate !== 'function' ||
        typeof synchronizerOptionsData.cache?.invalidationCursorRead !== 'function' ||
        typeof synchronizerOptionsData.cache?.invalidationCursorWrite !== 'function' ||
        typeof connectionVersionReadData !== 'function' ||
        (synchronizerOptionsData.beforeSynchronize !== undefined && typeof synchronizerOptionsData.beforeSynchronize !== 'function') ||
        Number.isInteger( pollIntervalData ) === false ||
        Number( pollIntervalData ) < Number( 100 ) ||
        Number( pollIntervalData ) > Number( 60000 ) ||
        Number.isInteger( batchSizeData ) === false ||
        Number( batchSizeData ) < Number( 1 ) ||
        Number( batchSizeData ) > Number( 1000 )
    ){
        throw new TypeError( 'Cache invalidation synchronizer options are invalid.' );

    }

    let cursorData = Number( 0 );
    let cursorLoadedStatusData = false;
    let startedStatusData = false;
    let caughtUpStatusData = false;
    let caughtUpVersionData = -1;
    let synchronizationPromiseData = /** @type {Promise<number> | null} */ (null);
    let pollTimerData = /** @type {ReturnType<typeof setInterval> | null} */ (null);

    const diagnosticRecordData = function(
        /** @type {string} */ eventNameData,
        /** @type {string} */ codeData
    ){
        //Reporting bounded dependency diagnostics without exposing Redis or SQL error details
        synchronizerOptionsData.diagnostics?.record({
            level: 'warn',
            event: eventNameData,
            code: codeData
        });

    };

    const synchronizationExecuteData = async function(){
        //Blocking cache reads until every available batch in this connection generation is replayed
        caughtUpStatusData = false;

        if ( synchronizerOptionsData.beforeSynchronize !== undefined ){
            const dependencyReadyData = await synchronizerOptionsData.beforeSynchronize();

            if ( dependencyReadyData === false ){
                throw new Error( 'CACHE_UNAVAILABLE' );

            }

        }

        const connectionVersionData = connectionVersionReadData();

        //Loading the Redis checkpoint before reading the durable journal.
        if ( cursorLoadedStatusData === false || caughtUpVersionData !== connectionVersionData ){
            cursorData = await synchronizerOptionsData.cache.invalidationCursorRead();
            cursorLoadedStatusData = true;

        }

        let replayedCountData = 0;

        //Bounding one catch-up pass while retaining not-ready state for a larger backlog
        for ( let batchIndexData = 0; batchIndexData < 100; batchIndexData += 1 ){
            const invalidationRecordsData = await synchronizerOptionsData.repository.readAfter({
                cursor: cursorData,
                limit: batchSizeData
            });

            for ( const invalidationData of invalidationRecordsData ){
                await synchronizerOptionsData.cache.invalidate({
                    security: {
                        tenantId: invalidationData.tenantId ?? null,
                        userId: invalidationData.userId ?? null
                    },
                    metadata: {
                        scope: invalidationData.scope
                    },
                    tags: invalidationData.tags
                });

                //Never acknowledge work completed on a transport that has already disconnected
                if ( connectionVersionData !== connectionVersionReadData() ){
                    throw new Error( 'CACHE_UNAVAILABLE' );

                }

                cursorData = Number( invalidationData.invalidationId );

            }

            if ( invalidationRecordsData.length > 0 ){
                await synchronizerOptionsData.cache.invalidationCursorWrite( cursorData );

            }

            replayedCountData += invalidationRecordsData.length;

            if ( connectionVersionData !== connectionVersionReadData() ){
                throw new Error( 'CACHE_UNAVAILABLE' );

            }

            if ( invalidationRecordsData.length < batchSizeData ){
                caughtUpStatusData = true;
                caughtUpVersionData = connectionVersionData;
                break;

            }

        }

        return replayedCountData;

    };

    return Object.freeze({
        async start( {background = false} = {} ){
            if ( startedStatusData === true ){
                throw new Error( 'Cache invalidation synchronizer is already started.' );

            }

            startedStatusData = true;

            const synchronizerData = this;
            pollTimerData = setInterval(function(){
                //Retrying replay in the background while callers continue with durable fallback
                void synchronizerData.synchronize().catch(function cacheInvalidationPollFailure(){
                    //Keeping the retry timer alive after an unavailable dependency
                    diagnosticRecordData( 'cache-invalidation.synchronize-failed', 'CACHE_UNAVAILABLE' );

                });

            }, pollIntervalData);
            pollTimerData.unref?.();

            //Installing the timer before the initial asynchronous pass so stop can always cancel it
            const initialPassData = this.synchronize().catch(function(){
                //Keeping the durable cursor unchanged until Redis becomes available
                diagnosticRecordData( 'cache-invalidation.synchronize-failed', 'CACHE_UNAVAILABLE' );

            });

            if ( background === false ){
                await initialPassData;

            }

        },

        async synchronize(){
            if ( synchronizationPromiseData !== null ){
                return synchronizationPromiseData;

            }

            synchronizationPromiseData = synchronizationExecuteData();

            try {
                return await synchronizationPromiseData;

            } catch( synchronizationErrorData ){
                //Reloading the durable Redis checkpoint after partial writes or reconnect
                caughtUpStatusData = false;
                cursorLoadedStatusData = false;
                throw synchronizationErrorData;

            } finally {
                synchronizationPromiseData = null;

            }

        },

        async stop(){
            //Disabling new cache reads before closing the polling lifecycle
            startedStatusData = false;
            caughtUpStatusData = false;

            if ( pollTimerData !== null ){
                clearInterval( pollTimerData );
                pollTimerData = null;

            }

            await synchronizationPromiseData?.catch(function(){
                //Closing during a dependency failure must still finish cleanup normally

            });

        },

        cursorGet(){
            //Exposing the current replay position for infrastructure diagnostics
            return cursorData;

        },

        isReady(){
            //Rejecting readiness inherited from an earlier Redis connection
            return startedStatusData && caughtUpStatusData && caughtUpVersionData === connectionVersionReadData();

        }
    });

}
