import assert from 'node:assert/strict';
import {
    createHash,
    randomUUID
} from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import {
    exportJWK,
    generateKeyPair,
    SignJWT
} from 'jose';
import {
    LayerAuthError,
    layerAuthConfigurationCreate,
    layerAuthOAuthProviderCreate,
    layerAuthOAuthSigningJwksCreate,
    layerAuthOidcAdapterFactoryCreate,
    layerAuthOidcServiceCreate,
    layerAuthSecretEnvelopeCreate
} from '../src/index.js';


const authSecretData = String( 'layer-auth-test-secret-with-at-least-thirty-two-characters' );


//Class for exercising oidc-provider without replacing its adapter contract
class MemoryOidcAdapter {
    static records = new Map();

    constructor( /** @type {string} */ modelNameData ){
        this.modelName = modelNameData;

    }

    recordKey( /** @type {string} */ identifierData ){
        return `${String( this.modelName )}:${String( identifierData )}`;

    }

    async destroy( /** @type {string} */ identifierData ){
        MemoryOidcAdapter.records.delete( this.recordKey( identifierData ) );

    }

    async consume( /** @type {string} */ identifierData ){
        const recordData = MemoryOidcAdapter.records.get( this.recordKey( identifierData ) );

        if ( recordData !== undefined ){
            recordData.consumed = Math.floor( Date.now() / Number( 1000 ) );

        }

    }

    async find( /** @type {string} */ identifierData ){
        return MemoryOidcAdapter.records.get( this.recordKey( identifierData ) );

    }

    async findByUid( /** @type {string} */ uidData ){
        return Array.from( MemoryOidcAdapter.records.values() ).find(function uidFind( recordData ){
            return recordData.uid === uidData;

        });

    }

    async findByUserCode( /** @type {string} */ userCodeData ){
        return Array.from( MemoryOidcAdapter.records.values() ).find(function userCodeFind( recordData ){
            return recordData.userCode === userCodeData;

        });

    }

    async upsert( /** @type {string} */ identifierData, /** @type {any} */ payloadData ){
        MemoryOidcAdapter.records.set( this.recordKey( identifierData ), structuredClone( payloadData ) );

    }

    async claim( /** @type {string} */ identifierData, /** @type {any} */ payloadData ){
        const recordKeyData = this.recordKey( identifierData );

        if ( MemoryOidcAdapter.records.has( recordKeyData ) === true ){
            return false;

        }

        MemoryOidcAdapter.records.set( recordKeyData, structuredClone( payloadData ) );
        return true;

    }

    async revokeByGrantId( /** @type {string} */ grantIdentifierData ){
        for ( const [recordKeyData, recordData] of MemoryOidcAdapter.records.entries() ){
            if ( recordData.grantId === grantIdentifierData ){
                MemoryOidcAdapter.records.delete( recordKeyData );

            }

        }

    }
}


