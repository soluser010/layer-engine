import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';
import {
    layerCacheInvalidationSynchronizerCreate,
    layerDatabaseEventBusCreate,
    layerControlFrameCreate,
    layerEventDistributionCreate,
    layerEventFrameCreate,
    layerEventRepositoryCreate,
    layerEventStreamManagerCreate,
    layerEventsOpenOperationDefinitionCreate,
    layerHeartbeatFrameCreate,
    layerHybridEventBusCreate,
    layerOutboxPublisherCreate,
    layerOutboxRepositoryCreate,
    layerRedisCoordinationCreate,
    layerRedisEventBusCreate,
    layerRedisQueryCacheCreate
} from '../src/index.js';

const occurredAt = '2026-09-18T09:00:00.000Z';

/**
 * @param {number} sequence
 * @param {Record<string, unknown>} [overrideData]
 */
function eventDataCreate(sequence, overrideData = {}) {
    return {
        eventId: `event-${sequence}`,
        channel: 'conversation:1',
        sequence,
        entityRevision: sequence,
        type: 'chat.message.created',
        payload: {
            messageId: `message-${sequence}`
        },
        occurredAt,
        ...overrideData
    };
}

/**
 * @param {ReturnType<typeof eventDataCreate>} eventData
 */
function eventRowCreate(eventData) {
    return {
        event_id: eventData.eventId,
        channel: eventData.channel,
        sequence: eventData.sequence,
        entity_revision: eventData.entityRevision,
        type: eventData.type,
        payload: eventData.payload,
        occurred_at: eventData.occurredAt
    };
}

class FakeResponse extends EventEmitter {
    constructor() {
        super();
        this.frames = /** @type {string[]} */ ([]);
        this.headers = /** @type {Record<string, string>} */ ({});
        this.statusCode = 0;
        this.ended = false;
        this.destroyed = false;
        this.flushCount = 0;
        this.backpressureOnce = false;
    }

    /**
     * @param {number} statusCode
     * @param {Record<string, string>} headersData
     */
    writeHead(statusCode, headersData) {
        this.statusCode = statusCode;
        this.headers = headersData;
    }

    flushHeaders() {
        this.flushCount += 1;
    }

    /**
     * @param {string} frameData
     */
    write(frameData) {
        this.frames.push(frameData);

        if (this.backpressureOnce) {
            this.backpressureOnce = false;
            queueMicrotask(() => this.emit('drain'));

            return false;
        }

        return true;
    }

    end() {
        if (!this.ended) {
            this.ended = true;
            this.emit('close');
        }
    }

    destroy() {
        this.destroyed = true;
        this.end();
    }
}

test('event repository appends journal and outbox in the caller transaction', async () => {
    const queryCalls = /** @type {any[]} */ ([]);
    const transactionClient = {
        async query(/** @type {any} */ queryData) {
            queryCalls.push(queryData);

            if (queryData.text.includes('next_sequence')) {
                return {
                    rows: [
                        {
                            next_sequence: '7'
                        }
                    ],
                    rowCount: 1
                };
            }

            return {
                rows: [],
                rowCount: 1
            };
        }
    };
    const repository = layerEventRepositoryCreate({
        database: transactionClient,
        eventIdCreate: () => 'event-7',
        clock: () => new Date(occurredAt)
    });
    const result = await repository.append(transactionClient, {
        tenantKey: 'tenant-1',
        channel: 'conversation:1',
        entityRevision: 9,
        type: 'chat.message.created',
        payload: {
            messageId: 'message-7'
        }
    });

    assert.equal(result.sequence, 7);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(queryCalls[0].values[0], 'tenant-1:conversation:1');
    assert.ok(queryCalls[2].text.includes('domain_events'));
    assert.ok(queryCalls[3].text.includes('outbox'));
    assert.equal(JSON.parse(queryCalls[3].values[1]).tenantKey, 'tenant-1');

    const invalidRepository = layerEventRepositoryCreate({
        database: transactionClient,
        eventIdCreate: () => '',
        clock: () => new Date(occurredAt)
    });

    await assert.rejects(() => invalidRepository.append(transactionClient, {
        tenantKey: 'tenant-1',
        channel: 'conversation:1',
        entityRevision: 1,
        type: 'chat.message.created',
        payload: {}
    }), (errorData) => /** @type {any} */ (errorData).code === 'INVALID_PAYLOAD');
});

test('event repository replays, detects retention gaps, and loads by id', async () => {
    const eventOne = eventDataCreate(1);
    const eventTwo = eventDataCreate(2);
    const queryResults = [
        {
            rows: [
                {
                    channel: 'conversation:1',
                    cursor_sequence: 0,
                    oldest_sequence: 1
                }
            ],
            rowCount: 1
        },
        {
            rows: [
                eventRowCreate(eventOne),
                eventRowCreate(eventTwo)
            ],
            rowCount: 2
        },
        {
            rows: [
                eventRowCreate(eventTwo)
            ],
            rowCount: 1
        }
    ];
    const database = {
        async query() {
            return /** @type {any} */ (queryResults.shift());
        }
    };
    const repository = layerEventRepositoryCreate({database});
    const replayResult = await repository.replay({
        tenantKey: 'tenant-1',
        channels: [
            'conversation:1'
        ],
        cursor: {
            'conversation:1': 0
        },
        limit: 1
    });

    assert.equal(replayResult.hasMore, true);
    assert.deepEqual(replayResult.events, [
        eventOne
    ]);
    assert.deepEqual(await repository.findById('tenant-1', 'event-2'), eventTwo);

    const expiredRepository = layerEventRepositoryCreate({
        database: {
            async query() {
                return {
                    rows: [
                        {
                            channel: 'conversation:1',
                            cursor_sequence: 1,
                            oldest_sequence: 4
                        }
                    ],
                    rowCount: 1
                };
            }
        }
    });

    await assert.rejects(() => expiredRepository.replay({
        tenantKey: 'tenant-1',
        channels: [
            'conversation:1'
        ],
        cursor: {
            'conversation:1': 1
        },
        limit: 10
    }), (errorData) => /** @type {any} */ (errorData).code === 'CURSOR_EXPIRED');
    await assert.rejects(() => expiredRepository.replay({
        tenantKey: 'tenant-1',
        channels: [
            'conversation:1'
        ],
        cursor: {
            'conversation:1': -1
        },
        limit: 10
    }), (errorData) => /** @type {any} */ (errorData).code === 'INVALID_PAYLOAD');
});

