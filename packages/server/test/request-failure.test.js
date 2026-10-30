import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {createConnection} from 'node:net';
import {Readable} from 'node:stream';
import test from 'node:test';
import {LayerError, LAYER_ERROR_CODES} from '@solcorp/layer-protocol';
import {layerHttpRuntimeCreate, layerDiagnosticsCreate, layerOperationRegistryCreate} from '../src/index.js';
import {layerRequestBodyRead} from '../src/runtime/request-body.js';
import {layerRequestFailureDescribe, layerRequestBodyAbortCheck} from '../src/runtime/request-failure.js';


const requestId = '11111111-1111-4111-8111-111111111111';


/** @param {Record<string, any>} [overrides] */
const runtimeFixtureCreate = async function( overrides = {} ){
    //Starting only a loopback HTTP fixture with no database, Redis or application handlers
    const records = /** @type {Record<string, any>[]} */ ([]);
    const state = {executions: 0};
    const runtime = layerHttpRuntimeCreate({
        operationRegistry: layerOperationRegistryCreate(),
        operationExecutor: {async execute(){
            //Recording whether a request reached business execution at all
            state.executions += 1;
            return {status: 'ok'};

        }},
        diagnostics: layerDiagnosticsCreate({sink: function( recordData ){
            //Capturing only fields that passed the framework diagnostic allowlist
            records.push( recordData );

        }}),
        ...overrides
    });
    await runtime.start({port: 0});
    const address = /** @type {import('node:net').AddressInfo} */ (runtime.address());
    return {runtime, address, records, state, url: 'http://127.0.0.1:' + address.port + '/api'};

};

/** @param {() => boolean} predicate */
const conditionWait = async function( predicate ){
    //Bounding diagnostic waits so a regression fails instead of hanging the test process
    const deadline = Date.now() + 2000;
    while ( !predicate() ){
        if ( Date.now() >= deadline ){
            assert.fail( 'The expected HTTP diagnostic was not recorded.' );

        }

        await new Promise(function( resolve ){
            //Yielding while the HTTP diagnostic callback finishes
            setTimeout( resolve, 5 );

        });

    }

};

/** @param {string} url */
const apiRequestSend = async function( url ){
    //Sending a valid protocol envelope without authenticating against any real service
    return fetch( url, {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({protocol: 1, requestId, type: 'query', operation: 'test.status.read', payload: {}})
    } );

};

test( 'body transport resets receive a dedicated code while unrelated errors retain their cause', async function(){
    //Generating an interrupted bounded body without using a network socket
    for ( const code of ['ECONNRESET', 'EPIPE', 'ABORT_ERR', 'ERR_STREAM_PREMATURE_CLOSE', 'OTHER_FAILURE'] ){
        const source = Readable.from( (async function*(){
            //Producing one incomplete request before a synthetic transport failure
            yield Buffer.from( '{"payload":' );
            throw Object.assign( new Error( 'private body text' ), {code} );

        })() );
        const requestData = /** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (source));
        requestData.headers = {'content-type': 'application/json'};
        await assert.rejects( layerRequestBodyRead( requestData, {maximumBytes: 1024, maximumDepth: 4} ), function( errorData ){
            //Classifying transport errors only; arbitrary reader bugs remain ordinary failures
            const failure = /** @type {any} */ (errorData);
            if ( code === 'OTHER_FAILURE' ){
                assert.equal( failure.code, code );

            } else {
                assert.equal( failure.code, LAYER_ERROR_CODES.REQUEST_ABORTED );
                assert.equal( failure.status, 400 );
                assert.equal( failure.internalCauseGet().code, code );

            }

            return true;

        } );

    }

    //Never reclassifying completed messages, invalid JSON or oversized bodies by socket state alone
    const requestData = /** @type {import('node:http').IncomingMessage} */ ({complete: true});
    assert.equal( layerRequestBodyAbortCheck( requestData, {code: 'ECONNRESET'} ), false );
    assert.equal( layerRequestBodyAbortCheck( requestData, null ), false );
    requestData.complete = false;
    assert.equal( layerRequestBodyAbortCheck( requestData, null ), false );
    assert.equal( layerRequestBodyAbortCheck( requestData, new LayerError( 'REQUEST_TOO_LARGE', 'Large.' ) ), false );

});

test( 'a real client disconnect during body reading never executes an operation or records an internal 500', async function(){
    //Opening a raw incomplete HTTP request to exercise native IncomingMessage cancellation
    const fixture = await runtimeFixtureCreate();
    try {
        await new Promise(function( resolve, rejected ){
            const socket = createConnection({host: '127.0.0.1', port: fixture.address.port});
            socket.on( 'error', rejected );
            socket.on( 'connect', function(){
                socket.write( 'POST /api HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"payload":' );
                setTimeout(function(){
                    //Closing after the server accepted the incomplete body
                    socket.destroy();
                    resolve( undefined );

                }, 30 );

            });

        });
        await conditionWait(function(){
            //Waiting for the body-reader cancellation diagnostic rather than guessing scheduling
            return fixture.records.some(function( recordData ){
                //Selecting the expected transport cancellation record
                return recordData.event === 'request.aborted';

            });

        });
        assert.equal( fixture.state.executions, 0 );
        assert.equal( fixture.records.filter(function( recordData ){
            //Counting genuine internal failures separately from cancellation
            return recordData.event === 'request.failed';

        }).length, 0 );
        assert.equal( fixture.records[0]?.stage, 'body-read' );

        //Checking that cancellation did not crash or poison the HTTP listener
        const response = await apiRequestSend( fixture.url );
        assert.equal( response.status, 200 );
        await response.arrayBuffer();

    } finally {
        await fixture.runtime.stop();

    }

});

