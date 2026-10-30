import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LayerAuthError,
    layerAuthConfigurationCreate,
    layerAuthConfigurationRedact,
    layerAuthIdentifierCreate,
    layerAuthPasswordCheck,
    layerAuthPasswordHashCreate,
    layerAuthPasswordLengthGet,
    layerAuthPasswordVerify,
    layerAuthSessionDataCreate
} from '../src/index.js';

test( 'Layer Auth stays disabled when configuration is null', function(){
    assert.equal( layerAuthConfigurationCreate( null ), null );

});

test( 'Layer Auth accepts only enabled E.164 phone identifiers', function(){
    const phoneConfigurationData = layerAuthConfigurationCreate({
        enabled: true,
        registration: {mode: 'open'},
        identifiers: {email: false, username: false, phone: true}
    });
    const phoneIdentifierData = layerAuthIdentifierCreate(
        ' +79991234567 ',
        phoneConfigurationData.identifiers
    );

    assert.equal( phoneIdentifierData.type, 'phone' );
    assert.equal( phoneIdentifierData.normalized, '+79991234567' );
    assert.throws(function malformedPhoneCheck(){
        layerAuthIdentifierCreate( '+09991234567', phoneConfigurationData.identifiers );

    }, LayerAuthError);
    assert.throws(function disabledEmailCheck(){
        layerAuthIdentifierCreate( 'member@example.test', phoneConfigurationData.identifiers );

    }, LayerAuthError);

});

test( 'Layer Auth creates secure password and session defaults', function(){
    const configurationData = layerAuthConfigurationCreate({
        enabled: true,
        registration: {
            mode: 'open'
        }
    });

    assert.equal( configurationData?.registration.mode, 'open' );
    assert.equal( configurationData?.password.minimumLength, 12 );
    assert.equal( configurationData?.session.dataMaximumBytes, 16384 );
    assert.equal( configurationData?.identifiers.email, true );

});

test( 'Layer Auth normalized configuration is valid when checked again', function(){
    const configurationData = layerAuthConfigurationCreate({
        enabled: true,
        registration: {mode: 'open'}
    });
    const repeatedConfigurationData = layerAuthConfigurationCreate( configurationData );

    assert.deepEqual( repeatedConfigurationData, configurationData );

});

test( 'Layer Auth requires SMTP for mandatory email verification', function(){
    assert.throws(function configurationCreate(){
        layerAuthConfigurationCreate({
            enabled: true,
            emailVerification: {
                required: true
            }
        });

    }, function errorCheck( errorData ){
        assert.ok( errorData instanceof LayerAuthError );
        assert.equal( errorData.details?.path, 'auth.smtp' );
        return true;

    });

});

test( 'Layer Auth requires SMTP for enabled password recovery', function(){
    assert.throws(function configurationCreate(){
        layerAuthConfigurationCreate({
            enabled: true,
            passwordRecovery: {
                enabled: true
            }
        });

    }, function errorCheck( errorData ){
        assert.ok( errorData instanceof LayerAuthError );
        assert.equal( errorData.details?.path, 'auth.smtp' );
        return true;

    });

});

test( 'Layer Auth redacts secrets and executable hooks', function(){
    const configurationData = layerAuthConfigurationCreate({
        enabled: true,
        secret: {
            env: 'LAYER_AUTH_SECRET'
        },
        authorizationResolve: async function authorizationResolve(){
            return Object.freeze({permissions: []});

        },
        smtp: {
            host: '127.0.0.1',
            port: 2525,
            secure: false,
            username: 'mailer',
            password: {
                env: 'LAYER_SMTP_PASSWORD'
            },
            from: 'Layer <layer@example.test>'
        }
    });
    const publicConfigurationData = layerAuthConfigurationRedact( configurationData );

    assert.deepEqual( publicConfigurationData?.secret, {configured: true} );
    assert.deepEqual( publicConfigurationData?.smtp.password, {configured: true} );
    assert.equal( publicConfigurationData?.authorizationResolve, '[server function]' );
    assert.equal( JSON.stringify( publicConfigurationData ).includes( 'LAYER_SMTP_PASSWORD' ), false );

});

