import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LayerRuntimeError,
    layerApiClientCreate,
    layerApplicationApiCreate,
    layerCommandRuntimeCreate,
    layerEventRuntimeCreate,
    layerEventSubscriptionsCreate,
    layerEventStreamParserCreate,
    layerMultiTabEventsCreate,
    layerPostEventStreamCreate
} from '../src/index.js';

const occurredAt = '2026-09-18T09:00:00.000Z';
const requestIdentifier = '7ec2df78-6db4-4b35-8eb0-b2476bb10010';

/**
 * @param {unknown} dataValue
 * @param {Record<string, unknown>} [metaData]
 */
function successResponseCreate(dataValue, metaData = {}) {
    return new Response(JSON.stringify({
        protocol: 1,
        requestId: requestIdentifier,
        ok: true,
        data: dataValue,
        meta: metaData
    }), {
        status: 200,
        headers: {
            'content-type': 'application/json'
        }
    });
}

/**
 * @param {(commandRecord: Record<string, unknown>) => Promise<unknown>} commandSend
 */
function commandOutboxFixtureCreate(commandSend) {
    const commandRecords = /** @type {Map<string, Record<string, any>>} */ (new Map());
    const commandListeners = /** @type {Map<string, Set<(record: Record<string, unknown> | null) => void>>} */ (new Map());
    let commandSequence = 0;

    function commandPublish(/** @type {string} */ commandIdentifier) {
        const commandRecord = commandRecords.get(commandIdentifier) ?? null;

        for (const listenerHandle of commandListeners.get(commandIdentifier) ?? []) {
            listenerHandle(commandRecord === null ? null : structuredClone(commandRecord));

        }
    }

    return {
        async queue(/** @type {Record<string, any>} */ queueData) {
            commandSequence += 1;
            const commandRecord = {
                ...structuredClone(queueData),
                commandId: `runtime-command-${commandSequence}`,
                status: 'queued',
                result: null,
                failure: null
            };
            commandRecords.set(commandRecord.commandId, commandRecord);

            return structuredClone(commandRecord);
        },
        async get(/** @type {string} */ commandIdentifier) {
            const commandRecord = commandRecords.get(commandIdentifier);

            return commandRecord === undefined ? null : structuredClone(commandRecord);
        },
        watch(
            /** @type {string} */ commandIdentifier,
            /** @type {(record: Record<string, unknown> | null) => void} */ listenerHandle,
            /** @type {{immediate?: boolean}} */ watchOptions = {}
        ) {
            const commandListenerSet = commandListeners.get(commandIdentifier) ?? new Set();
            commandListenerSet.add(listenerHandle);
            commandListeners.set(commandIdentifier, commandListenerSet);

            if (watchOptions.immediate !== false) {
                commandPublish(commandIdentifier);

            }

            return () => commandListenerSet.delete(listenerHandle);
        },
        async drain() {
            const commandRecord = [...commandRecords.values()].find((recordData) => {
                return ['queued', 'retryable'].includes(String(recordData.status));
            });

            if (commandRecord === undefined) {
                return {claimed: 0, confirmed: 0, retryable: 0, conflicted: 0, failed: 0};
            }

            commandRecord.status = 'sending';
            commandPublish(String(commandRecord.commandId));

            try {
                commandRecord.result = await commandSend(commandRecord);
                commandRecord.status = 'confirmed';
                commandPublish(String(commandRecord.commandId));

                return {claimed: 1, confirmed: 1, retryable: 0, conflicted: 0, failed: 0};
            } catch (commandError) {
                const typedError = /** @type {any} */ (commandError);
                commandRecord.status = typedError.status === 409 ? 'conflict' : 'retryable';
                commandRecord.failure = {
                    code: typedError.code,
                    retryable: typedError.retryable === true,
                    details: typedError.details ?? null
                };
                commandPublish(String(commandRecord.commandId));

                return {
                    claimed: 1,
                    confirmed: 0,
                    retryable: commandRecord.status === 'retryable' ? 1 : 0,
                    conflicted: commandRecord.status === 'conflict' ? 1 : 0,
                    failed: 0
                };
            }
        },
        async retry(/** @type {string} */ commandIdentifier) {
            const commandRecord = commandRecords.get(commandIdentifier);

            if (commandRecord === undefined || commandRecord.status !== 'retryable') {
                throw new Error('invalid retry');
            }

            commandRecord.status = 'queued';
            commandRecord.failure = null;
            commandPublish(commandIdentifier);
        },
        async cancel(/** @type {string} */ commandIdentifier) {
            const commandRecord = commandRecords.get(commandIdentifier);

            if (commandRecord === undefined || !['queued', 'retryable', 'conflict'].includes(String(commandRecord.status))) {
                throw new Error('invalid cancel');
            }

            commandRecord.status = 'cancelled';
            commandPublish(commandIdentifier);
        },
        async resolveConflict(
            /** @type {string} */ commandIdentifier,
            /** @type {Record<string, unknown>} */ resolutionData
        ) {
            const commandRecord = commandRecords.get(commandIdentifier);

            if (commandRecord === undefined || commandRecord.status !== 'conflict') {
                throw new Error('invalid conflict');
            }

            commandRecord.status = 'resolved';
            commandPublish(commandIdentifier);
            commandSequence += 1;
            const replacementRecord = {
                ...structuredClone(resolutionData),
                commandId: `runtime-command-${commandSequence}`,
                status: 'queued',
                result: null,
                failure: null
            };
            commandRecords.set(replacementRecord.commandId, replacementRecord);

            return replacementRecord.commandId;
        }
    };
}

