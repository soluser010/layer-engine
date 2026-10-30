import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse
} from '@simplewebauthn/server';
import {LayerAuthError} from './auth-error.js';


/**
 * Creates the SimpleWebAuthn Passkey lifecycle over Layer-owned repositories.
 *
 * @param {{
 *     configuration: Readonly<Record<string, any>>,
 *     users: any,
 *     challenges: any,
 *     passkeys: any,
 *     sessionIssue: (userIdentifierData: string, rememberStatusData: boolean, assuranceData: readonly string[]) => Promise<any>,
 *     clock?: () => number,
 *     webAuthn?: {
 *         generateRegistrationOptions: typeof generateRegistrationOptions,
 *         verifyRegistrationResponse: typeof verifyRegistrationResponse,
 *         generateAuthenticationOptions: typeof generateAuthenticationOptions,
 *         verifyAuthenticationResponse: typeof verifyAuthenticationResponse
 *     }
 * }} serviceOptions
 */
export function layerAuthPasskeyServiceCreate( serviceOptions ){
    //Checking feature configuration and persistence before WebAuthn work
    if (
        serviceOptions === null ||
        typeof serviceOptions !== String( 'object' ) ||
        (serviceOptions.configuration?.passkey ?? null) === null ||
        typeof serviceOptions.users?.identifiersList !== String( 'function' ) ||
        typeof serviceOptions.challenges?.create !== String( 'function' ) ||
        typeof serviceOptions.challenges?.consume !== String( 'function' ) ||
        typeof serviceOptions.passkeys?.create !== String( 'function' ) ||
        typeof serviceOptions.passkeys?.findByCredentialId !== String( 'function' ) ||
        typeof serviceOptions.passkeys?.counterAdvance !== String( 'function' ) ||
        typeof serviceOptions.passkeys?.listForUser !== String( 'function' ) ||
        typeof serviceOptions.passkeys?.remove !== String( 'function' ) ||
        typeof serviceOptions.sessionIssue !== String( 'function' )
    ){
        throw new TypeError( 'Layer Auth Passkey service requires WebAuthn configuration and repositories.' );

    }

    const passkeyConfigurationData = serviceOptions.configuration.passkey;
    const clockData = serviceOptions.clock ?? Date.now;
    const webAuthnData = serviceOptions.webAuthn ?? {
        generateRegistrationOptions,
        verifyRegistrationResponse,
        generateAuthenticationOptions,
        verifyAuthenticationResponse
    };
    const userVerificationRequiredStatusData = passkeyConfigurationData.userVerification === String( 'required' );

    return Object.freeze({
        registration: Object.freeze({
            /** @param {string} userIdentifierData */
            async begin( userIdentifierData ){
                const identifiersData = await serviceOptions.users.identifiersList( userIdentifierData );
                const passkeysData = await serviceOptions.passkeys.listForUser( userIdentifierData );
                let userNameData = String( userIdentifierData );

                //Selecting only a verified identifier as the authenticator label
                for ( const identifierData of identifiersData ){
                    if ( identifierData.verified === true ){
                        userNameData = String( identifierData.display );
                        break;

                    }

                }

                const registrationOptionsData = await webAuthnData.generateRegistrationOptions({
                    rpName: String( passkeyConfigurationData.rpName ),
                    rpID: String( passkeyConfigurationData.rpId ),
                    userName: String( userNameData ),
                    userID: Buffer.from( userIdentifierData, 'utf8' ),
                    userDisplayName: String( userNameData ),
                    timeout: Number( passkeyConfigurationData.timeoutMs ),
                    attestationType: 'none',
                    excludeCredentials: passkeysData.map(function passkeyExcludeCreate( /** @type {any} */ passkeyData ){
                        //Mapping persisted credentials to the WebAuthn exclusion contract
                        return {
                            id: passkeyData.credentialId,
                            transports: passkeyData.transports
                        };

                    }),
                    authenticatorSelection: {
                        residentKey: 'preferred',
                        userVerification: passkeyConfigurationData.userVerification
                    }
                });

                //Persisting only the challenge HMAC before sending options to the browser
                await serviceOptions.challenges.create({
                    type: 'passkey-registration',
                    subject: String( userIdentifierData ),
                    userId: String( userIdentifierData ),
                    token: String( registrationOptionsData.challenge ),
                    payload: {},
                    attempts: Number( 3 ),
                    expiresAt: Number( clockData() ) + Number( passkeyConfigurationData.timeoutMs )
                });

                //CallBack THE OBJECT
                return Object.freeze({options: registrationOptionsData});

            },

            /**
             * @param {string} userIdentifierData
             * @param {{challenge: string, response: any, displayName?: string}} registrationData
             */
            async complete( userIdentifierData, registrationData ){
                let registeredPasskeyData = null;

                try {
                    const challengeConsumeResultData = await serviceOptions.challenges.consume({
                        type: 'passkey-registration',
                        token: registrationData?.challenge,
                        async effect(
                            /** @type {{userId: string | null}} */ challengeData,
                            /** @type {any} */ databaseData
                        ){
                            //Binding the consumed challenge to the current authenticated user
                            if ( challengeData.userId !== String( userIdentifierData ) ){
                                throw new LayerAuthError( 'AUTH_PASSKEY_INVALID', 'Passkey registration is invalid or expired.' );

                            }

                            const verificationResultData = await webAuthnData.verifyRegistrationResponse({
                                response: registrationData.response,
                                expectedChallenge: registrationData.challenge,
                                expectedOrigin: [...passkeyConfigurationData.origins],
                                expectedRPID: passkeyConfigurationData.rpId,
                                requireUserVerification: userVerificationRequiredStatusData
                            });

                            if ( verificationResultData.verified !== true ){
                                throw new LayerAuthError( 'AUTH_PASSKEY_INVALID', 'Passkey registration is invalid or expired.' );

                            }

                            const registrationInformationData = verificationResultData.registrationInfo;
                            const credentialData = registrationInformationData.credential;
                            const transportData = registrationData.response?.response?.transports ?? [];
                            let displayNameData = String( registrationData.displayName ?? 'Passkey' ).trim();

                            if ( Number( displayNameData.length ) < Number( 1 ) || Number( displayNameData.length ) > Number( 120 ) ){
                                displayNameData = String( 'Passkey' );

                            }

                            const passkeyCreateStatusData = await serviceOptions.passkeys.create({
                                credentialId: credentialData.id,
                                userId: String( userIdentifierData ),
                                publicKey: credentialData.publicKey,
                                counter: credentialData.counter,
                                transports: transportData,
                                backupEligible: registrationInformationData.credentialDeviceType === String( 'multiDevice' ),
                                backupState: registrationInformationData.credentialBackedUp === true,
                                displayName: displayNameData
                            }, databaseData );

                            if ( passkeyCreateStatusData !== true ){
                                throw new LayerAuthError( 'AUTH_PASSKEY_INVALID', 'Passkey registration is invalid or expired.' );

                            }

                            registeredPasskeyData = Object.freeze({
                                credentialId: String( credentialData.id ),
                                displayName: String( displayNameData )
                            });

                        }
                    });

                    if ( challengeConsumeResultData === null || registeredPasskeyData === null ){
                        throw new LayerAuthError( 'AUTH_PASSKEY_INVALID', 'Passkey registration is invalid or expired.' );

                    }

                    //CallBack THE OBJECT
                    return Object.freeze({
                        registered: true,
                        passkey: registeredPasskeyData
                    });

                } catch( registrationErrorData ){
                    if ( registrationErrorData instanceof LayerAuthError ){
                        throw registrationErrorData;

                    }

                    throw new LayerAuthError(
                        'AUTH_PASSKEY_INVALID',
                        'Passkey registration is invalid or expired.',
                        null,
                        registrationErrorData
                    );

                }

            }
        }),

        signIn: Object.freeze({
            async begin(){
                const authenticationOptionsData = await webAuthnData.generateAuthenticationOptions({
                    rpID: String( passkeyConfigurationData.rpId ),
                    timeout: Number( passkeyConfigurationData.timeoutMs ),
                    userVerification: passkeyConfigurationData.userVerification
                });

                //Keeping independent discoverable-credential challenges from invalidating each other
                await serviceOptions.challenges.create({
                    type: 'passkey-authentication',
                    subject: String( authenticationOptionsData.challenge ),
                    userId: null,
                    token: String( authenticationOptionsData.challenge ),
                    payload: {},
                    attempts: Number( 3 ),
                    expiresAt: Number( clockData() ) + Number( passkeyConfigurationData.timeoutMs )
                });

                //CallBack THE OBJECT
                return Object.freeze({options: authenticationOptionsData});

            },

            /** @param {{challenge: string, response: any, remember?: boolean}} authenticationData */
            async complete( authenticationData ){
                const credentialIdentifierData = authenticationData?.response?.id;

                if ( typeof credentialIdentifierData !== 'string' ){
                    throw new LayerAuthError( 'AUTH_PASSKEY_INVALID', 'Passkey authentication is invalid or expired.' );

                }

                const passkeyData = await serviceOptions.passkeys.findByCredentialId( credentialIdentifierData );

                if ( passkeyData === null || passkeyData.userStatus !== String( 'active' ) ){
                    throw new LayerAuthError( 'AUTH_PASSKEY_INVALID', 'Passkey authentication is invalid or expired.' );

                }

                try {
                    const challengeConsumeResultData = await serviceOptions.challenges.consume({
                        type: 'passkey-authentication',
                        token: authenticationData.challenge,
                        async effect(
                            /** @type {{userId: string | null}} */ challengeData,
                            /** @type {any} */ databaseData
                        ){
                            //Verifying the assertion only after atomically consuming its challenge
                            void challengeData;
                            const verificationResultData = await webAuthnData.verifyAuthenticationResponse({
                                response: authenticationData.response,
                                expectedChallenge: authenticationData.challenge,
                                expectedOrigin: [...passkeyConfigurationData.origins],
                                expectedRPID: passkeyConfigurationData.rpId,
                                credential: {
                                    id: passkeyData.credentialId,
                                    publicKey: passkeyData.publicKey,
                                    counter: passkeyData.counter,
                                    transports: [...passkeyData.transports]
                                },
                                requireUserVerification: userVerificationRequiredStatusData
                            });

                            if ( verificationResultData.verified !== true ){
                                throw new LayerAuthError( 'AUTH_PASSKEY_INVALID', 'Passkey authentication is invalid or expired.' );

                            }

                            const counterAdvanceStatusData = await serviceOptions.passkeys.counterAdvance({
                                credentialId: passkeyData.credentialId,
                                userId: passkeyData.userId,
                                expectedCounter: passkeyData.counter,
                                newCounter: verificationResultData.authenticationInfo.newCounter,
                                backupState: verificationResultData.authenticationInfo.credentialBackedUp === true
                            }, databaseData );

                            if ( counterAdvanceStatusData !== true ){
                                throw new LayerAuthError( 'AUTH_PASSKEY_REPLAY', 'Passkey authentication could not be completed.' );

                            }

                        }
                    });

                    if ( challengeConsumeResultData === null ){
                        throw new LayerAuthError( 'AUTH_PASSKEY_INVALID', 'Passkey authentication is invalid or expired.' );

                    }

                    const sessionIssueResultData = await serviceOptions.sessionIssue(
                        passkeyData.userId,
                        authenticationData.remember === true,
                        Object.freeze(['passkey'])
                    );

                    //CallBack THE OBJECT
                    return Object.freeze({
                        userId: String( passkeyData.userId ),
                        session: sessionIssueResultData
                    });

                } catch( authenticationErrorData ){
                    if ( authenticationErrorData instanceof LayerAuthError ){
                        throw authenticationErrorData;

                    }

                    throw new LayerAuthError(
                        'AUTH_PASSKEY_INVALID',
                        'Passkey authentication is invalid or expired.',
                        null,
                        authenticationErrorData
                    );

                }

            }
        }),

        /** @param {string} userIdentifierData */
        list( userIdentifierData ){
            //Returning public credential metadata owned by the selected user
            return serviceOptions.passkeys.listForUser( userIdentifierData );

        },

        /** @param {string} userIdentifierData @param {string} credentialIdentifierData */
        remove( userIdentifierData, credentialIdentifierData ){
            //Removing only the credential owned by the selected user
            return serviceOptions.passkeys.remove( credentialIdentifierData, userIdentifierData );

        }
    });

}
