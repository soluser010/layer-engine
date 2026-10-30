const systemSchemaPattern = /^layer_[a-z][a-z0-9_]{0,62}$/;
const applicationNamePattern = /^[a-z][a-z0-9-]{0,79}$/;
const systemTableNames = Object.freeze([
    'sys_api_keys',
    'sys_auth_challenges',
    'sys_auth_external_identities',
    'sys_auth_identifiers',
    'sys_auth_invitations',
    'sys_auth_mail_outbox',
    'sys_auth_oauth_access_tokens',
    'sys_auth_oauth_clients',
    'sys_auth_oauth_codes',
    'sys_auth_oauth_consents',
    'sys_auth_oauth_refresh_tokens',
    'sys_auth_oidc_records',
    'sys_auth_passkeys',
    'sys_auth_password_credentials',
    'sys_auth_recovery_codes',
    'sys_auth_role_permissions',
    'sys_auth_roles',
    'sys_auth_totp_credentials',
    'sys_auth_user_roles',
    'sys_auth_users',
    'sys_audit_log',
    'sys_cache_invalidations',
    'sys_command_results',
    'sys_domain_events',
    'sys_leases',
    'sys_migrations',
    'sys_outbox',
    'sys_push_deliveries',
    'sys_push_notifications',
    'sys_push_subscriptions',
    'sys_rate_limits',
    'sys_schema_changes',
    'sys_sessions'
]);

/**
 * @param {string} identifierData
 * @returns {string}
 */
export function layerSqlIdentifierQuote( identifierData ){
    //Checking the trusted identifier before placing it in generated SQL text
    if ( /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test( identifierData ) === false ){
        //Passing the unsafe SQL identifier to the server boundary
        throw new TypeError( 'SQL identifier is invalid.' );

    }

    //CallBack THE STRING
    return `"${String( identifierData )}"`;

}

/**
 * @param {string} applicationNameData
 * @returns {string}
 */
export function layerSystemSchemaNameCreate( applicationNameData ){
    //Checking the application identity before deriving a database namespace
    if ( typeof applicationNameData !== 'string' || applicationNamePattern.test( applicationNameData ) === false ){
        //Passing the invalid application name to the database boundary
        throw new TypeError( 'Application name is invalid for a system schema.' );

    }

    //Creating one PostgreSQL-safe schema identifier from the stable application slug
    const systemSchemaData = `layer_${String( applicationNameData ).replaceAll( '-', '_' )}`;

    //Checking the derived identifier remains within the PostgreSQL name contract
    if ( systemSchemaPattern.test( systemSchemaData ) === false ){
        //Passing the invalid derived schema to the database boundary
        throw new TypeError( 'Derived system schema is invalid.' );

    }

    //CallBack THE STRING
    return systemSchemaData;

}

/**
 * @param {unknown} schemaNameData
 * @returns {string}
 */
export function layerSystemSchemaNameAssert( schemaNameData ){
    //Checking an explicit system schema before using it in SQL identifiers
    if ( typeof schemaNameData !== 'string' || systemSchemaPattern.test( schemaNameData ) === false ){
        //Passing the invalid system schema to the database boundary
        throw new TypeError( 'System schema name is invalid.' );

    }

    //CallBack THE STRING
    return schemaNameData;

}

/**
 * @param {unknown} databaseData
 * @returns {string}
 */
export function layerSystemSchemaRead( databaseData ){
    //Creating the legacy schema default for adapters without explicit application identity
    let schemaNameData = /** @type {unknown} */ ('layer_engine');

    //Getting the explicit schema identity from a database or transaction adapter
    if ( databaseData !== null && typeof databaseData === 'object' && 'systemSchema' in databaseData ){
        schemaNameData = /** @type {{systemSchema?: unknown}} */ (databaseData).systemSchema;

    }

    //Preserving the legacy default only for adapters created before app-specific schemas
    if ( String( schemaNameData ) === String( 'layer_engine' ) ){
        //CallBack THE STRING
        return String( 'layer_engine' );

    }

    //CallBack THE STRING
    return layerSystemSchemaNameAssert( schemaNameData );

}

/**
 * @param {unknown} databaseData
 * @param {string} tableNameData
 * @returns {string}
 */
export function layerSystemTableReferenceCreate( databaseData, tableNameData ){
    //Checking the system table allowlist before constructing its trusted reference
    if ( systemTableNames.includes( tableNameData ) === false ){
        //Passing the unknown system table to the database boundary
        throw new TypeError( 'System table name is invalid.' );

    }

    //Getting the validated system schema from the current adapter
    const schemaNameData = layerSystemSchemaRead( databaseData );

    //CallBack THE STRING
    return `${layerSqlIdentifierQuote( schemaNameData )}.${layerSqlIdentifierQuote( tableNameData )}`;

}

export {systemTableNames as LAYER_SYSTEM_TABLE_NAMES};