test('outbox repository and publisher preserve leases across success and failure', async () => {
    const queryCalls = /** @type {any[]} */ ([]);
    const database = {
        async transaction(/** @type {Function} */ transactionHandler) {
            return transactionHandler({
                async query(/** @type {any} */ queryData) {
                    queryCalls.push(queryData);

                    return {
                        rows: [
                            {
                                outbox_id: 11,
                                payload: {
                                    eventId: 'event-1',
                                    tenantKey: 'tenant-1',
                                    channel: 'conversation:1'
                                }
                            },
                            {
                                outbox_id: 12,
                                payload: {
                                    eventId: 'event-2',
                                    tenantKey: 'tenant-1',
                                    channel: 'conversation:1'
                                }
                            }
                        ],
                        rowCount: 2
                    };
                }
            });
        },
        async query(/** @type {any} */ queryData) {
            queryCalls.push(queryData);

            return {
                rows: [],
                rowCount: 1
            };
        }
    };
    const repository = layerOutboxRepositoryCreate({database});
    let publishCount = 0;
    const publisher = layerOutboxPublisherCreate({
        outboxRepository: repository,
        eventBus: {
            async publish() {
                publishCount += 1;

                if (publishCount === 2) {
                    throw new Error('redis unavailable');
                }
            }
        },
        owner: 'worker-1',
        batchSize: 2,
        leaseMs: 5000
    });

    assert.deepEqual(await publisher.runOnce(), {
        claimed: 2,
        published: 1,
        failed: 1
    });
    assert.deepEqual(queryCalls[0].values, [
        'worker-1',
        2,
        5000
    ]);
    assert.ok(queryCalls[1].text.includes('published_at = now()'));
    assert.equal(queryCalls[2].values[2], 'redis unavailable');
    assert.throws(() => layerOutboxPublisherCreate({
        outboxRepository: repository,
        eventBus: {
            publish() {}
        },
        owner: 'worker-1',
        batchSize: 0
    }), TypeError);
});

test('Redis event bus validates routing and closes both clients', async () => {
    const clients = /** @type {any[]} */ ([]);
    const clientOptionsList = /** @type {Record<string, any>[]} */ ([]);
    let subscriberListener = /** @type {Function | undefined} */ (undefined);
    const publishedMessages = /** @type {{topicName: string, messageData: string}[]} */ ([]);
    const clientCreate = (/** @type {Record<string, any>} */ clientOptions) => {
        const client = {
            async connect() {},
            async quit() {
                client.quitCount += 1;
            },
            on() {},
            async publish(/** @type {string} */ topicName, /** @type {string} */ messageData) {
                publishedMessages.push({topicName, messageData});

                return 1;
            },
            async subscribe(/** @type {string} */ _topicName, /** @type {Function} */ listenerData) {
                subscriberListener = listenerData;
            },
            async unsubscribe() {},
            quitCount: 0
        };

        clientOptionsList.push(clientOptions);
        clients.push(client);

        return client;
    };
    const bus = layerRedisEventBusCreate({
        url: 'redis://private',
        clientCreate
    });
    const routedMessages = [];

    await bus.start((routingData) => {
        routedMessages.push(routingData);
    });
    assert.equal(bus.isReady(), true);
    await bus.publish({
        eventId: 'event-1',
        tenantKey: 'tenant-1',
        channel: 'conversation:1'
    });
    subscriberListener?.(publishedMessages[0]?.messageData ?? '');
    subscriberListener?.('{');
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(routedMessages.length, 1);
    await assert.rejects(() => bus.publish({
        eventId: '',
        tenantKey: 'tenant-1',
        channel: 'conversation:1'
    }), /invalid/);
    await assert.rejects(() => bus.start(() => {}), /already started/);
    await bus.stop();
    await bus.stop();
    assert.equal(bus.isReady(), false);
    const firstClientOptions = clientOptionsList[0];

    assert.ok(firstClientOptions);
    assert.equal(firstClientOptions.RESP, 2);
    assert.equal(firstClientOptions.socket.connectTimeout, 5000);
    assert.equal(firstClientOptions.socket.reconnectStrategy(0), 100);
    assert.match(firstClientOptions.socket.reconnectStrategy(3).message, /exhausted/);
    assert.equal(clients[0].quitCount, 1);
    assert.equal(clients[1].quitCount, 1);
    assert.throws(() => layerRedisEventBusCreate({
        url: 'redis://private',
        connectionTimeoutMs: 99,
        clientCreate
    }), /bounds/);
    assert.throws(() => layerRedisEventBusCreate({
        url: 'redis://private',
        reconnectAttempts: 21,
        clientCreate
    }), /bounds/);
});

test('database event bus polls durable outbox routes with a monotonic cursor', async () => {
    const diagnosticsData = /** @type {any[]} */ ([]);
    const routedMessagesData = /** @type {any[]} */ ([]);
    let pollCountData = Number( 0 );
    const busData = layerDatabaseEventBusCreate({
        database: {
            systemSchema: 'layer_test_application',
            async query( queryData ){
                if ( queryData.text.includes( 'MAX(outbox_id)' ) === true ){
                    return {rows: [{cursor: 5}], rowCount: 1};

                }

                pollCountData += Number( 1 );

                return {
                    rows: [{
                        outbox_id: 6,
                        payload: {
                            eventId: 'event-6',
                            tenantKey: 'tenant-1',
                            channel: 'conversation:1'
                        }
                    }, {
                        outbox_id: 7,
                        payload: '{'
                    }, {
                        outbox_id: 8,
                        payload: {
                            eventId: 'event-8',
                            tenantKey: 'tenant-1',
                            channel: 'conversation:1'
                        }
                    }],
                    rowCount: 3
                };

            }
        },
        pollIntervalMs: 60000,
        diagnostics: {
            record( diagnosticData ){
                diagnosticsData.push( diagnosticData );

            }
        }
    });

    await busData.start(function databaseRouteHandle( routingData ){
        routedMessagesData.push( routingData );

    });

    assert.equal( busData.cursorGet(), 5 );
    assert.equal( await busData.synchronize(), 2 );
    assert.equal( busData.cursorGet(), 8 );
    assert.equal( pollCountData, 1 );
    assert.equal( routedMessagesData.length, 2 );
    assert.equal( diagnosticsData[0].code, 'INVALID_EVENT_ROUTE' );

    await busData.publish({
        eventId: 'event-9',
        tenantKey: 'tenant-1',
        channel: 'conversation:1'
    });
    assert.equal( routedMessagesData.length, 3 );
    await busData.stop();
    assert.equal( busData.isReady(), false );
    await assert.rejects(() => busData.publish({
        eventId: 'event-10',
        tenantKey: 'tenant-1',
        channel: 'conversation:1'
    }), /not ready/);

});

