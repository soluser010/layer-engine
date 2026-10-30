import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createConnection} from 'node:net';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {layerComponentCompile} from '@solcorp/layer-compiler';
import {layerCommandResultRepositoryCreate} from '@solcorp/layer-database';
import {
    LAYER_ERROR_CODES,
    LayerError
} from '@solcorp/layer-protocol';
import {layerComponentRenderToString} from '@solcorp/layer-render';
import {
    layerAuthenticationCreate,
    layerInMemoryRateLimiterCreate,
    layerOutboundUrlPolicyCreate
} from '@solcorp/layer-security';
import {
    layerDiagnosticsCreate,
    layerHttpRuntimeCreate,
    layerOperationExecutorCreate,
    layerOperationRegistryCreate
} from '@solcorp/layer-server';

/**
 * @param {() => Promise<unknown>} callback
 * @param {string} expectedCode
 */
async function layerErrorRejects(callback, expectedCode) {
    await assert.rejects(callback, function layerErrorCheck(errorData) {
        //Checking only stable public classification rather than internal detail.
        assert.ok(errorData instanceof LayerError);
        assert.equal(errorData.code, expectedCode);

        return true;

    });

}

test('threat suite blocks stored XSS and keeps SQL injection in parameters', async () => {
    const componentData = layerComponentCompile(
        '<template><article title="Unsafe {{ message }}">{{ message }}</article></template>',
        {componentId: 'threat/message'}
    );
    const attackValue = '<img src=x onerror=alert(1)>\' OR 1=1 --';
    const renderResult = layerComponentRenderToString(componentData, {
        message: attackValue
    });

    const renderedDocument = new JSDOM(renderResult.html).window.document;

    assert.equal(renderedDocument.querySelector('img'), null);
    assert.equal(renderedDocument.querySelector('article')?.textContent, attackValue);
    assert.equal(renderResult.html.includes('&lt;img'), true);

    const queryCalls = /** @type {any[]} */ ([]);
    const repository = layerCommandResultRepositoryCreate({
        async query(queryData) {
            queryCalls.push(queryData);

            return {rows: [], rowCount: 1};

        }
    });

    await repository.save({
        tenantKey: attackValue,
        commandId: 'command-1',
        operation: 'chat.message.send',
        result: {accepted: true}
    });

    assert.equal(queryCalls[0]?.text.includes(attackValue), false);
    assert.equal(queryCalls[0]?.values[0], attackValue);
});

test('threat suite blocks CSRF, BOLA, and forbidden field updates', async () => {
    const csrfToken = 'csrf-token-with-sufficient-entropy';
    const authentication = layerAuthenticationCreate({
        allowedOrigins: ['https://app.example.com'],
        clock: () => 1000,
        sessionResolve: async () => ({
            id: 'session-1',
            userId: 'user-1',
            tenantId: 'tenant-1',
            permissions: ['profile.write'],
            csrfTokenHash: createHash('sha256').update(csrfToken).digest('hex'),
            expiresAt: 2000,
            status: 'active'
        })
    });

    await layerErrorRejects(() => authentication.contextResolve({
        auth: 'session',
        permissions: ['profile.write'],
        headers: {
            origin: 'https://attacker.example',
            'sec-fetch-site': 'cross-site',
            cookie: 'layer_session=opaque-session-identifier',
            'x-layer-csrf': csrfToken
        },
        remoteAddress: '127.0.0.1'
    }), LAYER_ERROR_CODES.CSRF_INVALID);

    const operationRegistry = layerOperationRegistryCreate();
    let handlerCount = 0;

    operationRegistry.define({
        name: 'profile.fields.update',
        type: 'command',
        auth: 'session',
        permissions: ['profile.write'],
        audit: {enabled: false},
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['profileId', 'fields'],
            properties: {
                profileId: {type: 'string'},
                fields: {
                    type: 'object',
                    additionalProperties: true
                }
            }
        },
        outputSchema: {
            type: 'object',
            required: ['accepted'],
            properties: {accepted: {type: 'boolean'}}
        },
        async authorize(/** @type {any} */ payloadData, /** @type {any} */ contextData) {
            //Binding ownership to server identity and rejecting privileged field names.
            return payloadData.profileId === contextData.security.userId && Object.keys(payloadData.fields).every(function fieldAllowed(fieldName) {
                //Keeping role and permission changes outside this operation boundary.
                return fieldName === 'displayName' || fieldName === 'bio';

            });

        },
        async handler() {
            handlerCount += 1;

            return {accepted: true};

        }
    });

    const operationExecutor = layerOperationExecutorCreate({
        operationRegistry,
        security: {
            async contextResolve() {
                //Returning server-owned identity independent of payload claims.
                return {
                    authenticationType: 'session',
                    credentialId: 'session-1',
                    sessionId: 'session-1',
                    userId: 'user-1',
                    tenantId: 'tenant-1',
                    permissions: ['profile.write'],
                    remoteAddress: '127.0.0.1'
                };

            }
        },
        rateLimiter: {
            consume() {
                //Allowing these requests to reach the object policy under test.
                return {allowed: true, remaining: 10, retryAfterMs: 0};

            }
        },
        diagnostics: layerDiagnosticsCreate()
    });

    function executionDataCreate(profileId, fields) {
        //Creating a valid envelope while varying only authorization inputs.
        return {
            request: {
                requestId: '7ec2df78-6db4-4b35-8eb0-b2476bb10010',
                type: 'command',
                operation: 'profile.fields.update',
                payload: {profileId, fields}
            },
            headers: {},
            remoteAddress: '127.0.0.1'
        };

    }

    await layerErrorRejects(() => operationExecutor.execute(
        executionDataCreate('user-2', {displayName: 'attacker'})
    ), LAYER_ERROR_CODES.OBJECT_ACCESS_DENIED);
    await layerErrorRejects(() => operationExecutor.execute(
        executionDataCreate('user-1', {role: 'admin'})
    ), LAYER_ERROR_CODES.OBJECT_ACCESS_DENIED);
    assert.deepEqual(await operationExecutor.execute(
        executionDataCreate('user-1', {displayName: 'Safe'})
    ), {accepted: true});
    assert.equal(handlerCount, 1);
});

