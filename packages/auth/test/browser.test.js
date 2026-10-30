import assert from 'node:assert/strict';
import test from 'node:test';
import {layerAuthBrowserCreate} from '../src/browser.js';


test( 'browser Auth facade sends credential commands only through online request', async function(){
    const requestsData = /** @type {Record<string, any>[]} */ ([]);
    const authData = layerAuthBrowserCreate({
        async request( /** @type {any} */ requestData ){
            requestsData.push( requestData );

            return {
                data: {
                    accepted: true
                }
            };

        }
    });

    const registrationResultData = await authData.registration.create({
        identifier: 'developer@example.test',
        password: 'registration-password-value',
        invitationToken: 'invitation-token-value-with-sufficient-entropy'
    });
    const signInResultData = await authData.signIn.password({
        identifier: 'developer@example.test',
        password: 'sign-in-password-value',
        remember: true
    });
    const verificationRequestResultData = await authData.emailVerification.request( 'developer@example.test' );
    const verificationConfirmResultData = await authData.emailVerification.confirm( 'verification-token-with-sufficient-entropy' );
    const recoveryRequestResultData = await authData.passwordRecovery.request( 'developer@example.test' );
    const recoveryCompleteResultData = await authData.passwordRecovery.complete({
        token: 'recovery-token-with-sufficient-entropy',
        password: 'replacement-password-value'
    });
    const sessionsResultData = await authData.sessions.list();
    const revokeResultData = await authData.sessions.revoke( 'session-secondary-identifier' );
    const firstRequestData = requestsData[0];

    assert.ok( firstRequestData );

    assert.deepEqual( registrationResultData, {accepted: true} );
    assert.deepEqual( signInResultData, {accepted: true} );
    assert.deepEqual( verificationRequestResultData, {accepted: true} );
    assert.deepEqual( verificationConfirmResultData, {accepted: true} );
    assert.deepEqual( recoveryRequestResultData, {accepted: true} );
    assert.deepEqual( recoveryCompleteResultData, {accepted: true} );
    assert.deepEqual( sessionsResultData, {accepted: true} );
    assert.deepEqual( revokeResultData, {accepted: true} );
    assert.deepEqual(requestsData.map(function requestContractRead( requestData ){
        return [requestData.type, requestData.operation];

    }), [
        ['command', 'auth.registration.create'],
        ['command', 'auth.signin.password'],
        ['command', 'auth.email.verification.request'],
        ['command', 'auth.email.verification.confirm'],
        ['command', 'auth.password.recovery.request'],
        ['command', 'auth.password.recovery.complete'],
        ['query', 'auth.sessions.list'],
        ['command', 'auth.sessions.revoke']
    ]);
    assert.equal( 'commandId' in firstRequestData.payload, false );
    assert.equal( 'baseRevision' in firstRequestData.payload, false );
    assert.equal(
        firstRequestData.payload.invitationToken,
        'invitation-token-value-with-sufficient-entropy'
    );

});

test( 'browser Auth state maps only AUTH_REQUIRED to anonymous', async function(){
    const authData = layerAuthBrowserCreate(/** @type {any} */ ({
        async request(){
            throw Object.assign( new Error( 'Authentication is required.' ), {
                code: 'AUTH_REQUIRED'
            });

        }
    }));
    const stateData = await authData.state.get();

    assert.deepEqual( stateData, {
        authenticated: false,
        user: null,
        session: null,
        permissions: [],
        assurance: []
    } );
    assert.equal( Object.isFrozen( stateData ), true );

    const failedAuthData = layerAuthBrowserCreate({
        async request(){
            throw Object.assign( new Error( 'Network failure.' ), {
                code: 'API_NETWORK_FAILED'
            });

        }
    });

    await assert.rejects(function stateNetworkFailure(){
        return failedAuthData.state.get();

    }, /Network failure/u);

});

test( 'browser sign-out purges local user state after success or expired session', async function(){
    let purgeCountData = Number( 0 );
    const successfulAuthData = layerAuthBrowserCreate({
        async request(){
            return {data: {signedOut: true}};

        },
        async storagePurge(){
            purgeCountData += Number( 1 );

        }
    });
    const expiredAuthData = layerAuthBrowserCreate({
        async request(){
            throw Object.assign( new Error( 'Authentication is required.' ), {
                code: 'AUTH_REQUIRED'
            });

        },
        async storagePurge(){
            purgeCountData += Number( 1 );

        }
    });

    assert.deepEqual( await successfulAuthData.signOut(), {signedOut: true} );
    assert.deepEqual( await expiredAuthData.signOut(), {signedOut: true} );
    assert.equal( purgeCountData, 2 );

});

