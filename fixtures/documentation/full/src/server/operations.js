import {operations} from '../operations.js';

/** @typedef {import('../../../../../packages/server/src/operation-registry.js').LayerOperationDefinition} LayerOperationDefinition */

/**
 * @typedef {object} FullOperationServices
 * @property {(payloadData: Readonly<Record<string, unknown>>, contextData: Readonly<Record<string, any>>) => Promise<Readonly<Record<string, unknown>>>} messageSend
 */

/**
 * Creates server definitions for the production-oriented documentation example.
 *
 * @param {FullOperationServices} servicesData
 * @returns {readonly LayerOperationDefinition[]}
 */
export function fullOperationDefinitionsCreate( servicesData ){
    //Getting the shared command contract before attaching trusted server behavior
    const messageSendOperationData = operations.find(function operationFind( operationData ){
        //CallBack THE BOOLEAN
        return String( operationData.name ) === String( 'chat.message.send' );

    });

    //Checking the shared contract and required service dependency
    if (
        messageSendOperationData === undefined ||
        servicesData === null ||
        typeof servicesData !== String( 'object' ) ||
        typeof servicesData.messageSend !== String( 'function' )
    ){
        //Passing the incomplete server definition to the verification gate
        throw new TypeError( String( 'The chat.message.send server dependencies are invalid.' ) );

    }

    //Creating object and field authorization from trusted server identity
    /**
     * @param {Readonly<{roomId?: unknown}>} payloadData
     * @param {Readonly<{auth?: {user?: unknown}}>} contextData
     * @returns {Promise<boolean>}
     */
    const messageSendAuthorize = async function messageSendAuthorize( payloadData, contextData ){
        //Getting the authenticated user only from the server operation context
        const authenticatedUserData = contextData.auth?.user;

        //Checking that the authenticated identity may write to the requested room
        if ( authenticatedUserData === null || authenticatedUserData === undefined ){
            //CallBack THE BOOLEAN
            return false;

        }

        //Checking the example payload field without accepting identity from that payload
        if ( typeof payloadData.roomId !== String( 'string' ) ){
            //CallBack THE BOOLEAN
            return false;

        }

        //CallBack THE BOOLEAN
        return true;

    };

    //Attaching server-only cache invalidation after the shared static contract is loaded
    const messageSendOperationDefinitionData = /** @type {LayerOperationDefinition} */ (/** @type {unknown} */ ({
        ...messageSendOperationData,
        authorize: messageSendAuthorize,
        cacheInvalidation: {
            scope: 'tenant',
            tags: ['chat-messages']
        },
        handler: servicesData.messageSend
    }));

    //CallBack THE OBJECT
    return Object.freeze([messageSendOperationDefinitionData]);

}
