import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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
    layerHttpRuntimeCreate,
    layerOperationExecutorCreate,
    layerOperationRegistryCreate
} from '@solcorp/layer-server';
import {
    LayerAuthError,
    layerAuthOperationDefinitionsCreate,
    layerAuthServerRuntimeCreate
} from '../src/server.js';


const operationClockData = Date.parse( '2026-09-23T12:00:00.000Z' );
const sessionTokenData = String( 'managed-session-token-with-sufficient-entropy-value' );
const csrfTokenData = String( 'managed-csrf-token-with-sufficient-entropy-value' );


/** @returns {{revokedSessionsData: string[], service: any}} */
//Function for creating an Auth service fixture with observable session actions
const authServiceFixtureCreate = function(){
    const revokedSessionsData = /** @type {string[]} */ ([]);

    //CallBack THE OBJECT
    return {
        revokedSessionsData,
        service: {
            registration: {
                async create(){
                    return {
                        accepted: true,
                        verificationRequired: false,
                        userId: 'private-user-identifier'
                    };

                }
            },
            emailVerification: {
                async request(){
                    return {accepted: true};

                },
                async confirm(){
                    return {verified: true};

                }
            },
            passwordRecovery: {
                async request(){
                    return {accepted: true};

                },
                async complete(){
                    return {completed: true};

                }
            },
            signIn: {
                async password( /** @type {any} */ signInData ){
                    if ( signInData.password !== String( 'correct-password-value' ) ){
                        throw new LayerAuthError(
                            'AUTH_CREDENTIALS_INVALID',
                            'Login identifier or password is invalid.'
                        );

                    }

                    return {
                        userId: 'user-auth-1',
                        session: {
                            sessionId: 'session-current-identifier',
                            sessionToken: sessionTokenData,
                            csrfToken: csrfTokenData,
                            idleExpiresAt: operationClockData + 1800000,
                            absoluteExpiresAt: operationClockData + 43200000
                        }
                    };

                }
            },
            sessions: {
                async list(){
                    return [{
                        sessionId: 'session-current-identifier',
                        assurance: ['password'],
                        lastSeenAt: operationClockData,
                        idleExpiresAt: operationClockData + 1800000,
                        absoluteExpiresAt: operationClockData + 43200000,
                        createdAt: operationClockData - 60000
                    }, {
                        sessionId: 'session-secondary-identifier',
                        assurance: ['passkey'],
                        lastSeenAt: operationClockData - 30000,
                        idleExpiresAt: operationClockData + 1200000,
                        absoluteExpiresAt: operationClockData + 3600000,
                        createdAt: operationClockData - 120000
                    }];

                },
                async revoke( /** @type {string} */ sessionIdentifierData ){
                    revokedSessionsData.push( sessionIdentifierData );

                    return true;

                }
            }
        }
    };

};

/**
 * @param {ReturnType<typeof authServiceFixtureCreate>} fixtureData
 */
//Function for creating a complete HTTP Auth runtime fixture
const authRuntimeFixtureCreate = function( fixtureData ){
    const registryData = layerOperationRegistryCreate();
    const operationDefinitionsData = layerAuthOperationDefinitionsCreate({
        service: fixtureData.service,
        clock(){
            return operationClockData;

        }
    });

    //Registering every Auth definition before creating the executor
    for ( const operationData of operationDefinitionsData ){
        registryData.define( operationData );

    }

    const csrfHashData = createHash( 'sha256' ).update( csrfTokenData, 'utf8' ).digest( 'hex' );
    const securityData = layerSessionSecurityCreate({
        allowedOrigins: ['http://127.0.0.1'],
        clock(){
            return operationClockData;

        },
        async sessionResolve( providedSessionTokenData ){
            if ( providedSessionTokenData !== sessionTokenData ){
                return null;

            }

            return {
                id: 'session-current-identifier',
                userId: 'user-auth-1',
                tenantId: null,
                permissions: [],
                csrfTokenHash: csrfHashData,
                expiresAt: operationClockData + 1800000,
                status: 'active'
            };

        }
    });
    const diagnosticsData = layerDiagnosticsCreate();
    const executorData = layerOperationExecutorCreate({
        operationRegistry: registryData,
        security: securityData,
        rateLimiter: layerInMemoryRateLimiterCreate(),
        diagnostics: diagnosticsData,
        clock(){
            return operationClockData;

        }
    });
    const runtimeData = layerHttpRuntimeCreate({
        operationRegistry: registryData,
        operationExecutor: executorData,
        diagnostics: diagnosticsData,
        secureCookies: false
    });

    //CallBack THE OBJECT
    return {
        registry: registryData,
        runtime: runtimeData
    };

};

/**
 * @param {ReturnType<typeof layerHttpRuntimeCreate>} runtimeData
 */
//Function for getting the active loopback runtime address
const authRuntimeUrlGet = function( runtimeData ){
    const addressData = runtimeData.address();

    assert.ok( addressData !== null && typeof addressData === String( 'object' ) );
    const networkAddressData = /** @type {import('node:net').AddressInfo} */ (addressData);

    //CallBack THE STRING
    return `http://127.0.0.1:${Number( networkAddressData.port )}`;

};

test( 'Auth operation definitions keep system capabilities outside inspection', function(){
    const fixtureData = authServiceFixtureCreate();
    const operationDefinitionsData = layerAuthOperationDefinitionsCreate({
        service: fixtureData.service
    });
    const registryData = layerOperationRegistryCreate();

    assert.deepEqual(
        operationDefinitionsData.map(function operationNameRead( operationData ){
            return operationData.name;

        }),
        [
            'auth.state.get',
            'auth.registration.create',
            'auth.email.verification.request',
            'auth.email.verification.confirm',
            'auth.password.recovery.request',
            'auth.password.recovery.complete',
            'auth.signin.password',
            'auth.signout',
            'auth.sessions.list',
            'auth.sessions.revoke'
        ]
    );

    const inspectionData = registryData.define( operationDefinitionsData[0] );

    assert.equal( 'system' in inspectionData, false );
    assert.equal( 'handler' in inspectionData, false );
    assert.equal( registryData.get( 'auth.state.get' )?.system, true );

});