test( 'Layer Auth isolates bounded custom session data', function(){
    const sourceData = {
        editorMode: 'compact',
        filters: {
            unread: true
        }
    };
    const sessionDataResult = layerAuthSessionDataCreate( sourceData );

    sourceData.filters.unread = false;

    assert.equal( /** @type {any} */ (sessionDataResult.filters).unread, true );
    assert.equal( Object.isFrozen( sessionDataResult ), true );
    assert.equal( Object.isFrozen( sessionDataResult.filters ), true );

});

test( 'Layer Auth rejects reserved and oversized custom session data', function(){
    assert.throws(function sessionDataCreate(){
        layerAuthSessionDataCreate({token: 'not-allowed'});

    }, /reserved field/u );

    assert.throws(function sessionDataCreate(){
        layerAuthSessionDataCreate({text: 'x'.repeat( 2048 )}, {maximumBytes: 1024});

    }, /byte limit/u );

});

test( 'Layer Auth validates OAuth clients and redacts provider secrets', function(){
    const configurationData = layerAuthConfigurationCreate({
        enabled: true,
        registration: {mode: 'open'},
        oauth: {
            issuer: 'https://auth.example.test',
            interactionUrl: '/auth/oauth',
            clients: [{
                id: 'service-client',
                type: 'confidential',
                displayName: 'Service client',
                redirectUris: ['https://client.example.test/callback'],
                grantTypes: ['client_credentials'],
                scopes: ['openid'],
                secret: {env: 'LAYER_OAUTH_CLIENT_SECRET'}
            }]
        },
        oidc: [{
            id: 'company-identity',
            issuer: 'https://identity.example.test',
            clientId: 'layer-client',
            clientSecret: {env: 'LAYER_OIDC_CLIENT_SECRET'},
            redirectUri: 'https://application.example.test/auth/callback',
            scopes: ['openid', 'email']
        }]
    });
    const publicConfigurationData = layerAuthConfigurationRedact( configurationData );

    assert.deepEqual( publicConfigurationData?.oauth.clients[0].secret, {configured: true} );
    assert.deepEqual( publicConfigurationData?.oidc, [] );
    assert.equal( JSON.stringify( publicConfigurationData ).includes( 'LAYER_OIDC_CLIENT_SECRET' ), false );

    assert.throws(function insecureClientCreate(){
        layerAuthConfigurationCreate({
            enabled: true,
            oauth: {
                issuer: 'https://auth.example.test',
                interactionUrl: '/auth/oauth',
                clients: [{
                    id: 'browser-client',
                    type: 'public',
                    displayName: 'Browser client',
                    redirectUris: ['https://client.example.test/callback'],
                    grantTypes: ['client_credentials'],
                    scopes: ['openid']
                }]
            }
        });

    }, /cannot use client_credentials/u );

});

test( 'Layer Auth external OIDC requires email identities', function(){
    assert.throws(function oidcConfigurationCreate(){
        layerAuthConfigurationCreate({
            enabled: true,
            identifiers: {
                email: false,
                username: true
            },
            oidc: [{
                id: 'company-identity',
                issuer: 'https://identity.example.test',
                clientId: 'layer-client',
                clientSecret: {env: 'LAYER_OIDC_CLIENT_SECRET'},
                redirectUri: 'https://application.example.test/auth/callback',
                scopes: ['openid', 'email']
            }]
        });

    }, /email must be enabled/u );

});