/**
 * @param {number} sequence
 */
function eventDataCreate(sequence) {
    return {
        eventId: `event-${sequence}`,
        channel: 'conversation:1',
        sequence,
        entityRevision: sequence,
        type: 'chat.message.created',
        payload: {
            messageId: `message-${sequence}`
        },
        occurredAt
    };
}

test('API client sends validated query, command, and sync envelopes', async () => {
    const requestRecords = /** @type {any[]} */ ([]);
    const apiClient = layerApiClientCreate({
        apiUrl: 'https://app.example.com/api',
        requestIdCreate: () => requestIdentifier,
        csrfTokenGet: async () => 'csrf-value',
        fetchImplementation: async (urlData, requestData) => {
            const typedRequestData = /** @type {RequestInit} */ (requestData ?? {});

            requestRecords.push({
                url: urlData,
                headers: Object.fromEntries(new Headers(typedRequestData.headers).entries()),
                envelope: JSON.parse(String(typedRequestData.body))
            });

            return successResponseCreate({accepted: true}, {serverTime: occurredAt});
        }
    });
    const queryResult = await apiClient.query('chat.messages.list', {dialogId: 'dialog-1'});
    const commandResult = await apiClient.command('chat.message.send', {
        dialogId: 'dialog-1',
        text: 'Hello'
    }, {
        commandId: 'command-1',
        baseRevision: 4
    });
    await apiClient.sync('chat.dialog.sync', {dialogId: 'dialog-1'}, {
        cursor: 'cursor-4'
    });

    assert.equal(queryResult.status, 'network');
    assert.equal(queryResult.stale, false);
    assert.deepEqual(queryResult.data, {accepted: true});
    assert.equal(commandResult.meta.serverTime, occurredAt);
    assert.equal(requestRecords[0].url, 'https://app.example.com/api');
    assert.equal(requestRecords[0].headers['x-layer-csrf'], 'csrf-value');
    assert.equal(requestRecords[0].envelope.type, 'query');
    assert.equal(requestRecords[1].envelope.payload.commandId, 'command-1');
    assert.equal(requestRecords[1].envelope.payload.baseRevision, 4);
    assert.equal(requestRecords[2].envelope.type, 'sync');
    assert.equal(requestRecords[2].envelope.cursor, 'cursor-4');
});

test('API client preserves safe server errors and retry guidance', async () => {
    const apiClient = layerApiClientCreate({
        requestIdCreate: () => requestIdentifier,
        fetchImplementation: async () => new Response(JSON.stringify({
            protocol: 1,
            requestId: requestIdentifier,
            ok: false,
            error: {
                code: 'REVISION_CONFLICT',
                message: 'Revision changed.',
                retryable: false,
                details: {
                    currentRevision: 5
                }
            }
        }), {
            status: 409,
            headers: {
                'content-type': 'application/json',
                'retry-after': '2'
            }
        })
    });

    await assert.rejects(() => apiClient.query('chat.messages.list', {}), (errorData) => {
        return errorData instanceof LayerRuntimeError &&
            errorData.code === 'REVISION_CONFLICT' &&
            errorData.requestId === requestIdentifier &&
            errorData.status === 409 &&
            errorData.retryAfterMs === 2000 &&
            errorData.details?.currentRevision === 5;
    });
});

test('API client rejects invalid media, JSON, identity, and oversized responses', async () => {
    const baseOptions = {
        requestIdCreate: () => requestIdentifier
    };
    const mediaClient = layerApiClientCreate({
        ...baseOptions,
        fetchImplementation: async () => new Response('text', {
            headers: {'content-type': 'text/plain'}
        })
    });
    const jsonClient = layerApiClientCreate({
        ...baseOptions,
        fetchImplementation: async () => new Response('{', {
            headers: {'content-type': 'application/json'}
        })
    });
    const mismatchClient = layerApiClientCreate({
        ...baseOptions,
        fetchImplementation: async () => new Response(JSON.stringify({
            protocol: 1,
            requestId: '7ec2df78-6db4-4b35-8eb0-b2476bb10011',
            ok: true,
            data: {}
        }), {
            headers: {'content-type': 'application/json'}
        })
    });
    const oversizedClient = layerApiClientCreate({
        ...baseOptions,
        maximumResponseBytes: 1024,
        fetchImplementation: async () => new Response('{}', {
            headers: {
                'content-length': '2048',
                'content-type': 'application/json'
            }
        })
    });

    await assert.rejects(() => mediaClient.query('chat.messages.list', {}), (errorData) => {
        return /** @type {any} */ (errorData).code === 'API_RESPONSE_MEDIA_INVALID';
    });
    await assert.rejects(() => jsonClient.query('chat.messages.list', {}), (errorData) => {
        return /** @type {any} */ (errorData).code === 'API_RESPONSE_INVALID';
    });
    await assert.rejects(() => mismatchClient.query('chat.messages.list', {}), (errorData) => {
        return /** @type {any} */ (errorData).code === 'API_RESPONSE_MISMATCH';
    });
    await assert.rejects(() => oversizedClient.query('chat.messages.list', {}), (errorData) => {
        return /** @type {any} */ (errorData).code === 'API_RESPONSE_TOO_LARGE';
    });
});