test( 'browser Passkey facade completes registration and discoverable sign-in ceremonies', async function(){
    const requestsData = /** @type {Record<string, any>[]} */ ([]);
    const authenticatorCallsData = /** @type {any[]} */ ([]);
    const authData = layerAuthBrowserCreate(/** @type {any} */ ({
        async request( /** @type {any} */ requestData ){
            requestsData.push( requestData );

            if ( requestData.operation === String( 'auth.passkey.registration.begin' ) ){
                return {data: {options: {challenge: 'registration-browser-challenge'}}};

            }

            if ( requestData.operation === String( 'auth.passkey.signin.begin' ) ){
                return {data: {options: {challenge: 'authentication-browser-challenge'}}};

            }

            return {data: {accepted: true}};

        },
        passkey: {
            async startRegistration( /** @type {any} */ optionsData ){
                authenticatorCallsData.push({type: 'registration', optionsData});
                return {id: 'credential-registration-result'};

            },

            async startAuthentication( /** @type {any} */ optionsData ){
                authenticatorCallsData.push({type: 'authentication', optionsData});
                return {id: 'credential-authentication-result'};

            }
        }
    }));

    const registrationResultData = await authData.passkey.registration.create({
        displayName: 'Development laptop'
    });
    const signInResultData = await authData.signIn.passkey({remember: true});

    assert.deepEqual( registrationResultData, {accepted: true} );
    assert.deepEqual( signInResultData, {accepted: true} );
    assert.deepEqual(authenticatorCallsData.map(function authenticatorCallMap( callData ){
        return [callData.type, callData.optionsData.optionsJSON.challenge];

    }), [
        ['registration', 'registration-browser-challenge'],
        ['authentication', 'authentication-browser-challenge']
    ]);
    assert.deepEqual(requestsData.map(function passkeyRequestMap( requestData ){
        return [requestData.type, requestData.operation];

    }), [
        ['query', 'auth.passkey.registration.begin'],
        ['command', 'auth.passkey.registration.complete'],
        ['query', 'auth.passkey.signin.begin'],
        ['command', 'auth.passkey.signin.complete']
    ]);
    assert.equal( requestsData[1]?.payload.challenge, 'registration-browser-challenge' );
    assert.equal( requestsData[1]?.payload.displayName, 'Development laptop' );
    assert.equal( requestsData[3]?.payload.remember, true );

});

test( 'browser TOTP facade keeps enrollment and MFA verification online-only', async function(){
    const requestsData = /** @type {Record<string, any>[]} */ ([]);
    const authData = layerAuthBrowserCreate({
        async request( requestData ){
            requestsData.push( requestData );
            return {data: {accepted: true}};

        }
    });

    await authData.totp.state();
    await authData.totp.enrollment.begin();
    await authData.totp.enrollment.confirm( '123456' );
    await authData.mfa.verify({
        challenge: 'mfa-challenge-with-sufficient-entropy',
        code: '654321'
    });
    await authData.totp.recoveryCodes.rotate( '234567' );
    await authData.totp.disable( '345678' );

    assert.deepEqual(requestsData.map(function requestContractRead( requestData ){
        return [requestData.type, requestData.operation, requestData.payload];

    }), [
        ['query', 'auth.totp.state', {}],
        ['command', 'auth.totp.enrollment.begin', {}],
        ['command', 'auth.totp.enrollment.confirm', {code: '123456'}],
        ['command', 'auth.mfa.verify', {
            challenge: 'mfa-challenge-with-sufficient-entropy',
            code: '654321'
        }],
        ['command', 'auth.totp.recovery.rotate', {code: '234567'}],
        ['command', 'auth.totp.disable', {code: '345678'}]
    ]);

});

test( 'browser OIDC facade exposes explicit begin and callback completion', async function(){
    const requestsData = /** @type {Record<string, any>[]} */ ([]);
    const authData = layerAuthBrowserCreate({
        async request( requestData ){
            requestsData.push( requestData );
            return {data: {accepted: true}};

        }
    });

    await authData.oidc.providers.list();
    await authData.signIn.oidc( 'company-identity', {returnTo: '/workspace'} );
    await authData.oidc.begin( 'company-identity', {returnTo: '/settings'} );
    await authData.oidc.complete({
        callbackUrl: 'https://application.example.test/auth/callback?code=code&state=state',
        remember: true
    });

    assert.deepEqual(requestsData.map(function oidcRequestMap( requestData ){
        return [requestData.type, requestData.operation, requestData.payload];

    }), [
        ['query', 'auth.oidc.providers.list', {}],
        ['command', 'auth.oidc.begin', {
            providerId: 'company-identity',
            returnTo: '/workspace'
        }],
        ['command', 'auth.oidc.begin', {
            providerId: 'company-identity',
            returnTo: '/settings'
        }],
        ['command', 'auth.oidc.complete', {
            callbackUrl: 'https://application.example.test/auth/callback?code=code&state=state',
            remember: true
        }]
    ]);

});
