export const layerFoundationMigration = Object.freeze({
    version: 1,
    name: 'foundation',
    rollbackNote: 'Drop layer_engine schema only after confirming no production data depends on it.',
    upSql: `
        CREATE TABLE IF NOT EXISTS layer_engine.sessions (
            session_hash text PRIMARY KEY,
            user_id text NOT NULL,
            tenant_id text NULL,
            permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
            csrf_hash text NOT NULL,
            status text NOT NULL CHECK (status IN ('active', 'revoked')),
            expires_at timestamptz NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS layer_sessions_user_status_idx
            ON layer_engine.sessions (user_id, status, expires_at);

        CREATE TABLE IF NOT EXISTS layer_engine.command_results (
            tenant_key text NOT NULL,
            command_id text NOT NULL,
            operation text NOT NULL,
            result jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (tenant_key, command_id)
        );

        CREATE TABLE IF NOT EXISTS layer_engine.domain_events (
            event_id text PRIMARY KEY,
            tenant_key text NOT NULL,
            channel text NOT NULL,
            sequence bigint NOT NULL,
            entity_revision bigint NOT NULL,
            type text NOT NULL,
            payload jsonb NOT NULL,
            occurred_at timestamptz NOT NULL,
            UNIQUE (tenant_key, channel, sequence)
        );

        CREATE TABLE IF NOT EXISTS layer_engine.outbox (
            outbox_id bigserial PRIMARY KEY,
            event_id text NOT NULL REFERENCES layer_engine.domain_events (event_id),
            payload jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            published_at timestamptz NULL,
            attempts integer NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS layer_outbox_pending_idx
            ON layer_engine.outbox (outbox_id)
            WHERE published_at IS NULL;
    `
});
