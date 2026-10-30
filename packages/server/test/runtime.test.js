import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LAYER_ERROR_CODES,
    LayerError
} from '@solcorp/layer-protocol';
import {
    layerInMemoryRateLimiterCreate,
    layerSessionSecurityCreate
} from '@solcorp/layer-security';
import {
    layerDiagnosticsCreate,
    layerOperationExecutorCreate,
    layerOperationRegistryCreate
} from '../src/index.js';

const requestIdentifier = '7ec2df78-6db4-4b35-8eb0-b2476bb10002';

/**
 * @param {Record<string, unknown>} [operationOverride]
 */
function publicQueryCreate(operationOverride = {}) {
    return /** @type {any} */ ({
        name: 'health.status.read',
        type: 'query',
        auth: 'none',
        inputSchema: {
            type: 'object',
            additionalProperties: false
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: [
                'status'
            ],
            properties: {
                status: {
                    type: 'string'
                }
            }
        },
        handler: async () => ({
            status: 'ok'
        }),
        ...operationOverride
    });
}

function publicSecurityCreate() {
    return layerSessionSecurityCreate({
        allowedOrigins: [
            'https://app.example.com'
        ],
        sessionResolve: async () => null
    });
}

/**
 * @param {ReturnType<typeof layerOperationRegistryCreate>} operationRegistry
 * @param {Record<string, unknown>} [executorOverride]
 */
function operationExecutorCreate(operationRegistry, executorOverride = {}) {
    return layerOperationExecutorCreate({
        operationRegistry,
        security: publicSecurityCreate(),
        rateLimiter: layerInMemoryRateLimiterCreate(),
        diagnostics: layerDiagnosticsCreate(),
        ...executorOverride
    });
}

/**
 * @param {string} operation
 * @param {string} [type]
 * @param {Record<string, unknown>} [payload]
 */
function executionDataCreate(operation, type = 'query', payload = {}) {
    return {
        request: {
            requestId: requestIdentifier,
            type,
            operation,
            payload
        },
        headers: {},
        remoteAddress: '127.0.0.1'
    };
}

/**
 * @param {() => Promise<unknown>} callback
 * @param {string} expectedCode
 */
async function layerErrorRejects(callback, expectedCode) {
    await assert.rejects(callback, (/** @type {unknown} */ errorData) => {
        assert.ok(errorData instanceof LayerError);
        assert.equal(errorData.code, expectedCode);

        return true;
    });
}

test('operation executor validates and runs a public query', async () => {
    const operationRegistry = layerOperationRegistryCreate();
    const diagnosticsRecords = /** @type {Record<string, any>[]} */ ([]);

    operationRegistry.define(publicQueryCreate());

    const operationExecutor = operationExecutorCreate(operationRegistry, {
        diagnostics: layerDiagnosticsCreate({
            clock: () => new Date('2026-09-18T10:00:00.000Z'),
            sink: (diagnosticData) => diagnosticsRecords.push(diagnosticData)
        }),
        clock: () => 100
    });
    const operationResult = await operationExecutor.execute(
        executionDataCreate('health.status.read')
    );

    assert.deepEqual(operationResult, {
        status: 'ok'
    });
    assert.ok(diagnosticsRecords[0]);
    assert.equal(diagnosticsRecords[0].event, 'operation.complete');
    assert.equal(diagnosticsRecords[0].requestId, requestIdentifier);
});

