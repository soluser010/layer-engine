import {randomBytes} from 'node:crypto';
import {
    Secret,
    TOTP
} from 'otpauth';
import {LayerAuthError} from './auth-error.js';


const recoveryCodeAlphabetData = String( 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' );
const totpEnvelopePurposeData = String( 'totp-secret' );


/**
 * Creates encrypted TOTP enrollment, replay-safe verification, and recovery codes.
 *
 * @param {{
 *     configuration: Readonly<Record<string, any>>,
 *     users: any,
 *     challenges: any,
 *     totp: any,
 *     envelope: {seal: Function, open: Function},
 *     sessionIssue: (userIdentifierData: string, rememberStatusData: boolean, assuranceData: readonly string[]) => Promise<any>,
 *     clock?: () => number,
 *     randomBytesCreate?: (sizeData: number) => Buffer
 * }} serviceOptions
 */
export function layerAuthTotpServiceCreate( serviceOptions ){
    //Checking every secret, persistence, and staged-session dependency
    if (
        serviceOptions === null ||
        typeof serviceOptions !== String( 'object' ) ||
        (serviceOptions.configuration?.totp ?? null) === null ||
        typeof serviceOptions.users?.identifiersList !== String( 'function' ) ||
        typeof serviceOptions.challenges?.create !== String( 'function' ) ||
        typeof serviceOptions.challenges?.consume !== String( 'function' ) ||
        typeof serviceOptions.totp?.pendingSave !== String( 'function' ) ||
        typeof serviceOptions.totp?.get !== String( 'function' ) ||
        typeof serviceOptions.totp?.confirm !== String( 'function' ) ||
        typeof serviceOptions.totp?.counterAdvance !== String( 'function' ) ||
        typeof serviceOptions.totp?.recoveryCodeConsume !== String( 'function' ) ||
        typeof serviceOptions.totp?.recoveryCodesReplace !== String( 'function' ) ||
        typeof serviceOptions.totp?.remove !== String( 'function' ) ||
        typeof serviceOptions.envelope?.seal !== String( 'function' ) ||
        typeof serviceOptions.envelope?.open !== String( 'function' ) ||
        typeof serviceOptions.sessionIssue !== String( 'function' )
    ){
        throw new TypeError( 'Layer Auth TOTP service requires configuration, encrypted storage, and durable challenges.' );

    }

    const totpConfigurationData = serviceOptions.configuration.totp;
    const clockData = serviceOptions.clock ?? Date.now;
    const randomBytesCreateData = serviceOptions.randomBytesCreate ?? randomBytes;

    //Function for creating one high-entropy human-readable recovery code
    const recoveryCodeCreateData = function(){
        const recoveryBytesData = randomBytesCreateData( Number( 12 ) );
        let recoveryCodeData = String();

        for ( let recoveryIndexData = Number( 0 ); recoveryIndexData < Number( 12 ); recoveryIndexData += Number( 1 ) ){
            if ( Number( recoveryIndexData ) > Number( 0 ) && Number( recoveryIndexData % Number( 4 ) ) === Number( 0 ) ){
                recoveryCodeData += String( '-' );

            }

            recoveryCodeData += recoveryCodeAlphabetData[Number( recoveryBytesData[recoveryIndexData] ) % Number( recoveryCodeAlphabetData.length )];

        }

        //CallBack THE STRING
        return recoveryCodeData;

    };

    //Function for creating one bounded unique recovery-code set
    const recoveryCodesCreateData = function(){
        const recoveryCodesData = new Set();

        while ( Number( recoveryCodesData.size ) < Number( totpConfigurationData.recoveryCodeCount ) ){
            recoveryCodesData.add( recoveryCodeCreateData() );

        }

        //CallBack THE OBJECT
        return Object.freeze( Array.from( recoveryCodesData ) );

    };

    /** @param {any} credentialData */
    //Function for opening a purpose-bound TOTP seed
    const totpSecretOpenData = function( credentialData ){
        const secretEnvelopeData = serviceOptions.envelope.open(
            credentialData.encryptedSecret,
            totpEnvelopePurposeData
        );

        if (
            secretEnvelopeData === null ||
            typeof secretEnvelopeData !== String( 'object' ) ||
            typeof secretEnvelopeData.base32 !== String( 'string' )
        ){
            throw new LayerAuthError( 'AUTH_TOTP_UNAVAILABLE', 'Authenticator verification is unavailable.' );

        }

        //CallBack THE OBJECT
        return Secret.fromBase32( secretEnvelopeData.base32 );

    };

    /** @param {any} credentialData @param {string} tokenData @param {any} [databaseData] */
    //Function for verifying and consuming one TOTP time step
    const totpTokenConsumeData = async function( credentialData, tokenData, databaseData = undefined ){
        if ( typeof tokenData !== String( 'string' ) || /^\d{6,8}$/u.test( tokenData ) === false ){
            throw new LayerAuthError( 'AUTH_MFA_INVALID', 'The multi-factor credential is invalid or expired.' );

        }

        const secretData = totpSecretOpenData( credentialData );
        const totpData = new TOTP({
            secret: secretData,
            algorithm: credentialData.algorithm,
            digits: credentialData.digits,
            period: credentialData.period
        });
        const tokenDeltaData = totpData.validate({
            token: tokenData,
            timestamp: Number( clockData() ),
            window: Number( totpConfigurationData.window )
        });

        if ( tokenDeltaData === null ){
            throw new LayerAuthError( 'AUTH_MFA_INVALID', 'The multi-factor credential is invalid or expired.' );

        }

        const currentCounterData = TOTP.counter({
            period: credentialData.period,
            timestamp: Number( clockData() )
        });
        const verifiedCounterData = Number( currentCounterData ) + Number( tokenDeltaData );
        const counterAdvanceStatusData = await serviceOptions.totp.counterAdvance({
            userId: credentialData.userId,
            expectedCounter: credentialData.lastCounter,
            counter: verifiedCounterData
        }, databaseData);

        if ( counterAdvanceStatusData !== true ){
            throw new LayerAuthError( 'AUTH_TOTP_REPLAY', 'The authenticator code was already used.' );

        }

        //CallBack THE NUMBER
        return verifiedCounterData;

    };

    return Object.freeze({
        /** @param {string} userIdentifierData */
        async isEnabled( userIdentifierData ){
            const credentialData = await serviceOptions.totp.get( userIdentifierData );

            //CallBack THE BOOLEAN
            return credentialData !== null && credentialData.confirmedAt !== null;

        },

        enrollment: Object.freeze({
            /** @param {string} userIdentifierData */
            async begin( userIdentifierData ){
                const identifiersData = await serviceOptions.users.identifiersList( userIdentifierData );
                let accountLabelData = String( userIdentifierData );

                //Selecting a verified identity label for the authenticator application
                for ( const identifierData of identifiersData ){
                    if ( identifierData.verified === true ){
                        accountLabelData = String( identifierData.display );
                        break;

                    }

                }

                const secretData = new Secret({size: 20});
                const totpData = new TOTP({
                    issuer: String( totpConfigurationData.issuer ),
                    label: String( accountLabelData ),
                    secret: secretData,
                    algorithm: String( totpConfigurationData.algorithm ),
                    digits: Number( totpConfigurationData.digits ),
                    period: Number( totpConfigurationData.period )
                });
                const encryptedSecretData = serviceOptions.envelope.seal(
                    Object.freeze({base32: String( secretData.base32 )}),
                    totpEnvelopePurposeData
                );
                const saveStatusData = await serviceOptions.totp.pendingSave({
                    userId: String( userIdentifierData ),
                    encryptedSecret: encryptedSecretData,
                    keyId: 'v1',
                    algorithm: String( totpConfigurationData.algorithm ),
                    digits: Number( totpConfigurationData.digits ),
                    period: Number( totpConfigurationData.period )
                });

                if ( saveStatusData !== true ){
                    throw new LayerAuthError( 'AUTH_TOTP_UNAVAILABLE', 'Authenticator enrollment could not be started.' );

                }

                //Returning the seed only once so the application can render a local QR code
                return Object.freeze({
                    secret: String( secretData.base32 ),
                    uri: String( totpData.toString() )
                });

            },

            /** @param {string} userIdentifierData @param {string} tokenData */
            async confirm( userIdentifierData, tokenData ){
                const credentialData = await serviceOptions.totp.get( userIdentifierData );

                if ( credentialData === null || credentialData.confirmedAt !== null ){
                    throw new LayerAuthError( 'AUTH_TOTP_UNAVAILABLE', 'Authenticator enrollment is unavailable.' );

                }

                const secretData = totpSecretOpenData( credentialData );
                const tokenDeltaData = TOTP.validate({
                    token: tokenData,
                    secret: secretData,
                    algorithm: credentialData.algorithm,
                    digits: credentialData.digits,
                    period: credentialData.period,
                    timestamp: Number( clockData() ),
                    window: Number( totpConfigurationData.window )
                });

                if ( tokenDeltaData === null ){
                    throw new LayerAuthError( 'AUTH_MFA_INVALID', 'The multi-factor credential is invalid or expired.' );

                }

                const counterData = Number(TOTP.counter({
                    period: credentialData.period,
                    timestamp: Number( clockData() )
                })) + Number( tokenDeltaData );
                const recoveryCodesData = recoveryCodesCreateData();
                const confirmStatusData = await serviceOptions.totp.confirm({
                    userId: String( userIdentifierData ),
                    counter: Number( counterData ),
                    recoveryCodes: recoveryCodesData
                });

                if ( confirmStatusData !== true ){
                    throw new LayerAuthError( 'AUTH_TOTP_REPLAY', 'Authenticator enrollment was already completed.' );

                }

                //Returning recovery codes only at the confirmation boundary
                return Object.freeze({
                    enabled: true,
                    recoveryCodes: recoveryCodesData
                });

            }
        }),

        /** @param {string} userIdentifierData @param {boolean} rememberStatusData */
        async challenge( userIdentifierData, rememberStatusData ){
            const challengeCreateResultData = await serviceOptions.challenges.create({
                type: 'mfa-totp',
                subject: String( userIdentifierData ),
                userId: String( userIdentifierData ),
                payload: Object.freeze({remember: rememberStatusData === true}),
                attempts: Number( 5 ),
                expiresAt: Number( clockData() ) + Number( 300000 )
            });

            //CallBack THE OBJECT
            return Object.freeze({
                mfaRequired: true,
                challenge: String( challengeCreateResultData.token ),
                expiresAt: Number( challengeCreateResultData.expiresAt ),
                methods: Object.freeze(['totp', 'recovery-code'])
            });

        },

        /** @param {{challenge: string, code?: string, recoveryCode?: string}} verificationData */
        async verify( verificationData ){
            let verifiedUserIdentifierData = null;
            let rememberStatusData = false;
            let assuranceMethodData = String( 'totp' );

            const challengeConsumeResultData = await serviceOptions.challenges.consume({
                type: 'mfa-totp',
                token: verificationData?.challenge,
                async effect(
                    /** @type {{userId: string | null, payload: Readonly<Record<string, any>>}} */ challengeData,
                    /** @type {any} */ databaseData
                ){
                    if ( challengeData.userId === null ){
                        throw new LayerAuthError( 'AUTH_MFA_INVALID', 'The multi-factor credential is invalid or expired.' );

                    }

                    const credentialData = await serviceOptions.totp.get(
                        challengeData.userId,
                        databaseData
                    );

                    if ( credentialData === null || credentialData.confirmedAt === null ){
                        throw new LayerAuthError( 'AUTH_MFA_INVALID', 'The multi-factor credential is invalid or expired.' );

                    }

                    //Consuming exactly one selected second-factor credential
                    if ( typeof verificationData.code === String( 'string' ) ){
                        const tokenData = String( verificationData.code );
                        await totpTokenConsumeData( credentialData, tokenData, databaseData );

                    } else if ( typeof verificationData.recoveryCode === String( 'string' ) ){
                        const recoveryConsumeStatusData = await serviceOptions.totp.recoveryCodeConsume(
                            challengeData.userId,
                            verificationData.recoveryCode,
                            databaseData
                        );

                        if ( recoveryConsumeStatusData !== true ){
                            throw new LayerAuthError( 'AUTH_MFA_INVALID', 'The multi-factor credential is invalid or expired.' );

                        }

                        assuranceMethodData = String( 'recovery-code' );

                    } else {
                        throw new LayerAuthError( 'AUTH_MFA_INVALID', 'The multi-factor credential is invalid or expired.' );

                    }

                    verifiedUserIdentifierData = String( challengeData.userId );
                    rememberStatusData = challengeData.payload?.remember === true;

                }
            });

            if ( challengeConsumeResultData === null || verifiedUserIdentifierData === null ){
                throw new LayerAuthError( 'AUTH_MFA_INVALID', 'The multi-factor credential is invalid or expired.' );

            }

            const sessionIssueResultData = await serviceOptions.sessionIssue(
                verifiedUserIdentifierData,
                rememberStatusData,
                Object.freeze(['password', assuranceMethodData])
            );

            //CallBack THE OBJECT
            return Object.freeze({
                userId: String( verifiedUserIdentifierData ),
                session: sessionIssueResultData
            });

        },

        /** @param {string} userIdentifierData @param {string} tokenData */
        async recoveryCodesRotate( userIdentifierData, tokenData ){
            const credentialData = await serviceOptions.totp.get( userIdentifierData );

            if ( credentialData === null || credentialData.confirmedAt === null ){
                throw new LayerAuthError( 'AUTH_TOTP_UNAVAILABLE', 'Authenticator verification is unavailable.' );

            }

            await totpTokenConsumeData( credentialData, tokenData );
            const recoveryCodesData = recoveryCodesCreateData();
            await serviceOptions.totp.recoveryCodesReplace( userIdentifierData, recoveryCodesData );

            //CallBack THE OBJECT
            return Object.freeze({recoveryCodes: recoveryCodesData});

        },

        /** @param {string} userIdentifierData @param {string} tokenData */
        async disable( userIdentifierData, tokenData ){
            const credentialData = await serviceOptions.totp.get( userIdentifierData );

            if ( credentialData === null || credentialData.confirmedAt === null ){
                throw new LayerAuthError( 'AUTH_TOTP_UNAVAILABLE', 'Authenticator verification is unavailable.' );

            }

            await totpTokenConsumeData( credentialData, tokenData );
            const removeStatusData = await serviceOptions.totp.remove( userIdentifierData );

            //CallBack THE OBJECT
            return Object.freeze({disabled: removeStatusData === true});

        }
    });

}
