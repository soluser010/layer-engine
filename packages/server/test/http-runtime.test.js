import assert from 'node:assert/strict';
import test from 'node:test';
import {layerInMemoryRateLimiterCreate, layerSessionSecurityCreate} from '@solcorp/layer-security';
import {
    layerDiagnosticsCreate,
    layerHttpRuntimeCreate,
    layerOperationExecutorCreate,
    layerOperationRegistryCreate
} from '../src/index.js';

const requestIdentifier = '7ec2df78-6db4-4b35-8eb0-b2476bb10003';

/**
 * @param {object} [runtimeOverride]
 */
function runtimeFixtureCreate(runtimeOverride = {}) {
    const operationRegistry = layerOperationRegistryCreate();
    const diagnostics = layerDiagnosticsCreate();
    const security = layerSessionSecurityCreate({
        allowedOrigins: [
            'https://app.example.com'
        ],
        sessionResolve: async () => null
    });

    operationRegistry.define({
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
        })
    });

    const operationExecutor = layerOperationExecutorCreate({
        operationRegistry,
        security,
        rateLimiter: layerInMemoryRateLimiterCreate(),
        diagnostics
    });
    const runtime = layerHttpRuntimeCreate({
        operationRegistry,
        operationExecutor,
        diagnostics,
        maximumBodyBytes: 512,
        maximumBodyDepth: 4,
        ...runtimeOverride
    });

    return {
        operationRegistry,
        runtime
    };
}

/**
 * @param {ReturnType<typeof layerHttpRuntimeCreate>} runtime
 */
function runtimeUrlGet(runtime) {
    const addressData = runtime.address();

    assert.ok(addressData !== null && typeof addressData === 'object');

    return `http://127.0.0.1:${addressData.port}`;
}

/**
 * @param {string} operation
 * @param {Record<string, unknown>} [requestOverride]
 */
function requestEnvelopeCreate(operation, requestOverride = {}) {
    return {
        protocol: 1,
        requestId: requestIdentifier,
        type: 'query',
        operation,
        payload: {},
        ...requestOverride
    };
}

test('HTTP runtime serves health and the unified POST API', async () => {
    const {runtime} = runtimeFixtureCreate();

    await runtime.start({
        port: 0
    });

    try {
        const runtimeUrl = runtimeUrlGet(runtime);
        const liveResponse = await fetch(`${runtimeUrl}/health/live`);
        const readyResponse = await fetch(`${runtimeUrl}/health/ready`);
        const apiResponse = await fetch(`${runtimeUrl}/api`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify(requestEnvelopeCreate('health.status.read'))
        });
        const apiData = await apiResponse.json();

        assert.equal(liveResponse.status, 200);
        assert.deepEqual(await liveResponse.json(), {
            status: 'live'
        });
        assert.equal(readyResponse.status, 200);
        assert.deepEqual(await readyResponse.json(), {
            status: 'ready'
        });
        assert.equal(apiResponse.status, 200);
        assert.equal(apiResponse.headers.get('cache-control'), 'no-store');
        assert.equal(apiResponse.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(apiData.ok, true);
        assert.equal(apiData.requestId, requestIdentifier);
        assert.deepEqual(apiData.data, {
            status: 'ok'
        });
        assert.equal(runtime.isReady(), true);
    } finally {
        await runtime.stop();
    }

    assert.equal(runtime.isReady(), false);
});

test('HTTP runtime delegates explicit interoperability routes without exposing handler failures', async () => {
    const handledPathsData = /** @type {string[]} */ ([]);
    const {runtime} = runtimeFixtureCreate({
        requestHandlers: [async function interoperabilityRouteHandle(
            /** @type {import('node:http').IncomingMessage} */ requestData,
            /** @type {import('node:http').ServerResponse} */ responseData
        ) {
            const requestPathData = requestData.url?.split('?', 1)[0] ?? '/';
            handledPathsData.push(requestPathData);

            if (requestPathData === '/oauth/discovery') {
                responseData.writeHead(200, {
                    'content-type': 'application/json; charset=utf-8'
                });
                responseData.end(JSON.stringify({issuer: 'layer-test'}));
                return true;

            }

            if (requestPathData === '/oauth/failure') {
                throw new Error('private OAuth adapter details');

            }

            return false;

        }]
    });

    await runtime.start({port: 0});

    try {
        const runtimeUrlData = runtimeUrlGet(runtime);
        const discoveryResponseData = await fetch(runtimeUrlData + '/oauth/discovery');
        const missingResponseData = await fetch(runtimeUrlData + '/application/missing');
        const failedResponseData = await fetch(runtimeUrlData + '/oauth/failure');
        const failedSourceData = await failedResponseData.text();

        assert.equal(discoveryResponseData.status, 200);
        assert.deepEqual(await discoveryResponseData.json(), {issuer: 'layer-test'});
        assert.equal(missingResponseData.status, 404);
        assert.equal(failedResponseData.status, 500);
        assert.equal(failedSourceData.includes('private OAuth adapter details'), false);
        assert.deepEqual(handledPathsData, [
            '/oauth/discovery',
            '/application/missing',
            '/oauth/failure'
        ]);

    } finally {
        await runtime.stop();

    }

});

