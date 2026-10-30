export const layerAuthPhoneIdentifierMigration = Object.freeze({
    version: 7,
    name: 'auth-phone-identifier',
    rollbackNote: 'Preserve verified phone identities before removing phone identifier support.',
    upSql: `
        ALTER TABLE layer_engine.auth_identifiers
            DROP CONSTRAINT IF EXISTS sys_auth_identifiers_identifier_type_check;

        ALTER TABLE layer_engine.auth_identifiers
            DROP CONSTRAINT IF EXISTS auth_identifiers_identifier_type_check;

        ALTER TABLE layer_engine.auth_identifiers
            ADD CONSTRAINT layer_auth_identifier_type_check
            CHECK (identifier_type IN ('email', 'username', 'phone'));
    `
});
