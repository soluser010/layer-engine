import assert from 'node:assert/strict';
import {
    createHash,
    createHmac
} from 'node:crypto';
import {
    mkdtemp,
    rm
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    LAYER_SYSTEM_TABLE_NAMES,
    layerApiKeyRepositoryCreate,
    layerAuditRepositoryCreate,
    layerCacheInvalidationRepositoryCreate,
    layerCommandResultRepositoryCreate,
    layerDatabaseLeaseManagerCreate,
    layerDatabaseRateLimiterCreate,
    layerDatabaseLegacyMigrate,
    layerDatabaseMigrate,
    layerPgliteDatabaseCreate,
    layerPostgresDatabaseCreate,
    layerSessionRepositoryCreate,
    layerSqlIdentifierQuote,
    layerSystemSchemaNameCreate,
    layerSystemSchemaNameAssert,
    layerSystemTableReferenceCreate
} from '../src/index.js';

/**
 * @typedef {{text: string, values?: readonly unknown[]}} TestQueryData
 */

/**
 * @param {{clientFailure?: boolean, rollbackFailure?: boolean}} [fakeOptions]
 */
function fakePoolCreate(fakeOptions = {}) {
    const poolCalls = /** @type {TestQueryData[]} */ ([]);
    const clientCalls = /** @type {TestQueryData[]} */ ([]);
    let releaseCount = 0;
    let endCount = 0;
    let poolErrorHandler = /** @type {(() => void) | null} */ (null);
    const client = {
        async query(/** @type {string} */ queryText, /** @type {readonly unknown[]} */ queryValues) {
            clientCalls.push({
                text: queryText,
                values: queryValues
            });

            if (queryText === 'ROLLBACK' && fakeOptions.rollbackFailure) {
                throw new Error('rollback failed');
            }

            if (queryText === 'SELECT failure' && fakeOptions.clientFailure) {
                throw new Error('query failed');
            }

            return {
                rows: [
                    {
                        accepted: true
                    }
                ],
                rowCount: 1
            };
        },
        release() {
            releaseCount += 1;
        }
    };
    const pool = {
        on(/** @type {string} */ eventNameData, /** @type {() => void} */ handlerData) {
            if (eventNameData === 'error') {
                poolErrorHandler = handlerData;

            }

            return pool;
        },
        async query(/** @type {string} */ queryText, /** @type {readonly unknown[]} */ queryValues) {
            poolCalls.push({
                text: queryText,
                values: queryValues
            });

            return {
                rows: [
                    {
                        health: 1
                    }
                ],
                rowCount: 1
            };
        },
        async connect() {
            return client;
        },
        async end() {
            endCount += 1;
        }
    };

    return {
        pool: /** @type {import('pg').Pool} */ (/** @type {unknown} */ (pool)),
        poolCalls,
        clientCalls,
        poolErrorEmit() {
            poolErrorHandler?.();

        },
        releaseCountGet: () => releaseCount,
        endCountGet: () => endCount
    };
}

test('PostgreSQL runtime validates configuration and readiness', async () => {
    assert.throws(() => {
        layerPostgresDatabaseCreate({
            connectionString: ''
        });
    }, TypeError);
    assert.throws(() => {
        layerPostgresDatabaseCreate({
            connectionString: 'postgres://local',
            maxConnections: 0
        });
    }, TypeError);

    const fakePoolData = fakePoolCreate();
    let receivedPoolOptions = /** @type {import('pg').PoolConfig | undefined} */ (undefined);
    const database = layerPostgresDatabaseCreate({
        connectionString: 'postgres://local/test',
        maxConnections: 4,
        statementTimeoutMs: 9000,
        poolCreate: (poolOptions) => {
            receivedPoolOptions = poolOptions;

            return fakePoolData.pool;
        }
    });

    await assert.rejects(() => database.query({
        text: 'SELECT 1',
        values: []
    }), /not ready/);

    await database.connect();
    assert.equal(database.isReady(), true);
    assert.ok(receivedPoolOptions);
    assert.equal(receivedPoolOptions.max, 4);
    assert.equal(receivedPoolOptions.statement_timeout, 9000);
    assert.deepEqual(fakePoolData.poolCalls[0], {
        text: 'SELECT 1 AS health',
        values: []
    });

    assert.deepEqual(await database.query({
        text: 'SELECT $1 AS value',
        values: [
            'safe-value'
        ]
    }), {
        rows: [
            {
                health: 1
            }
        ],
        rowCount: 1
    });
    await database.healthCheck();
    fakePoolData.poolErrorEmit();
    assert.equal(database.isReady(), false);
    await database.healthCheck();
    assert.equal(database.isReady(), true);

    await database.close();
    await database.close();
    assert.equal(database.isReady(), false);
    assert.equal(fakePoolData.endCountGet(), 1);
});

test('PostgreSQL transaction commits success and releases its client', async () => {
    const fakePoolData = fakePoolCreate();
    const database = layerPostgresDatabaseCreate({
        connectionString: 'postgres://local/test',
        poolCreate: () => fakePoolData.pool
    });

    await database.connect();

    const transactionResult = await database.transaction(async (transactionClient) => {
        const queryResult = await transactionClient.query({
            text: 'SELECT $1 AS value',
            values: [
                42
            ]
        });

        return queryResult.rows[0];
    });

    assert.deepEqual(transactionResult, {
        accepted: true
    });
    assert.deepEqual(fakePoolData.clientCalls.map((queryData) => queryData.text), [
        'BEGIN',
        'SELECT $1 AS value',
        'COMMIT'
    ]);
    assert.equal(fakePoolData.releaseCountGet(), 1);
});

