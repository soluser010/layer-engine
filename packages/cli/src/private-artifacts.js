import path from 'node:path';

//Keeping one RE2-compatible environment pattern for Caddy and the development host
export const layerEnvironmentRequestPathPattern = String.raw`(?:^|[/\\])[^/\\]*[.]env(?:[.: ][^/\\]*)?(?:[/\\]|$)`;
const environmentRequestPathExpression = new RegExp( layerEnvironmentRequestPathPattern, 'iu' );

//Keeping launcher metadata and server artifacts outside both public HTTP surfaces
export const layerPrivateArtifactRequestPaths = Object.freeze([
    '/package.json', '/package-lock.json', '/Caddyfile', '/node_modules', '/node_modules/*',
    '/_layer/API.md', '/_layer/build.json', '/_layer/database.d.ts', '/_layer/deployment.json',
    '/_layer/deployment', '/_layer/deployment/*', '/_layer/server', '/_layer/server/*',
    '/_layer/styles.json', '/_layer/styles.d.ts', '/_layer/operations.json', '/_layer/operations.d.mts',
    '/_layer/types', '/_layer/types/*', '/_layer/components/*.d.mts', '/_layer/layouts/*.d.mts',
    '*.map', '*.d.ts', '*.d.mts'
]);


/** @param {string} requestPathData */
//Function for detecting environment files at any depth without reading their contents
export const layerEnvironmentRequestPathCheck = function( requestPathData ){
    //Input example: /assets/.env.production, /settings/service.env or /assets/.ENV
    //CallBack THE BOOLEAN
    return environmentRequestPathExpression.test( requestPathData );

};

/** @param {string} requestPathData */
//Function for rejecting private artifacts before serving files or forwarding requests
export const layerPrivateArtifactRequestPathCheck = function( requestPathData ){
    //Checking environment names before path normalization can erase a protected segment
    if ( layerEnvironmentRequestPathCheck( requestPathData ) ){
        //CallBack THE BOOLEAN
        return true;

    }

    //Normalizing decoded paths before matching bounded deployment artifacts
    const normalizedPathData = path.posix.normalize( requestPathData.replaceAll( '\\', '/' ) ).toLowerCase();
    for ( const privatePathData of layerPrivateArtifactRequestPaths ){
        //Matching suffix rules independently from their containing directory
        const normalizedPrivatePathData = privatePathData.toLowerCase();
        if ( normalizedPrivatePathData.startsWith( '*' ) ){
            //Checking generated declarations and source maps by their private suffix
            if ( normalizedPathData.endsWith( normalizedPrivatePathData.slice( Number( 1 ) ) ) ){
                //CallBack THE BOOLEAN
                return true;

            }

        } else if ( normalizedPrivatePathData.endsWith( '/*' ) ){
            //Checking every file below a private runtime directory
            if ( normalizedPathData.startsWith( normalizedPrivatePathData.slice( Number( 0 ), Number( -1 ) ) ) ){
                //CallBack THE BOOLEAN
                return true;

            }

        } else if ( normalizedPathData === normalizedPrivatePathData ){
            //CallBack THE BOOLEAN
            return true;

        }

    }

    //CallBack THE BOOLEAN
    return false;

};
