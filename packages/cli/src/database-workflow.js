import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {
    layerDatabaseLegacyMigrate,
    layerDatabaseMigrate,
    layerDatabaseSchemaApply,
    layerDatabaseSchemaDefinitionCheck,
    layerDatabaseSchemaPlan
} from '@solcorp/layer-database';
import {layerInfrastructureDatabaseRuntimeCreate} from './application-server-runtime.js';
import {LayerCliError} from './cli-error.js';

/**
 * @param {string} rootDirectoryData
 * @param {Readonly<Record<string, any>>} configurationData
 */
async function databaseSchemaLoad( rootDirectoryData, configurationData ){
    const schemaFileData = path.resolve(
        rootDirectoryData,
        configurationData.database.schema.file
    );
    const relativeSchemaFileData = path.relative( rootDirectoryData, schemaFileData );

    if (
        relativeSchemaFileData.startsWith( '..' ) === true ||
        path.isAbsolute( relativeSchemaFileData ) === true
    ){
        throw new LayerCliError( 'CLI_DATABASE_SCHEMA_INVALID', 'Database schema file escaped the application project.' );

    }

    let schemaModuleData;

    try {
        schemaModuleData = await import(
            `${pathToFileURL( schemaFileData ).href}?layer-schema=${String( Date.now() )}`
        );

    } catch {
        throw new LayerCliError( 'CLI_DATABASE_SCHEMA_LOAD_FAILED', 'Database schema module could not be loaded.' );

    }

    if ( layerDatabaseSchemaDefinitionCheck( schemaModuleData.databaseSchema ) === false ){
        throw new LayerCliError( 'CLI_DATABASE_SCHEMA_INVALID', 'Database schema module must export databaseSchema.' );

    }

    return schemaModuleData.databaseSchema;

}

/**
 * @param {object} workflowOptionsData
 * @param {string} workflowOptionsData.rootDirectory
 * @param {Readonly<Record<string, any>>} workflowOptionsData.config
 * @param {'plan' | 'apply'} workflowOptionsData.action
 * @param {string} [workflowOptionsData.checksum]
 * @param {boolean} [workflowOptionsData.confirmDataLoss]
 * @param {(connectionData: any, databaseOptionsData: Record<string, unknown>) => any} [workflowOptionsData.databaseCreate]
 */
export async function layerDatabaseSchemaWorkflowRun( workflowOptionsData ){
    const rootDirectoryData = path.resolve( workflowOptionsData.rootDirectory );
    const configurationData = workflowOptionsData.config;

    if ( Number( configurationData.database.postgres.length ) === Number( 0 ) ){
        throw new LayerCliError(
            'APPLICATION_DATABASE_REQUIRED',
            'Database schema commands require an external PostgreSQL primary.'
        );

    }

    const databaseSchemaData = await databaseSchemaLoad( rootDirectoryData, configurationData );
    const stateDirectoryData = path.resolve(
        process.env.LAYER_STATE_DIRECTORY ?? path.join( rootDirectoryData, '.layer', 'state' )
    );
    const databaseRuntimeOptionsData = /** @type {any} */ ({
        rootDirectory: rootDirectoryData,
        stateDirectory: stateDirectoryData,
        configuration: configurationData,
        databaseSchema: databaseSchemaData,
        workerId: 'schema-operator'
    });

    if ( workflowOptionsData.databaseCreate !== undefined ){
        databaseRuntimeOptionsData.databaseCreate = workflowOptionsData.databaseCreate;

    }

    const databaseRuntimeData = await layerInfrastructureDatabaseRuntimeCreate(databaseRuntimeOptionsData);

    try {
        //Preparing system metadata before reading or applying application schema changes
        await databaseRuntimeData.connect();
        await layerDatabaseLegacyMigrate( databaseRuntimeData );
        await layerDatabaseMigrate( databaseRuntimeData );

        if ( workflowOptionsData.action === 'plan' ){
            return await layerDatabaseSchemaPlan({
                database: /** @type {any} */ (databaseRuntimeData),
                schema: databaseSchemaData
            });

        }

        return await layerDatabaseSchemaApply({
            database: /** @type {any} */ (databaseRuntimeData),
            schema: databaseSchemaData,
            checksum: String( workflowOptionsData.checksum ?? String() ),
            confirmDataLoss: workflowOptionsData.confirmDataLoss === true
        });

    } catch( databaseErrorData ){
        if ( databaseErrorData instanceof LayerCliError ){
            throw databaseErrorData;

        }

        const errorCodeData = /** @type {{code?: unknown}} */ (databaseErrorData)?.code;

        if ( typeof errorCodeData === 'string' ){
            throw new LayerCliError( errorCodeData, 'Database schema workflow failed.' );

        }

        throw databaseErrorData;

    } finally {
        await databaseRuntimeData.close();

    }

}
