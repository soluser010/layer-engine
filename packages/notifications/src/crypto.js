import {createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes} from 'node:crypto';

/** @param {string} secretData @param {string} applicationData */
export function pushCryptoCreate( secretData, applicationData ){
    //Separating encryption and fingerprint keys for this application's SQL queue
    const encryptionKeyData = Buffer.from( hkdfSync( 'sha256', secretData, applicationData, 'layer-push-encryption-v1', 32 ) );
    const fingerprintKeyData = Buffer.from( hkdfSync( 'sha256', secretData, applicationData, 'layer-push-fingerprint-v1', 32 ) );

    return Object.freeze({
        /** @param {string} valueData */
        fingerprint( valueData ){
            //Returning only a keyed digest for private endpoint and deduplication identifiers
            return createHmac( 'sha256', fingerprintKeyData ).update( valueData ).digest( 'hex' );

        },
        /** @param {unknown} valueData @param {string} purposeData */
        encrypt( valueData, purposeData ){
            //Authenticating the record purpose to prevent ciphertext substitution across tables
            const nonceData = randomBytes( 12 );
            const cipherData = createCipheriv( 'aes-256-gcm', encryptionKeyData, nonceData );
            cipherData.setAAD( Buffer.from( purposeData ) );
            const ciphertextData = Buffer.concat([cipherData.update( JSON.stringify( valueData ), 'utf8' ), cipherData.final()]);

            return Buffer.concat([nonceData, cipherData.getAuthTag(), ciphertextData]).toString( 'base64url' );

        },
        /** @param {string} ciphertextData @param {string} purposeData @returns {any} */
        decrypt( ciphertextData, purposeData ){
            //Checking authenticated ciphertext before returning queue contents to trusted server code
            const recordData = Buffer.from( ciphertextData, 'base64url' );
            const decipherData = createDecipheriv( 'aes-256-gcm', encryptionKeyData, recordData.subarray( 0, 12 ) );
            decipherData.setAuthTag( recordData.subarray( 12, 28 ) );
            decipherData.setAAD( Buffer.from( purposeData ) );
            const valueData = Buffer.concat([decipherData.update( recordData.subarray( 28 ) ), decipherData.final()]);

            return JSON.parse( valueData.toString( 'utf8' ) );

        }
    });

}
