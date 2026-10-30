import assert from 'node:assert/strict';
import test from 'node:test';
import {
    layerAuthChallengeRepositoryCreate,
    layerAuthExternalIdentityRepositoryCreate,
    layerAuthInvitationRepositoryCreate,
    layerAuthMailRepositoryCreate,
    layerAuthPasskeyRepositoryCreate,
    layerAuthRoleRepositoryCreate,
    layerAuthSessionRepositoryCreate,
    layerAuthTotpRepositoryCreate,
    layerAuthUserRepositoryCreate
} from '../src/index.js';

test( 'Auth invitation repository HMAC indexes and consumes one token atomically', async function(){
    const issuedAtData = Date.parse( '2026-09-23T12:00:00.000Z' );
    const invitationTokenData = 'invitation-token-value-with-sufficient-entropy';
    let invitationInsertValuesData = /** @type {readonly any[] | null} */ (null);
    let invitationConsumedStatusData = false;
    let transactionCountData = Number( 0 );
    const repositoryData = layerAuthInvitationRepositoryCreate({
        database: {
            systemSchema: 'layer_auth_test',

            async query( /** @type {any} */ queryData ){
                invitationInsertValuesData = queryData.values;
                return {rows: [], rowCount: 1};

            },

            async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
                transactionCountData += Number( 1 );

                return transactionHandlerData({
                    async query( /** @type {any} */ queryData ){
                        if ( queryData.text.includes( 'SELECT invitation_id' ) === true ){
                            let invitationConsumedAtData = null;

                            if ( invitationConsumedStatusData === true ){
                                invitationConsumedAtData = new Date( issuedAtData );

                            }

                            return {
                                rows: [{
                                    invitation_id: 'invitation-1',
                                    email_normalized: 'developer@example.test',
                                    roles: ['support-agent'],
                                    expires_at: new Date( issuedAtData + Number( 3600000 ) ),
                                    consumed_at: invitationConsumedAtData
                                }],
                                rowCount: 1
                            };

                        }

                        invitationConsumedStatusData = true;
                        return {
                            rows: [{invitation_id: 'invitation-1'}],
                            rowCount: 1
                        };

                    }
                });

            }
        },
        invitationPepper: 'invitation-pepper-with-more-than-thirty-two-characters',
        clock(){
            return issuedAtData;

        },
        identifierCreate(){
            return 'invitation-1';

        },
        tokenCreate(){
            return invitationTokenData;

        }
    });

    const invitationIssueResultData = await repositoryData.issue({
        email: 'developer@example.test',
        roles: ['support-agent'],
        expiresAt: issuedAtData + Number( 3600000 ),
        createdBy: 'administrator-1'
    });

    assert.equal( invitationIssueResultData.token, invitationTokenData );
    assert.ok( invitationInsertValuesData !== null );
    assert.equal( invitationInsertValuesData.includes( invitationTokenData ), false );
    assert.match( String( invitationInsertValuesData[1] ), /^[0-9a-f]{64}$/u );
    assert.equal( invitationInsertValuesData[3], '["support-agent"]' );

    const invitationEffectCallsData = /** @type {any[]} */ ([]);
    const invitationConsumeResultData = await repositoryData.consume({
        token: invitationTokenData,
        email: 'developer@example.test',
        async effect( invitationData, databaseData ){
            //Recording the trusted metadata and caller-owned transaction
            invitationEffectCallsData.push({
                invitationData,
                databaseData
            });

            return {userId: 'user-invited-1'};

        }
    });
    const replayResultData = await repositoryData.consume({
        token: invitationTokenData,
        email: 'developer@example.test',
        async effect(){
            throw new Error( 'A consumed invitation must not execute another effect.' );

        }
    });

    assert.deepEqual( invitationConsumeResultData, {userId: 'user-invited-1'} );
    assert.equal( invitationEffectCallsData.length, 1 );
    assert.deepEqual( invitationEffectCallsData[0].invitationData.roles, ['support-agent'] );
    assert.equal( typeof invitationEffectCallsData[0].databaseData.query, 'function' );
    assert.equal( replayResultData, null );
    assert.equal( transactionCountData, 2 );

});

test( 'external identity repository HMAC indexes subjects and encrypts claims', async function(){
    const queryCallsData = /** @type {any[]} */ ([]);
    let insertedValuesData = /** @type {readonly any[] | null} */ (null);
    const repositoryData = layerAuthExternalIdentityRepositoryCreate({
        database: {
            systemSchema: 'layer_auth_test',

            async query( /** @type {any} */ queryData ){
                queryCallsData.push( queryData );

                if ( queryData.text.includes( 'INSERT INTO' ) ){
                    insertedValuesData = queryData.values;
                    return {rows: [], rowCount: 1};

                }

                if ( queryData.text.includes( 'SELECT' ) ){
                    assert.ok( insertedValuesData !== null );
                    return {
                        rows: [{
                            external_identity_id: insertedValuesData[0],
                            user_id: insertedValuesData[1],
                            claims: JSON.parse( insertedValuesData[4] ),
                            status: 'active'
                        }],
                        rowCount: 1
                    };

                }

                return {rows: [], rowCount: 0};

            },

            async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
                return transactionHandlerData( this );

            }
        },
        envelope: {
            seal( /** @type {any} */ valueData, /** @type {string} */ purposeData ){
                assert.equal( purposeData, 'external-identity-claims' );
                assert.equal( valueData.email, 'verified@example.test' );
                return Buffer.from( 'encrypted-claims-envelope', 'utf8' );

            },
            open( /** @type {Uint8Array} */ envelopeData, /** @type {string} */ purposeData ){
                assert.equal( purposeData, 'external-identity-claims' );
                assert.equal( Buffer.from( envelopeData ).toString( 'utf8' ), 'encrypted-claims-envelope' );
                return {email: 'verified@example.test', email_verified: true};

            }
        },
        subjectPepper: 'external-subject-pepper-with-at-least-thirty-two-characters',
        identifierCreate(){
            return 'external-identity-id';

        }
    });

    await repositoryData.create({
        providerId: 'company-identity',
        subject: 'raw-upstream-subject',
        userId: 'user-external-test',
        claims: {
            email: 'verified@example.test',
            email_verified: true
        }
    });

    assert.ok( insertedValuesData !== null );
    assert.equal( insertedValuesData.includes( 'raw-upstream-subject' ), false );
    assert.equal( String( insertedValuesData[4] ).includes( 'verified@example.test' ), false );

    const identityData = await repositoryData.find( 'company-identity', 'raw-upstream-subject' );

    assert.equal( identityData?.userId, 'user-external-test' );
    assert.equal( identityData?.status, 'active' );
    assert.equal( identityData?.claims.email, 'verified@example.test' );
    assert.equal( queryCallsData[1].values.includes( 'raw-upstream-subject' ), false );

});

test( 'external identity repository rejects malformed decrypted claims', async function(){
    const repositoryData = layerAuthExternalIdentityRepositoryCreate({
        database: {
            systemSchema: 'layer_auth_test',

            async query(){
                return {
                    rows: [{
                        external_identity_id: 'external-identity-id',
                        user_id: 'user-external-test',
                        claims: {envelope: Buffer.from( 'invalid-claims', 'utf8' ).toString( 'base64url' )},
                        status: 'active'
                    }],
                    rowCount: 1
                };

            },

            async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
                return transactionHandlerData( this );

            }
        },
        envelope: {
            seal(){
                return Buffer.from( 'unused', 'utf8' );

            },
            open(){
                return ['claims-must-not-be-an-array'];

            }
        },
        subjectPepper: 'external-subject-pepper-with-at-least-thirty-two-characters'
    });

    await assert.rejects(
        repositoryData.find( 'company-identity', 'raw-upstream-subject' ),
        /claims must be an object/u
    );

});

test( 'Auth user repository creates identity and Argon2id credential atomically', async function(){
    const transactionCallsData = /** @type {any[]} */ ([]);
    const databaseData = {
        systemSchema: 'layer_auth_test',

        async query(){
            return {rows: [], rowCount: 0};

        },

        async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
            return transactionHandlerData({
                async query( /** @type {any} */ queryData ){
                    transactionCallsData.push( queryData );
                    return {rows: [], rowCount: 1};

                }
            });

        }
    };
    let identifierIndexData = Number( 0 );
    const repositoryData = layerAuthUserRepositoryCreate({
        database: databaseData,
        identifierCreate(){
            identifierIndexData += Number( 1 );
            return `identifier-${Number( identifierIndexData )}`;

        }
    });

    const userCreateResultData = await repositoryData.create({
        userId: 'user-auth-1',
        status: 'active',
        identifier: {
            type: 'email',
            normalized: 'developer@example.test',
            display: 'developer@example.test',
            verified: true
        },
        password: {
            hash: '$argon2id$v=19$m=19456,t=2,p=1$test$hash',
            parameters: {
                memoryCost: 19456,
                timeCost: 2,
                parallelism: 1
            }
        }
    });

    assert.deepEqual( userCreateResultData, {userId: 'user-auth-1', status: 'active'} );
    assert.equal( transactionCallsData.length, 3 );
    assert.match( transactionCallsData[0].text, /sys_auth_users/u );
    assert.match( transactionCallsData[1].text, /sys_auth_identifiers/u );
    assert.match( transactionCallsData[2].text, /sys_auth_password_credentials/u );
    assert.equal( transactionCallsData[1].values[3], 'developer@example.test' );
    assert.equal( transactionCallsData[2].text.includes( 'developer@example.test' ), false );

});

