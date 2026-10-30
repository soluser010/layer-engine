import assert from 'node:assert/strict';
import test from 'node:test';
import {
    IDBKeyRange,
    indexedDB
} from 'fake-indexeddb';
import {
    LayerStorageError,
    layerOfflineOutboxCreate,
    layerShareTargetInboxCreate,
    layerStorageOpen,
    layerStorageSchemaDefine,
    layerWorkerOutboxConfigurationClear,
    layerWorkerOutboxConfigure,
    layerWorkerOutboxDrainCreate,
    layerWorkerShareTargetCaptureCreate
} from '../src/index.js';

let namespaceSequence = 0;

/**
 * @param {string} labelData
 */
function namespaceCreate(labelData) {
    namespaceSequence += 1;

    return `${labelData}-${namespaceSequence}`;
}

/**
 * @param {string} schemaName
 */
function notesSchemaCreate(schemaName) {
    return layerStorageSchemaDefine({
        name: schemaName,
        version: 1,
        stores: {
            notes: {
                keyPath: 'id',
                indexes: {
                    updated_at: {
                        keyPath: 'updatedAt'
                    }
                }
            }
        },
        migrations: {
            1(/** @type {any} */ migrationData) {
                migrationData.createStore('notes');
                migrationData.createIndex('notes', 'updated_at');
            }
        }
    });
}

test('storage schema rejects reserved stores, gaps, and unknown metadata', () => {
    assert.throws(() => layerStorageSchemaDefine(/** @type {any} */ (null)), TypeError);
    assert.throws(() => layerStorageSchemaDefine({
        name: 'notes',
        version: 1,
        stores: {
            __layer_private: {
                keyPath: 'id',
                indexes: {}
            }
        },
        migrations: {
            1() {}
        }
    }), /reserved/);
    assert.throws(() => layerStorageSchemaDefine({
        name: 'notes',
        version: 2,
        stores: {},
        migrations: {
            1() {}
        }
    }), /migration 2/);
    assert.throws(() => layerStorageSchemaDefine({
        name: 'notes',
        version: 1,
        stores: {
            notes: {
                keyPath: 'id',
                indexes: {},
                unknown: true
            }
        },
        migrations: {
            1() {}
        }
    }), /definition/);
});

