import {layerSystemTableReferenceCreate} from '@solcorp/layer-database';

/**
 * @param {unknown} routingData
 */
function routingDataNormalize( routingData ){
    let routingRecordData = routingData;

    if ( typeof routingData === 'string' ){
        try {
            routingRecordData = JSON.parse( routingData );

        } catch( routingParseErrorData ){
            void routingParseErrorData;

            return null;

        }

    }

    if ( routingRecordData === null || typeof routingRecordData !== 'object' || Array.isArray( routingRecordData ) === true ){
        return null;

    }

    const routingRecord = /** @type {Record<string, unknown>} */ (routingRecordData);

    if (
        typeof routingRecord.eventId !== 'string' ||
        typeof routingRecord.tenantKey !== 'string' ||
        typeof routingRecord.channel !== 'string' ||
        Number( routingRecord.eventId.length ) < Number( 1 ) ||
        Number( routingRecord.tenantKey.length ) < Number( 1 ) ||
        Number( routingRecord.eventId.length ) > Number( 160 ) ||
        Number( routingRecord.tenantKey.length ) > Number( 160 ) ||
        /^[a-zA-Z0-9:_-]+$/.test( routingRecord.channel ) === false
    ){
        return null;

    }

    return Object.freeze({
        eventId: routingRecord.eventId,
        tenantKey: routingRecord.tenantKey,
        channel: routingRecord.channel
    });

}

/**
 * @param {object} busOptionsData
 * @param {{systemSchema?: string, query: (queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, unknown>[], rowCount: number | null}>}} busOptionsData.database
 * @param {number | 'latest'} [busOptionsData.cursor]
 * @param {number} [busOptionsData.pollIntervalMs]
 * @param {number} [busOptionsData.batchSize]
 * @param {{record: (diagnosticData: Record<string, unknown>) => void}} [busOptionsData.diagnostics]
 */
