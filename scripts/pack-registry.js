import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

/** @param {{manifest: any, filename: string, shasum: string, integrity: string}[]} packagesData @param {string} archiveDirectoryData */
export async function packRegistryCreate( packagesData, archiveDirectoryData ){
    //Serving only inspected Layer archives on loopback without publishing to a remote registry
    const metadataData = new Map( packagesData.map(function( packageData ){
        //Indexing the explicit publishable package catalog
        return [packageData.manifest.name, packageData];

    }) );
    const archivesData = new Map();

    for ( const packageData of packagesData ){
        const archiveData = await readFile( path.join( archiveDirectoryData, packageData.filename ) );
        archivesData.set( `/archives/${packageData.filename}`, archiveData );

    }

    let originData = '';
    const serverData = createServer(function( requestData, responseData ){
        //Rejecting writes and arbitrary filesystem paths in this read-only installation fixture
        let pathnameData;

        try {
            pathnameData = decodeURIComponent( new URL( requestData.url ?? '/', 'http://localhost' ).pathname );

        } catch {
            responseData.writeHead( 400 ).end();
            return;

        }

        if ( requestData.method !== 'GET' && requestData.method !== 'HEAD' ){
            responseData.writeHead( 405 ).end();
            return;

        }

        const archiveData = archivesData.get( pathnameData );

        if ( archiveData !== undefined ){
            responseData.writeHead( 200, {'Content-Type': 'application/octet-stream'} );
            responseData.end( archiveData );
            return;

        }

        const packageData = metadataData.get( pathnameData.slice( 1 ) );

        if ( packageData === undefined ){
            responseData.writeHead( 404, {'Content-Type': 'application/json'} ).end( '{"error":"not_found"}' );
            return;

        }

        const manifestData = packageData.manifest;
        const versionData = {...manifestData, dist: {
            tarball: `${originData}/archives/${packageData.filename}`,
            shasum: packageData.shasum, integrity: packageData.integrity
        }};
        responseData.writeHead( 200, {'Content-Type': 'application/json'} );
        responseData.end( JSON.stringify({name: manifestData.name, 'dist-tags': {latest: manifestData.version},
            versions: {[manifestData.version]: versionData}}) );

    });
    serverData.requestTimeout = 15000;
    serverData.headersTimeout = 10000;

    await new Promise(function( resolveData, rejectData ){
        //Allocating an ephemeral test port without exposing archives outside this machine
        serverData.once( 'error', rejectData );
        serverData.listen( 0, '127.0.0.1', function(){
            //Releasing startup after the loopback listener is available
            resolveData( undefined );

        });

    });
    const addressData = /** @type {import('node:net').AddressInfo} */ (serverData.address());
    originData = `http://127.0.0.1:${addressData.port}`;

    return Object.freeze({origin: originData, async close(){
        //Closing only the temporary registry and its npm keepalive connections
        serverData.closeAllConnections();
        await new Promise(function( resolveData, rejectData ){
            //Waiting for the owned server before removing its archive directory
            serverData.close(function( closeErrorData ){
                //Reporting shutdown failure instead of leaving a background listener
                if ( closeErrorData !== undefined ){
                    rejectData( closeErrorData );
                    return;

                }

                resolveData( undefined );

            });

        });

    }});

}