test('PostgreSQL transaction preserves primary failure after rollback', async () => {
    const fakePoolData = fakePoolCreate({
        clientFailure: true,
        rollbackFailure: true
    });
    const database = layerPostgresDatabaseCreate({
        connectionString: 'postgres://local/test',
        poolCreate: () => fakePoolData.pool
    });

    await database.connect();

    await assert.rejects(() => database.transaction(async (transactionClient) => {
        await transactionClient.query({
            text: 'SELECT failure',
            values: []
        });
    }), /query failed/);
    assert.deepEqual(fakePoolData.clientCalls.map((queryData) => queryData.text), [
        'BEGIN',
        'SELECT failure',
        'ROLLBACK'
    ]);
    assert.equal(fakePoolData.releaseCountGet(), 1);
});

test('PostgreSQL query contract rejects missing text or values', async () => {
    const fakePoolData = fakePoolCreate();
    const database = layerPostgresDatabaseCreate({
        connectionString: 'postgres://local/test',
        poolCreate: () => fakePoolData.pool
    });

    await database.connect();

    await assert.rejects(() => database.query(/** @type {any} */ ({
        text: ''
    })), TypeError);
    await assert.rejects(() => database.query(/** @type {any} */ (null)), TypeError);
});

test('system schema derives bounded app-specific sys table references', function(){
    //Creating a stable PostgreSQL namespace from the public application slug
    const systemSchemaData = layerSystemSchemaNameCreate( 'social-network' );

    //Checking system ownership names remain explicit and allowlisted
    assert.equal( systemSchemaData, 'layer_social_network' );
    assert.equal(
        layerSystemTableReferenceCreate( {systemSchema: systemSchemaData}, 'sys_sessions' ),
        '"layer_social_network"."sys_sessions"'
    );
    assert.equal( LAYER_SYSTEM_TABLE_NAMES.includes( 'sys_rate_limits' ), true );
    assert.throws(function unsafeTableReferenceCreate(){
        //Trying to construct an unregistered SQL identifier through the public helper
        layerSystemTableReferenceCreate( {systemSchema: systemSchemaData}, 'users' );

    }, TypeError);
    assert.throws(function unsafeApplicationSchemaCreate(){
        //Trying to derive a schema from an application path instead of its slug
        layerSystemSchemaNameCreate( '../application' );

    }, TypeError);
    assert.throws(function oversizedApplicationSchemaCreate(){
        //Rejecting a valid application slug that cannot fit a PostgreSQL schema identifier
        layerSystemSchemaNameCreate( 'a'.repeat( 64 ) );

    }, TypeError);
    assert.throws(function unsafeSystemSchemaAssert(){
        //Rejecting an explicit namespace outside Layer application ownership
        layerSystemSchemaNameAssert( 'public' );

    }, TypeError);
    assert.throws(function unsafeSqlIdentifierQuote(){
        //Rejecting generated SQL identifiers before interpolation
        layerSqlIdentifierQuote( 'invalid-identifier' );

    }, TypeError);

});

test('PGlite persists migrations and rejects a second owner', async function(){
    //Creating an isolated embedded state directory for this lifecycle test
    const temporaryRootDirectoryData = await mkdtemp( path.join( tmpdir(), 'layer-pglite-' ) );
    const databaseDirectoryData = path.join( temporaryRootDirectoryData, 'database', 'system' );
    const systemSchemaData = layerSystemSchemaNameCreate( 'embedded-test' );
    const firstDatabaseData = layerPgliteDatabaseCreate({
        dataDirectory: databaseDirectoryData,
        systemSchema: systemSchemaData
    });
    const competingDatabaseData = layerPgliteDatabaseCreate({
        dataDirectory: databaseDirectoryData,
        systemSchema: systemSchemaData
    });

    try {
        //Starting the first owner and applying the complete system migration chain
        await firstDatabaseData.connect();
        assert.deepEqual( await layerDatabaseMigrate( firstDatabaseData ), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] );

        //Checking another runtime cannot open the same single-user database directory
        await assert.rejects(
            function competingDatabaseConnect(){
                //Launching the competing embedded runtime while the ownership lock is active
                return competingDatabaseData.connect();

            },
            /PGLITE_DATA_DIRECTORY_LOCKED/
        );

        //Closing the first owner before proving migration metadata survives restart
        await firstDatabaseData.close();

        const restartedDatabaseData = layerPgliteDatabaseCreate({
            dataDirectory: databaseDirectoryData,
            systemSchema: systemSchemaData
        });

        try {
            //Reopening the same state directory and checking no migration is reapplied
            await restartedDatabaseData.connect();
            assert.deepEqual( await layerDatabaseMigrate( restartedDatabaseData ), [] );

            const migrationsTableReferenceData = layerSystemTableReferenceCreate(
                restartedDatabaseData,
                'sys_migrations'
            );
            const migrationCountResult = await restartedDatabaseData.query({
                text: `SELECT COUNT(*)::integer AS count FROM ${String( migrationsTableReferenceData )}`,
                values: []
            });

            assert.equal( migrationCountResult.rows[0]?.count, 10 );

        } finally {
            //Closing the restarted runtime before removing its isolated state directory
            await restartedDatabaseData.close();

        }

    } finally {
        //Closing partially started adapters without masking the primary test result
        if ( firstDatabaseData.isReady() === true ){
            await firstDatabaseData.close();

        }

        if ( competingDatabaseData.isReady() === true ){
            await competingDatabaseData.close();

        }

        //Removing only the unique temporary directory created by this test
        await rm( temporaryRootDirectoryData, {
            force: true,
            recursive: true
        });

    }

});