test( 'Auth user repository resolves identity and global permissions with bound values', async function(){
    const queryCallsData = /** @type {any[]} */ ([]);
    const repositoryData = layerAuthUserRepositoryCreate({
        database: {
            systemSchema: 'layer_auth_test',

            async query( /** @type {any} */ queryData ){
                queryCallsData.push( queryData );

                if ( queryData.text.includes( 'DISTINCT permissions.permission' ) ){
                    return {
                        rows: [{permission: 'chat.message.send'}],
                        rowCount: 1
                    };

                }

                return {
                    rows: [{
                        user_id: 'user-auth-1',
                        status: 'active',
                        identifier_id: 'identifier-1',
                        verified_at: new Date(),
                        password_hash: '$argon2id$hash',
                        parameters: {memoryCost: 19456}
                    }],
                    rowCount: 1
                };

            },

            async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
                return transactionHandlerData( this );

            }
        }
    });

    const identityData = await repositoryData.findByIdentifier( 'email', 'developer@example.test' );
    const permissionsData = await repositoryData.permissionsResolve( 'user-auth-1' );

    assert.equal( identityData?.userId, 'user-auth-1' );
    assert.equal( identityData?.verified, true );
    assert.deepEqual( permissionsData, ['chat.message.send'] );
    assert.deepEqual( queryCallsData[0].values, ['email', 'developer@example.test'] );
    assert.equal( queryCallsData[0].text.includes( 'developer@example.test' ), false );

});

test( 'Auth user repository anonymizes every Layer-owned credential transactionally', async function(){
    const transactionCallsData = /** @type {any[]} */ ([]);
    const repositoryData = layerAuthUserRepositoryCreate({
        database: {
            systemSchema: 'layer_auth_test',

            async query(){
                return {rows: [], rowCount: 0};

            },

            async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
                return transactionHandlerData({
                    async query( /** @type {any} */ queryData ){
                        transactionCallsData.push( queryData );

                        if ( queryData.text.includes( 'FOR UPDATE' ) ){
                            return {
                                rows: [{user_id: 'user-auth-anonymize', status: 'disabled'}],
                                rowCount: 1
                            };

                        }

                        return {rows: [], rowCount: 1};

                    }
                });

            }
        }
    });

    const anonymizedStatusData = await repositoryData.anonymize( 'user-auth-anonymize' );
    const deleteSourcesData = transactionCallsData
        .filter(function deleteCallFind( queryData ){
            return queryData.text.includes( 'DELETE FROM' );

        })
        .map(function deleteSourceMap( queryData ){
            return String( queryData.text );

        })
        .join( '\n' );

    assert.equal( anonymizedStatusData, true );
    assert.match( deleteSourcesData, /sys_auth_identifiers/u );
    assert.match( deleteSourcesData, /sys_auth_password_credentials/u );
    assert.match( deleteSourcesData, /sys_auth_passkeys/u );
    assert.match( deleteSourcesData, /sys_auth_totp_credentials/u );
    assert.match( deleteSourcesData, /sys_auth_recovery_codes/u );
    assert.match( deleteSourcesData, /sys_auth_external_identities/u );
    assert.match( deleteSourcesData, /sys_auth_user_roles/u );
    assert.match( transactionCallsData.at( -1 ).text, /status = 'anonymized'/u );

});

test( 'Managed Auth session stores hashes and returns opaque credentials once', async function(){
    const queryCallsData = /** @type {any[]} */ ([]);
    const issuedAtData = Date.parse( '2026-09-23T12:00:00.000Z' );
    const tokensData = [
        'session-token-value-with-sufficient-entropy',
        'csrf-token-value-with-sufficient-entropy'
    ];
    const identifiersData = ['session-id', 'family-id'];
    const repositoryData = layerAuthSessionRepositoryCreate({
        database: {
            systemSchema: 'layer_auth_test',

            async query( /** @type {any} */ queryData ){
                queryCallsData.push( queryData );
                return {rows: [], rowCount: 1};

            },

            async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
                return transactionHandlerData( this );

            }
        },
        sessionPepper: 'session-pepper-with-more-than-thirty-two-characters',
        clock(){
            return issuedAtData;

        },
        identifierCreate(){
            return String( identifiersData.shift() );

        },
        tokenCreate(){
            return String( tokensData.shift() );

        }
    });

    const sessionIssueResultData = await repositoryData.issue({
        userId: 'user-auth-1',
        permissions: ['chat.message.send'],
        assurance: ['password'],
        idleExpiresAt: issuedAtData + Number( 1800000 ),
        absoluteExpiresAt: issuedAtData + Number( 43200000 )
    });
    const persistedValuesData = queryCallsData[0].values;

    assert.equal( sessionIssueResultData.sessionId, 'session-id' );
    assert.equal( sessionIssueResultData.sessionToken, 'session-token-value-with-sufficient-entropy' );
    assert.equal( persistedValuesData.includes( sessionIssueResultData.sessionToken ), false );
    assert.equal( persistedValuesData.includes( sessionIssueResultData.csrfToken ), false );
    assert.match( String( persistedValuesData[0] ), /^[0-9a-f]{64}$/u );
    assert.match( String( persistedValuesData[6] ), /^[0-9a-f]{64}$/u );

});

test( 'Managed Auth session custom data uses compare-and-swap revision', async function(){
    let queryIndexData = Number( 0 );
    const queryCallsData = /** @type {any[]} */ ([]);
    const repositoryData = layerAuthSessionRepositoryCreate({
        database: {
            systemSchema: 'layer_auth_test',

            async query( /** @type {any} */ queryData ){
                queryCallsData.push( queryData );
                queryIndexData += Number( 1 );

                if ( Number( queryIndexData ) === Number( 1 ) ){
                    return {
                        rows: [{custom_data: {theme: 'dark'}, custom_data_revision: 2}],
                        rowCount: 1
                    };

                }

                return {
                    rows: [{custom_data_revision: 3}],
                    rowCount: 1
                };

            },

            async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
                return transactionHandlerData( this );

            }
        },
        sessionPepper: 'session-pepper-with-more-than-thirty-two-characters'
    });

    const sessionDataResult = await repositoryData.dataGet( 'opaque-session-token' );
    const updatedRevisionData = await repositoryData.dataReplace(
        'opaque-session-token',
        sessionDataResult?.revision ?? Number( 0 ),
        {theme: 'light'}
    );

    assert.deepEqual( sessionDataResult, {value: {theme: 'dark'}, revision: 2} );
    assert.equal( updatedRevisionData, 3 );
    assert.equal( queryCallsData[1].values[1], 2 );
    assert.equal( queryCallsData[1].values[2], '{"theme":"light"}' );
    assert.match( queryCallsData[1].text, /custom_data_revision = \$2/u );

});