test( 'OAuth provider serves standards discovery from explicit HTTP extension routes', async function(){
    MemoryOidcAdapter.records.clear();
    let oauthRequestHandleData = /** @type {null | Function} */ (null);
    const serverData = http.createServer(async function requestHandle( requestData, responseData ){
        if ( oauthRequestHandleData === null ){
            responseData.writeHead( Number( 503 ) );
            responseData.end();
            return;

        }

        const handledStatusData = await oauthRequestHandleData( requestData, responseData );

        if ( handledStatusData === false ){
            responseData.writeHead( Number( 404 ) );
            responseData.end();

        }

    });
    await new Promise(function serverStart( resolveData, rejectData ){
        serverData.once( 'error', rejectData );
        serverData.listen( Number( 0 ), '127.0.0.1', function serverListening(){
            resolveData( undefined );

        });

    });

    try {
        const addressData = serverData.address();
        assert.ok( addressData !== null && typeof addressData === String( 'object' ) );
        const networkAddressData = /** @type {import('node:net').AddressInfo} */ (addressData);
        const issuerData = `http://127.0.0.1:${Number( networkAddressData.port )}`;
        const configurationData = layerAuthConfigurationCreate({
            enabled: true,
            registration: {mode: 'open'},
            oauth: {
                issuer: issuerData,
                interactionUrl: '/auth/oauth',
                scopes: ['openid', 'offline_access', 'chat.read'],
                clients: [{
                    id: 'browser-test',
                    type: 'public',
                    displayName: 'Browser test',
                    redirectUris: [`${String( issuerData )}/callback`],
                    grantTypes: ['authorization_code', 'refresh_token'],
                    scopes: ['openid', 'offline_access', 'chat.read'],
                    dpop: 'optional'
                }, {
                    id: 'service-test',
                    type: 'confidential',
                    displayName: 'Service test',
                    redirectUris: [`${String( issuerData )}/service-callback`],
                    grantTypes: ['client_credentials'],
                    scopes: ['chat.read'],
                    secret: {env: 'LAYER_TEST_SERVICE_SECRET'},
                    dpop: 'optional'
                }, {
                    id: 'service-dpop-test',
                    type: 'confidential',
                    displayName: 'DPoP service test',
                    redirectUris: [`${String( issuerData )}/service-dpop-callback`],
                    grantTypes: ['client_credentials'],
                    scopes: ['chat.read'],
                    secret: {env: 'LAYER_TEST_DPOP_SECRET'},
                    dpop: 'required'
                }]
            }
        });
        assert.ok( configurationData !== null );
        const oauthRateLimitCallsData = /** @type {any[]} */ ([]);
        const oauthAuditCallsData = /** @type {any[]} */ ([]);
        let oauthRateLimitDeniedStatusData = false;
        const providerData = layerAuthOAuthProviderCreate(/** @type {any} */ ({
            configuration: configurationData,
            adapter: MemoryOidcAdapter,
            users: {
                async findById(){
                    return {userId: 'user-oauth-test', status: 'active'};

                },
                async identifiersList(){
                    return [{type: 'email', display: 'verified@example.test', verified: true}];

                }
            },
            async authorizationResolve(){
                return {
                    tenantId: 'tenant-oauth-test',
                    permissions: ['chat.read']
                };

            },
            secret: authSecretData,
            jwks: await layerAuthOAuthSigningJwksCreate(),
            environment: {
                LAYER_TEST_SERVICE_SECRET: 'service-client-secret-with-at-least-thirty-two-characters',
                LAYER_TEST_DPOP_SECRET: 'dpop-client-secret-with-at-least-thirty-two-characters'
            },
            rateLimiter: {
                async consume( /** @type {any} */ rateLimitData ){
                    oauthRateLimitCallsData.push( rateLimitData );

                    return {
                        allowed: oauthRateLimitDeniedStatusData === false,
                        remaining: Number( 10 ),
                        retryAfterMs: Number( 2000 )
                    };

                }
            },
            auditTrail: {
                async record( /** @type {any} */ auditData ){
                    oauthAuditCallsData.push( auditData );
                    return 'audit-' + String( oauthAuditCallsData.length );

                }
            },
            async interactionHandler( /** @type {any} */ interactionData ){
                await interactionData.complete({accountId: 'user-oauth-test'});

            }
        }));
        oauthRequestHandleData = providerData.requestHandle;
        assert.equal(
            providerData.scopesValidate([{permissions: ['chat.read']}]),
            true
        );
        assert.throws(
            function oauthScopeValidationFail(){
                providerData.scopesValidate([{permissions: []}]);

            },
            function oauthScopeErrorCheck( errorData ){
                return /** @type {any} */ (errorData)?.code === String( 'AUTH_OAUTH_SCOPE_UNREGISTERED' );

            }
        );
        const discoveryResponseData = await fetch(`${String( issuerData )}/.well-known/openid-configuration`);
        const discoveryData = await discoveryResponseData.json();

        assert.equal( discoveryResponseData.status, 200 );
        assert.equal( discoveryData.issuer, issuerData );
        assert.equal( discoveryData.authorization_endpoint, `${String( issuerData )}/oauth/authorize` );
        assert.equal( discoveryData.token_endpoint, `${String( issuerData )}/oauth/token` );
        assert.equal( discoveryData.code_challenge_methods_supported.includes( 'S256' ), true );
        assert.equal( Array.isArray( discoveryData.dpop_signing_alg_values_supported ), true );

        const serviceCredentialData = Buffer.from(
            'service-test:service-client-secret-with-at-least-thirty-two-characters',
            'utf8'
        ).toString( 'base64' );
        const tokenResponseData = await fetch(`${String( issuerData )}/oauth/token`, {
            method: 'POST',
            headers: {
                authorization: `Basic ${String( serviceCredentialData )}`,
                'content-type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                scope: 'chat.read'
            })
        });
        const tokenData = await tokenResponseData.json();

        assert.equal( tokenResponseData.status, 200, JSON.stringify( tokenData ) );
        assert.equal( tokenData.token_type, 'Bearer' );
        assert.equal( typeof tokenData.access_token, 'string' );
        assert.equal( tokenData.access_token.includes( '.' ), false );
        assert.equal( tokenData.scope, 'chat.read' );
        const serviceIdentityData = await providerData.accessTokenResolve(
            tokenData.access_token,
            {scheme: 'bearer', headers: {}}
        );

        assert.equal( serviceIdentityData?.userId, 'oauth-client:service-test' );
        assert.deepEqual( serviceIdentityData.permissions, ['chat.read'] );

        const dpopServiceCredentialData = Buffer.from(
            'service-dpop-test:dpop-client-secret-with-at-least-thirty-two-characters',
            'utf8'
        ).toString( 'base64' );
        const missingDpopResponseData = await fetch(`${String( issuerData )}/oauth/token`, {
            method: 'POST',
            headers: {
                authorization: `Basic ${String( dpopServiceCredentialData )}`,
                'content-type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                scope: 'chat.read'
            })
        });
        const missingDpopData = await missingDpopResponseData.json();

        assert.equal( missingDpopResponseData.status, 400 );
        assert.equal( missingDpopData.error, 'invalid_grant' );

        //Creating a standards-compliant ES256 proof for the required DPoP client
        const dpopKeyPairData = await generateKeyPair( 'ES256' );
        const dpopPublicKeyData = await exportJWK( dpopKeyPairData.publicKey );
        const dpopProofData = await new SignJWT({
            htm: 'POST',
            htu: `${String( issuerData )}/oauth/token`
        })
            .setProtectedHeader({
                alg: 'ES256',
                typ: 'dpop+jwt',
                jwk: dpopPublicKeyData
            })
            .setIssuedAt()
            .setJti( randomUUID() )
            .sign( dpopKeyPairData.privateKey );
        const dpopTokenResponseData = await fetch(`${String( issuerData )}/oauth/token`, {
            method: 'POST',
            headers: {
                authorization: `Basic ${String( dpopServiceCredentialData )}`,
                'content-type': 'application/x-www-form-urlencoded',
                dpop: dpopProofData
            },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                scope: 'chat.read'
            })
        });
        const dpopTokenData = await dpopTokenResponseData.json();

        assert.equal( dpopTokenResponseData.status, 200, JSON.stringify( dpopTokenData ) );
        assert.equal( dpopTokenData.token_type, 'DPoP' );
        assert.equal( typeof dpopTokenData.access_token, 'string' );
        assert.equal(
            await providerData.accessTokenResolve(
                dpopTokenData.access_token,
                {scheme: 'bearer', headers: {}}
            ),
            null
        );
        const resourceDpopProofData = await new SignJWT({
            htm: 'POST',
            htu: `${String( issuerData )}/api`,
            ath: createHash( 'sha256' )
                .update( dpopTokenData.access_token, 'utf8' )
                .digest( 'base64url' )
        })
            .setProtectedHeader({
                alg: 'ES256',
                typ: 'dpop+jwt',
                jwk: dpopPublicKeyData
            })
            .setIssuedAt()
            .setJti( randomUUID() )
            .sign( dpopKeyPairData.privateKey );
        const dpopIdentityData = await providerData.accessTokenResolve(
            dpopTokenData.access_token,
            {
                scheme: 'dpop',
                headers: {dpop: resourceDpopProofData}
            }
        );

        assert.ok( dpopIdentityData );
        assert.equal( dpopIdentityData.userId, 'oauth-client:service-dpop-test' );
        assert.deepEqual( dpopIdentityData.assurance, ['oauth', 'dpop'] );
        assert.equal(
            await providerData.accessTokenResolve(
                dpopTokenData.access_token,
                {
                    scheme: 'dpop',
                    headers: {dpop: resourceDpopProofData}
                }
            ),
            null
        );

        const codeVerifierData = String( 'authorization-code-pkce-verifier-with-more-than-forty-three-characters' );
        const codeChallengeData = createHash( 'sha256' )
            .update( codeVerifierData, 'utf8' )
            .digest( 'base64url' );
        const authorizationUrlData = new URL( `${String( issuerData )}/oauth/authorize` );
        authorizationUrlData.search = new URLSearchParams({
            client_id: 'browser-test',
            redirect_uri: `${String( issuerData )}/callback`,
            response_type: 'code',
            scope: 'openid offline_access chat.read',
            code_challenge: codeChallengeData,
            code_challenge_method: 'S256',
            state: 'oauth-state-value',
            nonce: 'oauth-nonce-value',
            prompt: 'consent'
        }).toString();
        const cookieJarData = new Map();
        let redirectUrlData = String( authorizationUrlData );
        let callbackUrlData = /** @type {URL | null} */ (null);

        for ( let redirectIndexData = Number( 0 ); redirectIndexData < Number( 12 ); redirectIndexData += Number( 1 ) ){
            const cookieHeaderData = Array.from( cookieJarData.entries() ).map(function cookieMap( cookieData ){
                return `${String( cookieData[0] )}=${String( cookieData[1] )}`;

            }).join( '; ' );
            const redirectHeadersData = /** @type {Record<string, string>} */ ({});

            if ( cookieHeaderData !== String() ){
                redirectHeadersData.cookie = cookieHeaderData;

            }

            const redirectResponseData = await fetch( redirectUrlData, {
                redirect: 'manual',
                headers: redirectHeadersData
            });

            for ( const setCookieData of redirectResponseData.headers.getSetCookie() ){
                const cookiePairData = String( String( setCookieData ).split( ';', Number( 1 ) )[0] );
                const separatorIndexData = cookiePairData.indexOf( '=' );
                const cookieNameData = cookiePairData.slice( Number( 0 ), separatorIndexData );
                const cookieValueData = cookiePairData.slice( Number( separatorIndexData + 1 ) );

                if ( cookieValueData === String() ){
                    cookieJarData.delete( cookieNameData );

                } else {
                    cookieJarData.set( cookieNameData, cookieValueData );

                }

            }

            const locationData = redirectResponseData.headers.get( 'location' );
            let redirectFailureData = String();

            if ( locationData === null ){
                redirectFailureData = await redirectResponseData.text();

            }

            assert.notEqual(
                locationData,
                null,
                `${Number( redirectResponseData.status )}:${String( redirectFailureData )}`
            );
            redirectUrlData = new URL( String( locationData ), redirectUrlData ).href;

            if ( redirectUrlData.startsWith( `${String( issuerData )}/callback?` ) === true ){
                callbackUrlData = new URL( redirectUrlData );
                break;

            }

        }

        assert.ok( callbackUrlData !== null );
        assert.equal( callbackUrlData.searchParams.get( 'state' ), 'oauth-state-value' );
        const authorizationCodeData = callbackUrlData.searchParams.get( 'code' );
        assert.equal( typeof authorizationCodeData, 'string' );
        const authorizationTokenResponseData = await fetch(`${String( issuerData )}/oauth/token`, {
            method: 'POST',
            headers: {'content-type': 'application/x-www-form-urlencoded'},
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: 'browser-test',
                redirect_uri: `${String( issuerData )}/callback`,
                code: String( authorizationCodeData ),
                code_verifier: codeVerifierData
            })
        });
        const authorizationTokenData = await authorizationTokenResponseData.json();

        assert.equal( authorizationTokenResponseData.status, 200, JSON.stringify( authorizationTokenData ) );
        assert.equal( typeof authorizationTokenData.id_token, 'string' );
        assert.equal( typeof authorizationTokenData.refresh_token, 'string' );
        assert.equal( authorizationTokenData.access_token.includes( '.' ), false );
        const userIdentityData = await providerData.accessTokenResolve(
            authorizationTokenData.access_token,
            {scheme: 'bearer', headers: {}}
        );

        assert.ok( userIdentityData );
        assert.equal( userIdentityData.userId, 'user-oauth-test' );
        assert.equal( userIdentityData.tenantId, 'tenant-oauth-test' );
        assert.deepEqual( userIdentityData.permissions, ['chat.read'] );

        const refreshRequestData = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: 'browser-test',
            refresh_token: authorizationTokenData.refresh_token
        });
        const refreshResponseData = await fetch(`${String( issuerData )}/oauth/token`, {
            method: 'POST',
            headers: {'content-type': 'application/x-www-form-urlencoded'},
            body: refreshRequestData
        });
        const refreshedTokenData = await refreshResponseData.json();

        assert.equal( refreshResponseData.status, 200, JSON.stringify( refreshedTokenData ) );
        assert.equal( typeof refreshedTokenData.refresh_token, 'string' );
        assert.notEqual( refreshedTokenData.refresh_token, authorizationTokenData.refresh_token );

        const replayResponseData = await fetch(`${String( issuerData )}/oauth/token`, {
            method: 'POST',
            headers: {'content-type': 'application/x-www-form-urlencoded'},
            body: refreshRequestData
        });
        const replayData = await replayResponseData.json();

        assert.equal( replayResponseData.status, 400 );
        assert.equal( replayData.error, 'invalid_grant' );

        //Denying one request before the provider to verify the shared OAuth bucket
        oauthRateLimitDeniedStatusData = true;
        const rateLimitedResponseData = await fetch(`${String( issuerData )}/oauth/token`, {
            method: 'POST',
            headers: {
                authorization: `Basic ${String( serviceCredentialData )}`,
                'content-type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                scope: 'chat.read'
            })
        });
        oauthRateLimitDeniedStatusData = false;

        assert.equal( rateLimitedResponseData.status, 429 );
        assert.equal( rateLimitedResponseData.headers.get( 'retry-after' ), '2' );
        assert.equal(
            oauthRateLimitCallsData.some(function tokenRateLimitFind( rateLimitData ){
                return (
                    rateLimitData.operation === String( 'auth.oauth.token' ) &&
                    rateLimitData.credentialId === String( 'service-test' )
                );

            }),
            true
        );
        assert.equal(
            oauthAuditCallsData.some(function tokenAuditFind( auditData ){
                return (
                    auditData.operation === String( 'auth.oauth.token' ) &&
                    auditData.outcome === String( 'success' )
                );

            }),
            true
        );
        assert.equal(
            oauthAuditCallsData.some(function rateAuditFind( auditData ){
                return (
                    auditData.operation === String( 'auth.oauth.token' ) &&
                    auditData.outcome === String( 'denied' ) &&
                    auditData.errorCode === String( 'RATE_LIMITED' )
                );

            }),
            true
        );

        const unrelatedRequestData = {url: '/application'};
        const unrelatedResponseData = {};
        assert.equal(
            await providerData.requestHandle(
                /** @type {any} */ (unrelatedRequestData),
                /** @type {any} */ (unrelatedResponseData)
            ),
            false
        );

    } finally {
        await new Promise(function serverStop( resolveData, rejectData ){
            serverData.close(function closeComplete( errorData ){
                if ( errorData !== undefined ){
                    rejectData( errorData );
                    return;

                }

                resolveData( undefined );

            });

        });

    }

});

