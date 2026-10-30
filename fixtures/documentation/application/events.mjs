import {
    layerEventRepositoryCreate,
    layerOutboxRepositoryCreate,
    layerEventStreamManagerCreate,
    layerEventDistributionCreate,
    layerOutboxPublisherCreate,
    layerEventsOpenOperationDefinitionCreate
} from '@solcorp/layer-events';

/** @param {any} launcher @param {any} registry @param {any} diagnostics @returns {Record<string, any>} */
export function messageEventsCreate( launcher, registry, diagnostics ){
    //Keeping the system adapter inside trusted bootstrap, never in an operation payload
    const eventRepository = layerEventRepositoryCreate({database: launcher.databaseRuntime});
    const outboxRepository = layerOutboxRepositoryCreate({database: launcher.databaseRuntime});
    const eventStream = layerEventStreamManagerCreate({eventRepository, diagnostics});
    const eventDistribution = layerEventDistributionCreate({
        eventBus: launcher.eventBus,
        eventRepository,
        streamManager: eventStream,
        diagnostics
    });
    const publisher = layerOutboxPublisherCreate({
        outboxRepository,
        eventBus: launcher.eventBus,
        owner: launcher.workerId
    });

    //Authorizing the exact tenant channel using verified identity, not payload ownership
    registry.define( layerEventsOpenOperationDefinitionCreate({
        permissions: ['messages.read'],
        channelAuthorize: function( channel, security ){
            //Accepting only this verified tenant's exact application channel
            return typeof security.tenantId === 'string' &&
                channel === 'tenant:' + security.tenantId + ':messages';

        }
    }) );

    return {eventRepository, eventStream, eventDistribution, publisher};

}

/** @param {{text: string}} payload @param {any} context */
export async function messageSend( payload, context ){
    //Writing application data through the executor's transaction-bound facade
    const message = await context.database.table( 'messages' ).insert({
        values: {text: payload.text, revision: 1},
        returning: ['id', 'text', 'revision']
    });
    const tenantKey = context.security.tenantId;

    //Appending the domain event and delivery outbox before the same transaction commits
    await context.events.append({
        tenantKey,
        channel: 'tenant:' + tenantKey + ':messages',
        entityRevision: message.revision,
        type: 'message.created',
        payload: message
    });

    return message;

}
