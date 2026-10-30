export const layerRuntimeCoordinationMigration = Object.freeze({
    version: 4,
    name: 'runtime-coordination',
    rollbackNote: 'Preserve rate-limit, schema-change, and cache invalidation state before removing coordination tables.',
    upSql: `
        CREATE TABLE IF NOT EXISTS layer_engine.leases (
            lease_key text PRIMARY KEY,
            lease_owner text NOT NULL,
            lease_until timestamptz NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS layer_engine.rate_limits (
            bucket_key text PRIMARY KEY,
            tokens double precision NOT NULL,
            updated_at timestamptz NOT NULL,
            expires_at timestamptz NOT NULL
        );

        CREATE INDEX IF NOT EXISTS layer_rate_limits_expiration_idx
            ON layer_engine.rate_limits (expires_at);

        CREATE TABLE IF NOT EXISTS layer_engine.schema_changes (
            checksum text PRIMARY KEY,
            status text NOT NULL CHECK (status IN ('pending', 'approved', 'applied', 'rejected')),
            change_type text NOT NULL,
            plan jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            approved_at timestamptz NULL,
            applied_at timestamptz NULL
        );

        CREATE TABLE IF NOT EXISTS layer_engine.cache_invalidations (
            invalidation_id bigserial PRIMARY KEY,
            event_id text NOT NULL,
            cache_tags jsonb NOT NULL,
            occurred_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS layer_cache_invalidations_event_idx
            ON layer_engine.cache_invalidations (event_id, invalidation_id);
    `
});
