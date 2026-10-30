import {
    LAYER_ERROR_CODES,
    LayerError
} from '@solcorp/layer-protocol';
import {layerSystemOperationCreate} from '@solcorp/layer-server/system';
import {LayerAuthError} from './auth-error.js';
import {layerAuthPasskeyOperationDefinitionsCreate} from './passkey-operations.js';
import {layerAuthTotpOperationDefinitionsCreate} from './totp-operations.js';
import {layerAuthOidcOperationDefinitionsCreate} from './oidc-operations.js';


const emptyObjectSchemaData = Object.freeze({
    type: 'object',
    additionalProperties: false
});
const sessionMetadataSchemaData = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: [
        'absoluteExpiresAt',
        'assurance',
        'createdAt',
        'current',
        'idleExpiresAt',
        'lastSeenAt',
        'sessionId'
    ],
    properties: {
        sessionId: {type: 'string', minLength: 8, maxLength: 128},
        assurance: {
            type: 'array',
            maxItems: 16,
            items: {type: 'string', minLength: 1, maxLength: 80}
        },
        current: {type: 'boolean'},
        lastSeenAt: {type: 'integer', minimum: 0},
        idleExpiresAt: {type: 'integer', minimum: 0},
        absoluteExpiresAt: {type: 'integer', minimum: 0},
        createdAt: {type: 'integer', minimum: 0}
    }
});


/**
 * @param {unknown} errorData
 * @returns {never}
 */