test( 'Managed Auth session lifecycle resolves lists revokes and updates owned data', async function(){
    const currentTimeData = Date.parse( '2026-09-23T12:00:00.000Z' );
    const queryResultsData = [{
        rows: [{
            session_id: 'session-current-identifier',
            user_id: 'user-auth-1',
            tenant_id: 'tenant-auth-1',
            permissions: ['chat.room.read'],
            csrf_hash: 'csrf-hash',
            assurance: ['password'],
            custom_data_revision: 2,
            idle_expires_at: new Date( currentTimeData + Number( 1800000 ) ),
            absolute_expires_at: new Date( currentTimeData + Number( 43200000 ) ),
            status: 'active'
        }],
        rowCount: 1
    }, {
        rows: [{
            session_id: 'session-current-identifier',
            assurance: ['password'],
            last_seen_at: new Date( currentTimeData ),
            idle_expires_at: new Date( currentTimeData + Number( 1800000 ) ),
            absolute_expires_at: new Date( currentTimeData + Number( 43200000 ) ),
            created_at: new Date( currentTimeData - Number( 60000 ) )
        }],
        rowCount: 1
    }, {
        rows: [{session_id: 'session-current-identifier'}],
        rowCount: 1
    }, {
        rows: [],
        rowCount: 2
    }, {
        rows: [{custom_data: {locale: 'ru'}, custom_data_revision: 4}],
        rowCount: 1
    }, {
        rows: [{custom_data_revision: 5}],
        rowCount: 1
    }, {
        rows: [],
        rowCount: 0
    }, {
        rows: [],
        rowCount: 0
    }];
    const queryCallsData = /** @type {any[]} */ ([]);
    const repositoryData = layerAuthSessionRepositoryCreate({
        database: {
            systemSchema: 'layer_auth_test',

            async query( /** @type {any} */ queryData ){
                queryCallsData.push( queryData );
                return /** @type {any} */ (queryResultsData.shift());

            },

            async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
                return transactionHandlerData( this );

            }
        },
        sessionPepper: 'session-pepper-with-more-than-thirty-two-characters'
    });

    const sessionData = await repositoryData.resolve( 'opaque-session-token' );
    const sessionsData = await repositoryData.list( 'user-auth-1' );
    const revokeStatusData = await repositoryData.revokeById(
        'session-current-identifier',
        'user-auth-1',
        'manual-revoke'
    );
    const revokedCountData = await repositoryData.revokeAllByUser( 'user-auth-1' );
    const customData = await repositoryData.dataGetById(
        'session-current-identifier',
        'user-auth-1'
    );
    const revisionData = await repositoryData.dataReplaceById(
        'session-current-identifier',
        'user-auth-1',
        4,
        {locale: 'en'}
    );
    const missingCustomData = await repositoryData.dataGet( 'missing-session-token' );
    const missingRevisionData = await repositoryData.dataReplace(
        'missing-session-token',
        0,
        {}
    );

    assert.equal( sessionData?.tenantId, 'tenant-auth-1' );
    assert.equal( sessionData?.expiresAt, currentTimeData + Number( 1800000 ) );
    assert.deepEqual( sessionsData[0]?.assurance, ['password'] );
    assert.equal( revokeStatusData, true );
    assert.equal( revokedCountData, 2 );
    assert.deepEqual( customData, {value: {locale: 'ru'}, revision: 4} );
    assert.equal( revisionData, 5 );
    assert.equal( missingCustomData, null );
    assert.equal( missingRevisionData, null );
    assert.deepEqual( queryCallsData[4].values, ['session-current-identifier', 'user-auth-1'] );
    assert.deepEqual( queryCallsData[5].values.slice( 0, 3 ), ['session-current-identifier', 'user-auth-1', 4] );

});

test( 'Auth user repository manages public identity lifecycle without leaking identifiers into SQL', async function(){
    const queryCallsData = /** @type {any[]} */ ([]);
    const queryResultsData = [{
        rows: [{
            user_id: 'user-auth-1',
            status: 'active',
            disabled_reason: 'maintenance',
            anonymized_at: new Date( '2026-09-23T11:00:00.000Z' )
        }],
        rowCount: 1
    }, {
        rows: [{
            identifier_id: 'identifier-1',
            identifier_type: 'email',
            value_display: 'developer@example.test',
            verified_at: null
        }],
        rowCount: 1
    }, {
        rows: [{user_id: 'user-auth-1'}],
        rowCount: 1
    }, {
        rows: [{identifier_id: 'identifier-1'}],
        rowCount: 1
    }, {
        rows: [],
        rowCount: 1
    }, {
        rows: [{user_id: 'user-auth-1'}],
        rowCount: 1
    }, {
        rows: [],
        rowCount: 0
    }, {
        rows: [],
        rowCount: 0
    }];
    const repositoryData = layerAuthUserRepositoryCreate({
        database: {
            systemSchema: 'layer_auth_test',

            async query( /** @type {any} */ queryData ){
                queryCallsData.push( queryData );
                return /** @type {any} */ (queryResultsData.shift());

            },

            async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
                return transactionHandlerData( this );

            }
        }
    });

    const userData = await repositoryData.findById( 'user-auth-1' );
    const identifiersData = await repositoryData.identifiersList( 'user-auth-1' );
    const statusData = await repositoryData.statusSet( 'user-auth-1', 'disabled', 'maintenance' );
    const verificationData = await repositoryData.identifierVerify( 'user-auth-1', 'identifier-1' );
    const passwordData = await repositoryData.passwordReplace( 'user-auth-1', {
        hash: '$argon2id$v=19$m=19456,t=2,p=1$test$replacement',
        parameters: {memoryCost: 19456, timeCost: 2, parallelism: 1}
    });
    const missingUserData = await repositoryData.findById( 'missing-user-1' );
    const missingIdentityData = await repositoryData.findByIdentifier( 'email', 'missing@example.test' );

    assert.deepEqual( userData, {
        userId: 'user-auth-1',
        status: 'active',
        disabledReason: 'maintenance',
        anonymizedAt: Date.parse( '2026-09-23T11:00:00.000Z' )
    } );
    assert.deepEqual( identifiersData, [{
        identifierId: 'identifier-1',
        type: 'email',
        display: 'developer@example.test',
        verified: false
    }] );
    assert.equal( statusData, true );
    assert.equal( verificationData, true );
    assert.equal( passwordData, true );
    assert.equal( missingUserData, null );
    assert.equal( missingIdentityData, null );
    assert.equal( queryCallsData.every(function queryTextCheck( queryData ){
        return queryData.text.includes( 'developer@example.test' ) === false;

    }), true );

});

test( 'Auth TOTP repository rotates removes and maps confirmed credentials', async function(){
    const queryCallsData = /** @type {any[]} */ ([]);
    let credentialReadCountData = Number( 0 );
    const databaseData = {
        systemSchema: 'layer_auth_test',

        async query( /** @type {any} */ queryData ){
            queryCallsData.push( queryData );

            if ( queryData.text.includes( 'SELECT' ) === true ){
                credentialReadCountData += Number( 1 );

                if ( credentialReadCountData === Number( 1 ) ){
                    return {
                        rows: [{
                            user_id: 'user-auth-1',
                            encrypted_secret: Buffer.alloc( 64, 7 ),
                            key_id: 'v2',
                            algorithm: 'SHA256',
                            digits: 8,
                            period: 45,
                            last_counter: 200,
                            confirmed_at: new Date( '2026-09-23T12:00:00.000Z' )
                        }],
                        rowCount: 1
                    };

                }

                return {rows: [], rowCount: 0};

            }

            if ( queryData.text.includes( 'DELETE FROM' ) === true && queryData.text.includes( 'sys_auth_totp_credentials' ) === true ){
                return {rows: [{user_id: 'user-auth-1'}], rowCount: 1};

            }

            return {rows: [], rowCount: 1};

        },

        async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
            return transactionHandlerData( this );

        }
    };
    let identifierIndexData = Number( 0 );
    const repositoryData = layerAuthTotpRepositoryCreate({
        database: databaseData,
        recoveryPepper: 'recovery-pepper-with-more-than-thirty-two-characters',
        identifierCreate(){
            identifierIndexData += Number( 1 );
            return `rotated-code-${Number( identifierIndexData )}`;

        }
    });
    const credentialData = await repositoryData.get( 'user-auth-1' );
    const rotationData = await repositoryData.recoveryCodesReplace(
        'user-auth-1',
        ['ABCD-EFGH-JKLM', 'NPQR-STUV-WXYZ']
    );
    const removalData = await repositoryData.remove( 'user-auth-1' );
    const missingCredentialData = await repositoryData.get( 'missing-user-1' );

    assert.equal( credentialData?.confirmedAt, Date.parse( '2026-09-23T12:00:00.000Z' ) );
    assert.equal( credentialData?.lastCounter, 200 );
    assert.equal( rotationData, true );
    assert.equal( removalData, true );
    assert.equal( missingCredentialData, null );
    assert.equal( queryCallsData.filter(function recoveryInsertFind( queryData ){
        return queryData.text.includes( 'INSERT INTO' ) === true;

    }).length, 2 );

});

