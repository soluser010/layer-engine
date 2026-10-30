import assert from 'node:assert/strict';
import test from 'node:test';
import {
    layerConfigPublicCreate,
    layerConfigValidate
} from '../src/config.js';
import {LayerCliError} from '../src/cli-error.js';

test( 'Layer configuration keeps Auth disabled by default', function(){
    const configurationData = layerConfigValidate({
        appName: 'auth-test'
    });

    assert.equal( configurationData.auth, null );

});

test( 'Layer configuration creates strict Auth defaults', function(){
    /** @type {any} */
    const configurationData = layerConfigValidate({
        appName: 'auth-test',
        auth: {
            enabled: true,
            registration: {
                mode: 'invite'
            }
        }
    });

    assert.equal( configurationData.auth.registration.mode, 'invite' );
    assert.equal( configurationData.auth.password.minimumLength, 12 );
    assert.equal( configurationData.auth.session.maximumPerUser, 20 );

});

test( 'Layer configuration reports the exact invalid Auth field', function(){
    assert.throws(function configurationCreate(){
        layerConfigValidate({
            appName: 'auth-test',
            auth: {
                enabled: false
            }
        });

    }, function errorCheck( errorData ){
        assert.ok( errorData instanceof LayerCliError );
        assert.equal( errorData.code, 'CLI_CONFIG_INVALID' );
        assert.equal( errorData.details?.path, 'auth.enabled' );
        return true;

    });

});

test( 'Layer configuration validates Passkey origins and TOTP authenticator parameters', function(){
    /** @type {any} */
    const configurationData = layerConfigValidate({
        appName: 'auth-test',
        auth: {
            enabled: true,
            passkey: {
                rpId: 'localhost',
                rpName: 'Layer Auth test',
                origins: ['http://127.0.0.1:5340']
            },
            totp: {
                issuer: 'Layer Auth test',
                algorithm: 'SHA256',
                digits: 8,
                period: 30,
                window: 1,
                recoveryCodeCount: 12
            }
        }
    });

    assert.equal( configurationData.auth.passkey.rpId, 'localhost' );
    assert.deepEqual( configurationData.auth.passkey.origins, ['http://127.0.0.1:5340'] );
    assert.deepEqual( configurationData.auth.totp, {
        issuer: 'Layer Auth test',
        algorithm: 'SHA256',
        digits: 8,
        period: 30,
        window: 1,
        recoveryCodeCount: 12
    } );

    assert.throws(function invalidTotpConfiguration(){
        layerConfigValidate({
            appName: 'auth-test',
            auth: {
                enabled: true,
                totp: {
                    issuer: 'Layer Auth test',
                    digits: 7
                }
            }
        });

    }, function invalidTotpErrorCheck( errorData ){
        assert.ok( errorData instanceof LayerCliError );
        assert.equal( errorData.details?.path, 'auth.totp.digits' );
        return true;

    });

});

test( 'Layer public configuration redacts Auth ENV references and hooks', function(){
    const configurationData = layerConfigValidate({
        appName: 'auth-test',
        auth: {
            enabled: true,
            secret: {
                env: 'LAYER_AUTH_SECRET'
            },
            authorizationResolve: async function authorizationResolve(){
                return Object.freeze({permissions: []});

            }
        }
    });
    const publicConfigurationData = /** @type {any} */ (layerConfigPublicCreate( configurationData ));
    const publicConfigurationSourceData = JSON.stringify( publicConfigurationData );

    assert.deepEqual( publicConfigurationData.auth.secret, {configured: true} );
    assert.equal( publicConfigurationData.auth.authorizationResolve, '[server function]' );
    assert.equal( publicConfigurationSourceData.includes( 'LAYER_AUTH_SECRET' ), false );

});

test( 'Layer configuration validates OAuth and external OIDC without leaking ENV names', function(){
    /** @type {any} */
    const configurationData = layerConfigValidate({
        appName: 'auth-test',
        auth: {
            enabled: true,
            registration: {mode: 'open'},
            oauth: {
                issuer: 'https://auth.example.test',
                interactionUrl: '/auth/oauth',
                scopes: ['openid', 'offline_access', 'profile.read'],
                clients: [{
                    id: 'browser-client',
                    type: 'public',
                    displayName: 'Browser client',
                    redirectUris: ['https://client.example.test/callback'],
                    grantTypes: ['authorization_code', 'refresh_token'],
                    scopes: ['openid', 'offline_access'],
                    dpop: 'required'
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
        }
    });
    const publicConfigurationData = /** @type {any} */ (layerConfigPublicCreate( configurationData ));
    const publicConfigurationSourceData = JSON.stringify( publicConfigurationData );

    assert.equal( configurationData.auth.oauth.clients[0].dpop, 'required' );
    assert.equal( configurationData.auth.oidc[0].id, 'company-identity' );
    assert.deepEqual( publicConfigurationData.auth.oidc, [] );
    assert.equal( publicConfigurationSourceData.includes( 'LAYER_OIDC_CLIENT_SECRET' ), false );

});
