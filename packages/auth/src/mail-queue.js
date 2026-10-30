import {createHmac} from 'node:crypto';
import {layerAuthSecretEnvelopeCreate} from './secret-envelope.js';


/**
 * Creates the encrypted queue boundary between Auth flows and the durable
 * database outbox.
 *
 * @param {{repository: any, secret: string}} queueOptions
 */
export function layerAuthMailQueueCreate( queueOptions ){
    //Checking the durable repository before accepting recipient data
    if (
        queueOptions === null ||
        typeof queueOptions !== String( 'object' ) ||
        typeof queueOptions.repository?.enqueue !== String( 'function' ) ||
        typeof queueOptions.secret !== String( 'string' ) ||
        Number( queueOptions.secret.length ) < Number( 32 )
    ){
        throw new TypeError( 'Layer Auth mail queue requires a repository and server secret.' );

    }

    const secretEnvelopeData = layerAuthSecretEnvelopeCreate({secret: queueOptions.secret});

    return Object.freeze({
        /**
         * @param {{templateName: string, recipient: string, locale?: string, payload: Readonly<Record<string, unknown>>, database?: {query: Function}}} mailData
         */
        async enqueue( mailData ){
            //Checking the recipient without copying it into diagnostics
            if ( typeof mailData?.recipient !== 'string' || Number( mailData.recipient.length ) < Number( 3 ) || Number( mailData.recipient.length ) > Number( 320 ) ){
                throw new TypeError( 'Layer Auth mail recipient is invalid.' );

            }

            const recipientHashData = createHmac( 'sha256', queueOptions.secret )
                .update( `mail-recipient:${String( mailData.recipient )}`, 'utf8' )
                .digest( 'hex' );
            const recipientEncryptedData = secretEnvelopeData.seal(
                {recipient: String( mailData.recipient )},
                'mail-recipient'
            );
            const payloadEncryptedData = secretEnvelopeData.seal(
                mailData.payload,
                'mail-payload'
            );

            //Recording only hashes and authenticated ciphertext in the outbox
            return queueOptions.repository.enqueue({
                templateName: mailData.templateName,
                recipientHash: recipientHashData,
                recipientEncrypted: recipientEncryptedData,
                locale: mailData.locale ?? 'en',
                payloadEncrypted: payloadEncryptedData,
                database: mailData.database
            });

        },

        /** @param {{recipientEncrypted: Uint8Array, payloadEncrypted: Uint8Array}} queuedMailData */
        open( queuedMailData ){
            const recipientData = secretEnvelopeData.open( queuedMailData.recipientEncrypted, 'mail-recipient' );
            const payloadData = secretEnvelopeData.open( queuedMailData.payloadEncrypted, 'mail-payload' );

            if (
                recipientData === null ||
                typeof recipientData !== String( 'object' ) ||
                typeof recipientData.recipient !== String( 'string' ) ||
                payloadData === null ||
                typeof payloadData !== String( 'object' ) ||
                Array.isArray( payloadData ) === true
            ){
                throw new TypeError( 'Layer Auth mail envelope contents are invalid.' );

            }

            //CallBack THE OBJECT
            return Object.freeze({
                recipient: String( recipientData.recipient ),
                payload: Object.freeze( payloadData )
            });

        }
    });

}