export function layerDatabaseEventBusCreate( busOptionsData ){
    const pollIntervalMsData = busOptionsData.pollIntervalMs ?? Number( 250 );
    const batchSizeData = busOptionsData.batchSize ?? Number( 100 );
    const initialCursorData = busOptionsData.cursor ?? 'latest';

    if ( typeof busOptionsData.database?.query !== 'function' ){
        throw new TypeError( 'Database event bus requires a query-capable database.' );

    }

    if (
        Number.isInteger( pollIntervalMsData ) === false ||
        Number( pollIntervalMsData ) < Number( 50 ) ||
        Number( pollIntervalMsData ) > Number( 60000 ) ||
        Number.isInteger( batchSizeData ) === false ||
        Number( batchSizeData ) < Number( 1 ) ||
        Number( batchSizeData ) > Number( 1000 ) ||
        (
            initialCursorData !== 'latest' &&
            (Number.isSafeInteger( initialCursorData ) === false || Number( initialCursorData ) < Number( 0 ))
        )
    ){
        throw new TypeError( 'Database event bus bounds are invalid.' );

    }

    const outboxTableData = layerSystemTableReferenceCreate( busOptionsData.database, 'sys_outbox' );
    let cursorData = Number( 0 );
    let listenerData = /** @type {((routingData: {eventId: string, tenantKey: string, channel: string}) => void | Promise<void>) | null} */ (null);
    let pollTimerData = /** @type {NodeJS.Timeout | null} */ (null);
    let pollPromiseData = /** @type {Promise<number> | null} */ (null);
    let startedStatusData = false;

    const pollExecuteData = async function(){
        if ( startedStatusData === false || listenerData === null ){
            return Number( 0 );

        }

        const outboxResultData = await busOptionsData.database.query({
            text: `
                SELECT outbox_id, payload
                FROM ${String( outboxTableData )}
                WHERE outbox_id > $1
                ORDER BY outbox_id ASC
                LIMIT $2
            `,
            values: [
                cursorData,
                batchSizeData
            ]
        });
        let deliveredCountData = Number( 0 );

        for ( const outboxRowData of outboxResultData.rows ){
            const outboxIdentifierData = Number( outboxRowData.outbox_id );

            if ( Number.isSafeInteger( outboxIdentifierData ) === false || Number( outboxIdentifierData ) <= Number( cursorData ) ){
                throw new Error( 'Database event cursor is invalid.' );

            }

            const normalizedRoutingData = routingDataNormalize( outboxRowData.payload );

            if ( normalizedRoutingData === null ){
                cursorData = outboxIdentifierData;
                busOptionsData.diagnostics?.record({
                    level: 'error',
                    event: 'database.event-bus.invalid-route',
                    code: 'INVALID_EVENT_ROUTE'
                });
                continue;

            }

            await listenerData( normalizedRoutingData );
            cursorData = outboxIdentifierData;
            deliveredCountData += Number( 1 );

        }

        return deliveredCountData;

    };

    const pollScheduleData = function(){
        if ( startedStatusData === false || pollPromiseData !== null ){
            return;

        }

        pollPromiseData = pollExecuteData().catch(function databaseEventPollFailure( pollErrorData ){
            let diagnosticCodeData = String( 'DEPENDENCY_UNAVAILABLE' );

            if ( typeof pollErrorData === 'object' && pollErrorData !== null && 'code' in pollErrorData ){
                diagnosticCodeData = String( pollErrorData.code );

            }

            busOptionsData.diagnostics?.record({
                level: 'warning',
                event: 'database.event-bus.poll-failed',
                code: diagnosticCodeData
            });

            return Number( 0 );

        }).finally(function databaseEventPollComplete(){
            pollPromiseData = null;

        });

    };

    return Object.freeze({
        /**
         * @param {(routingData: {eventId: string, tenantKey: string, channel: string}) => void | Promise<void>} nextListenerData
         */
        async start( nextListenerData ){
            if ( startedStatusData === true || typeof nextListenerData !== 'function' ){
                throw new Error( 'The database event bus cannot be started in its current state.' );

            }

            if ( initialCursorData === 'latest' ){
                const cursorResultData = await busOptionsData.database.query({
                    text: `SELECT COALESCE(MAX(outbox_id), 0) AS cursor FROM ${String( outboxTableData )}`,
                    values: []
                });
                cursorData = Number( cursorResultData.rows[0]?.cursor ?? Number( 0 ) );

            } else {
                cursorData = Number( initialCursorData );

            }

            if ( Number.isSafeInteger( cursorData ) === false || Number( cursorData ) < Number( 0 ) ){
                throw new Error( 'Database event cursor is invalid.' );

            }

            listenerData = nextListenerData;
            startedStatusData = true;
            pollTimerData = setInterval( pollScheduleData, pollIntervalMsData );
            pollTimerData.unref();

        },

        /** @param {{eventId: string, tenantKey: string, channel: string}} routingData */
        async publish( routingData ){
            const normalizedRoutingData = routingDataNormalize( routingData );

            if ( normalizedRoutingData === null ){
                throw new TypeError( 'Database event routing data is invalid.' );

            }

            if ( startedStatusData === false || listenerData === null ){
                throw new Error( 'The database event bus is not ready.' );

            }

            await listenerData( normalizedRoutingData );

        },

        async synchronize(){
            if ( pollPromiseData !== null ){
                return pollPromiseData;

            }

            pollPromiseData = pollExecuteData().finally(function manualPollComplete(){
                pollPromiseData = null;

            });

            return pollPromiseData;

        },

        async stop(){
            if ( startedStatusData === false ){
                return;

            }

            startedStatusData = false;

            if ( pollTimerData !== null ){
                clearInterval( pollTimerData );
                pollTimerData = null;

            }

            await pollPromiseData;
            listenerData = null;

        },

        isReady(){
            return startedStatusData;

        },

        cursorGet(){
            return cursorData;

        }
    });

}