test( 'API client never sends a pre-cancelled request or one cancelled during CSRF lookup', async function(){
    let tokenCallsData = 0;
    let fetchCallsData = 0;
    let tokenResolveData = /** @type {(valueData: string) => void} */ (function(){
        //Leaving the resolver inactive until the pending CSRF lookup installs its callback

    });
    const clientData = layerApiClientCreate({
        requestIdCreate(){
            //Keeping request identity deterministic across both cancellation scenarios
            return requestIdentifier;

        },
        csrfTokenGet(){
            //Holding only the asynchronous token lookup, before fetch owns any transport
            tokenCallsData += 1;
            return new Promise(function( resolveData ){
                //Exposing the pending token lookup so the test can cancel before resolving it
                tokenResolveData = resolveData;

            });

        },
        async fetchImplementation(){
            //Any invocation means a cancelled command could have escaped to the server
            fetchCallsData += 1;
            throw new Error( 'Cancelled request reached fetch' );

        }
    });
    const preCancelledData = new AbortController();
    preCancelledData.abort( 'private cancellation reason' );
    await assert.rejects( clientData.query( 'chat.messages.list', {}, {signal: preCancelledData.signal} ), {code: 'API_ABORTED'} );
    assert.equal( tokenCallsData, 0 );
    assert.equal( fetchCallsData, 0 );
    const duringTokenData = new AbortController();
    const pendingData = clientData.command( 'chat.message.send', {text: 'never sent'}, {
        commandId: 'cancelled-command', baseRevision: 0, signal: duringTokenData.signal
    });
    duringTokenData.abort();
    tokenResolveData( 'csrf-token' );
    await assert.rejects( pendingData, {code: 'API_ABORTED'} );
    assert.equal( tokenCallsData, 1 );
    assert.equal( fetchCallsData, 0 );

});

test('API client normalizes timeout, abort, network, and caller contract failures', async () => {
    const timeoutClient = layerApiClientCreate({
        requestIdCreate: () => requestIdentifier,
        timeoutMs: 100,
        fetchImplementation: async (_urlData, requestData) => new Promise((_resolve, reject) => {
            const requestSignal = /** @type {AbortSignal} */ (requestData?.signal);
            requestSignal.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
        })
    });
    const networkClient = layerApiClientCreate({
        requestIdCreate: () => requestIdentifier,
        fetchImplementation: async () => {
            throw new Error('offline');
        }
    });

    await assert.rejects(() => timeoutClient.query('chat.messages.list', {}), (errorData) => {
        return /** @type {any} */ (errorData).code === 'API_TIMEOUT';
    });
    await assert.rejects(() => networkClient.query('chat.messages.list', {}), (errorData) => {
        return /** @type {any} */ (errorData).code === 'API_NETWORK_FAILED';
    });
    assert.throws(() => layerApiClientCreate(/** @type {any} */ (null)), TypeError);
    await assert.rejects(() => layerApiClientCreate({
        requestIdCreate: () => 'invalid'
    }).query('chat.messages.list', {}), TypeError);
    await assert.rejects(() => networkClient.command('chat.message.send', {commandId: 'ambiguous'}, {
        commandId: 'command-2',
        baseRevision: 0
    }), TypeError);
});

test('command runtime persists before send and exposes a live completion handle', async () => {
    let onlineStatus = false;
    let backgroundRegistrationCount = 0;
    const optimisticRecords = [];
    const outbox = commandOutboxFixtureCreate(async (commandRecord) => ({
        accepted: true,
        commandId: commandRecord.commandId
    }));
    const commandRuntime = layerCommandRuntimeCreate({
        outbox,
        onlineGet: () => onlineStatus,
        optimisticApply(commandRecord) {
            optimisticRecords.push(commandRecord);
        },
        async backgroundSyncRegister() {
            backgroundRegistrationCount += 1;
        }
    });
    const commandHandle = await commandRuntime.command('chat.message.send', {
        text: 'Offline first'
    }, {
        offline: 'queue',
        baseRevision: 7,
        conflictDomain: 'dialog:7',
        optimisticPatch: {
            pending: true
        }
    });

    assert.equal(commandHandle.state, 'queued');
    assert.equal(backgroundRegistrationCount, 1);
    assert.equal(optimisticRecords.length, 1);
    assert.equal(commandHandle.snapshot().conflictDomain, 'dialog:7');

    onlineStatus = true;
    assert.deepEqual(await commandRuntime.drain(), {
        claimed: 1,
        confirmed: 1,
        retryable: 0,
        conflicted: 0,
        failed: 0
    });
    assert.equal(commandHandle.state, 'confirmed');
    assert.deepEqual(await commandHandle.result, {
        accepted: true,
        commandId: commandHandle.commandId
    });
    const onlineCommandHandle = await commandRuntime.command('chat.message.send', {
        text: 'Online with worker fallback'
    }, {
        offline: 'queue',
        baseRevision: 8
    });

    assert.equal(backgroundRegistrationCount, 2);
    assert.equal(onlineCommandHandle.snapshot().conflictDomain, 'chat:message:send');
    assert.deepEqual(await onlineCommandHandle.result, {
        accepted: true,
        commandId: onlineCommandHandle.commandId
    });
    assert.equal(commandHandle.dispose(), true);
    assert.equal(commandHandle.dispose(), false);
    assert.equal(onlineCommandHandle.dispose(), true);
});

