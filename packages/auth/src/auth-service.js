import {
    LAYER_AUTH_ARGON2_PARAMETERS,
    layerAuthPasswordCheck,
    layerAuthPasswordHashCreate,
    layerAuthPasswordVerify
} from './password.js';
import {layerAuthIdentifierCreate} from './identifier.js';
import {LayerAuthError} from './auth-error.js';
import {layerAuthPasskeyServiceCreate} from './passkey-service.js';
import {layerAuthTotpServiceCreate} from './totp-service.js';
import {layerAuthOidcServiceCreate} from './oidc-service.js';


/**
 * Creates the password and managed-session lifecycle used by server Auth
 * operations. HTTP cookies remain owned by the trusted server integration.
 *
 * @param {{
 *     configuration: Readonly<Record<string, any>>,
 *     users: any,
 *     sessions: any,
 *     challenges?: any,
 *     mailQueue?: any,
 *     passkeys?: any,
 *     totp?: any,
 *     externalIdentities?: any,
 *     invitations?: any,
 *     roles?: any,
 *     secretEnvelope?: {seal: Function, open: Function},
 *     oidcEnvironment?: Record<string, string | undefined>,
 *     oidcClient?: any,
 *     clock?: () => number,
 *     dummyPasswordHash?: string
 * }} serviceOptions
 */
