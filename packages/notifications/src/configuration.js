import {createECDH} from 'node:crypto';
import {LayerError} from '@solcorp/layer-protocol';

/** @param {string} pathData */
export function pushInputErrorCreate( pathData ){
    //Returning bounded diagnostics without any secret or subscription value
    const safePathData = pathData.slice( 0, 256 ).replace( /[^a-zA-Z0-9_.[\]-]/g, '_' );

    return new LayerError( 'NOTIFICATIONS_INVALID', `Invalid notification setting: ${safePathData}.`, {
        status: 400,
        details: {path: safePathData}
    });

}

/** @param {unknown} recordData @param {readonly string[]} fieldsData @param {string} pathData
 * @returns {asserts recordData is Record<string, any>} */
export function pushRecordAssert( recordData, fieldsData, pathData ){
    //Rejecting unknown properties before consuming configuration or public input
    if ( recordData === null || typeof recordData !== 'object' || Array.isArray( recordData ) ){
        throw pushInputErrorCreate( pathData );

    }

    for ( const fieldData of Object.keys( recordData ) ){
        if ( fieldsData.includes( fieldData ) === false ){
            throw pushInputErrorCreate( `${pathData}.${fieldData}` );

        }

    }

}

/** @param {unknown} referenceData @param {string} pathData */
function secretReferenceCreate( referenceData, pathData ){
    //Keeping secrets out of configuration source and generated browser artifacts
    pushRecordAssert( referenceData, ['env'], pathData );

    if ( typeof referenceData.env !== 'string' || /^[A-Z][A-Z0-9_]{0,127}$/.test( referenceData.env ) === false ){
        throw pushInputErrorCreate( pathData );

    }

    return Object.freeze({env: referenceData.env});

}

/** Validate the optional server-only Web Push configuration. Secrets must be ENV references.
 * @param {unknown} configurationData */
export function layerNotificationsConfigurationCreate( configurationData ){
    //Preserving disabled-by-default behavior for static and existing applications
    if ( configurationData === null || configurationData === undefined ){
        return null;

    }

    pushRecordAssert( configurationData, ['webPush', 'secret'], 'notifications' );
    const webPushData = configurationData.webPush;
    pushRecordAssert( webPushData, ['vapid', 'delivery', 'allowedOrigins'], 'notifications.webPush' );
    pushRecordAssert( webPushData.vapid, ['subject', 'publicKey', 'privateKey'], 'notifications.webPush.vapid' );
    const subjectData = webPushData.vapid.subject;

    //Requiring a contact URI, never a value supplied by a push recipient
    if ( typeof subjectData !== 'string' || subjectData.length > 500 || /^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test( subjectData ) === false ){
        throw pushInputErrorCreate( 'notifications.webPush.vapid.subject' );

    }

    const deliveryData = webPushData.delivery ?? {};
    const deliveryDefaultsData = {
        concurrencyPerWorker: 8,
        batchSize: 50,
        pollIntervalMs: 5000,
        maximumAttempts: 8,
        defaultTtlSeconds: 3600,
        maximumTtlSeconds: 86400
    };
    pushRecordAssert( deliveryData, Object.keys( deliveryDefaultsData ), 'notifications.webPush.delivery' );
    const deliveryResultData = {...deliveryDefaultsData, ...deliveryData};
    const maximumValuesData = [32, 100, 60000, 20, 86400, 86400];

    //Bounding every delivery resource limit before worker startup
    for ( const [indexData, fieldData] of Object.keys( deliveryDefaultsData ).entries() ){
        const valueData = /** @type {Record<string, number>} */ (deliveryResultData)[fieldData];

        if ( valueData === undefined || Number.isSafeInteger( valueData ) === false || valueData < 1 || valueData > Number( maximumValuesData[indexData] ) ){
            throw pushInputErrorCreate( `notifications.webPush.delivery.${fieldData}` );

        }

    }

    if ( deliveryResultData.pollIntervalMs < 100 || deliveryResultData.defaultTtlSeconds > deliveryResultData.maximumTtlSeconds ){
        throw pushInputErrorCreate( 'notifications.webPush.delivery' );

    }

    const allowedOriginsData = webPushData.allowedOrigins ?? [];

    if ( Array.isArray( allowedOriginsData ) === false || allowedOriginsData.length > 32 ){
        throw pushInputErrorCreate( 'notifications.webPush.allowedOrigins' );

    }

    for ( const originData of allowedOriginsData ){
        let originUrlData;

        try {
            originUrlData = new URL( originData );

        } catch {
            throw pushInputErrorCreate( 'notifications.webPush.allowedOrigins' );

        }

        if ( originUrlData.origin !== originData || originUrlData.protocol !== 'https:' || originUrlData.port !== '' ){
            throw pushInputErrorCreate( 'notifications.webPush.allowedOrigins' );

        }

    }

    if ( new Set( allowedOriginsData ).size !== allowedOriginsData.length ){
        throw pushInputErrorCreate( 'notifications.webPush.allowedOrigins' );

    }

    return Object.freeze({
        secret: secretReferenceCreate( configurationData.secret, 'notifications.secret' ),
        webPush: Object.freeze({
            vapid: Object.freeze({
                subject: subjectData,
                publicKey: secretReferenceCreate( webPushData.vapid.publicKey, 'notifications.webPush.vapid.publicKey' ),
                privateKey: secretReferenceCreate( webPushData.vapid.privateKey, 'notifications.webPush.vapid.privateKey' )
            }),
            delivery: Object.freeze( deliveryResultData ),
            allowedOrigins: Object.freeze( [...allowedOriginsData] )
        })
    });

}

/** @param {NonNullable<ReturnType<typeof layerNotificationsConfigurationCreate>>} configurationData
 * @param {Record<string, string | undefined>} environmentData */
export function layerNotificationsSecretsRead( configurationData, environmentData ){
    //Validating the stable encryption secret and matching VAPID pair without logging their values
    const secretData = environmentData[configurationData.secret.env];
    const publicKeyData = environmentData[configurationData.webPush.vapid.publicKey.env];
    const privateKeyData = environmentData[configurationData.webPush.vapid.privateKey.env];

    if ( typeof secretData !== 'string' || secretData.length < 32 || !publicKeyData || !privateKeyData ){
        throw new LayerError( 'NOTIFICATIONS_SECRET_UNAVAILABLE', 'Web Push ENV secrets are unavailable.', {status: 503} );

    }

    try {
        const keyPairData = createECDH( 'prime256v1' );
        keyPairData.setPrivateKey( Buffer.from( privateKeyData, 'base64url' ) );

        if ( keyPairData.getPublicKey().toString( 'base64url' ) !== publicKeyData ){
            throw new Error( 'Mismatched key pair.' );

        }

    } catch {
        throw new LayerError( 'NOTIFICATIONS_SECRET_UNAVAILABLE', 'The Web Push VAPID key pair is invalid.', {status: 503} );

    }

    return Object.freeze({secret: secretData, publicKey: publicKeyData, privateKey: privateKeyData});

}

/** Generate a persistent VAPID pair explicitly; keep the private key in server secrets.
 * @returns {{publicKey: string, privateKey: string}} */
export function layerNotificationsVapidGenerate(){
    //Using the platform P-256 primitive rather than application cryptography
    const keyPairData = createECDH( 'prime256v1' );
    keyPairData.generateKeys();

    return {publicKey: keyPairData.getPublicKey().toString( 'base64url' ), privateKey: keyPairData.getPrivateKey().toString( 'base64url' )};

}