test( 'Auth repositories fail closed for invalid construction and mutation input', async function(){
    assert.throws(
        function invalidSessionRepositoryCreate(){
            layerAuthSessionRepositoryCreate( /** @type {any} */ (null) );

        },
        /transactional database/u
    );
    assert.throws(
        function invalidUserRepositoryCreate(){
            layerAuthUserRepositoryCreate( /** @type {any} */ ({database: {}}) );

        },
        /transactional database/u
    );
    assert.throws(
        function invalidTotpRepositoryCreate(){
            layerAuthTotpRepositoryCreate( /** @type {any} */ ({database: {}}) );

        },
        /transactional database/u
    );

    const databaseData = {
        async query(){
            return {rows: [], rowCount: 0};

        },
        async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
            return transactionHandlerData( this );

        }
    };
    const sessionRepositoryData = layerAuthSessionRepositoryCreate({
        database: databaseData,
        sessionPepper: 'session-pepper-with-more-than-thirty-two-characters'
    });
    const userRepositoryData = layerAuthUserRepositoryCreate({database: databaseData});
    const totpRepositoryData = layerAuthTotpRepositoryCreate({
        database: databaseData,
        recoveryPepper: 'recovery-pepper-with-more-than-thirty-two-characters'
    });

    await assert.rejects(
        sessionRepositoryData.issue({
            userId: '',
            idleExpiresAt: 1,
            absoluteExpiresAt: 2
        }),
        /user identifier/u
    );
    await assert.rejects(
        sessionRepositoryData.issue({
            userId: 'user-auth-1',
            idleExpiresAt: 0,
            absoluteExpiresAt: 2
        }),
        /idleExpiresAt/u
    );
    await assert.rejects(
        sessionRepositoryData.issue({
            userId: 'user-auth-1',
            idleExpiresAt: 3,
            absoluteExpiresAt: 2
        }),
        /cannot precede/u
    );
    await assert.rejects(
        userRepositoryData.findByIdentifier( /** @type {any} */ ('fax'), 'developer@example.test' ),
        /identifier type/u
    );
    await assert.rejects(
        userRepositoryData.findByIdentifier( 'email', ' developer@example.test ' ),
        /identifier value is invalid/u
    );
    await assert.rejects(
        userRepositoryData.findById( 'short' ),
        /user identifier/u
    );
    await assert.rejects(
        userRepositoryData.statusSet( 'user-auth-1', /** @type {any} */ ('blocked') ),
        /status is invalid/u
    );
    await assert.rejects(
        userRepositoryData.statusSet( 'user-auth-1', 'disabled', 'x'.repeat( 241 ) ),
        /reason is invalid/u
    );
    await assert.rejects(
        userRepositoryData.passwordReplace( 'user-auth-1', /** @type {any} */ ({hash: 'plaintext'}) ),
        /Argon2id/u
    );
    await assert.rejects(
        totpRepositoryData.recoveryCodeConsume( 'user-auth-1', 'invalid-code' ),
        /recovery code is invalid/u
    );

});

test( 'Auth role repository replaces a sorted permission set atomically', async function(){
    const transactionCallsData = /** @type {any[]} */ ([]);
    const repositoryData = layerAuthRoleRepositoryCreate({
        database: {
            systemSchema: 'layer_auth_test',

            async query(){
                return {rows: [], rowCount: 0};

            },

            async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
                return transactionHandlerData({
                    async query( /** @type {any} */ queryData ){
                        transactionCallsData.push( queryData );

                        if ( queryData.text.includes( 'RETURNING role_id, role_name, status' ) ){
                            return {
                                rows: [{role_id: 'role-1', role_name: 'support-agent', status: 'active'}],
                                rowCount: 1
                            };

                        }

                        return {rows: [], rowCount: 1};

                    }
                });

            }
        },
        identifierCreate(){
            return 'role-1';

        }
    });

    const roleDefineResultData = await repositoryData.define({
        name: 'support-agent',
        permissions: ['chat.room.read', 'chat.message.send']
    });

    assert.deepEqual( roleDefineResultData, {
        id: 'role-1',
        name: 'support-agent',
        status: 'active',
        permissions: ['chat.message.send', 'chat.room.read']
    });
    assert.equal( transactionCallsData.length, 4 );
    assert.match( transactionCallsData[0].text, /sys_auth_roles/u );
    assert.match( transactionCallsData[1].text, /DELETE FROM .*sys_auth_role_permissions/u );
    assert.deepEqual( transactionCallsData[2].values, ['role-1', 'chat.message.send'] );
    assert.deepEqual( transactionCallsData[3].values, ['role-1', 'chat.room.read'] );

    await assert.rejects(
        repositoryData.define({
            name: 'support-agent',
            permissions: ['chat.room.read', 'chat.room.read']
        }),
        /invalid or duplicate/u
    );

});

test( 'Auth role repository assigns, removes, and lists active roles with bound values', async function(){
    const queryCallsData = /** @type {any[]} */ ([]);
    let queryIndexData = Number( 0 );
    const repositoryData = layerAuthRoleRepositoryCreate({
        database: {
            systemSchema: 'layer_auth_test',

            async query( /** @type {any} */ queryData ){
                queryCallsData.push( queryData );
                queryIndexData += Number( 1 );

                if ( queryData.text.includes( 'SELECT user_roles.user_id' ) ){
                    return {
                        rows: [{user_id: 'user-auth-1'}],
                        rowCount: 1
                    };

                }

                if ( Number( queryIndexData ) < Number( 3 ) ){
                    return {rows: [{role_id: 'role-1'}], rowCount: 1};

                }

                return {
                    rows: [{
                        role_id: 'role-1',
                        role_name: 'support-agent',
                        permissions: ['chat.message.send', 'chat.room.read']
                    }],
                    rowCount: 1
                };

            },

            async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
                return transactionHandlerData( this );

            }
        }
    });

    const roleAssignResultData = await repositoryData.assign( 'user-auth-1', 'support-agent' );
    const roleRemoveResultData = await repositoryData.remove( 'user-auth-1', 'support-agent' );
    const rolesLoadResultData = await repositoryData.listForUser( 'user-auth-1' );
    const assignedUsersData = await repositoryData.usersList( 'support-agent' );

    assert.equal( roleAssignResultData, true );
    assert.equal( roleRemoveResultData, true );
    assert.deepEqual( rolesLoadResultData, [{
        id: 'role-1',
        name: 'support-agent',
        permissions: ['chat.message.send', 'chat.room.read']
    }] );
    assert.deepEqual( assignedUsersData, ['user-auth-1'] );
    assert.deepEqual( queryCallsData[0].values, ['user-auth-1', 'support-agent'] );
    assert.deepEqual( queryCallsData[1].values, ['user-auth-1', 'support-agent'] );
    assert.deepEqual( queryCallsData[2].values, ['user-auth-1'] );
    assert.deepEqual( queryCallsData[3].values, ['support-agent'] );
    assert.equal( queryCallsData[0].text.includes( 'user-auth-1' ), false );

});

test( 'Auth challenge repository persists only HMAC values and consumes with one transaction', async function(){
    const queryCallsData = /** @type {any[]} */ ([]);
    const transactionCallsData = /** @type {any[]} */ ([]);
    const currentTimeData = Date.parse( '2026-09-23T12:00:00.000Z' );
    const repositoryData = layerAuthChallengeRepositoryCreate({
        database: {
            systemSchema: 'layer_auth_test',

            async query( /** @type {any} */ queryData ){
                queryCallsData.push( queryData );
                return {rows: [], rowCount: 1};

            },

            async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
                return transactionHandlerData({
                    async query( /** @type {any} */ queryData ){
                        transactionCallsData.push( queryData );

                        if ( queryData.text.includes( 'FOR UPDATE' ) ){
                            return {
                                rows: [{
                                    challenge_id: 'challenge-1',
                                    user_id: 'user-auth-1',
                                    payload: {identifierId: 'identifier-1'}
                                }],
                                rowCount: 1
                            };

                        }

                        return {rows: [], rowCount: 1};

                    }
                });

            }
        },
        challengePepper: 'challenge-pepper-with-more-than-thirty-two-characters',
        clock(){
            return currentTimeData;

        },
        identifierCreate(){
            return 'challenge-1';

        },
        tokenCreate(){
            return 'verification-token-with-sufficient-entropy';

        }
    });

    const challengeCreateResultData = await repositoryData.create({
        type: 'email-verification',
        subject: 'developer@example.test',
        userId: 'user-auth-1',
        payload: {identifierId: 'identifier-1'},
        expiresAt: currentTimeData + Number( 3600000 )
    });
    let trustedEffectStatusData = false;
    const challengeConsumeResultData = await repositoryData.consume({
        type: 'email-verification',
        token: challengeCreateResultData.token,
        async effect( challengeData, databaseData ){
            trustedEffectStatusData = true;
            assert.equal( challengeData.userId, 'user-auth-1' );
            assert.equal( typeof databaseData.query, 'function' );

        }
    });

    assert.equal( challengeCreateResultData.token, 'verification-token-with-sufficient-entropy' );
    assert.equal( queryCallsData.length, 2 );
    assert.match( String( queryCallsData[0].values[1] ), /^[0-9a-f]{64}$/u );
    assert.match( String( queryCallsData[1].values[4] ), /^[0-9a-f]{64}$/u );
    assert.equal( JSON.stringify( queryCallsData ).includes( challengeCreateResultData.token ), false );
    assert.equal( JSON.stringify( queryCallsData ).includes( 'developer@example.test' ), false );
    assert.equal( challengeConsumeResultData?.challengeId, 'challenge-1' );
    assert.equal( trustedEffectStatusData, true );
    assert.equal( transactionCallsData.length, 2 );

});

