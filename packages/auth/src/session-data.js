import {LayerAuthError} from './auth-error.js';


const sessionDataBlockedFieldsData = Object.freeze(new Set([
    '__proto__',
    'constructor',
    'credential',
    'csrf',
    'password',
    'permissions',
    'prototype',
    'roles',
    'secret',
    'token',
    'userId'
]));


/**
 * @param {unknown} valueData
 * @param {number} depthData
 * @returns {unknown}
 */
//Function for copying safe JSON session data with a bounded depth
const sessionDataCopyCreate = function( valueData, depthData ){
    //Checking the configured maximum nesting before traversing untrusted values
    if ( Number( depthData ) > Number( 16 ) ){
        throw new LayerAuthError( 'AUTH_SESSION_DATA_INVALID', 'Session data exceeds the maximum depth.' );

    }

    if ( valueData === null || typeof valueData === String( 'string' ) || typeof valueData === String( 'boolean' ) ){
        return valueData;

    }

    if ( typeof valueData === String( 'number' ) ){
        if ( Number.isFinite( valueData ) === false ){
            throw new LayerAuthError( 'AUTH_SESSION_DATA_INVALID', 'Session data numbers must be finite.' );

        }

        return Number( valueData );

    }

    if ( Array.isArray( valueData ) === true ){
        //Copying every list value without retaining a mutable caller reference
        return Object.freeze(valueData.map(
            /** @param {unknown} itemData @returns {unknown} */
            function sessionListValueCopy( itemData ){
                //Copying every nested item under the same depth and size policy
                return sessionDataCopyCreate( itemData, Number( depthData ) + Number( 1 ) );

            }
        ));

    }

    if ( typeof valueData !== String( 'object' ) || valueData === null ){
        throw new LayerAuthError( 'AUTH_SESSION_DATA_INVALID', 'Session data must contain JSON-compatible values.' );

    }

    const valuePrototypeData = Object.getPrototypeOf( valueData );

    if ( valuePrototypeData !== Object.prototype && valuePrototypeData !== null ){
        throw new LayerAuthError( 'AUTH_SESSION_DATA_INVALID', 'Session data must contain plain objects.' );

    }

    const objectResultData = /** @type {Record<string, unknown>} */ ({});

    //Copying own fields after rejecting auth-owned and prototype-sensitive names
    const objectValueData = /** @type {Record<string, unknown>} */ (valueData);

    for ( const [fieldNameData, fieldValueData] of Object.entries( objectValueData ) ){
        if ( sessionDataBlockedFieldsData.has( fieldNameData ) === true || Number( fieldNameData.length ) > Number( 128 ) ){
            throw new LayerAuthError( 'AUTH_SESSION_DATA_FIELD_BLOCKED', 'Session data contains a reserved field.' );

        }

        objectResultData[fieldNameData] = sessionDataCopyCreate(
            fieldValueData,
            Number( depthData ) + Number( 1 )
        );

    }

    //CallBack THE OBJECT
    return Object.freeze( objectResultData );

};

/**
 * Validates and isolates developer-owned server-only session data.
 *
 * @param {unknown} sessionDataInput
 * @param {{maximumBytes?: number}} [sessionDataOptions]
 * @returns {Readonly<Record<string, unknown>>}
 */
export function layerAuthSessionDataCreate( sessionDataInput, sessionDataOptions = {} ){
    //Requiring one object root so merge and revision semantics remain deterministic
    if ( typeof sessionDataInput !== String( 'object' ) || sessionDataInput === null || Array.isArray( sessionDataInput ) === true ){
        throw new LayerAuthError( 'AUTH_SESSION_DATA_INVALID', 'Session data must be a JSON object.' );

    }

    const maximumBytesData = sessionDataOptions.maximumBytes ?? 16384;

    if ( Number.isInteger( maximumBytesData ) === false || Number( maximumBytesData ) < Number( 1024 ) || Number( maximumBytesData ) > Number( 65536 ) ){
        throw new LayerAuthError( 'AUTH_SESSION_DATA_LIMIT_INVALID', 'Session data maximumBytes must be between 1024 and 65536.' );

    }

    const sessionDataResult = /** @type {Readonly<Record<string, unknown>>} */ (
        sessionDataCopyCreate( sessionDataInput, Number( 1 ) )
    );
    const sessionDataSizeData = Buffer.byteLength( JSON.stringify( sessionDataResult ), 'utf8' );

    //Checking the serialized byte size used by PostgreSQL/PGlite persistence
    if ( Number( sessionDataSizeData ) > Number( maximumBytesData ) ){
        throw new LayerAuthError( 'AUTH_SESSION_DATA_TOO_LARGE', 'Session data exceeds the configured byte limit.', Object.freeze({
            maximumBytes: Number( maximumBytesData )
        }) );

    }

    //CallBack THE OBJECT
    return sessionDataResult;

}