test('HTTP runtime reports dependency readiness without exposing probe failures', async () => {
    let dependenciesReady = /** @type {boolean | null} */ (true);
    const {runtime} = runtimeFixtureCreate({
        async readinessCheck() {
            if (dependenciesReady === null) {
                throw new Error('private database connection details');

            }

            return dependenciesReady;
        }
    });

    await runtime.start({
        port: 0
    });

    try {
        const runtimeUrl = runtimeUrlGet(runtime);
        const readyResponse = await fetch(runtimeUrl + '/health/ready');

        assert.equal(readyResponse.status, 200);

        dependenciesReady = false;

        const unavailableResponse = await fetch(runtimeUrl + '/health/ready');

        assert.equal(unavailableResponse.status, 503);
        assert.deepEqual(await unavailableResponse.json(), {
            status: 'not-ready'
        });

        dependenciesReady = null;

        const failedProbeResponse = await fetch(runtimeUrl + '/health/ready');
        const failedProbeText = await failedProbeResponse.text();

        assert.equal(failedProbeResponse.status, 503);
        assert.equal(failedProbeText.includes('private database connection details'), false);
    } finally {
        await runtime.stop();
    }
});

test('HTTP runtime restricts route and method surface', async () => {
    const {runtime} = runtimeFixtureCreate();

    await runtime.start({
        port: 0
    });

    try {
        const runtimeUrl = runtimeUrlGet(runtime);
        const missingResponse = await fetch(`${runtimeUrl}/private`);
        const methodResponse = await fetch(`${runtimeUrl}/api`);
        const methodData = await methodResponse.json();

        assert.equal(missingResponse.status, 404);
        assert.equal(methodResponse.status, 405);
        assert.equal(methodResponse.headers.get('allow'), 'POST');
        assert.equal(methodData.error.code, 'METHOD_NOT_ALLOWED');
        assert.equal('stack' in methodData.error, false);
    } finally {
        await runtime.stop();
    }
});

test('HTTP runtime rejects media type, malformed JSON, depth, and size', async () => {
    const {runtime} = runtimeFixtureCreate();

    await runtime.start({
        port: 0
    });

    try {
        const runtimeUrl = runtimeUrlGet(runtime);
        const mediaResponse = await fetch(`${runtimeUrl}/api`, {
            method: 'POST',
            body: '{}'
        });
        const malformedResponse = await fetch(`${runtimeUrl}/api`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: '{'
        });
        const deepResponse = await fetch(`${runtimeUrl}/api`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify(requestEnvelopeCreate('health.status.read', {
                payload: {
                    one: {
                        two: {
                            three: true
                        }
                    }
                }
            }))
        });
        const oversizedResponse = await fetch(`${runtimeUrl}/api`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify(requestEnvelopeCreate('health.status.read', {
                payload: {
                    text: 'x'.repeat(600)
                }
            }))
        });

        assert.equal(mediaResponse.status, 415);
        assert.equal((await mediaResponse.json()).error.code, 'INVALID_ENVELOPE');
        assert.equal(malformedResponse.status, 400);
        assert.equal((await malformedResponse.json()).error.code, 'INVALID_ENVELOPE');
        assert.equal(deepResponse.status, 400);
        assert.equal((await deepResponse.json()).error.code, 'INVALID_ENVELOPE');
        assert.equal(oversizedResponse.status, 413);
        assert.equal((await oversizedResponse.json()).error.code, 'REQUEST_TOO_LARGE');
    } finally {
        await runtime.stop();
    }
});

test('HTTP runtime distinguishes protocol, envelope, operation, and stream failures', async () => {
    const {runtime} = runtimeFixtureCreate();

    await runtime.start({
        port: 0
    });

    try {
        const runtimeUrl = runtimeUrlGet(runtime);
        const requestSend = async (/** @type {Record<string, unknown>} */ requestData) => {
            return fetch(`${runtimeUrl}/api`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });
        };
        const protocolResponse = await requestSend(requestEnvelopeCreate('health.status.read', {
            protocol: 2
        }));
        const envelopeResponse = await requestSend({
            protocol: 1,
            requestId: 'invalid',
            type: 'query',
            operation: 'health.status.read',
            payload: {}
        });
        const operationResponse = await requestSend(requestEnvelopeCreate('missing.operation'));
        const streamResponse = await requestSend(requestEnvelopeCreate('events.stream.open', {
            type: 'events.open',
            cursor: null
        }));

        assert.equal((await protocolResponse.json()).error.code, 'UNSUPPORTED_PROTOCOL');
        assert.equal((await envelopeResponse.json()).error.code, 'INVALID_ENVELOPE');
        assert.equal((await operationResponse.json()).error.code, 'OPERATION_NOT_FOUND');
        assert.equal(streamResponse.status, 503);
        assert.equal((await streamResponse.json()).error.code, 'DEPENDENCY_UNAVAILABLE');
    } finally {
        await runtime.stop();
    }
});

