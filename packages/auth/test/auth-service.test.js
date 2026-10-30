import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LayerAuthError,
    layerAuthConfigurationCreate,
    layerAuthPasswordHashCreate,
    layerAuthServiceCreate
} from '../src/index.js';

const configurationData = layerAuthConfigurationCreate({
    enabled: true,
    registration: {
        mode: 'open'
    },
    identifiers: {
        email: true,
        username: true
    },
    session: {
        maximumPerUser: 2
    }
});

test( 'Layer Auth service rejects incomplete core and optional repositories', function(){
    const serviceOptionsCreate = function( selectedConfigurationData = configurationData ){
        return {
            configuration: selectedConfigurationData,
            users: {
                async create(){},
                async findByIdentifier(){},
                async permissionsResolve(){}
            },
            sessions: {
                async issue(){},
                async list(){},
                async revokeById(){}
            }
        };

    };
    const invalidCoreOptionsCreateListData = [
        function nullOptionsCreate(){
            return null;

        },
        function configurationMissingCreate(){
            return {...serviceOptionsCreate(), configuration: null};

        },
        function userCreateMissingCreate(){
            const serviceOptionsData = /** @type {any} */ (serviceOptionsCreate());
            serviceOptionsData.users.create = null;
            return serviceOptionsData;

        },
        function userLookupMissingCreate(){
            const serviceOptionsData = /** @type {any} */ (serviceOptionsCreate());
            serviceOptionsData.users.findByIdentifier = null;
            return serviceOptionsData;

        },
        function permissionResolverMissingCreate(){
            const serviceOptionsData = /** @type {any} */ (serviceOptionsCreate());
            serviceOptionsData.users.permissionsResolve = null;
            return serviceOptionsData;

        },
        function sessionIssueMissingCreate(){
            const serviceOptionsData = /** @type {any} */ (serviceOptionsCreate());
            serviceOptionsData.sessions.issue = null;
            return serviceOptionsData;

        },
        function sessionListMissingCreate(){
            const serviceOptionsData = /** @type {any} */ (serviceOptionsCreate());
            serviceOptionsData.sessions.list = null;
            return serviceOptionsData;

        },
        function sessionRevokeMissingCreate(){
            const serviceOptionsData = /** @type {any} */ (serviceOptionsCreate());
            serviceOptionsData.sessions.revokeById = null;
            return serviceOptionsData;

        }
    ];

    for ( const invalidOptionsCreateData of invalidCoreOptionsCreateListData ){
        assert.throws(function invalidServiceCreate(){
            layerAuthServiceCreate( /** @type {any} */ (invalidOptionsCreateData()) );

        }, /requires enabled configuration/u );

    }

    const smtpData = {
        host: '127.0.0.1',
        port: 2525,
        secure: false,
        username: null,
        password: null,
        from: 'Layer <layer@example.test>'
    };
    const featureConfigurationsData = [{
        configuration: layerAuthConfigurationCreate({
            enabled: true,
            emailVerification: {required: true},
            smtp: smtpData
        }),
        error: /email flows require durable challenges/u
    }, {
        configuration: layerAuthConfigurationCreate({
            enabled: true,
            passwordRecovery: {enabled: true},
            smtp: smtpData
        }),
        error: /email flows require durable challenges/u
    }, {
        configuration: layerAuthConfigurationCreate({
            enabled: true,
            totp: {
                issuer: 'Layer Auth test',
                algorithm: 'SHA1',
                digits: 6,
                period: 30,
                window: 1,
                recoveryCodeCount: 5
            }
        }),
        error: /TOTP requires durable challenges/u
    }, {
        configuration: layerAuthConfigurationCreate({
            enabled: true,
            oidc: [{
                id: 'company-identity',
                issuer: 'https://identity.example.test',
                clientId: 'layer-client',
                clientSecret: {env: 'LAYER_OIDC_CLIENT_SECRET'},
                redirectUri: 'https://application.example.test/auth/callback',
                scopes: ['openid', 'email']
            }]
        }),
        error: /OIDC requires durable challenges/u
    }, {
        configuration: layerAuthConfigurationCreate({
            enabled: true,
            registration: {mode: 'invite'}
        }),
        error: /invite registration requires invitation and role repositories/u
    }];

    for ( const featureConfigurationData of featureConfigurationsData ){
        assert.throws(function optionalRepositoryMissingCreate(){
            layerAuthServiceCreate(serviceOptionsCreate(
                /** @type {any} */ (featureConfigurationData.configuration)
            ));

        }, featureConfigurationData.error);

    }

});