test( 'OAuth durable adapter HMAC indexes identifiers and encrypts payloads', async function(){
    const queryCallsData = /** @type {any[]} */ ([]);
    const replayClaimHashesData = new Set();
    let persistedRowData = /** @type {Record<string, any> | undefined} */ (undefined);
    const envelopeData = layerAuthSecretEnvelopeCreate({secret: authSecretData});
    const adapterData = layerAuthOidcAdapterFactoryCreate({
        database: {
            systemSchema: 'layer_auth_test',
            async query( /** @type {any} */ queryData ){
                queryCallsData.push( queryData );

                if ( queryData.text.includes( 'DO NOTHING' ) ){
                    const replayClaimHashData = String( queryData.values[1] );

                    if ( replayClaimHashesData.has( replayClaimHashData ) === true ){
                        return {rows: [], rowCount: 0};

                    }

                    replayClaimHashesData.add( replayClaimHashData );
                    return {rows: [{record_id_hash: replayClaimHashData}], rowCount: 1};

                }

                if ( queryData.text.includes( 'INSERT INTO' ) ){
                    persistedRowData = {
                        payload_encrypted: queryData.values[2],
                        expires_at: queryData.values[7],
                        consumed_at: null
                    };

                }

                if ( queryData.text.includes( 'SELECT payload_encrypted' ) ){
                    return {rows: persistedRowData === undefined ? [] : [persistedRowData], rowCount: 1};

                }

                if ( queryData.text.includes( 'SET consumed_at' ) && persistedRowData !== undefined ){
                    persistedRowData.consumed_at = new Date();

                }

                return {rows: [], rowCount: 1};

            }
        },
        envelope: envelopeData,
        pepper: authSecretData
    });
    const authorizationCodeData = new adapterData( 'AuthorizationCode' );

    await authorizationCodeData.upsert( 'raw-code-identifier', {
        grantId: 'raw-grant-identifier',
        accountId: 'raw-account-identifier',
        uid: 'raw-interaction-uid',
        secret: 'raw-provider-payload'
    }, Number( 600 ) );
    const insertCallData = queryCallsData[0];

    assert.equal( insertCallData.values.includes( 'raw-code-identifier' ), false );
    assert.equal( insertCallData.values.includes( 'raw-grant-identifier' ), false );
    assert.equal( insertCallData.values.includes( 'raw-account-identifier' ), false );
    assert.equal( Buffer.from( insertCallData.values[2] ).includes( 'raw-provider-payload' ), false );

    const foundData = await authorizationCodeData.find( 'raw-code-identifier' );
    assert.equal( foundData.secret, 'raw-provider-payload' );

    await authorizationCodeData.consume( 'raw-code-identifier' );
    const consumedData = await authorizationCodeData.find( 'raw-code-identifier' );
    assert.equal( typeof consumedData.consumed, 'number' );

    await authorizationCodeData.revokeByGrantId( 'raw-grant-identifier' );
    const revokeCallData = queryCallsData.at( -1 );
    assert.equal( revokeCallData.values.includes( 'raw-grant-identifier' ), false );

    await authorizationCodeData.revokeByAccountId( 'raw-account-identifier' );
    const accountRevokeCallData = queryCallsData.at( -1 );
    assert.equal( accountRevokeCallData.values.includes( 'raw-account-identifier' ), false );
    const dpopProofData = new adapterData( 'DPoPProof' );
    const firstClaimStatusData = await dpopProofData.claim(
        'thumbprint:raw-proof-identifier',
        {iat: Number( 1000 )},
        Number( 300 )
    );
    const replayClaimStatusData = await dpopProofData.claim(
        'thumbprint:raw-proof-identifier',
        {iat: Number( 1000 )},
        Number( 300 )
    );
    const firstClaimCallData = queryCallsData.at( -2 );

    assert.equal( firstClaimStatusData, true );
    assert.equal( replayClaimStatusData, false );
    assert.equal(
        firstClaimCallData.values.includes( 'thumbprint:raw-proof-identifier' ),
        false
    );

});