test('legacy system schema migrates once and conflicts fail closed', async function(){
    const transactionCallsData = /** @type {any[]} */ ([]);
    const legacyDatabaseData = {
        kind: /** @type {'postgres'} */ ('postgres'),
        systemSchema: 'layer_social_network',

        async query( /** @type {any} */ queryData ){
            if ( queryData.text.includes( 'information_schema.schemata' ) ){
                return {
                    rows: [{schema_name: 'layer_engine'}],
                    rowCount: 1
                };

            }

            return {
                rows: [
                    {table_name: 'migrations'},
                    {table_name: 'sessions'}
                ],
                rowCount: 2
            };

        },

        async transaction( /** @type {any} */ transactionHandlerData ){
            const currentDatabaseData = this;
            return transactionHandlerData({
                async query( /** @type {any} */ queryData ){
                    transactionCallsData.push( queryData );
                    //Keeping schema probes on the same connection as legacy conversion
                    return currentDatabaseData.query( queryData );

                }
            });

        }
    };

    assert.equal( await layerDatabaseLegacyMigrate( legacyDatabaseData ), true );
    assert.equal( transactionCallsData[0].text, 'SELECT pg_advisory_xact_lock($1::bigint)' );
    assert.ok( transactionCallsData.some(function( queryData ){
        //Verifying conversion still renames the complete legacy namespace
        return queryData.text.includes( 'ALTER SCHEMA "layer_engine" RENAME TO "layer_social_network"' );

    }) );
    assert.equal( transactionCallsData.some(function migrationTableRenameFind( queryData ){
        return queryData.text.includes( 'RENAME TO "sys_migrations"' );

    }), true );
    assert.equal( transactionCallsData.filter(function migrationChecksumUpdateFind( queryData ){
        return queryData.text.includes( 'SET name = $2, checksum = $3' );

    }).length, 10 );

    const conflictingDatabaseData = {
        ...legacyDatabaseData,
        async query(){
            return {
                rows: [
                    {schema_name: 'layer_engine'},
                    {schema_name: 'layer_social_network'}
                ],
                rowCount: 2
            };

        }
    };

    await assert.rejects(
        function conflictingLegacyMigration(){
            return layerDatabaseLegacyMigrate( conflictingDatabaseData );

        },
        /DATABASE_LEGACY_SCHEMA_CONFLICT/
    );

});

test('migration runner applies foundation under advisory lock', async () => {
    const databaseCalls = /** @type {any[]} */ ([]);
    const transactionCalls = /** @type {any[]} */ ([]);
    const database = {
        kind: /** @type {'postgres'} */ ('postgres'),
        systemSchema: 'layer_test_application',

        async query(/** @type {any} */ queryData) {
            databaseCalls.push(queryData);

            return {
                rows: [],
                rowCount: 0
            };
        },
        async transaction(/** @type {any} */ transactionHandler) {
            return transactionHandler({
                async query(/** @type {any} */ queryData) {
                    transactionCalls.push(queryData);

                    if (queryData.text.includes('SELECT version')) {
                        return {
                            rows: [],
                            rowCount: 0
                        };
                    }

                    return {
                        rows: [],
                        rowCount: 0
                    };
                }
            });
        }
    };

    assert.deepEqual(await layerDatabaseMigrate(database), [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10
    ]);
    assert.equal( databaseCalls.length, 0 );
    assert.equal( transactionCalls[0].text, 'SELECT pg_advisory_xact_lock($1::bigint)' );
    assert.ok( transactionCalls[1].text.includes( 'CREATE SCHEMA' ) );
    assert.ok(transactionCalls.some((queryData) => queryData.text.includes('CREATE TABLE IF NOT EXISTS "layer_test_application"."sys_sessions"')));

    const insertCalls = transactionCalls.filter((queryData) => queryData.text.includes('INSERT INTO "layer_test_application"."sys_migrations"'));

    assert.deepEqual(insertCalls.map((queryData) => queryData.values[0]), [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10
    ]);
    assert.equal(insertCalls[0].values[1], 'foundation');
    assert.equal(insertCalls[1].values[1], 'event-outbox-lease');
    assert.equal(insertCalls[2].values[1], 'security-audit');
    assert.equal(insertCalls[3].values[1], 'runtime-coordination');
    assert.equal(insertCalls[4].values[1], 'auth-foundation');
    assert.equal(insertCalls[5].values[1], 'auth-oauth-account-revocation');
    assert.match(insertCalls[0].values[2], /^[0-9a-f]{64}$/);
    assert.ok(transactionCalls.some((queryData) => queryData.text.includes('lease_owner')));
    assert.ok(transactionCalls.some((queryData) => queryData.text.includes('"layer_test_application"."sys_audit_log"')));
    assert.ok(transactionCalls.some((queryData) => queryData.text.includes('"layer_test_application"."sys_rate_limits"')));
    assert.ok(transactionCalls.some((queryData) => queryData.text.includes('"layer_test_application"."sys_auth_users"')));
    assert.ok(transactionCalls.some((queryData) => queryData.text.includes('"layer_test_application"."sys_auth_oauth_refresh_tokens"')));
    assert.ok(transactionCalls.some((queryData) => queryData.text.includes('account_id_hash')));
});

