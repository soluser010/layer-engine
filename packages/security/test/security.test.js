import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {
    LAYER_ERROR_CODES,
    LayerError
} from '@solcorp/layer-protocol';
import {
    layerAuthenticationCreate,
    layerCookieValueGet,
    layerHeaderValueGet,
    layerIdentityCacheCreate,
    layerInMemoryRateLimiterCreate,
    layerRateLimiterFailoverCreate,
    layerOutboundUrlPolicyCreate,
    layerRedisRateLimiterCreate,
    layerSessionSecurityCreate
} from '../src/index.js';

const csrfToken = 'csrf-token-with-sufficient-entropy';
const csrfTokenHash = createHash('sha256').update(csrfToken, 'utf8').digest('hex');

/**
 * @param {Record<string, unknown>} [sessionOverride]
 */
function sessionSecurityCreate(sessionOverride = {}) {
    return layerSessionSecurityCreate({
        allowedOrigins: [
            'https://app.example.com'
        ],
        clock: () => 1000,
        sessionResolve: async () => ({
            id: 'session-hash-1',
            userId: 'user-1',
            tenantId: 'tenant-1',
            permissions: [
                'profile.read'
            ],
            csrfTokenHash,
            expiresAt: 2000,
            status: 'active',
            ...sessionOverride
        })
    });
}

/**
 * @param {Record<string, string | string[] | undefined>} [headerOverride]
 */
