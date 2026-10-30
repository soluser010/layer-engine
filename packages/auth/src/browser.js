import {
    startAuthentication,
    startRegistration
} from '@simplewebauthn/browser';


/**
 * Browser Auth operations are installed by the Layer runtime. This marker lets
 * tooling identify the package without shipping server credential dependencies.
 */
export const LAYER_AUTH_BROWSER_API_VERSION = 1;


/**
 * Creates the headless browser facade. Authentication commands are never sent
 * through the offline outbox because credential actions must execute online.
 *
 * @param {{
 *     request: (requestData: Readonly<Record<string, any>>) => Promise<{data: any}>,
 *     storagePurge?: () => Promise<void>,
 *     phoneOperations?: {start: string, verify: string},
 *     passkey?: {
 *         startAuthentication?: typeof startAuthentication,
 *         startRegistration?: typeof startRegistration
 *     }
 * }} browserOptions
 */
export function layerAuthBrowserCreate( browserOptions ){
    //Checking the online protocol boundary before exposing credential methods
    if ( browserOptions === null || typeof browserOptions !== String( 'object' ) || typeof browserOptions.request !== String( 'function' ) ){
        throw new TypeError( 'Layer Auth browser facade requires the online API request function.' );

    }

    /**
     * @param {'query' | 'command'} requestTypeData
     * @param {string} operationNameData
     * @param {Readonly<Record<string, unknown>>} payloadData
     * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
     */
    //Function for sending one online Auth operation
    const authRequestSend = async function( requestTypeData, operationNameData, payloadData, requestOptionsData = {} ){
        const requestData = /** @type {Record<string, any>} */ ({
            type: requestTypeData,
            operation: operationNameData,
            payload: payloadData
        });

        if ( requestOptionsData.signal !== undefined ){
            requestData.signal = requestOptionsData.signal;

        }

        if ( requestOptionsData.timeoutMs !== undefined ){
            requestData.timeoutMs = requestOptionsData.timeoutMs;

        }

        const requestResultData = await browserOptions.request( requestData );

        //CallBack THE OBJECT
        return Object.freeze( structuredClone( requestResultData.data ) );

    };

    const passkeyBrowserData = Object.freeze({
        startAuthentication: browserOptions.passkey?.startAuthentication ?? startAuthentication,
        startRegistration: browserOptions.passkey?.startRegistration ?? startRegistration
    });
    const phoneOperationsData = browserOptions.phoneOperations ?? null;

    //Checking app-provided operation names before exposing credential methods.
    if (
        phoneOperationsData !== null &&
        (
            typeof phoneOperationsData.start !== String( 'string' ) ||
            typeof phoneOperationsData.verify !== String( 'string' ) ||
            /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/u.test( phoneOperationsData.start ) === false ||
            /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/u.test( phoneOperationsData.verify ) === false
        )
    ){
        throw new TypeError( 'Layer Auth phone operations are invalid.' );

    }

    /**
     * @param {{displayName?: string}} registrationData
     * @param {{signal?: AbortSignal, timeoutMs?: number}} requestOptionsData
     */
    //Function for completing the browser Passkey registration ceremony
    const passkeyRegistrationCreate = async function( registrationData = {}, requestOptionsData = {} ){
        //Getting server-bound creation options before invoking the authenticator
        const registrationBeginResultData = await authRequestSend(
            'query',
            'auth.passkey.registration.begin',
            {},
            requestOptionsData
        );

        //Launching the platform or roaming authenticator ceremony
        const registrationResponseData = await passkeyBrowserData.startRegistration({
            optionsJSON: registrationBeginResultData.options
        });
        const registrationCompleteData = /** @type {{challenge: string, response: any, displayName?: string}} */ ({
            challenge: String( registrationBeginResultData.options.challenge ),
            response: registrationResponseData
        });

        //Adding only optional presentation metadata to the server request
        if ( registrationData.displayName !== undefined ){
            registrationCompleteData.displayName = registrationData.displayName;

        }

        //Sending the signed authenticator response directly while online
        return authRequestSend(
            'command',
            'auth.passkey.registration.complete',
            registrationCompleteData,
            requestOptionsData
        );

    };

    /**
     * @param {{remember?: boolean}} signInData
     * @param {{signal?: AbortSignal, timeoutMs?: number}} requestOptionsData
     */
    //Function for completing the browser Passkey authentication ceremony
    const passkeySignInCreate = async function( signInData = {}, requestOptionsData = {} ){
        //Getting a short-lived discoverable credential challenge
        const authenticationBeginResultData = await authRequestSend(
            'query',
            'auth.passkey.signin.begin',
            {},
            requestOptionsData
        );

        //Launching the authenticator without collecting a browser-owned identity
        const authenticationResponseData = await passkeyBrowserData.startAuthentication({
            optionsJSON: authenticationBeginResultData.options
        });
        const authenticationCompleteData = {
            challenge: String( authenticationBeginResultData.options.challenge ),
            response: authenticationResponseData,
            remember: signInData.remember === true
        };

        //Sending the assertion directly so it cannot enter an offline outbox
        return authRequestSend(
            'command',
            'auth.passkey.signin.complete',
            authenticationCompleteData,
            requestOptionsData
        );

    };

    //CallBack THE OBJECT
    return Object.freeze({
        phone: phoneOperationsData === null ? null : Object.freeze({
            /**
             * Starts an application-owned phone challenge online. The code
             * never enters the offline outbox or persistent query cache.
             *
             * @param {{phone: string}} phoneData
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            start( phoneData, requestOptionsData = {} ){
                //Sending the phone challenge through the shared online Auth client.
                return authRequestSend(
                    'command',
                    phoneOperationsData.start,
                    {
                        ...phoneData,
                        commandId: globalThis.crypto.randomUUID(),
                        baseRevision: 0
                    },
                    requestOptionsData
                );

            },

            /**
             * Consumes a phone code and accepts a managed session cookie.
             *
             * @param {{phone: string, challengeId: string, code: string}} verificationData
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            verify( verificationData, requestOptionsData = {} ){
                //Keeping the single-use code entirely in the online request.
                return authRequestSend(
                    'command',
                    phoneOperationsData.verify,
                    {
                        ...verificationData,
                        commandId: globalThis.crypto.randomUUID(),
                        baseRevision: 0
                    },
                    requestOptionsData
                );

            }
        }),
        state: Object.freeze({
            /**
             * Loads the current server-derived identity, session, permissions,
             * and assurance. A missing session returns an anonymous state.
             *
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            async get( requestOptionsData = {} ){
                try {
                    //Loading server-derived identity state without trusting browser storage
                    return await authRequestSend(
                        'query',
                        'auth.state.get',
                        {},
                        requestOptionsData
                    );

                } catch( stateLoadErrorData ){
                    const stateLoadErrorRecordData = /** @type {{code?: string}} */ (stateLoadErrorData);

                    //Converting only a missing session into an anonymous state
                    if ( stateLoadErrorRecordData.code === String( 'AUTH_REQUIRED' ) ){
                        return Object.freeze({
                            authenticated: false,
                            user: null,
                            session: null,
                            permissions: Object.freeze([]),
                            assurance: Object.freeze([])
                        });

                    }

                    throw stateLoadErrorData;

                }

            }
        }),

        registration: Object.freeze({
            /**
             * Creates an account through the configured open or invitation
             * policy. Supply invitationToken only in invite mode.
             *
             * @param {{identifier: string, password: string, invitationToken?: string}} registrationData
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            create( registrationData, requestOptionsData = {} ){
                //Sending registration directly because credentials cannot enter the outbox
                return authRequestSend(
                    'command',
                    'auth.registration.create',
                    registrationData,
                    requestOptionsData
                );

            }
        }),

        emailVerification: Object.freeze({
            /**
             * Requests a one-time verification message without revealing
             * whether the identifier exists.
             *
             * @param {string} identifierData
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            request( identifierData, requestOptionsData = {} ){
                //Requesting a replacement token without revealing account presence
                return authRequestSend(
                    'command',
                    'auth.email.verification.request',
                    {identifier: identifierData},
                    requestOptionsData
                );

            },

            /**
             * Consumes one email-verification token online.
             *
             * @param {string} tokenData
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            confirm( tokenData, requestOptionsData = {} ){
                //Sending the one-time verification credential only while online
                return authRequestSend(
                    'command',
                    'auth.email.verification.confirm',
                    {token: tokenData},
                    requestOptionsData
                );

            }
        }),

        passwordRecovery: Object.freeze({
            /**
             * Requests a recovery message through an enumeration-safe result.
             *
             * @param {string} identifierData
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            request( identifierData, requestOptionsData = {} ){
                //Requesting recovery through one enumeration-safe server result
                return authRequestSend(
                    'command',
                    'auth.password.recovery.request',
                    {identifier: identifierData},
                    requestOptionsData
                );

            },

            /**
             * Consumes one recovery token and replaces the password. Existing
             * managed sessions are revoked by the server.
             *
             * @param {{token: string, password: string}} recoveryData
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            complete( recoveryData, requestOptionsData = {} ){
                //Sending the token and replacement password only through online Auth
                return authRequestSend(
                    'command',
                    'auth.password.recovery.complete',
                    recoveryData,
                    requestOptionsData
                );

            }
        }),

        signIn: Object.freeze({
            /**
             * Signs in with an email or username and password. When MFA is
             * enabled the result contains a staged challenge instead of a session.
             *
             * @param {{identifier: string, password: string, remember?: boolean}} signInData
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            password( signInData, requestOptionsData = {} ){
                //Sending password credentials only to the same-origin online operation
                return authRequestSend(
                    'command',
                    'auth.signin.password',
                    signInData,
                    requestOptionsData
                );

            },

            /**
             * Runs a discoverable WebAuthn authentication ceremony and creates
             * a managed session when verification succeeds.
             *
             * @param {{remember?: boolean}} [signInData]
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            passkey( signInData = {}, requestOptionsData = {} ){
                //Launching the complete discoverable Passkey ceremony
                return passkeySignInCreate( signInData, requestOptionsData );

            },

            /**
             * Begins external OIDC sign-in and returns an authorization URL.
             * The application decides when navigation occurs.
             *
             * @param {string} providerIdentifierData
             * @param {{returnTo?: string}} [signInData]
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            oidc( providerIdentifierData, signInData = {}, requestOptionsData = {} ){
                //Creating the durable PKCE redirect without navigating implicitly
                return authRequestSend(
                    'command',
                    'auth.oidc.begin',
                    {
                        providerId: providerIdentifierData,
                        ...signInData
                    },
                    requestOptionsData
                );

            }
        }),

        oidc: Object.freeze({
            providers: Object.freeze({
                /**
                 * Lists public identifiers of configured external providers.
                 *
                 * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
                 */
                list( requestOptionsData = {} ){
                    //Loading only configured public provider identifiers
                    return authRequestSend(
                        'query',
                        'auth.oidc.providers.list',
                        {},
                        requestOptionsData
                    );

                }
            }),

            /**
             * Creates a state/nonce/PKCE-bound external authorization URL
             * without changing browser location.
             *
             * @param {string} providerIdentifierData
             * @param {{returnTo?: string}} [beginData]
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            begin( providerIdentifierData, beginData = {}, requestOptionsData = {} ){
                //Creating the authorization URL while leaving navigation to the application
                return authRequestSend(
                    'command',
                    'auth.oidc.begin',
                    {
                        providerId: providerIdentifierData,
                        ...beginData
                    },
                    requestOptionsData
                );

            },

            /**
             * Verifies the current external callback URL, consumes its state,
             * and creates a managed Layer session.
             *
             * @param {{callbackUrl?: string, remember?: boolean}} [completeData]
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            complete( completeData = {}, requestOptionsData = {} ){
                let callbackUrlData = completeData.callbackUrl;

                //Using the current URL only inside a real browser callback page
                if ( callbackUrlData === undefined ){
                    callbackUrlData = globalThis.location?.href;

                }

                if ( typeof callbackUrlData !== String( 'string' ) ){
                    throw new TypeError( 'Layer Auth OIDC completion requires a callback URL.' );

                }

                return authRequestSend(
                    'command',
                    'auth.oidc.complete',
                    {
                        callbackUrl: callbackUrlData,
                        remember: completeData.remember === true
                    },
                    requestOptionsData
                );

            },

            /**
             * Begins OIDC and explicitly navigates to the returned provider URL.
             *
             * @param {string} providerIdentifierData
             * @param {{returnTo?: string}} [beginData]
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            async redirect( providerIdentifierData, beginData = {}, requestOptionsData = {} ){
                const beginResultData = await authRequestSend(
                    'command',
                    'auth.oidc.begin',
                    {
                        providerId: providerIdentifierData,
                        ...beginData
                    },
                    requestOptionsData
                );

                if ( typeof globalThis.location?.assign !== String( 'function' ) ){
                    throw new TypeError( 'Layer Auth OIDC redirect requires a browser location API.' );

                }

                //Navigating only after the application explicitly calls redirect
                globalThis.location.assign( beginResultData.authorizationUrl );
                return beginResultData;

            }
        }),

        passkey: Object.freeze({
            registration: Object.freeze({
                /**
                 * Loads server-bound WebAuthn creation options for the signed-in account.
                 *
                 * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
                 */
                begin( requestOptionsData = {} ){
                    //Requesting authenticator creation options for a signed-in account
                    return authRequestSend(
                        'query',
                        'auth.passkey.registration.begin',
                        {},
                        requestOptionsData
                    );

                },

                /**
                 * Verifies a response returned by a custom WebAuthn ceremony.
                 *
                 * @param {{challenge: string, response: Record<string, any>, displayName?: string}} registrationData
                 * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
                 */
                complete( registrationData, requestOptionsData = {} ){
                    //Sending a completed authenticator response while online
                    return authRequestSend(
                        'command',
                        'auth.passkey.registration.complete',
                        registrationData,
                        requestOptionsData
                    );

                },

                /**
                 * Runs the complete browser WebAuthn registration ceremony.
                 *
                 * @param {{displayName?: string}} [registrationData]
                 * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
                 */
                create( registrationData = {}, requestOptionsData = {} ){
                    //Launching the complete Passkey registration ceremony
                    return passkeyRegistrationCreate( registrationData, requestOptionsData );

                }
            }),

            /**
             * Lists safe Passkey metadata owned by the current account.
             *
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            list( requestOptionsData = {} ){
                //Loading only the current account's safe Passkey metadata
                return authRequestSend(
                    'query',
                    'auth.passkey.list',
                    {},
                    requestOptionsData
                );

            },

            /**
             * Removes one Passkey owned by the current account.
             *
             * @param {string} credentialIdentifierData
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            remove( credentialIdentifierData, requestOptionsData = {} ){
                //Removing one Passkey owned by the current account
                return authRequestSend(
                    'command',
                    'auth.passkey.remove',
                    {credentialId: credentialIdentifierData},
                    requestOptionsData
                );

            }
        }),

        mfa: Object.freeze({
            /**
             * Completes a staged sign-in with a TOTP or single-use recovery code.
             *
             * @param {{challenge: string, code?: string, recoveryCode?: string}} verificationData
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            verify( verificationData, requestOptionsData = {} ){
                //Completing a staged password sign-in with one online second factor
                return authRequestSend(
                    'command',
                    'auth.mfa.verify',
                    verificationData,
                    requestOptionsData
                );

            }
        }),

        totp: Object.freeze({
            /**
             * Reports whether the current account has confirmed TOTP.
             *
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            state( requestOptionsData = {} ){
                //Checking whether the current account owns a confirmed authenticator seed
                return authRequestSend(
                    'query',
                    'auth.totp.state',
                    {},
                    requestOptionsData
                );

            },

            enrollment: Object.freeze({
                /**
                 * Starts enrollment and returns the one-time provisioning secret and URI.
                 *
                 * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
                 */
                begin( requestOptionsData = {} ){
                    //Creating one encrypted pending seed and one-time provisioning result
                    return authRequestSend(
                        'command',
                        'auth.totp.enrollment.begin',
                        {},
                        requestOptionsData
                    );

                },

                /**
                 * Confirms the pending seed and returns recovery codes once.
                 *
                 * @param {string} tokenData
                 * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
                 */
                confirm( tokenData, requestOptionsData = {} ){
                    //Confirming the seed before recovery codes are issued once
                    return authRequestSend(
                        'command',
                        'auth.totp.enrollment.confirm',
                        {code: tokenData},
                        requestOptionsData
                    );

                }
            }),

            recoveryCodes: Object.freeze({
                /**
                 * Replaces all recovery codes after fresh TOTP verification.
                 *
                 * @param {string} tokenData
                 * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
                 */
                rotate( tokenData, requestOptionsData = {} ){
                    //Rotating recovery codes after consuming a fresh authenticator step
                    return authRequestSend(
                        'command',
                        'auth.totp.recovery.rotate',
                        {code: tokenData},
                        requestOptionsData
                    );

                }
            }),

            /**
             * Disables TOTP after fresh authenticator verification.
             *
             * @param {string} tokenData
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            disable( tokenData, requestOptionsData = {} ){
                //Disabling the current account's authenticator after fresh verification
                return authRequestSend(
                    'command',
                    'auth.totp.disable',
                    {code: tokenData},
                    requestOptionsData
                );

            }
        }),

        /**
         * Revokes the current session and always purges its local user namespace.
         *
         * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
         */
        async signOut( requestOptionsData = {} ){
            let signOutResultData = null;
            let signOutErrorData = /** @type {any} */ (null);

            try {
                //Revoking the server session before removing user-isolated browser data
                signOutResultData = await authRequestSend(
                    'command',
                    'auth.signout',
                    {},
                    requestOptionsData
                );

            } catch( errorData ){
                signOutErrorData = errorData;

            }

            //Purging local state even when the server session already expired
            if ( browserOptions.storagePurge !== undefined ){
                await browserOptions.storagePurge();

            }

            if ( signOutErrorData !== null && signOutErrorData.code !== String( 'AUTH_REQUIRED' ) ){
                throw signOutErrorData;

            }

            if ( signOutResultData === null ){
                return Object.freeze({signedOut: true});

            }

            //CallBack THE OBJECT
            return signOutResultData;

        },

        sessions: Object.freeze({
            /**
             * Lists safe metadata for active sessions of the current account.
             *
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            list( requestOptionsData = {} ){
                //Loading only safe session metadata from the current account
                return authRequestSend(
                    'query',
                    'auth.sessions.list',
                    {},
                    requestOptionsData
                );

            },

            /**
             * Revokes one session owned by the current account.
             *
             * @param {string} sessionIdentifierData
             * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptionsData]
             */
            revoke( sessionIdentifierData, requestOptionsData = {} ){
                //Revoking only the server-owned identifier selected by the user
                return authRequestSend(
                    'command',
                    'auth.sessions.revoke',
                    {sessionId: sessionIdentifierData},
                    requestOptionsData
                );

            }
        })
    });

}