test('IndexedDB storage migrates, transacts, queries, watches, and exports after commit', async () => {
    const schema = notesSchemaCreate('notes');
    const namespace = namespaceCreate('user');
    const storage = await layerStorageOpen({
        appId: 'messenger',
        namespace,
        schema,
        indexedDb: indexedDB,
        storageManager: /** @type {StorageManager} */ (/** @type {unknown} */ ({
            async estimate() {
                return {
                    usage: 128,
                    quota: 1024
                };
            },
            async persisted() {
                return true;
            }
        }))
    });
    const watchResults = /** @type {any[]} */ ([]);
    const disposeWatch = storage.watch([
        'notes'
    ], () => storage.query('notes'), (resultData) => {
        watchResults.push(resultData);
    }, {
        immediate: false
    });

    await storage.put('notes', {
        id: 'note-1',
        text: 'First',
        updatedAt: 1
    });
    await storage.transaction([
        'notes'
    ], 'readwrite', async (transactionData) => {
        await transactionData.put('notes', {
            id: 'note-2',
            text: 'Second',
            updatedAt: 2
        });
        await transactionData.put('notes', {
            id: 'note-3',
            text: 'Third',
            updatedAt: 3
        });
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(await storage.get('notes', 'note-1'), {
        id: 'note-1',
        text: 'First',
        updatedAt: 1
    });
    assert.deepEqual(await storage.query('notes', {
        index: 'updated_at',
        query: IDBKeyRange.lowerBound(2)
    }), [
        {
            id: 'note-2',
            text: 'Second',
            updatedAt: 2
        },
        {
            id: 'note-3',
            text: 'Third',
            updatedAt: 3
        }
    ]);
    assert.equal(watchResults.length, 2);
    assert.equal(/** @type {any[]} */ (watchResults.at(-1)).length, 3);
    assert.deepEqual(await storage.estimate(), {
        supported: true,
        usage: 128,
        quota: 1024,
        persisted: true
    });
    const exportData = await storage.exportUserData();

    assert.equal(/** @type {any} */ (exportData).stores.notes.length, 3);
    assert.deepEqual(/** @type {any} */ (exportData).stores.__layer_outbox, []);

    await storage.eventCursors.write('conversation:1', 4);
    await storage.eventCursors.write('conversation:1', 2);
    assert.deepEqual(await storage.eventCursors.read([
        'conversation:1',
        'notifications:user-1'
    ]), {
        'conversation:1': 4,
        'notifications:user-1': 0
    });
    await storage.queryCache.put('chat.list', {
        ids: [
            'message-1'
        ]
    }, {
        revision: 4,
        expiresAt: 100
    });
    assert.deepEqual(await storage.queryCache.get('chat.list', 101), {
        hit: true,
        stale: true,
        data: {
            ids: [
                'message-1'
            ]
        },
        revision: 4
    });
    await storage.entities.put({
        key: 'message:1',
        entityType: 'chat.message',
        revision: 2,
        data: {
            text: 'Hello'
        }
    });
    await assert.rejects(() => storage.entities.put({
        key: 'message:1',
        entityType: 'chat.message',
        revision: 1,
        data: {
            text: 'Old'
        }
    }), (errorData) => /** @type {any} */ (errorData).code === 'STORAGE_REVISION_CONFLICT');
    await storage.drafts.put('dialog:1', {
        text: 'Draft'
    });
    assert.equal(/** @type {any} */ (await storage.drafts.get('dialog:1')).data.text, 'Draft');

    await assert.rejects(() => storage.transaction([
        'notes'
    ], 'readwrite', async (transactionData) => {
        await transactionData.put('notes', {
            id: 'rollback',
            updatedAt: 4
        });
        throw new Error('cancel transaction');
    }), /transaction failed/i);
    assert.equal(await storage.get('notes', 'rollback'), undefined);

    disposeWatch();
    await storage.delete('notes', 'note-1');
    await storage.purgeUserData();
    await assert.rejects(() => storage.get('notes', 'note-2'), (errorData) => {
        return errorData instanceof LayerStorageError && errorData.code === 'STORAGE_CLOSED';
    });

    const reopenedStorage = await layerStorageOpen({
        appId: 'messenger',
        namespace,
        schema,
        indexedDb: indexedDB
    });

    assert.deepEqual(await reopenedStorage.query('notes'), []);
    assert.deepEqual(await reopenedStorage.estimate(), {
        supported: false,
        usage: null,
        quota: null,
        persisted: false
    });
    await reopenedStorage.purgeUserData();
});

test('storage applies only new migrations and rejects incomplete or asynchronous upgrades', async () => {
    const namespace = namespaceCreate('migration');
    const schemaVersionOne = layerStorageSchemaDefine({
        name: 'drafts',
        version: 1,
        stores: {
            drafts: {
                keyPath: 'id',
                indexes: {}
            }
        },
        migrations: {
            1(/** @type {any} */ migrationData) {
                migrationData.createStore('drafts');
            }
        }
    });
    const firstStorage = await layerStorageOpen({
        appId: 'messenger',
        namespace,
        schema: schemaVersionOne,
        indexedDb: indexedDB
    });

    await firstStorage.put('drafts', {
        id: 'draft-1',
        updatedAt: 3
    });
    firstStorage.close();

    const schemaVersionTwo = layerStorageSchemaDefine({
        name: 'drafts',
        version: 2,
        stores: {
            drafts: {
                keyPath: 'id',
                indexes: {
                    updated_at: {
                        keyPath: 'updatedAt'
                    }
                }
            }
        },
        migrations: {
            1(/** @type {any} */ migrationData) {
                migrationData.createStore('drafts');
            },
            2(/** @type {any} */ migrationData) {
                migrationData.createIndex('drafts', 'updated_at');
            }
        }
    });
    const secondStorage = await layerStorageOpen({
        appId: 'messenger',
        namespace,
        schema: schemaVersionTwo,
        indexedDb: indexedDB
    });

    assert.equal(/** @type {any[]} */ (await secondStorage.query('drafts', {
        index: 'updated_at'
    })).length, 1);
    await secondStorage.purgeUserData();

    const failedSchema = layerStorageSchemaDefine({
        name: 'failed',
        version: 1,
        stores: {
            drafts: {
                keyPath: 'id',
                indexes: {}
            }
        },
        migrations: {
            1() {
                return Promise.resolve();
            }
        }
    });

    await assert.rejects(() => layerStorageOpen({
        appId: 'messenger',
        namespace: namespaceCreate('failed'),
        schema: failedSchema,
        indexedDb: indexedDB
    }), (errorData) => {
        return errorData instanceof LayerStorageError && errorData.code === 'STORAGE_MIGRATION_FAILED';
    });
});

test('offline outbox commits before send, leases domains, and exposes conflicts', async () => {
    const storage = await layerStorageOpen({
        appId: 'messenger',
        namespace: namespaceCreate('outbox'),
        schema: notesSchemaCreate('outbox'),
        indexedDb: indexedDB
    });
    let commandSequence = 0;
    const sentCommands = [];
    const outbox = layerOfflineOutboxCreate({
        storage,
        ownerId: 'page-1',
        commandIdCreate() {
            commandSequence += 1;

            return `command-${commandSequence}`;
        },
        async commandSend(commandData) {
            sentCommands.push(commandData);

            if (commandData.operation === 'chat.conflict.send') {
                throw Object.assign(new Error('revision conflict'), {
                    code: 'CONFLICT',
                    status: 409,
                    details: {
                        currentRevision: 8
                    }
                });
            }

            return {
                accepted: true
            };
        },
        concurrency: 2
    });

    await outbox.queue({
        operation: 'chat.message.send',
        payload: {
            text: 'One'
        },
        baseRevision: 1,
        conflictDomain: 'dialog:1'
    });
    await outbox.queue({
        operation: 'chat.message.send',
        payload: {
            text: 'Two'
        },
        baseRevision: 1,
        conflictDomain: 'dialog:1'
    });
    await outbox.queue({
        operation: 'chat.conflict.send',
        payload: {
            text: 'Conflict'
        },
        baseRevision: 2,
        conflictDomain: 'dialog:2'
    });

    assert.deepEqual(await outbox.drain(), {
        claimed: 2,
        confirmed: 1,
        retryable: 0,
        conflicted: 1,
        failed: 0
    });
    assert.equal(sentCommands.length, 2);
    const commandRecords = await outbox.list();
    const conflictRecord = /** @type {any} */ (commandRecords.find((commandData) => commandData.status === 'conflict'));

    assert.ok(conflictRecord);
    assert.equal(conflictRecord.failure.details.currentRevision, 8);
    assert.deepEqual(await outbox.drain(), {
        claimed: 1,
        confirmed: 1,
        retryable: 0,
        conflicted: 0,
        failed: 0
    });

    const replacementIdentifier = await outbox.resolveConflict(conflictRecord.commandId, {
        operation: 'chat.message.send',
        payload: {
            text: 'Merged'
        },
        baseRevision: 8,
        conflictDomain: 'dialog:2'
    });

    assert.equal(replacementIdentifier, 'command-4');
    assert.deepEqual(await outbox.drain(), {
        claimed: 1,
        confirmed: 1,
        retryable: 0,
        conflicted: 0,
        failed: 0
    });
    await assert.rejects(() => outbox.retry(conflictRecord.commandId), (errorData) => {
        return /** @type {any} */ (errorData).code === 'OUTBOX_STATE_INVALID';
    });
    await storage.purgeUserData();
});

test('offline outbox reads, watches, and cancels durable commands', async () => {
    const storage = await layerStorageOpen({
        appId: 'messenger',
        namespace: namespaceCreate('outbox-handle'),
        schema: notesSchemaCreate('outbox-handle'),
        indexedDb: indexedDB
    });
    const outbox = layerOfflineOutboxCreate({
        storage,
        ownerId: 'page-handle',
        commandIdCreate: () => 'command-handle',
        commandSend: async () => ({accepted: true})
    });
    const queuedRecord = await outbox.queue({
        operation: 'chat.message.send',
        payload: {
            text: 'Offline'
        },
        baseRevision: 3,
        conflictDomain: 'dialog:handle'
    });
    const observedStatuses = /** @type {unknown[]} */ ([]);
    let cancelledResolve = /** @type {() => void} */ (() => {});
    const cancelledPromise = /** @type {Promise<void>} */ (new Promise(function cancelledCommandWait(resolve) {
        cancelledResolve = resolve;
    }));
    const watchDispose = outbox.watch(queuedRecord.commandId, (commandRecord) => {
        observedStatuses.push(commandRecord?.status);

        if (commandRecord?.status === 'cancelled') {
            cancelledResolve();

        }
    });

    assert.equal((await outbox.get(queuedRecord.commandId))?.status, 'queued');
    await outbox.cancel(queuedRecord.commandId);
    await cancelledPromise;
    assert.equal((await outbox.get(queuedRecord.commandId))?.status, 'cancelled');
    assert.equal(observedStatuses.includes('cancelled'), true);
    assert.equal(watchDispose(), undefined);
    await assert.rejects(() => outbox.cancel(queuedRecord.commandId), (errorData) => {
        return /** @type {any} */ (errorData).code === 'OUTBOX_STATE_INVALID';
    });
    await assert.rejects(() => outbox.get(''), (errorData) => {
        return /** @type {any} */ (errorData).code === 'OUTBOX_COMMAND_INVALID';
    });
    await assert.rejects(function reservedCommandPayloadReject() {
        //Attempting to shadow engine-owned delivery identity fields.
        return outbox.queue({
            operation: 'chat.message.send',
            payload: {
                commandId: 'attacker-selected'
            },
            baseRevision: 0,
            conflictDomain: 'dialog:reserved'
        });

    }, function reservedCommandErrorCheck(errorData) {
        //Checking the stable invalid-command failure code.
        return /** @type {any} */ (errorData).code === 'OUTBOX_COMMAND_INVALID';

    });
    await storage.purgeUserData();

});

test('worker outbox bridge drains a configured user database after the page stops', async function workerOutboxBridgeCheck() {
    //Creating one isolated user database and a command that the page will not send.
    const appIdentifier = `workerapp${namespaceSequence + 1}`;
    const storage = await layerStorageOpen({
        appId: appIdentifier,
        namespace: namespaceCreate('worker-outbox'),
        schema: notesSchemaCreate('worker-outbox'),
        indexedDb: indexedDB
    });
    const outbox = layerOfflineOutboxCreate({
        storage,
        ownerId: 'page-worker',
        commandIdCreate() {
            //Returning one deterministic id for inspecting the worker result.
            return 'worker-command-1';

        },
        async commandSend() {
            //Failing if the test accidentally uses the page transport.
            throw new Error('The page transport must not run.');

        }
    });

    //Persisting intent and the worker pointer before simulating a sync event.
    await outbox.queue({
        operation: 'chat.message.send',
        payload: {
            text: 'Background'
        },
        baseRevision: 4,
        conflictDomain: 'dialog:worker'
    });
    await layerWorkerOutboxConfigure({
        appId: appIdentifier,
        storageName: storage.name,
        apiUrl: '/api',
        csrfToken: 'worker-csrf',
        applicationOrigin: 'https://app.example.com',
        indexedDb: indexedDB
    });
    let requestEnvelope = /** @type {Record<string, any> | null} */ (null);
    const workerDrain = layerWorkerOutboxDrainCreate({
        appId: appIdentifier,
        applicationOrigin: 'https://app.example.com',
        indexedDb: indexedDB,
        requestIdCreate() {
            //Returning a protocol-valid UUID for the background request.
            return '7ec2df78-6db4-4b35-8eb0-b2476bb10020';

        },
        ownerIdCreate() {
            //Returning a stable worker lease owner for this test.
            return 'worker-1';

        },
        async fetchImplementation(_urlData, requestData) {
            //Capturing the actual POST envelope before acknowledging the command.
            const parsedEnvelope = /** @type {Record<string, any>} */ (
                JSON.parse(String(requestData?.body))
            );
            requestEnvelope = parsedEnvelope;

            return new Response(JSON.stringify({
                protocol: 1,
                requestId: parsedEnvelope.requestId,
                ok: true,
                data: {
                    accepted: true
                }
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json'
                }
            });

        }
    });

    //Checking the confirmed durable state and the request identity fields.
    assert.deepEqual(await workerDrain(), {
        configured: true,
        claimed: 1,
        confirmed: 1,
        retryable: 0,
        conflicted: 0,
        failed: 0
    });
    assert.equal(requestEnvelope?.type, 'command');
    assert.equal(requestEnvelope?.payload.commandId, 'worker-command-1');
    assert.equal((await outbox.get('worker-command-1'))?.status, 'confirmed');
    await layerWorkerOutboxConfigurationClear({
        appId: appIdentifier,
        indexedDb: indexedDB
    });
    assert.equal((await workerDrain()).configured, false);
    await assert.rejects(function crossOriginConfigurationReject() {
        //Attempting to redirect background commands outside the application origin.
        return layerWorkerOutboxConfigure({
            appId: appIdentifier,
            storageName: storage.name,
            apiUrl: 'https://foreign.example.com/api',
            csrfToken: null,
            applicationOrigin: 'https://app.example.com',
            indexedDb: indexedDB
        });

    }, function crossOriginErrorCheck(errorData) {
        //Checking the stable fail-closed storage code.
        return /** @type {any} */ (errorData).code === 'WORKER_OUTBOX_CONFIG_INVALID';

    });
    await storage.purgeUserData();

});

test('worker outbox preserves domain order and classifies protocol failures', async function workerFailureMatrixCheck() {
    //Creating commands across four domains so one batch can exercise every terminal class.
    const appIdentifier = `workerfailures${namespaceSequence + 1}`;
    const storage = await layerStorageOpen({
        appId: appIdentifier,
        namespace: namespaceCreate('worker-failures'),
        schema: notesSchemaCreate('worker-failures'),
        indexedDb: indexedDB
    });
    let commandSequence = 0;
    const outbox = layerOfflineOutboxCreate({
        storage,
        ownerId: 'page-worker-failures',
        commandIdCreate() {
            //Creating deterministic ids for response routing and order assertions.
            commandSequence += 1;

            return `worker-failure-${commandSequence}`;

        },
        async commandSend() {
            //Failing if this worker-only scenario reaches the page transport.
            throw new Error('The page transport must not run.');

        }
    });
    const commandInputs = [
        {conflictDomain: 'dialog:shared', text: 'rate-limited'},
        {conflictDomain: 'dialog:shared', text: 'ordered-after-retry'},
        {conflictDomain: 'dialog:conflict', text: 'revision-conflict'},
        {conflictDomain: 'dialog:invalid', text: 'invalid-envelope'},
        {conflictDomain: 'dialog:network', text: 'network-failure'}
    ];

    for (const commandInput of commandInputs) {
        //Persisting every command in original user-intent order.
        await outbox.queue({
            operation: 'chat.message.send',
            payload: {
                text: commandInput.text
            },
            baseRevision: 5,
            conflictDomain: commandInput.conflictDomain
        });

    }

    await layerWorkerOutboxConfigure({
        appId: appIdentifier,
        storageName: storage.name,
        apiUrl: '/api',
        csrfToken: 'rotated-worker-csrf',
        applicationOrigin: 'https://app.example.com',
        indexedDb: indexedDB
    });
    const sendAttempts = new Map();
    let csrfHeader = null;
    const workerDrain = layerWorkerOutboxDrainCreate({
        appId: appIdentifier,
        applicationOrigin: 'https://app.example.com',
        indexedDb: indexedDB,
        concurrency: 4,
        requestIdCreate() {
            //Creating a real protocol UUID for each independent attempt.
            return globalThis.crypto.randomUUID();

        },
        ownerIdCreate() {
            //Returning one worker identity for all leases in this drain instance.
            return 'worker-failure-owner';

        },
        async fetchImplementation(_urlData, requestData) {
            //Reading the command identity without trusting test execution order.
            const requestEnvelope = /** @type {Record<string, any>} */ (
                JSON.parse(String(requestData?.body))
            );
            const commandIdentifier = String(requestEnvelope.payload.commandId);
            const commandAttempt = (sendAttempts.get(commandIdentifier) ?? 0) + 1;
            sendAttempts.set(commandIdentifier, commandAttempt);
            csrfHeader = new Headers(requestData?.headers).get('x-layer-csrf');

            if (commandIdentifier === 'worker-failure-1' && commandAttempt === 1) {
                //Returning a valid retryable protocol error with bounded Retry-After.
                return new Response(JSON.stringify({
                    protocol: 1,
                    requestId: requestEnvelope.requestId,
                    ok: false,
                    error: {
                        code: 'RATE_LIMITED',
                        message: 'Retry later.',
                        retryable: true,
                        details: null
                    }
                }), {
                    status: 429,
                    headers: {
                        'content-type': 'application/json',
                        'retry-after': '7'
                    }
                });

            }

            if (commandIdentifier === 'worker-failure-3') {
                //Returning an explicit revision conflict that must block only its domain.
                return new Response(JSON.stringify({
                    protocol: 1,
                    requestId: requestEnvelope.requestId,
                    ok: false,
                    error: {
                        code: 'CONFLICT',
                        message: 'Merge required.',
                        retryable: false,
                        details: {
                            currentRevision: 9
                        }
                    }
                }), {
                    status: 409,
                    headers: {
                        'content-type': 'application/json'
                    }
                });

            }

            if (commandIdentifier === 'worker-failure-4') {
                //Returning an additional root field that the protocol forbids.
                return new Response(JSON.stringify({
                    protocol: 1,
                    requestId: requestEnvelope.requestId,
                    ok: true,
                    data: {},
                    unsafe: true
                }), {
                    status: 200,
                    headers: {
                        'content-type': 'application/json'
                    }
                });

            }

            if (commandIdentifier === 'worker-failure-5' && commandAttempt === 1) {
                //Simulating the TypeError emitted by Fetch for a network failure.
                throw new TypeError('network unavailable');

            }

            //Acknowledging retry attempts and the ordered second command.
            return new Response(JSON.stringify({
                protocol: 1,
                requestId: requestEnvelope.requestId,
                ok: true,
                data: {
                    accepted: true
                }
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json'
                }
            });

        }
    });

    //Checking that only the oldest command in the shared domain entered the first batch.
    assert.deepEqual(await workerDrain(), {
        configured: true,
        claimed: 4,
        confirmed: 0,
        retryable: 2,
        conflicted: 1,
        failed: 1
    });
    assert.equal(csrfHeader, 'rotated-worker-csrf');
    const rateLimitedRecord = /** @type {any} */ (await outbox.get('worker-failure-1'));
    const conflictRecord = /** @type {any} */ (await outbox.get('worker-failure-3'));
    const invalidResponseRecord = /** @type {any} */ (await outbox.get('worker-failure-4'));
    const networkFailureRecord = /** @type {any} */ (await outbox.get('worker-failure-5'));

    assert.equal(rateLimitedRecord.status, 'retryable');
    assert.equal(rateLimitedRecord.failure.retryAfterMs, 7000);
    assert.equal((await outbox.get('worker-failure-2'))?.status, 'queued');
    assert.equal(conflictRecord.status, 'conflict');
    assert.equal(conflictRecord.failure.details.currentRevision, 9);
    assert.equal(invalidResponseRecord.failure.code, 'API_RESPONSE_INVALID');
    assert.equal(networkFailureRecord.failure.code, 'API_NETWORK_FAILED');

    //Confirming retryable domains before the next shared-domain command is eligible.
    assert.deepEqual(await workerDrain(), {
        configured: true,
        claimed: 2,
        confirmed: 2,
        retryable: 0,
        conflicted: 0,
        failed: 0
    });
    assert.equal((await outbox.get('worker-failure-2'))?.status, 'queued');
    assert.deepEqual(await workerDrain(), {
        configured: true,
        claimed: 1,
        confirmed: 1,
        retryable: 0,
        conflicted: 0,
        failed: 0
    });
    assert.equal((await outbox.get('worker-failure-2'))?.status, 'confirmed');

    //Removing both the worker pointer and isolated user database.
    await layerWorkerOutboxConfigurationClear({
        appId: appIdentifier,
        indexedDb: indexedDB
    });
    await storage.purgeUserData();

});

test('worker outbox fails closed for invalid factories, timeouts, and corrupted storage', async function workerFailureBoundaryCheck() {
    //Checking public option validation before any IndexedDB side effect.
    assert.throws(function missingDrainOptionsReject() {
        //Creating a drain without its required application identity.
        layerWorkerOutboxDrainCreate(/** @type {any} */ (null));

    }, TypeError);
    await assert.rejects(function missingConfigurationReject() {
        //Attempting to configure a worker without a contract object.
        return layerWorkerOutboxConfigure(/** @type {any} */ (null));

    }, function configurationErrorCheck(errorData) {
        //Checking the stable configuration failure code.
        return /** @type {any} */ (errorData).code === 'WORKER_OUTBOX_CONFIG_INVALID';

    });
    await assert.rejects(function missingClearOptionsReject() {
        //Attempting logout cleanup without an application identity.
        return layerWorkerOutboxConfigurationClear(/** @type {any} */ (null));

    }, function clearErrorCheck(errorData) {
        //Checking the stable configuration failure code.
        return /** @type {any} */ (errorData).code === 'WORKER_OUTBOX_CONFIG_INVALID';

    });

    const unconfiguredDrain = layerWorkerOutboxDrainCreate({
        appId: `workerempty${namespaceSequence + 1}`,
        applicationOrigin: 'https://app.example.com',
        indexedDb: indexedDB,
        requestIdCreate() {
            //Returning a valid UUID even though no application database is configured.
            return globalThis.crypto.randomUUID();

        },
        ownerIdCreate() {
            //Returning a valid lease owner for the empty-registry result.
            return 'worker-empty-owner';

        },
        async fetchImplementation() {
            //Failing if an unconfigured worker attempts network access.
            throw new Error('Unconfigured workers must not fetch.');

        }
    });

    assert.equal((await unconfiguredDrain()).configured, false);

    //Creating one isolated database for factory, timeout, and corruption checks.
    const appIdentifier = `workerboundary${namespaceSequence + 1}`;
    const storage = await layerStorageOpen({
        appId: appIdentifier,
        namespace: namespaceCreate('worker-boundary'),
        schema: notesSchemaCreate('worker-boundary'),
        indexedDb: indexedDB
    });
    const commandIdentifiers = ['invalid-request-id', 'timeout-command'];
    const outbox = layerOfflineOutboxCreate({
        storage,
        ownerId: 'page-worker-boundary',
        commandIdCreate() {
            //Returning the next explicit command identity for this boundary scenario.
            return String(commandIdentifiers.shift());

        },
        async commandSend() {
            //Failing if this worker-only scenario reaches the page transport.
            throw new Error('The page transport must not run.');

        }
    });

    await layerWorkerOutboxConfigure({
        appId: appIdentifier,
        storageName: storage.name,
        apiUrl: '/api',
        csrfToken: null,
        applicationOrigin: 'https://app.example.com',
        indexedDb: indexedDB
    });
    await outbox.queue({
        operation: 'chat.message.send',
        payload: {
            text: 'Invalid request factory'
        },
        baseRevision: 0,
        conflictDomain: 'dialog:invalid-request'
    });
    const invalidRequestDrain = layerWorkerOutboxDrainCreate({
        appId: appIdentifier,
        applicationOrigin: 'https://app.example.com',
        indexedDb: indexedDB,
        requestIdCreate() {
            //Returning an invalid value to prove the worker does not send it.
            return 'invalid';

        },
        ownerIdCreate() {
            //Returning a valid owner so request validation is the active boundary.
            return 'worker-invalid-request';

        },
        async fetchImplementation() {
            //Failing if an invalid request identifier reaches Fetch.
            throw new Error('Invalid request identifiers must not fetch.');

        }
    });

    assert.equal((await invalidRequestDrain()).failed, 1);
    const invalidRequestRecord = /** @type {any} */ (await outbox.get('invalid-request-id'));
    assert.equal(invalidRequestRecord.failure.code, 'WORKER_REQUEST_ID_INVALID');

    await outbox.queue({
        operation: 'chat.message.send',
        payload: {
            text: 'Timeout request'
        },
        baseRevision: 0,
        conflictDomain: 'dialog:timeout'
    });
    const timeoutDrain = layerWorkerOutboxDrainCreate({
        appId: appIdentifier,
        applicationOrigin: 'https://app.example.com',
        indexedDb: indexedDB,
        timeoutMs: 100,
        requestIdCreate() {
            //Returning a valid request identity for timeout classification.
            return globalThis.crypto.randomUUID();

        },
        ownerIdCreate() {
            //Returning a separate owner for this worker attempt.
            return 'worker-timeout-owner';

        },
        fetchImplementation(_urlData, requestData) {
            //Waiting until the worker aborts the request at its deadline.
            return /** @type {Promise<Response>} */ (new Promise(function timeoutFetchWait(_resolve, reject) {
                requestData?.signal?.addEventListener('abort', function timeoutFetchAbort() {
                    //Rejecting with the browser-compatible abort exception.
                    reject(new DOMException('aborted', 'AbortError'));

                }, {once: true});

            }));

        }
    });

    assert.equal((await timeoutDrain()).retryable, 1);
    const timeoutRecord = /** @type {any} */ (await outbox.get('timeout-command'));
    assert.equal(timeoutRecord.failure.code, 'API_TIMEOUT');
    await outbox.cancel('timeout-command');

    const invalidOwnerDrain = layerWorkerOutboxDrainCreate({
        appId: appIdentifier,
        applicationOrigin: 'https://app.example.com',
        indexedDb: indexedDB,
        requestIdCreate() {
            //Returning a valid request id that must remain unused.
            return globalThis.crypto.randomUUID();

        },
        ownerIdCreate() {
            //Returning an empty owner to reject the drain before claiming records.
            return '';

        },
        async fetchImplementation() {
            //Failing if invalid owner validation occurs after network access.
            throw new Error('Invalid owners must not fetch.');

        }
    });

    await assert.rejects(function invalidOwnerReject() {
        //Starting the drain with an invalid lease owner factory.
        return invalidOwnerDrain();

    }, TypeError);

    //Writing one corrupted engine record to prove the worker quarantines local tampering.
    const rawDatabase = /** @type {IDBDatabase} */ (await new Promise(function rawDatabaseOpenWait(resolve, reject) {
        const openRequest = indexedDB.open(storage.name);
        openRequest.addEventListener('success', function rawDatabaseOpenSuccess() {
            //Returning the second connection without changing its schema.
            resolve(openRequest.result);

        }, {once: true});
        openRequest.addEventListener('error', function rawDatabaseOpenFailure() {
            //Passing an unexpected fixture open failure to the test runner.
            reject(openRequest.error);

        }, {once: true});

    }));
    const corruptionTransaction = rawDatabase.transaction(['__layer_outbox'], 'readwrite');
    const corruptionComplete = new Promise(function corruptionCommitWait(resolve, reject) {
        corruptionTransaction.addEventListener('complete', function corruptionCommitComplete() {
            //Continuing only after the malformed record is durable.
            resolve(undefined);

        }, {once: true});
        corruptionTransaction.addEventListener('error', function corruptionCommitFailure() {
            //Passing an unexpected fixture transaction failure to the test runner.
            reject(corruptionTransaction.error);

        }, {once: true});

    });
    corruptionTransaction.objectStore('__layer_outbox').put({
        commandId: 'corrupted-command',
        operation: 'invalid-operation',
        payload: {},
        baseRevision: 0,
        conflictDomain: 'dialog:corrupted',
        status: 'queued',
        attempts: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        leaseOwner: null,
        leaseUntil: null,
        result: null,
        failure: null,
        supersededBy: null
    });
    await corruptionComplete;
    rawDatabase.close();
    const quarantineDrain = layerWorkerOutboxDrainCreate({
        appId: appIdentifier,
        applicationOrigin: 'https://app.example.com',
        indexedDb: indexedDB,
        requestIdCreate() {
            //Returning a valid request id that corrupted records must not use.
            return globalThis.crypto.randomUUID();

        },
        ownerIdCreate() {
            //Returning a valid owner for the quarantine transaction.
            return 'worker-quarantine-owner';

        },
        async fetchImplementation() {
            //Failing if the corrupted operation reaches the network.
            throw new Error('Corrupted records must not fetch.');

        }
    });

    assert.deepEqual(await quarantineDrain(), {
        configured: true,
        claimed: 0,
        confirmed: 0,
        retryable: 0,
        conflicted: 0,
        failed: 1
    });
    const corruptedRecord = /** @type {any} */ (await outbox.get('corrupted-command'));
    assert.equal(corruptedRecord.failure.code, 'OUTBOX_RECORD_INVALID');

    //Deleting the application database while preserving its worker pointer.
    await storage.purgeUserData();
    await assert.rejects(function missingOutboxStoreReject() {
        //Opening the deleted target as an empty database must fail closed.
        return quarantineDrain();

    }, function missingStoreErrorCheck(errorData) {
        //Checking the stable missing system-store failure code.
        return /** @type {any} */ (errorData).code === 'WORKER_OUTBOX_STORE_MISSING';

    });
    await layerWorkerOutboxConfigurationClear({
        appId: appIdentifier,
        indexedDb: indexedDB
    });

});

test('Share Target capture stores bounded content and consumes it exactly once', async function shareTargetCaptureCheck() {
    //Creating one declared multipart target with deterministic identity and expiration.
    const appIdentifier = 'sharetarget' + String(namespaceSequence + 1);
    const shareIdentifier = '7ec2df78-6db4-4b35-8eb0-b2476bb10030';
    const shareTarget = {
        action: '/share',
        method: 'POST',
        enctype: 'multipart/form-data',
        params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [{
                name: 'files',
                accept: [
                    'image/png',
                    '.png'
                ]
            }]
        }
    };
    const shareCapture = layerWorkerShareTargetCaptureCreate({
        appId: appIdentifier,
        applicationOrigin: 'https://app.example.com',
        shareTarget,
        shareIdCreate() {
            //Returning one opaque identifier for the browser redirect.
            return shareIdentifier;

        },
        clock() {
            //Fixing the capture time for expiration assertions.
            return 1000;

        },
        indexedDb: indexedDB
    });
    const sharedForm = new FormData();

    sharedForm.set('title', 'Shared title');
    sharedForm.set('text', 'Shared message');
    sharedForm.set('url', 'https://example.com/article');
    sharedForm.append('files', new File(['image-bytes'], 'photo.png', {
        type: 'image/png',
        lastModified: 900
    }));

    //Capturing the navigation POST before opening the application route.
    assert.equal(await shareCapture(new Request('https://app.example.com/share', {
        method: 'POST',
        body: sharedForm
    })), shareIdentifier);

    const shareInbox = layerShareTargetInboxCreate({
        appId: appIdentifier,
        clock() {
            //Reading the share inside its ten-minute lifetime.
            return 1001;

        },
        indexedDb: indexedDB
    });
    const sharedRecord = await shareInbox.consume(shareIdentifier);

    //Checking safe metadata, Blob persistence, immutability, and one-time delivery.
    assert.equal(sharedRecord?.title, 'Shared title');
    assert.equal(sharedRecord?.text, 'Shared message');
    assert.equal(sharedRecord?.url, 'https://example.com/article');
    assert.equal(sharedRecord?.files[0]?.name, 'photo.png');
    assert.equal(sharedRecord?.files[0]?.type, 'image/png');
    assert.equal(await sharedRecord?.files[0]?.blob.text(), 'image-bytes');
    assert.equal(Object.isFrozen(sharedRecord), true);
    assert.equal(await shareInbox.consume(shareIdentifier), null);
    await shareInbox.purge();

});

test('Share Target capture rejects foreign, undeclared, oversized, mismatched, and expired data', async function shareTargetBoundaryCheck() {
    const appIdentifier = 'shareboundary' + String(namespaceSequence + 1);
    let currentTime = 5000;
    let shareSequence = 40;
    const shareTarget = {
        action: '/receive',
        method: 'POST',
        enctype: 'multipart/form-data',
        params: {
            text: 'message',
            files: [{
                name: 'attachment',
                accept: ['text/plain']
            }]
        }
    };
    const shareCapture = layerWorkerShareTargetCaptureCreate({
        appId: appIdentifier,
        applicationOrigin: 'https://app.example.com',
        shareTarget,
        shareIdCreate() {
            //Creating a protocol-valid UUID for each isolated rejected or accepted request.
            shareSequence += 1;

            return '7ec2df78-6db4-4b35-8eb0-b2476bb100' + String(shareSequence);

        },
        clock() {
            //Allowing the test to move the inbox across its retention boundary.
            return currentTime;

        },
        indexedDb: indexedDB,
        maximumRequestBytes: 2048,
        maximumFileBytes: 1024,
        maximumTextBytes: 128,
        retentionMs: 100
    });

    await assert.rejects(function foreignShareReject() {
        //Attempting to submit the declared media type from another origin without starting a multipart encoder.
        return shareCapture(new Request('https://foreign.example.com/receive', {
            method: 'POST',
            headers: {
                'content-type': 'multipart/form-data; boundary=layer-foreign'
            }
        }));

    }, function foreignShareErrorCheck(errorData) {
        //Checking the stable manifest mismatch boundary.
        return /** @type {any} */ (errorData).code === 'SHARE_TARGET_REQUEST_INVALID';

    });

    const undeclaredForm = new FormData();
    undeclaredForm.set('message', 'declared');
    undeclaredForm.set('hidden', 'undeclared');
    await assert.rejects(function undeclaredShareReject() {
        //Attempting to persist a form field that the manifest did not declare.
        return shareCapture(new Request('https://app.example.com/receive', {
            method: 'POST',
            body: undeclaredForm
        }));

    }, function undeclaredShareErrorCheck(errorData) {
        //Checking the stable undeclared-field failure.
        return /** @type {any} */ (errorData).code === 'SHARE_TARGET_FIELD_INVALID';

    });

    const mismatchedFileForm = new FormData();
    mismatchedFileForm.append('attachment', new File(['image'], 'photo.png', {
        type: 'image/png'
    }));
    await assert.rejects(function mismatchedFileReject() {
        //Attempting to persist a file outside the manifest accept contract.
        return shareCapture(new Request('https://app.example.com/receive', {
            method: 'POST',
            body: mismatchedFileForm
        }));

    }, function mismatchedFileErrorCheck(errorData) {
        //Checking the stable file contract failure.
        return /** @type {any} */ (errorData).code === 'SHARE_TARGET_FILE_INVALID';

    });

    await assert.rejects(function oversizedShareReject() {
        //Attempting to stream more bytes than the complete request budget without an asynchronous multipart producer.
        return shareCapture(new Request('https://app.example.com/receive', {
            method: 'POST',
            headers: {
                'content-type': 'multipart/form-data; boundary=layer-oversized'
            },
            body: new Uint8Array(4096)
        }));

    }, function oversizedShareErrorCheck(errorData) {
        //Checking the stable request size failure.
        return /** @type {any} */ (errorData).code === 'SHARE_TARGET_SIZE_EXCEEDED';

    });

    const acceptedForm = new FormData();
    acceptedForm.set('message', 'expires');
    const acceptedIdentifier = await shareCapture(new Request('https://app.example.com/receive', {
        method: 'POST',
        body: acceptedForm
    }));
    const shareInbox = layerShareTargetInboxCreate({
        appId: appIdentifier,
        clock() {
            //Reading from the same controllable retention clock.
            return currentTime;

        },
        indexedDb: indexedDB
    });

    currentTime = 5200;
    assert.equal(await shareInbox.consume(acceptedIdentifier), null);
    assert.equal(await shareInbox.discard(acceptedIdentifier), false);
    await assert.rejects(() => shareInbox.consume('invalid'), TypeError);
    await shareInbox.purge();

});
