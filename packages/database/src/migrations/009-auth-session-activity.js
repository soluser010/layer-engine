export const layerAuthSessionActivityMigration = Object.freeze({
    version: 9,
    name: 'auth-session-activity',
    rollbackNote: 'Keep idle_lifetime_ms and the original session deadlines when rolling back Auth runtime code.',
    upSql: `
        ALTER TABLE layer_engine.sessions
            ADD COLUMN idle_lifetime_ms bigint NULL
                CHECK (idle_lifetime_ms > 0 AND idle_lifetime_ms <= 31536000000);

        UPDATE layer_engine.sessions
        SET idle_lifetime_ms = FLOOR(EXTRACT(EPOCH FROM (idle_expires_at - last_seen_at)) * 1000)::bigint
        WHERE managed = true
            AND last_seen_at IS NOT NULL
            AND idle_expires_at > last_seen_at
            AND idle_expires_at - last_seen_at <= INTERVAL '365 days';
    `
});
