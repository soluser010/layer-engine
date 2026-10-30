import {
    createHash,
    randomUUID
} from 'node:crypto';
import {createRequire} from 'node:module';
import {
    calculateJwkThumbprint,
    importJWK,
    jwtVerify
} from 'jose';
import {LayerAuthError} from './auth-error.js';


const oauthModuleRequireData = createRequire( import.meta.url );


/** @param {import('node:http').ServerResponse} responseData @param {number} statusData @param {unknown} bodyData */
//Function for sending one bounded OAuth integration response
const oauthJsonResponseSend = function( responseData, statusData, bodyData ){
    //Serializing the bounded interoperability payload before writing immutable headers
    const bodySourceData = JSON.stringify( bodyData );
    responseData.writeHead( statusData, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
        'content-length': String( Buffer.byteLength( bodySourceData, 'utf8' ) ),
        'x-content-type-options': 'nosniff'
    });
    responseData.end( bodySourceData );

};

/**
 * Creates an embedded OAuth 2.1 / OpenID Connect provider with PKCE, opaque
 * tokens, exact clients, durable adapter state, and DPoP validation.
 *
 * @param {{
 *     configuration: Readonly<Record<string, any>>,
 *     adapter: Function,
 *     users: {findById: Function, identifiersList: Function},
 *     authorizationResolve: (userIdentifierData: string) => Promise<{tenantId: string | null, permissions: readonly string[]}>,
 *     secret: string,
 *     jwks: {keys: readonly Record<string, any>[]},
 *     environment?: Record<string, string | undefined>,
 *     interactionHandler?: Function,
 *     auditTrail?: {record: Function},
 *     rateLimiter?: {consume: Function}
 * }} providerOptions
 */
