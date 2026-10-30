import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {layerConfigLoad, layerConfigValidate, layerProjectBuild, layerProjectCreate} from '../src/index.js';
import {layerCliErrorDiagnosticCreate, LayerCliError} from '../src/cli-error.js';
import {layerDevelopmentRequestHandlerCreate} from '../src/development-host.js';
import {layerContentSecurityPolicyCreate} from '../src/content-security-policy.js';


test( 'CSP defaults remain strict and additions preserve every protected directive', function(){
    //Getting the unchanged default policy in both rendering environments
    const defaultConfigurationData = layerConfigValidate( {appName: 'csp-test'} );
    const productionPolicyData = layerContentSecurityPolicyCreate( defaultConfigurationData.security );
    const developmentPolicyData = layerContentSecurityPolicyCreate( defaultConfigurationData.security, 'development' );

    //Checking intentional development style support with explicit worker and manifest boundaries
    assert.equal( developmentPolicyData, "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" );
    assert.match( productionPolicyData, /require-trusted-types-for 'script'/u );
    assert.doesNotMatch( productionPolicyData, /unsafe-inline|unsafe-eval/u );

    //Creating bounded permissions with duplicate and mixed-case origins
    const allowedConfigurationData = layerConfigValidate({
        appName: 'csp-test',
        security: {csp: {sources: {
            'script-src': ['https://API-MAPS.YANDEX.RU', 'https://api-maps.yandex.ru/', 'https://*.api-maps.yandex.ru'],
            'style-src': ['blob:'],
            'connect-src': ['https://*.maps.yandex.net', 'wss://events.example.com'],
            'frame-src': ['https://api-maps.yandex.ru']
        }}}
    });
    const allowedPolicyData = layerContentSecurityPolicyCreate( allowedConfigurationData.security );

    //Checking additive origins, deduplication and immutable configuration
    assert.match( allowedPolicyData, /script-src 'self' https:\/\/api-maps.yandex.ru https:\/\/\*.api-maps.yandex.ru;/u );
    assert.match( allowedPolicyData, /style-src 'self' blob:/u );
    assert.match( allowedPolicyData, /frame-src 'self' https:\/\/api-maps.yandex.ru/u );
    assert.match( allowedPolicyData, /object-src 'none'; base-uri 'none'; frame-ancestors 'none'/u );
    assert.match( allowedPolicyData, /require-trusted-types-for 'script'/u );
    assert.equal( Object.isFrozen( allowedConfigurationData.security.csp.sources['script-src'] ), true );
    assert.deepEqual( layerConfigValidate( allowedConfigurationData ).security, allowedConfigurationData.security );

});