test('operation executor uses opt-in query cache and bypasses cache failures safely', async () => {
    const operationRegistry = layerOperationRegistryCreate();
    const diagnosticsRecords = /** @type {Record<string, any>[]} */ ([]);
    let handlerCountData = Number( 0 );
    let cacheModeData = 'hit';

    operationRegistry.define(publicQueryCreate({
        cache: {
            ttlMs: 30000,
            scope: 'global',
            tags: ['health-status']
        },
        handler: async () => {
            handlerCountData += Number( 1 );

            return {
                status: `handler-${String( handlerCountData )}`
            };
        }
    }));

    const operationExecutor = operationExecutorCreate(operationRegistry, {
        diagnostics: layerDiagnosticsCreate({
            sink: (diagnosticData) => diagnosticsRecords.push(diagnosticData)
        }),
        queryCache: {
            async execute(
                /** @type {any} */ cacheRequestData,
                /** @type {() => Promise<unknown>} */ loadData
            ){
                assert.equal( cacheRequestData.operation, 'health.status.read' );
                assert.equal( cacheRequestData.metadata.scope, 'global' );

                if ( cacheModeData === 'hit' ){
                    return {status: 'cached'};

                }

                const loadedResultData = await loadData();

                if ( cacheModeData === 'write-failure' ){
                    throw new Error( 'Redis write failed' );

                }

                return loadedResultData;
            }
        }
    });

    assert.deepEqual( await operationExecutor.execute(
        executionDataCreate('health.status.read')
    ), {status: 'cached'} );
    assert.equal( handlerCountData, 0 );

    cacheModeData = 'miss';
    assert.deepEqual( await operationExecutor.execute(
        executionDataCreate('health.status.read')
    ), {status: 'handler-1'} );

    cacheModeData = 'write-failure';
    assert.deepEqual( await operationExecutor.execute(
        executionDataCreate('health.status.read')
    ), {status: 'handler-2'} );
    assert.equal( handlerCountData, 2 );
    assert.equal(
        diagnosticsRecords.some((diagnosticData) => diagnosticData.event === 'operation.cache-bypassed'),
        true
    );
});

test('operation executor rejects missing, mismatched, and invalid operations', async () => {
    const operationRegistry = layerOperationRegistryCreate();

    operationRegistry.define(publicQueryCreate());

    const operationExecutor = operationExecutorCreate(operationRegistry);

    await layerErrorRejects(() => operationExecutor.execute(
        executionDataCreate('missing.operation')
    ), LAYER_ERROR_CODES.OPERATION_NOT_FOUND);
    await layerErrorRejects(() => operationExecutor.execute(
        executionDataCreate('health.status.read', 'command')
    ), LAYER_ERROR_CODES.INVALID_ENVELOPE);
    await layerErrorRejects(() => operationExecutor.execute(
        executionDataCreate('health.status.read', 'query', {
            extra: true
        })
    ), LAYER_ERROR_CODES.INVALID_PAYLOAD);
});

test('operation executor propagates safe auth and rate-limit failures', async () => {
    const operationRegistry = layerOperationRegistryCreate();

    operationRegistry.define(publicQueryCreate());

    const authExecutor = operationExecutorCreate(operationRegistry, {
        security: {
            async contextResolve() {
                throw new LayerError(
                    LAYER_ERROR_CODES.AUTH_REQUIRED,
                    'Authentication is required.',
                    {
                        status: 401
                    }
                );
            }
        }
    });

    await layerErrorRejects(() => authExecutor.execute(
        executionDataCreate('health.status.read')
    ), LAYER_ERROR_CODES.AUTH_REQUIRED);

    const limitedExecutor = operationExecutorCreate(operationRegistry, {
        rateLimiter: {
            consume() {
                return {
                    allowed: false,
                    remaining: 0,
                    retryAfterMs: 1500
                };
            }
        }
    });

    await assert.rejects(function limitedOperationExecute(){
        //Executing the request that is denied by the injected token bucket.
        return limitedExecutor.execute(
            executionDataCreate('health.status.read')
        );

    }, function limitedOperationErrorCheck( errorData ){
        //Checking the public retry contract used by the query cache fallback.
        assert.ok(errorData instanceof LayerError);
        assert.equal(errorData.code, LAYER_ERROR_CODES.RATE_LIMITED);
        assert.equal(errorData.retryable, true);
        assert.deepEqual(errorData.details, {
            retryAfterMs: 1500
        });

        return true;

    });

});

