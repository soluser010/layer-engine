import assert from 'node:assert/strict';
import test from 'node:test';
import {
    Secret,
    TOTP
} from 'otpauth';
import {
    LayerAuthError,
    layerAuthConfigurationCreate,
    layerAuthSecretEnvelopeCreate,
    layerAuthTotpServiceCreate
} from '../src/index.js';


//Function for creating an in-memory TOTP service with observable durable effects
const totpFixtureCreate = function(){
    let currentTimeData = Date.parse( '2026-09-23T12:00:00.000Z' );
    let credentialData = /** @type {any} */ (null);
    const challengeRecordsData = new Map();
    const recoveryCodesData = new Set();
    const sessionIssueCallsData = /** @type {any[]} */ ([]);
    let randomSequenceData = Number( 0 );
    const configurationData = layerAuthConfigurationCreate({
        enabled: true,
        identifiers: {email: true, username: false},
        totp: {
            issuer: 'Layer Auth test',
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
            window: 1,
            recoveryCodeCount: 5
        }
    });
    const serviceData = layerAuthTotpServiceCreate(/** @type {any} */ ({
        configuration: configurationData,
        users: {
            async identifiersList(){
                return [{display: 'developer@example.test', verified: true}];

            }
        },
        challenges: {
            async create( /** @type {any} */ challengeData ){
                const tokenData = `challenge-${Number( challengeRecordsData.size ) + Number( 1 )}-with-sufficient-entropy`;
                const challengeRecordData = {
                    ...challengeData,
                    token: tokenData
                };
                challengeRecordsData.set( tokenData, challengeRecordData );
                return {token: tokenData, expiresAt: challengeData.expiresAt};

            },

            async consume( /** @type {any} */ consumeData ){
                const challengeData = challengeRecordsData.get( consumeData.token );

                if ( challengeData === undefined || challengeData.type !== consumeData.type ){
                    return null;

                }

                await consumeData.effect({
                    userId: challengeData.userId,
                    payload: challengeData.payload
                }, {query(){}});
                challengeRecordsData.delete( consumeData.token );
                return {challengeId: 'challenge-record-identifier'};

            }
        },
        totp: {
            async pendingSave( /** @type {any} */ pendingCredentialData ){
                credentialData = {
                    ...pendingCredentialData,
                    lastCounter: null,
                    confirmedAt: null
                };
                return true;

            },

            async get(){
                return credentialData;

            },

            async confirm( /** @type {any} */ confirmationData ){
                if ( credentialData.confirmedAt !== null ){
                    return false;

                }

                credentialData.lastCounter = confirmationData.counter;
                credentialData.confirmedAt = currentTimeData;
                recoveryCodesData.clear();

                for ( const recoveryCodeData of confirmationData.recoveryCodes ){
                    recoveryCodesData.add( recoveryCodeData );

                }

                return true;

            },

            async counterAdvance( /** @type {any} */ counterData ){
                if (
                    credentialData.lastCounter !== counterData.expectedCounter ||
                    Number( counterData.counter ) <= Number( credentialData.lastCounter )
                ){
                    return false;

                }

                credentialData.lastCounter = counterData.counter;
                return true;

            },

            async recoveryCodeConsume( /** @type {any} */ userIdentifierData, /** @type {any} */ recoveryCodeData ){
                void userIdentifierData;

                if ( recoveryCodesData.has( recoveryCodeData ) === false ){
                    return false;

                }

                recoveryCodesData.delete( recoveryCodeData );
                return true;

            },

            async recoveryCodesReplace( /** @type {any} */ userIdentifierData, /** @type {any} */ replacementCodesData ){
                void userIdentifierData;
                recoveryCodesData.clear();

                for ( const recoveryCodeData of replacementCodesData ){
                    recoveryCodesData.add( recoveryCodeData );

                }

                return true;

            },

            async remove(){
                credentialData = null;
                recoveryCodesData.clear();
                return true;

            }
        },
        envelope: layerAuthSecretEnvelopeCreate({
            secret: 'totp-test-master-secret-with-more-than-thirty-two-characters'
        }),
        async sessionIssue( /** @type {any} */ userIdentifierData, /** @type {any} */ rememberStatusData, /** @type {any} */ assuranceData ){
            sessionIssueCallsData.push({userIdentifierData, rememberStatusData, assuranceData});
            return {sessionId: 'totp-session-identifier'};

        },
        clock(){
            return currentTimeData;

        },
        randomBytesCreate( /** @type {number} */ sizeData ){
            randomSequenceData += Number( 1 );
            return Buffer.alloc( sizeData, Number( randomSequenceData ) );

        }
    }));

    //CallBack THE OBJECT
    return {
        service: serviceData,
        sessionIssueCallsData,
        credentialGet(){
            return credentialData;

        },
        timeAdvance( /** @type {number} */ millisecondsData ){
            currentTimeData += Number( millisecondsData );

        },
        currentTimeGet(){
            return currentTimeData;

        }
    };

};