test('command runtime supports cancellation, retry, and explicit conflict replacement', async () => {
    let onlineStatus = false;
    let retryAttempt = 0;
    const outbox = commandOutboxFixtureCreate(async (commandRecord) => {
        if (commandRecord.operation === 'chat.retry.send' && retryAttempt === 0) {
            retryAttempt += 1;
            throw Object.assign(new Error('temporary'), {
                code: 'DEPENDENCY_UNAVAILABLE',
                retryable: true
            });
        }

        if (commandRecord.operation === 'chat.conflict.send') {
            throw Object.assign(new Error('conflict'), {
                code: 'REVISION_CONFLICT',
                status: 409,
                details: {
                    currentRevision: 9
                }
            });
        }

        return {accepted: true};
    });
    const commandRuntime = layerCommandRuntimeCreate({
        outbox,
        onlineGet: () => onlineStatus
    });
    const cancelledHandle = await commandRuntime.command('chat.cancel.send', {}, {
        offline: 'queue',
        baseRevision: 0
    });

    await cancelledHandle.cancel();
    assert.equal(cancelledHandle.state, 'cancelled');
    await assert.rejects(cancelledHandle.result, (errorData) => {
        return /** @type {any} */ (errorData).code === 'COMMAND_CANCELLED';
    });

    onlineStatus = true;
    const retryHandle = await commandRuntime.command('chat.retry.send', {}, {
        offline: 'queue',
        baseRevision: 1
    });
    await commandRuntime.drain();
    assert.equal(retryHandle.state, 'retryable');
    await retryHandle.retry();
    assert.deepEqual(await retryHandle.result, {accepted: true});

    const conflictHandle = await commandRuntime.command('chat.conflict.send', {}, {
        offline: 'queue',
        baseRevision: 2,
        conflictDomain: 'dialog:conflict'
    });
    await commandRuntime.drain();
    assert.equal(conflictHandle.state, 'conflict');
    assert.deepEqual(conflictHandle.conflict, {currentRevision: 9});
    const replacementHandle = await conflictHandle.resolveConflict({
        operation: 'chat.message.send',
        payload: {
            text: 'Merged'
        },
        baseRevision: 9,
        conflictDomain: 'dialog:conflict'
    });

    assert.equal(conflictHandle.state, 'resolved');
    await assert.rejects(conflictHandle.result, (errorData) => {
        return /** @type {any} */ (errorData).code === 'REVISION_CONFLICT';
    });
    assert.deepEqual(await replacementHandle.result, {accepted: true});
    await assert.rejects(() => commandRuntime.command('chat.online.send', {}, {
        offline: /** @type {any} */ ('invalid'),
        baseRevision: 0
    }), TypeError);
    onlineStatus = false;
    await assert.rejects(() => commandRuntime.command('chat.online.send', {}, {
        offline: 'reject',
        baseRevision: 0
    }), (errorData) => {
        return /** @type {any} */ (errorData).code === 'COMMAND_OFFLINE';
    });
});

test('application API publishes query snapshots and reuses the persistent cache', async () => {
    const cacheRecords = new Map();
    const failureRecords = [];
    let requestCount = 0;
    let currentTime = 100;
    const applicationApi = layerApplicationApiCreate({
        async queryRequest(operationName, payloadData) {
            requestCount += 1;

            return Object.freeze({
                data: {
                    items: [{id: requestCount, operationName, payloadData}]
                },
                meta: {
                    revision: requestCount
                }
            });
        },
        async commandRun() {
            throw new Error('Command not expected.');
        },
        async syncRun() {
            return Object.freeze({data: {synced: true}});
        },
        async queryCacheGet(cacheKey, timeData = currentTime) {
            const cacheRecord = cacheRecords.get(cacheKey);

            if (cacheRecord === undefined) {
                return Object.freeze({hit: false, stale: false, data: null, revision: null});
            }

            return Object.freeze({
                hit: true,
                stale: cacheRecord.expiresAt <= timeData,
                data: structuredClone(cacheRecord.data),
                revision: cacheRecord.revision
            });
        },
        async queryCachePut(cacheKey, cacheData, cacheOptions) {
            cacheRecords.set(cacheKey, {
                data: structuredClone(cacheData),
                ...cacheOptions
            });
        },
        timeGet: () => currentTime,
        failureHandle(failureData) {
            failureRecords.push(failureData);
        }
    });
    const queryHandle = applicationApi.query({
        operation: 'chat.messages.list',
        payload: () => ({conversationId: 7}),
        cache: {
            policy: 'cache-and-network',
            maxAgeMs: 1000
        },
        offline: {
            fallback: 'cache'
        }
    });
    const querySnapshots = /** @type {any[]} */ ([]);
    const queryListenerDispose = queryHandle.subscribe((snapshotData) => {
        querySnapshots.push(snapshotData);
    });

    await queryHandle.settled();
    assert.equal(requestCount, 1);
    assert.equal(queryHandle.snapshot().status, 'success');
    assert.equal(queryHandle.snapshot().source, 'network');
    assert.equal(/** @type {any} */ (queryHandle.snapshot().data).items[0].id, 1);
    assert.equal(cacheRecords.size, 1);
    assert.equal(querySnapshots.some((snapshotData) => snapshotData.pending === false), true);

    currentTime = 200;
    const cachedQueryHandle = applicationApi.query({
        operation: 'chat.messages.list',
        payload: {conversationId: 7},
        cache: {
            policy: 'cache-first',
            maxAgeMs: 1000
        }
    });

    await cachedQueryHandle.settled();
    assert.equal(requestCount, 1);
    assert.equal(cachedQueryHandle.snapshot().source, 'cache');
    await cachedQueryHandle.cacheInsert({id: 2});
    assert.equal(/** @type {any} */ (cachedQueryHandle.snapshot().data).items.length, 2);
    await cachedQueryHandle.cacheRemove((itemData) => /** @type {any} */ (itemData).id === 1);
    assert.deepEqual(/** @type {any} */ (cachedQueryHandle.snapshot().data).items, [{id: 2}]);
    assert.deepEqual(await applicationApi.sync('chat.messages.sync', {}, {}), {
        data: {synced: true}
    });
    assert.equal(queryListenerDispose(), true);
    assert.equal(queryHandle.dispose(), true);
    assert.equal(queryHandle.dispose(), false);
    applicationApi.dispose();
    assert.equal(failureRecords.length, 0);
});

