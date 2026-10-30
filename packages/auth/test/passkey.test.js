import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LayerAuthError,
    layerAuthConfigurationCreate,
    layerAuthPasskeyServiceCreate
} from '../src/index.js';


const clockData = Date.parse( '2026-09-23T12:00:00.000Z' );


//Function for creating an observable Passkey service fixture
const passkeyFixtureCreate = function( counterAdvanceStatusData = true ){
    const challengeRecordsData = new Map();
    const passkeyCreateCallsData = /** @type {any[]} */ ([]);
    const counterAdvanceCallsData = /** @type {any[]} */ ([]);
    const sessionIssueCallsData = /** @type {any[]} */ ([]);
    const configurationData = layerAuthConfigurationCreate({
        enabled: true,
        identifiers: {email: true, username: false},
        passkey: {
            rpId: 'localhost',
            rpName: 'Layer Auth test',
            origins: ['http://127.0.0.1:5340'],
            userVerification: 'required',
            timeoutMs: 60000
        }
    });
    const passkeyData = {
        credentialId: 'credential-public-identifier',
        userId: 'user-auth-1',
        publicKey: Buffer.alloc( 32, 4 ),
        counter: 7,
        transports: ['internal'],
        backupEligible: true,
        backupState: false,
        displayName: 'Development laptop',
        userStatus: 'active'
    };

    const serviceData = layerAuthPasskeyServiceCreate(/** @type {any} */ ({
        configuration: configurationData,
        users: {
            async identifiersList(){
                return [{display: 'developer@example.test', verified: true}];

            }
        },
        challenges: {
            async create( /** @type {any} */ challengeData ){
                challengeRecordsData.set( challengeData.token, challengeData );
                return {token: challengeData.token};

            },

            async consume( /** @type {any} */ consumeData ){
                const challengeData = challengeRecordsData.get( consumeData.token );

                if ( challengeData === undefined || challengeData.type !== consumeData.type ){
                    return null;

                }

                await consumeData.effect({
                    userId: challengeData.userId
                }, {query(){}});
                challengeRecordsData.delete( consumeData.token );

                return {challengeId: 'challenge-test-identifier'};

            }
        },
        passkeys: {
            async create( /** @type {any} */ createData, /** @type {any} */ databaseData ){
                passkeyCreateCallsData.push({createData, databaseData});
                return true;

            },

            async findByCredentialId(){
                return passkeyData;

            },

            async counterAdvance( /** @type {any} */ advanceData, /** @type {any} */ databaseData ){
                counterAdvanceCallsData.push({advanceData, databaseData});
                return counterAdvanceStatusData;

            },

            async listForUser(){
                return [passkeyData];

            },

            async remove(){
                return true;

            }
        },
        async sessionIssue( /** @type {any} */ userIdentifierData, /** @type {any} */ rememberStatusData, /** @type {any} */ assuranceData ){
            sessionIssueCallsData.push({userIdentifierData, rememberStatusData, assuranceData});
            return {sessionId: 'passkey-session-identifier'};

        },
        clock(){
            return clockData;

        },
        webAuthn: {
            async generateRegistrationOptions( /** @type {any} */ optionsData ){
                assert.equal( optionsData.rpID, 'localhost' );
                assert.equal( optionsData.userName, 'developer@example.test' );
                assert.equal( optionsData.requireUserVerification, undefined );
                return {challenge: 'registration-challenge-with-sufficient-entropy'};

            },

            async verifyRegistrationResponse( /** @type {any} */ optionsData ){
                assert.deepEqual( optionsData.expectedOrigin, ['http://127.0.0.1:5340'] );
                assert.equal( optionsData.requireUserVerification, true );
                return {
                    verified: true,
                    registrationInfo: {
                        credential: {
                            id: passkeyData.credentialId,
                            publicKey: passkeyData.publicKey,
                            counter: 0
                        },
                        credentialDeviceType: 'multiDevice',
                        credentialBackedUp: true
                    }
                };

            },

            async generateAuthenticationOptions( /** @type {any} */ optionsData ){
                assert.equal( optionsData.rpID, 'localhost' );
                return {challenge: 'authentication-challenge-with-sufficient-entropy'};

            },

            async verifyAuthenticationResponse( /** @type {any} */ optionsData ){
                assert.equal( optionsData.credential.counter, 7 );
                assert.deepEqual( optionsData.credential.transports, ['internal'] );
                return {
                    verified: true,
                    authenticationInfo: {
                        newCounter: 8,
                        credentialBackedUp: true
                    }
                };

            }
        }
    }));

    //CallBack THE OBJECT
    return {
        service: serviceData,
        passkeyCreateCallsData,
        counterAdvanceCallsData,
        sessionIssueCallsData
    };

};

