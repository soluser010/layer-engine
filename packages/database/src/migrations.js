import {createHash} from 'node:crypto';
import {schemaMigrationLockAcquire} from './schema-lock.js';
import {layerFoundationMigration} from './migrations/001-foundation.js';
import {layerEventOutboxLeaseMigration} from './migrations/002-event-outbox-lease.js';
import {layerSecurityAuditMigration} from './migrations/003-security-audit.js';
import {layerRuntimeCoordinationMigration} from './migrations/004-runtime-coordination.js';
import {layerAuthFoundationMigration} from './migrations/005-auth-foundation.js';
import {layerAuthOAuthAccountRevocationMigration} from './migrations/006-auth-oauth-account-revocation.js';
import {layerAuthPhoneIdentifierMigration} from './migrations/007-auth-phone-identifier.js';
import {layerWebPushMigration} from './migrations/008-web-push.js';
import {layerAuthSessionActivityMigration} from './migrations/009-auth-session-activity.js';
import {layerCommandReplayIdentityMigration} from './migrations/010-command-replay-identity.js';
import {
    layerSqlIdentifierQuote,
    layerSystemSchemaRead,
    layerSystemTableReferenceCreate
} from './system-schema.js';

const databaseMigrations = Object.freeze([
    layerFoundationMigration,
    layerEventOutboxLeaseMigration,
    layerSecurityAuditMigration,
    layerRuntimeCoordinationMigration,
    layerAuthFoundationMigration,
    layerAuthOAuthAccountRevocationMigration,
    layerAuthPhoneIdentifierMigration,
    layerWebPushMigration,
    layerAuthSessionActivityMigration,
    layerCommandReplayIdentityMigration
]);
const migrationTableReplacements = Object.freeze({
    migrations: 'sys_migrations',
    sessions: 'sys_sessions',
    command_results: 'sys_command_results',
    domain_events: 'sys_domain_events',
    outbox: 'sys_outbox',
    api_keys: 'sys_api_keys',
    audit_log: 'sys_audit_log',
    leases: 'sys_leases',
    rate_limits: 'sys_rate_limits',
    schema_changes: 'sys_schema_changes',
    cache_invalidations: 'sys_cache_invalidations',
    auth_users: 'sys_auth_users',
    auth_identifiers: 'sys_auth_identifiers',
    auth_password_credentials: 'sys_auth_password_credentials',
    auth_passkeys: 'sys_auth_passkeys',
    auth_totp_credentials: 'sys_auth_totp_credentials',
    auth_recovery_codes: 'sys_auth_recovery_codes',
    auth_challenges: 'sys_auth_challenges',
    auth_external_identities: 'sys_auth_external_identities',
    auth_roles: 'sys_auth_roles',
    auth_role_permissions: 'sys_auth_role_permissions',
    auth_user_roles: 'sys_auth_user_roles',
    auth_invitations: 'sys_auth_invitations',
    auth_oauth_clients: 'sys_auth_oauth_clients',
    auth_oauth_consents: 'sys_auth_oauth_consents',
    auth_oauth_codes: 'sys_auth_oauth_codes',
    auth_oauth_access_tokens: 'sys_auth_oauth_access_tokens',
    auth_oauth_refresh_tokens: 'sys_auth_oauth_refresh_tokens',
    auth_oidc_records: 'sys_auth_oidc_records',
    auth_mail_outbox: 'sys_auth_mail_outbox',
    push_subscriptions: 'sys_push_subscriptions',
    push_notifications: 'sys_push_notifications',
    push_deliveries: 'sys_push_deliveries'
});
const legacyTableNames = Object.freeze( Object.keys( migrationTableReplacements ) );

/**
 * @typedef {object} MigrationQueryResult
 * @property {Record<string, unknown>[]} rows
 * @property {number | null} rowCount
 * @typedef {object} MigrationTransactionClient
 * @property {'embedded' | 'postgres'} [kind]
 * @property {string} [systemSchema]
 * @property {(queryData: {text: string, values: readonly unknown[]}) => Promise<MigrationQueryResult>} query
 * @typedef {object} MigrationDatabase
 * @property {'embedded' | 'postgres'} [kind]
 * @property {string} [systemSchema]
 * @property {(queryData: {text: string, values: readonly unknown[]}) => Promise<MigrationQueryResult>} query
 * @property {<ResultData>(handler: (transactionClient: MigrationTransactionClient) => Promise<ResultData>) => Promise<ResultData>} transaction
 */

