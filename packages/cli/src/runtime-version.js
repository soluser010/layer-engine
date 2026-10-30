//Function for checking the supported security-patched Node release line
/** @param {string} versionData */
export const layerNodeVersionSupported = function( versionData ){
    //Rejecting prereleases, malformed components and unsupported major versions
    const versionMatchData = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec( versionData );

    if ( versionMatchData === null || versionMatchData[0] !== versionData || versionMatchData[1] !== '24' ){
        //CallBack THE BOOLEAN
        return false;

    }

    //Comparing numeric release components rather than lexicographic version strings
    const minorVersionData = Number( versionMatchData[2] );
    const patchVersionData = Number( versionMatchData[3] );

    //CallBack THE BOOLEAN
    return Number.isSafeInteger( minorVersionData ) && Number.isSafeInteger( patchVersionData ) &&
        (minorVersionData > 22 || (minorVersionData === 22 && patchVersionData >= 1));

};