test( 'Auth mail outbox stores encrypted values and applies bounded lease state', async function(){
    const queryCallsData = /** @type {any[]} */ ([]);
    let queryIndexData = Number( 0 );
    const repositoryData = layerAuthMailRepositoryCreate({
        database: {
            systemSchema: 'layer_auth_test',

            async query( /** @type {any} */ queryData ){
                queryCallsData.push( queryData );
                queryIndexData += Number( 1 );

                if ( Number( queryIndexData ) === Number( 2 ) ){
                    return {
                        rows: [{
                            mail_id: 'mail-1',
                            template_name: 'email-verification',
                            recipient_encrypted: Buffer.alloc( 48, 1 ),
                            locale: 'en',
                            payload_encrypted: Buffer.alloc( 64, 2 ),
                            attempts: 1
                        }],
                        rowCount: 1
                    };

                }

                return {rows: [], rowCount: 1};

            },

            async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
                return transactionHandlerData( this );

            }
        },
        identifierCreate(){
            return 'mail-1';

        }
    });
    const recipientEncryptedData = Buffer.alloc( 48, 3 );
    const payloadEncryptedData = Buffer.alloc( 64, 4 );

    const mailIdentifierData = await repositoryData.enqueue({
        templateName: 'email-verification',
        recipientHash: 'a'.repeat( 64 ),
        recipientEncrypted: recipientEncryptedData,
        locale: 'en',
        payloadEncrypted: payloadEncryptedData
    });
    const leasedMailData = await repositoryData.lease({
        owner: 'worker-auth-1',
        limit: 10,
        leaseUntil: Date.now() + Number( 60000 )
    });
    const sentStatusData = await repositoryData.sent( 'mail-1', 'worker-auth-1' );
    const failedStatusData = await repositoryData.failed({
        mailId: 'mail-2',
        owner: 'worker-auth-1',
        errorCode: 'SMTP_TEMPORARY_FAILURE',
        nextAttemptAt: Date.now() + Number( 120000 ),
        terminal: false
    });

    assert.equal( mailIdentifierData, 'mail-1' );
    assert.deepEqual( queryCallsData[0].values[3], recipientEncryptedData );
    assert.deepEqual( queryCallsData[0].values[5], payloadEncryptedData );
    assert.match( queryCallsData[1].text, /FOR UPDATE SKIP LOCKED/u );
    assert.equal( leasedMailData[0]?.templateName, 'email-verification' );
    assert.equal( leasedMailData[0]?.attempts, 1 );
    assert.equal( sentStatusData, true );
    assert.equal( failedStatusData, true );
    assert.deepEqual( queryCallsData[3].values.slice( 0, 3 ), ['mail-2', 'worker-auth-1', 'pending'] );

});

test( 'Auth Passkey repository binds credential values and applies counter compare-and-swap', async function(){
    const queryCallsData = /** @type {any[]} */ ([]);
    const repositoryData = layerAuthPasskeyRepositoryCreate({
        database: {
            systemSchema: 'layer_auth_test',

            async query( /** @type {any} */ queryData ){
                queryCallsData.push( queryData );

                if ( queryData.text.includes( 'INNER JOIN' ) === true ){
                    return {
                        rows: [{
                            credential_id: 'credential-public-identifier',
                            user_id: 'user-auth-1',
                            public_key: Buffer.alloc( 32, 7 ),
                            counter: 4,
                            transports: ['internal'],
                            backup_eligible: true,
                            backup_state: false,
                            display_name: 'Development laptop',
                            user_status: 'active'
                        }],
                        rowCount: 1
                    };

                }

                if ( queryData.text.includes( 'ORDER BY created_at DESC' ) === true ){
                    return {
                        rows: [{
                            credential_id: 'credential-public-identifier',
                            transports: ['internal'],
                            display_name: 'Development laptop',
                            created_at: '2026-09-23T12:00:00.000Z',
                            last_used_at: null
                        }],
                        rowCount: 1
                    };

                }

                return {rows: [{credential_id: 'credential-public-identifier'}], rowCount: 1};

            },

            async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
                return transactionHandlerData( this );

            }
        }
    });
    const publicKeyData = Buffer.alloc( 32, 9 );

    const createStatusData = await repositoryData.create({
        credentialId: 'credential-public-identifier',
        userId: 'user-auth-1',
        publicKey: publicKeyData,
        counter: 4,
        transports: ['internal'],
        backupEligible: true,
        backupState: false,
        displayName: 'Development laptop'
    });
    const passkeyData = await repositoryData.findByCredentialId( 'credential-public-identifier' );
    const passkeysData = await repositoryData.listForUser( 'user-auth-1' );
    const counterStatusData = await repositoryData.counterAdvance({
        credentialId: 'credential-public-identifier',
        userId: 'user-auth-1',
        expectedCounter: 4,
        newCounter: 5,
        backupState: true
    });
    const removeStatusData = await repositoryData.remove(
        'credential-public-identifier',
        'user-auth-1'
    );

    assert.equal( createStatusData, true );
    assert.deepEqual( queryCallsData[0].values.slice( 0, 2 ), ['credential-public-identifier', 'user-auth-1'] );
    assert.deepEqual( queryCallsData[0].values[2], publicKeyData );
    assert.equal( queryCallsData[0].text.includes( 'credential-public-identifier' ), false );
    assert.equal( passkeyData?.userStatus, 'active' );
    assert.equal( passkeyData?.counter, 4 );
    assert.deepEqual( passkeysData, [{
        credentialId: 'credential-public-identifier',
        transports: ['internal'],
        displayName: 'Development laptop',
        createdAt: Date.parse( '2026-09-23T12:00:00.000Z' ),
        lastUsedAt: null
    }] );
    assert.equal( counterStatusData, true );
    assert.deepEqual( queryCallsData[3].values, [
        'credential-public-identifier',
        'user-auth-1',
        4,
        5,
        true
    ] );
    assert.equal( removeStatusData, true );
    assert.deepEqual( queryCallsData[4].values, ['credential-public-identifier', 'user-auth-1'] );

});

test( 'Auth TOTP repository persists encrypted seeds and HMAC-only recovery codes', async function(){
    const queryCallsData = /** @type {any[]} */ ([]);
    const databaseData = {
        systemSchema: 'layer_auth_test',

        async query( /** @type {any} */ queryData ){
            queryCallsData.push( queryData );

            if ( queryData.text.includes( 'SELECT' ) === true ){
                return {
                    rows: [{
                        user_id: 'user-auth-1',
                        encrypted_secret: Buffer.alloc( 64, 5 ),
                        key_id: 'v1',
                        algorithm: 'SHA1',
                        digits: 6,
                        period: 30,
                        last_counter: null,
                        confirmed_at: null
                    }],
                    rowCount: 1
                };

            }

            return {rows: [{user_id: 'user-auth-1'}], rowCount: 1};

        },

        async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
            return transactionHandlerData( this );

        }
    };
    let identifierIndexData = Number( 0 );
    const repositoryData = layerAuthTotpRepositoryCreate({
        database: databaseData,
        recoveryPepper: 'recovery-pepper-with-more-than-thirty-two-characters',
        identifierCreate(){
            identifierIndexData += Number( 1 );
            return `recovery-${Number( identifierIndexData )}`;

        }
    });
    const encryptedSecretData = Buffer.alloc( 64, 9 );
    const recoveryCodesData = ['ABCD-EFGH-JKLM', 'NPQR-STUV-WXYZ'];

    const pendingStatusData = await repositoryData.pendingSave({
        userId: 'user-auth-1',
        encryptedSecret: encryptedSecretData,
        keyId: 'v1',
        algorithm: 'SHA1',
        digits: 6,
        period: 30
    });
    const credentialData = await repositoryData.get( 'user-auth-1' );
    const confirmStatusData = await repositoryData.confirm({
        userId: 'user-auth-1',
        counter: 100,
        recoveryCodes: recoveryCodesData
    });
    const counterStatusData = await repositoryData.counterAdvance({
        userId: 'user-auth-1',
        expectedCounter: 100,
        counter: 101
    });
    const recoveryStatusData = await repositoryData.recoveryCodeConsume(
        'user-auth-1',
        'abcd-efgh-jklm'
    );

    assert.equal( pendingStatusData, true );
    assert.deepEqual( queryCallsData[0].values[1], encryptedSecretData );
    assert.equal( credentialData?.algorithm, 'SHA1' );
    assert.equal( credentialData?.confirmedAt, null );
    assert.equal( confirmStatusData, true );
    assert.equal( counterStatusData, true );
    assert.equal( recoveryStatusData, true );
    assert.equal( JSON.stringify( queryCallsData ).includes( String( recoveryCodesData[0] ) ), false );
    assert.equal( JSON.stringify( queryCallsData ).includes( String( recoveryCodesData[1] ) ), false );
    const recoveryInsertCallsData = queryCallsData.filter(function recoveryInsertFilter( queryData ){
        return queryData.text.includes( 'INSERT INTO' ) === true && queryData.text.includes( 'sys_auth_recovery_codes' ) === true;

    });
    assert.equal( recoveryInsertCallsData.length, 2 );
    assert.match( String( recoveryInsertCallsData[0].values[2] ), /^[0-9a-f]{64}$/u );
    assert.match( String( queryCallsData.at( -1 ).values[1] ), /^[0-9a-f]{64}$/u );

});

