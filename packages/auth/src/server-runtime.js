import {layerAuthenticationCreate} from '@solcorp/layer-security';
import {layerAuthOperationDefinitionsCreate} from './operations.js';
import {layerAuthPhoneOperationDefinitionsCreate} from './phone-operations.js';
import {layerAuthServiceCreate} from './auth-service.js';
import {layerAuthContextExtensionCreate} from './context.js';
import {layerAuthOAuthProviderCreate} from './oauth-provider.js';
import {
    layerAuthAccountLifecycleCreate,
    layerAuthRoleServiceCreate
} from './lifecycle.js';


/**
 * Creates the application-facing Auth runtime from Layer-owned repositories.
 * The application supplies its public origins and optional authorization hook;
 * raw database adapters and credential hashes remain private.
 *
 * @param {{
 *     configuration: Readonly<Record<string, any>>,
 *     users: any,
 *     sessions: any,
 *     challenges?: any,
 *     mailQueue?: any,
 *     mailDelivery?: any,
 *     phoneChallenge?: {start: Function, consume: Function} | null,
 *     passkeys?: any,
 *     totp?: any,
 *     externalIdentities?: any,
 *     invitations?: any,
 *     secretEnvelope?: {seal: Function, open: Function},
 *     oauthAdapter?: Function,
 *     oauthSecret?: string,
 *     oauthJwks?: {keys: readonly Record<string, any>[]},
 *     oauthEnvironment?: Record<string, string | undefined>,
 *     oauthInteractionHandler?: Function,
 *     auditTrail?: {record: Function},
 *     rateLimiter?: {consume: Function},
 *     oidcClient?: any,
 *     roles?: any,
 *     apiKeys?: any,
 *     allowedOrigins: readonly string[],
 *     secureCookies?: boolean,
 *     authorizationResolve?: Function | null,
 *     bearerResolve?: Function,
 *     apiKeyResolve?: Function,
 *     clock?: () => number,
 *     dummyPasswordHash?: string
 * }} runtimeOptions
 */
