import {
    LAYER_ERROR_CODES,
    LayerError
} from '@solcorp/layer-protocol';
import {layerSystemOperationCreate} from '@solcorp/layer-server/system';
import {LayerAuthError} from './auth-error.js';


const emptyObjectSchemaData = Object.freeze({
    type: 'object',
    additionalProperties: false
});


/** @param {unknown} errorData @returns {never} */
//Function for passing one safe external OIDC failure to the public protocol
const oidcOperationErrorPass = function( errorData ){
    if ( errorData instanceof LayerError ){
        throw errorData;

    }

    if ( errorData instanceof LayerAuthError ){
        const publicErrorCodesData = /** @type {Set<string>} */ (new Set( Object.values( LAYER_ERROR_CODES ) ));

        if ( publicErrorCodesData.has( errorData.code ) === false ){
            throw new LayerError(
                LAYER_ERROR_CODES.INTERNAL_ERROR,
                'An internal error occurred.',
                {cause: errorData, status: 500}
            );

        }

        let publicStatusData = Number( 400 );

        if ( errorData.code === String( LAYER_ERROR_CODES.AUTH_CREDENTIALS_INVALID ) ){
            publicStatusData = Number( 401 );

        } else if (
            errorData.code === String( LAYER_ERROR_CODES.AUTH_OIDC_IDENTITY_UNAVAILABLE ) ||
            errorData.code === String( LAYER_ERROR_CODES.AUTH_REGISTRATION_DISABLED )
        ){
            publicStatusData = Number( 403 );

        } else if ( errorData.code === String( LAYER_ERROR_CODES.AUTH_OIDC_LINK_REQUIRED ) ){
            publicStatusData = Number( 409 );

        } else if ( errorData.code === String( LAYER_ERROR_CODES.AUTH_OIDC_UPSTREAM_FAILED ) ){
            publicStatusData = Number( 502 );

        }

        throw new LayerError(
            errorData.code,
            errorData.message,
            {
                cause: errorData,
                details: errorData.details,
                status: publicStatusData
            }
        );

    }

    throw errorData;

};

/** @param {unknown} contextData */
//Function for getting the trusted response-effect boundary
const responseEffectsGet = function( contextData ){
    if ( contextData === null || typeof contextData !== String( 'object' ) || Array.isArray( contextData ) === true ){
        throw new TypeError( 'Layer Auth OIDC operation context is unavailable.' );

    }

    const responseData = /** @type {Record<string, any>} */ (contextData).response;

    if ( responseData === undefined || typeof responseData.authSessionSet !== String( 'function' ) ){
        throw new TypeError( 'Layer Auth OIDC session response capability is unavailable.' );

    }

    return responseData;

};

/**
 * Creates the external OIDC browser operations. The upstream redirect remains
 * GET-based, while Layer state creation and callback completion use POST /api.
 *
 * @param {{service: {providers: Function, begin: Function, complete: Function}, clock?: () => number}} operationOptions
 */