/**
 * @param {string} migrationSql
 * @returns {string}
 */
function migrationChecksumCreate(migrationSql) {
    //Creating a stable digest for immutable migration verification.
    return createHash('sha256').update(migrationSql, 'utf8').digest('hex');

}

/**
 * @param {string} migrationSql
 * @param {string} systemSchemaData
 * @returns {string}
 */
function migrationSqlCreate( migrationSql, systemSchemaData ){
    //Getting the quoted target schema before replacing trusted migration references
    const quotedSchemaData = layerSqlIdentifierQuote( systemSchemaData );
    let preparedMigrationSqlData = String( migrationSql );

    //Replacing every known legacy table reference with the app-specific system table
    for ( const [legacyTableData, systemTableData] of Object.entries( migrationTableReplacements ) ){
        preparedMigrationSqlData = preparedMigrationSqlData.replaceAll(
            `layer_engine.${String( legacyTableData )}`,
            `${String( quotedSchemaData )}.${layerSqlIdentifierQuote( systemTableData )}`
        );

    }

    //CallBack THE STRING
    return preparedMigrationSqlData;

}

/**
 * @param {MigrationDatabase} database
 */
export async function layerDatabaseLegacyMigrate( database ){
    //Skipping the legacy namespace workflow for embedded storage and the legacy adapter itself
    const systemSchemaData = layerSystemSchemaRead( database );

    if ( database.kind === 'embedded' || systemSchemaData === 'layer_engine' ){
        return false;

    }

    return database.transaction(async function( transactionDatabaseData ){
        //Sharing app DDL ownership and serializing consumption of the one legacy namespace
        await schemaMigrationLockAcquire( transactionDatabaseData, systemSchemaData, database.kind );
        await schemaMigrationLockAcquire( transactionDatabaseData, 'layer_engine', database.kind );
        const schemaStatusData = await transactionDatabaseData.query({
            text: `
                SELECT schema_name
                FROM information_schema.schemata
                WHERE schema_name = ANY($1::text[])
            `,
            values: [[
                'layer_engine',
                systemSchemaData
            ]]
        });
        const schemaNamesData = new Set( schemaStatusData.rows.map(function schemaNameRead( schemaRowData ){
            //Collecting the schemas observed while this transaction owns the migration lock
            return String( schemaRowData.schema_name );

        }) );

        if ( schemaNamesData.has( 'layer_engine' ) === false ){
            return false;

        }

        if ( schemaNamesData.has( systemSchemaData ) === true ){
            throw new Error( 'DATABASE_LEGACY_SCHEMA_CONFLICT' );

        }

        const legacyTablesResultData = await transactionDatabaseData.query({
            text: `
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'layer_engine'
                    AND table_type = 'BASE TABLE'
                ORDER BY table_name ASC
            `,
            values: []
        });
        const legacyTablesData = new Set( legacyTablesResultData.rows.map(function legacyTableNameRead( tableRowData ){
            //Reading table names before deciding whether this is a recognized legacy database
            return String( tableRowData.table_name );

        }) );
        const knownLegacyTableStatusData = legacyTableNames.some(function knownLegacyTableFind( tableNameData ){
            //Requiring a known system table before relocating the legacy namespace
            return legacyTablesData.has( tableNameData );

        });

        if ( knownLegacyTableStatusData === false ){
            throw new Error( 'DATABASE_LEGACY_SCHEMA_UNKNOWN' );

        }

        //Moving the complete legacy namespace before renaming known system tables
        await transactionDatabaseData.query({
            text: `ALTER SCHEMA ${layerSqlIdentifierQuote( 'layer_engine' )} RENAME TO ${layerSqlIdentifierQuote( systemSchemaData )}`,
            values: []
        });

        for ( const [legacyTableData, systemTableData] of Object.entries( migrationTableReplacements ) ){
            if ( legacyTablesData.has( legacyTableData ) === false ){
                continue;

            }

            await transactionDatabaseData.query({
                text: `ALTER TABLE ${layerSqlIdentifierQuote( systemSchemaData )}.${layerSqlIdentifierQuote( legacyTableData )} RENAME TO ${layerSqlIdentifierQuote( systemTableData )}`,
                values: []
            });

        }

        if ( legacyTablesData.has( 'migrations' ) === true ){
            const migrationTableData = `${layerSqlIdentifierQuote( systemSchemaData )}.${layerSqlIdentifierQuote( 'sys_migrations' )}`;

            //Rebasing applied checksums onto their app-specific SQL representation
            for ( const migrationData of databaseMigrations ){
                const migrationSqlData = migrationSqlCreate( migrationData.upSql, systemSchemaData );

                await transactionDatabaseData.query({
                    text: `
                        UPDATE ${String( migrationTableData )}
                        SET name = $2, checksum = $3
                        WHERE version = $1
                    `,
                    values: [
                        migrationData.version,
                        migrationData.name,
                        migrationChecksumCreate( migrationSqlData )
                    ]
                });

            }

        }


        //CallBack THE BOOLEAN
        return true;

    });

}

