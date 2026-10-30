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
const credentialResponseFieldsData = Object.freeze({
    id: {type: 'string', minLength: 8, maxLength: 2048},
    rawId: {type: 'string', minLength: 8, maxLength: 2048},
    type: {const: 'public-key'},
    authenticatorAttachment: {
        type: ['string', 'null'],
        enum: ['cross-platform', 'platform', null]
    },
    clientExtensionResults: {
        type: 'object',
        maxProperties: 32,
        additionalProperties: true
    }
});
const registrationResponseSchemaData = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['clientExtensionResults', 'id', 'rawId', 'response', 'type'],
    properties: {
        ...credentialResponseFieldsData,
        response: {
            type: 'object',
            additionalProperties: false,
            required: ['attestationObject', 'clientDataJSON'],
            properties: {
                attestationObject: {type: 'string', minLength: 8, maxLength: 65536},
                clientDataJSON: {type: 'string', minLength: 8, maxLength: 16384},
                transports: {
                    type: 'array',
                    maxItems: 8,
                    uniqueItems: true,
                    items: {type: 'string', maxLength: 32}
                },
                publicKeyAlgorithm: {type: 'integer'},
                publicKey: {type: ['string', 'null'], maxLength: 65536},
                authenticatorData: {type: ['string', 'null'], maxLength: 65536}
            }
        }
    }
});
const authenticationResponseSchemaData = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['clientExtensionResults', 'id', 'rawId', 'response', 'type'],
    properties: {
        ...credentialResponseFieldsData,
        response: {
            type: 'object',
            additionalProperties: false,
            required: ['authenticatorData', 'clientDataJSON', 'signature'],
            properties: {
                authenticatorData: {type: 'string', minLength: 8, maxLength: 65536},
                clientDataJSON: {type: 'string', minLength: 8, maxLength: 16384},
                signature: {type: 'string', minLength: 8, maxLength: 65536},
                userHandle: {type: ['string', 'null'], maxLength: 2048}
            }
        }
    }
});


/** @param {unknown} errorData @returns {never} */
//Function for converting Passkey adapter failures into public protocol errors
const passkeyOperationErrorPass = function( errorData ){
    if ( errorData instanceof LayerError ){
        throw errorData;

    }

    if ( errorData instanceof LayerAuthError ){
        const publicErrorCodesData = /** @type {Set<string>} */ (new Set([
            LAYER_ERROR_CODES.AUTH_PASSKEY_INVALID,
            LAYER_ERROR_CODES.AUTH_PASSKEY_REPLAY,
            LAYER_ERROR_CODES.AUTH_PASSKEY_UNAVAILABLE
        ]));

        if ( publicErrorCodesData.has( errorData.code ) === true ){
            let statusData = Number( 400 );

            if ( errorData.code === LAYER_ERROR_CODES.AUTH_PASSKEY_REPLAY ){
                statusData = Number( 409 );

            } else if ( errorData.code === LAYER_ERROR_CODES.AUTH_PASSKEY_UNAVAILABLE ){
                statusData = Number( 403 );

            }

            throw new LayerError( errorData.code, errorData.message, {
                cause: errorData,
                status: statusData
            });

        }

    }

    throw errorData;

};

/** @param {unknown} contextData */
//Function for reading a server-derived managed-session identity
const passkeyAuthenticatedContextGet = function( contextData ){
    if ( contextData === null || typeof contextData !== String( 'object' ) || Array.isArray( contextData ) === true ){
        throw new LayerError( LAYER_ERROR_CODES.AUTH_REQUIRED, 'Authentication is required.', {status: 401});

    }

    const contextRecordData = /** @type {Record<string, any>} */ (contextData);
    const userIdentifierData = contextRecordData.security?.userId;

    if ( typeof userIdentifierData !== 'string' || Number( userIdentifierData.length ) < Number( 1 ) ){
        throw new LayerError( LAYER_ERROR_CODES.AUTH_REQUIRED, 'Authentication is required.', {status: 401});

    }

    //CallBack THE OBJECT
    return Object.freeze({
        userId: String( userIdentifierData ),
        response: contextRecordData.response
    });

};