test( 'Layer Auth registers a normalized identifier with Argon2id only', async function(){
    let userCreateData = /** @type {any} */ (null);
    const serviceData = layerAuthServiceCreate({
        configuration: configurationData,
        users: {
            async create( /** @type {any} */ createData ){
                userCreateData = createData;
                return {userId: 'user-auth-1'};

            },

            async findByIdentifier(){
                return null;

            },

            async permissionsResolve(){
                return [];

            }
        },
        sessions: {
            async issue(){
                throw new Error( 'Session should not be issued during registration.' );

            },

            async list(){
                return [];

            },

            async revokeById(){
                return false;

            }
        },
        dummyPasswordHash: await layerAuthPasswordHashCreate( 'dummy-password-value' )
    });

    const registrationResultData = await serviceData.registration.create({
        identifier: ' Developer@Example.Test ',
        password: 'a-strong-password-value'
    });

    assert.equal( registrationResultData.accepted, true );
    assert.equal( userCreateData.identifier.normalized, 'developer@example.test' );
    assert.equal( userCreateData.password.hash.startsWith( '$argon2id$' ), true );
    assert.equal( JSON.stringify( userCreateData ).includes( 'a-strong-password-value' ), false );

});

test( 'verified phone sign-in creates a passwordless identity and issues phone assurance', async function(){
    const phoneConfigurationData = layerAuthConfigurationCreate({
        enabled: true,
        registration: {mode: 'open'},
        identifiers: {email: false, username: false, phone: true}
    });
    let phoneIdentityData = /** @type {Record<string, any> | null} */ (null);
    const createdUserItemsData = /** @type {Record<string, any>[]} */ ([]);
    const issuedSessionItemsData = /** @type {Record<string, any>[]} */ ([]);
    const serviceData = layerAuthServiceCreate({
        configuration: phoneConfigurationData,
        users: {
            /** @param {Record<string, any>} createData */
            async create( createData ){
                createdUserItemsData.push( createData );
                phoneIdentityData = {userId: 'phone-user-1', status: 'active', verified: true};
                return {userId: 'phone-user-1'};

            },
            /** @param {string} identifierTypeData @param {string} identifierValueData */
            async findByIdentifier( identifierTypeData, identifierValueData ){
                assert.equal( identifierTypeData, 'phone' );
                assert.equal( identifierValueData, '+79991234567' );
                return phoneIdentityData;

            },
            async permissionsResolve(){
                return [];

            }
        },
        sessions: {
            /** @param {Record<string, any>} sessionData */
            async issue( sessionData ){
                issuedSessionItemsData.push( sessionData );
                return {sessionId: 'phone-session-1'};

            },
            async list(){
                return [];

            },
            async revokeById(){
                return false;

            }
        }
    });

    const signInResultData = await serviceData.signIn.verifiedPhone({
        phone: '+79991234567',
        remember: true
    });

    assert.equal( signInResultData.userId, 'phone-user-1' );
    assert.equal( signInResultData.session.sessionId, 'phone-session-1' );
    const createdUserData = createdUserItemsData[0];
    const issuedSessionData = issuedSessionItemsData[0];
    assert.ok( createdUserData );
    assert.ok( issuedSessionData );
    assert.equal( createdUserData.password, null );
    assert.equal( createdUserData.identifier.verified, true );
    assert.deepEqual( issuedSessionData.assurance, ['phone'] );

});