test('migration runner skips matching migration and rejects checksum drift', async () => {
    const driftDatabase = {
        kind: /** @type {'postgres'} */ ('postgres'),
        systemSchema: 'layer_test_application',

        async query() {
            return {
                rows: [],
                rowCount: 0
            };
        },
        async transaction(/** @type {any} */ transactionHandler) {
            return transactionHandler({
                async query(/** @type {any} */ queryData) {
                    if (queryData.text.includes('SELECT version')) {
                        return {
                            rows: [
                                {
                                    version: 1,
                                    name: 'foundation',
                                    checksum: 'temporary'
                                }
                            ],
                            rowCount: 1
                        };
                    }

                    return {
                        rows: [],
                        rowCount: 0
                    };
                }
            });
        }
    };

    await assert.rejects(() => layerDatabaseMigrate(driftDatabase), /checksum/);

    const appliedRows = /** @type {any[]} */ ([]);
    const captureDatabase = {
        kind: /** @type {'postgres'} */ ('postgres'),
        systemSchema: 'layer_test_application',

        async query() {
            return {
                rows: [],
                rowCount: 0
            };
        },
        async transaction(/** @type {any} */ transactionHandler) {
            return transactionHandler({
                async query(/** @type {any} */ queryData) {
                    if (queryData.text.includes('SELECT version')) {
                        return {
                            rows: appliedRows,
                            rowCount: appliedRows.length
                        };
                    }

                    if (queryData.text.includes('INSERT INTO "layer_test_application"."sys_migrations"')) {
                        appliedRows.push({
                            version: queryData.values[0],
                            name: queryData.values[1],
                            checksum: queryData.values[2]
                        });
                    }

                    return {
                        rows: [],
                        rowCount: 0
                    };
                }
            });
        }
    };

    assert.deepEqual(await layerDatabaseMigrate(captureDatabase), [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10
    ]);
    assert.deepEqual(await layerDatabaseMigrate(captureDatabase), []);
});

test('session repository hashes opaque identifiers and maps safe session data', async () => {
    let capturedQuery = /** @type {any} */ (undefined);
    const repository = layerSessionRepositoryCreate({
        sessionPepper: 'a-secure-session-pepper-with-32-characters',
        database: {
            async query(queryData) {
                capturedQuery = queryData;

                return {
                    rows: [
                        {
                            user_id: 'user-1',
                            tenant_id: null,
                            permissions: [
                                'profile.read'
                            ],
                            csrf_hash: 'csrf-hash',
                            status: 'active',
                            expires_at: '2026-09-18T12:00:00.000Z'
                        }
                    ],
                    rowCount: 1
                };
            }
        }
    });
    const sessionResult = await repository.resolve('opaque-session');
    const expectedHash = createHmac('sha256', 'a-secure-session-pepper-with-32-characters')
        .update('opaque-session', 'utf8')
        .digest('hex');

    assert.ok(capturedQuery);
    assert.ok(sessionResult);
    assert.equal(capturedQuery.values[0], expectedHash);
    assert.equal(capturedQuery.text.includes('$1'), true);
    assert.equal(sessionResult.id, expectedHash);
    assert.equal(sessionResult.userId, 'user-1');
    assert.equal(sessionResult.csrfTokenHash, 'csrf-hash');
    const sessionCacheTagData = `session:${createHash( 'sha256' ).update( 'opaque-session', 'utf8' ).digest( 'hex' )}`;

    assert.equal( repository.cacheTagCreate( 'opaque-session' ), sessionCacheTagData );
    assert.equal( await repository.revoke( 'opaque-session' ), true );
    assert.match( capturedQuery.text, /sys_cache_invalidations/ );
    assert.deepEqual( JSON.parse( capturedQuery.values[1] ), {
        scope: 'global',
        tenantId: null,
        userId: null,
        tags: [sessionCacheTagData]
    });

    assert.throws(() => {
        layerSessionRepositoryCreate({
            sessionPepper: 'short',
            database: {
                async query() {
                    return {
                        rows: [],
                        rowCount: 0
                    };
                }
            }
        });
    }, TypeError);
});

test('session repository returns null for an unknown identifier', async () => {
    const repository = layerSessionRepositoryCreate({
        sessionPepper: 'a-secure-session-pepper-with-32-characters',
        database: {
            async query() {
                return {
                    rows: [],
                    rowCount: 0
                };
            }
        }
    });

    assert.equal(await repository.resolve('missing-session'), null);
});

test('command result repository uses parameterized identity and JSON result', async () => {
    const queryCalls = /** @type {any[]} */ ([]);
    const repository = layerCommandResultRepositoryCreate({
        async query(/** @type {any} */ queryData) {
            queryCalls.push(queryData);

            if (queryData.text.includes('SELECT operation')) {
                return {
                    rows: [
                        {
                            operation: 'chat.message.send',
                            result: {
                                id: 'message-1'
                            }
                        }
                    ],
                    rowCount: 1
                };
            }

            return {
                rows: [],
                rowCount: 1
            };
        }
    });

    assert.deepEqual(await repository.find({
        tenantKey: 'tenant-1',
        commandId: 'command-1'
    }), {
        operation: 'chat.message.send',
        result: {
            id: 'message-1'
        }
    });
    await repository.save({
        tenantKey: 'tenant-1',
        commandId: 'command-1',
        operation: 'chat.message.send',
        result: {
            id: 'message-1'
        }
    });

    assert.match( queryCalls[0].text, /pg_advisory_xact_lock/ );
    assert.deepEqual(queryCalls[1].values, [
        'tenant-1',
        'command-1'
    ]);
    assert.equal(queryCalls[2].values[3], '{"id":"message-1"}');
    assert.deepEqual( queryCalls[2].values.slice( 4 ), [null, null] );
});

