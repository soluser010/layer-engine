import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';
import {ECDH} from 'node:crypto';
import {layerOutboundUrlPolicyCreate} from '@solcorp/layer-security';
import {pushInputErrorCreate, pushRecordAssert} from './configuration.js';

/** @param {string} endpointData @param {readonly string[]} [allowedOriginsData] */
export function pushEndpointValidate( endpointData, allowedOriginsData = [] ){
    //Allowing browser push providers, never arbitrary recipient-controlled HTTPS destinations
    let endpointUrlData;

    try {
        endpointUrlData = new URL( endpointData );

    } catch {
        throw pushInputErrorCreate( 'subscription.endpoint' );

    }

    const hostnameData = endpointUrlData.hostname;
    const providerStatusData = hostnameData === 'fcm.googleapis.com' || hostnameData === 'updates.push.services.mozilla.com' ||
        hostnameData.endsWith( '.push.apple.com' ) || hostnameData.endsWith( '.notify.windows.com' );

    if ( endpointData.length > 2048 || endpointUrlData.protocol !== 'https:' || endpointUrlData.port !== '' ||
        endpointUrlData.username !== '' || endpointUrlData.password !== '' || endpointUrlData.hash !== '' ||
        (!providerStatusData && !allowedOriginsData.includes( endpointUrlData.origin )) ){
        throw pushInputErrorCreate( 'subscription.endpoint' );

    }

    return endpointUrlData;

}

/** @param {unknown} subscriptionData @param {readonly string[]} [allowedOriginsData] */
export function pushSubscriptionValidate( subscriptionData, allowedOriginsData = [] ){
    //Checking exact fields and cryptographic key sizes before persisting a device
    pushRecordAssert( subscriptionData, ['endpoint', 'expirationTime', 'keys'], 'subscription' );
    pushRecordAssert( subscriptionData.keys, ['p256dh', 'auth'], 'subscription.keys' );

    if ( typeof subscriptionData.endpoint !== 'string' ){
        throw pushInputErrorCreate( 'subscription.endpoint' );

    }

    pushEndpointValidate( subscriptionData.endpoint, allowedOriginsData );

    for ( const [fieldData, expectedSizeData] of [['p256dh', 65], ['auth', 16]] ){
        const keyData = subscriptionData.keys[String( fieldData )];

        if ( typeof keyData !== 'string' || /^[A-Za-z0-9_-]+={0,2}$/.test( keyData ) === false || Buffer.from( keyData, 'base64url' ).length !== expectedSizeData ){
            throw pushInputErrorCreate( `subscription.keys.${fieldData}` );

        }

    }

    //Rejecting correctly sized bytes that are not a valid P-256 public point
    try {
        ECDH.convertKey( Buffer.from( subscriptionData.keys.p256dh, 'base64url' ), 'prime256v1' );

    } catch {
        throw pushInputErrorCreate( 'subscription.keys.p256dh' );

    }

    return {endpoint: subscriptionData.endpoint, keys: {p256dh: String( subscriptionData.keys.p256dh ), auth: String( subscriptionData.keys.auth )}};

}

/** @param {{vapid: {subject: string, publicKey: string, privateKey: string}, allowedOrigins?: readonly string[], lookup?: Parameters<typeof layerOutboundUrlPolicyCreate>[0]['lookup'], requestImplementation?: typeof httpsRequest, timeoutMs?: number}} optionsData */
export function pushTransportCreate( optionsData ){
    return Object.freeze({
        /** @param {{endpoint: string, keys: {p256dh: string, auth: string}}} subscriptionData
         * @param {Record<string, any>} notificationData @param {{ttlSeconds: number, urgency: string, topic?: string | null}} deliveryOptionsData */
        async send( subscriptionData, notificationData, deliveryOptionsData ){
            //Applying a total deadline including DNS, encryption and response receipt
            const controllerData = new AbortController();
            const timerData = setTimeout(function requestDeadlineAbort(){
                //Aborting slow resolver and provider work at the shared delivery deadline
                controllerData.abort();

            }, Math.min( optionsData.timeoutMs ?? 10000, 10000 ));

            try {
                const endpointUrlData = pushEndpointValidate( subscriptionData.endpoint, optionsData.allowedOrigins );
                const policyOptionsData = /** @type {Parameters<typeof layerOutboundUrlPolicyCreate>[0]} */ ({allowedOrigins: [endpointUrlData.origin]});

                if ( optionsData.lookup !== undefined ){
                    policyOptionsData.lookup = optionsData.lookup;

                }

                const outboundPolicyData = layerOutboundUrlPolicyCreate( policyOptionsData );
                const deadlineData = new Promise(function authorizationDeadline( resolve, rejected ){
                    //Making DNS verification itself respect the total outbound deadline
                    controllerData.signal.addEventListener( 'abort', function authorizationAbort(){
                        //Ending an unresolved DNS lookup without starting a network connection
                        rejected( new Error( 'NOTIFICATIONS_DELIVERY_TIMEOUT' ) );

                    }, {once: true});

                });
                const authorizedData = await Promise.race([outboundPolicyData.authorize( endpointUrlData.href ), deadlineData]);
                const webPushData = await import('web-push');
                const requestDetailsData = webPushData.default.generateRequestDetails( subscriptionData, JSON.stringify( notificationData ), {
                    TTL: deliveryOptionsData.ttlSeconds,
                    urgency: /** @type {import('web-push').Urgency} */ (deliveryOptionsData.urgency),
                    topic: deliveryOptionsData.topic ?? undefined,
                    vapidDetails: optionsData.vapid
                });

                if ( controllerData.signal.aborted ){
                    throw new Error( 'NOTIFICATIONS_DELIVERY_TIMEOUT' );

                }

                //Pinning the verified DNS answer while preserving original TLS hostname validation
                return await new Promise(function deliveryWait( resolve, rejected ){
                    const pinnedAddressData = String( authorizedData.addresses[0] );
                    const requestData = (optionsData.requestImplementation ?? httpsRequest)( authorizedData.url, {
                        method: 'POST',
                        headers: requestDetailsData.headers,
                        agent: false,
                        signal: controllerData.signal,
                        servername: authorizedData.hostname,
                        rejectUnauthorized: true,
                        lookup( hostnameData, lookupOptionsData, callbackData ){
                            //Returning only the previously authorized address, never resolving twice
                            if ( typeof lookupOptionsData === 'object' && lookupOptionsData.all ){
                                callbackData( null, [{address: pinnedAddressData, family: isIP( pinnedAddressData )}] );

                            } else {
                                callbackData( null, pinnedAddressData, isIP( pinnedAddressData ) );

                            }

                        }
                    }, function responseRead( responseData ){
                        let responseBytesData = 0;
                        responseData.on( 'data', function responseChunkRead( chunkData ){
                            //Bounding provider response bytes and retaining no response body
                            responseBytesData += chunkData.length;

                            if ( responseBytesData > 16384 ){
                                requestData.destroy( new Error( 'NOTIFICATIONS_RESPONSE_LIMIT' ) );

                            }

                        });
                        responseData.on( 'error', rejected );
                        responseData.on( 'end', function responseComplete(){
                            //Returning only bounded status and retry metadata without provider body
                            resolve({status: responseData.statusCode ?? 500, retryAfter: responseData.headers['retry-after'] ?? null});

                        });

                    });
                    requestData.on( 'error', rejected );
                    requestData.end( requestDetailsData.body );

                });

            } finally {
                clearTimeout( timerData );

            }

        }
    });

}
