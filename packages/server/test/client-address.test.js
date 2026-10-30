import assert from 'node:assert/strict';
import test from 'node:test';
import {
    layerClientAddressResolve,
    layerTrustedProxyCreate
} from '../src/index.js';

/**
 * @param {string} remoteAddress
 * @param {Record<string, string>} [headers]
 */
//Function for creating one bounded HTTP request fixture
const requestFixtureCreate = function( remoteAddress, headers = {} ){
    //Exposing only the header and socket fields consumed by the address resolver
    return /** @type {import('node:http').IncomingMessage} */ ({
        headers,
        socket: {
            remoteAddress
        }
    });

};

test( 'trusted proxy contract is fail-closed and validates every field', function(){
    //Rejecting absent, mistyped, unknown, and unsafe trust configuration variants
    assert.equal( layerTrustedProxyCreate( null ), null );
    assert.throws( function(){
        //Passing an array instead of the required configuration record
        return layerTrustedProxyCreate( [] );

    }, /must be null or an object/ );
    assert.throws( function(){
        //Omitting the required trusted address collection
        return layerTrustedProxyCreate( {} );

    }, /requires bounded/ );
    assert.throws( function(){
        //Adding a misspelled security field that must not be ignored
        return layerTrustedProxyCreate({
            addresses: [String( '127.0.0.1' )],
            unknown: true
        });

    }, /unknown fields/ );
    assert.throws( function(){
        //Passing a value that cannot identify an IP address
        return layerTrustedProxyCreate({
            addresses: [String( 'invalid' )]
        });

    }, /invalid IP/ );
    assert.throws( function(){
        //Passing a CIDR prefix wider than its address family
        return layerTrustedProxyCreate({
            addresses: [String( '10.0.0.0/44' )]
        });

    }, /invalid CIDR/ );
    assert.throws( function(){
        //Requesting a forwarding header outside the explicit allowlist
        return layerTrustedProxyCreate({
            addresses: [String( '127.0.0.1' )],
            header: String( 'client-ip' )
        });

    }, /requires bounded/ );
    assert.throws( function(){
        //Passing a non-string trusted address entry
        return layerTrustedProxyCreate({
            addresses: [Number( 42 )]
        });

    }, /addresses must be IP/ );

} );

test( 'client address ignores forwarded headers from an untrusted peer', function(){
    //Resolving the socket peer without trusting its attacker-controlled forwarding header
    const trustedProxy = layerTrustedProxyCreate({
        addresses: [String( '10.0.0.0/8' )]
    });
    const requestData = requestFixtureCreate( String( '203.0.113.20' ), {
        'x-forwarded-for': String( '198.51.100.15' )
    });

    assert.equal( layerClientAddressResolve( requestData, trustedProxy ), String( '203.0.113.20' ) );

} );

test( 'client address selects the nearest untrusted hop behind trusted proxies', function(){
    //Walking the forwarding chain from the trusted loopback peer toward the client
    const trustedProxy = layerTrustedProxyCreate({
        addresses: [
            String( 'loopback' ),
            String( '10.0.0.0/8' )
        ],
        maximumHops: Number( 4 )
    });
    const requestData = requestFixtureCreate( String( '::ffff:127.0.0.1' ), {
        'x-forwarded-for': String( '192.0.2.99, 198.51.100.10, 10.4.2.1' )
    });

    assert.equal( layerClientAddressResolve( requestData, trustedProxy ), String( '198.51.100.10' ) );

} );

test( 'client address supports the standardized Forwarded header and rejects malformed chains', function(){
    //Parsing quoted IPv6 proxy notation while keeping malformed chains fail-closed
    const trustedProxy = layerTrustedProxyCreate({
        addresses: [String( 'loopback' )],
        header: String( 'forwarded' ),
        maximumHops: Number( 2 )
    });
    const forwardedRequest = requestFixtureCreate( String( '::1' ), {
        forwarded: String( 'for=203.0.113.18;proto=https, for="[::1]:443"' )
    });
    const malformedRequest = requestFixtureCreate( String( '::1' ), {
        forwarded: String( 'for=unknown' )
    });

    assert.equal( layerClientAddressResolve( forwardedRequest, trustedProxy ), String( '203.0.113.18' ) );
    assert.equal( layerClientAddressResolve( malformedRequest, trustedProxy ), String( '::1' ) );

} );

test( 'client address limits forwarded hop count and normalizes absent sockets', function(){
    //Rejecting excessive proxy chains and returning an explicit unknown socket identity
    const trustedProxy = layerTrustedProxyCreate({
        addresses: [String( 'loopback' )],
        maximumHops: Number( 1 )
    });
    const excessiveRequest = requestFixtureCreate( String( '127.0.0.1' ), {
        'x-forwarded-for': String( '203.0.113.1, 203.0.113.2' )
    });
    const missingSocketRequest = requestFixtureCreate( String( '' ) );

    assert.equal( layerClientAddressResolve( excessiveRequest, trustedProxy ), String( '127.0.0.1' ) );
    assert.equal( layerClientAddressResolve( missingSocketRequest, trustedProxy ), String( 'unknown' ) );

} );

test( 'client address returns the oldest hop when the complete chain is trusted', function(){
    //Selecting the first address only when every downstream proxy is explicitly trusted
    const trustedProxy = layerTrustedProxyCreate({
        addresses: [
            String( 'loopback' ),
            String( '203.0.113.0/24' )
        ]
    });
    const requestData = requestFixtureCreate( String( '127.0.0.1' ), {
        'x-forwarded-for': String( '203.0.113.9' )
    });

    assert.equal( trustedProxy?.addressCheck( String( 'not-an-address' ) ), false );
    assert.equal( layerClientAddressResolve( requestData, trustedProxy ), String( '203.0.113.9' ) );

} );
