import * as openidClient from 'openid-client';
import {layerAuthIdentifierCreate} from './identifier.js';
import {LayerAuthError} from './auth-error.js';


const oidcChallengeTypeData = String( 'oidc-signin' );
const oidcChallengeLifetimeData = Number( 600000 );
const oidcStateEnvelopePurposeData = String( 'oidc-signin-state' );


/** @param {unknown} returnToData */
//Function for creating one bounded same-origin navigation target
const returnToCreate = function( returnToData ){
    //Using the application root when the caller does not provide a navigation target
    if ( returnToData === undefined || returnToData === null ){
        return String( '/' );

    }

    if (
        typeof returnToData !== 'string' ||
        Number( returnToData.length ) < Number( 1 ) ||
        Number( returnToData.length ) > Number( 1024 ) ||
        returnToData.startsWith( '/' ) === false ||
        returnToData.startsWith( '//' ) === true ||
        returnToData.includes( '\\' ) === true ||
        [...returnToData].some(function returnTargetControlCharacterFind( characterData ){
            //Rejecting control characters that could split or disguise a redirect target
            const characterCodeData = characterData.codePointAt( Number( 0 ) ) ?? Number( 0 );

            return characterCodeData < Number( 32 ) || characterCodeData === Number( 127 );

        }) === true
    ){
        throw new LayerAuthError( 'AUTH_OIDC_STATE_INVALID', 'OIDC return target is invalid.' );

    }

    return String( returnToData );

};

/**
 * Creates external OpenID Connect sign-in with discovery, Authorization Code,
 * PKCE S256, nonce validation, durable one-time state, and managed sessions.
 *
 * @param {{
 *     configuration: Readonly<Record<string, any>>,
 *     users: {create: Function, findByIdentifier: Function},
 *     externalIdentities: {find: Function, create: Function},
 *     challenges: {create: Function, consume: Function},
 *     envelope: {seal: Function, open: Function},
 *     sessionIssue: Function,
 *     environment?: Record<string, string | undefined>,
 *     clock?: () => number,
 *     client?: typeof openidClient
 * }} serviceOptions
 */
