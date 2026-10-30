import {layerStorageOpen, layerStorageSchemaDefine} from '@solcorp/layer-storage';

export const draftSchema = layerStorageSchemaDefine({
    name: 'message-drafts',
    version: 2,
    stores: {
        drafts: {
            keyPath: 'id',
            indexes: {by_room: {keyPath: 'roomId'}}
        }
    },
    migrations: {
        1: function( /** @type {{createStore: (name: string) => void}} */ migration ){
            //Creating the store during the first synchronous upgrade
            migration.createStore( 'drafts' );

        },
        2: function( /** @type {{createIndex: (store: string, index: string) => void}} */ migration ){
            //Adding the declared index for existing version-one databases
            migration.createIndex( 'drafts', 'by_room' );

        }
    }
});

/** @param {string} namespace @param {IDBFactory} [indexedDb] @returns {ReturnType<typeof layerStorageOpen>} */
export async function draftStorageOpen( namespace, indexedDb = globalThis.indexedDB ){
    //Opening a separate identity namespace chosen from authenticated application state
    return layerStorageOpen({
        appId: 'chat',
        namespace,
        schema: draftSchema,
        indexedDb
    });

}

/** @param {Awaited<ReturnType<typeof layerStorageOpen>>} storage @param {{id: string, roomId: string, text: string}} draft */
export async function draftSave( storage, draft ){
    //Keeping all reads and writes inside one IndexedDB transaction
    return storage.transaction( ['drafts'], 'readwrite', async function( transaction ){
        //Reading back the value from the same write transaction
        await transaction.put( 'drafts', draft );
        return transaction.get( 'drafts', draft.id );

    });

}