function sessionHeadersCreate(headerOverride = {}) {
    return {
        origin: 'https://app.example.com',
        'sec-fetch-site': 'same-origin',
        cookie: 'theme=dark; layer_session=opaque-session-1',
        'x-layer-csrf': csrfToken,
        ...headerOverride
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

test('reads headers and cookies without accepting ambiguous values', () => {
    assert.equal(layerHeaderValueGet({
        Origin: 'https://app.example.com'
    }, 'origin'), 'https://app.example.com');
    assert.equal(layerHeaderValueGet({
        origin: [
            'one',
            'two'
        ]
    }, 'origin'), undefined);
    assert.equal(layerHeaderValueGet({}, 'origin'), undefined);

    assert.equal(layerCookieValueGet('theme=dark; layer_session=opaque=value', 'layer_session'), 'opaque=value');
    assert.equal(layerCookieValueGet('layer_session=one; layer_session=two', 'layer_session'), undefined);
    assert.equal(layerCookieValueGet('broken; theme=dark', 'layer_session'), undefined);
    assert.equal(layerCookieValueGet(undefined, 'layer_session'), undefined);
});

test('creates anonymous context only for explicit public operations', async () => {
    const security = sessionSecurityCreate();
    const securityContext = await security.contextResolve({
        auth: 'none',
        permissions: [],
        headers: {},
        remoteAddress: '127.0.0.1'
    });

    assert.deepEqual(securityContext, {
        authenticationType: 'anonymous',
        credentialId: null,
        sessionId: null,
        userId: null,
        tenantId: null,
        permissions: [],
        remoteAddress: '127.0.0.1'
    });
    assert.ok(Object.isFrozen(securityContext));
});

test( 'authenticated mode chooses bearer or a CSRF-protected session without fallback', async function(){
    //Keeping the session branch protected even though the operation accepts two credential types
    const requestData = {auth: /** @type {const} */ ('authenticated'), permissions: ['profile.read'], headers: sessionHeadersCreate(), remoteAddress: '127.0.0.1'};
    const sessionData = await sessionSecurityCreate().contextResolve( requestData );
    assert.equal( sessionData.authenticationType, 'session' );
    await layerErrorRejects(function missingCsrfReject(){
        return sessionSecurityCreate().contextResolve({...requestData, headers: sessionHeadersCreate({'x-layer-csrf': undefined})});

    }, LAYER_ERROR_CODES.CSRF_INVALID );
    await layerErrorRejects(function badBearerNeverFallsBack(){
        return sessionSecurityCreate().contextResolve({...requestData, headers: sessionHeadersCreate({authorization: 'Bearer invalid'})});

    }, LAYER_ERROR_CODES.AUTH_REQUIRED );
    const bearerData = layerAuthenticationCreate({clock: function clockRead(){
        return 1000;

    }, async bearerResolve(){
        return {id: 'bearer', userId: 'user', tenantId: null, permissions: ['profile.read'], status: 'active', expiresAt: 2000,
            credentialReference: 'oidc:server-derived-reference'};

    }});
    const identityData = await bearerData.contextResolve({...requestData, headers: {authorization: 'Bearer valid-token-with-sufficient-entropy'}});
    assert.equal( identityData.authenticationType, 'bearer' );
    assert.equal( identityData.credentialReference, 'oidc:server-derived-reference' );

});

test('resolves a valid session, CSRF token, and permissions', async () => {
    let resolvedIdentifier;
    const security = layerSessionSecurityCreate({
        allowedOrigins: [
            'https://app.example.com'
        ],
        clock: () => 1000,
        sessionResolve: async (sessionIdentifier) => {
            resolvedIdentifier = sessionIdentifier;

            return {
                id: 'session-hash-1',
                userId: 'user-1',
                tenantId: null,
                permissions: [
                    'profile.read'
                ],
                csrfTokenHash,
                expiresAt: 2000,
                status: 'active'
            };
        }
    });
    const securityContext = await security.contextResolve({
        auth: 'session',
        permissions: [
            'profile.read'
        ],
        headers: sessionHeadersCreate(),
        remoteAddress: '127.0.0.1'
    });

    assert.equal(resolvedIdentifier, 'opaque-session-1');
    assert.equal(securityContext.authenticationType, 'session');
    assert.equal(securityContext.credentialId, 'session-hash-1');
    assert.equal(securityContext.sessionId, 'session-hash-1');
    assert.equal(securityContext.userId, 'user-1');
    assert.equal(securityContext.tenantId, null);
    assert.equal('csrfTokenHash' in securityContext, false);
});

test('fails closed for unsupported auth, origin, session, CSRF, and permission states', async () => {
    await layerErrorRejects(() => sessionSecurityCreate().contextResolve({
        auth: 'bearer',
        permissions: [],
        headers: {},
        remoteAddress: '127.0.0.1'
    }), LAYER_ERROR_CODES.AUTH_REQUIRED);

    await layerErrorRejects(() => sessionSecurityCreate().contextResolve({
        auth: 'session',
        permissions: [],
        headers: sessionHeadersCreate({
            origin: 'https://attacker.example'
        }),
        remoteAddress: '127.0.0.1'
    }), LAYER_ERROR_CODES.CSRF_INVALID);

    await layerErrorRejects(() => sessionSecurityCreate().contextResolve({
        auth: 'session',
        permissions: [],
        headers: sessionHeadersCreate({
            'sec-fetch-site': 'cross-site'
        }),
        remoteAddress: '127.0.0.1'
    }), LAYER_ERROR_CODES.CSRF_INVALID);

    await layerErrorRejects(() => sessionSecurityCreate().contextResolve({
        auth: 'session',
        permissions: [],
        headers: sessionHeadersCreate({
            cookie: 'theme=dark'
        }),
        remoteAddress: '127.0.0.1'
    }), LAYER_ERROR_CODES.AUTH_REQUIRED);

    await layerErrorRejects(() => sessionSecurityCreate({
        status: 'revoked'
    }).contextResolve({
        auth: 'session',
        permissions: [],
        headers: sessionHeadersCreate(),
        remoteAddress: '127.0.0.1'
    }), LAYER_ERROR_CODES.AUTH_REQUIRED);

    await layerErrorRejects(() => sessionSecurityCreate({
        expiresAt: 1000
    }).contextResolve({
        auth: 'session',
        permissions: [],
        headers: sessionHeadersCreate(),
        remoteAddress: '127.0.0.1'
    }), LAYER_ERROR_CODES.AUTH_REQUIRED);

    await layerErrorRejects(() => sessionSecurityCreate().contextResolve({
        auth: 'session',
        permissions: [],
        headers: sessionHeadersCreate({
            'x-layer-csrf': 'wrong-token'
        }),
        remoteAddress: '127.0.0.1'
    }), LAYER_ERROR_CODES.CSRF_INVALID);

    await layerErrorRejects(() => sessionSecurityCreate().contextResolve({
        auth: 'session',
        permissions: [
            'profile.write'
        ],
        headers: sessionHeadersCreate(),
        remoteAddress: '127.0.0.1'
    }), LAYER_ERROR_CODES.PERMISSION_DENIED);
});

test('rejects malformed security configuration and session records', async () => {
    assert.throws(() => {
        layerSessionSecurityCreate({
            allowedOrigins: [],
            sessionResolve: async () => null
        });
    }, TypeError);
    assert.throws(() => {
        layerSessionSecurityCreate(/** @type {any} */ ({
            allowedOrigins: [
                'https://app.example.com'
            ],
            sessionResolve: false
        }));
    }, TypeError);

    const malformedSecurity = layerSessionSecurityCreate(/** @type {any} */ ({
        allowedOrigins: [
            'https://app.example.com'
        ],
        sessionResolve: async () => ({
            userId: 'missing-fields'
        })
    }));

    await layerErrorRejects(() => malformedSecurity.contextResolve({
        auth: 'session',
        permissions: [],
        headers: sessionHeadersCreate(),
        remoteAddress: '127.0.0.1'
    }), LAYER_ERROR_CODES.AUTH_REQUIRED);
});

test('resolves OIDC bearer and hashed scoped API-key identities', async () => {
    const bearerToken = 'oidc-token-with-sufficient-entropy';
    const apiKey = 'layer_api_key_with_sufficient_entropy_1';
    const expectedApiKeyHash = createHash('sha256').update(apiKey, 'utf8').digest('hex');
    let resolvedBearerToken = '';
    let resolvedBearerContext = /** @type {any} */ (null);
    let resolvedApiKeyHash = '';
    const authentication = layerAuthenticationCreate({
        clock: () => 1000,
        bearerResolve: async (tokenData, requestContextData) => {
            resolvedBearerToken = tokenData;
            resolvedBearerContext = requestContextData;

            return {
                id: 'bearer-subject-1',
                userId: 'user-1',
                tenantId: 'tenant-1',
                permissions: ['profile.read'],
                expiresAt: 2000,
                status: 'active'
            };
        },
        apiKeyResolve: async (apiKeyHash) => {
            resolvedApiKeyHash = apiKeyHash;

            return {
                id: 'api-key-1',
                userId: 'integration-1',
                tenantId: 'tenant-1',
                permissions: ['message.send'],
                expiresAt: 2000,
                status: 'active'
            };
        }
    });
    const bearerContext = await authentication.contextResolve({
        auth: 'bearer',
        permissions: ['profile.read'],
        headers: {
            authorization: `Bearer ${bearerToken}`
        },
        remoteAddress: '127.0.0.1'
    });
    const apiKeyContext = await authentication.contextResolve({
        auth: 'api-key',
        permissions: ['message.send'],
        headers: {
            'x-layer-api-key': apiKey
        },
        remoteAddress: '127.0.0.2'
    });
    await authentication.contextResolve({
        auth: 'bearer',
        permissions: ['profile.read'],
        headers: {
            authorization: `DPoP ${bearerToken}`,
            dpop: 'signed-proof-value'
        },
        remoteAddress: '127.0.0.3'
    });

    assert.equal(resolvedBearerToken, bearerToken);
    assert.equal(resolvedBearerContext.scheme, 'dpop');
    assert.equal(resolvedBearerContext.headers.dpop, 'signed-proof-value');
    assert.equal(bearerContext.authenticationType, 'bearer');
    assert.equal(bearerContext.credentialId, 'bearer-subject-1');
    assert.equal(bearerContext.sessionId, null);
    assert.equal(resolvedApiKeyHash, expectedApiKeyHash);
    assert.notEqual(resolvedApiKeyHash, apiKey);
    assert.equal(apiKeyContext.authenticationType, 'api-key');
    assert.equal(apiKeyContext.credentialId, 'api-key-1');
    assert.deepEqual(apiKeyContext.permissions, ['message.send']);
});

test('external credentials fail closed for malformed, revoked, expired, and under-scoped identities', async () => {
    const authentication = layerAuthenticationCreate({
        clock: () => 1000,
        bearerResolve: async () => ({
            id: 'bearer-1',
            userId: 'user-1',
            tenantId: null,
            permissions: ['profile.read'],
            expiresAt: 2000,
            status: 'active'
        }),
        apiKeyResolve: async () => ({
            id: 'api-key-1',
            userId: 'integration-1',
            tenantId: null,
            permissions: ['message.read'],
            expiresAt: 900,
            status: 'active'
        })
    });

    await layerErrorRejects(() => authentication.contextResolve({
        auth: 'bearer',
        permissions: [],
        headers: {authorization: 'Bearer short'},
        remoteAddress: '127.0.0.1'
    }), LAYER_ERROR_CODES.AUTH_REQUIRED);
    await layerErrorRejects(() => authentication.contextResolve({
        auth: 'bearer',
        permissions: ['profile.write'],
        headers: {authorization: 'Bearer oidc-token-with-sufficient-entropy'},
        remoteAddress: '127.0.0.1'
    }), LAYER_ERROR_CODES.PERMISSION_DENIED);
    await layerErrorRejects(() => authentication.contextResolve({
        auth: 'api-key',
        permissions: [],
        headers: {'x-layer-api-key': 'layer_api_key_with_sufficient_entropy_1'},
        remoteAddress: '127.0.0.1'
    }), LAYER_ERROR_CODES.AUTH_REQUIRED);
    assert.throws(() => layerAuthenticationCreate(/** @type {any} */ ({
        allowedOrigins: ['https://app.example.com', 'https://app.example.com']
    })), TypeError);
    assert.throws(() => layerAuthenticationCreate(/** @type {any} */ ({
        bearerResolve: true
    })), TypeError);
});

test('authentication fails closed when a configured mode or trusted identity shape is unavailable', async () => {
    const authentication = layerAuthenticationCreate({
        allowedOrigins: ['https://app.example.com'],
        clock: () => 1000,
        sessionResolve: async () => ({
            id: 'session-1',
            userId: 'user-1',
            tenantId: null,
            permissions: Array.from({length: 501}, () => 'profile.read'),
            csrfTokenHash: 'short',
            expiresAt: 2000,
            status: 'active'
        })
    });

    await layerErrorRejects(() => layerAuthenticationCreate().contextResolve({
        auth: 'session',
        permissions: [],
        headers: sessionHeadersCreate(),
        remoteAddress: '127.0.0.1'
    }), LAYER_ERROR_CODES.AUTH_REQUIRED);
    await layerErrorRejects(() => layerAuthenticationCreate().contextResolve({
        auth: 'bearer',
        permissions: [],
        headers: {authorization: 'Bearer credential-with-sufficient-entropy'},
        remoteAddress: '127.0.0.1'
    }), LAYER_ERROR_CODES.AUTH_REQUIRED);
    await layerErrorRejects(() => layerAuthenticationCreate().contextResolve({
        auth: 'api-key',
        permissions: [],
        headers: {'x-layer-api-key': 'layer_api_key_with_sufficient_entropy_1'},
        remoteAddress: '127.0.0.1'
    }), LAYER_ERROR_CODES.AUTH_REQUIRED);
    await layerErrorRejects(() => layerAuthenticationCreate().contextResolve(/** @type {any} */ ({
        auth: 'unknown',
        permissions: [],
        headers: {},
        remoteAddress: '127.0.0.1'
    })), LAYER_ERROR_CODES.AUTH_REQUIRED);
    await layerErrorRejects(() => authentication.contextResolve({
        auth: 'session',
        permissions: [],
        headers: sessionHeadersCreate(),
        remoteAddress: '127.0.0.1'
    }), LAYER_ERROR_CODES.AUTH_REQUIRED);
    assert.throws(() => layerAuthenticationCreate(/** @type {any} */ ({
        allowedOrigins: [false]
    })), TypeError);
});

test('token bucket enforces cost atomically and refills over time', () => {
    let currentTime = 0;
    const rateLimiter = layerInMemoryRateLimiterCreate({
        clock: () => currentTime,
        maxEntries: 20,
        entryTtlMs: 1000
    });
    const rateRequest = {
        profile: /** @type {const} */ ('anonymous'),
        remoteAddress: '127.0.0.1',
        sessionId: null,
        userId: null,
        tenantId: null,
        operation: 'health.status.read',
        cost: 40
    };

    assert.deepEqual(rateLimiter.consume(rateRequest), {
        allowed: true,
        remaining: 0,
        retryAfterMs: 0
    });
    assert.deepEqual(rateLimiter.consume({
        ...rateRequest,
        cost: 1
    }), {
        allowed: false,
        remaining: 0,
        retryAfterMs: 500
    });

    currentTime = 1000;
    assert.equal(rateLimiter.consume({
        ...rateRequest,
        cost: 1
    }).allowed, true);
    assert.equal(rateLimiter.sizeGet(), 2);
});

test('token bucket scopes operation protection to the requesting address', function operationAddressScopeCheck(){
    //Exhausting one address without consuming another address operation bucket.
    const rateLimiter = layerInMemoryRateLimiterCreate();
    const firstAddressRequest = {
        profile: /** @type {const} */ ('anonymous'),
        remoteAddress: '203.0.113.10',
        sessionId: null,
        userId: null,
        tenantId: null,
        operation: 'catalog.read',
        cost: 40
    };

    assert.equal(rateLimiter.consume(firstAddressRequest).allowed, true);
    assert.equal(rateLimiter.consume({
        ...firstAddressRequest,
        cost: 1
    }).allowed, false);
    assert.equal(rateLimiter.consume({
        ...firstAddressRequest,
        remoteAddress: '203.0.113.11',
        cost: 1
    }).allowed, true);

});

test('token bucket includes authenticated dimensions and bounds memory', () => {
    let currentTime = 0;
    const rateLimiter = layerInMemoryRateLimiterCreate({
        clock: () => currentTime,
        maxEntries: 5,
        entryTtlMs: 1000
    });
    const sessionResult = rateLimiter.consume({
        profile: 'session',
        remoteAddress: '127.0.0.1',
        sessionId: 'session-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        operation: 'profile.current.read',
        cost: 1
    });

    assert.equal(sessionResult.allowed, true);
    assert.equal(rateLimiter.sizeGet(), 5);
    assert.equal(rateLimiter.consume({
        profile: 'anonymous',
        remoteAddress: '127.0.0.2',
        sessionId: null,
        userId: null,
        tenantId: null,
        operation: 'health.status.read',
        cost: 1
    }).allowed, false);

    currentTime = 1001;
    assert.equal(rateLimiter.consume({
        profile: 'anonymous',
        remoteAddress: '127.0.0.2',
        sessionId: null,
        userId: null,
        tenantId: null,
        operation: 'health.status.read',
        cost: 1
    }).allowed, true);
});

test('token bucket validates configuration and cost', () => {
    assert.throws(() => {
        layerInMemoryRateLimiterCreate({
            maxEntries: 0
        });
    }, TypeError);

    const rateLimiter = layerInMemoryRateLimiterCreate();

    assert.throws(() => {
        rateLimiter.consume({
            profile: 'anonymous',
            remoteAddress: '127.0.0.1',
            sessionId: null,
            userId: null,
            tenantId: null,
            operation: 'health.status.read',
            cost: 0
        });
    }, TypeError);
});

test('Redis token bucket hashes dimensions and accepts atomic Lua results', async () => {
    const evalRecords = /** @type {{scriptData: string, commandData: {keys: readonly string[], arguments: readonly string[]}}[]} */ ([]);
    const rateLimiter = layerRedisRateLimiterCreate({
        redis: {
            async eval(scriptData, commandData) {
                evalRecords.push({scriptData, commandData});

                return [1, 99, 0];
            }
        }
    });
    const rateResult = await rateLimiter.consume({
        profile: 'bearer',
        remoteAddress: '203.0.113.10',
        credentialId: 'bearer-subject-1',
        sessionId: null,
        userId: 'user-1',
        tenantId: 'tenant-1',
        operation: 'profile.read',
        cost: 1
    });

    assert.deepEqual(rateResult, {
        allowed: true,
        remaining: 99,
        retryAfterMs: 0
    });
    assert.equal(evalRecords.length, 1);
    assert.equal(evalRecords[0]?.commandData.keys.length, 5);
    assert.equal(evalRecords[0]?.commandData.arguments[0], '1');
    assert.equal(evalRecords[0]?.commandData.arguments[1], '200');
    assert.equal(evalRecords[0]?.commandData.arguments[2], '1200');
    assert.equal(evalRecords[0]?.scriptData.includes("redis.call('TIME')"), true);
    assert.equal(evalRecords[0]?.commandData.keys.some((keyData) => keyData.includes('user-1') || keyData.includes('203.0.113.10')), false);
});

test('Redis token bucket preserves denial and fails closed on malformed results', async () => {
    const deniedLimiter = layerRedisRateLimiterCreate({
        redis: {
            async eval() {
                return ['0', '0', '500'];
            }
        }
    });
    const requestData = {
        profile: /** @type {const} */ ('api-key'),
        remoteAddress: '203.0.113.20',
        credentialId: 'api-key-1',
        sessionId: null,
        userId: 'integration-1',
        tenantId: null,
        operation: 'message.send',
        cost: 5
    };

    assert.deepEqual(await deniedLimiter.consume(requestData), {
        allowed: false,
        remaining: 0,
        retryAfterMs: 500
    });

    const malformedLimiter = layerRedisRateLimiterCreate({
        redis: {
            async eval() {
                return ['invalid'];
            }
        }
    });
    await assert.rejects(() => malformedLimiter.consume(requestData), TypeError);
    assert.throws(() => layerRedisRateLimiterCreate(/** @type {any} */ ({redis: {}})), TypeError);
    assert.throws(() => layerRedisRateLimiterCreate(/** @type {any} */ ({
        redis: {eval() {}},
        entryTtlMs: 1
    })), TypeError);
    assert.throws(() => layerRedisRateLimiterCreate(/** @type {any} */ ({
        redis: {eval() {}},
        profiles: {
            anonymous: null
        }
    })), TypeError);
    await assert.rejects(() => deniedLimiter.consume({
        ...requestData,
        cost: 0
    }), TypeError);

    const invalidBoundsLimiter = layerRedisRateLimiterCreate({
        redis: {
            async eval() {
                return [1, -1, 0];
            }
        }
    });
    await assert.rejects(() => invalidBoundsLimiter.consume(requestData), TypeError);
});

test('identity cache stores active sessions and API keys with immediate tagged invalidation', async () => {
    const cacheValueMapData = new Map();
    const cacheTagMapData = new Map();
    const diagnosticsData = /** @type {Record<string, unknown>[]} */ ([]);
    let currentTimeData = Number( 1000 );
    let sessionResolveCountData = Number( 0 );
    let apiKeyResolveCountData = Number( 0 );
    let sessionStatusData = /** @type {'active' | 'revoked'} */ ('active');
    let apiKeyStatusData = /** @type {'active' | 'revoked'} */ ('active');
    let invalidationFailureStatusData = false;
    const requestKeyCreateData = function( /** @type {any} */ requestData ){
        return `${String( requestData.operation )}:${JSON.stringify( requestData.payload )}`;
    };
    const identityCacheData = layerIdentityCacheCreate({
        cache: {
            async generationRead(){
                //Keeping this revocation fixture on one connected cache generation
                return 'test-generation';

            },

            async read( requestData ){
                const requestKeyData = requestKeyCreateData( requestData );

                return cacheValueMapData.has( requestKeyData ) === true ? {
                    hit: true,
                    value: cacheValueMapData.get( requestKeyData )
                } : {
                    hit: false,
                    value: null
                };
            },
            async write( requestData, valueData ){
                const requestKeyData = requestKeyCreateData( requestData );

                cacheValueMapData.set( requestKeyData, valueData );

                for ( const tagData of requestData.metadata.tags ){
                    const taggedKeysData = cacheTagMapData.get( tagData ) ?? new Set();

                    taggedKeysData.add( requestKeyData );
                    cacheTagMapData.set( tagData, taggedKeysData );
                }

                return true;
            },
            async invalidate( invalidationData ){
                if ( invalidationFailureStatusData === true ){
                    throw new Error( 'Redis unavailable' );

                }

                let removedCountData = Number( 0 );

                for ( const tagData of invalidationData.tags ){
                    for ( const requestKeyData of cacheTagMapData.get( tagData ) ?? [] ){
                        removedCountData += cacheValueMapData.delete( requestKeyData ) === true ? Number( 1 ) : Number( 0 );
                    }

                    cacheTagMapData.delete( tagData );
                }

                return removedCountData;
            }
        },
        sessions: {
            async resolve(){
                sessionResolveCountData += Number( 1 );

                return {
                    id: 'session-hash',
                    userId: 'user-1',
                    tenantId: 'tenant-1',
                    permissions: ['profile.read'],
                    csrfTokenHash,
                    status: sessionStatusData,
                    expiresAt: 61000
                };
            },
            async revoke(){
                sessionStatusData = 'revoked';

                return true;
            },
            cacheTagCreate( sessionIdentifierData ){
                return `session:${createHash( 'sha256' ).update( sessionIdentifierData, 'utf8' ).digest( 'hex' )}`;
            }
        },
        apiKeys: {
            async resolve(){
                apiKeyResolveCountData += Number( 1 );

                return {
                    id: 'key-1',
                    userId: 'service-1',
                    tenantId: null,
                    permissions: ['message.send'],
                    status: apiKeyStatusData,
                    expiresAt: 61000
                };
            },
            async revokeWithCacheTag(){
                apiKeyStatusData = 'revoked';

                return {
                    revoked: true,
                    cacheTag: `api-key:${'a'.repeat( 64 )}`
                };
            }
        },
        maximumTtlMs: 30000,
        clock: () => currentTimeData,
        diagnostics: {
            record( diagnosticData ){
                diagnosticsData.push( diagnosticData );
            }
        }
    });

    assert.equal( (await identityCacheData.sessions.resolve( 'opaque-session-identifier' )).status, 'active' );
    assert.equal( (await identityCacheData.sessions.resolve( 'opaque-session-identifier' )).status, 'active' );
    assert.equal( sessionResolveCountData, 1 );

    assert.equal( (await identityCacheData.apiKeys.resolve( 'a'.repeat( 64 ) )).status, 'active' );
    assert.equal( (await identityCacheData.apiKeys.resolve( 'a'.repeat( 64 ) )).status, 'active' );
    assert.equal( apiKeyResolveCountData, 1 );
    assert.equal( await identityCacheData.apiKeys.revoke( 'key-1' ), true );
    assert.equal( (await identityCacheData.apiKeys.resolve( 'a'.repeat( 64 ) )).status, 'revoked' );
    assert.equal( apiKeyResolveCountData, 2 );

    invalidationFailureStatusData = true;
    assert.equal( await identityCacheData.sessions.revoke( 'opaque-session-identifier' ), true );
    assert.equal( identityCacheData.isBypassing(), true );
    assert.equal( (await identityCacheData.sessions.resolve( 'opaque-session-identifier' )).status, 'revoked' );
    assert.equal( sessionResolveCountData, 2 );
    assert.equal( diagnosticsData.at( -1 )?.event, 'identity-cache.invalidation-failed' );

    currentTimeData = Number( 32000 );
    assert.equal( identityCacheData.isBypassing(), false );
});

test('identity cache rejects unsafe contracts and never negative-caches misses', async () => {
    assert.throws(
        () => layerIdentityCacheCreate(/** @type {any} */ ({})),
        TypeError
    );

    let resolveCountData = Number( 0 );
    const identityCacheData = layerIdentityCacheCreate({
        cache: {
            async read(){
                return {hit: false, value: null};
            },
            async write(){
                return true;
            },
            async invalidate(){
                return 0;
            }
        },
        sessions: {
            async resolve(){
                resolveCountData += Number( 1 );

                return null;
            },
            async revoke(){
                return false;
            },
            cacheTagCreate(){
                return 'session:missing';
            }
        },
        apiKeys: {
            async resolve(){
                return null;
            },
            async revokeWithCacheTag(){
                return {revoked: false, cacheTag: null};
            }
        },
        clock: () => 1000
    });

    assert.equal( await identityCacheData.sessions.resolve( 'missing-session' ), null );
    assert.equal( await identityCacheData.sessions.resolve( 'missing-session' ), null );
    assert.equal( resolveCountData, 2 );
    await assert.rejects(() => identityCacheData.sessions.resolve( '' ), TypeError);
    await assert.rejects(() => identityCacheData.apiKeys.resolve( 'invalid' ), TypeError);
    assert.equal( await identityCacheData.apiKeys.revoke( 'missing-key' ), false );
});

test('rate limiter failover uses durable fallback and retries Redis after cooldown', async () => {
    let currentTimeData = Number( 1000 );
    let primaryCallsData = Number( 0 );
    let fallbackCallsData = Number( 0 );
    let primaryFailureStatusData = true;
    const diagnosticsData = /** @type {any[]} */ ([]);
    const limiterData = layerRateLimiterFailoverCreate({
        primary: {
            async consume(){
                primaryCallsData += Number( 1 );

                if ( primaryFailureStatusData === true ){
                    throw Object.assign( new Error( 'private failure' ), {
                        code: 'REDIS_UNAVAILABLE'
                    });

                }

                return {allowed: true, remaining: 99, retryAfterMs: 0};

            }
        },
        fallback: {
            async consume(){
                fallbackCallsData += Number( 1 );

                return {allowed: true, remaining: 19, retryAfterMs: 0};

            }
        },
        diagnostics: {
            record( diagnosticData ){
                diagnosticsData.push( diagnosticData );

            }
        },
        recoveryCooldownMs: 1000,
        clock: () => currentTimeData
    });

    assert.equal( (await limiterData.consume({})).remaining, 19 );
    assert.equal( (await limiterData.consume({})).remaining, 19 );
    assert.equal( primaryCallsData, 1 );
    assert.equal( fallbackCallsData, 2 );
    assert.equal( diagnosticsData[0].code, 'REDIS_UNAVAILABLE' );
    assert.equal( limiterData.isPrimaryAvailable(), false );

    currentTimeData = Number( 2000 );
    primaryFailureStatusData = false;

    assert.equal( (await limiterData.consume({})).remaining, 99 );
    assert.equal( primaryCallsData, 2 );
    assert.equal( limiterData.isPrimaryAvailable(), true );
    assert.throws(
        () => layerRateLimiterFailoverCreate(/** @type {any} */ ({primary: {}, fallback: {}})),
        TypeError
    );
    assert.throws(() => layerRateLimiterFailoverCreate({
        primary: {consume: async () => ({allowed: true, remaining: 1, retryAfterMs: 0})},
        fallback: {consume: async () => ({allowed: true, remaining: 1, retryAfterMs: 0})},
        recoveryCooldownMs: 99
    }), TypeError);
    assert.throws(() => layerRateLimiterFailoverCreate({
        primary: {consume: async () => ({allowed: true, remaining: 1, retryAfterMs: 0})},
        fallback: {consume: async () => ({allowed: true, remaining: 1, retryAfterMs: 0})},
        recoveryCooldownMs: 60001
    }), TypeError);

});

test('outbound URL policy accepts exact HTTPS origins with public DNS only', async () => {
    const lookupCalls = /** @type {any[]} */ ([]);
    const policy = layerOutboundUrlPolicyCreate({
        allowedOrigins: ['https://api.example.com'],
        async lookup(hostnameData, lookupOptions) {
            lookupCalls.push({hostnameData, lookupOptions});

            return [
                {address: '93.184.216.34', family: 4},
                {address: '2606:2800:220:1:248:1893:25c8:1946', family: 6}
            ];
        }
    });
    const authorizationData = await policy.authorize('https://api.example.com/v1/messages?limit=10');

    assert.deepEqual(authorizationData, {
        url: 'https://api.example.com/v1/messages?limit=10',
        origin: 'https://api.example.com',
        hostname: 'api.example.com',
        addresses: [
            '93.184.216.34',
            '2606:2800:220:1:248:1893:25c8:1946'
        ]
    });
    assert.deepEqual(lookupCalls, [{
        hostnameData: 'api.example.com',
        lookupOptions: {all: true, verbatim: true}
    }]);
    assert.equal(Object.isFrozen(authorizationData.addresses), true);
});

test('outbound URL policy blocks SSRF origins, credentials, DNS rebinding, and private addresses', async () => {
    const mixedDnsPolicy = layerOutboundUrlPolicyCreate({
        allowedOrigins: ['https://api.example.com'],
        async lookup() {
            return [
                {address: '93.184.216.34', family: 4},
                {address: '127.0.0.1', family: 4}
            ];
        }
    });

    for (const requestUrl of [
        'http://api.example.com/',
        'https://attacker.example/',
        'https://user:secret@api.example.com/',
        'https://api.example.com/#internal'
    ]) {
        await layerErrorRejects(() => mixedDnsPolicy.authorize(requestUrl), LAYER_ERROR_CODES.OUTBOUND_REQUEST_DENIED);
    }

    await layerErrorRejects(() => mixedDnsPolicy.authorize('https://api.example.com/'), LAYER_ERROR_CODES.OUTBOUND_REQUEST_DENIED);

    const privateLiteralPolicy = layerOutboundUrlPolicyCreate({
        allowedOrigins: ['https://127.0.0.1']
    });
    await layerErrorRejects(() => privateLiteralPolicy.authorize('https://127.0.0.1/'), LAYER_ERROR_CODES.OUTBOUND_REQUEST_DENIED);

    const failedDnsPolicy = layerOutboundUrlPolicyCreate({
        allowedOrigins: ['https://api.example.com'],
        async lookup() {
            throw new Error('dns detail');
        }
    });
    await layerErrorRejects(() => failedDnsPolicy.authorize('https://api.example.com/'), LAYER_ERROR_CODES.OUTBOUND_REQUEST_DENIED);

    assert.throws(() => layerOutboundUrlPolicyCreate({allowedOrigins: []}), TypeError);
    assert.throws(() => layerOutboundUrlPolicyCreate({allowedOrigins: ['http://api.example.com']}), TypeError);
    assert.throws(() => layerOutboundUrlPolicyCreate({
        allowedOrigins: ['https://api.example.com', 'https://api.example.com']
    }), TypeError);
});