test( 'CSP configuration rejects injection, unsafe keywords, unknown directives and oversized input', function(){
    //Collecting malicious or invalid sources without relying on network behavior
    const invalidSourcesData = [
        '*', 'https:', "'unsafe-inline'", "'unsafe-eval'", "'self'", 'javascript:alert(1)',
        'https://example.com;object-src *', 'https://example.com\r\nX-Header: injected',
        'https://example.com"', 'https://{$CADDY_DOMAIN}', 'https://user:secret@example.com',
        'https://example.com/path', 'https://example.com?key=secret', 'https://example.com#fragment',
        'http://remote.example.com', 'wss://remote.example.com', 'https://*.127.0.0.1',
        'https://*.localhost', 'https://*', 'https://a.*.example.com', 'blob:', 'data:', null, 1
    ];

    //Checking failures identify the exact field without leaking supplied credentials or payloads
    for ( const sourceData of invalidSourcesData ){
        assert.throws(function(){
            //Validating one prohibited script source through the public configuration boundary
            layerConfigValidate( {appName: 'csp-test', security: {csp: {sources: {'script-src': [sourceData]}}}} );

        }, function( configurationError ){
            //Checking the stable code and redacted source-addressable diagnostic
            assert.ok( configurationError instanceof LayerCliError );
            assert.ok( configurationError.details !== null );
            assert.equal( configurationError.code, 'CLI_CONFIG_INVALID' );
            assert.equal( configurationError.details.path, 'security.csp.sources.script-src[0]' );
            assert.doesNotMatch( configurationError.message, /secret|injected/u );

            //CallBack THE BOOLEAN
            return true;

        });

    }

    //Checking protected directives and unsupported policy override switches
    const invalidSecurityData = [
        {headers: {}}, {csp: false}, {csp: {enabled: false}}, {csp: {requireTrustedTypes: false}},
        {csp: {sources: {'object-src': ['https://example.com']}}},
        {csp: {sources: {'default-src': ['https://example.com']}}},
        {csp: {sources: {'frame-ancestors': ['https://example.com']}}},
        {csp: {sources: {'script-src-elem': ['https://example.com']}}},
        {csp: {sources: {'script-src': 'https://example.com'}}},
        {csp: {sources: {'script-src': Array( 1 )}}},
        {csp: {sources: {'script-src': Array( 33 ).fill( 'https://example.com' )}}}
    ];
    for ( const securityData of invalidSecurityData ){
        assert.throws(function(){
            //Validating one policy envelope that cannot preserve the strict source contract
            layerConfigValidate( {appName: 'csp-test', security: securityData} );

        }, {code: 'CLI_CONFIG_INVALID'} );

    }

    //Checking the total permission budget in addition to individual list limits
    const oversizedListData = Array.from( {length: 32}, function( _itemData, sourceIndexData ){
        //Preparing distinct long but syntactically valid domain origins
        return 'https://' + 'a'.repeat( 200 ) + String( sourceIndexData ) + '.example.com';

    });
    assert.throws(function(){
        //Validating an otherwise well-formed policy that exceeds the bounded header budget
        layerConfigValidate( {appName: 'csp-test', security: {csp: {sources: {'img-src': oversizedListData}}}} );

    }, {code: 'CLI_CONFIG_INVALID'} );

});

test( 'CSP permits supported local resource schemes and loopback transports only in appropriate directives', function(){
    //Creating intentional development and local resource permissions
    const configurationData = layerConfigValidate({
        appName: 'csp-test', security: {csp: {sources: {
            'connect-src': ['http://localhost:9010', 'ws://127.0.0.1:9020', 'https://[::1]:9030'],
            'img-src': ['data:', 'blob:'], 'font-src': ['data:'], 'worker-src': ['blob:']
        }}}
    });

    //Checking the typed resource permissions retain their normalized origins
    const policyData = layerContentSecurityPolicyCreate( configurationData.security );
    assert.match( policyData, /ws:\/\/127.0.0.1:9020/u );
    assert.match( policyData, /font-src 'self' data:/u );
    assert.match( policyData, /worker-src 'self' blob:/u );

});

test( 'CSP retains wildcard permissions when schemes and DNS names use mixed case', function(){
    //Normalizing equivalent origins without silently changing subdomain access into apex access
    const configurationData = layerConfigValidate({
        appName: 'csp-test',
        security: {csp: {sources: {
            'frame-src': ['HTTPS://*.EXAMPLE.COM', 'https://*.example.com/', 'hTtPs://MAPS.EXAMPLE.COM'],
            'connect-src': ['WSS://*.EVENTS.EXAMPLE.COM:8443', 'wss://*.events.example.com:8443']
        }}}
    });

    //Checking wildcard semantics and deduplication independently of the selected rendering mode
    assert.deepEqual( configurationData.security.csp.sources['frame-src'], ['https://*.example.com', 'https://maps.example.com'] );
    assert.deepEqual( configurationData.security.csp.sources['connect-src'], ['wss://*.events.example.com:8443'] );
    for ( const modeData of /** @type {const} */ (['development', 'production']) ){
        //Checking the serialized policy preserves the same normalized permissions
        const policyData = layerContentSecurityPolicyCreate( configurationData.security, modeData );
        assert.match( policyData, /frame-src 'self' https:\/\/\*.example.com https:\/\/maps.example.com/u );
        assert.match( policyData, /connect-src 'self' wss:\/\/\*.events.example.com:8443/u );

    }

});

