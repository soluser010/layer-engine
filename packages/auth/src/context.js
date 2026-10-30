import {
    LAYER_ERROR_CODES,
    LayerError
} from '@solcorp/layer-protocol';
import {layerAuthSessionDataCreate} from './session-data.js';


/** @returns {never} */
//Function for passing a current-session requirement failure
const authenticationRequiredPass = function(){
    //Passing the stable public authorization failure without internal session details
    throw new LayerError(
        LAYER_ERROR_CODES.AUTH_REQUIRED,
        'Authentication is required.',
        {status: 401}
    );

};

/** @returns {never} */
//Function for passing a lost custom-session-data update
const sessionConflictPass = function(){
    //Passing an explicit retryable conflict when compare-and-swap loses the session revision
    throw new LayerError(
        LAYER_ERROR_CODES.AUTH_SESSION_CONFLICT,
        'Session data changed before the update was applied.',
        {
            retryable: true,
            status: 409
        }
    );

};

/**
 * @param {unknown} revisionData
 */
//Function for checking an expected custom-session-data revision
const sessionRevisionCheck = function( revisionData ){
    //Checking the complete non-negative revision before persistence
    if ( Number.isSafeInteger( revisionData ) === false || Number( revisionData ) < Number( 0 ) ){
        throw new TypeError( 'Session data expectedRevision must be a non-negative safe integer.' );

    }

    //CallBack THE NUMBER
    return Number( revisionData );

};

/**
 * Creates the trusted Context API extension for ordinary application
 * operations. It exposes identity metadata and bounded session-data methods,
 * never credential tokens or raw persistence adapters.
 *
 * @param {{
 *     sessions: {
 *         dataGetById: Function,
 *         dataReplaceById: Function,
 *         revokeAllByUser: Function
 *     },
 *     authorizationInvalidate?: (userIdentifierData: string) => Promise<Readonly<Record<string, unknown>>>,
 *     dataMaximumBytes?: number
 * }} contextOptions
 */
