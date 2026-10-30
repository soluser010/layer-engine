/**
 * @param {object} distributionOptions
 * @param {{start: Function, stop: Function}} distributionOptions.eventBus
 * @param {{findById: Function}} distributionOptions.eventRepository
 * @param {{dispatch: Function}} distributionOptions.streamManager
 * @param {{record: (diagnosticData: Record<string, unknown>) => void}} distributionOptions.diagnostics
 */
export function layerEventDistributionCreate(distributionOptions) {
    let startedStatus = false;

    return Object.freeze({
        async start() {
            //Preventing duplicate Redis subscriptions for one worker.
            if (startedStatus) {
                throw new Error('Event distribution is already started.');

            }

            await distributionOptions.eventBus.start(async function routedEventLoad(
                /** @type {{eventId: string, tenantKey: string, channel: string}} */ routingData
            ) {
                //Loading the confirmed event payload from PostgreSQL, never Redis.
                const eventData = await distributionOptions.eventRepository.findById(
                    routingData.tenantKey,
                    routingData.eventId
                );

                if (eventData === null) {
                    distributionOptions.diagnostics.record({
                        level: 'error',
                        event: 'event-distribution.missing-event',
                        code: 'EVENT_NOT_FOUND'
                    });

                    return;

                }

                distributionOptions.streamManager.dispatch(routingData.tenantKey, eventData);

            });
            startedStatus = true;

        },

        async stop() {
            //Making worker shutdown idempotent for repeated lifecycle signals.
            if (!startedStatus) {
                return;

            }

            startedStatus = false;
            await distributionOptions.eventBus.stop();

        },

        isReady() {
            //Reporting whether this worker currently receives Redis fan-out.
            return startedStatus;

        }
    });

}
