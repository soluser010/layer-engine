import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ErrorBoundary,
    html
} from '../../layer/src/index.js';
import {
    layerErrorBoundaryValueResolve,
    layerRenderErrorNormalize
} from '../src/error-boundary.js';
import {
    layerComponentInvocationRegister,
    layerComponentInvocationResolve
} from '../src/component-invocation.js';

test( 'ErrorBoundary owns lazy templates and exposes normalized failures only', function(){
    //Creating one public descriptor without executing either lazy branch
    let contentReadCount = Number( 0 );
    const boundaryDescriptor = ErrorBoundary({
        content(){
            //Recording the protected content read before returning owned markup
            contentReadCount += Number( 1 );

            return html`<p>Content</p>`;

        },
        fallback( renderError ){
            //Rendering only the stable error code received from the boundary
            return html`<p>${renderError.code}</p>`;

        }
    });
    const boundaryState = layerErrorBoundaryValueResolve( boundaryDescriptor );
    const normalizedError = layerRenderErrorNormalize( Object.assign(
        new Error( String( 'private detail' ) ),
        {code: String( 'CHILD_FAILED' )}
    ) );

    assert.equal( contentReadCount, Number( 0 ) );
    const contentTemplate = /** @type {Record<string, unknown>} */ ( boundaryState.content() );
    assert.deepEqual( contentTemplate.strings, [String( '<p>Content</p>' )] );
    assert.equal( contentReadCount, Number( 1 ) );
    const fallbackTemplate = /** @type {Record<string, unknown>} */ ( boundaryState.fallback( normalizedError ) );
    assert.deepEqual( fallbackTemplate.values, [String( 'CHILD_FAILED' )] );
    assert.deepEqual( normalizedError, {
        code: String( 'CHILD_FAILED' ),
        message: String( 'The component could not be rendered.' ),
        retryable: false
    });
    assert.equal( Object.hasOwn( normalizedError, String( 'stack' ) ), false );
    assert.equal( Object.hasOwn( normalizedError, String( 'cause' ) ), false );

});

test( 'ErrorBoundary rejects forged descriptors and invalid branch values', function(){
    //Checking malformed public options before any descriptor is created
    assert.throws(function invalidBoundaryOptions(){
        //Passing a missing fallback through the public helper boundary
        ErrorBoundary( /** @type {any} */ ({
            content(){
                //Returning no template because option validation must fail first
                return undefined;

            }
        }) );

    }, TypeError );
    assert.throws(function forgedBoundaryResolve(){
        //Resolving a foreign object which has no private weak-map state
        layerErrorBoundaryValueResolve( {} );

    }, TypeError );

    const invalidContentState = layerErrorBoundaryValueResolve( ErrorBoundary({
        content(){
            //Returning a foreign value from the protected content branch
            return /** @type {any} */ ( String( 'unsafe' ) );

        },
        fallback(){
            //Keeping a valid fallback so only content validation fails
            return html`<p>Fallback</p>`;

        }
    }) );
    const invalidFallbackState = layerErrorBoundaryValueResolve( ErrorBoundary({
        content(){
            //Keeping valid content so only fallback validation fails
            return html`<p>Content</p>`;

        },
        fallback(){
            //Returning a foreign value from the fallback branch
            return /** @type {any} */ ( String( 'unsafe' ) );

        }
    }) );

    assert.throws(function invalidContentRender(){
        //Reading the malformed protected branch at its lazy boundary
        invalidContentState.content();

    }, TypeError );
    assert.throws(function invalidFallbackRender(){
        //Reading the malformed fallback at its lazy boundary
        invalidFallbackState.fallback( layerRenderErrorNormalize( null ) );

    }, TypeError );
    assert.equal( layerRenderErrorNormalize( {code: String( 'lower-case' )} ).code, String( 'COMPONENT_RENDER_FAILED' ) );

});

test( 'component invocations retain private renderer operations by identity', function(){
    //Creating one complete internal renderer state for opaque registration
    const invocationState = Object.freeze({
        slotValues: Object.freeze({}),
        mount(){
            //Returning the minimal child lifecycle controller
            return {
                dispose(){
                    //Releasing no resources in this isolated contract fixture
                    return undefined;

                }
            };

        },
        hydrate(){
            //Returning the minimal hydrated child lifecycle controller
            return {
                dispose(){
                    //Releasing no resources in this isolated contract fixture
                    return undefined;

                }
            };

        },
        renderToString(){
            //Returning one deterministic server render result
            return {html: String( '<p>Child</p>' )};

        }
    });
    const invocationDescriptor = layerComponentInvocationRegister( invocationState );

    assert.equal( layerComponentInvocationResolve( invocationDescriptor ), invocationState );
    assert.equal( Object.keys( invocationDescriptor ).length, Number( 0 ) );
    assert.throws(function forgedInvocationResolve(){
        //Resolving an object which was not registered by this runtime
        layerComponentInvocationResolve( {} );

    }, TypeError );
    assert.throws(function invalidInvocationRegister(){
        //Registering a state without the required renderer operations
        layerComponentInvocationRegister( /** @type {any} */ ({slotValues: {}}) );

    }, TypeError );

});