test('API key repository issues once, resolves hash state, and revokes immediately', async () => {
    const queryCalls = /** @type {any[]} */ ([]);
    const repository = layerApiKeyRepositoryCreate({
        secretCreate: () => 'layer_deterministic_secret_with_32_bytes_1234',
        database: {
            async query(/** @type {any} */ queryData) {
                queryCalls.push(queryData);

                if (queryData.text.includes('SELECT key_id')) {
                    return {
                        rows: [{
                            key_id: 'integration-1',
                            user_id: 'service-user-1',
                            tenant_id: 'tenant-1',
                            permissions: ['message.send'],
                            status: 'active',
                            expires_at: '2027-01-01T00:00:00.000Z'
                        }],
                        rowCount: 1
                    };
                }

                if (queryData.text.includes('UPDATE')) {
                    return {
                        rows: [{
                            key_hash: String( queryCalls[0].values[0] )
                        }],
                        rowCount: 1
                    };
                }

                return {
                    rows: [],
                    rowCount: 0
                };
            }
        }
    });
    const issuedKey = await repository.issue({
        keyId: 'integration-1',
        userId: 'service-user-1',
        tenantId: 'tenant-1',
        permissions: ['message.send'],
        expiresAt: '2027-01-01T00:00:00.000Z'
    });
    const expectedHash = createHash('sha256')
        .update('layer_deterministic_secret_with_32_bytes_1234', 'utf8')
        .digest('hex');
    const storedHash = queryCalls[0].values[0];

    assert.equal(issuedKey.id, 'integration-1');
    assert.equal(issuedKey.secret, 'layer_deterministic_secret_with_32_bytes_1234');
    assert.equal(typeof storedHash, 'string');
    assert.equal(storedHash.length, 64);
    assert.notEqual(storedHash, issuedKey.secret);
    assert.equal(storedHash, expectedHash);
    assert.equal(queryCalls[0].values[4], '["message.send"]');
    assert.deepEqual(await repository.resolve(storedHash), {
        id: 'integration-1',
        userId: 'service-user-1',
        tenantId: 'tenant-1',
        permissions: ['message.send'],
        status: 'active',
        expiresAt: Date.parse('2027-01-01T00:00:00.000Z')
    });
    assert.equal(await repository.revoke('integration-1'), true);
    assert.match( queryCalls.at( -1 ).text, /sys_cache_invalidations/ );
    assert.deepEqual( JSON.parse( queryCalls.at( -1 ).values[1] ), {
        scope: 'global',
        tenantId: null,
        userId: null,
        tags: [`api-key:${String( storedHash )}`]
    });
    assert.deepEqual( await repository.revokeWithCacheTag( 'integration-1' ), {
        revoked: true,
        cacheTag: `api-key:${String( storedHash )}`
    } );
    assert.equal(await repository.resolve('invalid'), null);
});

test('API key repository revokes every active user key in one transaction', async () => {
    const transactionQueryCalls = /** @type {any[]} */ ([]);
    let transactionCountData = Number( 0 );
    const firstKeyHashData = String( 'a'.repeat( 64 ) );
    const secondKeyHashData = String( 'b'.repeat( 64 ) );
    const repository = layerApiKeyRepositoryCreate({
        database: {
            async query() {
                throw new Error( 'The root database query must not be used for bulk revocation.' );
            },
            async transaction( transactionHandlerData ){
                //Recording that every bulk operation owns one database transaction
                transactionCountData += Number( 1 );

                //Creating the isolated transaction query adapter
                const transactionData = {
                    async query( /** @type {any} */ queryData ){
                        //Recording the ordered statements for contract verification
                        transactionQueryCalls.push( queryData );

                        //Returning active key hashes from the revocation statement
                        if ( queryData.text.includes( 'UPDATE' ) === true ){
                            return {
                                rows: [
                                    {
                                        key_hash: firstKeyHashData
                                    },
                                    {
                                        key_hash: 'invalid-hash'
                                    },
                                    {
                                        key_hash: secondKeyHashData
                                    }
                                ],
                                rowCount: 3
                            };

                        }

                        //Confirming the cache invalidation insert
                        return {
                            rows: [],
                            rowCount: 1
                        };

                    }
                };

                //Executing the repository operation inside this transaction
                return transactionHandlerData( transactionData );

            }
        }
    });

    const revokedKeysCountData = await repository.revokeAllByUser( 'service-user-1' );

    assert.equal( revokedKeysCountData, 3 );
    assert.equal( transactionCountData, 1 );
    assert.equal( transactionQueryCalls.length, 3 );
    assert.match( transactionQueryCalls[0].text, /WHERE user_id = \$1 AND status = 'active'/u );
    assert.deepEqual( transactionQueryCalls[0].values, ['service-user-1'] );

    const invalidationPayloadsData = transactionQueryCalls.slice( 1 ).map(function( queryData ){
        //Getting the persisted invalidation payload without exposing its random event id
        return JSON.parse( queryData.values[1] );

    });

    assert.deepEqual( invalidationPayloadsData, [
        {
            scope: 'global',
            tenantId: null,
            userId: 'service-user-1',
            tags: [`api-key:${String( firstKeyHashData )}`]
        },
        {
            scope: 'global',
            tenantId: null,
            userId: 'service-user-1',
            tags: [`api-key:${String( secondKeyHashData )}`]
        }
    ] );
});