test('database event bus validates bounds, routes, cursors, and lifecycle states', async () => {
    const validDatabaseData = {
        async query(){
            return {rows: [], rowCount: 0};
        }
    };
    const invalidOptionData = [
        {database: {}},
        {database: validDatabaseData, pollIntervalMs: 49},
        {database: validDatabaseData, pollIntervalMs: 60001},
        {database: validDatabaseData, batchSize: 0},
        {database: validDatabaseData, batchSize: 1001},
        {database: validDatabaseData, cursor: -1},
        {database: validDatabaseData, cursor: 0.5}
    ];

    for ( const optionData of invalidOptionData ){
        assert.throws(
            () => layerDatabaseEventBusCreate(/** @type {any} */ (optionData)),
            TypeError
        );

    }

    let queryCountData = Number( 0 );
    const routedMessagesData = /** @type {any[]} */ ([]);
    const busData = layerDatabaseEventBusCreate({
        database: {
            async query(){
                queryCountData += Number( 1 );

                if ( queryCountData === Number( 1 ) ){
                    return {
                        rows: [{
                            outbox_id: 1,
                            payload: JSON.stringify({
                                eventId: 'event-1',
                                tenantKey: 'tenant-1',
                                channel: 'conversation:1'
                            })
                        }],
                        rowCount: 1
                    };

                }

                return {
                    rows: [{
                        outbox_id: 1,
                        payload: {}
                    }],
                    rowCount: 1
                };
            }
        },
        cursor: 0,
        pollIntervalMs: 60000
    });

    await busData.stop();
    assert.equal( await busData.synchronize(), 0 );
    await assert.rejects(() => busData.start(/** @type {any} */ (null)), /cannot be started/);
    await busData.start((routingData) => {
        routedMessagesData.push( routingData );
    });
    await assert.rejects(() => busData.start(() => {}), /cannot be started/);
    assert.equal( await busData.synchronize(), 1 );
    assert.deepEqual( routedMessagesData[0], {
        eventId: 'event-1',
        tenantKey: 'tenant-1',
        channel: 'conversation:1'
    });
    await assert.rejects(() => busData.synchronize(), /cursor is invalid/);

    for ( const routingData of [
        null,
        [],
        '{',
        {},
        {eventId: '', tenantKey: 'tenant-1', channel: 'conversation:1'},
        {eventId: 'event-2', tenantKey: '', channel: 'conversation:1'},
        {eventId: 'event-2', tenantKey: 'tenant-1', channel: 'invalid channel'}
    ] ){
        await assert.rejects(
            () => busData.publish(/** @type {any} */ (routingData)),
            TypeError
        );

    }

    await busData.stop();

    const invalidCursorBusData = layerDatabaseEventBusCreate({
        database: {
            async query(){
                return {rows: [{cursor: -1}], rowCount: 1};
            }
        }
    });
    await assert.rejects(() => invalidCursorBusData.start(() => {}), /cursor is invalid/);
});

test('database event bus records bounded diagnostics for scheduled dependency failure', async () => {
    const diagnosticsData = /** @type {Record<string, unknown>[]} */ ([]);
    const busData = layerDatabaseEventBusCreate({
        database: {
            async query(){
                throw Object.assign( new Error( 'database unavailable' ), {
                    code: 'DATABASE_UNAVAILABLE'
                });
            }
        },
        cursor: 0,
        pollIntervalMs: 50,
        diagnostics: {
            record( diagnosticData ){
                diagnosticsData.push( diagnosticData );
            }
        }
    });

    await busData.start(() => {});
    await new Promise((resolveData) => setTimeout(resolveData, 90));
    assert.deepEqual( diagnosticsData[0], {
        level: 'warning',
        event: 'database.event-bus.poll-failed',
        code: 'DATABASE_UNAVAILABLE'
    });
    await busData.stop();
});

test('hybrid event bus remains ready when Redis startup or publish fails', async () => {
    const diagnosticsData = /** @type {any[]} */ ([]);
    const fallbackRoutesData = /** @type {any[]} */ ([]);
    let fallbackReadyStatusData = false;
    let primaryReadyStatusData = false;
    let codedPublishFailureStatusData = false;
    const fallbackBusData = {
        async start(){
            fallbackReadyStatusData = true;
        },
        async publish( /** @type {any} */ routingData ){
            fallbackRoutesData.push( routingData );
        },
        async stop(){
            fallbackReadyStatusData = false;
        },
        isReady(){
            return fallbackReadyStatusData;
        }
    };
    const failedStartBusData = layerHybridEventBusCreate({
        fallback: fallbackBusData,
        primary: {
            async start(){
                throw Object.assign( new Error( 'Redis unavailable' ), {code: 'REDIS_UNAVAILABLE'} );
            },
            async publish(){},
            async stop(){},
            isReady(){
                return false;
            }
        },
        diagnostics: {
            record( diagnosticData ){
                diagnosticsData.push( diagnosticData );
            }
        }
    });

    await failedStartBusData.start(function routeHandle(){});
    assert.equal( failedStartBusData.isReady(), true );
    assert.equal( failedStartBusData.isAccelerated(), false );
    await failedStartBusData.publish({
        eventId: 'event-1',
        tenantKey: 'tenant-1',
        channel: 'conversation:1'
    });
    assert.equal( fallbackRoutesData.length, 1 );
    assert.equal( diagnosticsData[0].code, 'REDIS_UNAVAILABLE' );
    await failedStartBusData.stop();

    const failedPublishBusData = layerHybridEventBusCreate({
        fallback: fallbackBusData,
        primary: {
            async start(){
                primaryReadyStatusData = true;
            },
            async publish(){
                if ( codedPublishFailureStatusData === true ){
                    throw Object.assign( new Error( 'Redis publish unavailable' ), {
                        code: 'REDIS_PUBLISH_UNAVAILABLE'
                    });

                }

                throw new Error( 'Redis publish failed' );
            },
            async stop(){
                primaryReadyStatusData = false;
            },
            isReady(){
                return primaryReadyStatusData;
            }
        },
        diagnostics: {
            record( diagnosticData ){
                diagnosticsData.push( diagnosticData );
            }
        }
    });

    await failedPublishBusData.start(function routeHandle(){});
    await failedPublishBusData.publish({
        eventId: 'event-2',
        tenantKey: 'tenant-1',
        channel: 'conversation:1'
    });
    assert.equal( fallbackRoutesData.length, 2 );
    assert.equal( diagnosticsData.at( -1 ).event, 'event-bus.primary-publish-failed' );
    codedPublishFailureStatusData = true;
    await failedPublishBusData.publish({
        eventId: 'event-3',
        tenantKey: 'tenant-1',
        channel: 'conversation:1'
    });
    assert.equal( diagnosticsData.at( -1 ).code, 'REDIS_PUBLISH_UNAVAILABLE' );
    await failedPublishBusData.stop();

});