export function layerAuthServerRuntimeCreate( runtimeOptions ){
    //Checking public origin and cookie policy before constructing resolvers
    if (
        runtimeOptions === null ||
        typeof runtimeOptions !== String( 'object' ) ||
        runtimeOptions.configuration?.enabled !== true ||
        Array.isArray( runtimeOptions.allowedOrigins ) === false ||
        Number( runtimeOptions.allowedOrigins.length ) < Number( 1 )
    ){
        throw new TypeError( 'Layer Auth server runtime requires enabled configuration and allowed origins.' );

    }

    const secureCookiesStatusData = runtimeOptions.secureCookies ?? true;

    //Requiring durable activity support instead of silently reverting to fixed idle expiry.
    if ( typeof runtimeOptions.sessions?.touch !== 'function' ){
        throw new TypeError( 'Layer Auth session repository requires touch for verified session activity.' );

    }

    if ( typeof secureCookiesStatusData !== String( 'boolean' ) ){
        throw new TypeError( 'secureCookies must be a boolean.' );

    }

    //Applying the application hook without mutating the normalized configuration
    const authorizationResolveData = runtimeOptions.authorizationResolve ?? runtimeOptions.configuration.authorizationResolve ?? null;
    const serviceConfigurationData = Object.freeze({
        ...runtimeOptions.configuration,
        authorizationResolve: authorizationResolveData
    });
    const serviceOptionsData = /** @type {Record<string, any>} */ ({
        configuration: serviceConfigurationData,
        users: runtimeOptions.users,
        sessions: runtimeOptions.sessions,
        challenges: runtimeOptions.challenges,
        mailQueue: runtimeOptions.mailQueue,
        passkeys: runtimeOptions.passkeys,
        totp: runtimeOptions.totp,
        externalIdentities: runtimeOptions.externalIdentities,
        invitations: runtimeOptions.invitations,
        roles: runtimeOptions.roles,
        secretEnvelope: runtimeOptions.secretEnvelope
    });

    if ( runtimeOptions.oauthEnvironment !== undefined ){
        serviceOptionsData.oidcEnvironment = runtimeOptions.oauthEnvironment;

    }

    if ( runtimeOptions.oidcClient !== undefined ){
        serviceOptionsData.oidcClient = runtimeOptions.oidcClient;

    }

    if ( runtimeOptions.clock !== undefined ){
        serviceOptionsData.clock = runtimeOptions.clock;

    }

    if ( runtimeOptions.dummyPasswordHash !== undefined ){
        serviceOptionsData.dummyPasswordHash = runtimeOptions.dummyPasswordHash;

    }

    const serviceData = layerAuthServiceCreate( /** @type {any} */ (serviceOptionsData) );
    const operationOptionsData = /** @type {Record<string, any>} */ ({service: serviceData});

    if ( runtimeOptions.clock !== undefined ){
        operationOptionsData.clock = runtimeOptions.clock;

    }

    const operationDefinitionsData = [...layerAuthOperationDefinitionsCreate( /** @type {any} */ (operationOptionsData) )];

    //Registering phone commands only when an application provides challenge handling.
    if ( runtimeOptions.phoneChallenge !== undefined && runtimeOptions.phoneChallenge !== null ){
        operationDefinitionsData.push(...layerAuthPhoneOperationDefinitionsCreate({
            challenge: runtimeOptions.phoneChallenge,
            service: serviceData,
            clock: runtimeOptions.clock ?? Date.now
        }));

    }
    let sessionCookieNameData = 'layer_session';

    //Using the host-only cookie prefix whenever the configured origin is secure
    if ( secureCookiesStatusData === true ){
        sessionCookieNameData = '__Host-layer_session';

    }

    const authenticationOptionsData = /** @type {Record<string, any>} */ ({
        allowedOrigins: Object.freeze([...runtimeOptions.allowedOrigins]),
        sessionCookieName: sessionCookieNameData,
        sessionResolve: runtimeOptions.sessions.resolve.bind( runtimeOptions.sessions ),
        sessionTouch( /** @type {string} */ sessionTokenData ){
            //Delegating the issued policy and expiry checks to the primary system database.
            return runtimeOptions.sessions.touch( sessionTokenData, runtimeOptions.configuration.session.touchIntervalMs );

        }
    });

    if ( runtimeOptions.clock !== undefined ){
        authenticationOptionsData.clock = runtimeOptions.clock;

    }

    if ( runtimeOptions.apiKeyResolve !== undefined ){
        authenticationOptionsData.apiKeyResolve = runtimeOptions.apiKeyResolve;

    }

    let oauthProviderData = null;

    //Creating standard OAuth interoperability routes only when configured
    if ( (runtimeOptions.configuration.oauth ?? null) !== null ){
        if (
            typeof runtimeOptions.oauthAdapter !== String( 'function' ) ||
            typeof runtimeOptions.oauthSecret !== String( 'string' ) ||
            Array.isArray( runtimeOptions.oauthJwks?.keys ) === false
        ){
            throw new TypeError( 'Layer Auth OAuth configuration requires a durable adapter and server secret.' );

        }

        const oauthProviderOptionsData = /** @type {Record<string, any>} */ ({
            configuration: runtimeOptions.configuration,
            adapter: /** @type {Function} */ (runtimeOptions.oauthAdapter),
            users: runtimeOptions.users,
            authorizationResolve: serviceData.authorization.resolve,
            secret: String( runtimeOptions.oauthSecret ),
            jwks: runtimeOptions.oauthJwks,
            auditTrail: runtimeOptions.auditTrail,
            rateLimiter: runtimeOptions.rateLimiter
        });

        if ( runtimeOptions.oauthEnvironment !== undefined ){
            oauthProviderOptionsData.environment = runtimeOptions.oauthEnvironment;

        }

        if ( runtimeOptions.oauthInteractionHandler !== undefined ){
            oauthProviderOptionsData.interactionHandler = runtimeOptions.oauthInteractionHandler;

        }

        oauthProviderData = layerAuthOAuthProviderCreate( /** @type {any} */ (oauthProviderOptionsData) );

    }
    const externalBearerResolveData = runtimeOptions.bearerResolve;

    if ( oauthProviderData !== null && externalBearerResolveData !== undefined ){
        const embeddedOauthProviderData = oauthProviderData;
        authenticationOptionsData.bearerResolve = async function authBearerResolve(
            /** @type {string} */ tokenData,
            /** @type {Readonly<Record<string, any>>} */ requestContextData
        ){
            //Trying the embedded provider before delegating to external bearer resolution
            const oauthIdentityData = await embeddedOauthProviderData.accessTokenResolve(
                tokenData,
                requestContextData
            );

            if ( oauthIdentityData !== null ){
                return oauthIdentityData;

            }

            return externalBearerResolveData( tokenData, requestContextData );

        };

    } else if ( oauthProviderData !== null ){
        authenticationOptionsData.bearerResolve = oauthProviderData.accessTokenResolve;

    } else if ( externalBearerResolveData !== undefined ){
        authenticationOptionsData.bearerResolve = externalBearerResolveData;

    }

    const securityData = layerAuthenticationCreate( authenticationOptionsData );
    const accountsData = layerAuthAccountLifecycleCreate({
        configuration: serviceConfigurationData,
        users: runtimeOptions.users,
        sessions: runtimeOptions.sessions,
        oauth: oauthProviderData,
        apiKeys: runtimeOptions.apiKeys ?? null
    });
    let rolesData = null;

    if ( runtimeOptions.roles !== null && runtimeOptions.roles !== undefined ){
        rolesData = layerAuthRoleServiceCreate({
            roles: runtimeOptions.roles,
            accounts: accountsData
        });

    }
    const contextExtendData = layerAuthContextExtensionCreate({
        sessions: runtimeOptions.sessions,
        dataMaximumBytes: runtimeOptions.configuration.session.dataMaximumBytes,
        authorizationInvalidate: accountsData.invalidate
    });
    const httpRequestHandlersData = /** @type {Function[]} */ ([]);

    if ( oauthProviderData !== null ){
        httpRequestHandlersData.push( oauthProviderData.requestHandle );

    }

    const mailDeliveryData = runtimeOptions.mailDelivery ?? null;
    let startedStatusData = false;

    //Checking the optional SMTP lifecycle selected by the normalized configuration
    if (
        (runtimeOptions.configuration.smtp ?? null) !== null &&
        (
            typeof mailDeliveryData?.start !== String( 'function' ) ||
            typeof mailDeliveryData?.stop !== String( 'function' )
        )
    ){
        throw new TypeError( 'Layer Auth SMTP configuration requires a mail delivery lifecycle.' );

    }

    //CallBack THE OBJECT
    return Object.freeze({
        enabled: true,
        operations: operationDefinitionsData,
        security: securityData,
        service: serviceData,
        contextExtend: contextExtendData,
        roles: rolesData,
        accounts: accountsData,
        audit: runtimeOptions.auditTrail ?? null,
        oauth: oauthProviderData,
        http: Object.freeze({
            requestHandlers: Object.freeze( httpRequestHandlersData )
        }),

        async start(){
            //Starting durable mail polling only after database migrations are ready
            if ( startedStatusData === true ){
                return;

            }

            await mailDeliveryData?.start();
            startedStatusData = true;

        },

        async stop(){
            //Stopping delivery idempotently during application drain
            if ( startedStatusData === false ){
                return;

            }

            startedStatusData = false;
            await mailDeliveryData?.stop();

        },

        /**
         * @param {{define: (operationData: any) => unknown, list?: () => readonly any[]}} operationRegistryData
         */
        register( operationRegistryData ){
            //Checking the registry before adding engine-owned definitions
            if ( typeof operationRegistryData?.define !== String( 'function' ) ){
                throw new TypeError( 'Layer Auth register requires an operation registry.' );

            }

            if ( oauthProviderData !== null ){
                const operationRegistryListData = operationRegistryData.list;

                if ( typeof operationRegistryListData !== 'function' ){
                    throw new TypeError( 'Layer Auth OAuth registration requires operation inspection.' );

                }

                //Binding every custom OAuth scope to an existing application permission
                /** @type {any} */ (oauthProviderData).scopesValidate( operationRegistryListData() );

            }

            const inspectionData = [];

            //Registering each immutable definition before the application seals the registry
            for ( const operationData of operationDefinitionsData ){
                const operationInspectionData = operationRegistryData.define( operationData );
                inspectionData.push( operationInspectionData );

            }

            //CallBack THE OBJECT
            return Object.freeze( inspectionData );

        }
    });

}