test( 'Auth operation definitions add strict Passkey contracts only when enabled', function(){
    const fixtureData = authServiceFixtureCreate();
    fixtureData.service.passkey = {
        registration: {
            async begin(){
                return {options: {challenge: 'registration-challenge'}};

            },

            async complete(){
                return {
                    registered: true,
                    passkey: {
                        credentialId: 'credential-public-identifier',
                        displayName: 'Development laptop'
                    }
                };

            }
        },
        signIn: {
            async begin(){
                return {options: {challenge: 'authentication-challenge'}};

            },

            async complete(){
                return {
                    userId: 'user-auth-1',
                    session: {
                        sessionId: 'session-passkey-identifier',
                        sessionToken: sessionTokenData,
                        csrfToken: csrfTokenData,
                        idleExpiresAt: operationClockData + 1800000,
                        absoluteExpiresAt: operationClockData + 43200000
                    }
                };

            }
        },
        async list(){
            return [];

        },
        async remove(){
            return true;

        }
    };
    const operationDefinitionsData = layerAuthOperationDefinitionsCreate({
        service: fixtureData.service
    });
    const registryData = layerOperationRegistryCreate();

    for ( const operationData of operationDefinitionsData ){
        registryData.define( operationData );

    }

    assert.deepEqual(
        operationDefinitionsData.slice( -6 ).map(function operationNameRead( operationData ){
            return operationData.name;

        }),
        [
            'auth.passkey.registration.begin',
            'auth.passkey.registration.complete',
            'auth.passkey.signin.begin',
            'auth.passkey.signin.complete',
            'auth.passkey.list',
            'auth.passkey.remove'
        ]
    );
    assert.equal( registryData.list().length, 16 );

});

test( 'Auth operation definitions add strict TOTP and staged MFA contracts only when enabled', function(){
    const fixtureData = authServiceFixtureCreate();
    fixtureData.service.totp = {
        async isEnabled(){
            return true;

        },
        enrollment: {
            async begin(){
                return {secret: 'ABCDEFGHIJKLMNOP', uri: 'otpauth://totp/Layer:test'};

            },
            async confirm(){
                return {
                    enabled: true,
                    recoveryCodes: [
                        'ABCD-EFGH-JKLM',
                        'NPQR-STUV-WXYZ',
                        '2345-6789-ABCD',
                        'EFGH-JKLM-NPQR',
                        'STUV-WXYZ-2345'
                    ]
                };

            }
        },
        async verify(){
            return {
                userId: 'user-auth-1',
                session: {
                    sessionId: 'session-totp-identifier',
                    sessionToken: sessionTokenData,
                    csrfToken: csrfTokenData,
                    idleExpiresAt: operationClockData + 1800000,
                    absoluteExpiresAt: operationClockData + 43200000
                }
            };

        },
        async recoveryCodesRotate(){
            return {recoveryCodes: [
                'ABCD-EFGH-JKLM',
                'NPQR-STUV-WXYZ',
                '2345-6789-ABCD',
                'EFGH-JKLM-NPQR',
                'STUV-WXYZ-2345'
            ]};

        },
        async disable(){
            return {disabled: true};

        }
    };
    const operationDefinitionsData = layerAuthOperationDefinitionsCreate({
        service: fixtureData.service
    });
    const registryData = layerOperationRegistryCreate();

    for ( const operationData of operationDefinitionsData ){
        registryData.define( operationData );

    }

    assert.deepEqual(
        operationDefinitionsData.slice( -6 ).map(function operationNameRead( operationData ){
            return operationData.name;

        }),
        [
            'auth.totp.state',
            'auth.totp.enrollment.begin',
            'auth.totp.enrollment.confirm',
            'auth.mfa.verify',
            'auth.totp.recovery.rotate',
            'auth.totp.disable'
        ]
    );
    assert.equal( registryData.list().length, 16 );

});

test( 'Auth operation definitions add external OIDC contracts only when configured', function(){
    const fixtureData = authServiceFixtureCreate();
    fixtureData.service.oidc = {
        providers(){
            return ['company-identity'];

        },
        async begin(){
            return {
                providerId: 'company-identity',
                authorizationUrl: 'https://identity.example.test/authorize',
                expiresAt: operationClockData + Number( 600000 )
            };

        },
        async complete(){
            return {
                userId: 'user-auth-oidc',
                returnTo: '/workspace',
                session: {
                    sessionId: 'session-oidc-identifier',
                    sessionToken: sessionTokenData,
                    csrfToken: csrfTokenData,
                    idleExpiresAt: operationClockData + Number( 1800000 ),
                    absoluteExpiresAt: operationClockData + Number( 43200000 )
                }
            };

        }
    };
    const operationDefinitionsData = layerAuthOperationDefinitionsCreate({
        service: fixtureData.service,
        clock(){
            return operationClockData;

        }
    });
    const oidcDefinitionsData = operationDefinitionsData.filter(function oidcDefinitionFind( operationData ){
        return operationData.name.startsWith( 'auth.oidc.' );

    });
    const registryData = layerOperationRegistryCreate();

    assert.deepEqual(oidcDefinitionsData.map(function operationNameRead( operationData ){
        return operationData.name;

    }), [
        'auth.oidc.providers.list',
        'auth.oidc.begin',
        'auth.oidc.complete'
    ]);

    for ( const operationData of oidcDefinitionsData ){
        registryData.define( operationData );

    }

    assert.equal( registryData.get( 'auth.oidc.complete' )?.auth, 'none' );
    assert.equal( registryData.get( 'auth.oidc.complete' )?.offlineReplay, false );

});