test( 'Layer Auth consumes one invitation with role assignment in the identity transaction', async function(){
    const invitationConfigurationData = layerAuthConfigurationCreate({
        enabled: true,
        registration: {mode: 'invite'},
        identifiers: {email: true, username: false}
    });
    const transactionDatabaseData = {
        async query(){
            return {rows: [], rowCount: 1};

        }
    };
    const invitationCallsData = /** @type {any[]} */ ([]);
    const roleCallsData = /** @type {any[]} */ ([]);
    const serviceData = layerAuthServiceCreate({
        configuration: invitationConfigurationData,
        users: {
            async create( /** @type {any} */ createData, /** @type {any} */ databaseData ){
                assert.equal( databaseData, transactionDatabaseData );

                if ( typeof createData.afterCreate === 'function' ){
                    await createData.afterCreate({
                        userId: 'user-invited-1',
                        identifierId: 'identifier-invited-1'
                    }, databaseData );

                }

                return {userId: 'user-invited-1'};

            },

            async findByIdentifier(){
                return null;

            },

            async permissionsResolve(){
                return [];

            }
        },
        sessions: {
            async issue(){
                throw new Error( 'Session should not be issued during invited registration.' );

            },

            async list(){
                return [];

            },

            async revokeById(){
                return false;

            }
        },
        invitations: {
            async issue(){
                return {token: 'unused'};

            },

            async consume( /** @type {any} */ consumptionData ){
                invitationCallsData.push( consumptionData );

                return consumptionData.effect({
                    id: 'invitation-1',
                    roles: ['support-agent']
                }, transactionDatabaseData );

            }
        },
        roles: {
            /** @param {any[]} assignmentData */
            async assign( ...assignmentData ){
                roleCallsData.push( assignmentData );
                return true;

            }
        },
        dummyPasswordHash: await layerAuthPasswordHashCreate( 'dummy-password-value' )
    });

    const registrationResultData = await serviceData.registration.create({
        identifier: ' Invited@Example.Test ',
        password: 'a-strong-password-value',
        invitationToken: 'invitation-token-value-with-sufficient-entropy'
    });

    assert.equal( registrationResultData.userId, 'user-invited-1' );
    assert.equal( invitationCallsData[0].email, 'invited@example.test' );
    assert.equal( invitationCallsData[0].token, 'invitation-token-value-with-sufficient-entropy' );
    assert.deepEqual( roleCallsData[0], [
        'user-invited-1',
        'support-agent',
        transactionDatabaseData
    ] );

});

test( 'Layer Auth admin-only mode rejects self-registration and exposes trusted creation', async function(){
    const administratorConfigurationData = layerAuthConfigurationCreate({
        enabled: true,
        registration: {mode: 'admin-only'}
    });
    let identityCreateCountData = Number( 0 );
    const serviceData = layerAuthServiceCreate({
        configuration: administratorConfigurationData,
        users: {
            async create(){
                identityCreateCountData += Number( 1 );
                return {userId: 'user-managed-1'};

            },

            async findByIdentifier(){
                return null;

            },

            async permissionsResolve(){
                return [];

            }
        },
        sessions: {
            async issue(){
                throw new Error( 'Session should not be issued during managed registration.' );

            },

            async list(){
                return [];

            },

            async revokeById(){
                return false;

            }
        },
        dummyPasswordHash: await layerAuthPasswordHashCreate( 'dummy-password-value' )
    });

    await assert.rejects(
        function publicRegistrationCreate(){
            return serviceData.registration.create({
                identifier: 'developer@example.test',
                password: 'a-strong-password-value'
            });

        },
        function registrationErrorCheck( errorData ){
            assert.ok( errorData instanceof LayerAuthError );
            assert.equal( errorData.code, 'AUTH_REGISTRATION_DISABLED' );
            return true;

        }
    );

    const managedRegistrationResultData = await serviceData.registration.createManaged({
        identifier: 'developer@example.test',
        password: 'a-strong-password-value'
    });

    assert.equal( managedRegistrationResultData.userId, 'user-managed-1' );
    assert.equal( identityCreateCountData, 1 );

});

test( 'Layer Auth returns one generic failure for an unknown password identity', async function(){
    const serviceData = layerAuthServiceCreate({
        configuration: configurationData,
        users: {
            async create(){
                return {userId: 'unused'};

            },

            async findByIdentifier(){
                return null;

            },

            async permissionsResolve(){
                return [];

            }
        },
        sessions: {
            async issue(){
                throw new Error( 'Unknown identity cannot issue a session.' );

            },

            async list(){
                return [];

            },

            async revokeById(){
                return false;

            }
        },
        dummyPasswordHash: await layerAuthPasswordHashCreate( 'dummy-password-value' )
    });

    await assert.rejects(
        function unknownIdentitySignIn(){
            return serviceData.signIn.password({
                identifier: 'unknown@example.test',
                password: 'incorrect-password-value'
            });

        },
        function errorCheck( errorData ){
            assert.ok( errorData instanceof LayerAuthError );
            assert.equal( errorData.code, 'AUTH_CREDENTIALS_INVALID' );
            return true;

        }
    );

});

