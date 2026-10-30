import {randomUUID} from 'node:crypto';
import {layerSystemTableReferenceCreate} from '@solcorp/layer-database';
import {LayerError} from '@solcorp/layer-protocol';

/** @typedef {{query: (queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, any>[], rowCount: number | null}>, systemSchema?: string, kind?: 'embedded' | 'postgres'}} PushDatabase
 * @typedef {PushDatabase & {transaction: <Result>(handler: (databaseData: PushDatabase) => Promise<Result>) => Promise<Result>}} PushTransactionalDatabase
 * @typedef {{tenantId?: string | null, userId?: string | null, credentialId?: string | null, credentialReference?: string, authenticationType?: string}} PushIdentity */

/** @param {PushIdentity} identityData */
export function pushIdentityAssert( identityData ){
    //Binding device ownership only to the authenticated server identity
    if ( !identityData || !identityData.userId || identityData.userId.startsWith( 'oauth-client:' ) || !identityData.credentialId || !['session', 'bearer'].includes( String( identityData.authenticationType ) ) ){
        throw new LayerError( 'AUTH_REQUIRED', 'Authenticated user identity is required for Web Push.', {status: 401} );

    }

    return {tenantKey: identityData.tenantId ?? '', userId: identityData.userId, credentialId: identityData.credentialId};

}