test( 'Auth server runtime binds secure cookie resolution and registry setup', async function(){
    const fixtureData = authServiceFixtureCreate();
    const resolvedTokensData = /** @type {string[]} */ ([]);
    const touchedTokensData = /** @type {unknown[][]} */ ([]);
    const runtimeData = layerAuthServerRuntimeCreate({
        configuration: {
            enabled: true,
            registration: {mode: 'open'},
            identifiers: {email: true, username: false},
            emailVerification: {required: false, lifetimeMs: 86400000},
            password: {
                minimumLength: 12,
                maximumLength: 128,
                commonPasswordBlocklist: true
            },
            passwordRecovery: {enabled: false, lifetimeMs: 1800000},
            session: {
                idleLifetimeMs: 1800000,
                absoluteLifetimeMs: 43200000,
                rememberIdleLifetimeMs: 604800000,
                rememberAbsoluteLifetimeMs: 2592000000,
                touchIntervalMs: 300000,
                maximumPerUser: 20
            },
            authorizationResolve: null
        },
        users: {
            ...fixtureData.service,
            async create(){
                return {userId: 'unused'};

            },
            async findByIdentifier(){
                return null;

            },
            async findById(){
                return {userId: 'user-auth-1', status: 'active'};

            },
            async statusSet(){
                return true;

            },
            async anonymize(){
                return true;

            },
            async permissionsResolve(){
                return [];

            }
        },
        sessions: {
            ...fixtureData.service.sessions,
            async touch( /** @type {string} */ tokenData, /** @type {number} */ intervalData ){
                //Recording the runtime activity delegation after successful authentication.
                touchedTokensData.push([tokenData, intervalData]);
                return true;

            },
            async issue(){
                throw new Error( 'Session issue is not used by this runtime setup test.' );

            },
            async resolve( /** @type {string} */ providedSessionTokenData ){
                resolvedTokensData.push( providedSessionTokenData );

                return {
                    id: 'session-current-identifier',
                    userId: 'user-auth-1',
                    tenantId: null,
                    permissions: [],
                    csrfTokenHash: createHash( 'sha256' ).update( csrfTokenData, 'utf8' ).digest( 'hex' ),
                    expiresAt: operationClockData + 1800000,
                    status: 'active'
                };

            },
            async revokeById(){
                return true;

            },
            async dataGetById(){
                return {value: {}, revision: 0};

            },
            async dataReplaceById(){
                return 1;

            },
            async revokeAllByUser(){
                return 1;

            }
        },
        allowedOrigins: ['https://app.example.test'],
        secureCookies: true,
        clock(){
            return operationClockData;

        },
        dummyPasswordHash: '$argon2id$v=19$m=19456,t=2,p=1$MDEyMzQ1Njc4OWFiY2RlZg$LHM3R1vq14QeB/9+3A4PODzqIlVJ3c0z4pJ1V1Mx0Vo'
    });
    const registryData = layerOperationRegistryCreate();
    const registrationData = runtimeData.register( registryData );
    const securityContextData = await runtimeData.security.contextResolve({
        auth: 'session',
        permissions: [],
        headers: {
            cookie: `__Host-layer_session=${String( sessionTokenData )}`,
            origin: 'https://app.example.test',
            'sec-fetch-site': 'same-origin',
            'x-layer-csrf': csrfTokenData
        },
        remoteAddress: '127.0.0.1'
    });

    assert.equal( runtimeData.enabled, true );
    assert.equal( registrationData.length, 10 );
    assert.equal( registryData.has( 'auth.signin.password' ), true );
    assert.deepEqual( resolvedTokensData, [sessionTokenData] );
    assert.deepEqual( touchedTokensData, [[sessionTokenData, 300000]] );
    assert.equal( securityContextData.userId, 'user-auth-1' );
    assert.equal( securityContextData.sessionId, 'session-current-identifier' );

});

test( 'password sign-in writes cookies and never serializes opaque credentials', async function(){
    const fixtureData = authServiceFixtureCreate();
    const runtimeFixtureData = authRuntimeFixtureCreate( fixtureData );

    await runtimeFixtureData.runtime.start({port: 0});

    try {
        const responseData = await fetch(`${String( authRuntimeUrlGet( runtimeFixtureData.runtime ) )}/api`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                protocol: 1,
                requestId: '7ec2df78-6db4-4b35-8eb0-b2476bb10201',
                type: 'command',
                operation: 'auth.signin.password',
                payload: {
                    identifier: 'developer@example.test',
                    password: 'correct-password-value',
                    remember: false
                }
            })
        });
        const responseTextData = await responseData.text();
        const responseObjectData = JSON.parse( responseTextData );
        const setCookieHeadersData = responseData.headers.getSetCookie();

        assert.equal( responseData.status, 200 );
        assert.equal( responseObjectData.ok, true );
        assert.equal( responseObjectData.data.user.id, 'user-auth-1' );
        assert.equal( responseTextData.includes( sessionTokenData ), false );
        assert.equal( responseTextData.includes( csrfTokenData ), false );
        assert.equal( setCookieHeadersData.length, 2 );
        assert.match( String( setCookieHeadersData[0] ), /^layer_session=.*HttpOnly; SameSite=Lax$/u );
        assert.match( String( setCookieHeadersData[1] ), /^layer_csrf=.*SameSite=Lax$/u );

    } finally {
        await runtimeFixtureData.runtime.stop();

    }

});