test( 'body deadlines close partial requests without leaving a reader or operation running', async function(){
    //Keeping a body incomplete beyond a short fixture-only deadline
    const fixture = await runtimeFixtureCreate({requestTimeoutMs: 50});
    try {
        const status = await new Promise(function( resolve, rejected ){
            //Waiting for the bounded timeout response
            const requestData = httpRequest( fixture.url, {
                method: 'POST', headers: {'content-type': 'application/json', 'content-length': 1000}
            }, function( responseData ){
                //Observing the native response rather than inferring a status from logs
                responseData.resume();
                responseData.on( 'end', function(){
                    //Completing only after the timeout response body is drained
                    resolve( responseData.statusCode );

                });

            } );
            requestData.on( 'error', rejected );
            requestData.write( '{"payload":' );

        });
        assert.equal( status, 408 );
        assert.equal( fixture.state.executions, 0 );
        assert.equal( fixture.records[0]?.code, 'TIMEOUT' );

    } finally {
        await fixture.runtime.stop();

    }

});

test( 'a dependency reset during a completed operation remains a 500 with safe technical diagnostics', async function(){
    //Distinguishing a dependency failure from a client request-body cancellation with the same Node error code
    const fixture = await runtimeFixtureCreate({operationExecutor: {async execute(){
        //Simulating an operation dependency failure after complete input
        throw Object.assign( new TypeError( 'private password SQL payload' ), {code: 'ECONNRESET'} );

    }}});
    try {
        const response = await apiRequestSend( fixture.url );
        const source = await response.text();
        assert.equal( response.status, 500 );
        assert.equal( source.includes( 'private' ), false );
        assert.equal( source.includes( 'ECONNRESET' ), false );
        assert.equal( fixture.records[0]?.stage, 'operation' );
        assert.equal( fixture.records[0]?.errorType, 'TypeError' );
        assert.equal( fixture.records[0]?.errorCode, 'ECONNRESET' );
        assert.equal( fixture.records[0]?.requestId, requestId );
        assert.equal( fixture.records[0]?.operation, 'test.status.read' );
        assert.equal( fixture.records[0]?.requestComplete, true );
        assert.equal( JSON.stringify( fixture.records ).includes( 'private' ), false );

    } finally {
        await fixture.runtime.stop();

    }

});

test( 'protocol and malformed JSON failures retain stage and server-generated correlation without unvalidated operation names', async function(){
    //Sending malformed data before the runtime can trust any envelope fields
    const fixture = await runtimeFixtureCreate();
    try {
        const response = await fetch( fixture.url, {
            method: 'POST', headers: {'content-type': 'application/json'}, body: '{"operation":"private'
        } );
        const result = await response.json();
        assert.equal( response.status, 400 );
        assert.equal( fixture.records[0]?.stage, 'body-read' );
        assert.equal( fixture.records[0]?.causeType, 'SyntaxError' );
        assert.equal( fixture.records[0]?.operation, null );
        assert.equal( fixture.records[0]?.requestId, result.requestId );
        assert.equal( JSON.stringify( fixture.records ).includes( 'private' ), false );

    } finally {
        await fixture.runtime.stop();

    }

});

test( 'diagnostic allowlists handle private causes, hostile getters, cyclic causes and broken sinks safely', function(){
    //Inspecting a private Layer cause without serializing the underlying error
    const cause = Object.assign( new Error( 'private secret' ), {code: '23505'} );
    cause.cause = cause;
    const failureData = layerRequestFailureDescribe( new LayerError( 'INTERNAL_ERROR', 'Internal.', {cause} ) );
    assert.equal( failureData.errorType, 'LayerError' );
    assert.equal( failureData.causeCode, '23505' );
    assert.equal( JSON.stringify( failureData ).includes( 'private' ), false );

    //Containing error objects whose inspection itself throws
    const hostile = Object.defineProperty( {}, 'name', {get: function(){
        //Rejecting hostile error inspection without leaking its private message
        throw new Error( 'private getter' );

    }} );
    assert.deepEqual( layerRequestFailureDescribe( hostile ), {errorType: 'Error'} );
    assert.deepEqual( layerRequestFailureDescribe( null ), {errorType: 'Error'} );

    //Rejecting arbitrary values in the newly added diagnostic metadata fields
    const records = /** @type {any[]} */ ([]);
    const diagnostics = layerDiagnosticsCreate({sink: function( recordData ){
        //Capturing only the safe diagnostic projection
        records.push( recordData );

    }});
    diagnostics.record({stage: 'private URL', errorType: 'private name', causeType: 'private name',
        errorCode: 'PRIVATE_TOKEN', causeCode: 'private SQL', responseDestroyed: 'private cookie', payload: 'private'});
    assert.deepEqual( Object.keys( records[0] ), ['timestamp'] );
    assert.doesNotThrow(function(){
        //A failed logging destination must not introduce a new HTTP failure
        layerDiagnosticsCreate({sink: function(){
            //Simulating an unavailable logging destination
            throw new Error( 'private sink configuration' );

        }}).record({event: 'request.failed'});

    } );

});
