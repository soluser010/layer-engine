export const layerEventOutboxLeaseMigration = Object.freeze({
    version: 2,
    name: 'event-outbox-lease',
    rollbackNote: 'Drop lease columns only after all event publishers run a compatible earlier version.',
    upSql: `
        ALTER TABLE layer_engine.outbox
            ADD COLUMN IF NOT EXISTS lease_owner text NULL,
            ADD COLUMN IF NOT EXISTS lease_until timestamptz NULL,
            ADD COLUMN IF NOT EXISTS last_error text NULL;

        CREATE INDEX IF NOT EXISTS layer_outbox_publishable_idx
            ON layer_engine.outbox (outbox_id, lease_until)
            WHERE published_at IS NULL;
    `
});
