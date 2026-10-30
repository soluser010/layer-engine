export const layerCommandReplayIdentityMigration = Object.freeze({
    version: 10,
    name: 'command-replay-identity',
    rollbackNote: 'Do not roll back to a runtime which ignores replay identity. Legacy rows remain unbound and are never replayed.',
    upSql: `
        ALTER TABLE layer_engine.command_results
            ADD COLUMN actor_key text NULL CHECK (actor_key ~ '^[a-f0-9]{64}$'),
            ADD COLUMN request_digest text NULL CHECK (request_digest ~ '^[a-f0-9]{64}$');
    `
});
