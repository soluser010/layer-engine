import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
import {parse} from 'acorn';
import fc from 'fast-check';
import {layerAuthPhoneOperationDefinitionsCreate} from '../packages/auth/src/phone-operations.js';
import {layerOperationFacadeCreate} from '../packages/cli/src/operation-facade.js';
import {layerRequestFixtureCreate} from '@solcorp/layer-testkit';
import {packRegistryCreate} from '../scripts/pack-registry.js';

const validName = fc.stringMatching( /^[a-z][a-z0-9]{0,12}\.[a-z][a-z0-9]{0,12}$/u );
const specialKey = fc.constantFrom( '__proto__', 'constructor', 'prototype', 'toString' );

test('facade code generation preserves valid names and rejects injected syntax', function(){
    //Parse generated modules without executing them and exercise forbidden characters at the same sink.
    fc.assert( fc.property( validName, fc.constantFrom( 'query', 'command', 'sync' ),
        fc.constantFrom( '-', '\n', '\u2028', '*/', '"', ';', '`', '\u0000' ), function( name, type, separator ){
            //Keep the valid sample as a control for the three insertion positions.
            const contract = {name, type, inputSchema: true, outputSchema: {}};
            const facade = layerOperationFacadeCreate( [contract] );
            assert.deepEqual( JSON.parse( facade.manifestSource ), [contract] );
            parse( facade.runtimeSource, {ecmaVersion: 'latest', sourceType: 'module'} );
            for ( const invalidName of [name + separator, separator + name, name + separator + name] ){
                assert.throws( layerOperationFacadeCreate.bind( null, [{...contract, name: invalidName}] ),
                    {code: 'CLI_OPERATION_CONTRACT_INVALID'} );

            }

        }) );

});

test('facade rejects malformed records and ambiguous generated declaration names', function(){
    //Direct callers have the same source-generation boundary as the application compiler.
    const contract = {name: 'chat.read', type: 'query', inputSchema: {}, outputSchema: true};
    for ( const invalid of [null, [], {...contract, name: 'x.' + 'a'.repeat( 159 )}, {...contract, type: 'events.open'},
        {...contract, type: {}}, {...contract, inputSchema: []}, {...contract, outputSchema: null},
        {...contract, outputSchema: {properties: {['__proto__']: true}}}] ){
        assert.throws( layerOperationFacadeCreate.bind( null, /** @type {any} */ ([invalid]) ), {code: 'CLI_OPERATION_CONTRACT_INVALID'} );

    }

    assert.throws( layerOperationFacadeCreate.bind( null, [contract, {...contract, name: 'chat.read.sync', type: 'sync'}] ),
        {code: 'CLI_OPERATION_EXPORT_COLLISION'} );

});

test('fixtures preserve untrusted JSON keys as isolated own data', function(){
    //Exercise root and nested overrides against normal Object prototypes.
    fc.assert( fc.property( specialKey, fc.jsonValue(), function( key, value ){
        //Use computed own keys to model decoded JSON at both merge depths.
        const overrides = {[key]: {layerTestMarker: value}, payload: {[key]: {layerTestMarker: value}}};
        const fixture = layerRequestFixtureCreate( overrides );
        for ( const record of [fixture, fixture.payload] ){
            assert.equal( Object.getPrototypeOf( record ), Object.prototype );
            assert.deepEqual( Object.getOwnPropertyDescriptor( record, key )?.value, {layerTestMarker: value} );
            assert.notEqual( Object.getOwnPropertyDescriptor( record, key )?.value, overrides[key] );

        }

        assert.equal( Object.hasOwn( Object.prototype, 'layerTestMarker' ), false );

    }) );

});

test('PostgreSQL decodes hostile RowDescription field names as own row values', function(){
    //Drive the actual pg wire-result decoder with a JSONB column supplied by a database server.
    const Result = createRequire( import.meta.url )( 'pg/lib/result' );
    fc.assert( fc.property( specialKey, fc.string(), function( key, marker ){
        //Decode the advertised PostgreSQL JSONB type through the installed driver's parser.
        const result = new Result();
        result.addFields( [{name: key, dataTypeID: 3802, format: 'text'}] );
        const row = result.parseRow( [JSON.stringify( {marker} )] );
        assert.equal( Object.getPrototypeOf( row ), Object.prototype );
        assert.deepEqual( Object.getOwnPropertyDescriptor( row, key )?.value, {marker} );

    }) );

});

test('the loopback pack registry rejects non-local archive names before filesystem access', async function(){
    //Require the filename diagnostic even when the working directory does not exist.
    await fc.assert( fc.asyncProperty( fc.constantFrom( '../', '..\\', 'a/b/', 'C:\\', '//host/', 'file:', '/'),
        fc.stringMatching( /^[a-z]{1,12}$/u ), async function( prefix, suffix ){
            //Expect rejection before filesystem resolution for every generated basename.
            const archive = {manifest: {name: 'sample'}, filename: prefix + suffix + '.tgz', integrity: '', shasum: ''};
            await assert.rejects( packRegistryCreate( [archive], 'absent-archive-directory' ), /Invalid package archive filename/ );

        }) );

});

test('phone verification issues credentials only for a consumed provider identity', async function(){
    //Model a single-use provider and track every identity crossing into the privileged service.
    const calls = /** @type {string[]} */ ([]);
    let consumed = false;
    let issued = 0;
    const definitions = layerAuthPhoneOperationDefinitionsCreate({
        challenge: {start(){
            //Verification must never create a new challenge.
            assert.fail( 'Unexpected challenge creation' );

        }, consume( /** @type {{code: string}} */ payload ){
            //Reject wrong and previously consumed challenge codes.
            if ( consumed || payload.code !== '1234' ){
                throw new Error( 'Challenge rejected' );

            }

            consumed = true;
            return {phone: '+12025550123'};

        }},
        service: {signIn: {verifiedPhone( /** @type {{phone: string}} */ identity ){
            //Record the exact identity that will receive credentials.
            calls.push( identity.phone );
            return {userId: 'verified-user', session: {sessionToken: 'fixture', csrfToken: 'fixture',
                sessionId: 'fixture-id', absoluteExpiresAt: 60000, idleExpiresAt: 10000}};

        }}}
    });
    const verify = /** @type {any} */ (definitions.find( function( definition ){
        //Select the public operation registered for submitted challenge responses.
        return definition.name === 'auth.phone.verify';

    }));
    const context = {response: {authSessionSet(){
        //Count credentials issued by the public handler after successful verification.
        issued += 1;

    }}};
    const submitted = {phone: '+12025550199', challengeId: 'test-challenge', code: '0000'};
    assert.equal( verify.inputSchema.additionalProperties, false );
    assert.equal( Object.hasOwn( verify.inputSchema.properties, 'roles' ), false );
    await assert.rejects( verify.handler( submitted, context ), /Challenge rejected/ );
    assert.deepEqual( calls, [] );
    await verify.handler( {...submitted, code: '1234'}, context );
    await assert.rejects( verify.handler( {...submitted, code: '1234'}, context ), /Challenge rejected/ );
    assert.deepEqual( calls, ['+12025550123'] );
    assert.equal( issued, 1 );

});
