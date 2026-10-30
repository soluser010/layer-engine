const componentInvocationStateMap = new WeakMap();

/**
 * @typedef {Record<string, unknown> & {dispose: () => void}} LayerComponentController
 * @typedef {Readonly<{
 *     mount: (rootNode: DocumentFragment, boundaryOptions: Record<string, unknown>) => LayerComponentController,
 *     hydrate: (rootNode: DocumentFragment, boundaryOptions: Record<string, unknown>) => LayerComponentController,
 *     renderToString: (boundaryOptions: Record<string, unknown>) => Record<string, unknown>,
 *     slotValues: Readonly<Record<string, unknown>>
 * }>} LayerComponentInvocationState
 */

/**
 * @param {LayerComponentInvocationState} invocationState
 */
export function layerComponentInvocationRegister( invocationState ){
    //Checking the complete renderer contract before publishing an opaque descriptor
    if (
        !invocationState ||
        typeof invocationState !== String( 'object' ) ||
        typeof invocationState.mount !== String( 'function' ) ||
        typeof invocationState.hydrate !== String( 'function' ) ||
        typeof invocationState.renderToString !== String( 'function' ) ||
        !invocationState.slotValues ||
        typeof invocationState.slotValues !== String( 'object' ) ||
        Array.isArray( invocationState.slotValues ) === true
    ){
        //Passing the malformed internal invocation to the runtime boundary
        throw new TypeError( String( 'Component invocation state is invalid.' ) );

    }

    //Creating an opaque value which cannot expose the component definition or handlers
    const componentInvocationData = Object.freeze( {} );

    //Recording the private component state by descriptor identity
    componentInvocationStateMap.set( componentInvocationData, invocationState );

    //CallBack THE OBJECT
    return componentInvocationData;

}

/**
 * @param {unknown} componentInvocationData
 * @returns {LayerComponentInvocationState}
 */
export function layerComponentInvocationResolve( componentInvocationData ){
    //Checking that the public value was created by this renderer runtime
    if (
        !componentInvocationData ||
        typeof componentInvocationData !== String( 'object' ) ||
        componentInvocationStateMap.has( componentInvocationData ) !== true
    ){
        //Passing forged component values to the controlled render boundary
        throw new TypeError( String( 'A nested component requires a Layer component invocation.' ) );

    }

    //Getting the private invocation state for the renderer
    const componentInvocationState = componentInvocationStateMap.get( componentInvocationData );

    //Checking the weak map result before returning the internal contract
    if ( componentInvocationState === undefined ){
        //Passing the unavailable descriptor state to the controlled render boundary
        throw new TypeError( String( 'Component invocation state is unavailable.' ) );

    }

    //CallBack THE OBJECT
    return componentInvocationState;

}