test('application API uses cache only for recoverable offline query failures', async () => {
    let onlineStatus = false;
    let requestError = new LayerRuntimeError('API_NETWORK_FAILED', 'Offline.', {
        retryable: true
    });
    const applicationApi = layerApplicationApiCreate({
        async queryRequest() {
            throw requestError;
        },
        async commandRun() {
            throw new Error('Command not expected.');
        },
        async syncRun() {
            return {};
        },
        async queryCacheGet() {
            return Object.freeze({
                hit: true,
                stale: false,
                data: {items: [{id: 'cached'}]},
                revision: 1
            });
        },
        async queryCachePut() {},
        onlineGet: () => onlineStatus
    });
    const offlineQuery = applicationApi.query({
        operation: 'chat.messages.list',
        payload: {},
        offline: {fallback: 'cache'}
    });

    assert.deepEqual(await offlineQuery.settled(), {items: [{id: 'cached'}]});
    assert.equal(offlineQuery.snapshot().status, 'stale');
    assert.equal(/** @type {any} */ (offlineQuery.snapshot().error).code, 'QUERY_OFFLINE');

    onlineStatus = true;
    requestError = new LayerRuntimeError('AUTH_REQUIRED', 'Authentication required.', {
        status: 401,
        retryable: false
    });
    const unauthorizedQuery = applicationApi.query({
        operation: 'chat.private.list',
        payload: {},
        offline: {fallback: 'cache'}
    });

    await assert.rejects(unauthorizedQuery.settled(), (errorData) => {
        return /** @type {any} */ (errorData).code === 'AUTH_REQUIRED';
    });
    assert.equal(unauthorizedQuery.snapshot().status, 'error');
    assert.throws(() => applicationApi.query({
        operation: 'invalid',
        payload: {}
    }), TypeError);
    applicationApi.dispose();
});

test('application API command signals apply and rollback optimistic cache changes', async () => {
    const commandError = new LayerRuntimeError('REVISION_CONFLICT', 'Conflict.', {
        status: 409,
        details: {currentRevision: 8}
    });
    let commandOptionsRecord = /** @type {Record<string, any> | null} */ (null);
    let handleDisposed = false;
    let rollbackToken;
    const applicationApi = layerApplicationApiCreate({
        async queryRequest() {
            return Object.freeze({
                data: {
                    items: [{id: 'confirmed', text: 'Saved'}]
                },
                meta: {}
            });
        },
        async commandRun(_operationName, _payloadData, commandOptions) {
            commandOptionsRecord = commandOptions;

            return Object.freeze({
                commandId: 'command-optimistic-1',
                state: 'conflict',
                result: Promise.reject(commandError),
                async cancel() {},
                dispose() {
                    handleDisposed = true;
                }
            });
        },
        async syncRun() {
            return {};
        },
        async queryCacheGet() {
            return Object.freeze({hit: false, stale: false, data: null, revision: null});
        },
        async queryCachePut() {}
    });
    const queryHandle = applicationApi.query({
        operation: 'chat.messages.list',
        payload: {},
        cache: {policy: 'no-store'}
    });
    await queryHandle.settled();
    const commandHandle = applicationApi.command({
        operation: 'chat.message.send',
        offline: {strategy: 'outbox'},
        optimistic: {
            async apply(
                /** @type {Record<string, any>} */ commandPayload,
                /** @type {Record<string, any>} */ queryCache
            ) {
                await queryCache.insert('chat.messages.list', {
                    id: commandPayload.commandId,
                    commandId: commandPayload.commandId,
                    text: commandPayload.text
                });

                return commandPayload.commandId;
            },
            async rollback(
                /** @type {unknown} */ _operationError,
                /** @type {Record<string, any>} */ queryCache,
                /** @type {unknown} */ optimisticCommandId
            ) {
                rollbackToken = String(optimisticCommandId);
                await queryCache.removeByCommandId(String(optimisticCommandId));
            }
        }
    });
    const commandSnapshots = /** @type {any[]} */ ([]);
    commandHandle.subscribe((snapshotData) => commandSnapshots.push(snapshotData));

    await assert.rejects(() => commandHandle.execute({
        text: 'Pending',
        baseRevision: 7
    }), (errorData) => {
        return /** @type {any} */ (errorData).code === 'REVISION_CONFLICT';
    });
    assert.equal(/** @type {Record<string, any>} */ (commandOptionsRecord).offline, 'queue');
    assert.equal(/** @type {Record<string, any>} */ (commandOptionsRecord).baseRevision, 7);
    assert.equal(rollbackToken, 'command-optimistic-1');
    assert.deepEqual(/** @type {any} */ (queryHandle.snapshot().data).items, [{id: 'confirmed', text: 'Saved'}]);
    assert.equal(commandHandle.snapshot().pending, false);
    assert.equal(/** @type {any} */ (commandHandle.snapshot().error).code, 'REVISION_CONFLICT');
    assert.equal(commandSnapshots.some((snapshotData) => snapshotData.state === 'persisting'), true);
    applicationApi.dispose();
    assert.equal(commandHandle.dispose(), false);
    assert.equal(handleDisposed, true);
});

