const errorBoundaryStateMap = new WeakMap();

/**
 * @typedef {Readonly<{
 *     content: () => unknown,
 *     fallback: (renderError: Readonly<{code: string, message: string, retryable: false}>) => unknown
 * }>} LayerErrorBoundaryState
 */

/**
 * @param {() => unknown} contentRenderer
 * @param {(renderError: Readonly<{code: string, message: string, retryable: false}>) => unknown} fallbackRenderer
 * @param {(templateResult: unknown) => boolean} templateResultCheck
 */
export function layerErrorBoundaryValueCreate( contentRenderer, fallbackRenderer, templateResultCheck ){
    //Checking both lazy branches before creating an opaque renderer descriptor
    if (
        typeof contentRenderer !== String( 'function' ) ||
        typeof fallbackRenderer !== String( 'function' ) ||
        typeof templateResultCheck !== String( 'function' )
    ){
        //Passing the malformed boundary contract to the author call site
        throw new TypeError( String( 'ErrorBoundary requires content and fallback renderer functions.' ) );

    }

    const boundaryDescriptor = Object.freeze( {} );

    errorBoundaryStateMap.set( boundaryDescriptor, Object.freeze({
        content(){
            //Checking the lazy content template at its actual render boundary
            const contentTemplate = contentRenderer();

            if ( templateResultCheck( contentTemplate ) !== true ){
                //Passing the invalid content result to the controlled boundary
                throw new TypeError( String( 'ErrorBoundary content must return an html tagged template.' ) );

            }

            //CallBack THE OBJECT
            return contentTemplate;

        },
        /**
         * @param {Readonly<{code: string, message: string, retryable: false}>} renderError
         */
        fallback( renderError ){
            //Checking the lazy fallback template after the content failure is normalized
            const fallbackTemplate = fallbackRenderer( renderError );

            if ( templateResultCheck( fallbackTemplate ) !== true ){
                //Passing the invalid fallback result beyond this boundary
                throw new TypeError( String( 'ErrorBoundary fallback must return an html tagged template.' ) );

            }

            //CallBack THE OBJECT
            return fallbackTemplate;

        }
    }) );

    //CallBack THE OBJECT
    return boundaryDescriptor;

}

/**
 * @param {unknown} boundaryDescriptor
 * @returns {LayerErrorBoundaryState}
 */
export function layerErrorBoundaryValueResolve( boundaryDescriptor ){
    //Checking descriptor identity instead of trusting an object-shaped author value
    if (
        !boundaryDescriptor ||
        typeof boundaryDescriptor !== String( 'object' ) ||
        errorBoundaryStateMap.has( boundaryDescriptor ) !== true
    ){
        //Passing a forged descriptor to the controlled render boundary
        throw new TypeError( String( 'ErrorBoundary requires its Layer descriptor.' ) );

    }

    const boundaryState = errorBoundaryStateMap.get( boundaryDescriptor );

    //Checking the weak map result before returning internal renderer operations
    if ( boundaryState === undefined ){
        //Passing the unavailable state to the controlled render boundary
        throw new TypeError( String( 'ErrorBoundary state is unavailable.' ) );

    }

    //CallBack THE OBJECT
    return boundaryState;

}

/**
 * @param {unknown} renderFailure
 */
export function layerRenderErrorNormalize( renderFailure ){
    let errorCode = String( 'COMPONENT_RENDER_FAILED' );

    //Reading only a stable bounded code from the original failure
    if (
        renderFailure &&
        typeof renderFailure === 'object' &&
        Object.hasOwn( renderFailure, String( 'code' ) )
    ){
        const failureData = /** @type {Record<string, unknown>} */ ( renderFailure );

        if ( /^[A-Z][A-Z0-9_]{2,79}$/.test( String( failureData.code ) ) ){
            errorCode = String( failureData.code );

        }

    }

    //Creating a safe public error without stack, cause, or original message
    return Object.freeze({
        code: errorCode,
        message: String( 'The component could not be rendered.' ),
        retryable: false
    });

}
