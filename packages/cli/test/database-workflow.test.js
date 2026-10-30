import assert from 'node:assert/strict';
import {
    mkdir,
    mkdtemp,
    rm,
    writeFile
} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
    LayerCliError,
    layerConfigValidate,
    layerDatabaseSchemaWorkflowRun
} from '../src/index.js';

const externalConfigurationCreate = function( schemaFileData = 'src/server/database.js' ){
    return layerConfigValidate({
        appName: 'database-workflow',
        database: {
            postgres: [{
                name: 'primary',
                role: 'primary',
                host: '127.0.0.1',
                port: 5432,
                database: 'layer_application',
                username: 'layer_application',
                password: 'development-secret',
                tls: {
                    mode: 'disable'
                }
            }],
            schema: {
                file: schemaFileData,
                synchronization: 'additive'
            }
        }
    });
};

test('database schema workflow loads a project schema and plans through the injected primary', async function(){
    const projectDirectoryData = await mkdtemp( path.join( process.cwd(), '.layer-database-workflow-' ) );
    const schemaDirectoryData = path.join( projectDirectoryData, 'src', 'server' );
    let closeCountData = Number( 0 );
    let connectionFailureData = /** @type {Error | null} */ (null);
    const databaseCreateData = function(
        /** @type {any} */ connectionData,
        /** @type {Record<string, unknown>} */ databaseOptionsData
    ){
        let connectedStatusData = false;

        assert.equal( connectionData.role, 'primary' );
        const databaseData = {
            kind: /** @type {const} */ ('postgres'),
            systemSchema: String( databaseOptionsData.systemSchema ),
            async connect(){
                if ( connectionFailureData !== null ){
                    throw connectionFailureData;

                }

                connectedStatusData = true;
            },
            async query( /** @type {any} */ queryData ){
                if ( String( queryData.text ).includes( 'pg_is_in_recovery' ) === true ){
                    return {rows: [{in_recovery: false}], rowCount: 1};

                }

                return {rows: [], rowCount: 0};
            },
            async transaction( /** @type {any} */ handlerData ){
                return handlerData( databaseData );
            },
            async healthCheck(){
                return connectedStatusData;
            },
            async close(){
                closeCountData += Number( 1 );
            },
            isReady(){
                return connectedStatusData;
            }
        };

        return databaseData;
    };

    try {
        await mkdir( schemaDirectoryData, {recursive: true} );
        await writeFile(
            path.join( schemaDirectoryData, 'database.js' ),
            [
                "import {layerDatabaseSchemaDefine} from '@solcorp/layer-database';",
                'export const databaseSchema = layerDatabaseSchemaDefine([]);',
                ''
            ].join( '\n' ),
            'utf8'
        );

        const workflowResultData = await layerDatabaseSchemaWorkflowRun({
            rootDirectory: projectDirectoryData,
            config: externalConfigurationCreate(),
            action: 'plan',
            databaseCreate: databaseCreateData
        });

        const planData = /** @type {any} */ (workflowResultData);

        assert.equal( typeof planData.checksum, 'string' );
        assert.equal( planData.blocking, false );
        assert.deepEqual( planData.changes, [] );
        assert.equal( closeCountData, 1 );

        assert.deepEqual( await layerDatabaseSchemaWorkflowRun({
            rootDirectory: projectDirectoryData,
            config: externalConfigurationCreate(),
            action: 'apply',
            checksum: planData.checksum,
            confirmDataLoss: true,
            databaseCreate: databaseCreateData
        }), {
            checksum: planData.checksum,
            statements: 0
        } );
        assert.equal( closeCountData, 2 );

        await assert.rejects(
            () => layerDatabaseSchemaWorkflowRun({
                rootDirectory: projectDirectoryData,
                config: externalConfigurationCreate(),
                action: 'apply',
                checksum: 'invalid',
                confirmDataLoss: true,
                databaseCreate: databaseCreateData
            }),
            function schemaApplyErrorCheck( errorData ){
                return (
                    errorData instanceof LayerCliError &&
                    errorData.code === 'DATABASE_SCHEMA_CHECKSUM_INVALID'
                );
            }
        );
        assert.equal( closeCountData, 3 );

        connectionFailureData = new Error( 'Primary connection failed.' );
        await assert.rejects(
            () => layerDatabaseSchemaWorkflowRun({
                rootDirectory: projectDirectoryData,
                config: externalConfigurationCreate(),
                action: 'plan',
                databaseCreate: databaseCreateData
            }),
            /Primary connection failed/
        );

        connectionFailureData = new LayerCliError(
            'DATABASE_OPERATOR_FAILURE',
            'Database operator rejected the workflow.'
        );
        await assert.rejects(
            () => layerDatabaseSchemaWorkflowRun({
                rootDirectory: projectDirectoryData,
                config: externalConfigurationCreate(),
                action: 'plan',
                databaseCreate: databaseCreateData
            }),
            function cliWorkflowErrorCheck( errorData ){
                return (
                    errorData instanceof LayerCliError &&
                    errorData.code === 'DATABASE_OPERATOR_FAILURE'
                );
            }
        );

    } finally {
        await rm( projectDirectoryData, {recursive: true, force: true} );

    }
});

test('database schema workflow fails closed for escaped, missing, and invalid modules', async function(){
    const projectDirectoryData = await mkdtemp( path.join( process.cwd(), '.layer-database-workflow-invalid-' ) );
    const schemaDirectoryData = path.join( projectDirectoryData, 'src', 'server' );

    try {
        await assert.rejects(
            () => layerDatabaseSchemaWorkflowRun({
                rootDirectory: projectDirectoryData,
                config: layerConfigValidate({appName: 'embedded-workflow'}),
                action: 'plan'
            }),
            function embeddedWorkflowErrorCheck( errorData ){
                return (
                    errorData instanceof LayerCliError &&
                    errorData.code === 'APPLICATION_DATABASE_REQUIRED'
                );
            }
        );

        await mkdir( schemaDirectoryData, {recursive: true} );
        await writeFile(
            path.join( schemaDirectoryData, 'invalid.js' ),
            'export const databaseSchema = Object.freeze({tables: []});\n',
            'utf8'
        );

        const validConfigurationData = externalConfigurationCreate();
        const escapedConfigurationData = {
            ...validConfigurationData,
            database: {
                ...validConfigurationData.database,
                schema: {
                    ...validConfigurationData.database.schema,
                    file: '../outside.js'
                }
            }
        };
        const failureCaseData = [{
            configuration: escapedConfigurationData,
            code: 'CLI_DATABASE_SCHEMA_INVALID'
        }, {
            configuration: externalConfigurationCreate( 'src/server/missing.js' ),
            code: 'CLI_DATABASE_SCHEMA_LOAD_FAILED'
        }, {
            configuration: externalConfigurationCreate( 'src/server/invalid.js' ),
            code: 'CLI_DATABASE_SCHEMA_INVALID'
        }];

        for ( const failureData of failureCaseData ){
            await assert.rejects(
                () => layerDatabaseSchemaWorkflowRun({
                    rootDirectory: projectDirectoryData,
                    config: failureData.configuration,
                    action: 'plan'
                }),
                function workflowErrorCheck( errorData ){
                    return (
                        errorData instanceof LayerCliError &&
                        errorData.code === failureData.code
                    );
                }
            );

        }

    } finally {
        await rm( projectDirectoryData, {recursive: true, force: true} );

    }
});
