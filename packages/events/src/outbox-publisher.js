/**
 * @param {object} publisherOptions
 * @param {{claim: Function, markPublished: Function, releaseFailed: Function}} publisherOptions.outboxRepository
 * @param {{publish: Function}} publisherOptions.eventBus
 * @param {string} publisherOptions.owner
 * @param {number} [publisherOptions.batchSize]
 * @param {number} [publisherOptions.leaseMs]
 */
export function layerOutboxPublisherCreate(publisherOptions) {
    const batchSize = publisherOptions.batchSize ?? 50;
    const leaseMs = publisherOptions.leaseMs ?? 30000;

    //Checking bounded publisher configuration before claiming durable work.
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500 ||
        !Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300000) {
        throw new TypeError('Outbox publisher bounds are invalid.');

    }

    return Object.freeze({
        async runOnce() {
            const claimedRows = await publisherOptions.outboxRepository.claim({
                owner: publisherOptions.owner,
                limit: batchSize,
                leaseMs
            });
            let publishedCount = 0;
            let failedCount = 0;

            //Publishing routing metadata and completing each lease independently.
            for (const outboxRow of claimedRows) {
                const outboxIdentifier = Number(outboxRow.outbox_id);

                try {
                    const routingData = /** @type {{eventId: string, tenantKey: string, channel: string}} */ (outboxRow.payload);

                    await publisherOptions.eventBus.publish(routingData);
                    await publisherOptions.outboxRepository.markPublished(
                        publisherOptions.owner,
                        outboxIdentifier
                    );
                    publishedCount += 1;

                } catch (publishError) {
                    await publisherOptions.outboxRepository.releaseFailed(
                        publisherOptions.owner,
                        outboxIdentifier,
                        publishError
                    );
                    failedCount += 1;

                }

            }

            return Object.freeze({
                claimed: claimedRows.length,
                published: publishedCount,
                failed: failedCount
            });

        }
    });

}