test('operation executor validates output and normalizes handler errors', async () => {
    const invalidOutputRegistry = layerOperationRegistryCreate();

    invalidOutputRegistry.define(publicQueryCreate({
        handler: async () => ({
            unexpected: true
        })
    }));

    await layerErrorRejects(() => operationExecutorCreate(invalidOutputRegistry).execute(
        executionDataCreate('health.status.read')
    ), LAYER_ERROR_CODES.INTERNAL_ERROR);

    const failureRegistry = layerOperationRegistryCreate();

    failureRegistry.define(publicQueryCreate({
        handler: async () => {
            throw new Error('database secret');
        }
    }));

    await layerErrorRejects(() => operationExecutorCreate(failureRegistry).execute(
        executionDataCreate('health.status.read')
    ), LAYER_ERROR_CODES.INTERNAL_ERROR);
});

test('operation executor enforces object and writable-field authorization without disclosure', async () => {
    const operationRegistry = layerOperationRegistryCreate();
    let handlerCount = 0;
    const authorizationContexts = /** @type {Record<string, any>[]} */ ([]);

    operationRegistry.define(publicQueryCreate({
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['profileId', 'fields'],
            properties: {
                profileId: {type: 'string'},
                fields: {
                    type: 'array',
                    items: {type: 'string'}
                }
            }
        },
        authorize: async (/** @type {any} */ payloadData, /** @type {any} */ contextData) => {
            authorizationContexts.push(contextData);

            return payloadData.profileId === 'profile-1' && !payloadData.fields.includes('role');
        },
        handler: async () => {
            handlerCount += 1;

            return {status: 'ok'};
        }
    }));

    const operationExecutor = operationExecutorCreate(operationRegistry);

    assert.deepEqual(await operationExecutor.execute(executionDataCreate('health.status.read', 'query', {
        profileId: 'profile-1',
        fields: ['displayName']
    })), {status: 'ok'});
    await layerErrorRejects(() => operationExecutor.execute(executionDataCreate('health.status.read', 'query', {
        profileId: 'profile-2',
        fields: ['displayName']
    })), LAYER_ERROR_CODES.OBJECT_ACCESS_DENIED);
    await layerErrorRejects(() => operationExecutor.execute(executionDataCreate('health.status.read', 'query', {
        profileId: 'profile-1',
        fields: ['role']
    })), LAYER_ERROR_CODES.OBJECT_ACCESS_DENIED);

    assert.equal(handlerCount, 1);
    assert.equal(authorizationContexts.length, 3);
    assert.equal(authorizationContexts[0]?.requestId, requestIdentifier);
    assert.equal(Object.isFrozen(authorizationContexts[0]), true);

    const failingRegistry = layerOperationRegistryCreate();

    failingRegistry.define(publicQueryCreate({
        authorize: async () => {
            throw new Error('secret ownership lookup detail');
        }
    }));
    await layerErrorRejects(() => operationExecutorCreate(failingRegistry).execute(
        executionDataCreate('health.status.read')
    ), LAYER_ERROR_CODES.OBJECT_ACCESS_DENIED);
});