test('hybrid event bus validates fallback and rejects invalid lifecycle transitions', async () => {
    assert.throws(
        () => layerHybridEventBusCreate(/** @type {any} */ ({fallback: {}})),
        TypeError
    );

    let fallbackReadyStatusData = false;
    const busData = layerHybridEventBusCreate({
        fallback: {
            async start(){
                fallbackReadyStatusData = true;
            },
            async publish(){},
            async stop(){
                fallbackReadyStatusData = false;
            },
            isReady(){
                return fallbackReadyStatusData;
            }
        }
    });

    await busData.stop();
    await assert.rejects(() => busData.publish({
        eventId: 'event-1',
        tenantKey: 'tenant-1',
        channel: 'conversation:1'
    }), /not ready/);
    await busData.start(() => {});
    await assert.rejects(() => busData.start(() => {}), /already started/);
    assert.equal( busData.isAccelerated(), false );
    await busData.stop();
});

test('Redis coordination owns short locks by token and bounds presence membership', async () => {
    const stringValueMapData = new Map();
    const presenceMapData = new Map();
    let currentTimeData = Number( 1000 );
    const redisData = /** @type {Parameters<typeof layerRedisCoordinationCreate>[0]['redis']} */ ({
        async set( keyData, valueData, optionsData ){
            assert.deepEqual( optionsData, {NX: true, PX: 5000} );

            if ( stringValueMapData.has( keyData ) === true ){
                return null;

            }

            stringValueMapData.set( keyData, valueData );

            return 'OK';
        },
        async eval( scriptData, optionsData ){
            const keyData = optionsData.keys[0];
            const tokenData = optionsData.arguments[0];

            if ( stringValueMapData.get( keyData ) !== tokenData ){
                return 0;

            }

            if ( scriptData.includes( 'PEXPIRE' ) === true ){
                return 1;

            }

            stringValueMapData.delete( keyData );

            return 1;
        },
        async zAdd( keyData, valueData ){
            const memberMapData = presenceMapData.get( keyData ) ?? new Map();

            memberMapData.set( valueData.value, valueData.score );
            presenceMapData.set( keyData, memberMapData );

            return 1;
        },
        async zRem( keyData, valueData ){
            return presenceMapData.get( keyData )?.delete( valueData ) === true ? 1 : 0;
        },
        async zRemRangeByScore( keyData, minimumData, maximumData ){
            const memberMapData = presenceMapData.get( keyData ) ?? new Map();
            let removalCountData = Number( 0 );

            for ( const [memberData, expirationData] of memberMapData ){
                if (
                    Number( expirationData ) >= Number( minimumData ) &&
                    Number( expirationData ) <= Number( maximumData )
                ){
                    memberMapData.delete( memberData );
                    removalCountData += Number( 1 );

                }

            }

            return removalCountData;
        },
        async zRangeByScore( keyData, minimumData, maximumData, optionsData ){
            assert.equal( maximumData, '+inf' );
            const limitData = /** @type {{offset: number, count: number}} */ (optionsData.LIMIT);

            return [...(presenceMapData.get( keyData ) ?? new Map()).entries()]
                .filter((entryData) => Number( entryData[1] ) >= Number( minimumData ))
                .sort((leftData, rightData) => Number( leftData[1] ) - Number( rightData[1] ))
                .slice( Number( limitData.offset ), Number( limitData.offset ) + Number( limitData.count ) )
                .map((entryData) => entryData[0]);
        },
        async pExpire(){
            return true;
        }
    });
    let tokenIndexData = Number( 0 );
    const coordinationData = layerRedisCoordinationCreate({
        redis: redisData,
        namespace: 'layer:test:coordination',
        maximumPresenceMembers: 3,
        clock: () => currentTimeData,
        tokenCreate(){
            tokenIndexData += Number( 1 );

            return `token-${String( tokenIndexData )}`;
        }
    });
    const lockHandleData = await coordinationData.locks.acquire( 'jobs:mail', 5000 );

    assert.ok( lockHandleData );
    assert.equal( lockHandleData.name, 'jobs:mail' );
    assert.equal( await coordinationData.locks.acquire( 'jobs:mail', 5000 ), null );
    assert.equal( await lockHandleData.renew( 5000 ), true );
    assert.equal( await lockHandleData.release(), true );
    assert.equal( await lockHandleData.release(), false );
    assert.equal( await lockHandleData.renew( 5000 ), false );

    await coordinationData.presence.touch( 'chat:1', 'user:1', 5000 );
    await coordinationData.presence.touch( 'chat:1', 'user:2', 3000 );
    assert.deepEqual(
        await coordinationData.presence.list( 'chat:1', 2 ),
        ['user:2', 'user:1']
    );
    assert.equal( await coordinationData.presence.remove( 'chat:1', 'user:2' ), true );
    assert.equal( await coordinationData.presence.remove( 'chat:1', 'user:2' ), false );

    currentTimeData = Number( 7000 );
    assert.deepEqual( await coordinationData.presence.list( 'chat:1' ), [] );
});

