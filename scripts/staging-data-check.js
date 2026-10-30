import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
    layerDatabaseMigrate,
    layerPostgresDatabaseCreate
} from '@solcorp/layer-database';
import {
    layerEventRepositoryCreate,
    layerOutboxPublisherCreate,
    layerOutboxRepositoryCreate,
    layerRedisEventBusCreate
} from '@solcorp/layer-events';

const stagingTenantKey = 'layer-staging-rehearsal';
const stagingChannel = 'staging';
const stagingEventType = 'staging.rehearsal.completed';

/**
 * @param {string} variableName
 * @returns {string}
 */
function environmentValueRequire(variableName) {
    const environmentValue = process.env[variableName];

    //Rejecting missing infrastructure configuration without printing secrets.
    if (typeof environmentValue !== 'string' || environmentValue.length === 0) {
        throw new Error(`${variableName} is required.`);

    }

    return environmentValue;

}

/**
 * @param {Promise<unknown>} operationPromise
 * @param {number} timeoutMs
 * @returns {Promise<unknown>}
 */
function operationWithinTimeout(operationPromise, timeoutMs) {
    return new Promise(function timeoutPromiseCreate(resolve, reject) {
        const timeoutIdentifier = setTimeout(function operationTimeoutHandle() {
            //Failing a stalled integration boundary with a stable diagnostic.
            reject(new Error('The staging operation timed out.'));

        }, timeoutMs);

        operationPromise.then(function operationResolve(operationResult) {
            //Completing the boundary before its timeout can reject.
            clearTimeout(timeoutIdentifier);
            resolve(operationResult);

        }, function operationReject(operationError) {
            //Preserving the original boundary failure after cancelling the timer.
            clearTimeout(timeoutIdentifier);
            reject(operationError);

        });

    });

}

/**
 * @param {{query: Function}} database
 */
async function databaseStateRead(database) {
    const versionResult = await database.query({
        text: 'SHOW server_version',
        values: []
    });
    const migrationResult = await database.query({
        text: 'SELECT version FROM layer_engine.migrations ORDER BY version ASC',
        values: []
    });
    const eventResult = await database.query({
        text: `
            SELECT event_id, sequence
            FROM layer_engine.domain_events
            WHERE tenant_key = $1 AND channel = $2 AND type = $3
            ORDER BY sequence ASC
        `,
        values: [
            stagingTenantKey,
            stagingChannel,
            stagingEventType
        ]
    });
    const unpublishedResult = await database.query({
        text: `
            SELECT COUNT(*)::integer AS count
            FROM layer_engine.outbox AS outbox
            JOIN layer_engine.domain_events AS events ON events.event_id = outbox.event_id
            WHERE events.tenant_key = $1 AND events.channel = $2 AND outbox.published_at IS NULL
        `,
        values: [
            stagingTenantKey,
            stagingChannel
        ]
    });

    return Object.freeze({
        postgresVersion: String(versionResult.rows[0]?.server_version),
        migrationVersions: Object.freeze(migrationResult.rows.map(function migrationVersionRead(
            /** @type {Record<string, unknown>} */ migrationRow
        ) {
            //Normalizing PostgreSQL integer output for the release record.
            return Number(migrationRow.version);

        })),
        eventRows: Object.freeze(eventResult.rows.map(function eventRowCopy(
            /** @type {Record<string, unknown>} */ eventRow
        ) {
            //Copying only stable identifiers needed by restore verification.
            return Object.freeze({
                eventId: String(eventRow.event_id),
                sequence: Number(eventRow.sequence)
            });

        })),
        unpublishedCount: Number(unpublishedResult.rows[0]?.count)
    });

}

/**
 * @param {ReturnType<typeof layerPostgresDatabaseCreate>} database
 */
async function restoredStateVerify(database) {
    const stateBeforeVerification = await databaseStateRead(database);

    //Proving that restore retained exact migration metadata before any migration call.
    assert.deepEqual(stateBeforeVerification.migrationVersions, [1, 2, 3]);
    assert.ok(stateBeforeVerification.eventRows.length >= 1);
    assert.equal(stateBeforeVerification.unpublishedCount, 0);

    const newlyAppliedVersions = await layerDatabaseMigrate(database);

    //Rechecking immutable migration names and checksums without changing restored state.
    assert.deepEqual(newlyAppliedVersions, []);

    const eventRepository = layerEventRepositoryCreate({database});
    const replayResult = await eventRepository.replay({
        tenantKey: stagingTenantKey,
        channels: [stagingChannel],
        cursor: {
            [stagingChannel]: 0
        },
        limit: 100
    });

    //Confirming durable journal replay without relying on Redis state.
    assert.ok(replayResult.events.some(function restoredEventFind(eventData) {
        //Selecting the durable rehearsal event from the replay page.
        return eventData.type === stagingEventType;

    }));

    return Object.freeze({
        mode: 'verify-restore',
        postgresVersion: stateBeforeVerification.postgresVersion,
        migrationVersions: stateBeforeVerification.migrationVersions,
        restoredEvents: stateBeforeVerification.eventRows.length,
        replayedEvents: replayResult.events.length,
        unpublishedOutboxRows: stateBeforeVerification.unpublishedCount
    });

}

