const systemOperationDefinitionsData = new WeakSet();


/**
 * Marks one engine-owned operation definition as trusted system code. The
 * marker is process-local, non-serializable, and omitted from registry inspect.
 *
 * @template {Record<string, any>} OperationData
 * @param {OperationData} operationData
 * @returns {OperationData}
 */
export function layerSystemOperationCreate( operationData ){
    //Checking the definition before recording its process-local capability
    if ( operationData === null || typeof operationData !== String( 'object' ) || Array.isArray( operationData ) === true ){
        throw new TypeError( 'System operation definition must be an object.' );

    }

    systemOperationDefinitionsData.add( operationData );

    //CallBack THE OBJECT
    return operationData;

}

/**
 * Internal registry check. System status is never accepted from object fields.
 *
 * @param {object} operationData
 */
export function layerSystemOperationCheck( operationData ){
    //CallBack THE BOOLEAN
    return systemOperationDefinitionsData.has( operationData );

}
