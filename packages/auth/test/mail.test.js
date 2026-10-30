import assert from 'node:assert/strict';
import test from 'node:test';
import {
    layerAuthMailDeliveryCreate,
    layerAuthMailQueueCreate,
    layerAuthSecretEnvelopeCreate
} from '../src/server.js';


test( 'Auth secret envelope authenticates ciphertext and purpose', function(){
    const envelopeData = layerAuthSecretEnvelopeCreate({
        secret: 'auth-secret-with-more-than-thirty-two-characters',
        randomBytesCreate(){
            return Buffer.alloc( 12, 7 );

        }
    });
    const sealedData = envelopeData.seal({token: 'secret-token'}, 'mail-payload');
    const openedData = envelopeData.open( sealedData, 'mail-payload' );

    assert.deepEqual( openedData, {token: 'secret-token'} );
    assert.equal( sealedData.includes( Buffer.from( 'secret-token', 'utf8' ) ), false );
    assert.throws(
        function wrongPurposeOpen(){
            envelopeData.open( sealedData, 'mail-recipient' );

        },
        /Encrypted Auth data is invalid/u
    );

    const tamperedData = Buffer.from( sealedData );
    const tamperedByteIndexData = tamperedData.length - Number( 1 );
    tamperedData[tamperedByteIndexData] = Number( tamperedData[tamperedByteIndexData] ?? Number( 0 ) ) ^ Number( 1 );
    assert.throws(
        function tamperedEnvelopeOpen(){
            envelopeData.open( tamperedData, 'mail-payload' );

        },
        /Encrypted Auth data is invalid/u
    );

});

test( 'Auth secret envelope rejects every malformed cryptographic boundary', function(){
    const envelopeCreateData = /** @type {any} */ (layerAuthSecretEnvelopeCreate);

    for ( const envelopeOptionsData of [
        null,
        {},
        {secret: null},
        {secret: 'short'}
    ] ){
        assert.throws(function invalidEnvelopeCreate(){
            envelopeCreateData( envelopeOptionsData );

        }, TypeError);

    }

    const envelopeData = layerAuthSecretEnvelopeCreate({
        secret: 'auth-secret-with-more-than-thirty-two-characters',
        randomBytesCreate(){
            return Buffer.alloc( 12, 3 );

        }
    });

    assert.throws(
        function undefinedValueSeal(){
            envelopeData.seal( undefined, 'mail-payload' );

        },
        TypeError
    );
    assert.throws(
        function oversizedValueSeal(){
            envelopeData.seal({value: 'x'.repeat( 66000 )}, 'mail-payload' );

        },
        TypeError
    );
    assert.throws(
        function invalidPurposeSeal(){
            envelopeData.seal({value: true}, 'Mail Payload' );

        },
        TypeError
    );
    assert.throws(
        function nonBinaryEnvelopeOpen(){
            envelopeData.open( /** @type {any} */ ('not-binary'), 'mail-payload' );

        },
        /Encrypted Auth data is invalid/u
    );
    assert.throws(
        function shortEnvelopeOpen(){
            envelopeData.open( Buffer.alloc( 29 ), 'mail-payload' );

        },
        /Encrypted Auth data is invalid/u
    );
    assert.throws(
        function oversizedEnvelopeOpen(){
            envelopeData.open( Buffer.alloc( 65665 ), 'mail-payload' );

        },
        /Encrypted Auth data is invalid/u
    );

    const sealedData = envelopeData.seal({value: true}, 'mail-payload');
    const unknownVersionData = Buffer.from( sealedData );

    unknownVersionData[0] = Number( 2 );

    assert.throws(
        function unknownEnvelopeVersionOpen(){
            envelopeData.open( unknownVersionData, 'mail-payload' );

        },
        /Encrypted Auth data is invalid/u
    );

});

test( 'Auth mail queue hides recipient and token before durable persistence', async function(){
    let persistedMailData = /** @type {Record<string, any> | null} */ (null);
    const queueData = layerAuthMailQueueCreate({
        secret: 'auth-secret-with-more-than-thirty-two-characters',
        repository: {
            async enqueue( /** @type {Record<string, any>} */ mailData ){
                persistedMailData = mailData;
                return 'mail-1';

            }
        }
    });

    const mailIdentifierData = await queueData.enqueue({
        templateName: 'email-verification',
        recipient: 'developer@example.test',
        locale: 'en',
        payload: {token: 'verification-token-with-sufficient-entropy'}
    });
    const persistedMailRecordData = /** @type {Record<string, any>} */ (persistedMailData);
    const persistedMailSourceData = JSON.stringify({
        ...persistedMailRecordData,
        recipientEncrypted: Buffer.from( persistedMailRecordData.recipientEncrypted ).toString( 'base64' ),
        payloadEncrypted: Buffer.from( persistedMailRecordData.payloadEncrypted ).toString( 'base64' )
    });
    const openedMailData = queueData.open( /** @type {any} */ (persistedMailRecordData) );

    assert.equal( mailIdentifierData, 'mail-1' );
    assert.match( persistedMailRecordData.recipientHash, /^[0-9a-f]{64}$/u );
    assert.equal( persistedMailSourceData.includes( 'developer@example.test' ), false );
    assert.equal( persistedMailSourceData.includes( 'verification-token' ), false );
    assert.equal( openedMailData.recipient, 'developer@example.test' );
    assert.equal( openedMailData.payload.token, 'verification-token-with-sufficient-entropy' );

});

