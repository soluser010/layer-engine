import {randomUUID} from 'node:crypto';
import {
    exportJWK,
    generateKeyPair
} from 'jose';


/**
 * Generates one extractable ES256 private JWK for the embedded OAuth provider.
 * The caller must encrypt and persist the result outside the release directory.
 *
 * @param {{identifierCreate?: () => string}} [signingOptions]
 */
export async function layerAuthOAuthSigningJwksCreate( signingOptions = {} ){
    const identifierCreateData = signingOptions.identifierCreate ?? randomUUID;
    const keyPairData = await generateKeyPair( 'ES256', {extractable: true} );
    const privateJwkData = await exportJWK( keyPairData.privateKey );

    //Adding stable metadata required for deterministic provider key selection
    privateJwkData.alg = String( 'ES256' );
    privateJwkData.use = String( 'sig' );
    privateJwkData.kid = String( identifierCreateData() );

    //CallBack THE OBJECT
    return Object.freeze({
        keys: Object.freeze([Object.freeze( privateJwkData )])
    });

}
