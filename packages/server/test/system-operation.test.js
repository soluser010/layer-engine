import assert from 'node:assert/strict';
import test from 'node:test';
import {
    layerInMemoryRateLimiterCreate,
    layerSessionSecurityCreate
} from '@solcorp/layer-security';
import {
    layerDiagnosticsCreate,
    layerHttpRuntimeCreate,
    layerOperationExecutorCreate,
    layerOperationRegistryCreate
} from '../src/index.js';
import {layerSystemOperationCreate} from '../src/system.js';

const requestIdentifierData = String( '7ec2df78-6db4-4b35-8eb0-b2476bb10055' );

test( 'system operation receives bounded Auth cookie effects without exposing its marker', async function(){
    const operationRegistryData = layerOperationRegistryCreate();
    const diagnosticsData = layerDiagnosticsCreate();
    const securityData = layerSessionSecurityCreate({
        allowedOrigins: ['http://127.0.0.1'],
        sessionResolve: async function sessionResolve(){
            return null;

        }
    });

    const systemOperationData = layerSystemOperationCreate(/** @type {any} */ ({
        name: 'auth.session.issue',
        type: 'command',
        auth: 'none',
        inputSchema: {
            type: 'object',
            additionalProperties: false
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['accepted'],
            properties: {
                accepted: {
                    type: 'boolean'
                }
            }
        },
        handler: async function sessionIssue( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
            void payloadData;

            //Checking that only the system operation receives the response capability
            assert.equal( typeof contextData.response?.authSessionSet, 'function' );

            contextData.response.authSessionSet({
                sessionToken: 'session-token-value-with-sufficient-entropy',
                csrfToken: 'csrf-token-value-with-sufficient-entropy',
                maximumAgeSeconds: 3600
            });

            return {accepted: true};

        }
    }));
    const inspectionData = operationRegistryData.define( systemOperationData );

    assert.equal( 'system' in inspectionData, false );
    assert.equal( operationRegistryData.get( 'auth.session.issue' )?.system, true );

    const operationExecutorData = layerOperationExecutorCreate({
        operationRegistry: operationRegistryData,
        security: securityData,
        rateLimiter: layerInMemoryRateLimiterCreate(),
        diagnostics: diagnosticsData
    });
    const runtimeData = layerHttpRuntimeCreate({
        operationRegistry: operationRegistryData,
        operationExecutor: operationExecutorData,
        diagnostics: diagnosticsData,
        secureCookies: false
    });

    await runtimeData.start({port: 0});

    try {
        const addressData = runtimeData.address();

        assert.ok( addressData !== null && typeof addressData === String( 'object' ) );

        const networkAddressData = /** @type {import('node:net').AddressInfo} */ (addressData);
        const responseData = await fetch(`http://127.0.0.1:${Number( networkAddressData.port )}/api`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                protocol: 1,
                requestId: requestIdentifierData,
                type: 'command',
                operation: 'auth.session.issue',
                payload: {}
            })
        });
        const setCookieHeaderData = responseData.headers.getSetCookie();
        const sessionCookieData = String( setCookieHeaderData[0] );
        const csrfCookieData = String( setCookieHeaderData[1] );

        assert.equal( responseData.status, 200 );
        assert.equal( setCookieHeaderData.length, 2 );
        assert.match( sessionCookieData, /^layer_session=.*HttpOnly; SameSite=Lax$/u );
        assert.match( csrfCookieData, /^layer_csrf=.*SameSite=Lax$/u );
        assert.equal( setCookieHeaderData.join( ';' ).includes( 'Secure' ), false );

    } finally {
        await runtimeData.stop();

    }

});

test( 'ordinary operation never receives response effects', async function(){
    const operationRegistryData = layerOperationRegistryCreate();

    operationRegistryData.define({
        name: 'application.response.inspect',
        type: 'query',
        auth: 'none',
        inputSchema: true,
        outputSchema: true,
        handler: async function responseInspect( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
            void payloadData;
            assert.equal( 'response' in contextData, false );
            return {accepted: true};

        }
    });

    const operationExecutorData = layerOperationExecutorCreate({
        operationRegistry: operationRegistryData,
        security: layerSessionSecurityCreate({
            allowedOrigins: ['https://app.example.test'],
            sessionResolve: async function sessionResolve(){
                return null;

            }
        }),
        rateLimiter: layerInMemoryRateLimiterCreate(),
        diagnostics: layerDiagnosticsCreate()
    });

    const operationResultData = await operationExecutorData.execute({
        request: {
            protocol: 1,
            requestId: requestIdentifierData,
            type: 'query',
            operation: 'application.response.inspect',
            payload: {}
        },
        headers: {},
        remoteAddress: '127.0.0.1',
        responseEffects: {
            authSessionSet(){
                throw new Error( 'Ordinary operation received response effects.' );

            }
        }
    });

    assert.deepEqual( operationResultData, {accepted: true} );

});
