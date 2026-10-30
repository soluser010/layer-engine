export const layerWebPushMigration = Object.freeze({
    version: 8,
    name: 'web-push',
    upSql: `
        CREATE TABLE layer_engine.push_subscriptions (
            subscription_id uuid PRIMARY KEY,
            endpoint_hash text NOT NULL UNIQUE,
            tenant_key text NOT NULL,
            user_id text NOT NULL,
            credential_id text NOT NULL,
            credential_reference text,
            authentication_type text NOT NULL,
            binding_id uuid NOT NULL,
            encrypted_subscription text NOT NULL,
            revoked_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX push_subscription_owner ON layer_engine.push_subscriptions (tenant_key, user_id) WHERE revoked_at IS NULL;
        CREATE TABLE layer_engine.push_notifications (
            notification_id uuid PRIMARY KEY,
            tenant_key text NOT NULL,
            deduplication_hash text NOT NULL,
            encrypted_payload text NOT NULL,
            urgency text NOT NULL,
            topic text,
            expires_at timestamptz NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (tenant_key, deduplication_hash)
        );
        CREATE TABLE layer_engine.push_deliveries (
            notification_id uuid NOT NULL REFERENCES layer_engine.push_notifications(notification_id) ON DELETE CASCADE,
            subscription_id uuid NOT NULL REFERENCES layer_engine.push_subscriptions(subscription_id) ON DELETE CASCADE,
            binding_id uuid NOT NULL,
            status text NOT NULL DEFAULT 'pending',
            attempts integer NOT NULL DEFAULT 0,
            next_attempt_at timestamptz NOT NULL DEFAULT now(),
            lease_owner text,
            lease_until timestamptz,
            completed_at timestamptz,
            PRIMARY KEY (notification_id, subscription_id)
        );
        CREATE INDEX push_delivery_ready ON layer_engine.push_deliveries (next_attempt_at) WHERE status = 'pending';
    `
});