test('API key repository rejects weak issuance and maps misses safely', async () => {
    const repository = layerApiKeyRepositoryCreate({
        secretCreate: () => 'short',
        database: {
            async query() {
                return {rows: [], rowCount: 0};
            }
        }
    });

    await assert.rejects(() => repository.issue({
        keyId: 'integration-1',
        userId: 'service-user-1',
        tenantId: null,
        permissions: [],
        expiresAt: '2027-01-01T00:00:00.000Z'
    }), TypeError);

    const missingRepository = layerApiKeyRepositoryCreate({
        database: {
            async query() {
                return {rows: [], rowCount: 0};
            }
        }
    });
    assert.equal(await missingRepository.resolve('a'.repeat(64)), null);
    assert.throws(() => layerApiKeyRepositoryCreate(/** @type {any} */ ({database: {}})), TypeError);
});

test('audit repository pseudonymizes remote address and stores metadata only', async () => {
    let queryData = /** @type {any} */ (null);
    const repository = layerAuditRepositoryCreate({
        auditPepper: 'a-secure-audit-pepper-with-32-characters',
        idCreate: () => 'audit-1',
        clock: () => new Date('2026-09-18T10:00:00.000Z'),
        database: {
            async query(capturedQueryData) {
                queryData = capturedQueryData;

                return {rows: [], rowCount: 1};
            }
        }
    });
    const auditIdentifier = await repository.record({
        requestId: 'request-1',
        operation: 'chat.message.send',
        category: 'chat-command',
        authenticationType: 'session',
        credentialId: 'session-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        remoteAddress: '203.0.113.10',
        outcome: 'success',
        errorCode: null
    });

    assert.equal(auditIdentifier, 'audit-1');
    assert.ok(queryData.text.includes('"layer_engine"."sys_audit_log"'));
    assert.equal(queryData.values.includes('203.0.113.10'), false);
    assert.match(queryData.values[8], /^[0-9a-f]{64}$/);
    assert.equal(queryData.values[9], 'success');
    assert.equal(queryData.values[11], '2026-09-18T10:00:00.000Z');
    assert.equal(queryData.values.some((/** @type {unknown} */ valueData) => typeof valueData === 'object' && valueData !== null), false);
});

test('audit repository validates pepper, outcome, and clock', async () => {
    assert.throws(() => layerAuditRepositoryCreate(/** @type {any} */ ({
        auditPepper: 'short',
        database: {query() {}}
    })), TypeError);

    const repository = layerAuditRepositoryCreate({
        auditPepper: 'a-secure-audit-pepper-with-32-characters',
        idCreate: () => 'audit-1',
        clock: () => new Date('invalid'),
        database: {
            async query() {
                return {rows: [], rowCount: 1};
            }
        }
    });

    await assert.rejects(() => repository.record(/** @type {any} */ ({
        requestId: 'request-1',
        operation: 'chat.message.send',
        category: 'chat-command',
        authenticationType: 'session',
        credentialId: null,
        userId: null,
        tenantId: null,
        remoteAddress: '127.0.0.1',
        outcome: 'unknown',
        errorCode: null
    })), TypeError);

    await assert.rejects(() => repository.record({
        requestId: 'request-1',
        operation: 'chat.message.send',
        category: 'chat-command',
        authenticationType: 'session',
        credentialId: null,
        userId: null,
        tenantId: null,
        remoteAddress: '127.0.0.1',
        outcome: 'failed',
        errorCode: null
    }), TypeError);
});

test('durable rate limiter locks shared dimensions and persists allowed costs', async () => {
    const bucketStateData = new Map();
    const queryCallsData = /** @type {any[]} */ ([]);
    const databaseData = {
        systemSchema: 'layer_test_application',
        async transaction( /** @type {any} */ transactionHandlerData ){
            return transactionHandlerData({
                async query( /** @type {any} */ queryData ){
                    queryCallsData.push( queryData );
                    const bucketKeyData = String( queryData.values[0] );

                    if ( queryData.text.includes( 'INSERT INTO' ) === true ){
                        if ( bucketStateData.has( bucketKeyData ) === false ){
                            bucketStateData.set( bucketKeyData, {
                                tokens: Number( queryData.values[1] ),
                                updatedAt: Number( queryData.values[2] ),
                                expiresAt: Number( queryData.values[3] )
                            });

                        }

                        return {rows: [], rowCount: 1};

                    }

                    if ( queryData.text.includes( 'FOR UPDATE' ) === true ){
                        const bucketData = bucketStateData.get( bucketKeyData );

                        return {
                            rows: [{
                                tokens: bucketData.tokens,
                                updated_at_ms: bucketData.updatedAt,
                                expires_at_ms: bucketData.expiresAt
                            }],
                            rowCount: 1
                        };

                    }

                    bucketStateData.set( bucketKeyData, {
                        tokens: Number( queryData.values[1] ),
                        updatedAt: Number( queryData.values[2] ),
                        expiresAt: Number( queryData.values[3] )
                    });

                    return {rows: [], rowCount: 1};

                }
            });

        }
    };
    const limiterData = layerDatabaseRateLimiterCreate({
        database: databaseData,
        clock: () => Number( 1000 )
    });
    const rateRequestData = /** @type {const} */ ({
        profile: 'anonymous',
        remoteAddress: '203.0.113.10',
        credentialId: null,
        sessionId: null,
        userId: null,
        tenantId: null,
        operation: 'chat.message.list',
        cost: 5
    });

    assert.deepEqual( await limiterData.consume( rateRequestData ), {
        allowed: true,
        remaining: 35,
        retryAfterMs: 0
    });
    assert.equal( bucketStateData.size, 2 );
    assert.equal( queryCallsData.filter(function lockQueryFind( queryData ){
        return queryData.text.includes( 'FOR UPDATE' );

    }).length, 2 );
    assert.equal( queryCallsData.every(function schemaReferenceCheck( queryData ){
        return queryData.text.includes( 'sys_rate_limits' );

    }), true );

});