test( 'password sign-in exposes one stable invalid-credential error', async function(){
    const fixtureData = authServiceFixtureCreate();
    const runtimeFixtureData = authRuntimeFixtureCreate( fixtureData );

    await runtimeFixtureData.runtime.start({port: 0});

    try {
        const responseData = await fetch(`${String( authRuntimeUrlGet( runtimeFixtureData.runtime ) )}/api`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                protocol: 1,
                requestId: '7ec2df78-6db4-4b35-8eb0-b2476bb10202',
                type: 'command',
                operation: 'auth.signin.password',
                payload: {
                    identifier: 'unknown@example.test',
                    password: 'incorrect-password-value'
                }
            })
        });
        const responseObjectData = await responseData.json();

        assert.equal( responseData.status, 401 );
        assert.equal( responseObjectData.ok, false );
        assert.equal( responseObjectData.error.code, 'AUTH_CREDENTIALS_INVALID' );
        assert.equal( JSON.stringify( responseObjectData ).includes( 'unknown@example.test' ), false );

    } finally {
        await runtimeFixtureData.runtime.stop();

    }

});

test( 'session operations use server identity and clear current cookies on revoke', async function(){
    const fixtureData = authServiceFixtureCreate();
    const runtimeFixtureData = authRuntimeFixtureCreate( fixtureData );

    await runtimeFixtureData.runtime.start({port: 0});

    try {
        const runtimeUrlData = authRuntimeUrlGet( runtimeFixtureData.runtime );
        const secureHeadersData = {
            'content-type': 'application/json',
            'cookie': `layer_session=${String( sessionTokenData )}`,
            'origin': 'http://127.0.0.1',
            'sec-fetch-site': 'same-origin',
            'x-layer-csrf': csrfTokenData
        };
        const sessionsResponseData = await fetch(`${String( runtimeUrlData )}/api`, {
            method: 'POST',
            headers: secureHeadersData,
            body: JSON.stringify({
                protocol: 1,
                requestId: '7ec2df78-6db4-4b35-8eb0-b2476bb10203',
                type: 'query',
                operation: 'auth.sessions.list',
                payload: {}
            })
        });
        const sessionsResponseObjectData = await sessionsResponseData.json();

        assert.equal( sessionsResponseData.status, 200 );
        assert.equal( sessionsResponseObjectData.data.sessions.length, 2 );
        assert.equal( sessionsResponseObjectData.data.sessions[0].current, true );
        assert.equal( sessionsResponseObjectData.data.sessions[1].current, false );

        const revokeResponseData = await fetch(`${String( runtimeUrlData )}/api`, {
            method: 'POST',
            headers: secureHeadersData,
            body: JSON.stringify({
                protocol: 1,
                requestId: '7ec2df78-6db4-4b35-8eb0-b2476bb10204',
                type: 'command',
                operation: 'auth.sessions.revoke',
                payload: {sessionId: 'session-current-identifier'}
            })
        });
        const revokeResponseObjectData = await revokeResponseData.json();
        const clearedCookieHeadersData = revokeResponseData.headers.getSetCookie();

        assert.equal( revokeResponseData.status, 200 );
        assert.equal( revokeResponseObjectData.data.revoked, true );
        assert.deepEqual( fixtureData.revokedSessionsData, ['session-current-identifier'] );
        assert.equal( clearedCookieHeadersData.length, 2 );
        assert.match( String( clearedCookieHeadersData[0] ), /Max-Age=0/u );
        assert.match( String( clearedCookieHeadersData[1] ), /Max-Age=0/u );

    } finally {
        await runtimeFixtureData.runtime.stop();

    }

});

/**
 * @param {readonly any[]} operationDefinitionsData
 * @param {string} operationNameData
 */
//Function for selecting a trusted operation handler in direct integration tests
const operationHandlerGet = function( operationDefinitionsData, operationNameData ){
    const operationData = operationDefinitionsData.find(function operationFind( definitionData ){
        return definitionData.name === operationNameData;

    });

    assert.equal( typeof operationData?.handler, 'function' );

    //CallBack THE FUNCTION
    return /** @type {(payloadData: any, contextData?: any) => Promise<any>} */ (operationData.handler);

};

//Function for creating a complete minimal server runtime contract
const authServerRuntimeOptionsCreate = function(){
    return {
        configuration: {
            enabled: true,
            registration: {mode: 'disabled'},
            identifiers: {email: true, username: false},
            emailVerification: {required: false, lifetimeMs: 86400000},
            password: {
                minimumLength: 12,
                maximumLength: 128,
                commonPasswordBlocklist: true
            },
            passwordRecovery: {enabled: false, lifetimeMs: 1800000},
            session: {
                idleLifetimeMs: 1800000,
                absoluteLifetimeMs: 43200000,
                rememberIdleLifetimeMs: 604800000,
                rememberAbsoluteLifetimeMs: 2592000000,
                touchIntervalMs: 300000,
                maximumPerUser: 20,
                dataMaximumBytes: 16384
            },
            smtp: null,
            passkey: null,
            totp: null,
            oauth: null,
            oidc: [],
            authorizationResolve: null,
            anonymization: null
        },
        users: {
            async create(){
                return {userId: 'user-auth-1'};

            },
            async findByIdentifier(){
                return null;

            },
            async findById(){
                return {userId: 'user-auth-1', status: 'active'};

            },
            async permissionsResolve(){
                return [];

            },
            async statusSet(){
                return true;

            },
            async anonymize(){
                return true;

            }
        },
        sessions: {
            async touch(){
                //Providing the durable activity capability required by managed Auth.
                return true;

            },
            async issue(){
                return {
                    sessionId: 'session-current-identifier',
                    sessionToken: sessionTokenData,
                    csrfToken: csrfTokenData,
                    idleExpiresAt: operationClockData + Number( 1800000 ),
                    absoluteExpiresAt: operationClockData + Number( 43200000 )
                };

            },
            async list(){
                return [];

            },
            async revokeById(){
                return true;

            },
            async revokeAllByUser(){
                return 0;

            },
            async resolve(){
                return null;

            },
            async dataGetById(){
                return {value: {}, revision: 0};

            },
            async dataReplaceById(){
                return 1;

            }
        },
        allowedOrigins: ['https://app.example.test'],
        dummyPasswordHash: '$argon2id$v=19$m=19456,t=2,p=1$MDEyMzQ1Njc4OWFiY2RlZg$LHM3R1vq14QeB/9+3A4PODzqIlVJ3c0z4pJ1V1Mx0Vo'
    };

};