test( 'Auth repository constructors reject every incomplete persistence boundary', function(){
    const transactionalDatabaseData = {
        systemSchema: 'layer_auth_test',

        async query(){
            return {rows: [], rowCount: 0};

        },

        async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
            return transactionHandlerData( this );

        }
    };
    const repositoryConstructorsData = {
        challenge: /** @type {any} */ (layerAuthChallengeRepositoryCreate),
        externalIdentity: /** @type {any} */ (layerAuthExternalIdentityRepositoryCreate),
        invitation: /** @type {any} */ (layerAuthInvitationRepositoryCreate),
        mail: /** @type {any} */ (layerAuthMailRepositoryCreate),
        passkey: /** @type {any} */ (layerAuthPasskeyRepositoryCreate),
        role: /** @type {any} */ (layerAuthRoleRepositoryCreate),
        session: /** @type {any} */ (layerAuthSessionRepositoryCreate),
        totp: /** @type {any} */ (layerAuthTotpRepositoryCreate),
        user: /** @type {any} */ (layerAuthUserRepositoryCreate)
    };
    const pepperData = 'repository-pepper-with-more-than-thirty-two-characters';
    const incompleteRepositoriesData = [
        [repositoryConstructorsData.challenge, null],
        [repositoryConstructorsData.challenge, {}],
        [repositoryConstructorsData.challenge, {database: {query(){}}, challengePepper: pepperData}],
        [repositoryConstructorsData.challenge, {database: {transaction(){}}, challengePepper: pepperData}],
        [repositoryConstructorsData.challenge, {database: transactionalDatabaseData}],
        [repositoryConstructorsData.challenge, {database: transactionalDatabaseData, challengePepper: 'short'}],
        [repositoryConstructorsData.invitation, null],
        [repositoryConstructorsData.invitation, {}],
        [repositoryConstructorsData.invitation, {database: {query(){}}, invitationPepper: pepperData}],
        [repositoryConstructorsData.invitation, {database: {transaction(){}}, invitationPepper: pepperData}],
        [repositoryConstructorsData.invitation, {database: transactionalDatabaseData}],
        [repositoryConstructorsData.invitation, {database: transactionalDatabaseData, invitationPepper: 'short'}],
        [repositoryConstructorsData.invitation, {database: transactionalDatabaseData, invitationPepper: 'x'.repeat( 513 )}],
        [repositoryConstructorsData.mail, null],
        [repositoryConstructorsData.mail, {}],
        [repositoryConstructorsData.mail, {database: {query(){}}}],
        [repositoryConstructorsData.mail, {database: {transaction(){}}}],
        [repositoryConstructorsData.passkey, null],
        [repositoryConstructorsData.passkey, {}],
        [repositoryConstructorsData.passkey, {database: {query(){}}}],
        [repositoryConstructorsData.passkey, {database: {transaction(){}}}],
        [repositoryConstructorsData.role, null],
        [repositoryConstructorsData.role, {}],
        [repositoryConstructorsData.role, {database: {query(){}}}],
        [repositoryConstructorsData.role, {database: {transaction(){}}}],
        [repositoryConstructorsData.user, null],
        [repositoryConstructorsData.user, {}],
        [repositoryConstructorsData.user, {database: {query(){}}}],
        [repositoryConstructorsData.user, {database: {transaction(){}}}],
        [repositoryConstructorsData.externalIdentity, null],
        [repositoryConstructorsData.externalIdentity, {}],
        [repositoryConstructorsData.externalIdentity, {database: {query(){}}, envelope: {}, subjectPepper: pepperData}],
        [repositoryConstructorsData.externalIdentity, {database: {transaction(){}}, envelope: {}, subjectPepper: pepperData}],
        [repositoryConstructorsData.externalIdentity, {database: transactionalDatabaseData, envelope: {}, subjectPepper: pepperData}],
        [repositoryConstructorsData.externalIdentity, {database: transactionalDatabaseData, envelope: {seal(){}}, subjectPepper: pepperData}],
        [repositoryConstructorsData.externalIdentity, {database: transactionalDatabaseData, envelope: {seal(){}, open(){}}, subjectPepper: null}],
        [repositoryConstructorsData.externalIdentity, {database: transactionalDatabaseData, envelope: {seal(){}, open(){}}, subjectPepper: 'short'}],
        [repositoryConstructorsData.session, null],
        [repositoryConstructorsData.session, {}],
        [repositoryConstructorsData.session, {database: {query(){}}, sessionPepper: pepperData}],
        [repositoryConstructorsData.session, {database: {transaction(){}}, sessionPepper: pepperData}],
        [repositoryConstructorsData.session, {database: transactionalDatabaseData}],
        [repositoryConstructorsData.session, {database: transactionalDatabaseData, sessionPepper: 'short'}],
        [repositoryConstructorsData.totp, null],
        [repositoryConstructorsData.totp, {}],
        [repositoryConstructorsData.totp, {database: {query(){}}, recoveryPepper: pepperData}],
        [repositoryConstructorsData.totp, {database: {transaction(){}}, recoveryPepper: pepperData}],
        [repositoryConstructorsData.totp, {database: transactionalDatabaseData}],
        [repositoryConstructorsData.totp, {database: transactionalDatabaseData, recoveryPepper: 'short'}]
    ];

    for ( const [repositoryCreateData, repositoryOptionsData] of incompleteRepositoriesData ){
        assert.throws(function incompleteRepositoryCreate(){
            repositoryCreateData( repositoryOptionsData );

        }, TypeError);

    }

});