test( 'Layer Auth configuration rejects every unsafe nested contract at its exact path', function(){
    const smtpData = {
        host: '127.0.0.1',
        port: 2525,
        secure: false,
        username: null,
        password: null,
        from: 'Layer <layer@example.test>'
    };
    const passkeyData = {
        rpId: 'app.example.test',
        rpName: 'Layer application',
        origins: ['https://app.example.test'],
        userVerification: 'required',
        timeoutMs: 60000
    };
    const totpData = {
        issuer: 'Layer application',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        window: 1,
        recoveryCodeCount: 10
    };
    const oauthClientData = {
        id: 'browser-client',
        type: 'public',
        displayName: 'Browser client',
        redirectUris: ['https://client.example.test/callback'],
        grantTypes: ['authorization_code', 'refresh_token'],
        scopes: ['openid'],
        dpop: 'optional'
    };
    const oauthData = {
        issuer: 'https://auth.example.test',
        interactionUrl: '/auth/oauth',
        scopes: ['openid'],
        clients: [oauthClientData]
    };
    const oidcProviderData = {
        id: 'company-identity',
        issuer: 'https://identity.example.test',
        clientId: 'layer-client',
        clientSecret: {env: 'LAYER_OIDC_CLIENT_SECRET'},
        redirectUri: 'https://application.example.test/auth/callback',
        scopes: ['openid', 'email']
    };
    const invalidConfigurationsData = [
        {path: 'auth', value: []},
        {path: 'auth', value: {enabled: true, unknown: true}},
        {path: 'auth.enabled', value: {enabled: false}},
        {path: 'auth.registration', value: {enabled: true, registration: []}},
        {path: 'auth.registration.mode', value: {enabled: true, registration: {mode: 'automatic'}}},
        {path: 'auth.identifiers', value: {enabled: true, identifiers: {email: 'yes'}}},
        {path: 'auth.identifiers', value: {enabled: true, identifiers: {email: false, username: false}}},
        {path: 'auth.authorizationResolve', value: {enabled: true, authorizationResolve: 'resolver'}},
        {path: 'auth.anonymization', value: {enabled: true, anonymization: 'hook'}},
        {path: 'auth.password.minimumLength', value: {enabled: true, password: {minimumLength: 7}}},
        {path: 'auth.password.maximumLength', value: {enabled: true, password: {minimumLength: 64, maximumLength: 32}}},
        {path: 'auth.smtp.host', value: {enabled: true, smtp: {...smtpData, host: ''}}},
        {path: 'auth.smtp.from', value: {enabled: true, smtp: {...smtpData, from: 'x'}}},
        {path: 'auth.smtp.username', value: {enabled: true, smtp: {...smtpData, username: 42}}},
        {path: 'auth.smtp.secure', value: {enabled: true, smtp: {...smtpData, secure: 'false'}}},
        {path: 'auth.smtp.port', value: {enabled: true, smtp: {...smtpData, port: 0}}},
        {path: 'auth.smtp.password.env', value: {enabled: true, smtp: {...smtpData, password: {env: 'invalid'}}}},
        {path: 'auth.passkey.rpId', value: {enabled: true, passkey: {...passkeyData, rpId: 'https://app.example.test'}}},
        {path: 'auth.passkey.rpName', value: {enabled: true, passkey: {...passkeyData, rpName: ''}}},
        {path: 'auth.passkey.origins', value: {enabled: true, passkey: {...passkeyData, origins: []}}},
        {path: 'auth.passkey.origins', value: {enabled: true, passkey: {...passkeyData, origins: [42]}}},
        {path: 'auth.passkey.origins', value: {enabled: true, passkey: {...passkeyData, origins: ['not-a-url']}}},
        {path: 'auth.passkey.origins', value: {enabled: true, passkey: {...passkeyData, origins: ['http://app.example.test']}}},
        {path: 'auth.passkey.origins', value: {enabled: true, passkey: {...passkeyData, origins: ['https://app.example.test', 'https://app.example.test']}}},
        {path: 'auth.passkey.userVerification', value: {enabled: true, passkey: {...passkeyData, userVerification: 'discouraged'}}},
        {path: 'auth.passkey.timeoutMs', value: {enabled: true, passkey: {...passkeyData, timeoutMs: 1000}}},
        {path: 'auth.totp.issuer', value: {enabled: true, totp: {...totpData, issuer: 'Layer\napplication'}}},
        {path: 'auth.totp.algorithm', value: {enabled: true, totp: {...totpData, algorithm: 'MD5'}}},
        {path: 'auth.totp.digits', value: {enabled: true, totp: {...totpData, digits: 7}}},
        {path: 'auth.oauth.issuer', value: {enabled: true, oauth: {...oauthData, issuer: 'invalid'}}},
        {path: 'auth.oauth.interactionUrl', value: {enabled: true, oauth: {...oauthData, interactionUrl: 'auth/oauth'}}},
        {path: 'auth.oauth.scopes', value: {enabled: true, oauth: {...oauthData, scopes: ['profile']}}},
        {path: 'auth.oauth.clients', value: {enabled: true, oauth: {...oauthData, clients: []}}},
        {path: 'auth.oauth.clients[0].id', value: {enabled: true, oauth: {...oauthData, clients: [{...oauthClientData, id: 'x'}]}}},
        {path: 'auth.oauth.clients[0].type', value: {enabled: true, oauth: {...oauthData, clients: [{...oauthClientData, type: 'native'}]}}},
        {path: 'auth.oauth.clients[0].displayName', value: {enabled: true, oauth: {...oauthData, clients: [{...oauthClientData, displayName: ''}]}}},
        {path: 'auth.oauth.clients[0].redirectUris', value: {enabled: true, oauth: {...oauthData, clients: [{...oauthClientData, redirectUris: []}]}}},
        {path: 'auth.oauth.clients[0].redirectUris', value: {enabled: true, oauth: {...oauthData, clients: [{...oauthClientData, redirectUris: ['https://client.example.test/callback', 'https://client.example.test/callback']}]}}},
        {path: 'auth.oauth.clients[0].grantTypes', value: {enabled: true, oauth: {...oauthData, clients: [{...oauthClientData, grantTypes: ['implicit']}]}}},
        {path: 'auth.oauth.clients[0].secret', value: {enabled: true, oauth: {...oauthData, clients: [{...oauthClientData, secret: {env: 'LAYER_CLIENT_SECRET'}}]}}},
        {path: 'auth.oauth.clients[0].scopes', value: {enabled: true, oauth: {...oauthData, clients: [{...oauthClientData, scopes: ['openid', 'chat.write']}]}}},
        {path: 'auth.oauth.clients[0].dpop', value: {enabled: true, oauth: {...oauthData, clients: [{...oauthClientData, dpop: 'disabled'}]}}},
        {path: 'auth.oidc', value: {enabled: true, oidc: {}}},
        {path: 'auth.oidc[0].id', value: {enabled: true, oidc: [{...oidcProviderData, id: 'X'}]}},
        {path: 'auth.oidc[0].clientId', value: {enabled: true, oidc: [{...oidcProviderData, clientId: ''}]}},
        {path: 'auth.oidc[0].scopes', value: {enabled: true, oidc: [{...oidcProviderData, scopes: ['email']}]}}
    ];

    for ( const invalidConfigurationData of invalidConfigurationsData ){
        assert.throws(function invalidConfigurationCreate(){
            layerAuthConfigurationCreate( /** @type {any} */ (invalidConfigurationData.value) );

        }, function invalidConfigurationCheck( errorData ){
            assert.ok( errorData instanceof LayerAuthError );
            assert.equal( errorData.details?.path, invalidConfigurationData.path );
            return true;

        }, invalidConfigurationData.path);

    }

});

