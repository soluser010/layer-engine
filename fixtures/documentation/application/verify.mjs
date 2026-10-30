import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {layerDatabaseFacadeCreate} from '@solcorp/layer-database';
import {layerPwaCapabilitiesCreate} from '@solcorp/layer-pwa';
import {layerOfflineOutboxCreate} from '@solcorp/layer-storage';
import {layerApplicationApiCreate} from '@solcorp/layer-runtime';
import {layerCommitWait, store, effect} from '@solcorp/layer-render';
import {layerOperationRegistryCreate} from '@solcorp/layer-server';
import {databaseSchema, messageEdit} from './database.mjs';
import {draftStorageOpen, draftSave} from './storage.mjs';
import {unreadBadgeApply} from './pwa.mjs';
import {pendingCommandsCreate} from './outbox.mjs';
import {messageEventsCreate, messageSend} from './events.mjs';

export async function applicationExamplesVerify(){
    const messageId = '00000000-0000-4000-8000-000000000001';
    const queryCalls = /** @type {any[]} */ ([]);
    let resultRows = [{id: messageId, text: 'Edited', revision: 2}];
    const adapter = {
        kind: /** @type {const} */ ('postgres'),
        systemSchema: 'layer_documentation',
        async query( /** @type {any} */ query ){
            //Inspecting generated SQL without pretending this is a PostgreSQL integration test
            queryCalls.push( query );
            return {rows: resultRows, rowCount: resultRows.length};

        }
    };
    const database = layerDatabaseFacadeCreate({
        database: adapter,
        schema: databaseSchema,
        security: {tenantId: 'tenant-a', userId: 'user-a'}
    });

    //Running the exact documented edit function through the actual CRUD compiler
    const edited = await messageEdit({id: messageId, text: 'Edited', baseRevision: 1}, {database});
    assert.equal( edited?.revision, 2 );
    assert.ok( queryCalls[0].values.includes( 'tenant-a' ) );
    assert.ok( queryCalls[0].text.includes( '"sys_tenant_id"' ) );
    assert.equal( queryCalls[0].text.includes( 'Edited' ), false );
    resultRows = [];
    await assert.rejects(
        messageEdit({id: messageId, text: 'Stale', baseRevision: 1}, {database}),
        {code: 'REVISION_CONFLICT', status: 409}
    );

    //Opening and reopening the documented schema with an isolated IndexedDB implementation
    const indexedDb = new IDBFactory();
    let storage = /** @type {any} */ (await draftStorageOpen( 'user-a', indexedDb ));
    await draftSave( storage, {id: 'draft-1', roomId: 'room-1', text: 'Hello'} );
    assert.equal( (await storage.query( 'drafts', {index: 'by_room', query: 'room-1'} )).length, 1 );
    await assert.rejects( storage.transaction( ['drafts'], 'readwrite', async function( /** @type {any} */ transaction ){
        //Proving an exception rolls back the complete local write
        await transaction.put( 'drafts', {id: 'discarded', roomId: 'room-1'} );
        throw new Error( 'Rollback example' );

    }), {code: 'STORAGE_TRANSACTION_FAILED'} );
    assert.equal( await storage.get( 'drafts', 'discarded' ), undefined );
    storage.close();
    storage = await draftStorageOpen( 'user-a', indexedDb );
    assert.equal( (await storage.get( 'drafts', 'draft-1' )).text, 'Hello' );
    const otherStorage = await draftStorageOpen( 'user-b', indexedDb );
    assert.equal( await otherStorage.get( 'drafts', 'draft-1' ), undefined );

    //Recovering a persisted conflict without inventing an acknowledgement API
    let shouldConflict = true;
    let commandSequence = 0;
    const outbox = layerOfflineOutboxCreate({
        storage,
        ownerId: 'documentation',
        commandIdCreate: function(){
            //Providing deterministic unique command identities for this fixture
            commandSequence += 1;
            return 'command-' + commandSequence;

        },
        commandSend: async function(){
            //Exercising the same HTTP conflict classification used by the runtime
            if ( shouldConflict ){
                throw {code: 'REVISION_CONFLICT', status: 409};

            }

            return {id: messageId, revision: 3};

        }
    });
    const queued = await outbox.queue({
        operation: 'chat.message.edit',
        payload: {id: messageId, text: 'Pending'},
        baseRevision: 1,
        conflictDomain: 'message:' + messageId
    });
    await outbox.drain();
    assert.equal( (await outbox.list({statuses: ['conflict']})).length, 1 );
    shouldConflict = false;
    const replacement = await outbox.resolveConflict( queued.commandId, {
        operation: 'chat.message.edit',
        payload: {id: messageId, text: 'Merged'},
        baseRevision: 2,
        conflictDomain: 'message:' + messageId
    });
    await outbox.drain();
    assert.equal( (await outbox.get( replacement ))?.status, 'confirmed' );
    assert.equal( (await outbox.get( queued.commandId ))?.status, 'resolved' );
    const pending = pendingCommandsCreate( storage, {
        async command(){
            //Providing the already authenticated protocol boundary to the documented panel
            return {data: {id: messageId}};

        }
    });
    assert.equal( (await pending.list()).length, 2 );
    await pending.drain();

    //Checking the documented trusted channel predicate against two distinct tenants
    const registry = layerOperationRegistryCreate();
    const eventServices = messageEventsCreate({
        databaseRuntime: adapter,
        eventBus: {},
        workerId: 'documentation'
    }, registry, {record: function(){
        //Ignoring fixture diagnostics without inspecting application data
        return;

    }});
    assert.equal( typeof eventServices.publisher.runOnce, 'function' );
    const eventsOpen = registry.get( 'system.events.open' );
    assert.ok( eventsOpen );
    const authorized = /** @type {any} */ (await eventsOpen.handler(
        {channels: ['tenant:A:messages']},
        {security: {tenantId: 'A', userId: 'alice'}}
    ));
    assert.equal( authorized.tenantKey, 'A' );
    await assert.rejects( Promise.resolve( eventsOpen.handler(
        {channels: ['tenant:B:messages']},
        {security: {tenantId: 'A', userId: 'alice'}}
    )), {code: 'OBJECT_ACCESS_DENIED'} );
    resultRows = [{id: messageId, text: 'Sent', revision: 1}];
    const appended = /** @type {any[]} */ ([]);
    await messageSend( {text: 'Sent'}, {
        database,
        security: {tenantId: 'tenant-a'},
        events: {append: async function( /** @type {any} */ event ){
            //Checking the operation derives routing identity from its trusted context
            appended.push( event );

        }}
    });
    assert.equal( appended[0].channel, 'tenant:tenant-a:messages' );

    //Applying all four local cache methods against an actual application API instance
    const api = layerApplicationApiCreate({
        queryRequest: async function(){
            //Returning the collection shape documented for this query
            return {data: {items: []}};

        },
        commandRun: async function(){
            //Failing if a cache-only fixture unexpectedly sends a command
            throw new Error( 'Not used' );

        },
        syncRun: async function(){
            //Providing an empty snapshot for the required integration boundary
            return {data: {}};

        },
        queryCacheGet: storage.queryCache.get,
        queryCachePut: storage.queryCache.put
    });
    const query = /** @type {any} */ (api.query({operation: 'chat.messages.list', payload: {}}));
    await query.settled();
    await api.queryCache.insert( query.cacheKey, {id: 'pending', commandId: 'optimistic-1'} );
    assert.equal( query.snapshot().data.items.length, 1 );
    await api.queryCache.update( query.cacheKey, function( /** @type {any} */ current ){
        //Replacing a collection immutably as required by the documented updater
        return {...current, count: current.items.length};

    });
    assert.equal( query.snapshot().data.count, 1 );
    await api.queryCache.removeByCommandId( 'optimistic-1' );
    assert.equal( query.snapshot().data.items.length, 0 );
    await api.queryCache.insert( query.cacheKey, {id: 'confirmed'} );
    await api.queryCache.remove( query.cacheKey, function( /** @type {any} */ item ){
        //Removing only the selected record from this active query
        return item.id === 'confirmed';

    });
    assert.equal( query.snapshot().data.items.length, 0 );
    api.dispose();

    //Checking actual capability wrappers with controlled platform methods
    const badges = /** @type {unknown[]} */ ([]);
    const pwa = layerPwaCapabilitiesCreate({
        navigator: /** @type {Navigator} */ (/** @type {unknown} */ ({
            setAppBadge: async function( /** @type {number | undefined} */ count ){
                //Recording the requested platform badge count
                badges.push( count );

            },
            clearAppBadge: async function(){
                //Recording explicit platform badge removal
                badges.push( 'cleared' );

            }
        }))
    });
    assert.deepEqual( await unreadBadgeApply( pwa, 3 ), {applied: true} );
    assert.deepEqual( await unreadBadgeApply( pwa, 0 ), {applied: true} );
    assert.deepEqual( badges, [3, 'cleared'] );
    assert.equal( (await unreadBadgeApply( layerPwaCapabilitiesCreate(), 3 )).reason, 'unavailable' );

    //Showing shallow store updates and cleanup without claiming deep proxy observation
    const state = store(/** @type {{profile: {name: string}, note?: string}} */ ({profile: {name: 'First'}, note: 'draft'}));
    const observations = /** @type {unknown[]} */ ([]);
    let cleanupCount = 0;
    const dispose = effect(function(){
        //Reading concrete fields, including a field that may later be deleted
        observations.push( [state.profile.name, state.note] );
        return function(){
            //Releasing the previous effect lifetime before its next execution
            cleanupCount += 1;

        };

    });
    state.profile.name = 'Untracked';
    await layerCommitWait();
    assert.equal( observations.length, 1 );
    state.profile = {name: 'Tracked'};
    delete state.note;
    await layerCommitWait();
    assert.deepEqual( observations.at( -1 ), ['Tracked', undefined] );
    dispose();
    assert.equal( cleanupCount, 2 );
    await otherStorage.purgeUserData();
    await storage.purgeUserData();

    return true;

}