test('operation executor writes metadata-only success and denial audits', async () => {
    const operationRegistry = layerOperationRegistryCreate();
    const auditRecords = /** @type {Record<string, any>[]} */ ([]);

    operationRegistry.define(publicQueryCreate({
        authorize: async (/** @type {any} */ payloadData) => payloadData.allowed === true,
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['allowed'],
            properties: {
                allowed: {type: 'boolean'}
            }
        },
        audit: {
            category: 'health-read'
        }
    }));

    const operationExecutor = operationExecutorCreate(operationRegistry, {
        auditRequired: true,
        auditTrail: {
            async record(/** @type {Record<string, any>} */ auditData) {
                auditRecords.push(auditData);
            }
        }
    });

    await operationExecutor.execute(executionDataCreate('health.status.read', 'query', {allowed: true}));
    await layerErrorRejects(() => operationExecutor.execute(
        executionDataCreate('health.status.read', 'query', {allowed: false})
    ), LAYER_ERROR_CODES.OBJECT_ACCESS_DENIED);

    assert.equal(auditRecords.length, 2);
    assert.equal(auditRecords[0]?.outcome, 'success');
    assert.equal(auditRecords[0]?.category, 'health-read');
    assert.equal(auditRecords[1]?.outcome, 'denied');
    assert.equal(auditRecords[1]?.errorCode, LAYER_ERROR_CODES.OBJECT_ACCESS_DENIED);
    assert.equal('payload' in auditRecords[0], false);
    assert.equal('headers' in auditRecords[0], false);

    assert.throws(() => operationExecutorCreate(operationRegistry, {
        auditRequired: true
    }), TypeError);
    assert.throws(() => operationExecutorCreate(operationRegistry, {
        auditTrail: /** @type {any} */ ({})
    }), TypeError);
});

test('operation executor fails success closed but preserves primary failure when audit storage fails', async () => {
    const operationRegistry = layerOperationRegistryCreate();

    operationRegistry.define(publicQueryCreate());

    const operationExecutor = operationExecutorCreate(operationRegistry, {
        auditTrail: {
            async record() {
                throw new Error('audit database unavailable');
            }
        }
    });

    await layerErrorRejects(() => operationExecutor.execute(
        executionDataCreate('health.status.read')
    ), LAYER_ERROR_CODES.INTERNAL_ERROR);

    const failureRegistry = layerOperationRegistryCreate();

    failureRegistry.define(publicQueryCreate({
        handler: async () => {
            throw new LayerError(
                LAYER_ERROR_CODES.CONFLICT,
                'Conflict.',
                {status: 409}
            );
        }
    }));

    await layerErrorRejects(() => operationExecutorCreate(failureRegistry, {
        auditTrail: {
            async record() {
                throw new Error('audit database unavailable');
            }
        }
    }).execute(executionDataCreate('health.status.read')), LAYER_ERROR_CODES.CONFLICT);
});

test( 'context extension failures never reserve an operation concurrency slot', async function(){
    const failuresData = [
        function(){
            //Simulating a synchronous application extension failure
            throw new Error( 'Extension failed' );

        },
        function(){
            //Rejecting a missing extension record
            return null;

        },
        function(){
            //Rejecting a reserved core context field
            return {security: {userId: 'forged'}};

        },
        function(){
            //A getter may fail during copying after the record itself passed validation
            return {get application(){
                //Failing property access after the extension object passed its outer validation
                throw new Error( 'Extension getter failed' );

            }};

        }
    ];

    for ( const extensionCreateData of failuresData ){
        let failStatusData = true;
        const registryData = layerOperationRegistryCreate();
        registryData.define( publicQueryCreate({concurrency: 1}) );
        const executorData = operationExecutorCreate( registryData, {
            contextExtend(){
                //Allowing the application to recover after its first failed context creation
                if ( failStatusData === true ){
                    return extensionCreateData();

                }

                return {application: 'ready'};

            }
        });

        await assert.rejects( executorData.execute( executionDataCreate( 'health.status.read' ) ) );
        failStatusData = false;
        assert.deepEqual( await executorData.execute( executionDataCreate( 'health.status.read' ) ), {status: 'ok'} );
        assert.deepEqual( await executorData.execute( executionDataCreate( 'health.status.read' ) ), {status: 'ok'} );

    }

});

