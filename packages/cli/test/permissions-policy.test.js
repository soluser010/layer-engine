import assert from 'node:assert/strict';
import test from 'node:test';
import {LayerCliError} from '../src/cli-error.js';
import {layerConfigValidate} from '../src/config.js';
import {layerPermissionsPolicyCreate} from '../src/content-security-policy.js';

test( 'device permissions remain denied by default and explicit self grants preserve other denials', function(){
    //Checking backward compatibility before enabling the two requested device features
    const defaultsData = layerConfigValidate( {appName: 'permissions-test'} );
    assert.equal( defaultsData.security.permissionsPolicy, undefined );
    assert.equal( layerPermissionsPolicyCreate( defaultsData.security ), 'camera=(), microphone=(), geolocation=(), payment=()' );

    //Creating explicit self grants while preserving the camera and payment denials
    const configuredData = layerConfigValidate({
        appName: 'permissions-test',
        security: {permissionsPolicy: {microphone: ['self'], geolocation: ['self']}}
    });
    assert.equal( layerPermissionsPolicyCreate( configuredData.security ), 'camera=(), microphone=(self), geolocation=(self), payment=()' );
    assert.deepEqual( layerConfigValidate( configuredData ).security, configuredData.security );

    //Checking the optional policy before inspecting its immutable feature lists
    assert.ok( configuredData.security.permissionsPolicy !== undefined );
    assert.equal( Object.isFrozen( configuredData.security.permissionsPolicy ), true );
    assert.equal( Object.isFrozen( configuredData.security.permissionsPolicy.microphone ), true );

});

test( 'device permissions reject external origins, wildcards, injection and unsupported features', function(){
    //Preparing inputs that could broaden access or produce an unsafe HTTP header
    const invalidData = [null, false, [], {fullscreen: ['self']}, {microphone: 'self'},
        {microphone: ['*']}, {microphone: ['https://other.example']}, {microphone: ['self', 'self']},
        {microphone: Array(1)}, {microphone: ['self\r\nX-Injected: value']}, {microphone: [null]}];

    //Checking every rejected shape independently through the public configuration validator
    for ( const permissionsData of invalidData ){
        assert.throws( function(){
            //Passing the invalid feature envelope through normal startup validation
            layerConfigValidate({appName: 'permissions-test', security: {permissionsPolicy: permissionsData}});

        }, function( errorData ){
            //Narrowing the safe diagnostic contract before reading its public fields
            assert.ok( errorData instanceof LayerCliError );
            assert.ok( errorData.details !== null );
            assert.equal( typeof errorData.details.path, 'string' );
            assert.equal( errorData.code, 'CLI_CONFIG_INVALID' );
            assert.ok( String( errorData.details.path ).startsWith( 'security.permissionsPolicy' ) );
            assert.doesNotMatch( errorData.message, /other\.example|Injected/u );

            //CallBack THE BOOLEAN
            return true;

        });

    }

});

test( 'device permissions clone caller arrays and support every bounded feature', function(){
    //Declaring every supported feature without allowing arbitrary origin strings
    const microphoneSourcesData = ['self'];
    const securityData = layerConfigValidate({appName: 'permissions-test', security: {permissionsPolicy: {
        camera: ['self'], microphone: microphoneSourcesData, geolocation: ['self'], payment: ['self']
    }}}).security;

    //Changing caller state after validation must not change the outgoing permission header
    microphoneSourcesData.length = Number( 0 );
    assert.equal( layerPermissionsPolicyCreate( securityData ), 'camera=(self), microphone=(self), geolocation=(self), payment=(self)' );
    assert.equal( layerPermissionsPolicyCreate( {permissionsPolicy: {}} ), 'camera=(), microphone=(), geolocation=(), payment=()' );

});