test( 'Auth server runtime validates options and owns an idempotent mail lifecycle', async function(){
    //Rejecting custom session repositories that cannot record verified activity durably.
    const missingActivityOptionsData = /** @type {any} */ (authServerRuntimeOptionsCreate());
    delete missingActivityOptionsData.sessions.touch;
    assert.throws( function missingActivityRuntimeCreate(){
        //Checking failure happens at startup instead of silently retaining fixed expiry.
        layerAuthServerRuntimeCreate( missingActivityOptionsData );

    }, /requires touch/u );

    assert.throws(
        function nullRuntimeCreate(){
            layerAuthServerRuntimeCreate( /** @type {any} */ (null) );

        },
        /requires enabled configuration and allowed origins/u
    );
    assert.throws(
        function emptyOriginsRuntimeCreate(){
            layerAuthServerRuntimeCreate({
                ...authServerRuntimeOptionsCreate(),
                allowedOrigins: []
            });

        },
        /requires enabled configuration and allowed origins/u
    );
    assert.throws(
        function invalidCookiePolicyRuntimeCreate(){
            layerAuthServerRuntimeCreate({
                ...authServerRuntimeOptionsCreate(),
                secureCookies: /** @type {any} */ ('yes')
            });

        },
        /secureCookies must be a boolean/u
    );

    const oauthConfigurationData = {
        issuer: 'https://auth.example.test',
        interactionUrl: '/auth/oauth',
        scopes: ['openid'],
        clients: []
    };
    const oauthRuntimeOptionsData = /** @type {any} */ (authServerRuntimeOptionsCreate());
    oauthRuntimeOptionsData.configuration.oauth = oauthConfigurationData;

    assert.throws(
        function oauthAdapterMissingRuntimeCreate(){
            layerAuthServerRuntimeCreate( oauthRuntimeOptionsData );

        },
        /requires a durable adapter and server secret/u
    );
    assert.throws(
        function oauthSecretMissingRuntimeCreate(){
            layerAuthServerRuntimeCreate({
                ...oauthRuntimeOptionsData,
                oauthAdapter(){
                    return class OAuthAdapter {};

                }
            });

        },
        /requires a durable adapter and server secret/u
    );
    assert.throws(
        function oauthJwksMissingRuntimeCreate(){
            layerAuthServerRuntimeCreate({
                ...oauthRuntimeOptionsData,
                oauthAdapter(){
                    return class OAuthAdapter {};

                },
                oauthSecret: 'oauth-secret-with-more-than-thirty-two-characters'
            });

        },
        /requires a durable adapter and server secret/u
    );

    const smtpRuntimeOptionsData = /** @type {any} */ (authServerRuntimeOptionsCreate());
    smtpRuntimeOptionsData.configuration.smtp = {
        host: '127.0.0.1',
        port: 2525,
        secure: false,
        username: null,
        password: null,
        from: 'Layer <layer@example.test>'
    };

    assert.throws(
        function smtpLifecycleMissingRuntimeCreate(){
            layerAuthServerRuntimeCreate( smtpRuntimeOptionsData );

        },
        /requires a mail delivery lifecycle/u
    );
    assert.throws(
        function smtpStopMissingRuntimeCreate(){
            layerAuthServerRuntimeCreate({
                ...smtpRuntimeOptionsData,
                mailDelivery: {async start(){}}
            });

        },
        /requires a mail delivery lifecycle/u
    );

    let startCountData = Number( 0 );
    let stopCountData = Number( 0 );
    const runtimeData = layerAuthServerRuntimeCreate({
        ...smtpRuntimeOptionsData,
        secureCookies: false,
        bearerResolve: async function bearerResolve(){
            return null;

        },
        mailDelivery: {
            async start(){
                startCountData += Number( 1 );

            },
            async stop(){
                stopCountData += Number( 1 );

            }
        }
    });

    await runtimeData.start();
    await runtimeData.start();
    await runtimeData.stop();
    await runtimeData.stop();

    assert.equal( startCountData, 1 );
    assert.equal( stopCountData, 1 );
    assert.throws(
        function invalidRegistryRegister(){
            runtimeData.register( /** @type {any} */ ({}) );

        },
        /requires an operation registry/u
    );

});