export function layerAuthOidcOperationDefinitionsCreate( operationOptions ){
    if (
        operationOptions === null ||
        typeof operationOptions !== String( 'object' ) ||
        typeof operationOptions.service?.providers !== String( 'function' ) ||
        typeof operationOptions.service?.begin !== String( 'function' ) ||
        typeof operationOptions.service?.complete !== String( 'function' )
    ){
        throw new TypeError( 'Layer Auth OIDC operations require the complete OIDC service.' );

    }

    const clockData = operationOptions.clock ?? Date.now;
    const providerIdentifierSchemaData = Object.freeze({
        type: 'string',
        pattern: '^[a-z][a-z0-9-]{1,63}$'
    });
    const providersOperationData = layerSystemOperationCreate({
        name: 'auth.oidc.providers.list',
        type: 'query',
        auth: 'none',
        inputSchema: emptyObjectSchemaData,
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['providers'],
            properties: {
                providers: {
                    type: 'array',
                    maxItems: 20,
                    uniqueItems: true,
                    items: providerIdentifierSchemaData
                }
            }
        },
        rateLimitBucket: 'auth.oidc.providers.list',
        cost: 1,
        timeoutMs: 5000,
        concurrency: 128,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: false, category: 'auth.oidc'},
        async handler(){
            //Returning only configured public provider identifiers
            return Object.freeze({providers: operationOptions.service.providers()});

        }
    });
    const beginOperationData = layerSystemOperationCreate({
        name: 'auth.oidc.begin',
        type: 'command',
        auth: 'none',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['providerId'],
            properties: {
                providerId: providerIdentifierSchemaData,
                returnTo: {type: 'string', minLength: 1, maxLength: 1024}
            }
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['authorizationUrl', 'expiresAt', 'providerId'],
            properties: {
                providerId: providerIdentifierSchemaData,
                authorizationUrl: {type: 'string', format: 'uri', maxLength: 4096},
                expiresAt: {type: 'integer', minimum: 0}
            }
        },
        rateLimitBucket: 'auth.oidc.begin',
        cost: 5,
        timeoutMs: 15000,
        concurrency: 16,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.oidc'},
        async handler( /** @type {any} */ payloadData ){
            //Starting the provider flow while translating adapter failures to public Auth errors
            try {
                return await operationOptions.service.begin( payloadData );

            } catch( errorData ){
                return oidcOperationErrorPass( errorData );

            }

        }
    });
    const completeOperationData = layerSystemOperationCreate({
        name: 'auth.oidc.complete',
        type: 'command',
        auth: 'none',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['callbackUrl'],
            properties: {
                callbackUrl: {type: 'string', format: 'uri', minLength: 1, maxLength: 4096},
                remember: {type: 'boolean'}
            }
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['returnTo', 'session', 'user'],
            properties: {
                returnTo: {type: 'string', minLength: 1, maxLength: 1024},
                user: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['id'],
                    properties: {id: {type: 'string', minLength: 8, maxLength: 128}}
                },
                session: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['absoluteExpiresAt', 'id', 'idleExpiresAt'],
                    properties: {
                        id: {type: 'string', minLength: 8, maxLength: 128},
                        idleExpiresAt: {type: 'integer', minimum: 0},
                        absoluteExpiresAt: {type: 'integer', minimum: 0}
                    }
                }
            }
        },
        rateLimitBucket: 'auth.oidc.complete',
        cost: 10,
        timeoutMs: 20000,
        concurrency: 16,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.oidc'},
        async handler( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
            try {
                const responseData = responseEffectsGet( contextData );
                const completeResultData = await operationOptions.service.complete( payloadData );
                const sessionData = completeResultData.session;
                const maximumAgeSecondsData = Math.max(
                    Number( 1 ),
                    Math.floor(
                        (Number( sessionData.absoluteExpiresAt ) - Number( clockData() )) / Number( 1000 )
                    )
                );

                //Writing the opaque managed session only after upstream verification
                responseData.authSessionSet({
                    sessionToken: String( sessionData.sessionToken ),
                    csrfToken: String( sessionData.csrfToken ),
                    maximumAgeSeconds: Number( maximumAgeSecondsData )
                });

                //CallBack THE OBJECT
                return Object.freeze({
                    returnTo: String( completeResultData.returnTo ),
                    user: Object.freeze({id: String( completeResultData.userId )}),
                    session: Object.freeze({
                        id: String( sessionData.sessionId ),
                        idleExpiresAt: Number( sessionData.idleExpiresAt ),
                        absoluteExpiresAt: Number( sessionData.absoluteExpiresAt )
                    })
                });

            } catch( errorData ){
                return oidcOperationErrorPass( errorData );

            }

        }
    });

    //CallBack THE OBJECT
    return Object.freeze([
        providersOperationData,
        beginOperationData,
        completeOperationData
    ]);

}
