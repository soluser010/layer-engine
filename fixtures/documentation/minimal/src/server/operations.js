import {operations} from '../operations.js';

/** @typedef {import('../../../../../packages/server/src/operation-registry.js').LayerOperationDefinition} LayerOperationDefinition */

/**
 * Creates server definitions for the minimal documentation application.
 *
 * @returns {readonly LayerOperationDefinition[]}
 */
export function minimalOperationDefinitionsCreate(){
    //Getting the shared public query contract by its stable operation name
    const statusOperationData = operations.find(function operationFind( operationData ){
        //CallBack THE BOOLEAN
        return String( operationData.name ) === String( 'status.public.read' );

    });

    //Checking that the compiled application contract contains the expected operation
    if ( statusOperationData === undefined ){
        //Passing the broken documentation fixture to the verification gate
        throw new Error( String( 'The status.public.read contract was not found.' ) );

    }

    //Attaching trusted server behavior without placing executable code in src/operations.js
    const statusOperationDefinitionData = /** @type {LayerOperationDefinition} */ (/** @type {unknown} */ ({
        ...statusOperationData,
        handler: async function statusPublicRead(){
            //CallBack THE OBJECT
            return {
                status: String( 'ok' )
            };

        }
    }));

    //CallBack THE OBJECT
    return Object.freeze([statusOperationDefinitionData]);

}
