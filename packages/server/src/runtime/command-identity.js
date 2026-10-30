import {createHash} from 'node:crypto';

/** @param {unknown} valueData @returns {string} */
const commandDigestCreate = function( valueData ){
    //Sorting object keys while preserving array order and every submitted payload field
    const sourceData = JSON.stringify( valueData, function( _keyData, entryData ){
        if ( entryData !== null && typeof entryData === 'object' && Array.isArray( entryData ) === false ){
            //Keeping reserved JSON names as own properties rather than object setters
            return Object.fromEntries( Object.keys( entryData ).sort().map(function( propertyData ){
                //CallBack THE ARRAY
                return [propertyData, entryData[propertyData]];

            }) );

        }

        //CallBack THE OBJECT
        return entryData;

    });

    //Keeping request data out of persisted diagnostic and identity fields
    return createHash( 'sha256' ).update( sourceData ).digest( 'hex' );

};

/**
 * @param {import('@solcorp/layer-security').LayerSecurityContext} securityData
 * @param {string} operationData
 * @param {unknown} payloadData
 */
export const commandReplayIdentityCreate = function( securityData, operationData, payloadData ){
    let actorData = null;

    //Separating API keys even when several credentials belong to the same user
    if ( securityData.authenticationType === 'api-key' && typeof securityData.credentialId === 'string' && securityData.credentialId.length > 0 ){
        actorData = ['api-key', securityData.credentialId];

    } else if ( securityData.authenticationType !== 'anonymous' && typeof securityData.userId === 'string' && securityData.userId.length > 0 ){
        actorData = ['user', securityData.userId];

    } else if ( securityData.authenticationType !== 'anonymous' && typeof securityData.credentialId === 'string' && securityData.credentialId.length > 0 ){
        actorData = ['credential', securityData.authenticationType, securityData.credentialId];

    }

    //Anonymous commands may execute once, but cannot claim another caller's saved result
    let actorKeyData = null;

    if ( actorData !== null ){
        actorKeyData = commandDigestCreate( ['actor-v1', securityData.tenantId, actorData] );

    }

    //CallBack THE OBJECT
    return Object.freeze({
        actorKey: actorKeyData,
        requestDigest: commandDigestCreate( [1, operationData, payloadData] )
    });

};
