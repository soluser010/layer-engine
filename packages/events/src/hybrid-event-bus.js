/**
 * @typedef {Readonly<{
 *     start: (listenerData: (routingData: {eventId: string, tenantKey: string, channel: string}) => void | Promise<void>) => Promise<void>,
 *     publish: (routingData: {eventId: string, tenantKey: string, channel: string}) => Promise<void>,
 *     stop: () => Promise<void>,
 *     isReady: () => boolean
 * }>} LayerEventBus
 */

/**
 * @param {object} busOptionsData
 * @param {LayerEventBus} busOptionsData.fallback
 * @param {LayerEventBus | null} [busOptionsData.primary]
 * @param {{record: (diagnosticData: Record<string, unknown>) => void}} [busOptionsData.diagnostics]
 */
export function layerHybridEventBusCreate( busOptionsData ){
    const primaryBusData = busOptionsData.primary ?? null;
    let startedStatusData = false;

    if (
        typeof busOptionsData.fallback?.start !== 'function' ||
        typeof busOptionsData.fallback?.publish !== 'function' ||
        typeof busOptionsData.fallback?.stop !== 'function' ||
        typeof busOptionsData.fallback?.isReady !== 'function'
    ){
        throw new TypeError( 'Hybrid event bus requires a durable fallback.' );

    }

    return Object.freeze({
        /** @param {(routingData: {eventId: string, tenantKey: string, channel: string}) => void | Promise<void>} listenerData */
        async start( listenerData ){
            if ( startedStatusData === true ){
                throw new Error( 'The hybrid event bus is already started.' );

            }

            await busOptionsData.fallback.start( listenerData );

            if ( primaryBusData !== null ){
                await primaryBusData.start( listenerData ).catch(function primaryBusStartFailure( startErrorData ){
                    let diagnosticCodeData = String( 'DEPENDENCY_UNAVAILABLE' );

                    if ( typeof startErrorData === 'object' && startErrorData !== null && 'code' in startErrorData ){
                        diagnosticCodeData = String( startErrorData.code );

                    }

                    busOptionsData.diagnostics?.record({
                        level: 'warning',
                        event: 'event-bus.primary-unavailable',
                        code: diagnosticCodeData
                    });

                });

            }

            startedStatusData = true;

        },

        /** @param {{eventId: string, tenantKey: string, channel: string}} routingData */
        async publish( routingData ){
            if ( startedStatusData === false ){
                throw new Error( 'The hybrid event bus is not ready.' );

            }

            await busOptionsData.fallback.publish( routingData );

            if ( primaryBusData !== null && primaryBusData.isReady() === true ){
                await primaryBusData.publish( routingData ).catch(function primaryPublishFailure( publishErrorData ){
                    let diagnosticCodeData = String( 'DEPENDENCY_UNAVAILABLE' );

                    if ( typeof publishErrorData === 'object' && publishErrorData !== null && 'code' in publishErrorData ){
                        diagnosticCodeData = String( publishErrorData.code );

                    }

                    busOptionsData.diagnostics?.record({
                        level: 'warning',
                        event: 'event-bus.primary-publish-failed',
                        code: diagnosticCodeData
                    });

                });

            }

        },

        async stop(){
            if ( startedStatusData === false ){
                return;

            }

            startedStatusData = false;
            const shutdownTasksData = [busOptionsData.fallback.stop()];

            if ( primaryBusData !== null ){
                shutdownTasksData.push( primaryBusData.stop() );

            }

            await Promise.allSettled( shutdownTasksData );

        },

        isReady(){
            return startedStatusData === true && busOptionsData.fallback.isReady() === true;

        },

        isAccelerated(){
            return primaryBusData !== null && primaryBusData.isReady() === true;

        }
    });

}
