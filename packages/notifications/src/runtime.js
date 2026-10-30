import {randomUUID} from 'node:crypto';
import {layerSystemTableReferenceCreate} from '@solcorp/layer-database';
import {LayerError} from '@solcorp/layer-protocol';
import {layerNotificationsConfigurationCreate, layerNotificationsSecretsRead, pushInputErrorCreate, pushRecordAssert} from './configuration.js';
import {pushCryptoCreate} from './crypto.js';
import {pushIdentityAssert, pushRepositoryCreate} from './repository.js';
import {pushSubscriptionValidate, pushTransportCreate} from './transport.js';

/** @typedef {{title: string, body: string, url: string, icon?: string, badge?: string, tag?: string}} LayerPushNotification
 * @typedef {{recipients: {users: string[]}, notification: LayerPushNotification, deduplicationKey: string, ttlSeconds?: number, urgency?: 'very-low' | 'low' | 'normal' | 'high', topic?: string}} LayerPushSendOptions */

/** @param {string} pathData @param {unknown} valueData */
function sameOriginPathAssert( pathData, valueData ){
    //Rejecting foreign URLs and backslash/control-character URL parser ambiguities
    if ( typeof valueData !== 'string' || valueData.length > 2048 || !valueData.startsWith( '/' ) || valueData.startsWith( '//' ) ||
        valueData.includes( '\\' ) || Array.from( valueData ).some(function unsafeUrlCharacter( characterData ){
        //Rejecting control characters before browser URL normalization
        return characterData.charCodeAt( 0 ) <= 32;

    }) ){
        throw pushInputErrorCreate( pathData );

    }

}

/** @param {unknown} sendData @param {number} defaultTtlData @param {number} maximumTtlData */
function notificationSendValidate( sendData, defaultTtlData, maximumTtlData ){
    //Bounding recipient fan-out and user-visible payload before allocating SQL work
    pushRecordAssert( sendData, ['recipients', 'notification', 'deduplicationKey', 'ttlSeconds', 'urgency', 'topic'], 'send' );
    pushRecordAssert( sendData.recipients, ['users'], 'send.recipients' );
    const usersData = sendData.recipients.users;
    const notificationData = sendData.notification;
    pushRecordAssert( notificationData, ['title', 'body', 'url', 'icon', 'badge', 'tag'], 'send.notification' );

    if ( !Array.isArray( usersData ) || usersData.length < 1 || usersData.length > 100 ||
        usersData.some(function recipientInvalid( userData ){
            //Bounding each trusted recipient identifier before SQL fan-out
            return typeof userData !== 'string' || userData.length < 1 || userData.length > 160;

        }) ){
        throw pushInputErrorCreate( 'send.recipients.users' );

    }

    if ( typeof notificationData.title !== 'string' || notificationData.title.length < 1 || notificationData.title.length > 160 ||
        typeof notificationData.body !== 'string' || notificationData.body.length > 500 ||
        (notificationData.tag !== undefined && (typeof notificationData.tag !== 'string' || notificationData.tag.length > 128)) ){
        throw pushInputErrorCreate( 'send.notification' );

    }

    sameOriginPathAssert( 'send.notification.url', notificationData.url );

    if ( notificationData.icon !== undefined ){
        sameOriginPathAssert( 'send.notification.icon', notificationData.icon );

    }

    if ( notificationData.badge !== undefined ){
        sameOriginPathAssert( 'send.notification.badge', notificationData.badge );

    }

    if ( Buffer.byteLength( JSON.stringify( notificationData ), 'utf8' ) > 2900 ){
        throw pushInputErrorCreate( 'send.notification' );

    }

    const ttlData = sendData.ttlSeconds ?? defaultTtlData;
    const urgencyData = sendData.urgency ?? 'normal';
    const topicData = sendData.topic ?? null;

    if ( topicData !== null && (typeof topicData !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test( topicData )) ){
        throw pushInputErrorCreate( 'send.topic' );

    }

    if ( !Number.isSafeInteger( ttlData ) || ttlData < 1 || ttlData > maximumTtlData ||
        !['very-low', 'low', 'normal', 'high'].includes( urgencyData ) ||
        typeof sendData.deduplicationKey !== 'string' || sendData.deduplicationKey.length < 1 || sendData.deduplicationKey.length > 160 ){
        throw pushInputErrorCreate( 'send' );

    }

    return {users: [...new Set( /** @type {string[]} */ (usersData) )], notification: notificationData,
        ttlSeconds: Number( ttlData ), urgency: String( urgencyData ), topic: topicData, deduplicationKey: sendData.deduplicationKey};

}