/** @param {PushDatabase} databaseData @param {ReturnType<typeof import('./crypto.js').pushCryptoCreate>} cryptoData */
export function pushRepositoryCreate( databaseData, cryptoData ){
    //Preparing trusted SQL identifiers once; all recipient values remain parameters
    const subscriptionsTableData = layerSystemTableReferenceCreate( databaseData, 'sys_push_subscriptions' );
    const notificationsTableData = layerSystemTableReferenceCreate( databaseData, 'sys_push_notifications' );
    const deliveriesTableData = layerSystemTableReferenceCreate( databaseData, 'sys_push_deliveries' );

    return Object.freeze({
        /** @param {PushIdentity} identityData @param {{endpoint: string, keys: {p256dh: string, auth: string}}} subscriptionData */
        async register( identityData, subscriptionData ){
            const ownerData = pushIdentityAssert( identityData );

            //Serializing the quota check across workers with the owner's transaction advisory lock
            if ( databaseData.kind !== 'embedded' ){
                await databaseData.query({text: 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', values: [`push:${ownerData.tenantKey}:${ownerData.userId}`]});

            }

            const endpointHashData = cryptoData.fingerprint( subscriptionData.endpoint );
            const countResultData = await databaseData.query({
                text: `SELECT count(*)::integer AS count FROM ${subscriptionsTableData} WHERE tenant_key=$1 AND user_id=$2 AND revoked_at IS NULL AND endpoint_hash<>$3`,
                values: [ownerData.tenantKey, ownerData.userId, endpointHashData]
            });

            if ( Number( countResultData.rows[0]?.count ) >= 10 ){
                throw new LayerError( 'NOTIFICATIONS_SUBSCRIPTION_LIMIT', 'The device subscription limit was reached.', {status: 429} );

            }

            //Replacing the previous account binding for the same device endpoint atomically
            const resultData = await databaseData.query({
                text: `INSERT INTO ${subscriptionsTableData} (subscription_id,endpoint_hash,tenant_key,user_id,credential_id,authentication_type,encrypted_subscription,binding_id,credential_reference)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                    ON CONFLICT (endpoint_hash) DO UPDATE SET tenant_key=EXCLUDED.tenant_key,user_id=EXCLUDED.user_id,
                    credential_id=EXCLUDED.credential_id,authentication_type=EXCLUDED.authentication_type,
                    credential_reference=EXCLUDED.credential_reference,
                    encrypted_subscription=EXCLUDED.encrypted_subscription,revoked_at=NULL,updated_at=now(),
                    binding_id=CASE WHEN ${subscriptionsTableData}.credential_id=EXCLUDED.credential_id AND ${subscriptionsTableData}.user_id=EXCLUDED.user_id
                    AND ${subscriptionsTableData}.tenant_key=EXCLUDED.tenant_key AND ${subscriptionsTableData}.revoked_at IS NULL
                    THEN ${subscriptionsTableData}.binding_id ELSE EXCLUDED.binding_id END
                    RETURNING subscription_id`,
                values: [randomUUID(), endpointHashData, ownerData.tenantKey, ownerData.userId, ownerData.credentialId,
                    identityData.authenticationType, cryptoData.encrypt( subscriptionData, `subscription:${endpointHashData}` ), randomUUID(), identityData.credentialReference ?? null]
            });

            return {subscriptionId: String( resultData.rows[0]?.subscription_id )};

        },
        /** @param {PushIdentity} identityData @param {string} subscriptionIdData @param {string | null} [endpointData] */
        async revoke( identityData, subscriptionIdData, endpointData = null ){
            const ownerData = pushIdentityAssert( identityData );
            let endpointHashData = null;

            //Fingerprinting an endpoint only when the authenticated caller supplied one
            if ( endpointData !== null ){
                endpointHashData = cryptoData.fingerprint( endpointData );

            }

            //Preventing one identity from revoking another account or session's device
            const resultData = await databaseData.query({
                text: `UPDATE ${subscriptionsTableData} SET revoked_at=now() WHERE (subscription_id::text=$1 OR endpoint_hash=$5)
                    AND tenant_key=$2 AND user_id=$3 AND credential_id=$4 AND revoked_at IS NULL`,
                values: [subscriptionIdData, ownerData.tenantKey, ownerData.userId, ownerData.credentialId,
                    endpointHashData]
            });

            return {revoked: Number( resultData.rowCount ) > 0};

        },
        /** @param {string} tenantKeyData @param {string[]} usersData @param {Record<string, any>} notificationData
         * @param {string} deduplicationKeyData @param {number} ttlSecondsData @param {string} urgencyData @param {string | null} [topicData] */
        async enqueue( tenantKeyData, usersData, notificationData, deduplicationKeyData, ttlSecondsData, urgencyData, topicData = null ){
            const notificationIdData = randomUUID();
            const payloadData = {...notificationData, notificationId: notificationIdData};
            const deduplicationHashData = cryptoData.fingerprint( `${tenantKeyData}:${deduplicationKeyData}` );

            //Deduplicating the logical notification before constructing its per-device deliveries
            const insertedResultData = await databaseData.query({
                text: `INSERT INTO ${notificationsTableData} (notification_id,tenant_key,deduplication_hash,encrypted_payload,urgency,expires_at,topic)
                    VALUES ($1,$2,$3,$4,$5,now()+($6::integer * interval '1 second'),$7)
                    ON CONFLICT (tenant_key,deduplication_hash) DO NOTHING RETURNING notification_id`,
                values: [notificationIdData, tenantKeyData, deduplicationHashData,
                    cryptoData.encrypt( payloadData, `notification:${notificationIdData}` ), urgencyData, ttlSecondsData, topicData]
            });

            if ( insertedResultData.rows.length === 0 ){
                const priorResultData = await databaseData.query({
                    text: `SELECT notification_id FROM ${notificationsTableData} WHERE tenant_key=$1 AND deduplication_hash=$2`,
                    values: [tenantKeyData, deduplicationHashData]
                });

                return {notificationId: String( priorResultData.rows[0]?.notification_id ), status: 'queued'};

            }

            await databaseData.query({
                text: `INSERT INTO ${deliveriesTableData} (notification_id,subscription_id,binding_id)
                    SELECT $1,subscription_id,binding_id FROM ${subscriptionsTableData} WHERE tenant_key=$2 AND user_id=ANY($3::text[]) AND revoked_at IS NULL`,
                values: [notificationIdData, tenantKeyData, usersData]
            });

            return {notificationId: notificationIdData, status: 'queued'};

        },
        /** @param {string} ownerData @param {number} limitData @param {number} maximumAttemptsData */
        async claim( ownerData, limitData, maximumAttemptsData ){
            //Taking bounded leases atomically; SKIP LOCKED permits independent PostgreSQL workers
            const resultData = await databaseData.query({
                text: `WITH ready AS (
                    SELECT d.notification_id,d.subscription_id FROM ${deliveriesTableData} d
                    JOIN ${notificationsTableData} n USING (notification_id)
                    WHERE d.status='pending' AND d.next_attempt_at<=now() AND (d.lease_until IS NULL OR d.lease_until<=now())
                    AND n.expires_at>now() AND d.attempts<$3
                    ORDER BY d.next_attempt_at FOR UPDATE OF d SKIP LOCKED LIMIT $2
                ), claimed AS (
                    UPDATE ${deliveriesTableData} d SET lease_owner=$1,lease_until=now()+interval '30 seconds',attempts=d.attempts+1
                    FROM ready r WHERE d.notification_id=r.notification_id AND d.subscription_id=r.subscription_id RETURNING d.*
                ) SELECT c.*,n.encrypted_payload,n.urgency,n.topic,n.expires_at,s.endpoint_hash,s.encrypted_subscription,
                    s.tenant_key,s.user_id,s.credential_id,s.credential_reference,s.authentication_type,s.revoked_at,(c.binding_id<>s.binding_id) AS binding_revoked
                    FROM claimed c JOIN ${notificationsTableData} n USING(notification_id) JOIN ${subscriptionsTableData} s USING(subscription_id)`,
                values: [ownerData, limitData, maximumAttemptsData]
            });

            return resultData.rows;

        },
        /** @param {Record<string, any>} deliveryData @param {string} ownerData @param {string} statusData @param {number} retryMsData @param {boolean} revokeData */
        async complete( deliveryData, ownerData, statusData, retryMsData, revokeData ){
            //Preventing an expired lease holder from overwriting another worker's progress
            const resultData = await databaseData.query({
                text: `UPDATE ${deliveriesTableData} SET status=$4,next_attempt_at=now()+($5::integer * interval '1 millisecond'),
                    completed_at=CASE WHEN $4='pending' THEN NULL ELSE now() END,lease_owner=NULL,lease_until=NULL
                    WHERE notification_id=$1 AND subscription_id=$2 AND lease_owner=$3 AND lease_until>now() RETURNING subscription_id`,
                values: [deliveryData.notification_id, deliveryData.subscription_id, ownerData, statusData, retryMsData]
            });

            if ( revokeData && resultData.rows.length > 0 ){
                await databaseData.query({text: `UPDATE ${subscriptionsTableData} SET revoked_at=now() WHERE subscription_id=$1 AND binding_id=$2`, values: [deliveryData.subscription_id, deliveryData.binding_id]});

            }

        },
        async cleanup( maximumAttemptsData = 8 ){
            //Expiring unsent deliveries and removing a bounded seven-day history batch
            await databaseData.query({
                text: `UPDATE ${deliveriesTableData} SET status='expired',completed_at=now(),lease_owner=NULL,lease_until=NULL
                    WHERE (notification_id,subscription_id) IN (SELECT d.notification_id,d.subscription_id FROM ${deliveriesTableData} d
                    JOIN ${notificationsTableData} n USING(notification_id) WHERE d.status='pending'
                    AND (n.expires_at<=now() OR (d.attempts>=$1 AND (d.lease_until IS NULL OR d.lease_until<=now()))) LIMIT 500)`,
                values: [maximumAttemptsData]
            });
            await databaseData.query({
                text: `DELETE FROM ${notificationsTableData} WHERE notification_id IN (
                    SELECT n.notification_id FROM ${notificationsTableData} n WHERE n.expires_at<now()-interval '7 days'
                    AND NOT EXISTS (SELECT 1 FROM ${deliveriesTableData} d WHERE d.notification_id=n.notification_id AND d.status='pending') LIMIT 500)`,
                values: []
            });

        },
        async diagnostics(){
            //Publishing counts and queue age only, never identities or private payloads
            const resultData = await databaseData.query({
                text: `SELECT count(*)::integer AS pending,COALESCE(EXTRACT(EPOCH FROM (now()-MIN(n.created_at)))*1000,0)::bigint AS oldest_ms
                    FROM ${deliveriesTableData} d JOIN ${notificationsTableData} n USING(notification_id) WHERE d.status='pending'`,
                values: []
            });

            return {pending: Number( resultData.rows[0]?.pending ?? 0 ), oldestMs: Number( resultData.rows[0]?.oldest_ms ?? 0 )};

        }
    });

}