test( 'Passkey service rejects every incomplete persistence and ceremony dependency', function(){
    const configurationData = layerAuthConfigurationCreate({
        enabled: true,
        passkey: {
            rpId: 'localhost',
            rpName: 'Layer Auth test',
            origins: ['http://127.0.0.1:5340'],
            userVerification: 'required',
            timeoutMs: 60000
        }
    });
    const serviceOptionsCreate = function(){
        return {
            configuration: configurationData,
            users: {async identifiersList(){}},
            challenges: {async create(){}, async consume(){}},
            passkeys: {
                async create(){},
                async findByCredentialId(){},
                async counterAdvance(){},
                async listForUser(){},
                async remove(){}
            },
            async sessionIssue(){}
        };

    };
    const invalidOptionsCreateListData = [
        function nullOptionsCreate(){
            return null;

        },
        function disabledConfigurationCreate(){
            return {...serviceOptionsCreate(), configuration: {passkey: null}};

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
        function passkeyCreateMissingCreate(){
            const serviceOptionsData = /** @type {any} */ (serviceOptionsCreate());
            serviceOptionsData.passkeys.create = null;
            return serviceOptionsData;

        },
        function passkeyFindMissingCreate(){
            const serviceOptionsData = /** @type {any} */ (serviceOptionsCreate());
            serviceOptionsData.passkeys.findByCredentialId = null;
            return serviceOptionsData;

        },
        function counterAdvanceMissingCreate(){
            const serviceOptionsData = /** @type {any} */ (serviceOptionsCreate());
            serviceOptionsData.passkeys.counterAdvance = null;
            return serviceOptionsData;

        },
        function passkeyListMissingCreate(){
            const serviceOptionsData = /** @type {any} */ (serviceOptionsCreate());
            serviceOptionsData.passkeys.listForUser = null;
            return serviceOptionsData;

        },
        function passkeyRemoveMissingCreate(){
            const serviceOptionsData = /** @type {any} */ (serviceOptionsCreate());
            serviceOptionsData.passkeys.remove = null;
            return serviceOptionsData;

        },
        function sessionIssueMissingCreate(){
            return {...serviceOptionsCreate(), sessionIssue: null};

        }
    ];

    for ( const invalidOptionsCreateData of invalidOptionsCreateListData ){
        assert.throws(function invalidServiceCreate(){
            layerAuthPasskeyServiceCreate( /** @type {any} */ (invalidOptionsCreateData()) );

        }, /requires WebAuthn configuration and repositories/u );

    }

});


test( 'Passkey service registers a credential through one consumed challenge transaction', async function(){
    const fixtureData = passkeyFixtureCreate();
    const beginResultData = await fixtureData.service.registration.begin( 'user-auth-1' );
    const completeResultData = await fixtureData.service.registration.complete( 'user-auth-1', {
        challenge: beginResultData.options.challenge,
        displayName: 'Development laptop',
        response: {
            response: {transports: ['internal']}
        }
    });

    assert.equal( completeResultData.registered, true );
    assert.equal( /** @type {any} */ (completeResultData.passkey).credentialId, 'credential-public-identifier' );
    assert.equal( fixtureData.passkeyCreateCallsData.length, 1 );
    assert.equal( fixtureData.passkeyCreateCallsData[0].createData.userId, 'user-auth-1' );
    assert.equal( fixtureData.passkeyCreateCallsData[0].createData.backupEligible, true );
    assert.equal( typeof fixtureData.passkeyCreateCallsData[0].databaseData.query, 'function' );

});

test( 'Passkey sign-in advances the authenticator counter before issuing a session', async function(){
    const fixtureData = passkeyFixtureCreate();
    const beginResultData = await fixtureData.service.signIn.begin();
    const completeResultData = await fixtureData.service.signIn.complete({
        challenge: beginResultData.options.challenge,
        remember: true,
        response: {id: 'credential-public-identifier'}
    });

    assert.equal( completeResultData.userId, 'user-auth-1' );
    assert.equal( fixtureData.counterAdvanceCallsData.length, 1 );
    assert.equal( fixtureData.counterAdvanceCallsData[0].advanceData.expectedCounter, 7 );
    assert.equal( fixtureData.counterAdvanceCallsData[0].advanceData.newCounter, 8 );
    assert.deepEqual( fixtureData.sessionIssueCallsData, [{
        userIdentifierData: 'user-auth-1',
        rememberStatusData: true,
        assuranceData: ['passkey']
    }] );

});

test( 'Passkey sign-in rejects a compare-and-swap counter replay before session issue', async function(){
    const fixtureData = passkeyFixtureCreate( false );
    const beginResultData = await fixtureData.service.signIn.begin();

    await assert.rejects(function replaySignIn(){
        return fixtureData.service.signIn.complete({
            challenge: beginResultData.options.challenge,
            response: {id: 'credential-public-identifier'}
        });

    }, function replayErrorCheck( errorData ){
        assert.ok( errorData instanceof LayerAuthError );
        assert.equal( errorData.code, 'AUTH_PASSKEY_REPLAY' );
        return true;

    });
    assert.equal( fixtureData.sessionIssueCallsData.length, 0 );

});