test( 'external OIDC service validates PKCE state and provisions one managed identity', async function(){
    const clockData = Date.parse( '2026-09-23T12:00:00.000Z' );
    const envelopeData = layerAuthSecretEnvelopeCreate({secret: authSecretData});
    const configurationData = layerAuthConfigurationCreate({
        enabled: true,
        registration: {mode: 'open'},
        oidc: [{
            id: 'identity-test',
            issuer: 'https://identity.example.test',
            clientId: 'layer-test-client',
            clientSecret: {env: 'LAYER_TEST_OIDC_SECRET'},
            redirectUri: 'https://application.example.test/auth/callback',
            scopes: ['openid', 'email', 'profile']
        }]
    });
    assert.ok( configurationData !== null );
    let challengeData = /** @type {any} */ (null);
    let externalIdentityCreateData = /** @type {any} */ (null);
    let createdUserData = /** @type {any} */ (null);
    let grantChecksData = /** @type {any} */ (null);
    let sessionIssueData = /** @type {any} */ (null);
    const serviceData = layerAuthOidcServiceCreate(/** @type {any} */ ({
        configuration: configurationData,
        environment: {LAYER_TEST_OIDC_SECRET: 'external-provider-client-secret'},
        envelope: envelopeData,
        clock(){
            return clockData;

        },
        challenges: {
            async create( /** @type {any} */ createdChallengeData ){
                challengeData = structuredClone( createdChallengeData );
                return {token: createdChallengeData.token};

            },
            async consume( /** @type {any} */ consumeData ){
                if ( challengeData === null || consumeData.token !== challengeData.token ){
                    return null;

                }

                const consumedChallengeData = challengeData;
                challengeData = null;
                return {payload: consumedChallengeData.payload};

            }
        },
        externalIdentities: {
            async find(){
                return null;

            },
            async create( /** @type {any} */ identityData ){
                externalIdentityCreateData = structuredClone({
                    providerId: identityData.providerId,
                    subject: identityData.subject,
                    userId: identityData.userId,
                    claims: identityData.claims
                });
                return {externalIdentityId: 'external-id', userId: identityData.userId};

            }
        },
        users: {
            async findByIdentifier(){
                return null;

            },
            async create( /** @type {any} */ userData ){
                createdUserData = userData;
                const createdData = {userId: 'user-oidc-test'};
                await userData.afterCreate( createdData, {query: async function query(){
                    return {rows: [], rowCount: 1};
                }} );
                return {...createdData, status: 'active'};

            }
        },
        async sessionIssue( /** @type {any} */ userIdentifierData, /** @type {any} */ rememberStatusData, /** @type {any} */ assuranceData ){
            sessionIssueData = {userIdentifierData, rememberStatusData, assuranceData};
            return {
                sessionId: 'session-oidc-test',
                sessionToken: 'session-token-with-enough-entropy',
                csrfToken: 'csrf-token-with-enough-entropy',
                idleExpiresAt: clockData + Number( 1000 ),
                absoluteExpiresAt: clockData + Number( 2000 )
            };

        },
        client: {
            allowInsecureRequests(){},
            ClientSecretBasic( /** @type {any} */ secretData ){
                assert.equal( secretData, 'external-provider-client-secret' );
                return function clientAuthentication(){};

            },
            async discovery(){
                return {configuration: true};

            },
            randomPKCECodeVerifier(){
                return 'pkce-code-verifier-with-enough-entropy';

            },
            async calculatePKCECodeChallenge( /** @type {any} */ verifierData ){
                assert.equal( verifierData, 'pkce-code-verifier-with-enough-entropy' );
                return 'pkce-code-challenge';

            },
            randomState(){
                return 'oidc-state-with-enough-entropy';

            },
            randomNonce(){
                return 'oidc-nonce-with-enough-entropy';

            },
            buildAuthorizationUrl( /** @type {any} */ configurationInputData, /** @type {any} */ parametersData ){
                assert.deepEqual( configurationInputData, {configuration: true} );
                const authorizationUrlData = new URL( 'https://identity.example.test/authorize' );

                for ( const [parameterNameData, parameterValueData] of Object.entries( parametersData ) ){
                    authorizationUrlData.searchParams.set( parameterNameData, String( parameterValueData ) );

                }

                return authorizationUrlData;

            },
            async authorizationCodeGrant(
                /** @type {any} */ configurationInputData,
                /** @type {any} */ callbackUrlData,
                /** @type {any} */ checksData
            ){
                assert.deepEqual( configurationInputData, {configuration: true} );
                assert.equal( callbackUrlData.searchParams.get( 'code' ), 'upstream-code' );
                grantChecksData = structuredClone( checksData );
                return {
                    claims(){
                        return {
                            sub: 'upstream-subject',
                            email: 'verified@example.test',
                            email_verified: true,
                            name: 'Verified Developer'
                        };

                    }
                };

            }
        }
    }));
    const beginResultData = await serviceData.begin({
        providerId: 'identity-test',
        returnTo: '/workspace?tab=security'
    });
    const authorizationUrlData = new URL( beginResultData.authorizationUrl );

    assert.equal( authorizationUrlData.searchParams.get( 'code_challenge_method' ), 'S256' );
    assert.equal( authorizationUrlData.searchParams.get( 'state' ), 'oidc-state-with-enough-entropy' );
    assert.equal( challengeData.payload.envelope.includes( 'pkce-code-verifier' ), false );

    const completeResultData = await serviceData.complete({
        callbackUrl: 'https://application.example.test/auth/callback?code=upstream-code&state=oidc-state-with-enough-entropy',
        remember: true
    });

    assert.equal( grantChecksData.pkceCodeVerifier, 'pkce-code-verifier-with-enough-entropy' );
    assert.equal( grantChecksData.expectedNonce, 'oidc-nonce-with-enough-entropy' );
    assert.equal( createdUserData.identifier.normalized, 'verified@example.test' );
    assert.equal( externalIdentityCreateData.subject, 'upstream-subject' );
    assert.deepEqual( sessionIssueData.assuranceData, ['oidc', 'oidc:identity-test'] );
    assert.equal( completeResultData.returnTo, '/workspace?tab=security' );

    await assert.rejects(function stateReplay(){
        return serviceData.complete({
            callbackUrl: 'https://application.example.test/auth/callback?code=replay&state=oidc-state-with-enough-entropy'
        });

    }, function errorCheck( errorData ){
        assert.ok( errorData instanceof LayerAuthError );
        assert.equal( errorData.code, 'AUTH_OIDC_STATE_INVALID' );
        return true;

    });

});