export function layerAuthContextExtensionCreate( contextOptions ){
    //Checking the private repository methods before creating handler context
    if (
        contextOptions === null ||
        typeof contextOptions !== String( 'object' ) ||
        typeof contextOptions.sessions?.dataGetById !== String( 'function' ) ||
        typeof contextOptions.sessions?.dataReplaceById !== String( 'function' ) ||
        typeof contextOptions.sessions?.revokeAllByUser !== String( 'function' )
    ){
        throw new TypeError( 'Layer Auth Context API requires managed session data repositories.' );

    }

    const dataMaximumBytesData = contextOptions.dataMaximumBytes ?? 16384;

    /**
     * @param {Readonly<Record<string, any>>} requestContextData
     */
    //Function for creating one request-local Auth context
    return function layerAuthContextExtend( requestContextData ){
        const securityData = requestContextData.security;

        //Checking the server-derived security context before exposing identity
        if ( securityData === null || typeof securityData !== String( 'object' ) ){
            throw new TypeError( 'Layer Auth security context is unavailable.' );

        }

        const userIdentifierData = securityData.userId;
        const sessionIdentifierData = securityData.sessionId;
        let permissionsData = [];
        let assuranceData = [];

        //Copying only normalized authorization arrays supplied by the security pipeline
        if ( Array.isArray( securityData.permissions ) ){
            permissionsData = securityData.permissions.map( String );

        }

        if ( Array.isArray( securityData.assurance ) ){
            assuranceData = securityData.assurance.map( String );

        }
        let userData = null;
        let sessionData = null;

        if ( typeof userIdentifierData === String( 'string' ) ){
            userData = Object.freeze({id: String( userIdentifierData )});

        }

        //Creating session mutation helpers only for a verified browser session
        if (
            typeof userIdentifierData === String( 'string' ) &&
            typeof sessionIdentifierData === String( 'string' )
        ){
            const sessionIdentityData = Object.freeze({
                sessionId: String( sessionIdentifierData ),
                userId: String( userIdentifierData )
            });

            //Function for loading current developer session data
            const sessionDataGet = async function(){
                const sessionDataResult = await contextOptions.sessions.dataGetById(
                    sessionIdentityData.sessionId,
                    sessionIdentityData.userId
                );

                if ( sessionDataResult === null ){
                    return authenticationRequiredPass();

                }

                const sessionValueData = /** @type {Readonly<Record<string, unknown>>} */ (layerAuthSessionDataCreate(
                    sessionDataResult.value,
                    {maximumBytes: dataMaximumBytesData}
                ));

                //CallBack THE OBJECT
                return Object.freeze({
                    value: sessionValueData,
                    revision: Number( sessionDataResult.revision )
                });

            };

            /**
             * @param {unknown} nextValueData
             * @param {number} expectedRevisionData
             */
            //Function for replacing developer session data with compare-and-swap
            const sessionDataSet = async function( nextValueData, expectedRevisionData ){
                const expectedRevisionCheckedData = sessionRevisionCheck( expectedRevisionData );
                const sessionValueData = /** @type {Readonly<Record<string, unknown>>} */ (layerAuthSessionDataCreate(
                    nextValueData,
                    {maximumBytes: dataMaximumBytesData}
                ));
                const nextRevisionData = await contextOptions.sessions.dataReplaceById(
                    sessionIdentityData.sessionId,
                    sessionIdentityData.userId,
                    expectedRevisionCheckedData,
                    sessionValueData
                );

                if ( nextRevisionData === null ){
                    return sessionConflictPass();

                }

                //CallBack THE OBJECT
                return Object.freeze({
                    value: sessionValueData,
                    revision: Number( nextRevisionData )
                });

            };

            /**
             * @param {Readonly<Record<string, unknown>>} patchData
             * @param {number} expectedRevisionData
             */
            //Function for merging top-level developer session fields safely
            const sessionDataMerge = async function( patchData, expectedRevisionData ){
                const expectedRevisionCheckedData = sessionRevisionCheck( expectedRevisionData );
                const patchValueData = /** @type {Readonly<Record<string, unknown>>} */ (layerAuthSessionDataCreate(
                    patchData,
                    {maximumBytes: dataMaximumBytesData}
                ));
                const currentDataResult = await sessionDataGet();

                //Rejecting stale merges before constructing their replacement value
                if ( Number( currentDataResult.revision ) !== Number( expectedRevisionCheckedData ) ){
                    return sessionConflictPass();

                }

                const currentValueData = /** @type {Readonly<Record<string, unknown>>} */ (currentDataResult.value);
                const nextValueData = layerAuthSessionDataCreate({
                    ...currentValueData,
                    ...patchValueData
                }, {
                    maximumBytes: dataMaximumBytesData
                });

                //CallBack THE OBJECT
                return sessionDataSet( nextValueData, expectedRevisionCheckedData );

            };

            /**
             * @param {readonly string[]} fieldNamesData
             * @param {number} expectedRevisionData
             */
            //Function for deleting selected top-level developer session fields
            const sessionDataDelete = async function( fieldNamesData, expectedRevisionData ){
                const expectedRevisionCheckedData = sessionRevisionCheck( expectedRevisionData );

                if (
                    Array.isArray( fieldNamesData ) === false ||
                    Number( fieldNamesData.length ) < Number( 1 ) ||
                    Number( fieldNamesData.length ) > Number( 64 )
                ){
                    throw new TypeError( 'Session data delete requires 1 to 64 field names.' );

                }

                const uniqueFieldNamesData = new Set();

                for ( const fieldNameData of fieldNamesData ){
                    if (
                        typeof fieldNameData !== String( 'string' ) ||
                        Number( fieldNameData.length ) < Number( 1 ) ||
                        Number( fieldNameData.length ) > Number( 128 ) ||
                        uniqueFieldNamesData.has( fieldNameData ) === true
                    ){
                        throw new TypeError( 'Session data delete field names are invalid.' );

                    }

                    uniqueFieldNamesData.add( fieldNameData );

                }

                const currentDataResult = await sessionDataGet();

                if ( Number( currentDataResult.revision ) !== Number( expectedRevisionCheckedData ) ){
                    return sessionConflictPass();

                }

                const nextValueData = /** @type {Record<string, unknown>} */ (structuredClone( currentDataResult.value ));

                //Removing only explicitly named top-level fields from the isolated copy
                for ( const fieldNameData of uniqueFieldNamesData ){
                    delete nextValueData[fieldNameData];

                }

                //CallBack THE OBJECT
                return sessionDataSet( nextValueData, expectedRevisionCheckedData );

            };

            sessionData = Object.freeze({
                id: String( sessionIdentityData.sessionId ),
                data: Object.freeze({
                    get: sessionDataGet,
                    set: sessionDataSet,
                    merge: sessionDataMerge,
                    delete: sessionDataDelete
                })
            });

        }

        const authorizationData = Object.freeze({
            async invalidate(){
                //Requiring an authenticated identity before revoking its authorization
                if ( typeof userIdentifierData !== String( 'string' ) ){
                    return authenticationRequiredPass();

                }

                if ( contextOptions.authorizationInvalidate !== undefined ){
                    return contextOptions.authorizationInvalidate( userIdentifierData );

                }

                const revokedSessionsData = await contextOptions.sessions.revokeAllByUser(
                    userIdentifierData,
                    'authorization-invalidated'
                );

                //CallBack THE OBJECT
                return Object.freeze({
                    revokedSessions: Number( revokedSessionsData )
                });

            }
        });

        //CallBack THE OBJECT
        return Object.freeze({
            auth: Object.freeze({
                user: userData,
                permissions: Object.freeze( permissionsData ),
                assurance: Object.freeze( assuranceData ),
                session: sessionData,
                authorization: authorizationData
            })
        });

    };

}