/**
 * @param {MigrationDatabase} database
 */
export async function layerDatabaseMigrate(database) {
    //Preparing trusted references before opening one dedicated migration connection
    const systemSchemaData = layerSystemSchemaRead( database );
    const systemSchemaReferenceData = layerSqlIdentifierQuote( systemSchemaData );
    const migrationsTableReferenceData = layerSystemTableReferenceCreate( database, 'sys_migrations' );

    return database.transaction(async function( transactionClient ){
        //Locking before namespace creation so concurrent first starts cannot race in the catalog
        await schemaMigrationLockAcquire( transactionClient, systemSchemaData, database.kind );
        await transactionClient.query({
            text: `
                CREATE SCHEMA IF NOT EXISTS ${systemSchemaReferenceData};
                CREATE TABLE IF NOT EXISTS ${migrationsTableReferenceData} (
                    version integer PRIMARY KEY,
                    name text NOT NULL,
                    checksum text NOT NULL,
                    applied_at timestamptz NOT NULL DEFAULT now()
                );
            `,
            values: []
        });

        //Reading applied versions within the same transaction as new migrations
        const appliedMigrationResult = await transactionClient.query({
            text: `SELECT version, name, checksum FROM ${String( migrationsTableReferenceData )} ORDER BY version ASC`,
            values: []
        });
        const appliedMigrationMap = new Map();

        //Indexing applied metadata without sharing mutable row arrays.
        for (const migrationData of appliedMigrationResult.rows) {
            appliedMigrationMap.set(Number(migrationData.version), migrationData);

        }

        const newVersions = [];

        //Checking and applying every migration in strict sequential order.
        for (const migrationData of databaseMigrations) {
            const migrationSqlData = migrationSqlCreate( migrationData.upSql, systemSchemaData );
            const migrationChecksum = migrationChecksumCreate( migrationSqlData );
            const appliedMigration = appliedMigrationMap.get(migrationData.version);

            if (appliedMigration !== undefined) {
                //Stopping startup when a previously applied migration changed.
                if (appliedMigration.checksum !== migrationChecksum || appliedMigration.name !== migrationData.name) {
                    throw new Error(`Migration ${migrationData.version} checksum does not match.`);

                }

                continue;

            }

            //Applying the immutable migration within the same metadata transaction.
            await transactionClient.query({
                text: migrationSqlData,
                values: []
            });
            await transactionClient.query({
                text: `
                    INSERT INTO ${String( migrationsTableReferenceData )} (version, name, checksum)
                    VALUES ($1, $2, $3)
                `,
                values: [
                    migrationData.version,
                    migrationData.name,
                    migrationChecksum
                ]
            });
            newVersions.push(migrationData.version);

        }

        //CallBack THE OBJECT
        return Object.freeze( newVersions );

    });

}