test('Redis coordination rejects unsafe contracts, bounds, clocks, and responses', async () => {
    const redisData = {
        async set(){
            return 'OK';
        },
        async eval(){
            return 0;
        },
        async zAdd(){
            return 1;
        },
        async zRem(){
            return 0;
        },
        async zRemRangeByScore(){
            return 0;
        },
        async zRangeByScore(){
            return [7];
        },
        async pExpire(){
            return true;
        }
    };

    assert.throws(
        () => layerRedisCoordinationCreate(/** @type {any} */ ({redis: {}, namespace: 'layer:test'})),
        TypeError
    );
    assert.throws(() => layerRedisCoordinationCreate({
        redis: redisData,
        namespace: 'invalid namespace'
    }), TypeError);
    assert.throws(() => layerRedisCoordinationCreate({
        redis: redisData,
        namespace: 'layer:test',
        maximumPresenceMembers: 10001
    }), TypeError);

    const coordinationData = layerRedisCoordinationCreate({
        redis: redisData,
        namespace: 'layer:test',
        maximumPresenceMembers: 2,
        clock: () => -1,
        tokenCreate: () => 'invalid token'
    });

    await assert.rejects(() => coordinationData.locks.acquire( 'jobs:mail', 999 ), TypeError);
    await assert.rejects(() => coordinationData.locks.acquire( 'invalid lock', 1000 ), TypeError);
    await assert.rejects(() => coordinationData.locks.acquire( 'jobs:mail', 1000 ), TypeError);
    await assert.rejects(() => coordinationData.presence.touch( 'chat:1', 'invalid member', 1000 ), TypeError);
    await assert.rejects(() => coordinationData.presence.touch( 'chat:1', 'user:1', 300001 ), TypeError);
    await assert.rejects(() => coordinationData.presence.list( 'chat:1', 3 ), TypeError);
    await assert.rejects(() => coordinationData.presence.list( 'chat:1', 2 ), TypeError);

    const invalidResponseData = layerRedisCoordinationCreate({
        redis: redisData,
        namespace: 'layer:test',
        clock: () => 1000,
        tokenCreate: () => 'token-1'
    });
    await assert.rejects(() => invalidResponseData.presence.list( 'chat:1' ), TypeError);
});

test('Redis query cache canonicalizes payloads and isolates security scopes', async () => {
    const valueMapData = new Map();
    const tagMapData = new Map();
    const redisData = {
        async get( /** @type {string} */ keyData ){
            return valueMapData.get( keyData ) ?? null;
        },
        async set(
            /** @type {string} */ keyData,
            /** @type {string} */ valueData,
            /** @type {Record<string, any>} */ optionsData = {}
        ){
            if ( optionsData.NX === true && valueMapData.has( keyData ) === true ){
                return null;

            }

            valueMapData.set( keyData, valueData );

            return 'OK';
        },
        async sAdd( /** @type {string} */ keyData, /** @type {string[]} */ valuesData ){
            const memberSetData = tagMapData.get( keyData ) ?? new Set();

            for ( const valueData of valuesData ){
                memberSetData.add( valueData );

            }

            tagMapData.set( keyData, memberSetData );

            return valuesData.length;
        },
        async pExpire(){
            return true;
        },
        async eval(
            /** @type {string} */ scriptData,
            /** @type {{keys: string[], arguments: string[]}} */ optionsData
        ){
            if ( scriptData.includes( 'layer:cache-write' ) ){
                valueMapData.set( optionsData.keys[0], optionsData.arguments[0] );

                for ( const tagKeyData of optionsData.keys.slice( 2 ) ){
                    await this.sAdd( tagKeyData, [String( optionsData.keys[0] )] );

                }

                return 1;

            }

            if ( scriptData.includes( 'SMEMBERS' ) === true ){
                valueMapData.set( optionsData.keys[1], optionsData.arguments[0] );
                const memberSetData = tagMapData.get( optionsData.keys[0] ) ?? new Set();

                for ( const memberData of memberSetData ){
                    valueMapData.delete( memberData );

                }

                tagMapData.delete( optionsData.keys[0] );

                return memberSetData.size;

            }

            if ( valueMapData.get( optionsData.keys[0] ) === optionsData.arguments[0] ){
                valueMapData.delete( optionsData.keys[0] );

                return 1;

            }

            return 0;
        }
    };
    const queryCacheData = layerRedisQueryCacheCreate({
        redis: redisData,
        namespace: 'layer:test'
    });
    const requestData = {
        operation: 'chat.messages.read',
        payload: {
            page: 1,
            chatId: 'chat-1'
        },
        security: {
            tenantId: 'tenant-1',
            userId: 'user-1'
        },
        metadata: {
            ttlMs: 30000,
            scope: 'tenant',
            tags: ['chat-messages']
        }
    };

    assert.equal( await queryCacheData.write( requestData, {messages: [1]} ), true );
    assert.deepEqual( await queryCacheData.read({
        ...requestData,
        payload: {
            chatId: 'chat-1',
            page: 1
        }
    }), {
        hit: true,
        value: {
            messages: [1]
        }
    });
    assert.deepEqual( await queryCacheData.read({
        ...requestData,
        security: {
            tenantId: 'tenant-2',
            userId: 'user-2'
        }
    }), {
        hit: false,
        value: null
    });
    assert.equal( await queryCacheData.invalidate({
        ...requestData,
        tags: ['chat-messages']
    }), 1 );
    assert.equal( (await queryCacheData.read( requestData )).hit, false );
    assert.equal( await queryCacheData.invalidationCursorRead(), 0 );
    await queryCacheData.invalidationCursorWrite( 12 );
    assert.equal( await queryCacheData.invalidationCursorRead(), 12 );

    //Separating the same user ID across tenants, including invalidation ownership
    const userRequestData = {...requestData, metadata: {...requestData.metadata, scope: 'user'}};
    const otherTenantRequestData = {...userRequestData, security: {...requestData.security, tenantId: 'tenant-2'}};
    const noTenantRequestData = {...userRequestData, security: {...requestData.security, tenantId: null}};
    await queryCacheData.write( userRequestData, {owner: 'tenant-1'} );
    assert.equal( (await queryCacheData.read( otherTenantRequestData )).hit, false );
    assert.equal( (await queryCacheData.read( noTenantRequestData )).hit, false );
    await queryCacheData.write( otherTenantRequestData, {owner: 'tenant-2'} );
    await queryCacheData.write( noTenantRequestData, {owner: null} );
    await queryCacheData.invalidate({...userRequestData, tags: ['chat-messages']});
    assert.equal( (await queryCacheData.read( userRequestData )).hit, false );
    assert.deepEqual( (await queryCacheData.read( otherTenantRequestData )).value, {owner: 'tenant-2'} );
    assert.deepEqual( (await queryCacheData.read( noTenantRequestData )).value, {owner: null} );
    await assert.rejects( queryCacheData.read({...userRequestData, security: {userId: 'user-1', tenantId: ''}}), TypeError );
});