test( 'TOTP service rejects every incomplete encrypted persistence dependency', function(){
    const configurationData = layerAuthConfigurationCreate({
        enabled: true,
        totp: {
            issuer: 'Layer Auth test',
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
            window: 1,
            recoveryCodeCount: 5
        }
    });
    const serviceOptionsCreate = function(){
        return {
            configuration: configurationData,
            users: {async identifiersList(){}},
            challenges: {async create(){}, async consume(){}},
            totp: {
                async pendingSave(){},
                async get(){},
                async confirm(){},
                async counterAdvance(){},
                async recoveryCodeConsume(){},
                async recoveryCodesReplace(){},
                async remove(){}
            },
            envelope: {seal(){}, open(){}},
            async sessionIssue(){}
        };

    };
    const invalidOptionsCreateListData = [
        function nullOptionsCreate(){
            return null;

        },
        function disabledConfigurationCreate(){
            return {...serviceOptionsCreate(), configuration: {totp: null}};

        },
        function identifiersMissingCreate(){
            return {...serviceOptionsCreate(), users: {}};

        },
        function challengeCreateMissingCreate(){
            return {...serviceOptionsCreate(), challenges: {async consume(){}}};

        },
        function challengeConsumeMissingCreate(){
            return {...serviceOptionsCreate(), challenges: {async create(){}}};

        },
        function pendingSaveMissingCreate(){
            const serviceOptionsData = /** @type {any} */ (serviceOptionsCreate());
            serviceOptionsData.totp.pendingSave = null;
            return serviceOptionsData;

        },
        function credentialGetMissingCreate(){
            const serviceOptionsData = /** @type {any} */ (serviceOptionsCreate());
            serviceOptionsData.totp.get = null;
            return serviceOptionsData;

        },
        function confirmMissingCreate(){
            const serviceOptionsData = /** @type {any} */ (serviceOptionsCreate());
            serviceOptionsData.totp.confirm = null;
            return serviceOptionsData;

        },
        function counterAdvanceMissingCreate(){
            const serviceOptionsData = /** @type {any} */ (serviceOptionsCreate());
            serviceOptionsData.totp.counterAdvance = null;
            return serviceOptionsData;

        },
        function recoveryConsumeMissingCreate(){
            const serviceOptionsData = /** @type {any} */ (serviceOptionsCreate());
            serviceOptionsData.totp.recoveryCodeConsume = null;
            return serviceOptionsData;

        },
        function recoveryReplaceMissingCreate(){
            const serviceOptionsData = /** @type {any} */ (serviceOptionsCreate());
            serviceOptionsData.totp.recoveryCodesReplace = null;
            return serviceOptionsData;

        },
        function credentialRemoveMissingCreate(){
            const serviceOptionsData = /** @type {any} */ (serviceOptionsCreate());
            serviceOptionsData.totp.remove = null;
            return serviceOptionsData;

        },
        function envelopeSealMissingCreate(){
            return {...serviceOptionsCreate(), envelope: {open(){}}};

        },
        function envelopeOpenMissingCreate(){
            return {...serviceOptionsCreate(), envelope: {seal(){}}};

        },
        function sessionIssueMissingCreate(){
            return {...serviceOptionsCreate(), sessionIssue: null};

        }
    ];

    for ( const invalidOptionsCreateData of invalidOptionsCreateListData ){
        assert.throws(function invalidServiceCreate(){
            layerAuthTotpServiceCreate( /** @type {any} */ (invalidOptionsCreateData()) );

        }, /requires configuration, encrypted storage, and durable challenges/u );

    }

});