test('threat suite blocks SSRF and DNS rebinding', async () => {
    const policy = layerOutboundUrlPolicyCreate({
        allowedOrigins: ['https://media.example.com'],
        async lookup() {
            //Simulating a rebinding answer containing one internal target.
            return [
                {address: '8.8.8.8', family: 4},
                {address: '169.254.169.254', family: 4}
            ];

        }
    });

    await layerErrorRejects(() => policy.authorize('https://media.example.com/avatar'), LAYER_ERROR_CODES.OUTBOUND_REQUEST_DENIED);
    await layerErrorRejects(() => policy.authorize('https://169.254.169.254/latest/meta-data'), LAYER_ERROR_CODES.OUTBOUND_REQUEST_DENIED);
    await layerErrorRejects(() => policy.authorize('https://attacker.example/redirect'), LAYER_ERROR_CODES.OUTBOUND_REQUEST_DENIED);
});

test('threat suite resists oversized, deep, spoofed-rate, and slow HTTP clients', async () => {
    const operationRegistry = layerOperationRegistryCreate();

    operationRegistry.define({
        name: 'security.status.read',
        type: 'query',
        auth: 'none',
        audit: {enabled: false},
        inputSchema: {type: 'object'},
        outputSchema: {type: 'object'},
        async handler() {
            //Returning an empty bounded response after all transport checks.
            return {};

        }
    });

    const operationExecutor = layerOperationExecutorCreate({
        operationRegistry,
        security: layerAuthenticationCreate(),
        rateLimiter: layerInMemoryRateLimiterCreate(),
        diagnostics: layerDiagnosticsCreate()
    });
    const runtime = layerHttpRuntimeCreate({
        operationRegistry,
        operationExecutor,
        diagnostics: layerDiagnosticsCreate(),
        maximumBodyBytes: 256,
        maximumBodyDepth: 4,
        requestTimeoutMs: 100
    });

    await runtime.start({port: 0});

    try {
        const addressData = runtime.address();

        assert.ok(addressData !== null && typeof addressData === 'object');

        const runtimeUrl = `http://127.0.0.1:${addressData.port}`;
        const oversizedResponse = await fetch(`${runtimeUrl}/api`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({padding: 'x'.repeat(400)})
        });
        const deepResponse = await fetch(`${runtimeUrl}/api`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({a: {b: {c: {d: {e: true}}}}})
        });

        assert.equal(oversizedResponse.status, 413);
        assert.equal(deepResponse.status, 400);

        const statuses = [];
        const anonymousBurstLimit = 40;

        //Consuming the complete doubled reserve through one trusted client address.
        for (let requestIndex = 0; requestIndex <= anonymousBurstLimit; requestIndex += 1) {
            const rateResponse = await fetch(`${runtimeUrl}/api`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-forwarded-for': `198.51.100.${requestIndex}`
                },
                body: JSON.stringify({
                    protocol: 1,
                    requestId: `7ec2df78-6db4-4b35-8eb0-${String(100000 + requestIndex).padStart(12, '0')}`,
                    type: 'query',
                    operation: 'security.status.read',
                    payload: {}
                })
            });

            statuses.push(rateResponse.status);

        }

        assert.equal(statuses.slice(0, anonymousBurstLimit).every(function successfulRateResponseCheck( statusData ){
            //Confirming every request inside the reserved burst reached the operation.
            return statusData === 200;

        }), true);
        assert.equal(statuses[anonymousBurstLimit], 429);

        const slowClientResult = await new Promise(function slowClientRun(resolve, reject) {
            const socket = createConnection(addressData.port, '127.0.0.1');
            let responseText = '';
            const deadline = setTimeout(function slowClientDeadline() {
                //Ending the probe if the runtime failed to close the slow request.
                socket.destroy();
                reject(new Error('Slow client was not closed within the test deadline.'));

            }, 2000);

            socket.on('connect', function slowClientConnect() {
                //Sending valid headers but withholding the declared body.
                socket.write('POST /api HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{');

            });
            socket.on('data', function slowClientData(chunkData) {
                //Collecting the bounded public timeout response.
                responseText += chunkData.toString('utf8');

            });
            socket.on('close', function slowClientClose() {
                //Completing after the runtime closes or rejects the partial body.
                clearTimeout(deadline);
                resolve(responseText);

            });
            socket.on('error', function slowClientError(errorData) {
                //Treating connection errors as explicit probe failures.
                clearTimeout(deadline);
                reject(errorData);

            });
        });

        assert.match(String(slowClientResult), /HTTP\/1\.1 408/);

    } finally {
        await runtime.stop({deadlineMs: 1000});

    }
});