test('Redis query cache coalesces the leading load and rejects oversized entries', async () => {
    const valueMapData = new Map();
    const redisData = {
        async get( /** @type {string} */ keyData ){
            return valueMapData.get( keyData ) ?? null;
        },
        async set(
            /** @type {string} */ keyData,
            /** @type {string} */ valueData,
            /** @type {Record<string, any>} */ optionsData = {}
        ){
            if ( optionsData.NX === true && valueMapData.has( keyData ) === true ){
                return null;

            }

            valueMapData.set( keyData, valueData );

            return 'OK';
        },
        async sAdd(){
            return 1;
        },
        async pExpire(){
            return true;
        },
        async eval(
            /** @type {string} */ scriptData,
            /** @type {{keys: string[], arguments: string[]}} */ optionsData
        ){
            if ( scriptData.includes( 'layer:cache-generation' ) ){
                await this.set( String( optionsData.keys[0] ), String( optionsData.arguments[0] ), {NX: true} );

                return valueMapData.get( optionsData.keys[0] );

            }

            if ( scriptData.includes( 'layer:cache-write' ) ){
                valueMapData.set( optionsData.keys[0], optionsData.arguments[0] );

                return 1;

            }

            valueMapData.delete( optionsData.keys[0] );

            return 1;
        }
    };
    const queryCacheData = layerRedisQueryCacheCreate({
        redis: redisData,
        namespace: 'layer:test',
        maximumEntryBytes: 1024,
        tokenCreate: () => 'lease-token'
    });
    const requestData = {
        operation: 'health.status.read',
        payload: {},
        security: {},
        metadata: {
            ttlMs: 1000,
            scope: 'global',
            tags: []
        }
    };
    let loadCountData = Number( 0 );

    assert.deepEqual( await queryCacheData.execute( requestData, async function resultLoad(){
        loadCountData += Number( 1 );

        return {status: 'ok'};
    }), {status: 'ok'} );
    assert.deepEqual( await queryCacheData.execute( requestData, async function resultLoad(){
        loadCountData += Number( 1 );

        return {status: 'unexpected'};
    }), {status: 'ok'} );
    assert.equal( loadCountData, 1 );
    assert.equal( await queryCacheData.write( requestData, {
        value: 'x'.repeat( 1100 )
    }), false );
});

test('Redis query cache rejects unsafe payloads, scopes, envelopes, and cursors', async () => {
    let cachedSourceData = /** @type {string | null} */ (null);
    const redisData = {
        async get(){
            return cachedSourceData;
        },
        async set(){
            return 'OK';
        },
        async sAdd(){
            return 1;
        },
        async pExpire(){
            return true;
        },
        async eval(){
            return 0;
        }
    };
    const queryCacheData = layerRedisQueryCacheCreate({
        redis: redisData,
        namespace: 'layer:test',
        maximumEntryBytes: 1024
    });
    const requestData = {
        operation: 'chat.messages.read',
        payload: {},
        security: {
            tenantId: 'tenant-1',
            userId: 'user-1'
        },
        metadata: {
            ttlMs: 1000,
            scope: 'tenant',
            tags: []
        }
    };

    for ( const invalidPayloadData of [
        {value: Number.NaN},
        {value: undefined},
        {value: Array.from({length: 1001}, () => 1)}
    ] ){
        await assert.rejects(() => queryCacheData.read({
            ...requestData,
            payload: invalidPayloadData
        }), TypeError);
    }

    const cyclicPayloadData = {};
    cyclicPayloadData.self = cyclicPayloadData;
    await assert.rejects(() => queryCacheData.read({
        ...requestData,
        payload: cyclicPayloadData
    }), TypeError);
    await assert.rejects(() => queryCacheData.read({
        ...requestData,
        security: {
            tenantId: null,
            userId: null
        }
    }), TypeError);

    cachedSourceData = JSON.stringify({unexpected: true});
    await assert.rejects(() => queryCacheData.read( requestData ), /envelope/);
    cachedSourceData = 'x'.repeat( 1100 );
    await assert.rejects(() => queryCacheData.read( requestData ), /entry/);
    cachedSourceData = 'invalid-cursor';
    await assert.rejects(() => queryCacheData.invalidationCursorRead(), /cursor/);
    await assert.rejects(() => queryCacheData.invalidationCursorWrite( -1 ), TypeError);

    assert.throws(() => layerRedisQueryCacheCreate(/** @type {any} */ ({
        redis: {},
        namespace: 'layer:test'
    })), TypeError);
    assert.throws(() => layerRedisQueryCacheCreate({
        redis: redisData,
        namespace: 'Invalid Namespace'
    }), TypeError);
});

test('Redis query cache follower waits for the leading cached result', async () => {
    let getCountData = Number( 0 );
    let loadCountData = Number( 0 );
    const queryCacheData = layerRedisQueryCacheCreate({
        redis: {
            async get(){
                getCountData += Number( 1 );

                if ( getCountData >= Number( 2 ) ){
                    return JSON.stringify({value: {status: 'cached-by-leader'}});

                }

                return null;
            },
            async set(){
                return null;
            },
            async sAdd(){
                return 1;
            },
            async pExpire(){
                return true;
            },
            async eval(){
                return 0;
            }
        },
        namespace: 'layer:test'
    });

    assert.deepEqual( await queryCacheData.execute({
        operation: 'health.status.read',
        payload: {},
        security: {},
        metadata: {
            ttlMs: 1000,
            scope: 'global',
            tags: []
        }
    }, async function followerLoad(){
        loadCountData += Number( 1 );

        return {status: 'local'};
    }), {status: 'cached-by-leader'} );
    assert.equal( loadCountData, 0 );
});