/** Durable Web Push lifecycle. SQL is authoritative; Redis carries wakeup hints only.
 * @param {object} optionsData
 * @param {unknown} optionsData.configuration
 * @param {string} optionsData.applicationName
 * @param {import('./repository.js').PushTransactionalDatabase} optionsData.database
 * @param {Record<string, string | undefined>} [optionsData.environment]
 * @param {string} [optionsData.workerId]
 * @param {{client: any, isReady: () => boolean} | null} [optionsData.redis]
 * @param {{send: (subscription: any, notification: any, options: {ttlSeconds: number, urgency: string, topic?: string | null}) => Promise<{status: number, retryAfter?: string | string[] | null}>}} [optionsData.transport]
 * @param {(identityData: import('./repository.js').PushIdentity) => Promise<boolean>} [optionsData.identityActive]
 * @param {(diagnosticData: {code: string}) => void} [optionsData.onError]
 */
export function layerNotificationsRuntimeCreate( optionsData ){
    const configurationData = layerNotificationsConfigurationCreate( optionsData.configuration );

    if ( configurationData === null ){
        throw pushInputErrorCreate( 'notifications' );

    }

    //Reading server ENV once without putting secrets into facade or diagnostics
    const secretsData = layerNotificationsSecretsRead( configurationData, optionsData.environment ?? process.env );
    const deliveryData = configurationData.webPush.delivery;
    const cryptoData = pushCryptoCreate( secretsData.secret, optionsData.applicationName );
    const repositoryData = pushRepositoryCreate( optionsData.database, cryptoData );
    const transportData = optionsData.transport ?? pushTransportCreate({
        vapid: {subject: configurationData.webPush.vapid.subject, publicKey: secretsData.publicKey, privateKey: secretsData.privateKey},
        allowedOrigins: configurationData.webPush.allowedOrigins
    });
    const workerIdData = `${optionsData.workerId ?? 'push-worker'}:${randomUUID()}`;
    const redisChannelData = `layer:${optionsData.applicationName}:push-wakeup`;
    let stoppedData = true;
    let timerData = /** @type {ReturnType<typeof setInterval> | null} */ (null);
    let activePollData = /** @type {Promise<void> | null} */ (null);
    let redisSubscriberData = /** @type {any} */ (null);
    let lastCleanupData = 0;

    const identityActiveData = optionsData.identityActive ?? async function identityActiveRead( identityData ){
        //Checking the durable credential again immediately before outbound delivery
        let tableNameData = 'sys_auth_oauth_access_tokens';

        if ( identityData.authenticationType === 'session' ){
            tableNameData = 'sys_sessions';

        }

        //Resolving built-in OAuth revocation without retaining or decrypting access tokens
        if ( identityData.credentialReference?.startsWith( 'oidc:' ) ){
            const oidcTableData = layerSystemTableReferenceCreate( optionsData.database, 'sys_auth_oidc_records' );
            const usersTableData = layerSystemTableReferenceCreate( optionsData.database, 'sys_auth_users' );
            const oidcResultData = await optionsData.database.query({
                text: `SELECT 1 FROM ${oidcTableData} r WHERE r.model_name='AccessToken' AND r.record_id_hash=$1 AND r.expires_at>now()
                    AND EXISTS (SELECT 1 FROM ${usersTableData} u WHERE u.user_id=$2 AND u.status='active') LIMIT 1`,
                values: [identityData.credentialReference.slice( 5 ), identityData.userId]
            });

            return oidcResultData.rows.length === 1;

        }

        const tableData = layerSystemTableReferenceCreate( optionsData.database, tableNameData );
        let identifierSqlData = '(session_id=$1 OR session_hash=$1)';

        if ( identityData.authenticationType !== 'session' ){
            identifierSqlData = '(token_id=$1 OR token_hash=$1)';

        }

        const resultData = await optionsData.database.query({
            text: `SELECT 1 FROM ${tableData} WHERE ${identifierSqlData} AND user_id=$2 AND status='active' AND expires_at>now() LIMIT 1`,
            values: [identityData.credentialId, identityData.userId]
        });

        return resultData.rows.length === 1;

    };

    /** @param {Record<string, any>} rowData */
    const deliveryExecuteData = async function( rowData ){
        const identityData = {tenantId: rowData.tenant_key, userId: rowData.user_id,
            credentialId: rowData.credential_id, credentialReference: rowData.credential_reference ?? undefined, authenticationType: rowData.authentication_type};
        let statusData = 0;
        let retryAfterData = /** @type {string | string[] | null | undefined} */ (null);
        let revokeData = rowData.revoked_at !== null || rowData.binding_revoked === true;

        //Failing closed on revoked identities, decryption failure or rejected SSRF destination
        if ( revokeData === false && await identityActiveData( identityData ) === false ){
            revokeData = true;

        }

        if ( revokeData === false ){
            try {
                const subscriptionData = cryptoData.decrypt( rowData.encrypted_subscription, `subscription:${rowData.endpoint_hash}` );
                const payloadData = cryptoData.decrypt( rowData.encrypted_payload, `notification:${rowData.notification_id}` );
                const ttlData = Math.max( 1, Math.ceil( (new Date( rowData.expires_at ).getTime() - Date.now()) / 1000 ) );
                const resultData = await transportData.send( subscriptionData, payloadData, {ttlSeconds: ttlData, urgency: rowData.urgency, topic: rowData.topic} );
                statusData = resultData.status;
                retryAfterData = resultData.retryAfter;

            } catch( error ){
                //Not retrying rejected destinations; network faults retain their SQL delivery
                if ( error instanceof LayerError ){
                    statusData = 400;

                }

            }

        }

        let completionData = 'failed';
        let retryMsData = 0;

        if ( statusData >= 200 && statusData < 300 ){
            completionData = 'sent';

        } else if ( revokeData || statusData === 404 || statusData === 410 ){
            completionData = 'revoked';
            revokeData = true;

        } else if ( (statusData === 0 || statusData === 429 || statusData >= 500) && rowData.attempts < deliveryData.maximumAttempts ){
            //Bounding exponential retry, provider Retry-After and random jitter by expiration
            retryMsData = Math.min( 900000, 5000 * (2 ** (Number( rowData.attempts ) - 1)) + Math.floor( Math.random() * 1000 ) );
            const numericRetryData = Number( retryAfterData );
            let providerRetryData = Date.parse( String( retryAfterData ) ) - Date.now();

            if ( Number.isFinite( numericRetryData ) && numericRetryData > 0 ){
                providerRetryData = numericRetryData * 1000;

            }

            if ( Number.isFinite( providerRetryData ) && providerRetryData > 0 ){
                retryMsData = Math.min( 900000, Math.max( retryMsData, providerRetryData ) );

            }

            if ( Date.now() + retryMsData < new Date( rowData.expires_at ).getTime() ){
                completionData = 'pending';

            } else {
                completionData = 'expired';

            }

        }

        await optionsData.database.transaction(async function completionRecord( transactionData ){
            //Recording completion and invalid-subscription revocation under one lease-fenced transaction
            await pushRepositoryCreate( transactionData, cryptoData ).complete( rowData, workerIdData, completionData, retryMsData, revokeData );

        });

    };

    const pollData = function(){
        //Coalescing timer and Redis wakeups without overlapping claims inside one worker
        if ( stoppedData || activePollData !== null ){
            return activePollData ?? Promise.resolve();

        }

        activePollData = (async function deliveryBatchExecute(){
            //Claiming only the current concurrency window before starting provider requests
            const rowsData = await optionsData.database.transaction(async function deliveryClaim( transactionData ){
                //Keeping claim selection and lease updates in one SQL transaction
                return pushRepositoryCreate( transactionData, cryptoData ).claim( workerIdData,
                    Math.min( deliveryData.batchSize, deliveryData.concurrencyPerWorker ), deliveryData.maximumAttempts );

            });
            //Waiting for every leased delivery even if one SQL completion fails
            const resultsData = await Promise.allSettled( rowsData.map( deliveryExecuteData ) );

            if ( resultsData.some(function deliveryFailed( resultData ){
                //Reporting a bounded warning without ending drain before remaining sends settle
                return resultData.status === 'rejected';

            }) ){
                optionsData.onError?.({code: 'NOTIFICATIONS_QUEUE_UNAVAILABLE'});

            }

            if ( Date.now() - lastCleanupData > 60000 ){
                await repositoryData.cleanup( deliveryData.maximumAttempts );
                lastCleanupData = Date.now();

            }

        })().catch(function pollingErrorReport(){
            //Reporting bounded queue failure while retaining all work for a subsequent poll
            optionsData.onError?.({code: 'NOTIFICATIONS_QUEUE_UNAVAILABLE'});

        }).finally(function pollingRelease(){
            //Allowing a subsequent timer or wakeup to claim the next bounded batch
            activePollData = null;

        });

        return activePollData;

    };

    const wakeData = async function(){
        //Publishing only after a transaction commits; SQL polling covers Redis failure
        if ( optionsData.redis?.isReady() ){
            try {
                await optionsData.redis.client.publish( redisChannelData, 'ready' );

            } catch {
                //Leaving durable polling active when the optional wakeup bus is unavailable
                optionsData.onError?.({code: 'NOTIFICATIONS_REDIS_UNAVAILABLE'});

            }

        }

        void pollData();

    };

    /** @param {import('./repository.js').PushDatabase | null} transactionData @param {import('./repository.js').PushIdentity} identityData */
    const bindData = function( transactionData, identityData ){
        //Exposing only the safe enqueue method instead of the system SQL adapter
        return Object.freeze({webPush: Object.freeze({
            /** Queue a bounded notification for server-selected users in the current tenant.
             * The caller must authorize recipients. SQL commit queues delivery, not OS display.
             * deduplicationKey identifies one logical notification; tag affects visible UI,
             * while optional topic replaces pending messages at the push provider.
             * @param {LayerPushSendOptions} sendData */
            async send( sendData ){
                const inputData = notificationSendValidate( sendData, deliveryData.defaultTtlSeconds, deliveryData.maximumTtlSeconds );

                if ( identityData.tenantId === undefined ){
                    throw pushInputErrorCreate( 'send.tenantId' );

                }

                const enqueueData = async function( /** @type {import('./repository.js').PushDatabase} */ databaseData ){
                    //Writing recipient deliveries through the selected command or standalone transaction
                    return pushRepositoryCreate( databaseData, cryptoData ).enqueue( identityData.tenantId ?? '', inputData.users,
                        inputData.notification, inputData.deduplicationKey, inputData.ttlSeconds, inputData.urgency, inputData.topic );

                };

                if ( transactionData !== null ){
                    return enqueueData( transactionData );

                }

                const resultData = await optionsData.database.transaction( enqueueData );
                await wakeData();

                return resultData;

            }
        })});

    };

    return Object.freeze({
        executor: Object.freeze({bind: bindData, afterCommit: wakeData}),
        /** @param {{tenantId: string | null}} scopeData */
        scope( scopeData ){
            //Requiring explicit tenant scope for trusted jobs outside an operation transaction
            return bindData( null, scopeData );

        },
        /** Register online-only user subscription operations before sealing the registry.
         * @param {{define: (definitionData: any) => unknown}} registryData */
        register( registryData ){
            const definitionsData = [
                {name: 'notifications.webpush.configuration', type: 'query', inputSchema: {type: 'object', additionalProperties: false},
                    outputSchema: {type: 'object', required: ['publicKey'], properties: {publicKey: {type: 'string'}}, additionalProperties: false},
                    async handler(){
                        //Returning the public application server key, never its private counterpart
                        return {publicKey: secretsData.publicKey};

                    }},
                {name: 'notifications.webpush.subscription.register', type: 'command',
                    inputSchema: {type: 'object', required: ['subscription'], properties: {subscription: {type: 'object'}}, additionalProperties: false},
                    outputSchema: {type: 'object', required: ['subscriptionId'], properties: {subscriptionId: {type: 'string', format: 'uuid'}}, additionalProperties: false},
                    async handler( /** @type {{subscription: unknown}} */ payloadData, /** @type {{security: import('./repository.js').PushIdentity}} */ contextData ){
                        //Validating the authenticated device before taking the quota lock
                        const subscriptionData = pushSubscriptionValidate( payloadData.subscription, configurationData.webPush.allowedOrigins );
                        pushIdentityAssert( contextData.security );

                        return optionsData.database.transaction(async function subscriptionSave( transactionData ){
                            //Saving account binding and quota checks atomically
                            return pushRepositoryCreate( transactionData, cryptoData ).register( contextData.security, subscriptionData );

                        });

                    }},
                {name: 'notifications.webpush.subscription.revoke', type: 'command',
                    inputSchema: {type: 'object', properties: {subscriptionId: {type: 'string', format: 'uuid'}, endpoint: {type: 'string', maxLength: 2048}},
                        anyOf: [{properties: {subscriptionId: {type: 'string'}}, required: ['subscriptionId']},
                            {properties: {endpoint: {type: 'string'}}, required: ['endpoint']}], additionalProperties: false},
                    outputSchema: {type: 'object', required: ['revoked'], properties: {revoked: {type: 'boolean'}}, additionalProperties: false},
                    async handler( /** @type {{subscriptionId?: string, endpoint?: string}} */ payloadData, /** @type {{security: import('./repository.js').PushIdentity}} */ contextData ){
                        //Restricting revocation to this user and credential even for a known endpoint
                        return repositoryData.revoke( contextData.security, payloadData.subscriptionId ?? '', payloadData.endpoint ?? null );

                    }}
            ];

            for ( const definitionData of definitionsData ){
                registryData.define({...definitionData, auth: 'authenticated', offlineReplay: false, cost: 5, concurrency: 8});

            }

        },
        async start(){
            //Starting durable polling even when Redis is absent or cannot subscribe
            if ( stoppedData === false ){
                return;

            }

            stoppedData = false;
            timerData = setInterval( pollData, deliveryData.pollIntervalMs );
            timerData.unref();

            if ( optionsData.redis?.isReady() ){
                try {
                    redisSubscriberData = optionsData.redis.client.duplicate();
                    redisSubscriberData.on( 'error', function redisWakeupUnavailable(){
                        //SQL polling remains active while the Redis client reconnects

                    });
                    await redisSubscriberData.connect();
                    await redisSubscriberData.subscribe( redisChannelData, pollData );

                } catch {
                    redisSubscriberData?.destroy();
                    redisSubscriberData = null;

                }

            }

            await pollData();

        },
        async stop(){
            //Stopping claims before waiting for bounded outbound requests and closing SQL
            stoppedData = true;
            clearInterval( timerData ?? undefined );
            timerData = null;
            redisSubscriberData?.destroy();
            redisSubscriberData = null;
            await activePollData;

        },
        async diagnostics(){
            //Reporting non-sensitive SQL queue health and the current acceleration mode
            const queueData = await repositoryData.diagnostics();
            let coordinationData = 'sql';

            if ( optionsData.redis?.isReady() ){
                coordinationData = 'redis+sql';

            }

            return {...queueData, running: !stoppedData, coordination: coordinationData};

        },
        poll: pollData
    });

}
