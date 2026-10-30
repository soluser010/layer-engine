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
const tokenSchemaData = Object.freeze({
    type: 'string',
    pattern: '^\\d{6,8}$'
});
const sessionResultSchemaData = Object.freeze({
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
});


/** @param {unknown} errorData @returns {never} */
//Function for mapping only stable MFA failures to protocol errors
const totpOperationErrorPass = function( errorData ){
    if ( errorData instanceof LayerError ){
        throw errorData;

    }

    if ( errorData instanceof LayerAuthError ){
        const publicErrorCodesData = /** @type {Set<string>} */ (new Set([
            LAYER_ERROR_CODES.AUTH_MFA_INVALID,
            LAYER_ERROR_CODES.AUTH_TOTP_REPLAY,
            LAYER_ERROR_CODES.AUTH_TOTP_UNAVAILABLE
        ]));

        if ( publicErrorCodesData.has( errorData.code ) === true ){
            let statusData = Number( 400 );

            if ( errorData.code === LAYER_ERROR_CODES.AUTH_TOTP_REPLAY ){
                statusData = Number( 409 );

            } else if ( errorData.code === LAYER_ERROR_CODES.AUTH_TOTP_UNAVAILABLE ){
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
//Function for getting the authenticated account and trusted response effect
const totpOperationContextGet = function( contextData ){
    if ( contextData === null || typeof contextData !== String( 'object' ) || Array.isArray( contextData ) === true ){
        throw new LayerError( LAYER_ERROR_CODES.AUTH_REQUIRED, 'Authentication is required.', {status: 401});

    }

    const contextRecordData = /** @type {Record<string, any>} */ (contextData);
    const userIdentifierData = contextRecordData.security?.userId;

    if ( typeof userIdentifierData !== String( 'string' ) || Number( userIdentifierData.length ) < Number( 1 ) ){
        throw new LayerError( LAYER_ERROR_CODES.AUTH_REQUIRED, 'Authentication is required.', {status: 401});

    }

    //CallBack THE OBJECT
    return Object.freeze({
        userId: String( userIdentifierData ),
        response: contextRecordData.response
    });

};

/**
 * Creates optional TOTP and recovery-code operation definitions.
 *
 * @param {{service: any, clock?: () => number}} operationOptions
 */
export function layerAuthTotpOperationDefinitionsCreate( operationOptions ){
    //Checking the complete TOTP service before exposing partial operations
    if (
        operationOptions === null ||
        typeof operationOptions !== String( 'object' ) ||
        typeof operationOptions.service?.isEnabled !== String( 'function' ) ||
        typeof operationOptions.service?.enrollment?.begin !== String( 'function' ) ||
        typeof operationOptions.service?.enrollment?.confirm !== String( 'function' ) ||
        typeof operationOptions.service?.verify !== String( 'function' ) ||
        typeof operationOptions.service?.recoveryCodesRotate !== String( 'function' ) ||
        typeof operationOptions.service?.disable !== String( 'function' )
    ){
        throw new TypeError( 'Layer Auth TOTP operations require the complete MFA service.' );

    }

    const clockData = operationOptions.clock ?? Date.now;
    const stateData = layerSystemOperationCreate({
        name: 'auth.totp.state',
        type: 'query',
        auth: 'session',
        inputSchema: emptyObjectSchemaData,
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['enabled'],
            properties: {enabled: {type: 'boolean'}}
        },
        rateLimitBucket: 'auth.totp.state',
        cost: 1,
        timeoutMs: 10000,
        concurrency: 64,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: false, category: 'auth.totp'},
        async handler( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
            //Resolving the authenticated user before returning MFA capability state
            void payloadData;
            const authContextData = totpOperationContextGet( contextData );

            try {
                const enabledStatusData = await operationOptions.service.isEnabled( authContextData.userId );
                return Object.freeze({enabled: enabledStatusData === true});

            } catch( errorData ){
                return totpOperationErrorPass( errorData );

            }

        }
    });
    const enrollmentBeginData = layerSystemOperationCreate({
        name: 'auth.totp.enrollment.begin',
        type: 'command',
        auth: 'session',
        inputSchema: emptyObjectSchemaData,
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['secret', 'uri'],
            properties: {
                secret: {type: 'string', minLength: 16, maxLength: 128},
                uri: {type: 'string', minLength: 20, maxLength: 2048}
            }
        },
        rateLimitBucket: 'auth.totp.enrollment.begin',
        cost: 5,
        timeoutMs: 10000,
        concurrency: 8,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.totp'},
        async handler( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
            //Resolving the authenticated user before starting enrollment
            void payloadData;
            const authContextData = totpOperationContextGet( contextData );

            try {
                return await operationOptions.service.enrollment.begin( authContextData.userId );

            } catch( errorData ){
                return totpOperationErrorPass( errorData );

            }

        }
    });
    const enrollmentConfirmData = layerSystemOperationCreate({
        name: 'auth.totp.enrollment.confirm',
        type: 'command',
        auth: 'session',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['code'],
            properties: {code: tokenSchemaData}
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['enabled', 'recoveryCodes'],
            properties: {
                enabled: {const: true},
                recoveryCodes: {
                    type: 'array',
                    minItems: 5,
                    maxItems: 20,
                    uniqueItems: true,
                    items: {type: 'string', pattern: '^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$'}
                }
            }
        },
        rateLimitBucket: 'auth.totp.enrollment.confirm',
        cost: 8,
        timeoutMs: 10000,
        concurrency: 8,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.totp'},
        async handler( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
            //Resolving the authenticated user before consuming the enrollment challenge
            const authContextData = totpOperationContextGet( contextData );

            try {
                return await operationOptions.service.enrollment.confirm(
                    authContextData.userId,
                    payloadData.code
                );

            } catch( errorData ){
                return totpOperationErrorPass( errorData );

            }

        }
    });
    const mfaVerifyData = layerSystemOperationCreate({
        name: 'auth.mfa.verify',
        type: 'command',
        auth: 'none',
        inputSchema: {
            oneOf: [{
                type: 'object',
                additionalProperties: false,
                required: ['challenge', 'code'],
                properties: {
                    challenge: {type: 'string', minLength: 20, maxLength: 512},
                    code: tokenSchemaData
                }
            }, {
                type: 'object',
                additionalProperties: false,
                required: ['challenge', 'recoveryCode'],
                properties: {
                    challenge: {type: 'string', minLength: 20, maxLength: 512},
                    recoveryCode: {type: 'string', pattern: '^[A-Za-z2-9]{4}(?:-[A-Za-z2-9]{4}){2}$'}
                }
            }]
        },
        outputSchema: sessionResultSchemaData,
        rateLimitBucket: 'auth.mfa.verify',
        cost: 10,
        timeoutMs: 15000,
        concurrency: 16,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.mfa'},
        async handler( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
            try {
                const verificationResultData = await operationOptions.service.verify( payloadData );
                const responseData = contextData?.response;

                if ( typeof responseData?.authSessionSet !== String( 'function' ) ){
                    throw new TypeError( 'Layer Auth session response capability is unavailable.' );

                }

                const sessionData = verificationResultData.session;
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
                    user: Object.freeze({id: String( verificationResultData.userId )}),
                    session: Object.freeze({
                        id: String( sessionData.sessionId ),
                        idleExpiresAt: Number( sessionData.idleExpiresAt ),
                        absoluteExpiresAt: Number( sessionData.absoluteExpiresAt )
                    })
                });

            } catch( errorData ){
                return totpOperationErrorPass( errorData );

            }

        }
    });
    const recoveryRotateData = layerSystemOperationCreate({
        name: 'auth.totp.recovery.rotate',
        type: 'command',
        auth: 'session',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['code'],
            properties: {code: tokenSchemaData}
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['recoveryCodes'],
            properties: {
                recoveryCodes: {
                    type: 'array',
                    minItems: 5,
                    maxItems: 20,
                    uniqueItems: true,
                    items: {type: 'string', pattern: '^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$'}
                }
            }
        },
        rateLimitBucket: 'auth.totp.recovery.rotate',
        cost: 8,
        timeoutMs: 10000,
        concurrency: 8,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.totp'},
        async handler( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
            //Resolving the authenticated user before replacing recovery codes
            const authContextData = totpOperationContextGet( contextData );

            try {
                return await operationOptions.service.recoveryCodesRotate(
                    authContextData.userId,
                    payloadData.code
                );

            } catch( errorData ){
                return totpOperationErrorPass( errorData );

            }

        }
    });
    const disableData = layerSystemOperationCreate({
        name: 'auth.totp.disable',
        type: 'command',
        auth: 'session',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['code'],
            properties: {code: tokenSchemaData}
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['disabled'],
            properties: {disabled: {type: 'boolean'}}
        },
        rateLimitBucket: 'auth.totp.disable',
        cost: 8,
        timeoutMs: 10000,
        concurrency: 8,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.totp'},
        async handler( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
            //Resolving the authenticated user before disabling the TOTP credential
            const authContextData = totpOperationContextGet( contextData );

            try {
                return await operationOptions.service.disable(
                    authContextData.userId,
                    payloadData.code
                );

            } catch( errorData ){
                return totpOperationErrorPass( errorData );

            }

        }
    });

    //CallBack THE OBJECT
    return Object.freeze([
        stateData,
        enrollmentBeginData,
        enrollmentConfirmData,
        mfaVerifyData,
        recoveryRotateData,
        disableData
    ]);

}
