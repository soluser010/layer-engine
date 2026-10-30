export const layerSecurityAuditMigration = Object.freeze({
    version: 3,
    name: 'security-audit',
    rollbackNote: 'Preserve API-key and audit records according to the security retention policy before removing these tables.',
    upSql: `
        CREATE TABLE IF NOT EXISTS layer_engine.api_keys (
            key_hash text PRIMARY KEY,
            key_id text NOT NULL UNIQUE,
            user_id text NOT NULL,
            tenant_id text NULL,
            permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
            status text NOT NULL CHECK (status IN ('active', 'revoked')),
            expires_at timestamptz NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS layer_api_keys_user_status_idx
            ON layer_engine.api_keys (user_id, status, expires_at);

        CREATE TABLE IF NOT EXISTS layer_engine.audit_log (
            audit_id text PRIMARY KEY,
            request_id text NOT NULL,
            operation text NOT NULL,
            category text NOT NULL,
            authentication_type text NOT NULL,
            credential_id text NULL,
            user_id text NULL,
            tenant_id text NULL,
            remote_address_hash text NOT NULL,
            outcome text NOT NULL CHECK (outcome IN ('success', 'denied', 'failed')),
            error_code text NULL,
            occurred_at timestamptz NOT NULL
        );

        CREATE INDEX IF NOT EXISTS layer_audit_tenant_time_idx
            ON layer_engine.audit_log (tenant_id, occurred_at DESC);

        CREATE INDEX IF NOT EXISTS layer_audit_operation_time_idx
            ON layer_engine.audit_log (operation, occurred_at DESC);
    `
});
