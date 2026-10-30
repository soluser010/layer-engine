import {LayerAuthError} from './auth-error.js';


/**
 * Normalizes a login identifier without changing password data. The first
 * contract supports email, username and E.164 phone identities.
 *
 * @param {unknown} identifierData
 * @param {{email: boolean, username: boolean, phone?: boolean}} identifierPolicyData
 */
export function layerAuthIdentifierCreate( identifierData, identifierPolicyData ){
    //Checking a bounded identifier before Unicode normalization
    if ( typeof identifierData !== 'string' || Number( identifierData.length ) < Number( 1 ) || Number( identifierData.length ) > Number( 320 ) ){
        throw new LayerAuthError( 'AUTH_IDENTIFIER_INVALID', 'Login identifier is invalid.' );

    }

    const identifierDisplayData = identifierData.trim();
    const identifierNormalizedData = identifierDisplayData.normalize( 'NFKC' ).toLowerCase();
    let identifierTypeData = 'username';

    //Selecting E.164 numbers before email and username validation
    if ( identifierDisplayData.startsWith( '+' ) ){
        identifierTypeData = 'phone';

    }

    //Selecting email normalization only when the bounded identifier contains an address separator
    if ( identifierTypeData !== 'phone' && identifierNormalizedData.includes( '@' ) ){
        identifierTypeData = 'email';

    }

    //Checking the selected identifier provider and its conservative syntax
    if ( identifierTypeData === 'phone' ){
        if (
            identifierPolicyData.phone !== true ||
            /^\+[1-9][0-9]{7,14}$/u.test( identifierNormalizedData ) === false
        ){
            throw new LayerAuthError( 'AUTH_IDENTIFIER_INVALID', 'Login identifier is invalid.' );

        }

    } else if ( identifierTypeData === 'email' ){
        if (
            identifierPolicyData.email !== true ||
            /^[^\s@]{1,64}@[^\s@]{1,253}$/u.test( identifierNormalizedData ) === false
        ){
            throw new LayerAuthError( 'AUTH_IDENTIFIER_INVALID', 'Login identifier is invalid.' );

        }

    } else if (
        identifierPolicyData.username !== true ||
        /^[a-z][a-z0-9._-]{2,63}$/u.test( identifierNormalizedData ) === false
    ){
        throw new LayerAuthError( 'AUTH_IDENTIFIER_INVALID', 'Login identifier is invalid.' );

    }

    //CallBack THE OBJECT
    return Object.freeze({
        type: String( identifierTypeData ),
        normalized: String( identifierNormalizedData ),
        display: String( identifierDisplayData )
    });

}