/**
 * @param {ReturnType<typeof layerPostgresDatabaseCreate>} database
 * @param {string} redisUrl
 */
async function infrastructureExercise(database, redisUrl) {
    await layerDatabaseMigrate(database);
    const repeatedMigrationVersions = await layerDatabaseMigrate(database);

    //Requiring migrations to be idempotent before writing rehearsal data.
    assert.deepEqual(repeatedMigrationVersions, []);

    const eventRepository = layerEventRepositoryCreate({database});
    const outboxRepository = layerOutboxRepositoryCreate({database});
    const eventBus = layerRedisEventBusCreate({
        url: redisUrl,
        namespace: `layer-staging-${randomUUID()}`
    });
    let routingResolve = /** @type {((routingData: unknown) => void) | null} */ (null);
    const routingPromise = new Promise(function routingPromiseCreate(resolve) {
        //Exposing a synchronous resolver to the Redis subscription callback.
        routingResolve = resolve;

    });
    let appendedEvent = /** @type {{eventId: string, sequence: number} | undefined} */ (undefined);

    try {
        await eventBus.start(function eventRoutingHandle(routingData) {
            //Resolving only the event created by this rehearsal.
            if (routingData.eventId === appendedEvent?.eventId) {
                routingResolve?.(routingData);

            }

        });
        appendedEvent = await database.transaction(function stagingEventAppend(transactionClient) {
            //Writing the domain event and outbox row in one PostgreSQL transaction.
            return eventRepository.append(transactionClient, {
                tenantKey: stagingTenantKey,
                channel: stagingChannel,
                entityRevision: Date.now(),
                type: stagingEventType,
                payload: {
                    rehearsalId: randomUUID()
                }
            });

        });

        const publisher = layerOutboxPublisherCreate({
            outboxRepository,
            eventBus,
            owner: `staging-${randomUUID()}`
        });
        const publishResult = await publisher.runOnce();
        const routingData = /** @type {{eventId: string}} */ (
            await operationWithinTimeout(routingPromise, 5000)
        );

        //Checking the transactional outbox and Redis route refer to the same durable event.
        assert.equal(publishResult.failed, 0);
        assert.ok(publishResult.published >= 1);
        assert.equal(routingData.eventId, appendedEvent.eventId);

        const replayResult = await eventRepository.replay({
            tenantKey: stagingTenantKey,
            channels: [stagingChannel],
            cursor: {
                [stagingChannel]: Math.max(0, appendedEvent.sequence - 1)
            },
            limit: 10
        });

        assert.equal(replayResult.events[0]?.eventId, appendedEvent.eventId);

        const databaseState = await databaseStateRead(database);

        assert.deepEqual(databaseState.migrationVersions, [1, 2, 3]);
        assert.equal(databaseState.unpublishedCount, 0);

        return Object.freeze({
            mode: 'exercise',
            postgresVersion: databaseState.postgresVersion,
            migrationVersions: databaseState.migrationVersions,
            eventId: appendedEvent.eventId,
            eventSequence: appendedEvent.sequence,
            publishedEvents: publishResult.published,
            replayedEvents: replayResult.events.length,
            redisReady: eventBus.isReady(),
            unpublishedOutboxRows: databaseState.unpublishedCount
        });

    } finally {
        await eventBus.stop();

    }

}

const modeArgument = process.argv.find(function modeArgumentFind(argumentValue) {
    //Selecting the single explicit check mode without accepting positional secrets.
    return argumentValue.startsWith('--mode=');

});
const checkMode = modeArgument?.slice('--mode='.length) ?? 'exercise';
const databaseUrl = environmentValueRequire('LAYER_STAGING_DATABASE_URL');
const database = layerPostgresDatabaseCreate({
    connectionString: databaseUrl,
    applicationName: 'layer-engine-staging-check'
});

if (checkMode !== 'exercise' && checkMode !== 'verify-restore') {
    throw new Error('Staging check mode must be exercise or verify-restore.');

}

try {
    await database.connect();
    let checkResult;

    //Running only the infrastructure path selected by the release operator.
    if (checkMode === 'exercise') {
        checkResult = await infrastructureExercise(database, environmentValueRequire('LAYER_STAGING_REDIS_URL'));

    } else {
        checkResult = await restoredStateVerify(database);

    }

    process.stdout.write(`${JSON.stringify(checkResult, null, 4)}\n`);

} finally {
    await database.close();

}