test('event subscriptions restart only when the active channel set changes', async () => {
    const runtimeRecords = /** @type {any[]} */ ([]);
    const receivedEvents = /** @type {any[]} */ ([]);
    const subscriptions = layerEventSubscriptionsCreate({
        runtimeCreate(runtimeData) {
            const runtimeRecord = {
                channels: [...runtimeData.channels],
                receive: runtimeData.eventReceive,
                startCount: 0,
                stopCount: 0
            };
            runtimeRecords.push(runtimeRecord);

            return {
                start() {
                    runtimeRecord.startCount += 1;
                },
                stop() {
                    runtimeRecord.stopCount += 1;
                }
            };
        }
    });
    const firstDispose = subscriptions.subscribe('dialog:42', (eventData) => {
        receivedEvents.push(['first', eventData.eventId]);
    });
    const secondDispose = subscriptions.subscribe('dialog:42', (eventData) => {
        receivedEvents.push(['second', eventData.eventId]);
    });

    await subscriptions.ready();
    assert.deepEqual(subscriptions.list(), ['dialog:42']);
    assert.deepEqual(runtimeRecords[0].channels, ['dialog:42']);
    assert.equal(runtimeRecords[0].startCount, 1);
    await runtimeRecords[0].receive({
        eventId: 'event-1',
        channel: 'dialog:42'
    });
    assert.deepEqual(receivedEvents, [
        ['first', 'event-1'],
        ['second', 'event-1']
    ]);
    assert.equal(firstDispose(), true);
    assert.equal(firstDispose(), false);
    await subscriptions.ready();
    assert.equal(runtimeRecords.length, 1);
    assert.equal(secondDispose(), true);
    await subscriptions.ready();
    assert.equal(runtimeRecords[0].stopCount, 1);
    assert.deepEqual(subscriptions.list(), []);
    assert.equal(await subscriptions.stop(), true);
    assert.equal(await subscriptions.stop(), false);
    assert.throws(() => subscriptions.subscribe('dialog:42', () => {}), /stopped/);
});

test('SSE parser handles chunks, multiline data, comments, and bounds', async () => {
    const events = /** @type {any[]} */ ([]);
    const comments = /** @type {string[]} */ ([]);
    const parser = layerEventStreamParserCreate({
        eventHandle(eventData) {
            events.push(eventData);
        },
        commentHandle(commentData) {
            comments.push(commentData);
        },
        maximumBufferBytes: 128
    });

    await parser.feed(': heartbeat\r\nid: event-1\nevent: layer.event\ndata: {"one":\n');
    await parser.feed('data: true}\nignored: field\n\n');
    await parser.finish();

    assert.deepEqual(comments, [
        'heartbeat'
    ]);
    assert.deepEqual(events, [
        {
            id: 'event-1',
            event: 'layer.event',
            data: '{"one":\ntrue}'
        }
    ]);

    const boundedParser = layerEventStreamParserCreate({
        eventHandle() {},
        maximumBufferBytes: 4
    });

    await assert.rejects(() => boundedParser.feed('12345'), RangeError);
});

test('POST event stream sends the protocol envelope and dispatches records', async () => {
    const requestCalls = /** @type {any[]} */ ([]);
    const eventData = eventDataCreate(1);
    const encodedStream = new TextEncoder().encode(
        `: heartbeat\n\nid: ${eventData.eventId}\nevent: layer.event\ndata: ${JSON.stringify(eventData)}\n\n` +
        'event: layer.control\ndata: {"type":"server-drain","retryAfterMs":500}\n\n'
    );
    const stream = layerPostEventStreamCreate({
        apiUrl: 'https://app.example.com/api',
        requestIdCreate: () => '7ec2df78-6db4-4b35-8eb0-b2476bb10004',
        csrfTokenGet: () => 'csrf-token',
        fetchImplementation: async (urlData, requestData) => {
            requestCalls.push({urlData, requestData});

            return new Response(new ReadableStream({
                start(controller) {
                    controller.enqueue(encodedStream.slice(0, 24));
                    controller.enqueue(encodedStream.slice(24));
                    controller.close();
                }
            }), {
                status: 200,
                headers: {
                    'content-type': 'text/event-stream; charset=utf-8'
                }
            });
        }
    });
    const receivedEvents = /** @type {any[]} */ ([]);
    const receivedControls = /** @type {any[]} */ ([]);
    let heartbeatCount = 0;

    await stream.open({
        channels: [
            'conversation:1'
        ],
        cursor: {
            'conversation:1': 0
        },
        signal: new AbortController().signal,
        eventHandle(receivedEvent) {
            receivedEvents.push(receivedEvent);
        },
        controlHandle(controlData) {
            receivedControls.push(controlData);
        },
        heartbeatHandle: () => {
            heartbeatCount += 1;
        }
    });

    const sentRequest = requestCalls[0].requestData;
    const sentEnvelope = JSON.parse(sentRequest.body);

    assert.equal(requestCalls[0].urlData, 'https://app.example.com/api');
    assert.equal(sentRequest.method, 'POST');
    assert.equal(sentRequest.headers.get('x-layer-csrf'), 'csrf-token');
    assert.equal(sentEnvelope.type, 'events.open');
    assert.deepEqual(sentEnvelope.cursor, {
        'conversation:1': 0
    });
    assert.deepEqual(receivedEvents, [
        eventData
    ]);
    assert.equal(receivedControls[0].type, 'server-drain');
    assert.equal(heartbeatCount, 1);
});