test( 'Auth repositories reject malformed public mutation boundaries independently', async function(){
    const currentTimeData = Date.parse( '2026-09-23T12:00:00.000Z' );
    const databaseData = {
        systemSchema: 'layer_auth_test',

        async query(){
            return {rows: [], rowCount: 0};

        },

        async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
            return transactionHandlerData( this );

        }
    };
    const challengeRepositoryData = layerAuthChallengeRepositoryCreate({
        database: databaseData,
        challengePepper: 'challenge-pepper-with-more-than-thirty-two-characters',
        clock(){
            return currentTimeData;

        },
        identifierCreate(){
            return 'challenge-identifier';

        },
        tokenCreate(){
            return 'challenge-token-with-enough-entropy';

        }
    });
    const invitationRepositoryData = layerAuthInvitationRepositoryCreate({
        database: databaseData,
        invitationPepper: 'invitation-pepper-with-more-than-thirty-two-characters',
        clock(){
            return currentTimeData;

        },
        identifierCreate(){
            return 'invitation-identifier';

        },
        tokenCreate(){
            return 'invitation-token-with-enough-entropy';

        }
    });
    const mailRepositoryData = layerAuthMailRepositoryCreate({database: databaseData});
    const passkeyRepositoryData = layerAuthPasskeyRepositoryCreate({database: databaseData});
    const roleRepositoryData = layerAuthRoleRepositoryCreate({database: databaseData});
    const externalIdentityRepositoryData = layerAuthExternalIdentityRepositoryCreate({
        database: databaseData,
        envelope: {
            seal(){
                return Buffer.alloc( 64 );

            },
            open(){
                return {};

            }
        },
        subjectPepper: 'external-subject-pepper-with-more-than-thirty-two-characters'
    });
    const challengeCreateDefaultsData = {
        type: 'email-verification',
        subject: 'developer@example.test',
        expiresAt: currentTimeData + Number( 60000 )
    };
    const invalidChallengeCreateData = [
        {...challengeCreateDefaultsData, type: null},
        {...challengeCreateDefaultsData, type: 'X'},
        {...challengeCreateDefaultsData, subject: null},
        {...challengeCreateDefaultsData, subject: ''},
        {...challengeCreateDefaultsData, subject: 'x'.repeat( 513 )},
        {...challengeCreateDefaultsData, attempts: 1.5},
        {...challengeCreateDefaultsData, attempts: 0},
        {...challengeCreateDefaultsData, attempts: 21},
        {...challengeCreateDefaultsData, expiresAt: Number.NaN},
        {...challengeCreateDefaultsData, expiresAt: currentTimeData},
        {...challengeCreateDefaultsData, payload: {value: 'x'.repeat( 17000 )}},
        {...challengeCreateDefaultsData, token: 'short'},
        {...challengeCreateDefaultsData, token: 'x'.repeat( 513 )}
    ];

    for ( const challengeCreateData of invalidChallengeCreateData ){
        await assert.rejects(
            challengeRepositoryData.create( /** @type {any} */ (challengeCreateData) ),
            TypeError
        );

    }

    const invalidChallengeConsumeData = [
        null,
        {type: 'X', token: 'x'.repeat( 32 )},
        {type: 'email-verification', token: null},
        {type: 'email-verification', token: 'short'},
        {type: 'email-verification', token: 'x'.repeat( 513 )}
    ];

    for ( const challengeConsumeData of invalidChallengeConsumeData ){
        assert.equal(
            await challengeRepositoryData.consume( /** @type {any} */ (challengeConsumeData) ),
            null
        );

    }

    const invitationIssueDefaultsData = {
        expiresAt: currentTimeData + Number( 60000 )
    };
    const invalidInvitationIssueData = [
        {...invitationIssueDefaultsData, roles: {}},
        {...invitationIssueDefaultsData, roles: Array.from({length: 51}, function roleCreate( valueData, indexData ){
            return 'role-' + String( indexData );

        })},
        {...invitationIssueDefaultsData, roles: [null]},
        {...invitationIssueDefaultsData, roles: ['Role']},
        {...invitationIssueDefaultsData, roles: ['support-agent', 'support-agent']},
        {...invitationIssueDefaultsData, email: 123},
        {...invitationIssueDefaultsData, email: 'x'},
        {...invitationIssueDefaultsData, email: 'x'.repeat( 321 )},
        {...invitationIssueDefaultsData, email: 'Developer@Example.test'},
        {expiresAt: 'invalid'},
        {expiresAt: currentTimeData},
        {expiresAt: currentTimeData + Number( 91 * 24 * 60 * 60 * 1000 )},
        {...invitationIssueDefaultsData, createdBy: 12},
        {...invitationIssueDefaultsData, createdBy: 'short'},
        {...invitationIssueDefaultsData, createdBy: 'x'.repeat( 129 )}
    ];

    for ( const invitationIssueData of invalidInvitationIssueData ){
        await assert.rejects(
            invitationRepositoryData.issue( /** @type {any} */ (invitationIssueData) ),
            TypeError
        );

    }

    const invalidInvitationConsumeData = [
        null,
        {token: 'short', effect(){}},
        {token: 'x'.repeat( 513 ), effect(){}},
        {token: 'invitation token with whitespace and enough length', effect(){}},
        {token: 'invitation-token-with-enough-entropy', effect: null}
    ];

    for ( const invitationConsumeData of invalidInvitationConsumeData ){
        assert.equal(
            await invitationRepositoryData.consume( /** @type {any} */ (invitationConsumeData) ),
            null
        );

    }

    const mailEnqueueDefaultsData = {
        templateName: 'email-verification',
        recipientHash: 'a'.repeat( 64 ),
        locale: 'en',
        recipientEncrypted: Buffer.alloc( 32 ),
        payloadEncrypted: Buffer.alloc( 32 )
    };
    const invalidMailEnqueueData = [
        {...mailEnqueueDefaultsData, templateName: null},
        {...mailEnqueueDefaultsData, templateName: 'X'},
        {...mailEnqueueDefaultsData, recipientHash: null},
        {...mailEnqueueDefaultsData, recipientHash: 'x'},
        {...mailEnqueueDefaultsData, locale: null},
        {...mailEnqueueDefaultsData, locale: 'english'},
        {...mailEnqueueDefaultsData, recipientEncrypted: 'not-bytes'},
        {...mailEnqueueDefaultsData, recipientEncrypted: Buffer.alloc( 31 )},
        {...mailEnqueueDefaultsData, recipientEncrypted: Buffer.alloc( 2049 )},
        {...mailEnqueueDefaultsData, payloadEncrypted: 'not-bytes'},
        {...mailEnqueueDefaultsData, payloadEncrypted: Buffer.alloc( 31 )},
        {...mailEnqueueDefaultsData, payloadEncrypted: Buffer.alloc( 65537 )}
    ];

    for ( const mailEnqueueData of invalidMailEnqueueData ){
        await assert.rejects(
            mailRepositoryData.enqueue( /** @type {any} */ (mailEnqueueData) ),
            TypeError
        );

    }

    const mailLeaseDefaultsData = {
        owner: 'worker-auth-1',
        limit: 1,
        leaseUntil: Date.now() + Number( 60000 )
    };
    const invalidMailLeaseData = [
        {...mailLeaseDefaultsData, owner: null},
        {...mailLeaseDefaultsData, owner: 'short'},
        {...mailLeaseDefaultsData, owner: 'x'.repeat( 129 )},
        {...mailLeaseDefaultsData, limit: 1.5},
        {...mailLeaseDefaultsData, limit: 0},
        {...mailLeaseDefaultsData, limit: 51},
        {...mailLeaseDefaultsData, leaseUntil: Number.NaN},
        {...mailLeaseDefaultsData, leaseUntil: Date.now()}
    ];

    for ( const mailLeaseData of invalidMailLeaseData ){
        await assert.rejects(
            mailRepositoryData.lease( /** @type {any} */ (mailLeaseData) ),
            TypeError
        );

    }

    await assert.rejects(
        mailRepositoryData.failed( /** @type {any} */ ({errorCode: null}) ),
        TypeError
    );
    await assert.rejects(
        mailRepositoryData.failed( /** @type {any} */ ({errorCode: 'x'}) ),
        TypeError
    );

    const passkeyCreateDefaultsData = {
        credentialId: 'credential-id',
        userId: 'user-auth-1',
        publicKey: Buffer.alloc( 16 ),
        counter: 0,
        transports: [],
        backupEligible: false,
        backupState: false,
        displayName: 'Development laptop'
    };
    const invalidPasskeyCreateData = [
        {...passkeyCreateDefaultsData, credentialId: null},
        {...passkeyCreateDefaultsData, credentialId: 'short'},
        {...passkeyCreateDefaultsData, userId: null},
        {...passkeyCreateDefaultsData, userId: ''},
        {...passkeyCreateDefaultsData, userId: 'x'.repeat( 129 )},
        {...passkeyCreateDefaultsData, publicKey: null},
        {...passkeyCreateDefaultsData, publicKey: Buffer.alloc( 15 )},
        {...passkeyCreateDefaultsData, publicKey: Buffer.alloc( 16385 )},
        {...passkeyCreateDefaultsData, counter: 1.5},
        {...passkeyCreateDefaultsData, counter: -1},
        {...passkeyCreateDefaultsData, displayName: null},
        {...passkeyCreateDefaultsData, displayName: ''},
        {...passkeyCreateDefaultsData, displayName: 'x'.repeat( 121 )},
        {...passkeyCreateDefaultsData, transports: {}},
        {...passkeyCreateDefaultsData, transports: Array.from({length: 9}, function transportCreate(){
            return 'usb';

        })},
        {...passkeyCreateDefaultsData, transports: [null]},
        {...passkeyCreateDefaultsData, transports: ['unknown']},
        {...passkeyCreateDefaultsData, transports: ['usb', 'usb']}
    ];

    for ( const passkeyCreateData of invalidPasskeyCreateData ){
        await assert.rejects(
            passkeyRepositoryData.create( /** @type {any} */ (passkeyCreateData) ),
            TypeError
        );

    }

    const invalidRoleDefineData = [
        {name: null, permissions: []},
        {name: 'Role', permissions: []},
        {name: 'support-agent', permissions: {}},
        {
            name: 'support-agent',
            permissions: Array.from({length: 501}, function permissionCreate( valueData, indexData ){
                return 'resource.' + String( indexData );

            })
        },
        {name: 'support-agent', permissions: [null]},
        {name: 'support-agent', permissions: ['resource']},
        {name: 'support-agent', permissions: ['resource.read', 'resource.read']},
        {name: 'support-agent', permissions: [], status: 'pending'}
    ];

    for ( const roleDefineData of invalidRoleDefineData ){
        await assert.rejects(
            roleRepositoryData.define( /** @type {any} */ (roleDefineData) ),
            TypeError
        );

    }

    await assert.rejects(
        roleRepositoryData.assign( 'user-auth-1', 'support-agent', /** @type {any} */ ({}) ),
        TypeError
    );

    const invalidExternalFindData = [
        [null, 'subject'],
        ['Provider', 'subject'],
        ['provider', null],
        ['provider', ''],
        ['provider', 'x'.repeat( 513 )]
    ];

    for ( const [providerIdentifierData, subjectData] of invalidExternalFindData ){
        await assert.rejects(
            externalIdentityRepositoryData.find(
                /** @type {any} */ (providerIdentifierData),
                /** @type {any} */ (subjectData)
            ),
            TypeError
        );

    }

    const externalIdentityDefaultsData = {
        providerId: 'provider',
        subject: 'subject',
        userId: 'user-auth-1',
        claims: {}
    };
    const invalidExternalCreateData = [
        {...externalIdentityDefaultsData, claims: null},
        {...externalIdentityDefaultsData, claims: []},
        {...externalIdentityDefaultsData, claims: {value: 'x'.repeat( 17000 )}},
        {...externalIdentityDefaultsData, userId: null},
        {...externalIdentityDefaultsData, userId: 'short'},
        {...externalIdentityDefaultsData, userId: 'x'.repeat( 129 )}
    ];

    for ( const externalIdentityData of invalidExternalCreateData ){
        await assert.rejects(
            externalIdentityRepositoryData.create( /** @type {any} */ (externalIdentityData) ),
            TypeError
        );

    }

});