export function layerAuthServiceCreate( serviceOptions ){
    //Checking required repositories before any credential work can start
    if (
        serviceOptions === null ||
        typeof serviceOptions !== String( 'object' ) ||
        serviceOptions.configuration?.enabled !== true ||
        typeof serviceOptions.users?.create !== String( 'function' ) ||
        typeof serviceOptions.users?.findByIdentifier !== String( 'function' ) ||
        typeof serviceOptions.users?.permissionsResolve !== String( 'function' ) ||
        typeof serviceOptions.sessions?.issue !== String( 'function' ) ||
        typeof serviceOptions.sessions?.list !== String( 'function' ) ||
        typeof serviceOptions.sessions?.revokeById !== String( 'function' )
    ){
        throw new TypeError( 'Layer Auth service requires enabled configuration and identity/session repositories.' );

    }

    //Requiring durable challenges and encrypted mail only for enabled email flows
    if (
        (
            serviceOptions.configuration.emailVerification.required === true ||
            serviceOptions.configuration.passwordRecovery?.enabled === true
        ) &&
        (
            typeof serviceOptions.challenges?.create !== String( 'function' ) ||
            typeof serviceOptions.challenges?.consume !== String( 'function' ) ||
            typeof serviceOptions.mailQueue?.enqueue !== String( 'function' )
        )
    ){
        throw new TypeError( 'Layer Auth email flows require durable challenges and an encrypted mail queue.' );

    }

    //Requiring encrypted durable MFA state only when TOTP is enabled
    if (
        (serviceOptions.configuration.totp ?? null) !== null &&
        (
            typeof serviceOptions.challenges?.create !== String( 'function' ) ||
            typeof serviceOptions.challenges?.consume !== String( 'function' ) ||
            typeof serviceOptions.totp?.get !== String( 'function' ) ||
            typeof serviceOptions.secretEnvelope?.seal !== String( 'function' ) ||
            typeof serviceOptions.secretEnvelope?.open !== String( 'function' )
        )
    ){
        throw new TypeError( 'Layer Auth TOTP requires durable challenges and encrypted credential storage.' );

    }

    //Requiring durable encrypted external identity state only when OIDC is configured
    if (
        Number( serviceOptions.configuration.oidc?.length ?? Number( 0 ) ) > Number( 0 ) &&
        (
            typeof serviceOptions.challenges?.create !== String( 'function' ) ||
            typeof serviceOptions.challenges?.consume !== String( 'function' ) ||
            typeof serviceOptions.externalIdentities?.find !== String( 'function' ) ||
            typeof serviceOptions.externalIdentities?.create !== String( 'function' ) ||
            typeof serviceOptions.secretEnvelope?.seal !== String( 'function' ) ||
            typeof serviceOptions.secretEnvelope?.open !== String( 'function' )
        )
    ){
        throw new TypeError( 'Layer Auth OIDC requires durable challenges and encrypted external identities.' );

    }

    //Requiring one-time invitations and role assignment for invite registration
    if (
        serviceOptions.configuration.registration.mode === String( 'invite' ) &&
        (
            typeof serviceOptions.invitations?.issue !== String( 'function' ) ||
            typeof serviceOptions.invitations?.consume !== String( 'function' ) ||
            typeof serviceOptions.roles?.assign !== String( 'function' )
        )
    ){
        throw new TypeError( 'Layer Auth invite registration requires invitation and role repositories.' );

    }

    const clockData = serviceOptions.clock ?? Date.now;
    let dummyPasswordHashResult = null;

    //Preparing a stable dummy hash so unknown identities still spend one Argon2 verification
    if ( serviceOptions.dummyPasswordHash === undefined ){
        dummyPasswordHashResult = layerAuthPasswordHashCreate( 'layer-auth-dummy-password-not-used-for-login' );

    } else {
        dummyPasswordHashResult = Promise.resolve( serviceOptions.dummyPasswordHash );

    }

    /**
     * @param {{
     *     type: 'email-verification' | 'password-recovery',
     *     recipient: string,
     *     userId: string,
     *     identifierId: string,
     *     lifetimeMs: number,
     *     database?: {query: Function}
     * }} challengeQueueData
     */
    //Function for recording one challenge and encrypted mail in the same boundary
    const emailChallengeQueueData = async function( challengeQueueData ){
        const challengeCreateResultData = await serviceOptions.challenges.create({
            type: challengeQueueData.type,
            subject: challengeQueueData.recipient,
            userId: challengeQueueData.userId,
            payload: Object.freeze({identifierId: challengeQueueData.identifierId}),
            attempts: Number( 5 ),
            expiresAt: Number( clockData() ) + Number( challengeQueueData.lifetimeMs ),
            database: challengeQueueData.database
        });

        //Encrypting the token and recipient before they reach the durable outbox
        await serviceOptions.mailQueue.enqueue({
            templateName: challengeQueueData.type,
            recipient: challengeQueueData.recipient,
            locale: 'en',
            payload: Object.freeze({
                token: String( challengeCreateResultData.token ),
                expiresAt: Number( challengeCreateResultData.expiresAt )
            }),
            database: challengeQueueData.database
        });

        //CallBack THE OBJECT
        return challengeCreateResultData;

    };

    /**
     * @param {string} userIdentifierData
     * @param {readonly string[]} permissionsData
     */
    //Function for resolving application authorization additions safely
    const authorizationResolveData = async function( userIdentifierData, permissionsData ){
        const permissionResultData = new Set( permissionsData.map( String ) );
        let tenantIdentifierData = null;
        const authorizationHookData = serviceOptions.configuration.authorizationResolve;

        //Calling only the trusted server hook declared by the application
        if ( typeof authorizationHookData === String( 'function' ) ){
            const authorizationHookResultData = await authorizationHookData(Object.freeze({
                auth: Object.freeze({
                    user: Object.freeze({id: String( userIdentifierData )})
                })
            }));

            if (
                authorizationHookResultData === null ||
                typeof authorizationHookResultData !== String( 'object' ) ||
                Array.isArray( authorizationHookResultData.permissions ) === false
            ){
                throw new LayerAuthError( 'AUTHORIZATION_RESOLVE_FAILED', 'Application authorization could not be resolved.' );

            }

            for ( const permissionData of authorizationHookResultData.permissions ){
                if ( typeof permissionData !== String( 'string' ) || /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u.test( permissionData ) === false ){
                    throw new LayerAuthError( 'AUTHORIZATION_RESOLVE_FAILED', 'Application authorization could not be resolved.' );

                }

                permissionResultData.add( permissionData );

            }

            if ( authorizationHookResultData.tenantId !== null && authorizationHookResultData.tenantId !== undefined ){
                tenantIdentifierData = String( authorizationHookResultData.tenantId );

            }

        }

        //CallBack THE OBJECT
        return Object.freeze({
            tenantId: tenantIdentifierData,
            permissions: Object.freeze(Array.from( permissionResultData ).sort())
        });

    };

    /**
     * @param {string} userIdentifierData
     * @param {boolean} rememberStatusData
     * @param {readonly string[]} [assuranceData]
     */
    //Function for issuing one managed session and enforcing the per-user limit
    const sessionIssueData = async function( userIdentifierData, rememberStatusData, assuranceData = ['password'] ){
        //Loading global permissions before the application-specific authorization hook
        const globalPermissionsData = await serviceOptions.users.permissionsResolve( userIdentifierData );
        const authorizationData = await authorizationResolveData( userIdentifierData, globalPermissionsData );
        const activeSessionsData = [...await serviceOptions.sessions.list( userIdentifierData )];

        //Revoking oldest sessions until the bounded account limit has capacity
        while ( Number( activeSessionsData.length ) >= Number( serviceOptions.configuration.session.maximumPerUser ) ){
            const oldestSessionData = activeSessionsData.at( -1 );

            if ( oldestSessionData === undefined ){
                break;

            }

            await serviceOptions.sessions.revokeById(
                oldestSessionData.sessionId,
                userIdentifierData,
                'session-limit'
            );
            activeSessionsData.pop();

        }

        const currentTimeData = Number( clockData() );
        let idleLifetimeData = serviceOptions.configuration.session.idleLifetimeMs;
        let absoluteLifetimeData = serviceOptions.configuration.session.absoluteLifetimeMs;

        //Selecting the longer bounded lifetimes only for an explicit remembered session
        if ( rememberStatusData === true ){
            idleLifetimeData = serviceOptions.configuration.session.rememberIdleLifetimeMs;
            absoluteLifetimeData = serviceOptions.configuration.session.rememberAbsoluteLifetimeMs;

        }

        //Creating the opaque managed session after all authorization data is resolved
        return serviceOptions.sessions.issue({
            userId: String( userIdentifierData ),
            tenantId: authorizationData.tenantId,
            permissions: authorizationData.permissions,
            assurance: Object.freeze( assuranceData.map( String ) ),
            idleLifetimeMs: Number( idleLifetimeData ),
            idleExpiresAt: Number( currentTimeData ) + Number( idleLifetimeData ),
            absoluteExpiresAt: Number( currentTimeData ) + Number( absoluteLifetimeData )
        });

    };

    let passkeyServiceData = null;
    let totpServiceData = null;
    let oidcServiceData = null;

    //Creating the WebAuthn adapter only when the RP configuration is enabled
    if ( (serviceOptions.configuration.passkey ?? null) !== null ){
        passkeyServiceData = layerAuthPasskeyServiceCreate({
            configuration: serviceOptions.configuration,
            users: serviceOptions.users,
            challenges: serviceOptions.challenges,
            passkeys: serviceOptions.passkeys,
            sessionIssue: sessionIssueData,
            clock: clockData
        });

    }

    //Creating the staged MFA adapter only when authenticator-app support is enabled
    if ( (serviceOptions.configuration.totp ?? null) !== null ){
        totpServiceData = layerAuthTotpServiceCreate({
            configuration: serviceOptions.configuration,
            users: serviceOptions.users,
            challenges: serviceOptions.challenges,
            totp: serviceOptions.totp,
            envelope: /** @type {{seal: Function, open: Function}} */ (serviceOptions.secretEnvelope),
            sessionIssue: sessionIssueData,
            clock: clockData
        });

    }

    //Creating external OIDC only when at least one provider is configured
    if ( Number( serviceOptions.configuration.oidc?.length ?? Number( 0 ) ) > Number( 0 ) ){
        const oidcServiceOptionsData = /** @type {Record<string, any>} */ ({
            configuration: serviceOptions.configuration,
            users: serviceOptions.users,
            externalIdentities: serviceOptions.externalIdentities,
            challenges: serviceOptions.challenges,
            envelope: serviceOptions.secretEnvelope,
            sessionIssue: sessionIssueData,
            clock: clockData
        });

        if ( serviceOptions.oidcEnvironment !== undefined ){
            oidcServiceOptionsData.environment = serviceOptions.oidcEnvironment;

        }

        if ( serviceOptions.oidcClient !== undefined ){
            oidcServiceOptionsData.client = serviceOptions.oidcClient;

        }

        oidcServiceData = layerAuthOidcServiceCreate( /** @type {any} */ (oidcServiceOptionsData) );

    }

    let mfaServiceData = null;

    //Exposing a narrow verification surface without duplicating enrollment methods
    if ( totpServiceData !== null ){
        mfaServiceData = Object.freeze({
            verify: totpServiceData.verify
        });

    }

    /**
     * @param {{
     *     identifier: string,
     *     password: string,
     *     invitationToken?: string,
     *     roles?: readonly string[]
     * }} registrationData
     * @param {{invitationRequired?: boolean, roles?: readonly string[]}} [registrationOptionsData]
     */
    //Function for creating an identity under a trusted registration policy
    const registrationCreateData = async function( registrationData, registrationOptionsData = {} ){
        const identifierData = layerAuthIdentifierCreate(
            registrationData?.identifier,
            serviceOptions.configuration.identifiers
        );
        layerAuthPasswordCheck(
            registrationData?.password,
            serviceOptions.configuration.password
        );

        //Hashing only after cheap validation has completed
        const passwordHashData = await layerAuthPasswordHashCreate( registrationData.password );
        const verificationRequiredStatusData = serviceOptions.configuration.emailVerification.required === true;
        const configuredRolesData = registrationOptionsData.roles ?? registrationData.roles ?? [];

        if ( Array.isArray( configuredRolesData ) === false || Number( configuredRolesData.length ) > Number( 50 ) ){
            throw new LayerAuthError( 'AUTH_REGISTRATION_UNAVAILABLE', 'Registration could not be completed.' );

        }

        //Preventing a username-only registration from entering an email verification state
        if ( verificationRequiredStatusData === true && identifierData.type !== String( 'email' ) ){
            throw new LayerAuthError( 'AUTH_IDENTIFIER_INVALID', 'A verified email address is required for registration.' );

        }

        /**
         * @param {readonly string[]} assignedRolesData
         * @param {{query: Function} | undefined} [databaseData]
         */
        //Function for recording the identity and all policy effects atomically
        const registrationIdentityCreateData = async function( assignedRolesData, databaseData ){
            let identityStatusData = String( 'active' );

            if ( verificationRequiredStatusData === true ){
                identityStatusData = String( 'pending' );

            }

            const userCreateRequestData = /** @type {Record<string, any>} */ ({
                status: identityStatusData,
                identifier: {
                    ...identifierData,
                    verified: verificationRequiredStatusData === false
                },
                password: {
                    hash: String( passwordHashData ),
                    parameters: LAYER_AUTH_ARGON2_PARAMETERS
                }
            });

            //Applying verification and invitation roles inside identity creation
            if ( verificationRequiredStatusData === true || Number( assignedRolesData.length ) > Number( 0 ) ){
                userCreateRequestData.afterCreate = async function registrationEffectsCreate(
                    /** @type {{userId: string, identifierId: string}} */ createdData,
                    /** @type {any} */ transactionData
                ){
                    if ( verificationRequiredStatusData === true ){
                        //Recording verification challenge and mail inside identity creation
                        await emailChallengeQueueData({
                            type: 'email-verification',
                            recipient: identifierData.normalized,
                            userId: createdData.userId,
                            identifierId: createdData.identifierId,
                            lifetimeMs: serviceOptions.configuration.emailVerification.lifetimeMs,
                            database: transactionData
                        });

                    }

                    for ( const roleNameData of assignedRolesData ){
                        if ( typeof serviceOptions.roles?.assign !== String( 'function' ) ){
                            throw new LayerAuthError( 'AUTH_REGISTRATION_UNAVAILABLE', 'Registration could not be completed.' );

                        }

                        const roleAssignmentStatusData = await serviceOptions.roles.assign(
                            createdData.userId,
                            roleNameData,
                            transactionData
                        );

                        if ( roleAssignmentStatusData !== true ){
                            throw new LayerAuthError( 'AUTH_INVITATION_INVALID', 'Invitation is invalid or expired.' );

                        }

                    }

                };

            }

            if ( databaseData !== undefined ){
                return serviceOptions.users.create( userCreateRequestData, databaseData );

            }

            return serviceOptions.users.create( userCreateRequestData );

        };

        try {
            let userCreateResultData = null;

            //Consuming an invitation in the same transaction as identity creation
            if ( registrationOptionsData.invitationRequired === true ){
                let invitationEmailData = null;

                if ( identifierData.type === String( 'email' ) ){
                    invitationEmailData = String( identifierData.normalized );

                }

                userCreateResultData = await serviceOptions.invitations.consume({
                    token: registrationData?.invitationToken,
                    email: invitationEmailData,
                    async effect(
                        /** @type {{id: string, roles: readonly string[]}} */ invitationData,
                        /** @type {any} */ databaseData
                    ){
                        //Creating the invited identity with only server-owned invitation roles
                        return registrationIdentityCreateData( invitationData.roles, databaseData );

                    }
                });

                if ( userCreateResultData === null ){
                    throw new LayerAuthError( 'AUTH_INVITATION_INVALID', 'Invitation is invalid or expired.' );

                }

            } else {
                //Creating an open or administrator-managed identity
                userCreateResultData = await registrationIdentityCreateData( configuredRolesData );

            }

            //CallBack THE OBJECT
            return Object.freeze({
                accepted: true,
                verificationRequired: Boolean( verificationRequiredStatusData ),
                userId: String( userCreateResultData.userId )
            });

        } catch( registrationError ){
            if ( registrationError instanceof LayerAuthError ){
                throw registrationError;

            }

            //Returning one conflict contract without exposing the existing identifier
            throw new LayerAuthError(
                'AUTH_REGISTRATION_UNAVAILABLE',
                'Registration could not be completed.',
                null,
                registrationError
            );

        }

    };

    return Object.freeze({
        authorization: Object.freeze({
            /**
             * Resolves current global and application permissions without
             * issuing a session. OAuth consent and bearer validation use this
             * server-only path so role changes apply immediately.
             *
             * @param {string} userIdentifierData
             */
            async resolve( userIdentifierData ){
                //Resolving persisted roles before applying the optional application authorization hook
                const globalPermissionsData = await serviceOptions.users.permissionsResolve(
                    userIdentifierData
                );

                return authorizationResolveData(
                    userIdentifierData,
                    globalPermissionsData
                );

            }
        }),

        registration: Object.freeze({
            /**
             * @param {{identifier: string, password: string, invitationToken?: string}} registrationData
             */
            async create( registrationData ){
                const registrationModeData = String( serviceOptions.configuration.registration.mode );

                //Allowing only explicit open or one-time invitation self-registration
                if (
                    registrationModeData !== String( 'open' ) &&
                    registrationModeData !== String( 'invite' )
                ){
                    throw new LayerAuthError( 'AUTH_REGISTRATION_DISABLED', 'Registration is not available.' );

                }

                return registrationCreateData( registrationData, {
                    invitationRequired: registrationModeData === String( 'invite' )
                });

            },

            /**
             * Trusted server-only identity creation for admin-only workflows.
             *
             * @param {{identifier: string, password: string, roles?: readonly string[]}} registrationData
             */
            async createManaged( registrationData ){
                //Creating an identity without exposing this capability as a public operation
                return registrationCreateData( registrationData, {
                    roles: registrationData?.roles ?? []
                });

            }
        }),

        invitations: Object.freeze({
            /**
             * Issues one server-only invitation credential. The token is
             * returned once and must be delivered through an application-owned
             * trusted channel.
             *
             * @param {{email?: string | null, roles?: readonly string[], expiresAt: string | number | Date, createdBy?: string | null}} invitationData
             */
            async issue( invitationData ){
                if (
                    serviceOptions.configuration.registration.mode !== String( 'invite' ) ||
                    typeof serviceOptions.invitations?.issue !== String( 'function' )
                ){
                    throw new LayerAuthError( 'AUTH_REGISTRATION_DISABLED', 'Invitation registration is not available.' );

                }

                let invitationEmailData = null;

                if ( invitationData?.email !== null && invitationData?.email !== undefined ){
                    //Normalizing a bound email through the same public identity policy
                    const invitationIdentifierData = layerAuthIdentifierCreate(
                        invitationData.email,
                        {
                            email: true,
                            username: false
                        }
                    );
                    invitationEmailData = invitationIdentifierData.normalized;

                }

                //Issuing the opaque token only to trusted server code
                return serviceOptions.invitations.issue({
                    ...invitationData,
                    email: invitationEmailData
                });

            }
        }),

        emailVerification: Object.freeze({
            /** @param {{token: string}} verificationData */
            async confirm( verificationData ){
                //Consuming the token together with identifier activation
                const challengeConsumeResultData = await serviceOptions.challenges.consume({
                    type: 'email-verification',
                    token: verificationData?.token,
                    async effect(
                        /** @type {{userId: string | null, payload: Readonly<Record<string, unknown>>}} */ challengeData,
                        /** @type {any} */ databaseData
                    ){
                        //Reading the identifier reference only after the one-time token is consumed
                        const identifierData = challengeData.payload.identifierId;

                        if ( challengeData.userId === null || typeof identifierData !== String( 'string' ) ){
                            throw new LayerAuthError( 'AUTH_CHALLENGE_INVALID', 'Verification token is invalid or expired.' );

                        }

                        const verificationStatusData = await serviceOptions.users.identifierVerify(
                            challengeData.userId,
                            identifierData,
                            databaseData
                        );

                        if ( verificationStatusData !== true ){
                            throw new LayerAuthError( 'AUTH_CHALLENGE_INVALID', 'Verification token is invalid or expired.' );

                        }

                    }
                });

                if ( challengeConsumeResultData === null ){
                    throw new LayerAuthError( 'AUTH_CHALLENGE_INVALID', 'Verification token is invalid or expired.' );

                }

                //CallBack THE OBJECT
                return Object.freeze({verified: true});

            },

            /** @param {{identifier: string}} verificationData */
            async request( verificationData ){
                const identifierData = layerAuthIdentifierCreate(
                    verificationData?.identifier,
                    serviceOptions.configuration.identifiers
                );

                //Returning one accepted contract regardless of account presence
                if ( identifierData.type !== String( 'email' ) ){
                    return Object.freeze({accepted: true});

                }

                const identityData = await serviceOptions.users.findByIdentifier(
                    identifierData.type,
                    identifierData.normalized
                );

                if ( identityData !== null && identityData.status === String( 'pending' ) && identityData.verified !== true ){
                    await emailChallengeQueueData({
                        type: 'email-verification',
                        recipient: identifierData.normalized,
                        userId: identityData.userId,
                        identifierId: identityData.identifierId,
                        lifetimeMs: serviceOptions.configuration.emailVerification.lifetimeMs
                    });

                }

                //CallBack THE OBJECT
                return Object.freeze({accepted: true});

            }
        }),

        passwordRecovery: Object.freeze({
            /** @param {{identifier: string}} recoveryData */
            async request( recoveryData ){
                if ( serviceOptions.configuration.passwordRecovery.enabled !== true ){
                    throw new LayerAuthError( 'AUTH_RECOVERY_UNAVAILABLE', 'Password recovery is not available.' );

                }

                const identifierData = layerAuthIdentifierCreate(
                    recoveryData?.identifier,
                    serviceOptions.configuration.identifiers
                );
                const identityData = await serviceOptions.users.findByIdentifier(
                    identifierData.type,
                    identifierData.normalized
                );

                //Keeping the public result identical for missing and ineligible identities
                if (
                    identifierData.type === String( 'email' ) &&
                    identityData !== null &&
                    identityData.status === String( 'active' ) &&
                    identityData.verified === true &&
                    identityData.passwordHash !== null
                ){
                    await emailChallengeQueueData({
                        type: 'password-recovery',
                        recipient: identifierData.normalized,
                        userId: identityData.userId,
                        identifierId: identityData.identifierId,
                        lifetimeMs: serviceOptions.configuration.passwordRecovery.lifetimeMs
                    });

                }

                //CallBack THE OBJECT
                return Object.freeze({accepted: true});

            },

            /** @param {{token: string, password: string}} recoveryData */
            async complete( recoveryData ){
                if ( serviceOptions.configuration.passwordRecovery.enabled !== true ){
                    throw new LayerAuthError( 'AUTH_RECOVERY_UNAVAILABLE', 'Password recovery is not available.' );

                }

                layerAuthPasswordCheck(
                    recoveryData?.password,
                    serviceOptions.configuration.password
                );

                //Hashing before challenge lookup keeps invalid-token work intentionally expensive
                const passwordHashData = await layerAuthPasswordHashCreate( recoveryData.password );
                const challengeConsumeResultData = await serviceOptions.challenges.consume({
                    type: 'password-recovery',
                    token: recoveryData?.token,
                    async effect(
                        /** @type {{userId: string | null, payload: Readonly<Record<string, unknown>>}} */ challengeData,
                        /** @type {any} */ databaseData
                    ){
                        if ( challengeData.userId === null ){
                            throw new LayerAuthError( 'AUTH_CHALLENGE_INVALID', 'Recovery token is invalid or expired.' );

                        }

                        const passwordUpdateStatusData = await serviceOptions.users.passwordReplace(
                            challengeData.userId,
                            {
                                hash: String( passwordHashData ),
                                parameters: LAYER_AUTH_ARGON2_PARAMETERS
                            },
                            databaseData
                        );

                        if ( passwordUpdateStatusData !== true ){
                            throw new LayerAuthError( 'AUTH_CHALLENGE_INVALID', 'Recovery token is invalid or expired.' );

                        }

                        //Revoking all browser sessions in the same recovery transaction
                        await serviceOptions.sessions.revokeAllByUser(
                            challengeData.userId,
                            'password-recovery',
                            databaseData
                        );

                    }
                });

                if ( challengeConsumeResultData === null ){
                    throw new LayerAuthError( 'AUTH_CHALLENGE_INVALID', 'Recovery token is invalid or expired.' );

                }

                //CallBack THE OBJECT
                return Object.freeze({completed: true});

            }
        }),

        passkey: passkeyServiceData,
        totp: totpServiceData,
        oidc: oidcServiceData,
        mfa: mfaServiceData,

        signIn: Object.freeze({
            /**
             * Issues a managed session after a trusted application operation
             * has verified and consumed a phone OTP.
             *
             * @param {{phone: string, remember?: boolean}} signInData
             */
            async verifiedPhone( signInData ){
                //Normalizing a phone number using the same identity policy as registration
                const phoneIdentifierData = layerAuthIdentifierCreate(
                    signInData?.phone,
                    serviceOptions.configuration.identifiers
                );

                if ( phoneIdentifierData.type !== String( 'phone' ) ){
                    throw new LayerAuthError( 'AUTH_IDENTIFIER_INVALID', 'Phone identifier is invalid.' );

                }

                //Loading only the verified and active phone identity
                let phoneIdentityData = await serviceOptions.users.findByIdentifier(
                    'phone',
                    phoneIdentifierData.normalized
                );

                if ( phoneIdentityData === null ){
                    try {
                        //Creating an account only after the caller has verified the code
                        if ( serviceOptions.configuration.registration.mode !== String( 'open' ) ){
                            throw new LayerAuthError( 'AUTH_REGISTRATION_DISABLED', 'Phone registration is not available.' );

                        }

                        await serviceOptions.users.create({
                            status: 'active',
                            identifier: {...phoneIdentifierData, verified: true},
                            password: null
                        });

                    } catch( registrationError ){
                        //Allowing a concurrent verified request to have created the same account
                        phoneIdentityData = await serviceOptions.users.findByIdentifier(
                            'phone',
                            phoneIdentifierData.normalized
                        );

                        if ( phoneIdentityData === null ){
                            throw registrationError;

                        }

                    }

                    if ( phoneIdentityData === null ){
                        phoneIdentityData = await serviceOptions.users.findByIdentifier(
                            'phone',
                            phoneIdentifierData.normalized
                        );

                    }

                }

                //Rejecting disabled or unverified accounts before issuing a session
                if ( phoneIdentityData?.status !== String( 'active' ) || phoneIdentityData.verified !== true ){
                    throw new LayerAuthError( 'AUTH_CREDENTIALS_INVALID', 'Phone identity is unavailable.' );

                }

                const sessionIssueResultData = await sessionIssueData(
                    phoneIdentityData.userId,
                    signInData.remember === true,
                    ['phone']
                );

                //CallBack THE OBJECT
                return Object.freeze({
                    userId: String( phoneIdentityData.userId ),
                    session: sessionIssueResultData
                });

            },

            /**
             * @param {{identifier: string, password: string, remember?: boolean}} signInData
             */
            async password( signInData ){
                const identifierData = layerAuthIdentifierCreate(
                    signInData?.identifier,
                    serviceOptions.configuration.identifiers
                );
                const identityData = await serviceOptions.users.findByIdentifier(
                    identifierData.type,
                    identifierData.normalized
                );
                const dummyPasswordHashData = await dummyPasswordHashResult;
                const passwordHashData = identityData?.passwordHash ?? dummyPasswordHashData;
                let passwordData = String();

                //Accepting only a string password while preserving the constant verification path
                if ( typeof signInData?.password === String( 'string' ) ){
                    passwordData = signInData.password;

                }

                //Always performing one Argon2 verification to reduce identifier enumeration timing
                const passwordVerificationStatusData = await layerAuthPasswordVerify(
                    passwordHashData,
                    passwordData
                );

                if (
                    identityData === null ||
                    passwordVerificationStatusData === false ||
                    identityData.status === String( 'disabled' ) ||
                    identityData.status === String( 'anonymized' ) ||
                    identityData.status === String( 'anonymization-pending' )
                ){
                    throw new LayerAuthError( 'AUTH_CREDENTIALS_INVALID', 'Login identifier or password is invalid.' );

                }

                //Separating correct credentials from the optional verification requirement
                if (
                    serviceOptions.configuration.emailVerification.required === true &&
                    identityData.verified !== true
                ){
                    throw new LayerAuthError( 'AUTH_EMAIL_VERIFICATION_REQUIRED', 'Email verification is required.' );

                }

                //Stopping before session issuance when this identity owns an active second factor
                if ( totpServiceData !== null && await totpServiceData.isEnabled( identityData.userId ) === true ){
                    return totpServiceData.challenge(
                        identityData.userId,
                        signInData.remember === true
                    );

                }

                const sessionIssueResultData = await sessionIssueData(
                    identityData.userId,
                    signInData.remember === true
                );

                //CallBack THE OBJECT
                return Object.freeze({
                    userId: String( identityData.userId ),
                    session: sessionIssueResultData
                });

            }
        }),

        sessions: Object.freeze({
            /** @param {string} userIdentifierData */
            async list( userIdentifierData ){
                //Returning only sessions owned by the server-derived user identifier
                return serviceOptions.sessions.list( userIdentifierData );

            },

            /**
             * @param {string} sessionIdentifierData
             * @param {string} userIdentifierData
             */
            async revoke( sessionIdentifierData, userIdentifierData ){
                //Revoking the selected session with an auditable user-request reason
                return serviceOptions.sessions.revokeById(
                    sessionIdentifierData,
                    userIdentifierData,
                    'user-request'
                );

            }
        })
    });

}
