import {randomUUID} from 'node:crypto';
import {layerSystemTableReferenceCreate} from '@solcorp/layer-database';
import {
    LAYER_ERROR_CODES,
    LayerError,
    layerProtocolValidatorCreate
} from '@solcorp/layer-protocol';

/**
 * @typedef {{query: (queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, unknown>[], rowCount: number | null}>}} LayerEventQueryTarget
 */

/**
 * @param {Record<string, unknown>} eventRow
 */
function eventRowNormalize(eventRow) {
    //Mapping SQL values to the stable public domain-event contract.
    return {
        eventId: String(eventRow.event_id),
        channel: String(eventRow.channel),
        sequence: Number(eventRow.sequence),
        entityRevision: Number(eventRow.entity_revision),
        type: String(eventRow.type),
        payload: /** @type {Record<string, unknown>} */ (eventRow.payload),
        occurredAt: new Date(/** @type {string | number | Date} */ (eventRow.occurred_at)).toISOString()
    };

}

/**
 * @param {object} repositoryOptions
 * @param {LayerEventQueryTarget} repositoryOptions.database
 * @param {() => string} [repositoryOptions.eventIdCreate]
 * @param {() => Date} [repositoryOptions.clock]
 */
export function layerEventRepositoryCreate(repositoryOptions) {
    const eventIdCreate = repositoryOptions.eventIdCreate ?? randomUUID;
    const clock = repositoryOptions.clock ?? function eventClockRead() {
        //Providing a UTC timestamp for newly committed domain events.
        return new Date();

    };
    const protocolValidator = layerProtocolValidatorCreate();
    const domainEventsTableReferenceData = layerSystemTableReferenceCreate(
        repositoryOptions.database,
        'sys_domain_events'
    );

    return Object.freeze({
        /**
         * @param {LayerEventQueryTarget} transactionClient
         * @param {{tenantKey: string, channel: string, entityRevision: number, type: string, payload: Record<string, unknown>}} eventData
         */
        async append(transactionClient, eventData) {
            const sequenceLockKey = `${eventData.tenantKey}:${eventData.channel}`;
            const transactionEventsTableReferenceData = layerSystemTableReferenceCreate(
                transactionClient,
                'sys_domain_events'
            );
            const transactionOutboxTableReferenceData = layerSystemTableReferenceCreate(
                transactionClient,
                'sys_outbox'
            );

            //Serializing sequence allocation inside the caller's domain transaction.
            await transactionClient.query({
                text: 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
                values: [sequenceLockKey]
            });

            const sequenceResult = await transactionClient.query({
                text: `
                    SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
                    FROM ${String( transactionEventsTableReferenceData )}
                    WHERE tenant_key = $1 AND channel = $2
                `,
                values: [
                    eventData.tenantKey,
                    eventData.channel
                ]
            });
            const eventRecord = {
                eventId: eventIdCreate(),
                channel: eventData.channel,
                sequence: Number(sequenceResult.rows[0]?.next_sequence),
                entityRevision: eventData.entityRevision,
                type: eventData.type,
                payload: eventData.payload,
                occurredAt: clock().toISOString()
            };
            const validationResult = protocolValidator.eventValidate(eventRecord);

            //Rejecting invalid application events before writing durable state.
            if (!validationResult.valid) {
                throw new LayerError(
                    LAYER_ERROR_CODES.INVALID_PAYLOAD,
                    'The domain event is invalid.',
                    {
                        status: 500
                    }
                );

            }

            await transactionClient.query({
                text: `
                    INSERT INTO ${String( transactionEventsTableReferenceData )} (
                        event_id,
                        tenant_key,
                        channel,
                        sequence,
                        entity_revision,
                        type,
                        payload,
                        occurred_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
                `,
                values: [
                    eventRecord.eventId,
                    eventData.tenantKey,
                    eventRecord.channel,
                    eventRecord.sequence,
                    eventRecord.entityRevision,
                    eventRecord.type,
                    JSON.stringify(eventRecord.payload),
                    eventRecord.occurredAt
                ]
            });
            await transactionClient.query({
                text: `
                    INSERT INTO ${String( transactionOutboxTableReferenceData )} (event_id, payload)
                    VALUES ($1, $2::jsonb)
                `,
                values: [
                    eventRecord.eventId,
                    JSON.stringify({
                        eventId: eventRecord.eventId,
                        tenantKey: eventData.tenantKey,
                        channel: eventRecord.channel
                    })
                ]
            });

            return Object.freeze(eventRecord);

        },

        /**
         * @param {{tenantKey: string, channels: readonly string[], cursor: Readonly<Record<string, number>>, limit: number}} replayData
         */
        async replay(replayData) {
            const cursorData = /** @type {Record<string, number>} */ ({});

            //Building a complete bounded cursor for every authorized channel.
            for (const channelName of replayData.channels) {
                const channelCursor = replayData.cursor[channelName] ?? 0;

                if (!Number.isSafeInteger(channelCursor) || channelCursor < 0) {
                    throw new LayerError(LAYER_ERROR_CODES.INVALID_PAYLOAD, 'An event cursor is invalid.', {
                        status: 400
                    });

                }

                cursorData[channelName] = channelCursor;

            }

            const cursorJson = JSON.stringify(cursorData);
            const oldestSequenceResult = await repositoryOptions.database.query({
                text: `
                    WITH requested AS (
                        SELECT key AS channel, value::bigint AS sequence
                        FROM jsonb_each_text($2::jsonb)
                    )
                    SELECT requested.channel, requested.sequence AS cursor_sequence, MIN(events.sequence) AS oldest_sequence
                    FROM requested
                    LEFT JOIN ${String( domainEventsTableReferenceData )} AS events
                        ON events.tenant_key = $1 AND events.channel = requested.channel
                    GROUP BY requested.channel, requested.sequence
                `,
                values: [
                    replayData.tenantKey,
                    cursorJson
                ]
            });
            const expiredChannels = [];

            //Detecting retention gaps before returning a misleading partial replay.
            for (const sequenceRow of oldestSequenceResult.rows) {
                const cursorSequence = Number(sequenceRow.cursor_sequence);
                let oldestSequence = /** @type {number | null} */ (null);

                //Keeping an absent channel distinct from its first retained sequence.
                if (sequenceRow.oldest_sequence !== null) {
                    oldestSequence = Number(sequenceRow.oldest_sequence);

                }

                if (oldestSequence !== null && cursorSequence < oldestSequence - 1) {
                    expiredChannels.push(String(sequenceRow.channel));

                }

            }

            if (expiredChannels.length > 0) {
                throw new LayerError(LAYER_ERROR_CODES.CURSOR_EXPIRED, 'The event cursor requires a snapshot.', {
                    details: {
                        channels: expiredChannels
                    },
                    status: 409
                });

            }

            const replayResult = await repositoryOptions.database.query({
                text: `
                    WITH requested AS (
                        SELECT key AS channel, value::bigint AS sequence
                        FROM jsonb_each_text($2::jsonb)
                    )
                    SELECT
                        events.event_id,
                        events.channel,
                        events.sequence,
                        events.entity_revision,
                        events.type,
                        events.payload,
                        events.occurred_at
                    FROM requested
                    JOIN ${String( domainEventsTableReferenceData )} AS events
                        ON events.tenant_key = $1
                        AND events.channel = requested.channel
                        AND events.sequence > requested.sequence
                    ORDER BY events.occurred_at ASC, events.channel ASC, events.sequence ASC
                    LIMIT $3
                `,
                values: [
                    replayData.tenantKey,
                    cursorJson,
                    replayData.limit + 1
                ]
            });
            const hasMore = replayResult.rows.length > replayData.limit;
            const eventRecords = [];

            //Normalizing and validating only the requested replay page.
            for (const eventRow of replayResult.rows.slice(0, replayData.limit)) {
                const eventRecord = eventRowNormalize(eventRow);

                if (!protocolValidator.eventValidate(eventRecord).valid) {
                    throw new LayerError(LAYER_ERROR_CODES.INTERNAL_ERROR, 'A stored domain event is invalid.', {
                        status: 500
                    });

                }

                eventRecords.push(Object.freeze(eventRecord));

            }

            return Object.freeze({
                events: Object.freeze(eventRecords),
                hasMore
            });

        },

        /**
         * @param {string} tenantKey
         * @param {string} eventIdentifier
         */
        async findById(tenantKey, eventIdentifier) {
            const eventResult = await repositoryOptions.database.query({
                text: `
                    SELECT event_id, channel, sequence, entity_revision, type, payload, occurred_at
                    FROM ${String( domainEventsTableReferenceData )}
                    WHERE tenant_key = $1 AND event_id = $2
                    LIMIT 1
                `,
                values: [
                    tenantKey,
                    eventIdentifier
                ]
            });
            const eventRow = eventResult.rows[0];

            //Returning an explicit miss for duplicate or stale Redis notifications.
            if (eventRow === undefined) {
                return null;

            }

            const eventRecord = eventRowNormalize(eventRow);

            if (!protocolValidator.eventValidate(eventRecord).valid) {
                throw new LayerError(LAYER_ERROR_CODES.INTERNAL_ERROR, 'A stored domain event is invalid.', {
                    status: 500
                });

            }

            return Object.freeze(eventRecord);

        }
    });

}
