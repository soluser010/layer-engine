/** @param {import('./links-configuration.js').LayerLinksConfiguration} configuration */
//Function for generating public association documents without creating native app identities
export const layerLinkAssociationDocumentsCreate = function( configuration ){
    //Collecting only configured documents so plain PWA projects publish no fictitious grants
    const documents = /** @type {Record<string, string>} */ ({});
    const associations = configuration.associations;
    if ( associations.android.length > 0 ){
        //Declaring Android link handling only, not password-sharing permissions
        documents['.well-known/assetlinks.json'] = JSON.stringify( associations.android.map(function( entry ){
            //Serializing the fixed Android namespace and actual certificate list
            return {relation: ['delegate_permission/common.handle_all_urls'], target: {
                namespace: 'android_app', package_name: entry.packageName, sha256_cert_fingerprints: entry.sha256CertFingerprints
            }};

        }), null, 4 ) + '\n';

    }
    if ( associations.apple.length > 0 ){
        //Publishing modern Universal Links components without webcredentials or App Clip grants
        documents['.well-known/apple-app-site-association'] = JSON.stringify({applinks: {
            details: associations.apple.map(function( entry ){
                //Mapping each validated path into an Apple component matcher
                return {appIDs: [entry.appId], components: entry.paths.map(function( pathData ){
                    //Creating one path-only matcher
                    return {'/': pathData};

                })};

            })
        }}, null, 4 ) + '\n';

    }
    if ( associations.windows.length > 0 ){
        //Keeping the extensionless Windows document tied to a real packaged identity
        documents['.well-known/windows-app-web-link'] = JSON.stringify( associations.windows, null, 4 ) + '\n';

    }
    if ( associations.web.length > 0 ){
        //Using a null-prototype dictionary so public app IDs cannot modify object prototypes
        const webAssociations = /** @type {Record<string, {scope: string}>} */ (Object.create( null ));
        for ( const entry of associations.web ){
            //Recording the exact manifest identity rather than truncating it to an origin
            webAssociations[entry.appId] = {scope: entry.scope};

        }
        documents['.well-known/web-app-origin-association'] = JSON.stringify( webAssociations, null, 4 ) + '\n';

    }

    //CallBack THE OBJECT
    return Object.freeze( documents );

};

/** @param {string} pathnameData */
//Function for reserving known association endpoints from SPA and offline shell fallback
export const layerLinkAssociationPathCheck = function( pathnameData ){
    //Matching only the four platform documents, not OAuth's independent well-known endpoints
    //CallBack THE BOOLEAN
    return [
        '/.well-known/assetlinks.json', '/.well-known/apple-app-site-association',
        '/.well-known/windows-app-web-link', '/.well-known/web-app-origin-association'
    ].includes( pathnameData );

};