test( 'Layer Auth resolves permissions, revokes the oldest session, and issues remember lifetime', async function(){
    const passwordHashData = await layerAuthPasswordHashCreate( 'correct-password-value' );
    const revokedSessionsData = /** @type {string[]} */ ([]);
    let sessionIssueData = /** @type {any} */ (null);
    const clockData = Date.parse( '2026-09-23T12:00:00.000Z' );
    const serviceData = layerAuthServiceCreate({
        configuration: configurationData,
        users: {
            async create(){
                return {userId: 'unused'};

            },

            async findByIdentifier(){
                return {
                    userId: 'user-auth-1',
                    status: 'active',
                    verified: true,
                    passwordHash: passwordHashData
                };

            },

            async permissionsResolve(){
                return ['chat.message.send'];

            }
        },
        sessions: {
            async issue( /** @type {any} */ issueData ){
                sessionIssueData = issueData;
                return {
                    sessionId: 'session-new',
                    sessionToken: 'opaque-session-token',
                    csrfToken: 'opaque-csrf-token'
                };

            },

            async list(){
                return Object.freeze([
                    Object.freeze({sessionId: 'session-newer'}),
                    Object.freeze({sessionId: 'session-oldest'})
                ]);

            },

            async revokeById( /** @type {string} */ sessionIdentifierData ){
                revokedSessionsData.push( sessionIdentifierData );
                return true;

            }
        },
        clock(){
            return clockData;

        },
        dummyPasswordHash: await layerAuthPasswordHashCreate( 'dummy-password-value' )
    });

    const signInResultData = await serviceData.signIn.password({
        identifier: 'developer@example.test',
        password: 'correct-password-value',
        remember: true
    });
    const successfulSignInData = /** @type {any} */ (signInResultData);

    assert.equal( successfulSignInData.userId, 'user-auth-1' );
    assert.deepEqual( revokedSessionsData, ['session-oldest'] );
    assert.deepEqual( sessionIssueData.permissions, ['chat.message.send'] );
    assert.deepEqual( sessionIssueData.assurance, ['password'] );
    assert.equal( sessionIssueData.idleExpiresAt, clockData + Number( configurationData.session.rememberIdleLifetimeMs ) );
    assert.equal( sessionIssueData.absoluteExpiresAt, clockData + Number( configurationData.session.rememberAbsoluteLifetimeMs ) );
    assert.equal( sessionIssueData.idleLifetimeMs, configurationData.session.rememberIdleLifetimeMs );

    //Checking normal sign-in preserves its own policy rather than the remember lifetime.
    await serviceData.signIn.password({
        identifier: 'developer@example.test',
        password: 'correct-password-value',
        remember: false
    });
    assert.equal( sessionIssueData.idleLifetimeMs, configurationData.session.idleLifetimeMs );

});

test( 'password sign-in with active TOTP returns a staged challenge without issuing a session', async function(){
    const passwordHashData = await layerAuthPasswordHashCreate( 'correct-password-value' );
    let sessionIssueCountData = Number( 0 );
    const totpConfigurationData = layerAuthConfigurationCreate({
        enabled: true,
        identifiers: {email: true, username: false},
        totp: {issuer: 'Layer Auth test'}
    });
    const serviceData = layerAuthServiceCreate({
        configuration: totpConfigurationData,
        users: {
            async create(){
                return {userId: 'unused'};

            },
            async findByIdentifier(){
                return {
                    userId: 'user-auth-1',
                    status: 'active',
                    verified: true,
                    passwordHash: passwordHashData
                };

            },
            async permissionsResolve(){
                return [];

            },
            async identifiersList(){
                return [];

            }
        },
        sessions: {
            async issue(){
                sessionIssueCountData += Number( 1 );
                return {sessionId: 'unexpected'};

            },
            async list(){
                return [];

            },
            async revokeById(){
                return false;

            }
        },
        challenges: {
            async create(){
                return {
                    token: 'mfa-challenge-with-sufficient-entropy',
                    expiresAt: Date.parse( '2026-09-23T12:05:00.000Z' )
                };

            },
            async consume(){
                return null;

            }
        },
        totp: {
            async pendingSave(){
                return true;
            },
            async get(){
                return {confirmedAt: Date.parse( '2026-09-23T11:00:00.000Z' )};

            },
            async confirm(){
                return true;
            },
            async counterAdvance(){
                return true;
            },
            async recoveryCodeConsume(){
                return true;
            },
            async recoveryCodesReplace(){
                return true;
            },
            async remove(){
                return true;
            }
        },
        secretEnvelope: {
            seal(){
                return Buffer.alloc( 48 );
            },
            open(){
                return {base32: 'ABCDEFGHIJKLMNOP'};
            }
        },
        dummyPasswordHash: await layerAuthPasswordHashCreate( 'dummy-password-value' )
    });

    const signInResultData = await serviceData.signIn.password({
        identifier: 'developer@example.test',
        password: 'correct-password-value',
        remember: true
    });

    assert.deepEqual( signInResultData, {
        mfaRequired: true,
        challenge: 'mfa-challenge-with-sufficient-entropy',
        expiresAt: Date.parse( '2026-09-23T12:05:00.000Z' ),
        methods: ['totp', 'recovery-code']
    } );
    assert.equal( sessionIssueCountData, 0 );

});