/**
 * Creates optional Passkey operations when the WebAuthn adapter is enabled.
 *
 * @param {{service: any, clock?: () => number}} operationOptions
 */
export function layerAuthPasskeyOperationDefinitionsCreate( operationOptions ){
    if (
        operationOptions === null ||
        typeof operationOptions !== String( 'object' ) ||
        typeof operationOptions.service?.registration?.begin !== String( 'function' ) ||
        typeof operationOptions.service?.registration?.complete !== String( 'function' ) ||
        typeof operationOptions.service?.signIn?.begin !== String( 'function' ) ||
        typeof operationOptions.service?.signIn?.complete !== String( 'function' ) ||
        typeof operationOptions.service?.list !== String( 'function' ) ||
        typeof operationOptions.service?.remove !== String( 'function' )
    ){
        throw new TypeError( 'Layer Auth Passkey operations require the complete Passkey service.' );

    }

    const clockData = operationOptions.clock ?? Date.now;
    const optionsOutputSchemaData = {
        type: 'object',
        additionalProperties: false,
        required: ['options'],
        properties: {
            options: {type: 'object', additionalProperties: true}
        }
    };
    const registrationBeginData = layerSystemOperationCreate({
        name: 'auth.passkey.registration.begin',
        type: 'query',
        auth: 'session',
        inputSchema: emptyObjectSchemaData,
        outputSchema: optionsOutputSchemaData,
        rateLimitBucket: 'auth.passkey.registration.begin',
        cost: 5,
        timeoutMs: 10000,
        concurrency: 16,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.passkey'},
        async handler( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
            //Resolving the authenticated user before creating registration options
            void payloadData;
            const authContextData = passkeyAuthenticatedContextGet( contextData );

            try {
                return await operationOptions.service.registration.begin( authContextData.userId );

            } catch( errorData ){
                return passkeyOperationErrorPass( errorData );

            }

        }
    });
    const registrationCompleteData = layerSystemOperationCreate({
        name: 'auth.passkey.registration.complete',
        type: 'command',
        auth: 'session',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['challenge', 'response'],
            properties: {
                challenge: {type: 'string', minLength: 20, maxLength: 512},
                displayName: {type: 'string', minLength: 1, maxLength: 120},
                response: registrationResponseSchemaData
            }
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['passkey', 'registered'],
            properties: {
                registered: {const: true},
                passkey: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['credentialId', 'displayName'],
                    properties: {
                        credentialId: {type: 'string', minLength: 8, maxLength: 2048},
                        displayName: {type: 'string', minLength: 1, maxLength: 120}
                    }
                }
            }
        },
        rateLimitBucket: 'auth.passkey.registration.complete',
        cost: 10,
        timeoutMs: 15000,
        concurrency: 8,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.passkey'},
        async handler( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
            //Resolving the authenticated user before verifying the registration response
            const authContextData = passkeyAuthenticatedContextGet( contextData );

            try {
                return await operationOptions.service.registration.complete( authContextData.userId, payloadData );

            } catch( errorData ){
                return passkeyOperationErrorPass( errorData );

            }

        }
    });
    const signInBeginData = layerSystemOperationCreate({
        name: 'auth.passkey.signin.begin',
        type: 'query',
        auth: 'none',
        inputSchema: emptyObjectSchemaData,
        outputSchema: optionsOutputSchemaData,
        rateLimitBucket: 'auth.passkey.signin.begin',
        cost: 5,
        timeoutMs: 10000,
        concurrency: 32,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: false, category: 'auth.passkey'},
        async handler(){
            //Creating bounded authentication options without revealing registered users
            try {
                return await operationOptions.service.signIn.begin();

            } catch( errorData ){
                return passkeyOperationErrorPass( errorData );

            }

        }
    });
    const signInCompleteData = layerSystemOperationCreate({
        name: 'auth.passkey.signin.complete',
        type: 'command',
        auth: 'none',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['challenge', 'response'],
            properties: {
                challenge: {type: 'string', minLength: 20, maxLength: 512},
                remember: {type: 'boolean'},
                response: authenticationResponseSchemaData
            }
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['session', 'user'],
            properties: {
                user: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['id'],
                    properties: {id: {type: 'string', minLength: 1, maxLength: 128}}
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
        rateLimitBucket: 'auth.passkey.signin.complete',
        cost: 12,
        timeoutMs: 15000,
        concurrency: 16,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.sign-in'},
        async handler( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
            try {
                const signInResultData = await operationOptions.service.signIn.complete( payloadData );
                const responseData = contextData?.response;

                if ( typeof responseData?.authSessionSet !== String( 'function' ) ){
                    throw new TypeError( 'Layer Auth session response capability is unavailable.' );

                }

                const sessionData = signInResultData.session;
                const maximumAgeSecondsData = Math.max(
                    Number( 1 ),
                    Math.floor((Number( sessionData.absoluteExpiresAt ) - Number( clockData() )) / Number( 1000 ))
                );
                responseData.authSessionSet({
                    sessionToken: String( sessionData.sessionToken ),
                    csrfToken: String( sessionData.csrfToken ),
                    maximumAgeSeconds: Number( maximumAgeSecondsData )
                });

                //CallBack THE OBJECT
                return Object.freeze({
                    user: Object.freeze({id: String( signInResultData.userId )}),
                    session: Object.freeze({
                        id: String( sessionData.sessionId ),
                        idleExpiresAt: Number( sessionData.idleExpiresAt ),
                        absoluteExpiresAt: Number( sessionData.absoluteExpiresAt )
                    })
                });

            } catch( errorData ){
                return passkeyOperationErrorPass( errorData );

            }

        }
    });
    const listData = layerSystemOperationCreate({
        name: 'auth.passkey.list',
        type: 'query',
        auth: 'session',
        inputSchema: emptyObjectSchemaData,
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['passkeys'],
            properties: {
                passkeys: {type: 'array', maxItems: 100, items: {type: 'object', additionalProperties: true}}
            }
        },
        rateLimitBucket: 'auth.passkey.list',
        cost: 1,
        timeoutMs: 10000,
        concurrency: 64,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.passkey'},
        async handler( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
            //Resolving the authenticated user before listing public credential metadata
            void payloadData;
            const authContextData = passkeyAuthenticatedContextGet( contextData );

            try {
                const passkeysData = await operationOptions.service.list( authContextData.userId );
                return Object.freeze({passkeys: passkeysData});

            } catch( errorData ){
                return passkeyOperationErrorPass( errorData );

            }

        }
    });
    const removeData = layerSystemOperationCreate({
        name: 'auth.passkey.remove',
        type: 'command',
        auth: 'session',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['credentialId'],
            properties: {credentialId: {type: 'string', minLength: 8, maxLength: 2048}}
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['removed'],
            properties: {removed: {type: 'boolean'}}
        },
        rateLimitBucket: 'auth.passkey.remove',
        cost: 3,
        timeoutMs: 10000,
        concurrency: 16,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.passkey'},
        async handler( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
            //Resolving the authenticated user before removing one owned credential
            const authContextData = passkeyAuthenticatedContextGet( contextData );

            try {
                const removeStatusData = await operationOptions.service.remove(
                    authContextData.userId,
                    payloadData.credentialId
                );
                return Object.freeze({removed: removeStatusData === true});

            } catch( errorData ){
                return passkeyOperationErrorPass( errorData );

            }

        }
    });

    //CallBack THE OBJECT
    return Object.freeze([
        registrationBeginData,
        registrationCompleteData,
        signInBeginData,
        signInCompleteData,
        listData,
        removeData
    ]);

}