test( 'external OIDC never auto-links a matching application email', async function(){
    const envelopeData = layerAuthSecretEnvelopeCreate({secret: authSecretData});
    const configurationData = layerAuthConfigurationCreate({
        enabled: true,
        registration: {mode: 'open'},
        oidc: [{
            id: 'identity-test',
            issuer: 'https://identity.example.test',
            clientId: 'layer-test-client',
            clientSecret: {env: 'LAYER_TEST_OIDC_SECRET'},
            redirectUri: 'https://application.example.test/auth/callback',
            scopes: ['openid', 'email']
        }]
    });
    assert.ok( configurationData !== null );
    let challengeData = /** @type {any} */ (null);
    const serviceData = layerAuthOidcServiceCreate(/** @type {any} */ ({
        configuration: configurationData,
        environment: {LAYER_TEST_OIDC_SECRET: 'external-provider-client-secret'},
        envelope: envelopeData,
        challenges: {
            async create( /** @type {any} */ valueData ){
                challengeData = valueData;

            },
            async consume(){
                return {payload: challengeData.payload};

            }
        },
        externalIdentities: {
            async find(){
                return null;

            },
            async create(){
                throw new Error( 'External identity must not be created.' );

            }
        },
        users: {
            async findByIdentifier(){
                return {userId: 'existing-user'};

            },
            async create(){
                throw new Error( 'Existing email must not create a new user.' );

            }
        },
        async sessionIssue(){
            throw new Error( 'Existing email must not receive a session.' );

        },
        client: {
            allowInsecureRequests(){},
            ClientSecretBasic(){
                return function clientAuthentication(){};
            },
            async discovery(){
                return {};
            },
            randomPKCECodeVerifier(){
                return 'pkce-code-verifier-with-enough-entropy';
            },
            async calculatePKCECodeChallenge(){
                return 'pkce-code-challenge';
            },
            randomState(){
                return 'oidc-state-with-enough-entropy';
            },
            randomNonce(){
                return 'oidc-nonce-with-enough-entropy';
            },
            buildAuthorizationUrl(){
                return new URL( 'https://identity.example.test/authorize' );
            },
            async authorizationCodeGrant(){
                return {
                    claims(){
                        return {
                            sub: 'upstream-subject',
                            email: 'existing@example.test',
                            email_verified: true
                        };

                    }
                };

            }
        }
    }));

    await serviceData.begin({providerId: 'identity-test'});

    await assert.rejects(function oidcComplete(){
        return serviceData.complete({
            callbackUrl: 'https://application.example.test/auth/callback?code=code&state=oidc-state-with-enough-entropy'
        });

    }, function errorCheck( errorData ){
        assert.ok( errorData instanceof LayerAuthError );
        assert.equal( errorData.code, 'AUTH_OIDC_LINK_REQUIRED' );
        return true;

    });

});