test( 'Layer Auth verifies email and replaces a recovered password through consumed challenges', async function(){
    const clockData = Date.parse( '2026-09-23T12:00:00.000Z' );
    const mailCallsData = /** @type {any[]} */ ([]);
    const challengeCreateCallsData = /** @type {any[]} */ ([]);
    const identifierVerifyCallsData = /** @type {any[]} */ ([]);
    const passwordReplaceCallsData = /** @type {any[]} */ ([]);
    const sessionRevokeCallsData = /** @type {any[]} */ ([]);
    const emailConfigurationData = layerAuthConfigurationCreate({
        enabled: true,
        registration: {mode: 'open'},
        emailVerification: {
            required: true,
            lifetimeMs: 3600000
        },
        passwordRecovery: {
            enabled: true,
            lifetimeMs: 1800000
        },
        smtp: {
            host: '127.0.0.1',
            port: 2525,
            secure: false,
            username: null,
            password: null,
            from: 'Layer <layer@example.test>'
        }
    });
    const transactionDatabaseData = {
        async query(){
            return {rows: [], rowCount: 1};

        }
    };
    const serviceData = layerAuthServiceCreate({
        configuration: emailConfigurationData,
        users: {
            async create( /** @type {any} */ createData ){
                await createData.afterCreate({
                    userId: 'user-auth-1',
                    identifierId: 'identifier-1'
                }, transactionDatabaseData );

                return {userId: 'user-auth-1'};

            },

            async findByIdentifier(){
                return {
                    userId: 'user-auth-1',
                    identifierId: 'identifier-1',
                    status: 'active',
                    verified: true,
                    passwordHash: '$argon2id$existing'
                };

            },

            async permissionsResolve(){
                return [];

            },

            /** @param {any[]} verifyData */
            async identifierVerify( ...verifyData ){
                identifierVerifyCallsData.push( verifyData );
                return true;

            },

            /** @param {any[]} replaceData */
            async passwordReplace( ...replaceData ){
                passwordReplaceCallsData.push( replaceData );
                return true;

            }
        },
        sessions: {
            async issue(){
                throw new Error( 'Session issue is not used by email lifecycle tests.' );

            },

            async list(){
                return [];

            },

            async revokeById(){
                return false;

            },

            /** @param {any[]} revokeData */
            async revokeAllByUser( ...revokeData ){
                sessionRevokeCallsData.push( revokeData );
                return 1;

            }
        },
        challenges: {
            async create( /** @type {any} */ challengeData ){
                challengeCreateCallsData.push( challengeData );
                return {
                    token: `${String( challengeData.type )}-token-with-sufficient-entropy`,
                    expiresAt: challengeData.expiresAt
                };

            },

            async consume( /** @type {any} */ challengeData ){
                let payloadData = {};

                if ( challengeData.type === String( 'email-verification' ) ){
                    payloadData = {identifierId: 'identifier-1'};

                }
                await challengeData.effect({
                    challengeId: 'challenge-1',
                    userId: 'user-auth-1',
                    payload: payloadData
                }, transactionDatabaseData );

                return {challengeId: 'challenge-1'};

            }
        },
        mailQueue: {
            async enqueue( /** @type {any} */ mailData ){
                mailCallsData.push( mailData );
                return 'mail-1';

            }
        },
        clock(){
            return clockData;

        },
        dummyPasswordHash: await layerAuthPasswordHashCreate( 'dummy-password-value' )
    });

    const registrationResultData = await serviceData.registration.create({
        identifier: 'developer@example.test',
        password: 'a-strong-password-value'
    });
    const verificationResultData = await serviceData.emailVerification.confirm({
        token: 'verification-token-with-sufficient-entropy'
    });
    const recoveryRequestResultData = await serviceData.passwordRecovery.request({
        identifier: 'developer@example.test'
    });
    const recoveryCompleteResultData = await serviceData.passwordRecovery.complete({
        token: 'recovery-token-with-sufficient-entropy',
        password: 'a-new-strong-password-value'
    });

    assert.deepEqual( registrationResultData, {
        accepted: true,
        verificationRequired: true,
        userId: 'user-auth-1'
    } );
    assert.deepEqual( verificationResultData, {verified: true} );
    assert.deepEqual( recoveryRequestResultData, {accepted: true} );
    assert.deepEqual( recoveryCompleteResultData, {completed: true} );
    assert.equal( challengeCreateCallsData[0].database, transactionDatabaseData );
    assert.equal( challengeCreateCallsData[0].expiresAt, clockData + Number( 3600000 ) );
    assert.equal( challengeCreateCallsData[1].expiresAt, clockData + Number( 1800000 ) );
    assert.equal( mailCallsData.length, 2 );
    assert.equal( mailCallsData[0].database, transactionDatabaseData );
    assert.equal( identifierVerifyCallsData[0][2], transactionDatabaseData );
    assert.equal( passwordReplaceCallsData[0][1].hash.startsWith( '$argon2id$' ), true );
    assert.equal( sessionRevokeCallsData[0][1], 'password-recovery' );
    assert.equal( sessionRevokeCallsData[0][2], transactionDatabaseData );

});