test('POST event stream normalizes HTTP, media, JSON, and inactivity failures', async () => {
    const baseOptions = {
        apiUrl: 'https://app.example.com/api',
        requestIdCreate: () => '7ec2df78-6db4-4b35-8eb0-b2476bb10005'
    };
    const openData = {
        channels: [
            'conversation:1'
        ],
        cursor: {
            'conversation:1': 0
        },
        signal: new AbortController().signal,
        eventHandle() {},
        controlHandle() {}
    };
    const httpStream = layerPostEventStreamCreate({
        ...baseOptions,
        fetchImplementation: async () => new Response(JSON.stringify({
            error: {
                code: 'RATE_LIMITED',
                message: 'Wait.',
                retryable: true
            }
        }), {
            status: 429,
            headers: {
                'content-type': 'application/json',
                'retry-after': '2'
            }
        })
    });

    await assert.rejects(() => httpStream.open(openData), (errorData) => {
        return errorData instanceof LayerRuntimeError &&
            errorData.code === 'RATE_LIMITED' &&
            errorData.retryAfterMs === 2000;
    });

    const mediaStream = layerPostEventStreamCreate({
        ...baseOptions,
        fetchImplementation: async () => new Response('{}', {
            status: 200,
            headers: {
                'content-type': 'application/json'
            }
        })
    });

    await assert.rejects(() => mediaStream.open(openData), (errorData) => {
        return /** @type {any} */ (errorData).code === 'STREAM_INVALID_RESPONSE';
    });

    const invalidRecordStream = layerPostEventStreamCreate({
        ...baseOptions,
        fetchImplementation: async () => new Response('event: layer.event\ndata: {\n\n', {
            status: 200,
            headers: {
                'content-type': 'text/event-stream'
            }
        })
    });

    await assert.rejects(() => invalidRecordStream.open(openData), (errorData) => {
        return /** @type {any} */ (errorData).code === 'STREAM_EVENT_INVALID';
    });

    let cancelledStatus = false;
    const inactiveStream = layerPostEventStreamCreate({
        ...baseOptions,
        inactivityTimeoutMs: 5,
        fetchImplementation: async () => new Response(new ReadableStream({
            cancel() {
                cancelledStatus = true;
            }
        }), {
            status: 200,
            headers: {
                'content-type': 'text/event-stream'
            }
        })
    });

    await assert.rejects(() => inactiveStream.open(openData), (errorData) => {
        return /** @type {any} */ (errorData).code === 'STREAM_INACTIVE';
    });
    assert.equal(cancelledStatus, true);
});

test('event runtime applies sequential events and invokes sync for gaps and snapshots', async () => {
    const durableCursor = /** @type {Record<string, number>} */ ({
        'conversation:1': 0
    });
    const appliedSequences = /** @type {number[]} */ ([]);
    const syncCalls = [];
    const observedSequences = /** @type {number[]} */ ([]);
    const runtime = layerEventRuntimeCreate({
        channels: [
            'conversation:1'
        ],
        stream: {
            async open(/** @type {any} */ streamData) {
                await streamData.eventHandle(eventDataCreate(1));
                await streamData.eventHandle(eventDataCreate(1));
                await streamData.eventHandle(eventDataCreate(3));
                await streamData.controlHandle({
                    type: 'snapshot-required',
                    channels: [
                        'conversation:1'
                    ]
                });
                await streamData.heartbeatHandle();
            }
        },
        cursorRead: () => durableCursor,
        cursorWrite(channelName, sequence) {
            durableCursor[channelName] = sequence;
        },
        eventApply(eventData) {
            appliedSequences.push(/** @type {number} */ (eventData.sequence));
        },
        syncHandle(gapData) {
            syncCalls.push(gapData);
            durableCursor[gapData.channel] = gapData.cursor < gapData.receivedSequence ? 2 : 3;
        },
        failureHandle: () => false,
        random: () => 0.5
    });

    await assert.rejects(() => runtime.run({
        signal: new AbortController().signal,
        eventObserve(eventData) {
            observedSequences.push(/** @type {number} */ (eventData.sequence));
        }
    }), (errorData) => /** @type {any} */ (errorData).code === 'STREAM_DISCONNECTED');

    assert.deepEqual(appliedSequences, [
        1,
        3
    ]);
    assert.deepEqual(observedSequences, [
        1,
        1,
        3
    ]);
    assert.equal(syncCalls.length, 2);
    assert.equal(durableCursor['conversation:1'], 3);
});

test('event runtime fails closed for unknown channels and unresolved gaps', async () => {
    const runtime = layerEventRuntimeCreate({
        channels: [
            'conversation:1'
        ],
        stream: {
            async open(/** @type {any} */ streamData) {
                await streamData.eventHandle({
                    ...eventDataCreate(2),
                    channel: 'unknown'
                });
            }
        },
        cursorRead: () => ({
            'conversation:1': 0
        }),
        cursorWrite() {},
        eventApply() {},
        syncHandle() {},
        failureHandle: () => false
    });

    await assert.rejects(() => runtime.run({
        signal: new AbortController().signal
    }), (errorData) => /** @type {any} */ (errorData).code === 'STREAM_EVENT_INVALID');
});

test('multi-tab coordinator falls back to one stream per tab', async () => {
    let streamStarts = 0;
    const coordinator = layerMultiTabEventsCreate({
        originKey: 'app.example.com',
        channels: [
            'conversation:1'
        ],
        cursorRead: () => ({
            'conversation:1': 4
        }),
        eventReceive() {},
        streamRun: async ({signal, initialCursor}) => {
            streamStarts += 1;
            assert.equal(initialCursor['conversation:1'], 4);
            await new Promise((resolve) => signal.addEventListener('abort', resolve, {once: true}));
        },
        tabIdCreate: () => 'tab-1'
    });

    assert.equal(coordinator.isStarted(), false);
    await coordinator.start();
    assert.equal(coordinator.isStarted(), true);
    await assert.rejects(() => coordinator.start(), /already started/);
    await coordinator.stop();
    await coordinator.stop();
    assert.equal(coordinator.isStarted(), false);
    assert.equal(streamStarts, 1);
});