export function layerAuthOidcServiceCreate( serviceOptions ){
    //Checking every trust boundary before enabling an upstream redirect flow
    if (
        serviceOptions === null ||
        typeof serviceOptions !== String( 'object' ) ||
        Array.isArray( serviceOptions.configuration?.oidc ) === false ||
        typeof serviceOptions.users?.create !== String( 'function' ) ||
        typeof serviceOptions.users?.findByIdentifier !== String( 'function' ) ||
        typeof serviceOptions.externalIdentities?.find !== String( 'function' ) ||
        typeof serviceOptions.externalIdentities?.create !== String( 'function' ) ||
        typeof serviceOptions.challenges?.create !== String( 'function' ) ||
        typeof serviceOptions.challenges?.consume !== String( 'function' ) ||
        typeof serviceOptions.envelope?.seal !== String( 'function' ) ||
        typeof serviceOptions.envelope?.open !== String( 'function' ) ||
        typeof serviceOptions.sessionIssue !== String( 'function' )
    ){
        throw new TypeError( 'Layer Auth OIDC requires providers, durable identities, challenges, and encrypted state.' );

    }

    const clockData = serviceOptions.clock ?? Date.now;
    const environmentData = serviceOptions.environment ?? process.env;
    const clientData = serviceOptions.client ?? openidClient;
    const providerConfigurationPromisesData = new Map();

    /** @param {string} providerIdentifierData */
    //Function for selecting only one configured provider by its stable identifier
    const providerGetData = function( providerIdentifierData ){
        const providerData = serviceOptions.configuration.oidc.find(function providerFind( /** @type {any} */ candidateData ){
            //Matching only the exact validated provider identifier
            return String( candidateData.id ) === String( providerIdentifierData );

        });

        if ( providerData === undefined ){
            throw new LayerAuthError( 'AUTH_OIDC_PROVIDER_INVALID', 'OIDC provider is unavailable.' );

        }

        return providerData;

    };

    /** @param {Readonly<Record<string, any>>} providerData */
    //Function for caching one verified discovery configuration per worker
    const clientConfigurationGetData = async function( providerData ){
        const cachedPromiseData = providerConfigurationPromisesData.get( providerData.id );

        if ( cachedPromiseData !== undefined ){
            return cachedPromiseData;

        }

        const configurationPromiseData = (async function providerDiscover(){
            const clientSecretData = environmentData[providerData.clientSecret.env];

            if ( typeof clientSecretData !== 'string' || Number( clientSecretData.length ) < Number( 1 ) ){
                throw new LayerAuthError(
                    'AUTH_OIDC_UPSTREAM_FAILED',
                    'OIDC provider credentials are unavailable.'
                );

            }

            const discoveryOptionsData = /** @type {Record<string, any>} */ ({});
            const issuerUrlData = new URL( providerData.issuer );

            //Allowing plaintext discovery only for the loopback URL accepted by configuration
            if ( issuerUrlData.protocol === String( 'http:' ) ){
                discoveryOptionsData.execute = [clientData.allowInsecureRequests];

            }

            return clientData.discovery(
                issuerUrlData,
                providerData.clientId,
                {
                    redirect_uris: [providerData.redirectUri],
                    response_types: ['code']
                },
                clientData.ClientSecretBasic( clientSecretData ),
                discoveryOptionsData
            );

        })();
        providerConfigurationPromisesData.set( providerData.id, configurationPromiseData );

        try {
            return await configurationPromiseData;

        } catch( discoveryErrorData ){
            //Allowing a later request to recover after a transient provider outage
            providerConfigurationPromisesData.delete( providerData.id );

            if ( discoveryErrorData instanceof LayerAuthError ){
                throw discoveryErrorData;

            }

            throw new LayerAuthError(
                'AUTH_OIDC_UPSTREAM_FAILED',
                'OIDC provider discovery failed.',
                null,
                discoveryErrorData
            );

        }

    };

    /** @param {URL} callbackUrlData @param {string} redirectUriData */
    //Function for proving that the browser callback belongs to the exact configured redirect URI
    const callbackUrlCheckData = function( callbackUrlData, redirectUriData ){
        //Parsing the trusted configured URI before comparing the browser callback
        const expectedUrlData = new URL( redirectUriData );

        if (
            callbackUrlData.origin !== expectedUrlData.origin ||
            callbackUrlData.pathname !== expectedUrlData.pathname ||
            callbackUrlData.username !== String() ||
            callbackUrlData.password !== String() ||
            callbackUrlData.hash !== String()
        ){
            throw new LayerAuthError( 'AUTH_OIDC_STATE_INVALID', 'OIDC callback URL is invalid.' );

        }

    };

    /** @param {Readonly<Record<string, any>>} claimsData */
    //Function for retaining only bounded identity claims needed by Layer
    const safeClaimsCreateData = function( claimsData ){
        const safeClaimsData = /** @type {Record<string, string | boolean>} */ ({
            sub: String( claimsData.sub )
        });

        if ( typeof claimsData.email === String( 'string' ) ){
            safeClaimsData.email = String( claimsData.email ).slice( Number( 0 ), Number( 320 ) );

        }

        if ( claimsData.email_verified === true ){
            safeClaimsData.email_verified = true;

        }

        if ( typeof claimsData.name === String( 'string' ) ){
            safeClaimsData.name = String( claimsData.name ).slice( Number( 0 ), Number( 256 ) );

        }

        if ( typeof claimsData.preferred_username === String( 'string' ) ){
            safeClaimsData.preferred_username = String( claimsData.preferred_username ).slice( Number( 0 ), Number( 128 ) );

        }

        //CallBack THE OBJECT
        return Object.freeze( safeClaimsData );

    };

    /**
     * @param {Readonly<Record<string, any>>} providerData
     * @param {Readonly<Record<string, any>>} claimsData
     */
    //Function for resolving or safely provisioning one Layer identity
    const layerIdentityResolveData = async function( providerData, claimsData ){
        const existingExternalIdentityData = await serviceOptions.externalIdentities.find(
            providerData.id,
            claimsData.sub
        );

        if ( existingExternalIdentityData !== null ){
            if ( existingExternalIdentityData.status !== String( 'active' ) ){
                throw new LayerAuthError( 'AUTH_CREDENTIALS_INVALID', 'External identity is not active.' );

            }

            return String( existingExternalIdentityData.userId );

        }

        //Never creating or linking an account without an explicitly open policy and verified email
        if ( serviceOptions.configuration.registration.mode !== String( 'open' ) ){
            throw new LayerAuthError( 'AUTH_REGISTRATION_DISABLED', 'Registration is not available.' );

        }

        if ( claimsData.email_verified !== true || typeof claimsData.email !== String( 'string' ) ){
            throw new LayerAuthError(
                'AUTH_OIDC_IDENTITY_UNAVAILABLE',
                'OIDC provider did not return a verified email identity.'
            );

        }

        const identifierData = layerAuthIdentifierCreate(
            claimsData.email,
            serviceOptions.configuration.identifiers
        );
        const matchingIdentityData = await serviceOptions.users.findByIdentifier(
            identifierData.type,
            identifierData.normalized
        );

        //Preventing provider email coincidence from becoming an account-link takeover
        if ( matchingIdentityData !== null ){
            throw new LayerAuthError(
                'AUTH_OIDC_LINK_REQUIRED',
                'Sign in to the existing account before linking this provider.'
            );

        }

        const safeClaimsData = safeClaimsCreateData( claimsData );

        try {
            const createdIdentityData = await serviceOptions.users.create({
                status: 'active',
                identifier: {
                    ...identifierData,
                    verified: true
                },
                password: null,
                async afterCreate( /** @type {{userId: string}} */ createdData, /** @type {any} */ databaseData ){
                    //Linking the verified external subject in the same registration transaction
                    await serviceOptions.externalIdentities.create({
                        providerId: providerData.id,
                        subject: claimsData.sub,
                        userId: createdData.userId,
                        claims: safeClaimsData,
                        database: databaseData
                    });

                }
            });

            return String( createdIdentityData.userId );

        } catch( identityCreateErrorData ){
            //Recovering safely from a concurrent first sign-in without email auto-linking
            const concurrentExternalIdentityData = await serviceOptions.externalIdentities.find(
                providerData.id,
                claimsData.sub
            );

            if (
                concurrentExternalIdentityData !== null &&
                concurrentExternalIdentityData.status === String( 'active' )
            ){
                return String( concurrentExternalIdentityData.userId );

            }

            const concurrentEmailIdentityData = await serviceOptions.users.findByIdentifier(
                identifierData.type,
                identifierData.normalized
            );

            if ( concurrentEmailIdentityData !== null ){
                throw new LayerAuthError(
                    'AUTH_OIDC_LINK_REQUIRED',
                    'Sign in to the existing account before linking this provider.',
                    null,
                    identityCreateErrorData
                );

            }

            throw identityCreateErrorData;

        }

    };

    return Object.freeze({
        providers(){
            //Returning only stable provider identifiers to the browser API
            return Object.freeze(serviceOptions.configuration.oidc.map(function providerIdentifierMap( /** @type {any} */ providerData ){
                //Removing provider secrets and endpoints from the browser-visible list
                return String( providerData.id );

            }));

        },

        /**
         * @param {{providerId: string, returnTo?: string}} beginData
         */
        async begin( beginData ){
            const providerData = providerGetData( beginData?.providerId );
            const returnToData = returnToCreate( beginData?.returnTo );
            const clientConfigurationData = await clientConfigurationGetData( providerData );
            const codeVerifierData = clientData.randomPKCECodeVerifier();
            const codeChallengeData = await clientData.calculatePKCECodeChallenge( codeVerifierData );
            const stateData = clientData.randomState();
            const nonceData = clientData.randomNonce();
            const expiresAtData = Number( clockData() ) + Number( oidcChallengeLifetimeData );
            const encryptedStateData = serviceOptions.envelope.seal({
                providerId: providerData.id,
                codeVerifier: codeVerifierData,
                nonce: nonceData,
                returnTo: returnToData
            }, oidcStateEnvelopePurposeData );

            await serviceOptions.challenges.create({
                type: oidcChallengeTypeData,
                subject: `${String( providerData.id )}:${String( stateData )}`,
                token: stateData,
                payload: Object.freeze({envelope: encryptedStateData.toString( 'base64url' )}),
                attempts: Number( 1 ),
                expiresAt: expiresAtData
            });

            const authorizationUrlData = clientData.buildAuthorizationUrl( clientConfigurationData, {
                redirect_uri: providerData.redirectUri,
                scope: providerData.scopes.join( ' ' ),
                response_type: 'code',
                code_challenge: codeChallengeData,
                code_challenge_method: 'S256',
                state: stateData,
                nonce: nonceData
            });

            //CallBack THE OBJECT
            return Object.freeze({
                providerId: String( providerData.id ),
                authorizationUrl: String( authorizationUrlData ),
                expiresAt: Number( expiresAtData )
            });

        },

        /**
         * @param {{callbackUrl: string, remember?: boolean}} completeData
         */
        async complete( completeData ){
            if (
                typeof completeData?.callbackUrl !== String( 'string' ) ||
                Number( completeData.callbackUrl.length ) < Number( 1 ) ||
                Number( completeData.callbackUrl.length ) > Number( 4096 )
            ){
                throw new LayerAuthError( 'AUTH_OIDC_STATE_INVALID', 'OIDC callback URL is invalid.' );

            }

            /** @type {URL} */
            let callbackUrlData;

            try {
                callbackUrlData = new URL( completeData.callbackUrl );

            } catch( callbackUrlErrorData ){
                throw new LayerAuthError(
                    'AUTH_OIDC_STATE_INVALID',
                    'OIDC callback URL is invalid.',
                    null,
                    callbackUrlErrorData
                );

            }

            const stateData = callbackUrlData.searchParams.get( 'state' );

            if ( stateData === null || Number( stateData.length ) < Number( 20 ) || Number( stateData.length ) > Number( 512 ) ){
                throw new LayerAuthError( 'AUTH_OIDC_STATE_INVALID', 'OIDC state is invalid or expired.' );

            }

            const challengeData = await serviceOptions.challenges.consume({
                type: oidcChallengeTypeData,
                token: stateData
            });

            if ( challengeData === null || typeof challengeData.payload?.envelope !== String( 'string' ) ){
                throw new LayerAuthError( 'AUTH_OIDC_STATE_INVALID', 'OIDC state is invalid or expired.' );

            }

            const statePayloadData = serviceOptions.envelope.open(
                Buffer.from( challengeData.payload.envelope, 'base64url' ),
                oidcStateEnvelopePurposeData
            );

            if (
                statePayloadData === null ||
                typeof statePayloadData !== String( 'object' ) ||
                typeof statePayloadData.providerId !== String( 'string' ) ||
                typeof statePayloadData.codeVerifier !== String( 'string' ) ||
                typeof statePayloadData.nonce !== String( 'string' ) ||
                typeof statePayloadData.returnTo !== String( 'string' )
            ){
                throw new LayerAuthError( 'AUTH_OIDC_STATE_INVALID', 'OIDC state is invalid or expired.' );

            }

            const providerData = providerGetData( statePayloadData.providerId );
            callbackUrlCheckData( callbackUrlData, providerData.redirectUri );
            const clientConfigurationData = await clientConfigurationGetData( providerData );
            /** @type {any} */
            let tokenResultData;

            try {
                tokenResultData = await clientData.authorizationCodeGrant(
                    clientConfigurationData,
                    callbackUrlData,
                    {
                        pkceCodeVerifier: statePayloadData.codeVerifier,
                        expectedState: stateData,
                        expectedNonce: statePayloadData.nonce,
                        idTokenExpected: true
                    }
                );

            } catch( tokenExchangeErrorData ){
                throw new LayerAuthError(
                    'AUTH_OIDC_UPSTREAM_FAILED',
                    'OIDC authorization response could not be verified.',
                    null,
                    tokenExchangeErrorData
                );

            }

            const claimsData = tokenResultData.claims();

            if (
                claimsData === undefined ||
                claimsData === null ||
                typeof claimsData.sub !== String( 'string' ) ||
                Number( claimsData.sub.length ) < Number( 1 ) ||
                Number( claimsData.sub.length ) > Number( 512 )
            ){
                throw new LayerAuthError(
                    'AUTH_OIDC_IDENTITY_UNAVAILABLE',
                    'OIDC provider did not return a valid subject.'
                );

            }

            const userIdentifierData = await layerIdentityResolveData( providerData, claimsData );
            const sessionData = await serviceOptions.sessionIssue(
                userIdentifierData,
                completeData.remember === true,
                ['oidc', `oidc:${String( providerData.id )}`]
            );

            //CallBack THE OBJECT
            return Object.freeze({
                userId: String( userIdentifierData ),
                returnTo: String( statePayloadData.returnTo ),
                session: sessionData
            });

        }
    });

}