test( 'core Auth operation handlers expose bounded results and trusted response effects', async function(){
    const fixtureData = authServiceFixtureCreate();
    const operationDefinitionsData = layerAuthOperationDefinitionsCreate({
        service: fixtureData.service,
        clock(){
            return operationClockData;

        }
    });
    const responseEffectsData = {
        cleared: false,

        authSessionClear(){
            this.cleared = true;

        }
    };
    const contextData = {
        security: {
            userId: 'user-auth-1',
            sessionId: 'session-current-identifier',
            permissions: ['chat.room.read'],
            assurance: ['password']
        },
        response: responseEffectsData
    };

    const stateData = await operationHandlerGet( operationDefinitionsData, 'auth.state.get' )({}, contextData);
    const registrationData = await operationHandlerGet( operationDefinitionsData, 'auth.registration.create' )({
        identifier: 'developer@example.test',
        password: 'correct-password-value'
    });
    const verificationRequestData = await operationHandlerGet( operationDefinitionsData, 'auth.email.verification.request' )({
        identifier: 'developer@example.test'
    });
    const verificationConfirmData = await operationHandlerGet( operationDefinitionsData, 'auth.email.verification.confirm' )({
        token: 'verification-token-with-sufficient-entropy'
    });
    const recoveryRequestData = await operationHandlerGet( operationDefinitionsData, 'auth.password.recovery.request' )({
        identifier: 'developer@example.test'
    });
    const recoveryCompleteData = await operationHandlerGet( operationDefinitionsData, 'auth.password.recovery.complete' )({
        token: 'recovery-token-with-sufficient-entropy',
        password: 'replacement-password-value'
    });
    const signOutData = await operationHandlerGet( operationDefinitionsData, 'auth.signout' )({}, contextData);

    assert.deepEqual( stateData, {
        authenticated: true,
        user: {id: 'user-auth-1'},
        session: {id: 'session-current-identifier'},
        permissions: ['chat.room.read'],
        assurance: ['password']
    } );
    assert.deepEqual( registrationData, {accepted: true, verificationRequired: false} );
    assert.deepEqual( verificationRequestData, {accepted: true} );
    assert.deepEqual( verificationConfirmData, {verified: true} );
    assert.deepEqual( recoveryRequestData, {accepted: true} );
    assert.deepEqual( recoveryCompleteData, {completed: true} );
    assert.deepEqual( signOutData, {signedOut: true} );
    assert.equal( responseEffectsData.cleared, true );

});

test( 'optional Auth operation handlers execute Passkey TOTP and OIDC ceremonies', async function(){
    const fixtureData = authServiceFixtureCreate();
    const recoveryCodesData = [
        'ABCD-EFGH-JKLM',
        'NPQR-STUV-WXYZ',
        '2345-6789-ABCD',
        'EFGH-JKLM-NPQR',
        'STUV-WXYZ-2345'
    ];
    fixtureData.service.passkey = {
        registration: {
            async begin( /** @type {unknown} */ userIdentifierData ){
                return {options: {challenge: `register-${String( userIdentifierData )}`}};

            },

            async complete( /** @type {unknown} */ userIdentifierData ){
                return {
                    registered: true,
                    passkey: {
                        credentialId: `credential-${String( userIdentifierData )}`,
                        displayName: 'Development laptop'
                    }
                };

            }
        },
        signIn: {
            async begin(){
                return {options: {challenge: 'authentication-challenge'}};

            },

            async complete(){
                return {
                    userId: 'user-auth-1',
                    session: {
                        sessionId: 'session-passkey-identifier',
                        sessionToken: sessionTokenData,
                        csrfToken: csrfTokenData,
                        idleExpiresAt: operationClockData + Number( 1800000 ),
                        absoluteExpiresAt: operationClockData + Number( 43200000 )
                    }
                };

            }
        },
        async list(){
            return [{credentialId: 'credential-user-auth-1'}];

        },
        async remove(){
            return true;

        }
    };
    fixtureData.service.totp = {
        async isEnabled(){
            return true;

        },
        enrollment: {
            async begin(){
                return {secret: 'ABCDEFGHIJKLMNOP', uri: 'otpauth://totp/Layer:test'};

            },
            async confirm(){
                return {enabled: true, recoveryCodes: recoveryCodesData};

            }
        },
        async verify(){
            return {
                userId: 'user-auth-1',
                session: {
                    sessionId: 'session-totp-identifier',
                    sessionToken: sessionTokenData,
                    csrfToken: csrfTokenData,
                    idleExpiresAt: operationClockData + Number( 1800000 ),
                    absoluteExpiresAt: operationClockData + Number( 43200000 )
                }
            };

        },
        async recoveryCodesRotate(){
            return {recoveryCodes: recoveryCodesData};

        },
        async disable(){
            return {disabled: true};

        }
    };
    fixtureData.service.oidc = {
        providers(){
            return ['company-identity'];

        },
        async begin(){
            return {
                providerId: 'company-identity',
                authorizationUrl: 'https://identity.example.test/authorize',
                expiresAt: operationClockData + Number( 600000 )
            };

        },
        async complete(){
            return {
                userId: 'user-auth-oidc',
                returnTo: '/workspace',
                session: {
                    sessionId: 'session-oidc-identifier',
                    sessionToken: sessionTokenData,
                    csrfToken: csrfTokenData,
                    idleExpiresAt: operationClockData + Number( 1800000 ),
                    absoluteExpiresAt: operationClockData + Number( 43200000 )
                }
            };

        }
    };
    const operationDefinitionsData = layerAuthOperationDefinitionsCreate({
        service: fixtureData.service,
        clock(){
            return operationClockData;

        }
    });
    const sessionEffectsData = /** @type {any[]} */ ([]);
    const authenticatedContextData = {
        security: {
            userId: 'user-auth-1',
            sessionId: 'session-current-identifier'
        },
        response: {
            authSessionSet( /** @type {unknown} */ sessionEffectData ){
                sessionEffectsData.push( sessionEffectData );

            }
        }
    };

    assert.deepEqual(
        await operationHandlerGet( operationDefinitionsData, 'auth.passkey.registration.begin' )({}, authenticatedContextData),
        {options: {challenge: 'register-user-auth-1'}}
    );
    assert.equal(
        (await operationHandlerGet( operationDefinitionsData, 'auth.passkey.registration.complete' )({
            challenge: 'registration-challenge-value',
            response: {}
        }, authenticatedContextData)).registered,
        true
    );
    assert.equal(
        (await operationHandlerGet( operationDefinitionsData, 'auth.passkey.signin.begin' )({})).options.challenge,
        'authentication-challenge'
    );
    assert.equal(
        (await operationHandlerGet( operationDefinitionsData, 'auth.passkey.signin.complete' )({
            challenge: 'authentication-challenge-value',
            response: {}
        }, authenticatedContextData)).session.id,
        'session-passkey-identifier'
    );
    assert.equal(
        (await operationHandlerGet( operationDefinitionsData, 'auth.passkey.list' )({}, authenticatedContextData)).passkeys.length,
        1
    );
    assert.deepEqual(
        await operationHandlerGet( operationDefinitionsData, 'auth.passkey.remove' )({credentialId: 'credential-user-auth-1'}, authenticatedContextData),
        {removed: true}
    );

    assert.deepEqual(
        await operationHandlerGet( operationDefinitionsData, 'auth.totp.state' )({}, authenticatedContextData),
        {enabled: true}
    );
    assert.equal(
        (await operationHandlerGet( operationDefinitionsData, 'auth.totp.enrollment.begin' )({}, authenticatedContextData)).secret,
        'ABCDEFGHIJKLMNOP'
    );
    assert.equal(
        (await operationHandlerGet( operationDefinitionsData, 'auth.totp.enrollment.confirm' )({code: '123456'}, authenticatedContextData)).enabled,
        true
    );
    assert.equal(
        (await operationHandlerGet( operationDefinitionsData, 'auth.mfa.verify' )({
            challenge: 'totp-challenge-with-sufficient-entropy',
            code: '123456'
        }, authenticatedContextData)).session.id,
        'session-totp-identifier'
    );
    assert.equal(
        (await operationHandlerGet( operationDefinitionsData, 'auth.totp.recovery.rotate' )({code: '123456'}, authenticatedContextData)).recoveryCodes.length,
        5
    );
    assert.deepEqual(
        await operationHandlerGet( operationDefinitionsData, 'auth.totp.disable' )({code: '123456'}, authenticatedContextData),
        {disabled: true}
    );

    assert.deepEqual(
        await operationHandlerGet( operationDefinitionsData, 'auth.oidc.providers.list' )({}),
        {providers: ['company-identity']}
    );
    assert.equal(
        (await operationHandlerGet( operationDefinitionsData, 'auth.oidc.begin' )({providerId: 'company-identity'})).providerId,
        'company-identity'
    );
    assert.equal(
        (await operationHandlerGet( operationDefinitionsData, 'auth.oidc.complete' )({
            callbackUrl: 'https://app.example.test/auth/callback'
        }, authenticatedContextData)).returnTo,
        '/workspace'
    );
    assert.equal( sessionEffectsData.length, 3 );
    assert.equal( sessionEffectsData.every(function sessionEffectCheck( sessionEffectData ){
        return sessionEffectData.maximumAgeSeconds === Number( 43200 );

    }), true );

});

