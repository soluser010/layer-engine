import {layerSystemTableReferenceCreate} from '@solcorp/layer-database';

/**
 * @param {object} repositoryOptions
 * @param {{query: Function, transaction: Function}} repositoryOptions.database
 */
export function layerOutboxRepositoryCreate(repositoryOptions) {
    //Getting the app-specific durable outbox table before worker coordination
    const outboxTableReferenceData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_outbox' );

    return Object.freeze({
        /**
         * @param {{owner: string, limit: number, leaseMs: number}} claimData
         */
        async claim(claimData) {
            //Claiming a bounded batch atomically so workers do not publish it concurrently.
            return repositoryOptions.database.transaction(async function outboxBatchClaim(
                /** @type {{query: Function}} */ transactionClient
            ) {
                //Locking only currently publishable rows for this bounded worker lease.
                const claimResult = await transactionClient.query({
                    text: `
                        WITH claimable AS (
                            SELECT outbox_id
                            FROM ${String( outboxTableReferenceData )}
                            WHERE published_at IS NULL
                                AND (lease_until IS NULL OR lease_until < now())
                            ORDER BY outbox_id ASC
                            FOR UPDATE SKIP LOCKED
                            LIMIT $2
                        )
                        UPDATE ${String( outboxTableReferenceData )} AS outbox
                        SET
                            lease_owner = $1,
                            lease_until = now() + ($3::bigint * interval '1 millisecond'),
                            attempts = attempts + 1,
                            last_error = NULL
                        FROM claimable
                        WHERE outbox.outbox_id = claimable.outbox_id
                        RETURNING outbox.outbox_id, outbox.event_id, outbox.payload, outbox.attempts
                    `,
                    values: [
                        claimData.owner,
                        claimData.limit,
                        claimData.leaseMs
                    ]
                });

                return claimResult.rows;

            });

        },

        /**
         * @param {string} owner
         * @param {number} outboxIdentifier
         */
        async markPublished(owner, outboxIdentifier) {
            //Completing only a lease still owned by this publisher instance.
            await repositoryOptions.database.query({
                text: `
                    UPDATE ${String( outboxTableReferenceData )}
                    SET published_at = now(), lease_owner = NULL, lease_until = NULL, last_error = NULL
                    WHERE outbox_id = $1 AND lease_owner = $2 AND published_at IS NULL
                `,
                values: [
                    outboxIdentifier,
                    owner
                ]
            });

        },

        /**
         * @param {string} owner
         * @param {number} outboxIdentifier
         * @param {unknown} publishError
         */
        async releaseFailed(owner, outboxIdentifier, publishError) {
            let failureMessage = 'Unknown publish failure.';

            //Recording a bounded non-sensitive failure message for operations.
            if (publishError instanceof Error) {
                failureMessage = publishError.message.slice(0, 500);

            }

            await repositoryOptions.database.query({
                text: `
                    UPDATE ${String( outboxTableReferenceData )}
                    SET lease_owner = NULL, lease_until = NULL, last_error = $3
                    WHERE outbox_id = $1 AND lease_owner = $2 AND published_at IS NULL
                `,
                values: [
                    outboxIdentifier,
                    owner,
                    failureMessage
                ]
            });

        }
    });

}