test( 'Layer Auth identifier and session-data validators reject non-JSON and policy bypasses', function(){
    const invalidIdentifierCasesData = [{
        identifier: null,
        policy: {email: true, username: true}
    }, {
        identifier: '',
        policy: {email: true, username: true}
    }, {
        identifier: 'x'.repeat( 321 ),
        policy: {email: true, username: true}
    }, {
        identifier: 'developer@example.test',
        policy: {email: false, username: true}
    }, {
        identifier: 'developer@@example.test',
        policy: {email: true, username: true}
    }, {
        identifier: 'developer',
        policy: {email: true, username: false}
    }, {
        identifier: '1invalid',
        policy: {email: true, username: true}
    }];

    for ( const invalidIdentifierData of invalidIdentifierCasesData ){
        assert.throws(function invalidIdentifierCreate(){
            layerAuthIdentifierCreate(
                invalidIdentifierData.identifier,
                invalidIdentifierData.policy
            );

        }, /Login identifier is invalid/u );

    }

    assert.deepEqual(
        layerAuthIdentifierCreate( ' Developer_Name ', {email: true, username: true}),
        {
            type: 'username',
            normalized: 'developer_name',
            display: 'Developer_Name'
        }
    );
    assert.deepEqual(
        layerAuthSessionDataCreate({
            locale: 'ru',
            flags: [true, null, 3],
            nested: Object.assign(Object.create( null ), {mode: 'compact'})
        }),
        {
            locale: 'ru',
            flags: [true, null, 3],
            nested: {mode: 'compact'}
        }
    );

    const invalidSessionDataCasesData = [
        null,
        [],
        'text',
        {value: Number.POSITIVE_INFINITY},
        {value: function invalidValue(){}},
        {value: new Date()},
        {['x'.repeat( 129 )]: true}
    ];

    for ( const invalidSessionData of invalidSessionDataCasesData ){
        assert.throws(function invalidSessionDataCreate(){
            layerAuthSessionDataCreate( invalidSessionData );

        }, /Session data/u );

    }

    let nestedSessionData = /** @type {Record<string, unknown>} */ ({value: true});

    for ( let depthData = Number( 0 ); depthData < Number( 17 ); depthData += Number( 1 ) ){
        nestedSessionData = {nested: nestedSessionData};

    }

    assert.throws(function deepSessionDataCreate(){
        layerAuthSessionDataCreate( nestedSessionData );

    }, /maximum depth/u );
    assert.throws(function lowMaximumCreate(){
        layerAuthSessionDataCreate({}, {maximumBytes: 100});

    }, /maximumBytes/u );
    assert.throws(function nonIntegerMaximumCreate(){
        layerAuthSessionDataCreate({}, {maximumBytes: 2048.5});

    }, /maximumBytes/u );
    assert.throws(function highMaximumCreate(){
        layerAuthSessionDataCreate({}, {maximumBytes: 65537});

    }, /maximumBytes/u );

    const internalCauseData = new Error( 'secret cause' );
    const errorData = new LayerAuthError(
        'AUTH_TEST_FAILURE',
        'Safe failure.',
        {field: 'identifier'},
        internalCauseData
    );

    assert.equal( errorData.cause, internalCauseData );
    assert.deepEqual( errorData.toJSON(), {
        code: 'AUTH_TEST_FAILURE',
        message: 'Safe failure.',
        details: {field: 'identifier'}
    } );
    assert.equal( JSON.stringify( errorData ).includes( 'secret cause' ), false );

});