test( 'TOTP enrollment persists only an encrypted seed and returns recovery codes once', async function(){
    const fixtureData = totpFixtureCreate();
    const enrollmentData = await fixtureData.service.enrollment.begin( 'user-auth-1' );
    const credentialData = fixtureData.credentialGet();
    const tokenData = TOTP.generate({
        secret: Secret.fromBase32( enrollmentData.secret ),
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        timestamp: fixtureData.currentTimeGet()
    });
    const confirmationData = await fixtureData.service.enrollment.confirm(
        'user-auth-1',
        tokenData
    );

    assert.match( enrollmentData.uri, /^otpauth:\/\/totp\//u );
    assert.equal( Buffer.isBuffer( credentialData.encryptedSecret ), true );
    assert.equal( credentialData.encryptedSecret.includes( enrollmentData.secret ), false );
    assert.equal( confirmationData.enabled, true );
    assert.equal( confirmationData.recoveryCodes.length, 5 );
    assert.equal( new Set( confirmationData.recoveryCodes ).size, 5 );
    assert.equal( await fixtureData.service.isEnabled( 'user-auth-1' ), true );

});

test( 'TOTP MFA consumes a newer counter before issuing a password-plus-totp session', async function(){
    const fixtureData = totpFixtureCreate();
    const enrollmentData = await fixtureData.service.enrollment.begin( 'user-auth-1' );
    const enrollmentTokenData = TOTP.generate({
        secret: Secret.fromBase32( enrollmentData.secret ),
        timestamp: fixtureData.currentTimeGet()
    });
    await fixtureData.service.enrollment.confirm( 'user-auth-1', enrollmentTokenData );
    fixtureData.timeAdvance( 30000 );
    const challengeData = await fixtureData.service.challenge( 'user-auth-1', true );
    const verificationTokenData = TOTP.generate({
        secret: Secret.fromBase32( enrollmentData.secret ),
        timestamp: fixtureData.currentTimeGet()
    });
    const verificationData = await fixtureData.service.verify({
        challenge: challengeData.challenge,
        code: verificationTokenData
    });

    assert.equal( verificationData.userId, 'user-auth-1' );
    assert.deepEqual( fixtureData.sessionIssueCallsData, [{
        userIdentifierData: 'user-auth-1',
        rememberStatusData: true,
        assuranceData: ['password', 'totp']
    }] );

    const replayChallengeData = await fixtureData.service.challenge( 'user-auth-1', false );
    await assert.rejects(function totpReplayAttempt(){
        return fixtureData.service.verify({
            challenge: replayChallengeData.challenge,
            code: verificationTokenData
        });

    }, function replayErrorCheck( errorData ){
        assert.ok( errorData instanceof LayerAuthError );
        assert.equal( errorData.code, 'AUTH_TOTP_REPLAY' );
        return true;

    });
    assert.equal( fixtureData.sessionIssueCallsData.length, 1 );

});

test( 'TOTP MFA consumes each recovery code at most once', async function(){
    const fixtureData = totpFixtureCreate();
    const enrollmentData = await fixtureData.service.enrollment.begin( 'user-auth-1' );
    const enrollmentTokenData = TOTP.generate({
        secret: Secret.fromBase32( enrollmentData.secret ),
        timestamp: fixtureData.currentTimeGet()
    });
    const confirmationData = await fixtureData.service.enrollment.confirm(
        'user-auth-1',
        enrollmentTokenData
    );
    const recoveryCodeData = confirmationData.recoveryCodes[0];
    const challengeData = await fixtureData.service.challenge( 'user-auth-1', false );
    await fixtureData.service.verify({
        challenge: challengeData.challenge,
        recoveryCode: recoveryCodeData
    });
    const repeatedChallengeData = await fixtureData.service.challenge( 'user-auth-1', false );

    await assert.rejects(function recoveryCodeReuseAttempt(){
        return fixtureData.service.verify({
            challenge: repeatedChallengeData.challenge,
            recoveryCode: recoveryCodeData
        });

    }, function recoveryErrorCheck( errorData ){
        assert.ok( errorData instanceof LayerAuthError );
        assert.equal( errorData.code, 'AUTH_MFA_INVALID' );
        return true;

    });
    assert.deepEqual( fixtureData.sessionIssueCallsData[0].assuranceData, ['password', 'recovery-code'] );

});
