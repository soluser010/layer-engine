export const layerAuthOAuthAccountRevocationMigration = Object.freeze({
    version: 6,
    name: 'auth-oauth-account-revocation',
    rollbackNote: 'Preserve OAuth provider records before removing the account revocation index.',
    upSql: `
        ALTER TABLE layer_engine.auth_oidc_records
            ADD COLUMN IF NOT EXISTS account_id_hash text NULL;

        CREATE INDEX IF NOT EXISTS layer_auth_oidc_records_account_idx
            ON layer_engine.auth_oidc_records (account_id_hash);
    `
});