test( 'Auth user and session repositories validate each identity boundary', async function(){
    const databaseData = {
        systemSchema: 'layer_auth_test',

        async query(){
            return {rows: [], rowCount: 0};

        },

        async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
            return transactionHandlerData( this );

        }
    };
    const userRepositoryData = layerAuthUserRepositoryCreate({database: databaseData});
    const sessionRepositoryData = layerAuthSessionRepositoryCreate({
        database: databaseData,
        sessionPepper: 'session-pepper-with-more-than-thirty-two-characters'
    });
    const userCreateDefaultsData = {
        userId: 'user-auth-1',
        status: 'active',
        identifier: {
            type: 'email',
            normalized: 'developer@example.test',
            display: 'developer@example.test',
            verified: true
        },
        password: null
    };
    const invalidUserCreateData = [
        {...userCreateDefaultsData, identifier: {...userCreateDefaultsData.identifier, type: null}},
        {...userCreateDefaultsData, identifier: {...userCreateDefaultsData.identifier, type: 'fax'}},
        {...userCreateDefaultsData, identifier: {...userCreateDefaultsData.identifier, normalized: null}},
        {...userCreateDefaultsData, identifier: {...userCreateDefaultsData.identifier, normalized: ''}},
        {...userCreateDefaultsData, identifier: {...userCreateDefaultsData.identifier, normalized: 'x'.repeat( 321 )}},
        {...userCreateDefaultsData, identifier: {...userCreateDefaultsData.identifier, normalized: ' developer@example.test '}},
        {...userCreateDefaultsData, userId: 12},
        {...userCreateDefaultsData, userId: 'short'},
        {...userCreateDefaultsData, userId: 'x'.repeat( 129 )},
        {...userCreateDefaultsData, status: 'blocked'},
        {...userCreateDefaultsData, identifier: {...userCreateDefaultsData.identifier, display: null}},
        {...userCreateDefaultsData, identifier: {...userCreateDefaultsData.identifier, display: ''}},
        {...userCreateDefaultsData, identifier: {...userCreateDefaultsData.identifier, display: 'x'.repeat( 321 )}},
        {...userCreateDefaultsData, password: {hash: null, parameters: {}}},
        {...userCreateDefaultsData, password: {hash: 'plaintext', parameters: {}}},
        {...userCreateDefaultsData, password: {hash: '$argon2id$valid', parameters: null}}
    ];

    for ( const userCreateData of invalidUserCreateData ){
        await assert.rejects(
            userRepositoryData.create( /** @type {any} */ (userCreateData) ),
            TypeError
        );

    }

    await assert.rejects(
        userRepositoryData.create(
            /** @type {any} */ (userCreateDefaultsData),
            /** @type {any} */ ({})
        ),
        TypeError
    );

    const sessionIssueDefaultsData = {
        userId: 'user-auth-1',
        idleExpiresAt: Date.now() + Number( 60000 ),
        absoluteExpiresAt: Date.now() + Number( 120000 )
    };
    const invalidSessionIssueData = [
        {...sessionIssueDefaultsData, userId: null},
        {...sessionIssueDefaultsData, userId: ''},
        {...sessionIssueDefaultsData, userId: 'x'.repeat( 129 )},
        {...sessionIssueDefaultsData, idleExpiresAt: Number.NaN},
        {...sessionIssueDefaultsData, idleExpiresAt: 0},
        {...sessionIssueDefaultsData, absoluteExpiresAt: Number.NaN},
        {...sessionIssueDefaultsData, absoluteExpiresAt: 0},
        {...sessionIssueDefaultsData, idleExpiresAt: 20, absoluteExpiresAt: 10}
    ];

    for ( const sessionIssueData of invalidSessionIssueData ){
        await assert.rejects(
            sessionRepositoryData.issue( /** @type {any} */ (sessionIssueData) ),
            TypeError
        );

    }

});

test( 'Auth TOTP confirmation reports an atomic compare-and-swap miss', async function(){
    const repositoryData = layerAuthTotpRepositoryCreate({
        database: {
            systemSchema: 'layer_auth_test',

            async query(){
                return {rows: [], rowCount: 0};

            },

            async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
                return transactionHandlerData( this );

            }
        },
        recoveryPepper: 'recovery-pepper-with-more-than-thirty-two-characters'
    });

    assert.equal(
        await repositoryData.confirm({
            userId: 'user-auth-1',
            counter: 100,
            recoveryCodes: []
        }),
        false
    );

});

test( 'Auth repositories keep replay and compare-and-swap misses neutral', async function(){
    const currentTimeData = Date.parse( '2026-09-23T12:00:00.000Z' );
    let invitationModeData = 'expired';
    const invitationRepositoryData = layerAuthInvitationRepositoryCreate({
        database: {
            systemSchema: 'layer_auth_test',

            async query(){
                return {rows: [], rowCount: 0};

            },

            async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
                return transactionHandlerData({
                    async query( /** @type {any} */ queryData ){
                        if ( queryData.text.includes( 'SELECT invitation_id' ) === true ){
                            return {
                                rows: [{
                                    invitation_id: 'invitation-1',
                                    email_normalized: 'owner@example.test',
                                    roles: [],
                                    expires_at: invitationModeData === 'expired' ?
                                        new Date( currentTimeData - Number( 1 ) ) :
                                        new Date( currentTimeData + Number( 60000 ) ),
                                    consumed_at: null
                                }],
                                rowCount: 1
                            };

                        }

                        return {rows: [], rowCount: 0};

                    }
                });

            }
        },
        invitationPepper: 'invitation-pepper-with-more-than-thirty-two-characters',
        clock(){
            return currentTimeData;

        }
    });
    const invitationConsumeData = {
        token: 'invitation-token-with-enough-entropy',
        email: 'owner@example.test',
        async effect(){
            return {accepted: true};

        }
    };

    assert.equal( await invitationRepositoryData.consume( invitationConsumeData ), null );
    invitationModeData = 'email-mismatch';
    assert.equal(
        await invitationRepositoryData.consume({
            ...invitationConsumeData,
            email: 'other@example.test'
        }),
        null
    );
    invitationModeData = 'atomic-miss';

    await assert.rejects(
        invitationRepositoryData.consume( invitationConsumeData ),
        /could not be consumed atomically/u
    );

    const challengeRepositoryData = layerAuthChallengeRepositoryCreate({
        database: {
            systemSchema: 'layer_auth_test',
            async query(){
                return {rows: [], rowCount: 0};

            },
            async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
                return transactionHandlerData( this );

            }
        },
        challengePepper: 'challenge-pepper-with-more-than-thirty-two-characters'
    });

    assert.equal(
        await challengeRepositoryData.consume({
            type: 'email-verification',
            token: 'challenge-token-with-enough-entropy'
        }),
        null
    );

    const roleRepositoryData = layerAuthRoleRepositoryCreate({
        database: {
            systemSchema: 'layer_auth_test',
            async query(){
                return {rows: [], rowCount: 0};

            },
            async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
                return transactionHandlerData( this );

            }
        }
    });

    await assert.rejects(
        roleRepositoryData.define({
            name: 'support-agent',
            permissions: []
        }),
        /did not return its identifier/u
    );

    const passkeyRepositoryData = layerAuthPasskeyRepositoryCreate({
        database: {
            systemSchema: 'layer_auth_test',
            async query(){
                return {rows: [], rowCount: 0};

            },
            async transaction( /** @type {(databaseData: any) => Promise<any>} */ transactionHandlerData ){
                return transactionHandlerData( this );

            }
        }
    });

    assert.equal(
        await passkeyRepositoryData.findByCredentialId( 'missing-credential' ),
        null
    );

});