test('HTTP runtime seals registry and rejects duplicate start', async () => {
    const {operationRegistry, runtime} = runtimeFixtureCreate();

    await runtime.start({
        port: 0
    });

    try {
        assert.equal(operationRegistry.isSealed(), true);
        await assert.rejects(() => runtime.start({
            port: 0
        }), /already started/);
    } finally {
        await runtime.stop();
        await runtime.stop();
    }
});

test('HTTP runtime runs database migration lifecycle before readiness', async () => {
    let connectCount = 0;
    let closeCount = 0;
    const databaseQueries = /** @type {any[]} */ ([]);
    const database = {
        async connect() {
            connectCount += 1;
        },
        async close() {
            closeCount += 1;
        },
        async query(/** @type {any} */ queryData) {
            databaseQueries.push(queryData);

            return {
                rows: [],
                rowCount: 0
            };
        },
        async transaction(/** @type {any} */ transactionHandler) {
            return transactionHandler({
                async query(/** @type {any} */ queryData) {
                    databaseQueries.push( queryData );
                    if (queryData.text.includes('SELECT version')) {
                        return {
                            rows: [],
                            rowCount: 0
                        };
                    }

                    return {
                        rows: [],
                        rowCount: 0
                    };
                }
            });
        }
    };
    const {runtime} = runtimeFixtureCreate({
        database
    });

    await runtime.start({
        port: 0
    });
    try {
        assert.equal(connectCount, 1);
        assert.ok( databaseQueries.some(function( queryData ){
            //Verifying startup uses a transaction-owned lock on its migration connection
            return queryData.text.includes( 'pg_advisory_xact_lock' );

        }) );

    } finally {
        //Closing the fixture even when a lifecycle assertion fails
        await runtime.stop();

    }
    assert.equal(closeCount, 1);
});

test('HTTP runtime closes database after startup failure', async () => {
    let closeCount = 0;
    const {runtime} = runtimeFixtureCreate({
        database: {
            async connect() {
                throw new Error('database unavailable');
            },
            async close() {
                closeCount += 1;
            },
            async query() {
                return {
                    rows: [],
                    rowCount: 0
                };
            },
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

    await assert.rejects(() => runtime.start({
        port: 0
    }), /database unavailable/);
    assert.equal(closeCount, 1);
    assert.equal(runtime.isReady(), false);
});

test('HTTP runtime authorizes POST event streams and drains distribution lifecycle', async () => {
    const lifecycleCalls = /** @type {string[]} */ ([]);
    const streamOpenCalls = /** @type {any[]} */ ([]);
    let distributionReady = false;
    const operationExecutor = {
        async execute(/** @type {any} */ executeData) {
            lifecycleCalls.push('authorize');

            return {
                tenantKey: 'tenant-1',
                userId: 'user-1',
                channels: executeData.request.payload.channels
            };
        }
    };
    const eventStream = {
        async open(/** @type {any} */ openData) {
            streamOpenCalls.push(openData);
            openData.response.writeHead(200, {
                'content-type': 'text/event-stream; charset=utf-8',
                'cache-control': 'no-store'
            });
            openData.response.end(': heartbeat\n\n');
        },
        async drain() {
            lifecycleCalls.push('drain');
        }
    };
    const eventDistribution = {
        async start() {
            distributionReady = true;
            lifecycleCalls.push('distribution-start');
        },
        async stop() {
            distributionReady = false;
            lifecycleCalls.push('distribution-stop');
        },
        isReady() {
            return distributionReady;
        }
    };
    const {runtime} = runtimeFixtureCreate({
        operationExecutor,
        eventStream,
        eventDistribution
    });

    await runtime.start({
        port: 0
    });

    try {
        const runtimeUrl = runtimeUrlGet(runtime);
        const streamResponse = await fetch(`${runtimeUrl}/api`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify(requestEnvelopeCreate('system.events.open', {
                type: 'events.open',
                payload: {
                    channels: [
                        'conversation:1'
                    ]
                },
                cursor: {
                    'conversation:1': 12
                }
            }))
        });
        const invalidCursorResponse = await fetch(`${runtimeUrl}/api`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify(requestEnvelopeCreate('system.events.open', {
                type: 'events.open',
                payload: {
                    channels: [
                        'conversation:1'
                    ]
                },
                cursor: 'legacy-cursor'
            }))
        });

        assert.equal(streamResponse.status, 200);
        assert.equal(streamResponse.headers.get('content-type'), 'text/event-stream; charset=utf-8');
        assert.equal(await streamResponse.text(), ': heartbeat\n\n');
        assert.equal(streamOpenCalls[0].authorization.tenantKey, 'tenant-1');
        assert.deepEqual(streamOpenCalls[0].cursor, {
            'conversation:1': 12
        });
        assert.equal(invalidCursorResponse.status, 400);
        assert.equal((await invalidCursorResponse.json()).error.code, 'INVALID_ENVELOPE');
    } finally {
        await runtime.stop();
    }

    assert.deepEqual(lifecycleCalls, [
        'distribution-start',
        'authorize',
        'drain',
        'distribution-stop'
    ]);
});
