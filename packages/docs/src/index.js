import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Serve the installed, version-matched application handbook on loopback.
 * @param {{lang?: 'ru' | 'en', port?: number}} [optionsData]
 * @returns {Promise<{origin: string, url: string, close: () => Promise<void>}>}
 */
export const layerGuideServe = async function( optionsData = {} ){
    //Rejecting unsupported languages and ports before creating a listener
    const languageData = optionsData.lang ?? 'en';
    const portData = optionsData.port ?? 0;
    if ( !['ru', 'en'].includes( languageData ) || !Number.isInteger( portData ) || portData < 0 || portData > 65535 ){
        throw new TypeError( 'Guide requires lang ru/en and an integer port from 0 to 65535.' );

    }

    //Resolving only the immutable documentation files shipped with this package
    const siteDirectoryData = fileURLToPath( new URL( '../site/', import.meta.url ) );
    const contentTypesData = new Map([['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
        ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8']]);
    let originData = '';
    const serverData = createServer( async function( requestData, responseData ){
        //Rejecting remote Host headers and methods that could mutate local state
        responseData.setHeader( 'X-Content-Type-Options', 'nosniff' );
        responseData.setHeader( 'Cache-Control', 'no-store' );
        responseData.setHeader( 'Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'" );
        if ( requestData.headers.host !== new URL( originData ).host || !['GET', 'HEAD'].includes( requestData.method ?? '' ) ){
            responseData.writeHead( 403 ).end();
            return;

        }

        try {
            //Decoding once and preventing traversal, hidden files and alternate separators
            const requestPathData = decodeURIComponent( (requestData.url ?? '/').split( '?' )[0] ?? '/' );
            const segmentsData = requestPathData.split( '/' );
            if ( segmentsData.some( function( segmentData ){
                //Keeping filesystem and dot segments outside the public guide surface
                return segmentData.startsWith( '.' ) || segmentData.includes( '\\' ) || segmentData.includes( ':' ) || segmentData.includes( '\0' );

            }) ){
                responseData.writeHead( 404 ).end();
                return;

            }

            let relativePathData = requestPathData;
            if ( relativePathData.endsWith( '/' ) ){
                relativePathData += 'index.html';

            }
            const filePathData = path.resolve( siteDirectoryData, '.' + relativePathData );
            const contentTypeData = contentTypesData.get( path.extname( filePathData ) );
            if ( !filePathData.startsWith( path.resolve( siteDirectoryData ) + path.sep ) || contentTypeData === undefined ){
                responseData.writeHead( 404 ).end();
                return;

            }
            const contentData = await readFile( filePathData );
            responseData.writeHead( 200, {'Content-Type': contentTypeData, 'Content-Length': contentData.length} );
            if ( requestData.method === 'HEAD' ){
                responseData.end();
                return;

            }
            responseData.end( contentData );

        } catch {
            //Returning an opaque missing-resource response without leaking filesystem paths
            responseData.writeHead( 404 ).end();

        }

    });

    //Waiting for successful binding before exposing the selected loopback origin
    await new Promise( function( resolveData, rejectedData ){
        //Forwarding binding failures without reporting a usable address prematurely
        serverData.once( 'error', rejectedData );
        serverData.listen( portData, '127.0.0.1', function(){
            //Resolving only after the OS has assigned the listener
            resolveData( undefined );

        });

    });
    const addressData = /** @type {import('node:net').AddressInfo} */ (serverData.address());
    originData = 'http://127.0.0.1:' + addressData.port;
    let closePromiseData = /** @type {Promise<void> | null} */ (null);
    return {origin: originData, url: originData + '/' + languageData + '/README.html', close: async function(){
        //Closing the owned listener and idle connections without leaving a background process
        closePromiseData ??= new Promise( function( resolveData, rejectedData ){
            //Sharing shutdown across repeated callers
            serverData.close( function( errorData ){
                //Preserving unexpected listener errors for the owner
                if ( errorData ){
                    rejectedData( errorData );
                    return;

                }
                resolveData( undefined );

            });
            serverData.closeAllConnections();

        });
        await closePromiseData;

    }};

};
