import {layerOfflineOutboxCreate} from '@solcorp/layer-storage';

/** @param {Awaited<ReturnType<typeof import('@solcorp/layer-storage').layerStorageOpen>>} storage @param {any} apiClient */
export function pendingCommandsCreate( storage, apiClient ){
    //Sharing the existing identity namespace and authenticated protocol client
    const outbox = layerOfflineOutboxCreate({
        storage,
        ownerId: globalThis.crypto.randomUUID(),
        commandIdCreate: function(){
            //Creating a fresh identity only for a new intent or resolved conflict
            return globalThis.crypto.randomUUID();

        },
        commandSend: function( command ){
            //Preserving the original command identity during transport retries
            return apiClient.command( command.operation, command.payload, {
                commandId: command.commandId,
                baseRevision: command.baseRevision
            });

        }
    });

    return {
        list: function(){
            //Reading persisted records again after a document restart
            return outbox.list();

        },
        watch: outbox.watch,
        /** @param {string} commandId */
        async retry( commandId ){
            //Retrying existing failed intent without changing its identity
            await outbox.retry( commandId );
            await outbox.drain();
            return outbox.get( commandId );

        },
        /** @param {string} commandId @param {Parameters<ReturnType<typeof layerOfflineOutboxCreate>['resolveConflict']>[1]} resolution */
        async resolve( commandId, resolution ){
            //Replacing conflicted intent only after the user has reviewed current server data
            const replacementId = await outbox.resolveConflict( commandId, resolution );
            await outbox.drain();
            return outbox.get( replacementId );

        },
        cancel: outbox.cancel,
        drain: outbox.drain
    };

}