test('durable rate limiter denies atomically and refills expired buckets', async () => {
    const bucketStateData = new Map();
    let currentTimeData = Number( 1000 );
    const databaseData = {
        systemSchema: 'layer_test_application',
        async transaction( /** @type {any} */ transactionHandlerData ){
            return transactionHandlerData({
                async query( /** @type {any} */ queryData ){
                    const bucketKeyData = String( queryData.values[0] );

                    if ( queryData.text.includes( 'INSERT INTO' ) === true ){
                        if ( bucketStateData.has( bucketKeyData ) === false ){
                            bucketStateData.set( bucketKeyData, {
                                tokens: Number( queryData.values[1] ),
                                updatedAt: Number( queryData.values[2] ),
                                expiresAt: Number( queryData.values[3] )
                            });

                        }

                        return {rows: [], rowCount: 1};

                    }

                    if ( queryData.text.includes( 'FOR UPDATE' ) === true ){
                        const bucketData = bucketStateData.get( bucketKeyData );

                        return {
                            rows: [{
                                tokens: bucketData.tokens,
                                updated_at_ms: bucketData.updatedAt,
                                expires_at_ms: bucketData.expiresAt
                            }],
                            rowCount: 1
                        };

                    }

                    bucketStateData.set( bucketKeyData, {
                        tokens: Number( queryData.values[1] ),
                        updatedAt: Number( queryData.values[2] ),
                        expiresAt: Number( queryData.values[3] )
                    });

                    return {rows: [], rowCount: 1};

                }
            });

        }
    };
    const limiterData = layerDatabaseRateLimiterCreate({
        database: databaseData,
        profiles: {
            anonymous: {capacity: 2, refillPerMinute: 60},
            session: {capacity: 2, refillPerMinute: 60},
            bearer: {capacity: 2, refillPerMinute: 60},
            'api-key': {capacity: 2, refillPerMinute: 60}
        },
        entryTtlMs: 1000,
        clock: () => currentTimeData
    });
    const requestData = /** @type {const} */ ({
        profile: 'anonymous',
        remoteAddress: '203.0.113.10',
        sessionId: null,
        userId: null,
        tenantId: null,
        operation: 'chat.message.list',
        cost: 2
    });

    assert.equal( (await limiterData.consume( requestData )).allowed, true );
    assert.deepEqual( await limiterData.consume( requestData ), {
        allowed: false,
        remaining: 0,
        retryAfterMs: 2000
    });

    currentTimeData = Number( 2500 );
    assert.equal( (await limiterData.consume( requestData )).allowed, true );
    assert.throws(
        () => layerDatabaseRateLimiterCreate(/** @type {any} */ ({database: {}})),
        TypeError
    );

});

test('cache invalidation repository records scoped tags and replays by cursor', async () => {
    const queryCallsData = /** @type {any[]} */ ([]);
    const repositoryData = layerCacheInvalidationRepositoryCreate({
        database: {
            systemSchema: 'layer_test_application',
            async query( queryData ){
                queryCallsData.push( queryData );

                if ( queryData.text.includes( 'INSERT INTO' ) === true ){
                    return {
                        rows: [{invalidation_id: 7}],
                        rowCount: 1
                    };

                }

                return {
                    rows: [{
                        invalidation_id: 7,
                        event_id: 'command-7',
                        cache_tags: {
                            scope: 'tenant',
                            tenantId: 'tenant-1',
                            userId: null,
                            tags: ['chat-messages']
                        },
                        occurred_at: '2026-09-21T10:00:00.000Z'
                    }],
                    rowCount: 1
                };
            }
        }
    });

    assert.equal( await repositoryData.record({
        eventId: 'command-7',
        scope: 'tenant',
        tenantId: 'tenant-1',
        userId: null,
        tags: ['chat-messages']
    }), 7 );
    assert.match( queryCallsData[0].text, /sys_cache_invalidations/ );
    assert.deepEqual( JSON.parse( queryCallsData[0].values[1] ), {
        scope: 'tenant',
        tenantId: 'tenant-1',
        userId: null,
        tags: ['chat-messages']
    });
    assert.deepEqual( await repositoryData.readAfter({cursor: 6, limit: 10}), [{
        invalidationId: 7,
        eventId: 'command-7',
        occurredAt: '2026-09-21T10:00:00.000Z',
        scope: 'tenant',
        tenantId: 'tenant-1',
        userId: null,
        tags: ['chat-messages']
    }] );
    await assert.rejects(() => repositoryData.record({
        eventId: 'command-8',
        scope: 'user',
        tenantId: null,
        userId: null,
        tags: ['chat-messages']
    }), TypeError);
    await assert.rejects(() => repositoryData.readAfter({cursor: -1}), TypeError);
});