test( 'CSP frame and script permissions never implicitly broaden worker or manifest permissions', function(){
    //Adding legacy child-src and script sources without granting worker or manifest privileges
    const configurationData = layerConfigValidate({
        appName: 'csp-test',
        security: {csp: {sources: {
            'child-src': ['https://embeds.example.com'],
            'script-src': ['https://sdk.example.com']
        }}}
    });

    for ( const modeData of /** @type {const} */ (['development', 'production']) ){
        //Checking explicit boundaries prevent browser fallback through unrelated resource permissions
        const policyData = layerContentSecurityPolicyCreate( configurationData.security, modeData );
        assert.match( policyData, /(?:^|; )worker-src 'self'(?:;|$)/u );
        assert.match( policyData, /(?:^|; )manifest-src 'self'(?:;|$)/u );
        assert.match( policyData, /child-src 'self' https:\/\/embeds.example.com/u );

        //Checking a deliberate worker exception still requires its own directive
        const explicitPolicyData = layerContentSecurityPolicyCreate({
            csp: {sources: {'worker-src': ['blob:']}}
        }, modeData );
        assert.match( explicitPolicyData, /worker-src 'self' blob:/u );

    }

});

test( 'CSP public diagnostics never reflect rejected credential-bearing source values', function(){
    //Checking redaction at the actual diagnostic boundary rather than only the original exception
    assert.throws(function(){
        //Passing a malformed source through the same strict configuration used by build and dev
        layerConfigValidate({
            appName: 'csp-test',
            security: {csp: {sources: {'frame-src': ['https://user:private-value@example.com']}}}
        });

    }, function( configurationError ){
        //Checking only stable problem metadata is exposed to the terminal and JSON consumers
        assert.ok( configurationError instanceof LayerCliError );
        const diagnosticData = layerCliErrorDiagnosticCreate( configurationError );
        assert.equal( diagnosticData.code, 'CLI_CONFIG_INVALID' );
        assert.equal( diagnosticData.path, 'security.csp.sources.frame-src[0]' );
        assert.doesNotMatch( JSON.stringify( diagnosticData ), /private-value|user:/u );

        //CallBack THE BOOLEAN
        return true;

    });

});

test( 'CSP diagnostics resolve hyphenated directive fields without exposing source values', async function( testContext ){
    //Preparing only a temporary configuration file for a public load diagnostic
    const temporaryRootData = await mkdtemp( path.join( os.tmpdir(), 'layer-csp-diagnostic-' ) );
    testContext.after( async function(){
        //Removing only the test-owned directory returned by mkdtemp
        await rm( temporaryRootData, {recursive: true, force: true} );

    });
    await writeFile( path.join( temporaryRootData, 'package.json' ), '{"type":"module"}', 'utf8' );
    await writeFile( path.join( temporaryRootData, 'layer.config.js' ), [
        'export default {',
        "    appName: 'csp-test',",
        '    security: {csp: {sources: {',
        "        'script-src': ['https://user:secret@example.com']",
        '    }}}',
        '};'
    ].join( '\n' ), 'utf8' );

    //Checking the public diagnostic reaches the quoted directive key and keeps secrets redacted
    await assert.rejects( layerConfigLoad( temporaryRootData ), function( configurationError ){
        //Verifying the exact source position and stable field path
        assert.ok( configurationError instanceof LayerCliError );
        assert.ok( configurationError.details !== null );
        assert.equal( configurationError.code, 'CLI_CONFIG_INVALID' );
        assert.equal( configurationError.details.path, 'security.csp.sources.script-src[0]' );
        assert.equal( configurationError.details.line, 4 );
        assert.doesNotMatch( configurationError.message, /secret/u );

        //CallBack THE BOOLEAN
        return true;

    });

});