test('cache invalidation synchronizer replays durable records from Redis cursor', async () => {
    const invalidationCallsData = /** @type {any[]} */ ([]);
    const cursorWritesData = /** @type {number[]} */ ([]);
    let cacheAvailableStatusData = false;
    const synchronizerData = layerCacheInvalidationSynchronizerCreate({
        repository: {
            async readAfter( replayData ){
                assert.equal( replayData.cursor, 4 );

                return [{
                    invalidationId: 5,
                    eventId: 'command-5',
                    scope: 'tenant',
                    tenantId: 'tenant-1',
                    userId: null,
                    tags: ['chat-messages']
                }];
            }
        },
        cache: {
            async invalidate( invalidationData ){
                if ( cacheAvailableStatusData === false ){
                    throw new Error( 'Redis unavailable' );

                }

                invalidationCallsData.push( invalidationData );
            },
            async invalidationCursorRead(){
                return 4;
            },
            async invalidationCursorWrite( cursorData ){
                cursorWritesData.push( cursorData );
            }
        },
        pollIntervalMs: 60000
    });

    await synchronizerData.start();
    assert.equal( synchronizerData.cursorGet(), 4 );
    assert.deepEqual( cursorWritesData, [] );

    cacheAvailableStatusData = true;
    assert.equal( await synchronizerData.synchronize(), 1 );
    assert.equal( synchronizerData.cursorGet(), 5 );
    assert.deepEqual( cursorWritesData, [5] );
    assert.deepEqual( invalidationCallsData[0], {
        security: {
            tenantId: 'tenant-1',
            userId: null
        },
        metadata: {
            scope: 'tenant'
        },
        tags: ['chat-messages']
    });
    await synchronizerData.stop();
    assert.equal( synchronizerData.isReady(), false );
});

test('cache invalidation synchronizer validates lifecycle and coalesces concurrent replay', async () => {
    const invalidOptionData = [
        {},
        {
            repository: {readAfter: async () => []},
            cache: {}
        },
        {
            repository: {readAfter: async () => []},
            cache: {
                invalidate: async () => null,
                invalidationCursorRead: async () => 0,
                invalidationCursorWrite: async () => null
            },
            beforeSynchronize: true
        },
        {
            repository: {readAfter: async () => []},
            cache: {
                invalidate: async () => null,
                invalidationCursorRead: async () => 0,
                invalidationCursorWrite: async () => null
            },
            pollIntervalMs: 99
        },
        {
            repository: {readAfter: async () => []},
            cache: {
                invalidate: async () => null,
                invalidationCursorRead: async () => 0,
                invalidationCursorWrite: async () => null
            },
            batchSize: 1001
        }
    ];

    for ( const optionData of invalidOptionData ){
        assert.throws(
            () => layerCacheInvalidationSynchronizerCreate(/** @type {any} */ (optionData)),
            TypeError
        );

    }

    let readResolveData = /** @type {(recordsData: readonly Record<string, any>[]) => void} */ (() => {});
    let readCountData = Number( 0 );
    const diagnosticCallsData = /** @type {Record<string, unknown>[]} */ ([]);
    const synchronizerData = layerCacheInvalidationSynchronizerCreate({
        repository: {
            async readAfter(){
                readCountData += Number( 1 );

                return new Promise((resolveData) => {
                    readResolveData = resolveData;
                });
            }
        },
        cache: {
            async invalidate(){
                return null;
            },
            async invalidationCursorRead(){
                return 0;
            },
            async invalidationCursorWrite(){
                return;
            }
        },
        diagnostics: {
            record( diagnosticData ){
                diagnosticCallsData.push( diagnosticData );
            }
        },
        pollIntervalMs: 60000
    });
    const firstReplayData = synchronizerData.synchronize();
    const secondReplayData = synchronizerData.synchronize();

    await new Promise((resolveData) => setImmediate(resolveData));
    assert.equal( readCountData, 1 );
    readResolveData([]);
    assert.equal( await firstReplayData, 0 );
    assert.equal( await secondReplayData, 0 );

    const failingSynchronizerData = layerCacheInvalidationSynchronizerCreate({
        repository: {
            async readAfter(){
                return [];
            }
        },
        cache: {
            async invalidate(){
                return null;
            },
            async invalidationCursorRead(){
                return 0;
            },
            async invalidationCursorWrite(){
                return;
            }
        },
        diagnostics: {
            record( diagnosticData ){
                diagnosticCallsData.push( diagnosticData );
            }
        },
        async beforeSynchronize(){
            throw new Error( 'Redis unavailable' );
        },
        pollIntervalMs: 100
    });

    await failingSynchronizerData.start();
    assert.equal( failingSynchronizerData.isReady(), false );
    assert.deepEqual( diagnosticCallsData.at( -1 ), {
        level: 'warn',
        event: 'cache-invalidation.synchronize-failed',
        code: 'CACHE_UNAVAILABLE'
    });
    await new Promise((resolveData) => setTimeout(resolveData, 120));
    assert.equal( diagnosticCallsData.length >= Number( 2 ), true );
    await assert.rejects(() => failingSynchronizerData.start(), /already started/);
    await failingSynchronizerData.stop();
    await synchronizerData.stop();
});

test('event operation authorizes channels from server identity only', async () => {
    const operation = layerEventsOpenOperationDefinitionCreate({
        permissions: [
            'events.read'
        ],
        channelAuthorize: async (channelName, securityContext) => {
            return channelName.endsWith(String(securityContext.userId));
        }
    });

    assert.equal(operation.type, 'events.open');
    assert.deepEqual(operation.permissions, [
        'events.read'
    ]);
    assert.deepEqual(await operation.handler({
        channels: [
            'notifications:user-1'
        ]
    }, {
        security: {
            userId: 'user-1',
            tenantId: 'tenant-1'
        }
    }), {
        tenantKey: 'tenant-1',
        userId: 'user-1',
        channels: [
            'notifications:user-1'
        ]
    });
    await assert.rejects(() => operation.handler({
        channels: [
            'notifications:user-2'
        ]
    }, {
        security: {
            userId: 'user-1'
        }
    }), (errorData) => /** @type {any} */ (errorData).code === 'OBJECT_ACCESS_DENIED');
    await assert.rejects(() => operation.handler({channels: []}, {
        security: {}
    }), (errorData) => /** @type {any} */ (errorData).code === 'AUTH_REQUIRED');
});

