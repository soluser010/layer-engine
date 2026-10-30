import {layerDatabaseSchemaDefine, layerTableDefine} from '@solcorp/layer-database';
import {LayerError} from '@solcorp/layer-protocol';

export const databaseSchema = layerDatabaseSchemaDefine([
    layerTableDefine({
        name: 'messages',
        scope: 'tenant',
        primaryKey: 'id',
        columns: {
            id: {type: 'uuid', generated: 'uuid'},
            text: {type: 'string'},
            revision: {type: 'integer'}
        }
    })
]);

/**
 * @param {{id: string, text: string, baseRevision: number}} payload
 * @param {{database: ReturnType<typeof import('@solcorp/layer-database').layerDatabaseFacadeCreate>}} context
 */
export async function messageEdit( payload, context ){
    //Combining ownership and revision checks in the same atomic UPDATE
    const database = context.database;
    const messages = await database.table( 'messages' ).update({
        values: {text: payload.text, revision: payload.baseRevision + 1},
        where: database.where.and(
            database.where.equal( 'id', payload.id ),
            database.where.equal( 'revision', payload.baseRevision )
        ),
        returning: ['id', 'text', 'revision']
    });

    //Reporting the same safe conflict for missing, inaccessible or changed records
    if ( messages.length !== 1 ){
        throw new LayerError( 'REVISION_CONFLICT', 'Reload the message before editing.', {status: 409} );

    }

    return messages[0];

}