test('cache invalidation repository rejects unsafe identities, tags, and replay bounds', async () => {
    assert.throws(
        () => layerCacheInvalidationRepositoryCreate(/** @type {any} */ ({database: {}})),
        TypeError
    );

    const repositoryData = layerCacheInvalidationRepositoryCreate({
        database: {
            async query(){
                return {
                    rows: [{
                        invalidation_id: 9,
                        event_id: 'command-9',
                        cache_tags: JSON.stringify({
                            scope: 'global',
                            tenantId: null,
                            userId: null,
                            tags: ['system-status']
                        }),
                        occurred_at: new Date( '2026-09-21T11:00:00.000Z' )
                    }],
                    rowCount: 1
                };
            }
        }
    });
    const validBaseData = {
        eventId: 'command-9',
        scope: /** @type {const} */ ('global'),
        tenantId: null,
        userId: null,
        tags: ['system-status']
    };
    const invalidRecordData = [
        {...validBaseData, tags: []},
        {...validBaseData, tags: Array.from({length: 17}, (valueData, indexData) => `tag-${String( indexData )}`)},
        {...validBaseData, tags: ['Invalid Tag']},
        {...validBaseData, tags: ['duplicate', 'duplicate']},
        {...validBaseData, eventId: ''},
        {...validBaseData, eventId: 'x'.repeat( 161 )},
        {...validBaseData, scope: 'unknown'},
        {...validBaseData, scope: 'tenant', tenantId: ''},
        {...validBaseData, scope: 'user', userId: ''}
    ];

    for ( const recordData of invalidRecordData ){
        await assert.rejects(
            () => repositoryData.record(/** @type {any} */ (recordData)),
            TypeError
        );

    }

    assert.deepEqual( await repositoryData.readAfter({cursor: 0}), [{
        invalidationId: 9,
        eventId: 'command-9',
        occurredAt: '2026-09-21T11:00:00.000Z',
        scope: 'global',
        tenantId: null,
        userId: null,
        tags: ['system-status']
    }] );

    for ( const replayData of [
        {cursor: 0.5},
        {cursor: 0, limit: 0},
        {cursor: 0, limit: 1001},
        {cursor: 0, limit: 1.5}
    ] ){
        await assert.rejects(
            () => repositoryData.readAfter(replayData),
            TypeError
        );

    }
});

test('database lease manager acquires, renews, and releases only its owner lease', async () => {
    const queryCallsData = /** @type {any[]} */ ([]);
    const leaseManagerData = layerDatabaseLeaseManagerCreate({
        database: {
            systemSchema: 'layer_test_application',
            async query( queryData ){
                queryCallsData.push( queryData );

                if ( queryData.text.includes( 'DELETE FROM' ) === true ){
                    return {rows: [], rowCount: 1};

                }

                return {
                    rows: [{lease_owner: 'worker-1'}],
                    rowCount: 1
                };
            }
        },
        owner: 'worker-1'
    });

    assert.equal( await leaseManagerData.acquire( 'jobs:email', 5000 ), true );
    assert.equal( await leaseManagerData.renew( 'jobs:email', 5000 ), true );
    assert.equal( await leaseManagerData.release( 'jobs:email' ), true );
    assert.match( queryCallsData[0].text, /ON CONFLICT/ );
    assert.match( queryCallsData[1].text, /lease_owner = \$2/ );
    assert.deepEqual( queryCallsData[2].values, ['jobs:email', 'worker-1'] );
    await assert.rejects(() => leaseManagerData.acquire( 'invalid key', 5000 ), TypeError);
    await assert.rejects(() => leaseManagerData.acquire( 'jobs:email', 999 ), TypeError);
});

test('database lease manager rejects invalid contracts and reports lease contention', async () => {
    assert.throws(
        () => layerDatabaseLeaseManagerCreate(/** @type {any} */ ({database: {}, owner: 'worker-1'})),
        TypeError
    );
    assert.throws(
        () => layerDatabaseLeaseManagerCreate(/** @type {any} */ ({
            database: {query: async () => ({rows: [], rowCount: 0})},
            owner: 'invalid owner'
        })),
        TypeError
    );

    const leaseManagerData = layerDatabaseLeaseManagerCreate({
        database: {
            async query(){
                return {rows: [], rowCount: null};
            }
        },
        owner: 'worker-2'
    });

    assert.equal( await leaseManagerData.acquire( 'jobs:email', 1000 ), false );
    assert.equal( await leaseManagerData.renew( 'jobs:email', 3600000 ), false );
    assert.equal( await leaseManagerData.release( 'jobs:email' ), false );
    await assert.rejects(() => leaseManagerData.renew( 'jobs:email', 3600001 ), TypeError);
    await assert.rejects(() => leaseManagerData.renew( 'jobs:email', 1000.5 ), TypeError);
    await assert.rejects(() => leaseManagerData.release( '' ), TypeError);
});