test('distribution loads event payload from PostgreSQL and reports stale routes', async () => {
    let routeHandle = /** @type {Function | undefined} */ (undefined);
    let stopCount = 0;
    const dispatchCalls = [];
    const diagnostics = /** @type {any[]} */ ([]);
    const distribution = layerEventDistributionCreate({
        eventBus: {
            async start(/** @type {Function} */ listenerData) {
                routeHandle = listenerData;
            },
            async stop() {
                stopCount += 1;
            }
        },
        eventRepository: {
            async findById(/** @type {string} */ _tenantKey, /** @type {string} */ eventIdentifier) {
                return eventIdentifier === 'missing' ? null : eventDataCreate(1);
            }
        },
        streamManager: {
            dispatch(/** @type {string} */ tenantKey, /** @type {any} */ eventData) {
                dispatchCalls.push({tenantKey, eventData});
            }
        },
        diagnostics: {
            record: (diagnosticData) => diagnostics.push(diagnosticData)
        }
    });

    await distribution.start();
    await routeHandle?.({eventId: 'event-1', tenantKey: 'tenant-1', channel: 'conversation:1'});
    await routeHandle?.({eventId: 'missing', tenantKey: 'tenant-1', channel: 'conversation:1'});
    assert.equal(distribution.isReady(), true);
    assert.equal(dispatchCalls.length, 1);
    assert.equal(diagnostics[0].event, 'event-distribution.missing-event');
    await assert.rejects(() => distribution.start(), /already started/);
    await distribution.stop();
    await distribution.stop();
    assert.equal(stopCount, 1);
});

test('stream codec creates stable event, control, and heartbeat records', () => {
    const eventData = eventDataCreate(1);

    assert.match(layerEventFrameCreate(eventData), /^id: event-1\nevent: layer\.event\ndata: /);
    assert.match(layerControlFrameCreate('server-drain', {retryAfterMs: 500}), /"type":"server-drain"/);
    assert.equal(
        layerHeartbeatFrameCreate(new Date(occurredAt)),
        `: heartbeat ${occurredAt}\n\n`
    );
});

test('event stream replays, handles backpressure, dispatches, and drains', async () => {
    const replayCalls = [];
    const response = new FakeResponse();
    response.backpressureOnce = true;
    const manager = layerEventStreamManagerCreate({
        eventRepository: {
            async replay(/** @type {any} */ replayData) {
                replayCalls.push(replayData);

                if (replayCalls.length === 1) {
                    return {
                        events: [
                            eventDataCreate(1)
                        ],
                        hasMore: false
                    };
                }

                return {
                    events: [],
                    hasMore: false
                };
            }
        },
        diagnostics: {
            record() {}
        },
        heartbeatMs: 60000
    });
    const openTask = manager.open({
        response: /** @type {any} */ (response),
        authorization: {
            tenantKey: 'tenant-1',
            userId: 'user-1',
            channels: [
                'conversation:1'
            ]
        },
        cursor: {
            'conversation:1': 0
        },
        remoteAddress: '127.0.0.1',
        requestId: 'request-1'
    });

    while (manager.activeCount() === 0 || response.frames.length === 0) {
        await new Promise((resolve) => setImmediate(resolve));
    }

    manager.dispatch('tenant-1', eventDataCreate(2));
    manager.dispatch('other-tenant', eventDataCreate(3));
    await new Promise((resolve) => setImmediate(resolve));
    await manager.drain();
    await openTask;

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'text/event-stream; charset=utf-8');
    assert.equal(response.flushCount, 1);
    assert.equal(response.frames.filter((frameData) => frameData.includes('layer.event')).length, 2);
    assert.match(response.frames.at(-1) ?? '', /server-drain/);
    assert.equal(manager.activeCount(), 0);
    await assert.rejects(() => manager.open({
        response: /** @type {any} */ (new FakeResponse()),
        authorization: {
            tenantKey: 'tenant-1',
            userId: 'user-1',
            channels: [
                'conversation:1'
            ]
        },
        cursor: null,
        remoteAddress: '127.0.0.1',
        requestId: 'request-2'
    }), (errorData) => /** @type {any} */ (errorData).code === 'DEPENDENCY_UNAVAILABLE');
});

test('event stream enforces limits and snapshot fallback', async () => {
    const response = new FakeResponse();
    const manager = layerEventStreamManagerCreate({
        eventRepository: {
            async replay() {
                return {
                    events: [],
                    hasMore: true
                };
            }
        },
        diagnostics: {
            record() {}
        },
        maxStreamsPerUser: 1
    });

    await assert.rejects(() => manager.open({
        response: /** @type {any} */ (response),
        authorization: {
            tenantKey: 'tenant-1',
            userId: 'user-1',
            channels: [
                'conversation:1'
            ]
        },
        cursor: null,
        remoteAddress: '127.0.0.1',
        requestId: 'request-1'
    }), (errorData) => /** @type {any} */ (errorData).code === 'CURSOR_EXPIRED');

    const invalidManager = layerEventStreamManagerCreate({
        eventRepository: {
            async replay() {
                return {
                    events: [],
                    hasMore: false
                };
            }
        },
        diagnostics: {
            record() {}
        },
        maxChannels: 1
    });

    await assert.rejects(() => invalidManager.open({
        response: /** @type {any} */ (new FakeResponse()),
        authorization: {
            tenantKey: 'tenant-1',
            userId: 'user-1',
            channels: [
                'one',
                'two'
            ]
        },
        cursor: null,
        remoteAddress: '127.0.0.1',
        requestId: 'request-2'
    }), (errorData) => /** @type {any} */ (errorData).code === 'INVALID_PAYLOAD');
});