test('threat suite makes offline command replay idempotent', async () => {
    const operationRegistry = layerOperationRegistryCreate();
    const resultMap = new Map();
    let handlerCount = 0;

    operationRegistry.define({
        name: 'chat.message.send',
        type: 'command',
        auth: 'bearer',
        audit: {enabled: false},
        transaction: true,
        offlineReplay: true,
        inputSchema: {
            type: 'object',
            required: ['commandId'],
            properties: {commandId: {type: 'string'}}
        },
        outputSchema: {
            type: 'object',
            required: ['messageId'],
            properties: {messageId: {type: 'string'}}
        },
        async handler() {
            handlerCount += 1;

            return {messageId: 'message-1'};

        }
    });

    const database = {
        async transaction(/** @type {any} */ transactionHandler) {
            //Providing one atomic command-result store for duplicate delivery.
            return transactionHandler({
                async query(/** @type {any} */ queryData) {
                    if (queryData.text.includes('SELECT operation')) {
                        const resultData = resultMap.get(queryData.values[1]);

                        return {
                            rows: resultData === undefined ? [] : [resultData],
                            rowCount: resultData === undefined ? 0 : 1
                        };

                    }

                    if (queryData.text.includes('sys_command_results')) {
                        resultMap.set(queryData.values[1], {
                            operation: queryData.values[2],
                            result: JSON.parse(queryData.values[3]),
                            actor_key: queryData.values[4],
                            request_digest: queryData.values[5]
                        });

                    }

                    return {rows: [], rowCount: 1};

                }
            });

        }
    };
    const operationExecutor = layerOperationExecutorCreate({
        operationRegistry,
        security: layerAuthenticationCreate({
            bearerResolve(){
                //Binding offline replay to the verified account instead of a shared anonymous scope
                return {id: 'fixture-token', userId: 'alice', tenantId: 'tenant-a', permissions: [], status: 'active', expiresAt: Date.now() + 60000};

            }
        }),
        rateLimiter: {
            consume() {
                //Allowing duplicate delivery to reach the idempotency boundary.
                return {allowed: true, remaining: 10, retryAfterMs: 0};

            }
        },
        diagnostics: layerDiagnosticsCreate(),
        database
    });
    const executionData = {
        request: {
            requestId: '7ec2df78-6db4-4b35-8eb0-b2476bb10020',
            type: 'command',
            operation: 'chat.message.send',
            payload: {commandId: 'command-1'}
        },
        headers: {authorization: 'Bearer fixture-token-for-offline-command-replay'},
        remoteAddress: '127.0.0.1'
    };

    assert.deepEqual(await operationExecutor.execute(executionData), {messageId: 'message-1'});
    assert.deepEqual(await operationExecutor.execute(executionData), {messageId: 'message-1'});
    assert.equal(handlerCount, 1);
});