test('operation executor keeps concurrency occupied until work settles', async () => {
    const operationRegistry = layerOperationRegistryCreate();
    let operationResolve = () => {};
    const operationWait = new Promise((resolve) => {
        operationResolve = () => {
            resolve(undefined);
        };
    });

    operationRegistry.define(publicQueryCreate({
        concurrency: 1,
        handler: async () => {
            await operationWait;

            return {
                status: 'ok'
            };
        }
    }));

    const operationExecutor = operationExecutorCreate(operationRegistry);
    const firstExecution = operationExecutor.execute(
        executionDataCreate('health.status.read')
    );

    await assert.rejects(function concurrentOperationExecute(){
        //Executing a second request while the first handler still owns its slot.
        return operationExecutor.execute(
            executionDataCreate('health.status.read')
        );

    }, function concurrentOperationErrorCheck( errorData ){
        //Checking that transient concurrency saturation remains retryable.
        assert.ok(errorData instanceof LayerError);
        assert.equal(errorData.code, LAYER_ERROR_CODES.RATE_LIMITED);
        assert.equal(errorData.retryable, true);

        return true;

    });

    operationResolve();
    assert.deepEqual(await firstExecution, {
        status: 'ok'
    });

});

test('operation executor aborts operations at their declared timeout', async () => {
    const operationRegistry = layerOperationRegistryCreate();
    let observedSignal = new AbortController().signal;

    operationRegistry.define(publicQueryCreate({
        timeoutMs: 100,
        handler: async (/** @type {unknown} */ _payloadData, /** @type {any} */ contextData) => {
            observedSignal = contextData.signal;
            await new Promise((resolve) => setTimeout(resolve, 130));

            return {
                status: 'late'
            };
        }
    }));

    await layerErrorRejects(() => operationExecutorCreate(operationRegistry).execute(
        executionDataCreate('health.status.read')
    ), LAYER_ERROR_CODES.OPERATION_TIMEOUT);
    assert.equal(observedSignal.aborted, true);
});

test('transactional command is idempotent and receives a restricted transaction', async () => {
    const operationRegistry = layerOperationRegistryCreate();
    const commandResultMap = new Map();
    let handlerCount = 0;
    let authorizationCount = 0;
    let cacheInvalidationCountData = Number( 0 );
    let eventAppendCountData = Number( 0 );
    const databaseQueryCallsData = /** @type {any[]} */ ([]);
    const database = {
        async transaction(/** @type {any} */ transactionHandler) {
            const transactionClient = {
                async query(/** @type {any} */ queryData) {
                    databaseQueryCallsData.push( queryData );

                    if (queryData.text.includes('SELECT operation')) {
                        const storedResult = commandResultMap.get(queryData.values[1]);

                        return {
                            rows: storedResult === undefined ? [] : [
                                storedResult
                            ],
                            rowCount: storedResult === undefined ? 0 : 1
                        };
                    }

                    if (queryData.text.includes('sys_command_results')) {
                        commandResultMap.set(queryData.values[1], {
                            operation: queryData.values[2],
                            result: JSON.parse(queryData.values[3]),
                            actor_key: queryData.values[4],
                            request_digest: queryData.values[5]
                        });
                    }

                    return {
                        rows: [],
                        rowCount: 1
                    };
                }
            };

            return transactionHandler(transactionClient);
        }
    };

    operationRegistry.define({
        name: 'chat.message.send',
        type: 'command',
        auth: 'none',
        transaction: true,
        offlineReplay: true,
        cacheInvalidation: {
            scope: 'global',
            tags: ['chat-messages']
        },
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: [
                'commandId'
            ],
            properties: {
                commandId: {
                    type: 'string'
                }
            }
        },
        outputSchema: {
            type: 'object',
            required: [
                'messageId'
            ],
            properties: {
                messageId: {
                    type: 'string'
                }
            }
        },
        authorize: async (/** @type {unknown} */ _payloadData, /** @type {any} */ contextData) => {
            authorizationCount += 1;
            assert.equal(typeof contextData.database.query, 'undefined');
            assert.equal(typeof contextData.database.table, 'function');
            assert.equal(typeof contextData.database.sql, 'function');

            return true;
        },
        handler: async (/** @type {unknown} */ _payloadData, /** @type {any} */ contextData) => {
            handlerCount += 1;
            assert.equal(typeof contextData.database.query, 'undefined');
            assert.equal(typeof contextData.database.table, 'function');
            assert.equal(typeof contextData.events.append, 'function');
            await contextData.events.append({
                tenantKey: 'public',
                channel: 'chat:general',
                entityRevision: 1,
                type: 'chat.message.created',
                payload: {
                    messageId: 'message-1'
                }
            });

            return {
                messageId: 'message-1'
            };
        }
    });

    const operationExecutor = operationExecutorCreate(operationRegistry, {
        database,
        security: {
            async contextResolve(){
                //Using a verified principal for replay rather than anonymous shared access
                return {authenticationType: 'bearer', userId: 'user-1', tenantId: null, credentialId: 'bearer-1', sessionId: null};

            }
        },
        eventRepository: {
            async append( /** @type {any} */ transactionClientData, /** @type {any} */ eventData ){
                eventAppendCountData += Number( 1 );
                assert.equal( typeof transactionClientData.query, 'function' );
                assert.equal( eventData.channel, 'chat:general' );

                return {eventId: 'event-1'};
            }
        },
        queryCache: {
            async execute( /** @type {any} */ _cacheRequestData, /** @type {Function} */ loadData ){
                return loadData();
            },
            async invalidate( /** @type {any} */ invalidationData ){
                cacheInvalidationCountData += Number( 1 );
                assert.deepEqual( invalidationData.tags, ['chat-messages'] );
            }
        }
    });
    const commandRequest = executionDataCreate('chat.message.send', 'command', {
        commandId: 'command-1'
    });

    assert.deepEqual(await operationExecutor.execute(commandRequest), {
        messageId: 'message-1'
    });
    assert.deepEqual(await operationExecutor.execute(commandRequest), {
        messageId: 'message-1'
    });
    assert.equal(handlerCount, 1);
    assert.equal(eventAppendCountData, 1);
    assert.equal(authorizationCount, 2);
    assert.equal( databaseQueryCallsData.filter(function cacheInvalidationFind( queryData ){
        return queryData.text.includes( 'sys_cache_invalidations' );

    }).length, 1 );
    assert.equal( cacheInvalidationCountData, 2 );
});