//Function for passing a safe Auth failure through the public protocol
const authOperationErrorPass = function( errorData ){
    //Passing existing protocol errors without changing their public contract
    if ( errorData instanceof LayerError ){
        throw errorData;

    }

    //Converting only known Auth failures into stable public errors
    if ( errorData instanceof LayerAuthError ){
        let publicStatusData = Number( 400 );

        if ( String( errorData.code ) === String( LAYER_ERROR_CODES.AUTH_CREDENTIALS_INVALID ) ){
            publicStatusData = Number( 401 );

        } else if (
            String( errorData.code ) === String( LAYER_ERROR_CODES.AUTH_EMAIL_VERIFICATION_REQUIRED ) ||
            String( errorData.code ) === String( LAYER_ERROR_CODES.AUTH_REGISTRATION_DISABLED ) ||
            String( errorData.code ) === String( LAYER_ERROR_CODES.AUTH_RECOVERY_UNAVAILABLE ) ||
            String( errorData.code ) === String( LAYER_ERROR_CODES.AUTH_VERIFICATION_UNAVAILABLE )
        ){
            publicStatusData = Number( 403 );

        } else if ( String( errorData.code ) === String( LAYER_ERROR_CODES.AUTH_REGISTRATION_UNAVAILABLE ) ){
            publicStatusData = Number( 409 );

        }

        const publicErrorCodesData = /** @type {Set<string>} */ (new Set( Object.values( LAYER_ERROR_CODES ) ));

        //Hiding internal Auth subsystem codes that are not protocol contracts
        if ( publicErrorCodesData.has( errorData.code ) === false ){
            throw new LayerError(
                LAYER_ERROR_CODES.INTERNAL_ERROR,
                'An internal error occurred.',
                {
                    cause: errorData,
                    status: 500
                }
            );

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

    //Passing unexpected failures to the executor for safe normalization
    throw errorData;

};

/**
 * @param {unknown} contextData
 * @returns {{security: {sessionId: string | null, userId: string | null, permissions?: readonly string[], assurance?: readonly string[]}, response?: {authSessionSet: Function, authSessionClear: Function}}}
 */
//Function for checking the trusted Auth operation context
const authOperationContextGet = function( contextData ){
    //Checking the server-derived context before reading identity or response effects
    if ( contextData === null || typeof contextData !== String( 'object' ) || Array.isArray( contextData ) === true ){
        throw new TypeError( 'Layer Auth operation context is unavailable.' );

    }

    const contextRecordData = /** @type {Record<string, any>} */ (contextData);

    if (
        contextRecordData.security === null ||
        typeof contextRecordData.security !== String( 'object' ) ||
        Array.isArray( contextRecordData.security ) === true
    ){
        throw new TypeError( 'Layer Auth security context is unavailable.' );

    }

    //CallBack THE OBJECT
    return /** @type {any} */ (contextRecordData);

};

/**
 * @param {unknown} contextData
 * @returns {{sessionId: string, userId: string}}
 */
//Function for getting a verified managed-session identity
const authenticatedSessionGet = function( contextData ){
    const authContextData = authOperationContextGet( contextData );
    const sessionIdentifierData = authContextData.security.sessionId;
    const userIdentifierData = authContextData.security.userId;

    //Checking the server-derived identity before accessing account sessions
    if (
        sessionIdentifierData === null ||
        typeof sessionIdentifierData !== String( 'string' ) ||
        Number( sessionIdentifierData.length ) < Number( 8 ) ||
        userIdentifierData === null ||
        typeof userIdentifierData !== String( 'string' ) ||
        Number( userIdentifierData.length ) < Number( 1 )
    ){
        throw new LayerError(
            LAYER_ERROR_CODES.AUTH_REQUIRED,
            'Authentication is required.',
            {status: 401}
        );

    }

    //CallBack THE OBJECT
    return {
        sessionId: String( sessionIdentifierData ),
        userId: String( userIdentifierData )
    };

};

/**
 * @param {Record<string, any>} sessionData
 * @param {string} currentSessionIdentifierData
 */
//Function for creating safe browser session metadata
const sessionMetadataCreate = function( sessionData, currentSessionIdentifierData ){
    //CallBack THE OBJECT
    return Object.freeze({
        sessionId: String( sessionData.sessionId ),
        assurance: Object.freeze([...(sessionData.assurance ?? [])].map( String )),
        current: String( sessionData.sessionId ) === String( currentSessionIdentifierData ),
        lastSeenAt: Number( sessionData.lastSeenAt ),
        idleExpiresAt: Number( sessionData.idleExpiresAt ),
        absoluteExpiresAt: Number( sessionData.absoluteExpiresAt ),
        createdAt: Number( sessionData.createdAt )
    });

};

/**
 * Creates engine-owned operation definitions for the password and managed
 * session flow. Definitions must be registered before the registry is sealed.
 *
 * @param {{
 *     service: {
 *         registration: {create: Function},
 *         emailVerification: {request: Function, confirm: Function},
 *         passwordRecovery: {request: Function, complete: Function},
 *         signIn: {password: Function},
 *         sessions: {list: Function, revoke: Function},
 *         passkey?: any,
 *         totp?: any,
 *         oidc?: any
 *     },
 *     clock?: () => number
 * }} operationOptions
 */
export function layerAuthOperationDefinitionsCreate( operationOptions ){
    //Checking the Auth service before creating public operation contracts
    if (
        operationOptions === null ||
        typeof operationOptions !== String( 'object' ) ||
        typeof operationOptions.service?.registration?.create !== String( 'function' ) ||
        typeof operationOptions.service?.emailVerification?.request !== String( 'function' ) ||
        typeof operationOptions.service?.emailVerification?.confirm !== String( 'function' ) ||
        typeof operationOptions.service?.passwordRecovery?.request !== String( 'function' ) ||
        typeof operationOptions.service?.passwordRecovery?.complete !== String( 'function' ) ||
        typeof operationOptions.service?.signIn?.password !== String( 'function' ) ||
        typeof operationOptions.service?.sessions?.list !== String( 'function' ) ||
        typeof operationOptions.service?.sessions?.revoke !== String( 'function' )
    ){
        throw new TypeError( 'Layer Auth operations require the complete password/session service.' );

    }

    const clockData = operationOptions.clock ?? Date.now;

    const stateOperationData = layerSystemOperationCreate({
        name: 'auth.state.get',
        type: 'query',
        auth: 'session',
        inputSchema: emptyObjectSchemaData,
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['assurance', 'authenticated', 'permissions', 'session', 'user'],
            properties: {
                authenticated: {const: true},
                user: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['id'],
                    properties: {id: {type: 'string', minLength: 1, maxLength: 128}}
                },
                session: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['id'],
                    properties: {id: {type: 'string', minLength: 8, maxLength: 128}}
                },
                permissions: {
                    type: 'array',
                    maxItems: 500,
                    items: {type: 'string', minLength: 3, maxLength: 160}
                },
                assurance: {
                    type: 'array',
                    maxItems: 16,
                    items: {type: 'string', minLength: 1, maxLength: 80}
                }
            }
        },
        rateLimitBucket: 'auth.state.get',
        cost: 1,
        timeoutMs: 10000,
        concurrency: 128,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: false, category: 'auth.state'},
        async handler( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
            const currentSessionData = authenticatedSessionGet( contextData );
            const authContextData = authOperationContextGet( contextData );
            let permissionsData = /** @type {string[]} */ ([]);
            let assuranceData = /** @type {string[]} */ ([]);

            //Copying only bounded arrays already verified by the security resolver
            if ( Array.isArray( authContextData.security.permissions ) === true ){
                permissionsData = authContextData.security.permissions.map( String );

            }

            if ( Array.isArray( authContextData.security.assurance ) === true ){
                assuranceData = authContextData.security.assurance.map( String );

            }

            //Returning only identity state required by the headless browser facade
            return Object.freeze({
                authenticated: true,
                user: Object.freeze({id: String( currentSessionData.userId )}),
                session: Object.freeze({id: String( currentSessionData.sessionId )}),
                permissions: Object.freeze( permissionsData ),
                assurance: Object.freeze( assuranceData )
            });

        }
    });

    const registrationOperationData = layerSystemOperationCreate({
        name: 'auth.registration.create',
        type: 'command',
        auth: 'none',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['identifier', 'password'],
            properties: {
                identifier: {type: 'string', minLength: 1, maxLength: 320},
                password: {type: 'string', minLength: 1, maxLength: 1024},
                invitationToken: {type: 'string', minLength: 32, maxLength: 512}
            }
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['accepted', 'verificationRequired'],
            properties: {
                accepted: {type: 'boolean'},
                verificationRequired: {type: 'boolean'}
            }
        },
        rateLimitBucket: 'auth.registration.create',
        cost: 10,
        timeoutMs: 15000,
        concurrency: 8,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.registration'},
        async handler( /** @type {any} */ payloadData ){
            try {
                //Creating the identity without returning its internal identifier
                const registrationResultData = await operationOptions.service.registration.create( payloadData );

                //CallBack THE OBJECT
                return Object.freeze({
                    accepted: registrationResultData.accepted === true,
                    verificationRequired: registrationResultData.verificationRequired === true
                });

            } catch( errorData ){
                //Passing only a stable Auth failure through the protocol
                return authOperationErrorPass( errorData );

            }

        }
    });

    const emailVerificationRequestOperationData = layerSystemOperationCreate({
        name: 'auth.email.verification.request',
        type: 'command',
        auth: 'none',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['identifier'],
            properties: {
                identifier: {type: 'string', minLength: 1, maxLength: 320}
            }
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['accepted'],
            properties: {accepted: {const: true}}
        },
        rateLimitBucket: 'auth.email.verification.request',
        cost: 10,
        timeoutMs: 10000,
        concurrency: 8,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.email-verification'},
        async handler( /** @type {any} */ payloadData ){
            try {
                //Returning the same acceptance result for present and missing identities
                await operationOptions.service.emailVerification.request( payloadData );

                //CallBack THE OBJECT
                return Object.freeze({accepted: true});

            } catch( errorData ){
                return authOperationErrorPass( errorData );

            }

        }
    });

    const emailVerificationConfirmOperationData = layerSystemOperationCreate({
        name: 'auth.email.verification.confirm',
        type: 'command',
        auth: 'none',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['token'],
            properties: {
                token: {type: 'string', minLength: 20, maxLength: 512}
            }
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['verified'],
            properties: {verified: {const: true}}
        },
        rateLimitBucket: 'auth.email.verification.confirm',
        cost: 8,
        timeoutMs: 10000,
        concurrency: 8,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.email-verification'},
        async handler( /** @type {any} */ payloadData ){
            try {
                //Consuming one verification token through the Auth service
                await operationOptions.service.emailVerification.confirm( payloadData );

                //CallBack THE OBJECT
                return Object.freeze({verified: true});

            } catch( errorData ){
                return authOperationErrorPass( errorData );

            }

        }
    });

    const passwordRecoveryRequestOperationData = layerSystemOperationCreate({
        name: 'auth.password.recovery.request',
        type: 'command',
        auth: 'none',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['identifier'],
            properties: {
                identifier: {type: 'string', minLength: 1, maxLength: 320}
            }
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['accepted'],
            properties: {accepted: {const: true}}
        },
        rateLimitBucket: 'auth.password.recovery.request',
        cost: 12,
        timeoutMs: 10000,
        concurrency: 8,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.password-recovery'},
        async handler( /** @type {any} */ payloadData ){
            try {
                //Keeping account presence private behind one acceptance response
                await operationOptions.service.passwordRecovery.request( payloadData );

                //CallBack THE OBJECT
                return Object.freeze({accepted: true});

            } catch( errorData ){
                return authOperationErrorPass( errorData );

            }

        }
    });

    const passwordRecoveryCompleteOperationData = layerSystemOperationCreate({
        name: 'auth.password.recovery.complete',
        type: 'command',
        auth: 'none',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['password', 'token'],
            properties: {
                password: {type: 'string', minLength: 1, maxLength: 1024},
                token: {type: 'string', minLength: 20, maxLength: 512}
            }
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['completed'],
            properties: {completed: {const: true}}
        },
        rateLimitBucket: 'auth.password.recovery.complete',
        cost: 15,
        timeoutMs: 15000,
        concurrency: 8,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.password-recovery'},
        async handler( /** @type {any} */ payloadData ){
            try {
                //Replacing the credential only after one challenge is consumed
                await operationOptions.service.passwordRecovery.complete( payloadData );

                //CallBack THE OBJECT
                return Object.freeze({completed: true});

            } catch( errorData ){
                return authOperationErrorPass( errorData );

            }

        }
    });

    const passwordSignInOperationData = layerSystemOperationCreate({
        name: 'auth.signin.password',
        type: 'command',
        auth: 'none',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['identifier', 'password'],
            properties: {
                identifier: {type: 'string', minLength: 1, maxLength: 320},
                password: {type: 'string', minLength: 1, maxLength: 1024},
                remember: {type: 'boolean'}
            }
        },
        outputSchema: {
            oneOf: [{
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
            }, {
                type: 'object',
                additionalProperties: false,
                required: ['challenge', 'expiresAt', 'methods', 'mfaRequired'],
                properties: {
                    mfaRequired: {const: true},
                    challenge: {type: 'string', minLength: 20, maxLength: 512},
                    expiresAt: {type: 'integer', minimum: 0},
                    methods: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 4,
                        uniqueItems: true,
                        items: {enum: ['recovery-code', 'totp']}
                    }
                }
            }]
        },
        rateLimitBucket: 'auth.sign-in.password',
        cost: 12,
        timeoutMs: 15000,
        concurrency: 8,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.sign-in'},
        async handler( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
            try {
                const authContextData = authOperationContextGet( contextData );
                const responseData = authContextData.response;

                //Checking the trusted response effect before issuing a credential
                if ( responseData === undefined || typeof responseData.authSessionSet !== String( 'function' ) ){
                    throw new TypeError( 'Layer Auth session response capability is unavailable.' );

                }

                const signInResultData = await operationOptions.service.signIn.password( payloadData );

                //Returning an opaque staged challenge without writing a session cookie
                if ( signInResultData.mfaRequired === true ){
                    return Object.freeze({
                        mfaRequired: true,
                        challenge: String( signInResultData.challenge ),
                        expiresAt: Number( signInResultData.expiresAt ),
                        methods: Object.freeze([...signInResultData.methods].map( String ))
                    });

                }

                const sessionData = signInResultData.session;
                const maximumAgeSecondsData = Math.max(
                    Number( 1 ),
                    Math.floor(
                        (Number( sessionData.absoluteExpiresAt ) - Number( clockData() )) / Number( 1000 )
                    )
                );

                //Writing opaque credentials only through the trusted cookie effect
                responseData.authSessionSet({
                    sessionToken: String( sessionData.sessionToken ),
                    csrfToken: String( sessionData.csrfToken ),
                    maximumAgeSeconds: Number( maximumAgeSecondsData )
                });

                //Returning safe identity and expiry metadata without raw credentials
                return Object.freeze({
                    user: Object.freeze({id: String( signInResultData.userId )}),
                    session: Object.freeze({
                        id: String( sessionData.sessionId ),
                        idleExpiresAt: Number( sessionData.idleExpiresAt ),
                        absoluteExpiresAt: Number( sessionData.absoluteExpiresAt )
                    })
                });

            } catch( errorData ){
                //Passing only a stable Auth failure through the protocol
                return authOperationErrorPass( errorData );

            }

        }
    });

    const signOutOperationData = layerSystemOperationCreate({
        name: 'auth.signout',
        type: 'command',
        auth: 'session',
        inputSchema: emptyObjectSchemaData,
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['signedOut'],
            properties: {signedOut: {type: 'boolean'}}
        },
        rateLimitBucket: 'auth.sign-out',
        cost: 1,
        timeoutMs: 10000,
        concurrency: 64,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.sign-out'},
        async handler( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
            try {
                const currentSessionData = authenticatedSessionGet( contextData );
                const authContextData = authOperationContextGet( contextData );
                const responseData = authContextData.response;

                //Revoking the current session before clearing browser credentials
                await operationOptions.service.sessions.revoke(
                    currentSessionData.sessionId,
                    currentSessionData.userId
                );

                if ( responseData === undefined || typeof responseData.authSessionClear !== String( 'function' ) ){
                    throw new TypeError( 'Layer Auth session response capability is unavailable.' );

                }

                responseData.authSessionClear();

                //CallBack THE OBJECT
                return Object.freeze({signedOut: true});

            } catch( errorData ){
                //Passing only a stable Auth failure through the protocol
                return authOperationErrorPass( errorData );

            }

        }
    });

    const sessionsListOperationData = layerSystemOperationCreate({
        name: 'auth.sessions.list',
        type: 'query',
        auth: 'session',
        inputSchema: emptyObjectSchemaData,
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['sessions'],
            properties: {
                sessions: {
                    type: 'array',
                    maxItems: 100,
                    items: sessionMetadataSchemaData
                }
            }
        },
        rateLimitBucket: 'auth.sessions.list',
        cost: 1,
        timeoutMs: 10000,
        concurrency: 64,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.sessions'},
        async handler( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
            try {
                const currentSessionData = authenticatedSessionGet( contextData );
                const sessionsLoadResultData = await operationOptions.service.sessions.list(
                    currentSessionData.userId
                );

                //Creating isolated browser metadata and marking only the current session
                const sessionsData = sessionsLoadResultData.map(function sessionMetadataMap( /** @type {Record<string, any>} */ sessionData ){
                    //Removing persisted internals while marking the browser's current session
                    return sessionMetadataCreate( sessionData, currentSessionData.sessionId );

                });

                //CallBack THE OBJECT
                return Object.freeze({sessions: Object.freeze( sessionsData )});

            } catch( errorData ){
                //Passing only a stable Auth failure through the protocol
                return authOperationErrorPass( errorData );

            }

        }
    });

    const sessionRevokeOperationData = layerSystemOperationCreate({
        name: 'auth.sessions.revoke',
        type: 'command',
        auth: 'session',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['sessionId'],
            properties: {
                sessionId: {type: 'string', minLength: 8, maxLength: 128}
            }
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['revoked'],
            properties: {revoked: {type: 'boolean'}}
        },
        rateLimitBucket: 'auth.sessions.revoke',
        cost: 2,
        timeoutMs: 10000,
        concurrency: 32,
        transaction: false,
        offlineReplay: false,
        audit: {enabled: true, category: 'auth.sessions'},
        async handler( /** @type {any} */ payloadData, /** @type {any} */ contextData ){
            try {
                const currentSessionData = authenticatedSessionGet( contextData );
                const payloadRecordData = /** @type {{sessionId: string}} */ (payloadData);
                const revokeStatusData = await operationOptions.service.sessions.revoke(
                    payloadRecordData.sessionId,
                    currentSessionData.userId
                );

                //Clearing cookies when the current browser session revoked itself
                if (
                    payloadRecordData.sessionId === currentSessionData.sessionId &&
                    revokeStatusData === true
                ){
                    const authContextData = authOperationContextGet( contextData );
                    const responseData = authContextData.response;

                    if ( responseData === undefined || typeof responseData.authSessionClear !== String( 'function' ) ){
                        throw new TypeError( 'Layer Auth session response capability is unavailable.' );

                    }

                    responseData.authSessionClear();

                }

                //CallBack THE OBJECT
                return Object.freeze({revoked: revokeStatusData === true});

            } catch( errorData ){
                //Passing only a stable Auth failure through the protocol
                return authOperationErrorPass( errorData );

            }

        }
    });

    const operationDefinitionsData = /** @type {any[]} */ ([
        stateOperationData,
        registrationOperationData,
        emailVerificationRequestOperationData,
        emailVerificationConfirmOperationData,
        passwordRecoveryRequestOperationData,
        passwordRecoveryCompleteOperationData,
        passwordSignInOperationData,
        signOutOperationData,
        sessionsListOperationData,
        sessionRevokeOperationData
    ]);

    //Adding WebAuthn contracts only when Passkey is configured
    if ( operationOptions.service.passkey !== null && operationOptions.service.passkey !== undefined ){
        const passkeyOperationDefinitionsData = layerAuthPasskeyOperationDefinitionsCreate({
            service: operationOptions.service.passkey,
            clock: clockData
        });
        operationDefinitionsData.push( ...passkeyOperationDefinitionsData );

    }

    //Adding TOTP and staged MFA contracts only when the adapter is configured
    if ( operationOptions.service.totp !== null && operationOptions.service.totp !== undefined ){
        const totpOperationDefinitionsData = layerAuthTotpOperationDefinitionsCreate({
            service: operationOptions.service.totp,
            clock: clockData
        });
        operationDefinitionsData.push( ...totpOperationDefinitionsData );

    }

    //Adding external OIDC contracts only when providers are configured
    if ( operationOptions.service.oidc !== null && operationOptions.service.oidc !== undefined ){
        const oidcOperationDefinitionsData = layerAuthOidcOperationDefinitionsCreate({
            service: operationOptions.service.oidc,
            clock: clockData
        });
        operationDefinitionsData.push( ...oidcOperationDefinitionsData );

    }

    //CallBack THE OBJECT
    return Object.freeze( operationDefinitionsData );

}
