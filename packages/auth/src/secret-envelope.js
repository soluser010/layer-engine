import {
    createCipheriv,
    createDecipheriv,
    hkdfSync,
    randomBytes
} from 'node:crypto';
import {LayerAuthError} from './auth-error.js';


const envelopeVersionData = Number( 1 );
const nonceLengthData = Number( 12 );
const authenticationTagLengthData = Number( 16 );
const sourceMaximumBytesData = Number( 65536 );


/**
 * Creates a purpose-bound AES-256-GCM envelope for server-only Auth data.
 * The Layer Auth master secret is never persisted in the envelope.
 *
 * @param {{secret: string, randomBytesCreate?: (sizeData: number) => Buffer}} envelopeOptions
 */
export function layerAuthSecretEnvelopeCreate( envelopeOptions ){
    //Checking the master secret before deriving purpose-specific keys
    if (
        envelopeOptions === null ||
        typeof envelopeOptions !== String( 'object' ) ||
        typeof envelopeOptions.secret !== String( 'string' ) ||
        Number( envelopeOptions.secret.length ) < Number( 32 )
    ){
        throw new TypeError( 'Layer Auth secret envelope requires a 32-character secret.' );

    }

    const randomBytesCreateData = envelopeOptions.randomBytesCreate ?? randomBytes;

    /** @param {string} purposeData */
    //Function for deriving an isolated encryption key for one data purpose
    const purposeKeyCreateData = function( purposeData ){
        //Rejecting unbounded purpose labels before key derivation
        if ( /^[a-z][a-z0-9-]{1,79}$/u.test( purposeData ) === false ){
            throw new TypeError( 'Layer Auth envelope purpose is invalid.' );

        }

        return Buffer.from(hkdfSync(
            'sha256',
            Buffer.from( envelopeOptions.secret, 'utf8' ),
            Buffer.from( 'layer-auth-envelope-v1', 'utf8' ),
            Buffer.from( purposeData, 'utf8' ),
            Number( 32 )
        ));

    };

    return Object.freeze({
        /** @param {unknown} valueData @param {string} purposeData */
        seal( valueData, purposeData ){
            const valueSourceData = JSON.stringify( valueData );

            //Rejecting undefined and oversized secret payloads before encryption
            if ( valueSourceData === undefined || Number( Buffer.byteLength( valueSourceData, 'utf8' ) ) > Number( sourceMaximumBytesData ) ){
                throw new TypeError( 'Layer Auth envelope value is invalid or too large.' );

            }

            const purposeKeyData = purposeKeyCreateData( purposeData );
            const nonceData = randomBytesCreateData( nonceLengthData );
            const additionalData = Buffer.from( `layer-auth-envelope:v1:${String( purposeData )}`, 'utf8' );
            const cipherData = createCipheriv( 'aes-256-gcm', purposeKeyData, nonceData, {
                authTagLength: authenticationTagLengthData
            });
            cipherData.setAAD( additionalData );
            const encryptedData = Buffer.concat([
                cipherData.update( valueSourceData, 'utf8' ),
                cipherData.final()
            ]);
            const authenticationTagData = cipherData.getAuthTag();

            //CallBack THE OBJECT
            return Buffer.concat([
                Buffer.from([envelopeVersionData]),
                nonceData,
                authenticationTagData,
                encryptedData
            ]);

        },

        /** @param {Uint8Array} envelopeData @param {string} purposeData */
        open( envelopeData, purposeData ){
            //Checking the complete envelope before any authenticated decryption
            if (
                ArrayBuffer.isView( envelopeData ) === false ||
                Number( envelopeData.byteLength ) < Number( 1 + nonceLengthData + authenticationTagLengthData + 1 ) ||
                Number( envelopeData.byteLength ) > Number( sourceMaximumBytesData + 128 )
            ){
                throw new LayerAuthError( 'AUTH_SECRET_ENVELOPE_INVALID', 'Encrypted Auth data is invalid.' );

            }

            const envelopeBufferData = Buffer.from( envelopeData );

            if ( Number( envelopeBufferData[0] ) !== Number( envelopeVersionData ) ){
                throw new LayerAuthError( 'AUTH_SECRET_ENVELOPE_INVALID', 'Encrypted Auth data is invalid.' );

            }

            const nonceStartData = Number( 1 );
            const tagStartData = Number( nonceStartData + nonceLengthData );
            const encryptedStartData = Number( tagStartData + authenticationTagLengthData );
            const nonceData = envelopeBufferData.subarray( nonceStartData, tagStartData );
            const authenticationTagData = envelopeBufferData.subarray( tagStartData, encryptedStartData );
            const encryptedData = envelopeBufferData.subarray( encryptedStartData );
            const purposeKeyData = purposeKeyCreateData( purposeData );
            const additionalData = Buffer.from( `layer-auth-envelope:v1:${String( purposeData )}`, 'utf8' );

            try {
                const decipherData = createDecipheriv( 'aes-256-gcm', purposeKeyData, nonceData, {
                    authTagLength: authenticationTagLengthData
                });
                decipherData.setAAD( additionalData );
                decipherData.setAuthTag( authenticationTagData );
                const valueSourceData = Buffer.concat([
                    decipherData.update( encryptedData ),
                    decipherData.final()
                ]).toString( 'utf8' );

                //CallBack THE OBJECT
                return JSON.parse( valueSourceData );

            } catch( envelopeOpenErrorData ){
                //Hiding authentication and parser details behind one stable internal error
                throw new LayerAuthError(
                    'AUTH_SECRET_ENVELOPE_INVALID',
                    'Encrypted Auth data is invalid.',
                    null,
                    envelopeOpenErrorData
                );

            }

        }
    });

}