test( 'Auth operation boundaries map only documented failures and reject untrusted contexts', async function(){
    const coreErrorCasesData = [{
        code: LAYER_ERROR_CODES.AUTH_CREDENTIALS_INVALID,
        status: 401
    }, {
        code: LAYER_ERROR_CODES.AUTH_EMAIL_VERIFICATION_REQUIRED,
        status: 403
    }, {
        code: LAYER_ERROR_CODES.AUTH_REGISTRATION_UNAVAILABLE,
        status: 409
    }, {
        code: LAYER_ERROR_CODES.AUTH_IDENTIFIER_INVALID,
        status: 400
    }, {
        code: 'AUTH_PRIVATE_FAILURE',
        publicCode: LAYER_ERROR_CODES.INTERNAL_ERROR,
        status: 500
    }];

    for ( const errorCaseData of coreErrorCasesData ){
        const fixtureData = authServiceFixtureCreate();
        fixtureData.service.registration.create = async function registrationFailureCreate(){
            throw new LayerAuthError( errorCaseData.code, 'Bounded Auth failure.' );

        };
        const operationDefinitionsData = layerAuthOperationDefinitionsCreate({service: fixtureData.service});

        await assert.rejects(
            operationHandlerGet( operationDefinitionsData, 'auth.registration.create' )({
                identifier: 'developer@example.test',
                password: 'correct-password-value'
            }),
            function operationErrorCheck( errorData ){
                assert.ok( errorData instanceof LayerError );
                assert.equal( errorData.code, errorCaseData.publicCode ?? errorCaseData.code );
                assert.equal( errorData.status, errorCaseData.status );
                return true;

            }
        );

    }

    const passkeyCasesData = [{
        code: LAYER_ERROR_CODES.AUTH_PASSKEY_INVALID,
        status: 400
    }, {
        code: LAYER_ERROR_CODES.AUTH_PASSKEY_REPLAY,
        status: 409
    }, {
        code: LAYER_ERROR_CODES.AUTH_PASSKEY_UNAVAILABLE,
        status: 403
    }];

    for ( const errorCaseData of passkeyCasesData ){
        const serviceData = {
            registration: {
                async begin(){
                    return {options: {}};

                },
                async complete(){
                    return {registered: true, passkey: {}};

                }
            },
            signIn: {
                async begin(){
                    throw new LayerAuthError( errorCaseData.code, 'Passkey failure.' );

                },
                async complete(){
                    return {};

                }
            },
            async list(){
                return [];

            },
            async remove(){
                return false;

            }
        };
        const fixtureData = authServiceFixtureCreate();
        fixtureData.service.passkey = serviceData;
        const operationDefinitionsData = layerAuthOperationDefinitionsCreate({service: fixtureData.service});

        await assert.rejects(
            operationHandlerGet( operationDefinitionsData, 'auth.passkey.signin.begin' )({}),
            function passkeyErrorCheck( errorData ){
                assert.ok( errorData instanceof LayerError );
                assert.equal( errorData.code, errorCaseData.code );
                assert.equal( errorData.status, errorCaseData.status );
                return true;

            }
        );

    }

    const totpCasesData = [{
        code: LAYER_ERROR_CODES.AUTH_MFA_INVALID,
        status: 400
    }, {
        code: LAYER_ERROR_CODES.AUTH_TOTP_REPLAY,
        status: 409
    }, {
        code: LAYER_ERROR_CODES.AUTH_TOTP_UNAVAILABLE,
        status: 403
    }];

    for ( const errorCaseData of totpCasesData ){
        const fixtureData = authServiceFixtureCreate();
        fixtureData.service.totp = {
            async isEnabled(){
                throw new LayerAuthError( errorCaseData.code, 'TOTP failure.' );

            },
            enrollment: {
                async begin(){
                    return {};

                },
                async confirm(){
                    return {};

                }
            },
            async verify(){
                return {};

            },
            async recoveryCodesRotate(){
                return {};

            },
            async disable(){
                return {};

            }
        };
        const operationDefinitionsData = layerAuthOperationDefinitionsCreate({service: fixtureData.service});

        await assert.rejects(
            operationHandlerGet( operationDefinitionsData, 'auth.totp.state' )({}, {
                security: {userId: 'user-auth-1'}
            }),
            function totpErrorCheck( errorData ){
                assert.ok( errorData instanceof LayerError );
                assert.equal( errorData.code, errorCaseData.code );
                assert.equal( errorData.status, errorCaseData.status );
                return true;

            }
        );

    }

    const oidcCasesData = [{
        code: LAYER_ERROR_CODES.AUTH_CREDENTIALS_INVALID,
        status: 401
    }, {
        code: LAYER_ERROR_CODES.AUTH_OIDC_IDENTITY_UNAVAILABLE,
        status: 403
    }, {
        code: LAYER_ERROR_CODES.AUTH_OIDC_LINK_REQUIRED,
        status: 409
    }, {
        code: LAYER_ERROR_CODES.AUTH_OIDC_UPSTREAM_FAILED,
        status: 502
    }, {
        code: 'AUTH_PRIVATE_OIDC_FAILURE',
        publicCode: LAYER_ERROR_CODES.INTERNAL_ERROR,
        status: 500
    }];

    for ( const errorCaseData of oidcCasesData ){
        const fixtureData = authServiceFixtureCreate();
        fixtureData.service.oidc = {
            providers(){
                return ['company-identity'];

            },
            async begin(){
                throw new LayerAuthError( errorCaseData.code, 'OIDC failure.' );

            },
            async complete(){
                return {};

            }
        };
        const operationDefinitionsData = layerAuthOperationDefinitionsCreate({service: fixtureData.service});

        await assert.rejects(
            operationHandlerGet( operationDefinitionsData, 'auth.oidc.begin' )({providerId: 'company-identity'}),
            function oidcErrorCheck( errorData ){
                assert.ok( errorData instanceof LayerError );
                assert.equal( errorData.code, errorCaseData.publicCode ?? errorCaseData.code );
                assert.equal( errorData.status, errorCaseData.status );
                return true;

            }
        );

    }

    const fixtureData = authServiceFixtureCreate();
    fixtureData.service.passkey = {
        registration: {async begin(){}, async complete(){}},
        signIn: {async begin(){}, async complete(){}},
        async list(){},
        async remove(){}
    };
    fixtureData.service.totp = {
        async isEnabled(){},
        enrollment: {async begin(){}, async confirm(){}},
        async verify(){},
        async recoveryCodesRotate(){},
        async disable(){}
    };
    fixtureData.service.oidc = {
        providers(){
            return [];

        },
        async begin(){},
        async complete(){}
    };
    const operationDefinitionsData = layerAuthOperationDefinitionsCreate({service: fixtureData.service});

    await assert.rejects(
        operationHandlerGet( operationDefinitionsData, 'auth.state.get' )({}, null),
        /context is unavailable/u
    );
    await assert.rejects(
        operationHandlerGet( operationDefinitionsData, 'auth.state.get' )({}, {security: null}),
        /security context is unavailable/u
    );
    await assert.rejects(
        operationHandlerGet( operationDefinitionsData, 'auth.state.get' )({}, {security: {}}),
        function authenticationRequiredCheck( errorData ){
            return errorData instanceof LayerError && errorData.code === LAYER_ERROR_CODES.AUTH_REQUIRED;

        }
    );
    await assert.rejects(
        operationHandlerGet( operationDefinitionsData, 'auth.passkey.registration.begin' )({}, null),
        function passkeyAuthenticationRequiredCheck( errorData ){
            return errorData instanceof LayerError && errorData.code === LAYER_ERROR_CODES.AUTH_REQUIRED;

        }
    );
    await assert.rejects(
        operationHandlerGet( operationDefinitionsData, 'auth.totp.state' )({}, []),
        function totpAuthenticationRequiredCheck( errorData ){
            return errorData instanceof LayerError && errorData.code === LAYER_ERROR_CODES.AUTH_REQUIRED;

        }
    );
    await assert.rejects(
        operationHandlerGet( operationDefinitionsData, 'auth.oidc.complete' )({
            callbackUrl: 'https://app.example.test/auth/callback'
        }, null),
        /context is unavailable/u
    );

});