test('multi-tab leader starts from the minimum peer cursor and broadcasts events', async () => {
    const postedMessages = /** @type {any[]} */ ([]);
    let messageHandle = /** @type {((messageData: {data: Record<string, unknown>}) => void | Promise<void>) | undefined} */ (undefined);
    let receivedInitialCursor;
    let receivedRequestCursor;
    const channel = {
        postMessage(/** @type {any} */ messageData) {
            postedMessages.push(messageData);

            if (messageData.type === 'cursor-request') {
                queueMicrotask(() => messageHandle?.({
                    data: {
                        type: 'cursor',
                        tabId: 'tab-2',
                        cursor: {
                            'conversation:1': 2
                        }
                    }
                }));
            }
        },
        addEventListener(/** @type {string} */ _eventName, /** @type {any} */ handlerData) {
            messageHandle = handlerData;
        },
        removeEventListener() {},
        close() {}
    };
    const coordinator = layerMultiTabEventsCreate({
        originKey: 'app.example.com',
        channels: [
            'conversation:1'
        ],
        cursorRead: () => ({
            'conversation:1': 5
        }),
        eventReceive() {},
        streamRun: async ({signal, initialCursor, requestCursor, eventObserve}) => {
            receivedInitialCursor = initialCursor;
            receivedRequestCursor = requestCursor;
            await eventObserve(eventDataCreate(3));
            await new Promise((resolve) => signal.addEventListener('abort', resolve, {once: true}));
        },
        lockManager: {
            request: async (_lockName, _lockOptions, callback) => callback({})
        },
        broadcastChannelCreate: () => channel,
        tabIdCreate: () => 'tab-1',
        peerCollectionMs: 1
    });

    await coordinator.start();

    while (receivedInitialCursor === undefined) {
        await new Promise((resolve) => setImmediate(resolve));
    }

    assert.equal(receivedInitialCursor['conversation:1'], 5);
    assert.equal(receivedRequestCursor?.['conversation:1'], 2);
    assert.ok(postedMessages.some((messageData) => messageData.type === 'event'));
    await coordinator.stop();
});

test('LayerRuntimeError exposes stable recovery fields', () => {
    const internalCause = new Error('internal');
    const runtimeError = new LayerRuntimeError('STREAM_FAILED', 'Stream failed.', {
        cause: internalCause,
        status: 503,
        retryAfterMs: 1500,
        retryable: true
    });

    assert.equal(runtimeError.name, 'LayerRuntimeError');
    assert.equal(runtimeError.code, 'STREAM_FAILED');
    assert.equal(runtimeError.status, 503);
    assert.equal(runtimeError.retryAfterMs, 1500);
    assert.equal(runtimeError.retryable, true);
    assert.equal(runtimeError.requestId, null);
    assert.equal(runtimeError.cause, internalCause);
});

test('application API does not report lifecycle cancellation as a global failure', async function(){
    const failureRecords = /** @type {Array<Record<string, unknown>>} */ ([]);
    /** @type {(value?: void) => void} */
    let requestStartedResolve;
    const requestStartedData = new Promise(function requestStarted( resolve ){
        //Exposing the exact moment when the cancellable transport starts.
        requestStartedResolve = resolve;

    });
    const applicationApi = layerApplicationApiCreate({
        async queryRequest( _operationName, _payloadData, requestOptions ){
            //Opening one pending transport owned by the query lifecycle.
            requestStartedResolve();
            const requestSignalData = requestOptions?.signal;

            if ( requestSignalData === undefined ){
                //Failing explicitly when the application facade omits its cancellation contract.
                throw new Error( 'Query signal expected.' );

            }


            return new Promise(function requestPending( _resolve, reject ){
                //Rejecting only after the query handle aborts its owned signal.
                requestSignalData.addEventListener( 'abort', function requestAbort(){
                    //Returning the normalized cancellation produced by the protocol client.
                    reject(new LayerRuntimeError( 'API_ABORTED', 'The API request was cancelled.', {
                        retryable: true
                    }));

                }, {once: true} );

            });

        },
        async commandRun(){
            //Failing if the query-only fixture enters an unrelated command path.
            throw new Error( 'Command not expected.' );

        },
        async syncRun(){
            //Providing the unused sync contract required by the application facade.
            return {};

        },
        async queryCacheGet(){
            //Returning a deterministic cache miss before the network request.
            return Object.freeze({hit: false, stale: false, data: null, revision: null});

        },
        async queryCachePut(){
            //Keeping persistence inert for the no-store query fixture.
            return undefined;

        },
        failureHandle( failureData ){
            //Collecting unexpected global failures for the final assertion.
            failureRecords.push( failureData );

        }
    });
    const queryHandle = applicationApi.query({
        operation: 'chat.messages.list',
        payload: {},
        cache: {policy: 'no-store'}
    });

    await requestStartedData;
    const settledTask = queryHandle.settled();
    assert.equal( queryHandle.dispose(), true );
    await assert.rejects( settledTask, function queryAbortCheck( errorData ){
        return /** @type {any} */ (errorData).code === 'API_ABORTED';

    });
    await new Promise(function failureQueueFlush( resolve ){
        //Waiting until the detached auto-start rejection handler has completed.
        setImmediate( resolve );

    });
    assert.deepEqual( failureRecords, [] );
    applicationApi.dispose();

});