export function layerAuthOAuthProviderCreate( providerOptions ){
    //Checking the complete authorization-server boundary before library setup
    if (
        providerOptions === null ||
        typeof providerOptions !== String( 'object' ) ||
        (providerOptions.configuration?.oauth ?? null) === null ||
        typeof providerOptions.adapter !== String( 'function' ) ||
        typeof providerOptions.users?.findById !== String( 'function' ) ||
        typeof providerOptions.users?.identifiersList !== String( 'function' ) ||
        typeof providerOptions.authorizationResolve !== String( 'function' ) ||
        typeof providerOptions.secret !== String( 'string' ) ||
        Number( providerOptions.secret.length ) < Number( 32 ) ||
        Array.isArray( providerOptions.jwks?.keys ) === false ||
        Number( providerOptions.jwks.keys.length ) < Number( 1 )
    ){
        throw new TypeError( 'Layer Auth OAuth provider requires configuration, durable adapter, users, signing keys, and a 32-character secret.' );

    }

    if (
        providerOptions.auditTrail !== undefined &&
        typeof providerOptions.auditTrail?.record !== String( 'function' )
    ){
        throw new TypeError( 'Layer Auth OAuth audit trail is invalid.' );

    }

    if (
        providerOptions.rateLimiter !== undefined &&
        typeof providerOptions.rateLimiter?.consume !== String( 'function' )
    ){
        throw new TypeError( 'Layer Auth OAuth rate limiter is invalid.' );

    }

    //Loading the CommonJS provider graph only for an enabled authorization server
    const oauthProviderModuleData = oauthModuleRequireData( 'oidc-provider' );
    let ProviderData = oauthProviderModuleData.default;

    if ( typeof ProviderData !== String( 'function' ) ){
        ProviderData = oauthProviderModuleData;

    }

    if ( typeof ProviderData !== String( 'function' ) ){
        throw new TypeError( 'Layer Auth OAuth provider dependency is invalid.' );

    }

    const oauthConfigurationData = providerOptions.configuration.oauth;
    const environmentData = providerOptions.environment ?? process.env;
    const clientsData = oauthConfigurationData.clients.map(function oauthClientResolve( /** @type {any} */ clientData ){
        const providerClientData = /** @type {Record<string, any>} */ ({
            client_id: String( clientData.id ),
            client_name: String( clientData.displayName ),
            redirect_uris: [...clientData.redirectUris],
            response_types: ['code'],
            grant_types: [...clientData.grantTypes],
            scope: clientData.scopes.join( ' ' ),
            id_token_signed_response_alg: 'ES256',
            dpop_bound_access_tokens: clientData.dpop === String( 'required' )
        });

        //Resolving confidential credentials only inside the server worker
        if ( clientData.type === String( 'confidential' ) ){
            const clientSecretData = environmentData[clientData.secret.env];

            if ( typeof clientSecretData !== 'string' || Number( String( clientSecretData ).length ) < Number( 32 ) ){
                throw new LayerAuthError(
                    'AUTH_OAUTH_SECRET_UNAVAILABLE',
                    `OAuth client secret is unavailable for ${String( clientData.id )}.`
                );

            }

            providerClientData.client_secret = String( clientSecretData );
            providerClientData.token_endpoint_auth_method = String( 'client_secret_basic' );

        } else {
            providerClientData.token_endpoint_auth_method = String( 'none' );

        }

        //CallBack THE OBJECT
        return providerClientData;

    });
    const clientCredentialsStatusData = oauthConfigurationData.clients.some(function clientCredentialsFind( /** @type {any} */ clientData ){
        //Finding whether the provider must expose the server-to-server grant
        return clientData.grantTypes.includes( 'client_credentials' ) === true;

    });
    const dpopNonceSecretData = createHash( 'sha256' )
        .update( `${String( providerOptions.secret )}:dpop-nonce`, 'utf8' )
        .digest();
    const oauthProviderData = new ProviderData( oauthConfigurationData.issuer, {
        adapter: providerOptions.adapter,
        clients: clientsData,
        claims: {
            openid: ['sub'],
            email: ['email', 'email_verified'],
            profile: []
        },
        cookies: {
            keys: [String( providerOptions.secret )],
            long: {
                httpOnly: true,
                sameSite: 'lax',
                signed: true,
                secure: new URL( oauthConfigurationData.issuer ).protocol === String( 'https:' )
            },
            short: {
                httpOnly: true,
                sameSite: 'lax',
                signed: true,
                secure: new URL( oauthConfigurationData.issuer ).protocol === String( 'https:' )
            }
        },
        features: {
            clientCredentials: {enabled: clientCredentialsStatusData},
            devInteractions: {enabled: false},
            dPoP: {
                enabled: true,
                nonceSecret: dpopNonceSecretData,
                allowReplay: false
            },
            introspection: {enabled: true},
            revocation: {enabled: true},
            registration: {enabled: false},
            userinfo: {enabled: true}
        },
        findAccount: async function oauthAccountFind( /** @type {any} */ contextData, /** @type {string} */ accountIdentifierData ){
            void contextData;

            const accountData = await providerOptions.users.findById( accountIdentifierData );

            //Failing closed after disable or anonymization before issuing new tokens
            if ( accountData === null || accountData.status !== String( 'active' ) ){
                return undefined;

            }

            //CallBack THE OBJECT
            return {
                accountId: String( accountIdentifierData ),
                async claims(){
                    const identifiersData = await providerOptions.users.identifiersList( accountIdentifierData );
                    const claimsData = /** @type {Record<string, any>} */ ({
                        sub: String( accountIdentifierData )
                    });

                    //Adding only a verified email identity to OIDC claims
                    for ( const identifierData of identifiersData ){
                        if ( identifierData.type === String( 'email' ) && identifierData.verified === true ){
                            claimsData.email = String( identifierData.display );
                            claimsData.email_verified = true;
                            break;

                        }

                    }

                    //CallBack THE OBJECT
                    return claimsData;

                }
            };

        },
        formats: {
            AccessToken: 'opaque'
        },
        interactions: {
            async url( /** @type {any} */ contextData, /** @type {{uid: string}} */ interactionData ){
                //Building the same-origin application interaction URL from the opaque provider uid
                void contextData;
                return `${String( oauthConfigurationData.interactionUrl )}/${encodeURIComponent( interactionData.uid )}`;

            }
        },
        jwks: structuredClone( providerOptions.jwks ),
        pkce: {
            required(){
                //CallBack THE BOOLEAN
                return true;

            }
        },
        routes: {
            authorization: '/oauth/authorize',
            introspection: '/oauth/introspect',
            jwks: '/oauth/jwks',
            revocation: '/oauth/revoke',
            token: '/oauth/token',
            userinfo: '/oauth/userinfo'
        },
        rotateRefreshToken: true,
        scopes: [...oauthConfigurationData.scopes],
        ttl: {
            AccessToken: Number( 900 ),
            AuthorizationCode: Number( 600 ),
            ClientCredentials: Number( 900 ),
            Grant: Number( 1209600 ),
            IdToken: Number( 600 ),
            Interaction: Number( 600 ),
            RefreshToken: Number( 2592000 ),
            Session: Number( 43200 )
        }
    });
    const providerCallbackData = oauthProviderData.callback();
    const interactionPathPrefixData = `${String( oauthConfigurationData.interactionUrl ).replace( /\/$/u, String() )}/`;
    const oauthStandardScopesData = new Set([
        'email',
        'offline_access',
        'openid',
        'profile'
    ]);
    const oauthClientMapData = new Map(
        oauthConfigurationData.clients.map(function oauthClientMap( /** @type {any} */ clientData ){
            //Mapping the validated client identifier to its immutable configuration
            return [String( clientData.id ), clientData];

        })
    );
    const oauthAdapterClassData = /** @type {new (modelNameData: string) => any} */ (providerOptions.adapter);
    const oauthAccessTokenAdapterData = new oauthAdapterClassData( 'AccessToken' );
    const oauthClientCredentialsAdapterData = new oauthAdapterClassData( 'ClientCredentials' );
    const oauthDpopReplayAdapterData = new oauthAdapterClassData( 'DPoPProof' );
    const oauthResourceUrlData = new URL( '/api', oauthConfigurationData.issuer ).href;

    /**
     * @param {readonly string[]} scopesData
     */
    //Function for selecting only application permissions from protocol scopes
    const oauthPermissionScopesCreate = function( scopesData ){
        return Object.freeze(scopesData.filter(function oauthPermissionScopeFilter( scopeData ){
            //Removing protocol scopes before permission enforcement
            return oauthStandardScopesData.has( scopeData ) === false;

        }));

    };

    /**
     * @param {unknown} headersData
     * @param {string} headerNameData
     */
    //Function for reading one bounded incoming header value
    const oauthHeaderValueGet = function( headersData, headerNameData ){
        if ( headersData === null || typeof headersData !== String( 'object' ) ){
            return null;

        }

        const headerValueData = /** @type {Record<string, unknown>} */ (headersData)[headerNameData];

        if (
            typeof headerValueData !== 'string' ||
            Number( headerValueData.length ) < Number( 1 ) ||
            Number( headerValueData.length ) > Number( 8192 )
        ){
            return null;

        }

        return String( headerValueData );

    };

    /**
     * @param {string} accessTokenData
     * @param {string} expectedThumbprintData
     * @param {Readonly<Record<string, any>>} requestContextData
     */
    //Function for verifying and claiming one resource-server DPoP proof
    const oauthDpopProofCheck = async function( accessTokenData, expectedThumbprintData, requestContextData ){
        //Reading the proof from the normalized request headers before signature verification
        const dpopProofData = oauthHeaderValueGet( requestContextData.headers, 'dpop' );

        if ( requestContextData.scheme !== String( 'dpop' ) || dpopProofData === null ){
            return false;

        }

        try {
            const proofSectionData = dpopProofData.split( '.' );

            if ( Number( proofSectionData.length ) !== Number( 3 ) || proofSectionData[0] === undefined ){
                return false;

            }

            const protectedHeaderData = JSON.parse(
                Buffer.from( proofSectionData[0], 'base64url' ).toString( 'utf8' )
            );
            const publicKeyData = protectedHeaderData.jwk;

            if (
                protectedHeaderData.alg !== String( 'ES256' ) ||
                String( protectedHeaderData.typ ?? String() ).toLowerCase() !== String( 'dpop+jwt' ) ||
                publicKeyData === null ||
                typeof publicKeyData !== String( 'object' ) ||
                publicKeyData.kty !== String( 'EC' ) ||
                publicKeyData.crv !== String( 'P-256' ) ||
                publicKeyData.d !== undefined
            ){
                return false;

            }

            const keyThumbprintData = await calculateJwkThumbprint( publicKeyData, 'sha256' );

            if ( keyThumbprintData !== expectedThumbprintData ){
                return false;

            }

            const verificationKeyData = await importJWK( publicKeyData, 'ES256' );
            const verificationResultData = await jwtVerify( dpopProofData, verificationKeyData, {
                algorithms: ['ES256'],
                clockTolerance: Number( 5 ),
                maxTokenAge: String( '5m' ),
                typ: String( 'dpop+jwt' )
            });
            const proofPayloadData = verificationResultData.payload;
            const expectedAccessTokenHashData = createHash( 'sha256' )
                .update( accessTokenData, 'utf8' )
                .digest( 'base64url' );

            if (
                proofPayloadData.htm !== String( 'POST' ) ||
                proofPayloadData.htu !== oauthResourceUrlData ||
                proofPayloadData.ath !== expectedAccessTokenHashData ||
                typeof proofPayloadData.jti !== 'string' ||
                Number( proofPayloadData.jti.length ) < Number( 16 ) ||
                Number( proofPayloadData.jti.length ) > Number( 200 ) ||
                typeof proofPayloadData.iat !== String( 'number' )
            ){
                return false;

            }

            const currentTimeSecondsData = Math.floor( Date.now() / Number( 1000 ) );
            const replayLifetimeData = Math.max(
                Number( 1 ),
                Number( proofPayloadData.iat ) + Number( 300 ) - Number( currentTimeSecondsData )
            );

            return oauthDpopReplayAdapterData.claim(
                `${String( expectedThumbprintData )}:${String( proofPayloadData.jti )}`,
                {iat: Number( proofPayloadData.iat )},
                replayLifetimeData
            );

        } catch {
            return false;

        }

    };

    /**
     * @param {string} accessTokenData
     * @param {Readonly<Record<string, any>>} [requestContextData]
     */
    //Function for resolving one opaque provider token into Layer security identity
    const oauthAccessTokenResolve = async function( accessTokenData, requestContextData = {} ){
        //Rejecting malformed opaque tokens before consulting provider storage
        if (
            typeof accessTokenData !== String( 'string' ) ||
            Number( accessTokenData.length ) < Number( 16 ) ||
            Number( accessTokenData.length ) > Number( 8192 )
        ){
            return null;

        }

        let tokenData = await oauthAccessTokenAdapterData.find( accessTokenData );

        if ( tokenData === undefined ){
            tokenData = await oauthClientCredentialsAdapterData.find( accessTokenData );

        }

        if (
            tokenData === undefined ||
            tokenData === null ||
            typeof tokenData !== String( 'object' ) ||
            typeof tokenData.clientId !== String( 'string' ) ||
            typeof tokenData.scope !== String( 'string' ) ||
            typeof tokenData.exp !== String( 'number' )
        ){
            return null;

        }

        const clientData = oauthClientMapData.get( tokenData.clientId );
        const expiresAtData = Number( tokenData.exp ) * Number( 1000 );

        if ( clientData === undefined || expiresAtData <= Number( Date.now() ) ){
            return null;

        }

        const scopesData = String( tokenData.scope ).split( /\s+/u ).filter(Boolean);

        if (
            Number( scopesData.length ) < Number( 1 ) ||
            scopesData.some(function oauthTokenScopeInvalid( scopeData ){
                //Rejecting scopes absent from either the provider or client allowlist
                return (
                    oauthConfigurationData.scopes.includes( scopeData ) === false ||
                    clientData.scopes.includes( scopeData ) === false
                );

            }) === true
        ){
            return null;

        }

        if ( typeof tokenData.jkt === String( 'string' ) ){
            const dpopStatusData = await oauthDpopProofCheck(
                accessTokenData,
                tokenData.jkt,
                requestContextData
            );

            if ( dpopStatusData !== true ){
                return null;

            }

        } else if ( requestContextData.scheme === String( 'dpop' ) ){
            return null;

        }

        const scopePermissionsData = oauthPermissionScopesCreate( scopesData );
        let userIdentifierData = `oauth-client:${String( tokenData.clientId )}`;
        let tenantIdentifierData = null;
        let permissionsData = [...scopePermissionsData];

        if ( typeof tokenData.accountId === String( 'string' ) ){
            const accountData = await providerOptions.users.findById( tokenData.accountId );

            if ( accountData === null || accountData.status !== String( 'active' ) ){
                return null;

            }

            const authorizationData = await providerOptions.authorizationResolve(
                tokenData.accountId
            );

            if (
                authorizationData === null ||
                typeof authorizationData !== String( 'object' ) ||
                Array.isArray( authorizationData.permissions ) === false
            ){
                return null;

            }

            const activePermissionSetData = new Set(authorizationData.permissions.map( String ));
            permissionsData = scopePermissionsData.filter(function oauthActivePermissionFilter( permissionData ){
                //Keeping only permissions still active after role changes
                return activePermissionSetData.has( permissionData );

            });
            userIdentifierData = String( tokenData.accountId );

            if ( authorizationData.tenantId !== null && authorizationData.tenantId !== undefined ){
                tenantIdentifierData = String( authorizationData.tenantId );

            }

        }

        const assuranceData = ['oauth'];

        if ( typeof tokenData.jkt === String( 'string' ) ){
            assuranceData.push( 'dpop' );

        }

        const revocationReferenceData = /** @type {Record<string, string>} */ ({});

        //Supporting existing custom adapters while enabling durable built-in token revocation checks
        if ( typeof oauthAccessTokenAdapterData.reference === 'function' ){
            revocationReferenceData.credentialReference = `oidc:${oauthAccessTokenAdapterData.reference( accessTokenData )}`;

        }

        return Object.freeze({
            id: `oauth:${createHash( 'sha256' ).update( accessTokenData, 'utf8' ).digest( 'hex' )}`,
            ...revocationReferenceData,
            userId: userIdentifierData,
            tenantId: tenantIdentifierData,
            permissions: Object.freeze( permissionsData ),
            assurance: Object.freeze( assuranceData ),
            expiresAt: expiresAtData,
            status: 'active'
        });

    };

    /**
     * @param {import('node:http').IncomingMessage} requestData
     */
    //Function for resolving a bounded OAuth network identity behind the private proxy
    const oauthRemoteAddressCreate = function( requestData ){
        const forwardedAddressData = requestData.headers['x-forwarded-for'];
        let remoteAddressData = String( requestData.socket.remoteAddress ?? 'unknown' );

        if ( typeof forwardedAddressData === String( 'string' ) ){
            const forwardedAddressSourceData = /** @type {string} */ (forwardedAddressData);
            const forwardedFirstAddressData = String( forwardedAddressSourceData.split( ',', Number( 1 ) )[0] ?? String() ).trim();

            if (
                Number( forwardedFirstAddressData.length ) > Number( 0 ) &&
                Number( forwardedFirstAddressData.length ) <= Number( 160 )
            ){
                remoteAddressData = forwardedFirstAddressData;

            }

        }

        //CallBack THE STRING
        return String( remoteAddressData ).slice( Number( 0 ), Number( 160 ) );

    };

    /**
     * @param {import('node:http').IncomingMessage} requestData
     */
    //Function for reading a public OAuth client identifier without parsing secrets
    const oauthClientIdentifierCreate = function( requestData ){
        const requestUrlData = new URL( requestData.url ?? '/', 'http://layer.local' );
        const queryClientIdentifierData = requestUrlData.searchParams.get( 'client_id' );

        if (
            typeof queryClientIdentifierData === String( 'string' ) &&
            Number( String( queryClientIdentifierData ).length ) > Number( 0 ) &&
            Number( String( queryClientIdentifierData ).length ) <= Number( 128 )
        ){
            return String( queryClientIdentifierData );

        }

        const authorizationHeaderData = requestData.headers.authorization;

        if (
            typeof authorizationHeaderData === String( 'string' ) &&
            String( authorizationHeaderData ).startsWith( 'Basic ' ) === true
        ){
            try {
                const authorizationHeaderSourceData = /** @type {string} */ (authorizationHeaderData);
                const authorizationSourceData = Buffer.from(
                    authorizationHeaderSourceData.slice( Number( 6 ) ),
                    'base64'
                ).toString( 'utf8' );
                const basicClientIdentifierData = authorizationSourceData.split( ':', Number( 1 ) )[0] ?? String();

                if (
                    Number( basicClientIdentifierData.length ) > Number( 0 ) &&
                    Number( basicClientIdentifierData.length ) <= Number( 128 )
                ){
                    return String( basicClientIdentifierData );

                }

            } catch( malformedAuthorizationErrorData ){
                //Treating a malformed Basic value as an anonymous OAuth request
                void malformedAuthorizationErrorData;

            }

        }

        return null;

    };

    /**
     * @param {string} requestPathData
     */
    //Function for mapping one interoperability path to a stable policy operation
    const oauthOperationNameCreate = function( requestPathData ){
        //Mapping only the fixed OAuth interoperability paths exposed by this runtime
        if ( requestPathData === String( '/oauth/token' ) ){
            return String( 'auth.oauth.token' );

        }

        if ( requestPathData === String( '/oauth/revoke' ) ){
            return String( 'auth.oauth.revoke' );

        }

        if ( requestPathData === String( '/oauth/introspect' ) ){
            return String( 'auth.oauth.introspect' );

        }

        if ( requestPathData === String( '/oauth/authorize' ) ){
            return String( 'auth.oauth.authorize' );

        }

        if ( requestPathData.startsWith( interactionPathPrefixData ) === true ){
            return String( 'auth.oauth.interaction' );

        }

        return String( 'auth.oauth.metadata' );

    };

    /**
     * @param {import('node:http').IncomingMessage} requestData
     * @param {import('node:http').ServerResponse} responseData
     */
    //Function for serving only OAuth interoperability and interaction routes
    const oauthRequestHandleData = async function( requestData, responseData ){
        const requestPathData = String( String( requestData.url ?? '/' ).split( '?', Number( 1 ) )[0] ?? '/' );
        const providerRouteStatusData = (
            requestPathData === String( '/.well-known/openid-configuration' ) ||
            requestPathData === String( '/.well-known/oauth-authorization-server' ) ||
            requestPathData.startsWith( '/oauth/' ) === true ||
            requestPathData.startsWith( interactionPathPrefixData ) === true
        );

        if ( providerRouteStatusData === false ){
            return false;

        }

        const oauthOperationNameData = oauthOperationNameCreate( requestPathData );
        const remoteAddressData = oauthRemoteAddressCreate( requestData );
        const clientIdentifierData = oauthClientIdentifierCreate( requestData );

        //Applying the shared distributed limiter before OAuth library work
        if ( providerOptions.rateLimiter !== undefined ){
            let requestCostData = Number( 1 );

            if ( oauthOperationNameData !== String( 'auth.oauth.metadata' ) ){
                requestCostData = Number( 10 );

            }

            const rateLimitResultData = await providerOptions.rateLimiter.consume({
                profile: 'anonymous',
                remoteAddress: remoteAddressData,
                credentialId: clientIdentifierData,
                sessionId: null,
                userId: null,
                tenantId: null,
                operation: oauthOperationNameData,
                cost: requestCostData
            });

            if ( rateLimitResultData.allowed !== true ){
                responseData.setHeader(
                    'Retry-After',
                    String( Math.max( Number( 1 ), Math.ceil( Number( rateLimitResultData.retryAfterMs ) / Number( 1000 ) ) ) )
                );
                oauthJsonResponseSend( responseData, Number( 429 ), {
                    error: 'temporarily_unavailable'
                });

                if ( providerOptions.auditTrail !== undefined ){
                    await providerOptions.auditTrail.record({
                        requestId: String( randomUUID() ),
                        operation: oauthOperationNameData,
                        category: 'auth.oauth',
                        authenticationType: 'oauth',
                        credentialId: clientIdentifierData,
                        userId: null,
                        tenantId: null,
                        remoteAddress: remoteAddressData,
                        outcome: 'denied',
                        errorCode: 'RATE_LIMITED'
                    });

                }

                return true;

            }

        }

        //Delegating headless interaction rendering to explicit trusted application code
        if ( requestPathData.startsWith( interactionPathPrefixData ) === true ){
            if ( typeof providerOptions.interactionHandler !== String( 'function' ) ){
                oauthJsonResponseSend( responseData, Number( 503 ), {
                    error: 'interaction_unavailable'
                });
                return true;

            }

            const interactionDetailsData = await oauthProviderData.interactionDetails(
                requestData,
                responseData
            );
            const interactionCompleteData = async function( /** @type {any} */ interactionResultData ){
                if (
                    interactionResultData === null ||
                    typeof interactionResultData !== String( 'object' ) ||
                    typeof interactionResultData.accountId !== String( 'string' )
                ){
                    throw new TypeError( 'OAuth interaction completion requires a trusted account identifier.' );

                }

                const accountData = await providerOptions.users.findById(
                    interactionResultData.accountId
                );

                if ( accountData === null || accountData.status !== String( 'active' ) ){
                    throw new LayerAuthError(
                        'AUTHORIZATION_DENIED',
                        'OAuth consent requires an active account.'
                    );

                }

                const requestedScopeData = String( interactionDetailsData.params.scope ?? 'openid' );
                const requestedScopesData = requestedScopeData.split( /\s+/u ).filter(Boolean);
                const requestedPermissionScopesData = oauthPermissionScopesCreate(
                    requestedScopesData
                );
                const authorizationData = await providerOptions.authorizationResolve(
                    interactionResultData.accountId
                );
                const currentPermissionSetData = new Set(
                    authorizationData.permissions.map( String )
                );

                //Refusing consent for application scopes the account does not currently own
                for ( const permissionData of requestedPermissionScopesData ){
                    if ( currentPermissionSetData.has( permissionData ) === false ){
                        throw new LayerAuthError(
                            'AUTHORIZATION_DENIED',
                            'OAuth consent requested an unavailable permission.'
                        );

                    }

                }

                const grantData = new oauthProviderData.Grant({
                    accountId: String( interactionResultData.accountId ),
                    clientId: String( interactionDetailsData.params.client_id )
                });
                grantData.addOIDCScope( requestedScopeData );
                const grantIdentifierData = await grantData.save();

                return oauthProviderData.interactionFinished(requestData, responseData, {
                    login: {
                        accountId: String( interactionResultData.accountId )
                    },
                    consent: {
                        grantId: String( grantIdentifierData )
                    }
                }, {
                    mergeWithLastSubmission: false
                });

            };

            const interactionHandlerData = /** @type {Function} */ (providerOptions.interactionHandler);
            await interactionHandlerData(Object.freeze({
                request: requestData,
                response: responseData,
                details: interactionDetailsData,
                complete: interactionCompleteData
            }));

            if ( providerOptions.auditTrail !== undefined ){
                let interactionOutcomeData = /** @type {'success' | 'denied'} */ ('success');
                let interactionErrorCodeData = null;

                if ( responseData.statusCode >= Number( 400 ) ){
                    interactionOutcomeData = 'denied';
                    interactionErrorCodeData = String( 'OAUTH_REQUEST_DENIED' );

                }

                await providerOptions.auditTrail.record({
                    requestId: String( randomUUID() ),
                    operation: oauthOperationNameData,
                    category: 'auth.oauth',
                    authenticationType: 'oauth',
                    credentialId: clientIdentifierData,
                    userId: null,
                    tenantId: null,
                    remoteAddress: remoteAddressData,
                    outcome: interactionOutcomeData,
                    errorCode: interactionErrorCodeData
                });

            }

            return true;

        }

        await providerCallbackData( requestData, responseData );

        if ( providerOptions.auditTrail !== undefined && oauthOperationNameData !== String( 'auth.oauth.metadata' ) ){
            let auditOutcomeData = /** @type {'success' | 'denied' | 'failed'} */ ('success');
            let auditErrorCodeData = null;

            if ( responseData.statusCode >= Number( 500 ) ){
                auditOutcomeData = 'failed';
                auditErrorCodeData = String( 'OAUTH_PROVIDER_FAILED' );

            } else if ( responseData.statusCode >= Number( 400 ) ){
                auditOutcomeData = 'denied';
                auditErrorCodeData = String( 'OAUTH_REQUEST_DENIED' );

            }

            await providerOptions.auditTrail.record({
                requestId: String( randomUUID() ),
                operation: oauthOperationNameData,
                category: 'auth.oauth',
                authenticationType: 'oauth',
                credentialId: clientIdentifierData,
                userId: null,
                tenantId: null,
                remoteAddress: remoteAddressData,
                outcome: auditOutcomeData,
                errorCode: auditErrorCodeData
            });

        }

        return true;

    };

    //CallBack THE OBJECT
    return Object.freeze({
        provider: oauthProviderData,
        requestHandle: oauthRequestHandleData,
        accessTokenResolve: oauthAccessTokenResolve,

        /**
         * @param {readonly {permissions?: readonly string[]}[]} operationInspectionData
         */
        scopesValidate( operationInspectionData ){
            //Rejecting invalid registry inspection input before comparing permissions
            if ( Array.isArray( operationInspectionData ) === false ){
                throw new TypeError( 'OAuth scope validation requires operation metadata.' );

            }

            const registeredPermissionSetData = new Set();

            for ( const operationData of operationInspectionData ){
                for ( const permissionData of operationData.permissions ?? [] ){
                    registeredPermissionSetData.add( String( permissionData ) );

                }

            }

            const unavailableScopesData = oauthPermissionScopesCreate(
                oauthConfigurationData.scopes
            ).filter(function oauthScopeUnavailable( scopeData ){
                //Finding configured permission scopes absent from registered operations
                return registeredPermissionSetData.has( scopeData ) === false;

            });

            if ( Number( unavailableScopesData.length ) > Number( 0 ) ){
                throw new LayerAuthError(
                    'AUTH_OAUTH_SCOPE_UNREGISTERED',
                    'OAuth application scopes must match registered operation permissions.',
                    {scopes: Object.freeze( unavailableScopesData )}
                );

            }

            return true;

        },

        /** @param {string} accountIdentifierData */
        async revokeAccount( accountIdentifierData ){
            if (
                typeof accountIdentifierData !== String( 'string' ) ||
                Number( accountIdentifierData.length ) < Number( 1 ) ||
                Number( accountIdentifierData.length ) > Number( 128 )
            ){
                throw new TypeError( 'OAuth account identifier is invalid.' );

            }

            //Revoking every grant, token, code, and session indexed to the account
            const accountAdapterData = new oauthAdapterClassData( 'AccessToken' );

            if ( typeof accountAdapterData.revokeByAccountId !== String( 'function' ) ){
                throw new TypeError( 'OAuth adapter does not support account revocation.' );

            }

            await accountAdapterData.revokeByAccountId( accountIdentifierData );

        }
    });

}