test( 'development HTTP headers and generated production Caddyfile use configured CSP sources', async function( testContext ){
    //Creating an isolated project to verify actual transport and production artifacts
    const temporaryRootData = await mkdtemp( path.join( os.tmpdir(), 'layer-csp-' ) );
    const projectDirectoryData = path.join( temporaryRootData, 'csp-test' );
    await layerProjectCreate( {targetDirectory: projectDirectoryData, projectName: 'csp-test'} );
    const configurationData = layerConfigValidate({
        appName: 'csp-test', development: {liveReload: false},
        security: {permissionsPolicy: {microphone: ['self'], geolocation: ['self']}, csp: {sources: {
            'script-src': ['https://api-maps.yandex.ru'],
            'connect-src': ['https://*.maps.yandex.net'], 'style-src': ['blob:']
        }}}
    });
    await layerProjectBuild( {rootDirectory: projectDirectoryData, config: configurationData} );

    //Preparing the real development request handler with the same validated permissions
    const requestHandlerData = layerDevelopmentRequestHandlerCreate({
        outputDirectory: path.join( projectDirectoryData, 'dist' ), security: configurationData.security
    });
    const serverData = createServer(function( requestData, responseData ){
        //Serving the isolated project through the actual development header boundary
        void requestHandlerData( requestData, responseData );

    });
    testContext.after( async function(){
        //Closing the owned test listener before removing only its temporary project
        await new Promise(function( resolve, rejected ){
            //Completing shutdown through the native callback-only server API
            serverData.close(function( serverCloseError ){
                //Propagating unexpected shutdown failures to the test runner
                if ( serverCloseError ){
                    rejected( serverCloseError );

                    //Completing the failed shutdown branch
                    return;

                }

                //Completing the successful server shutdown
                resolve( undefined );

            });

        });
        await rm( temporaryRootData, {recursive: true, force: true} );

    });
    await new Promise(function( resolve ){
        //Opening only an ephemeral loopback listener for this test
        serverData.listen( 0, '127.0.0.1', function(){
            //Completing the listener startup
            resolve( undefined );

        });

    });

    //Reading the generated policy and actual HTTP response rather than duplicating implementation logic
    const serverAddressData = serverData.address();
    assert.ok( serverAddressData !== null && typeof serverAddressData === 'object' );
    const responseData = await fetch( 'http://127.0.0.1:' + serverAddressData.port + '/' );
    const policyData = responseData.headers.get( 'content-security-policy' );
    assert.ok( policyData !== null );
    //Checking the explicit device policy independently from resource CSP
    assert.equal( responseData.headers.get( 'permissions-policy' ), 'camera=(), microphone=(self), geolocation=(self), payment=()' );
    const caddyfileData = await readFile( path.join( projectDirectoryData, 'dist/Caddyfile' ), 'utf8' );
    assert.match( policyData, /script-src 'self' https:\/\/api-maps.yandex.ru/u );
    assert.match( policyData, /connect-src 'self' https:\/\/\*.maps.yandex.net/u );
    assert.match( caddyfileData, /script-src 'self' https:\/\/api-maps.yandex.ru/u );
    assert.match( caddyfileData, /style-src 'self' blob:/u );
    assert.match( caddyfileData, /require-trusted-types-for 'script'/u );
    assert.match( caddyfileData, /frame-ancestors 'none'/u );
    assert.doesNotMatch( caddyfileData, /unsafe-inline|unsafe-eval/u );
    //Checking that production receives the same bounded capability permissions
    assert.match( caddyfileData, /Permissions-Policy "camera=\(\), microphone=\(self\), geolocation=\(self\), payment=\(\)"/u );

});