test( 'Auth mail queue rejects incomplete storage and recipient contracts', async function(){
    const queueCreateData = /** @type {any} */ (layerAuthMailQueueCreate);
    const repositoryData = {
        async enqueue(){
            return 'mail-1';

        }
    };

    for ( const queueOptionsData of [
        null,
        {},
        {repository: {}, secret: 'auth-secret-with-more-than-thirty-two-characters'},
        {repository: repositoryData, secret: null},
        {repository: repositoryData, secret: 'short'}
    ] ){
        assert.throws(function invalidMailQueueCreate(){
            queueCreateData( queueOptionsData );

        }, TypeError);

    }

    const queueData = layerAuthMailQueueCreate({
        repository: repositoryData,
        secret: 'auth-secret-with-more-than-thirty-two-characters'
    });

    for ( const recipientData of [null, 'x', 'x'.repeat( 321 )] ){
        await assert.rejects(
            queueData.enqueue(/** @type {any} */ ({
                templateName: 'email-verification',
                recipient: recipientData,
                payload: {}
            })),
            TypeError
        );

    }

});

test( 'Auth mail delivery sends a leased message and acknowledges it', async function(){
    const sentCallsData = /** @type {any[]} */ ([]);
    const repositoryCallsData = /** @type {any[]} */ ([]);
    const queueData = layerAuthMailQueueCreate({
        secret: 'auth-secret-with-more-than-thirty-two-characters',
        repository: {
            async enqueue(){
                return 'mail-1';

            }
        }
    });
    let encryptedMailData = /** @type {Record<string, any> | null} */ (null);
    const captureQueueData = layerAuthMailQueueCreate({
        secret: 'auth-secret-with-more-than-thirty-two-characters',
        repository: {
            async enqueue( /** @type {Record<string, any>} */ mailData ){
                encryptedMailData = mailData;
                return 'mail-1';

            }
        }
    });
    await captureQueueData.enqueue({
        templateName: 'email-verification',
        recipient: 'developer@example.test',
        locale: 'en',
        payload: {token: 'verification-token-with-sufficient-entropy'}
    });
    const encryptedMailRecordData = /** @type {Record<string, any>} */ (encryptedMailData);
    const deliveryData = layerAuthMailDeliveryCreate(/** @type {any} */ ({
        repository: {
            async lease( /** @type {any} */ leaseData ){
                repositoryCallsData.push( ['lease', leaseData] );
                return [{
                    mailId: 'mail-1',
                    templateName: 'email-verification',
                    recipientEncrypted: encryptedMailRecordData.recipientEncrypted,
                    locale: 'en',
                    payloadEncrypted: encryptedMailRecordData.payloadEncrypted,
                    attempts: 1
                }];

            },
            /** @param {any[]} sentData */
            async sent( ...sentData ){
                repositoryCallsData.push( ['sent', ...sentData] );
                return true;

            },
            /** @param {any[]} failureData */
            async failed( ...failureData ){
                repositoryCallsData.push( ['failed', ...failureData] );
                return true;

            }
        },
        queue: queueData,
        smtp: {
            host: 'smtp.example.test',
            port: 465,
            secure: true,
            username: null,
            from: 'Layer <layer@example.test>'
        },
        workerId: 'auth-mail-worker-1',
        clock(){
            return Date.parse( '2026-09-23T12:00:00.000Z' );

        },
        transportCreate(){
            return {
                async sendMail( /** @type {any} */ mailData ){
                    sentCallsData.push( mailData );
                    return {accepted: [mailData.to], rejected: []};

                },
                close(){}
            };

        }
    }));

    const deliveryResultData = await deliveryData.runOnce();

    assert.deepEqual( deliveryResultData, {processed: 1} );
    assert.equal( sentCallsData[0].to, 'developer@example.test' );
    assert.equal( sentCallsData[0].text.includes( 'verification-token-with-sufficient-entropy' ), true );
    assert.deepEqual( repositoryCallsData[1], ['sent', 'mail-1', 'auth-mail-worker-1'] );

});

test( 'Auth mail delivery records bounded terminal failures without message data', async function(){
    let failureData = /** @type {Record<string, any> | null} */ (null);
    const queueData = {
        open(){
            return {
                recipient: 'developer@example.test',
                payload: {token: 'recovery-token-with-sufficient-entropy'}
            };

        }
    };
    const deliveryData = layerAuthMailDeliveryCreate(/** @type {any} */ ({
        repository: {
            async lease(){
                return [{
                    mailId: 'mail-terminal',
                    templateName: 'password-recovery',
                    recipientEncrypted: Buffer.alloc( 40 ),
                    locale: 'en',
                    payloadEncrypted: Buffer.alloc( 40 ),
                    attempts: 5
                }];

            },
            async sent(){
                return true;

            },
            async failed( /** @type {Record<string, any>} */ mailFailureData ){
                failureData = mailFailureData;
                return true;

            }
        },
        queue: queueData,
        smtp: {
            host: 'smtp.example.test',
            port: 465,
            secure: true,
            username: null,
            from: 'Layer <layer@example.test>'
        },
        workerId: 'auth-mail-worker-2',
        transportCreate(){
            return {
                async sendMail(){
                    throw new Error( 'remote error with developer@example.test and recovery token' );

                },
                close(){}
            };

        }
    }));

    await deliveryData.runOnce();
    const failureRecordData = /** @type {Record<string, any>} */ (failureData);

    assert.equal( failureRecordData.errorCode, 'SMTP_DELIVERY_EXHAUSTED' );
    assert.equal( failureRecordData.terminal, true );
    assert.equal( JSON.stringify( failureRecordData ).includes( 'developer@example.test' ), false );
    assert.equal( JSON.stringify( failureRecordData ).includes( 'recovery-token' ), false );

});