test( 'Layer Auth authorization hook merges valid policy and rejects malformed results', async function(){
    const passwordHashData = await layerAuthPasswordHashCreate( 'correct-password-value' );
    let authorizationResultData = /** @type {any} */ ({
        tenantId: 'tenant-auth-1',
        permissions: ['chat.room.read']
    });
    let sessionIssueData = /** @type {any} */ (null);
    const authorizationConfigurationData = layerAuthConfigurationCreate({
        enabled: true,
        registration: {mode: 'open'},
        authorizationResolve(){
            return authorizationResultData;

        }
    });
    const serviceData = layerAuthServiceCreate({
        configuration: authorizationConfigurationData,
        users: {
            async create(){
                return {userId: 'unused'};

            },
            async findByIdentifier(){
                return {
                    userId: 'user-auth-1',
                    status: 'active',
                    verified: true,
                    passwordHash: passwordHashData
                };

            },
            async permissionsResolve(){
                return ['chat.message.send'];

            }
        },
        sessions: {
            async issue( /** @type {any} */ issueData ){
                sessionIssueData = issueData;
                return {
                    sessionId: 'session-auth-1',
                    sessionToken: 'opaque-session-token',
                    csrfToken: 'opaque-csrf-token'
                };

            },
            async list(){
                return [];

            },
            async revokeById(){
                return false;

            }
        },
        dummyPasswordHash: await layerAuthPasswordHashCreate( 'dummy-password-value' )
    });

    await serviceData.signIn.password({
        identifier: 'developer@example.test',
        password: 'correct-password-value'
    });

    assert.equal( sessionIssueData.tenantId, 'tenant-auth-1' );
    assert.deepEqual(
        sessionIssueData.permissions,
        ['chat.message.send', 'chat.room.read']
    );

    authorizationResultData = null;

    await assert.rejects(
        serviceData.signIn.password({
            identifier: 'developer@example.test',
            password: 'correct-password-value'
        }),
        function malformedAuthorizationResultCheck( errorData ){
            assert.ok( errorData instanceof LayerAuthError );
            assert.equal( errorData.code, 'AUTHORIZATION_RESOLVE_FAILED' );
            return true;

        }
    );

    authorizationResultData = {
        tenantId: null,
        permissions: [null]
    };

    await assert.rejects(
        serviceData.signIn.password({
            identifier: 'developer@example.test',
            password: 'correct-password-value'
        }),
        function malformedPermissionCheck( errorData ){
            assert.ok( errorData instanceof LayerAuthError );
            assert.equal( errorData.code, 'AUTHORIZATION_RESOLVE_FAILED' );
            return true;

        }
    );

});