test( 'Layer Auth password policy measures Unicode and fails closed for every invalid boundary', async function(){
    const passwordPolicyData = {
        minimumLength: 12,
        maximumLength: 64,
        commonPasswordBlocklist: true
    };

    assert.equal( layerAuthPasswordLengthGet( '🔐🔐' ), 2 );

    for ( const passwordData of [null, 123] ){
        assert.throws(
            function passwordTypeCheck(){
                layerAuthPasswordCheck( passwordData, passwordPolicyData );

            },
            function invalidPasswordTypeCheck( errorData ){
                assert.ok( errorData instanceof LayerAuthError );
                assert.equal( errorData.code, 'AUTH_PASSWORD_INVALID' );
                return true;

            }
        );

    }

    for ( const passwordData of ['short', 'x'.repeat( 65 )] ){
        assert.throws(
            function passwordLengthCheck(){
                layerAuthPasswordCheck( passwordData, passwordPolicyData );

            },
            function invalidPasswordLengthCheck( errorData ){
                assert.ok( errorData instanceof LayerAuthError );
                assert.equal( errorData.code, 'AUTH_PASSWORD_INVALID' );
                assert.deepEqual( errorData.details, {
                    minimumLength: 12,
                    maximumLength: 64
                } );
                return true;

            }
        );

    }

    assert.throws(
        function commonPasswordCheck(){
            layerAuthPasswordCheck( 'Password1234', passwordPolicyData );

        },
        function commonPasswordErrorCheck( errorData ){
            assert.ok( errorData instanceof LayerAuthError );
            assert.equal( errorData.code, 'AUTH_PASSWORD_COMMON' );
            return true;

        }
    );
    assert.equal(
        layerAuthPasswordCheck( 'Password1234', {
            ...passwordPolicyData,
            commonPasswordBlocklist: false
        }),
        true
    );
    assert.equal(
        layerAuthPasswordCheck( 'a-strong-password-value', passwordPolicyData ),
        true
    );

    const passwordHashData = await layerAuthPasswordHashCreate( 'a-strong-password-value' );

    assert.equal(
        await layerAuthPasswordVerify( passwordHashData, 'a-strong-password-value' ),
        true
    );
    assert.equal(
        await layerAuthPasswordVerify( 'malformed-hash', 'a-strong-password-value' ),
        false
    );

});