test('transactional command requires database and commandId', async () => {
    const operationRegistry = layerOperationRegistryCreate();

    operationRegistry.define({
        name: 'chat.message.send',
        type: 'command',
        auth: 'none',
        transaction: true,
        inputSchema: {
            type: 'object'
        },
        outputSchema: {
            type: 'object'
        },
        handler: async () => ({})
    });

    await layerErrorRejects(() => operationExecutorCreate(operationRegistry).execute(
        executionDataCreate('chat.message.send', 'command')
    ), LAYER_ERROR_CODES.DEPENDENCY_UNAVAILABLE);

    const databaseExecutor = operationExecutorCreate(operationRegistry, {
        database: {
            async transaction(/** @type {any} */ transactionHandler) {
                return transactionHandler({
                    async query() {
                        return {
                            rows: [],
                            rowCount: 0
                        };
                    }
                });
            }
        }
    });

    await layerErrorRejects(() => databaseExecutor.execute(
        executionDataCreate('chat.message.send', 'command')
    ), LAYER_ERROR_CODES.INVALID_PAYLOAD);
});

test('diagnostics allowlist removes payloads, secrets, and nested values', () => {
    const diagnosticRecords = /** @type {Record<string, any>[]} */ ([]);
    const diagnostics = layerDiagnosticsCreate({
        clock: () => new Date('2026-09-18T10:00:00.000Z'),
        sink: (diagnosticData) => diagnosticRecords.push(diagnosticData)
    });

    diagnostics.record({
        level: 'info',
        event: 'operation.complete',
        requestId: requestIdentifier,
        status: 200,
        payload: {
            password: 'secret'
        },
        cookie: 'session-secret'
    });

    assert.deepEqual(diagnosticRecords[0], {
        timestamp: '2026-09-18T10:00:00.000Z',
        level: 'info',
        event: 'operation.complete',
        requestId: requestIdentifier,
        status: 200
    });
});
