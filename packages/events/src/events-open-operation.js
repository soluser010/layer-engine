import {
    LAYER_ERROR_CODES,
    LayerError
} from '@solcorp/layer-protocol';

/**
 * @param {object} operationOptions
 * @param {(channelName: string, securityContext: Readonly<Record<string, unknown>>) => boolean | Promise<boolean>} operationOptions.channelAuthorize
 * @param {readonly string[]} [operationOptions.permissions]
 */
export function layerEventsOpenOperationDefinitionCreate(operationOptions) {
    return {
        name: 'system.events.open',
        type: /** @type {const} */ ('events.open'),
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: [
                'channels'
            ],
            properties: {
                channels: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 50,
                    uniqueItems: true,
                    items: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 160,
                        pattern: '^[a-zA-Z0-9:_-]+$'
                    }
                }
            }
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: [
                'tenantKey',
                'userId',
                'channels'
            ],
            properties: {
                tenantKey: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 160
                },
                userId: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 160
                },
                channels: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 50,
                    uniqueItems: true,
                    items: {
                        type: 'string'
                    }
                }
            }
        },
        auth: /** @type {const} */ ('session'),
        permissions: operationOptions.permissions ?? [],
        rateLimitBucket: 'events.open',
        cost: 5,
        timeoutMs: 10000,
        concurrency: 3,
        transaction: false,
        offlineReplay: false,
        audit: {
            enabled: false,
            category: 'events'
        },
        async handler(
            /** @type {unknown} */ payloadData,
            /** @type {unknown} */ handlerContext
        ) {
            const typedPayload = /** @type {{channels: string[]}} */ (payloadData);
            const typedContext = /** @type {{security: Readonly<Record<string, unknown>>}} */ (handlerContext);
            const securityContext = typedContext.security;
            const userIdentifier = securityContext.userId;
            const tenantIdentifier = securityContext.tenantId;

            //Requiring server-resolved identity before authorizing channels.
            if (typeof userIdentifier !== 'string') {
                throw new LayerError(LAYER_ERROR_CODES.AUTH_REQUIRED, 'Authentication is required.', {
                    status: 401
                });

            }

            let tenantKey = userIdentifier;

            if (typeof tenantIdentifier === 'string') {
                tenantKey = tenantIdentifier;

            }

            const authorizedChannels = [];

            //Authorizing each exact channel without accepting payload identity or wildcards.
            for (const channelName of typedPayload.channels) {
                if (!await operationOptions.channelAuthorize(channelName, securityContext)) {
                    throw new LayerError(LAYER_ERROR_CODES.OBJECT_ACCESS_DENIED, 'An event channel is not permitted.', {
                        status: 403
                    });

                }

                authorizedChannels.push(channelName);

            }

            return {
                tenantKey,
                userId: userIdentifier,
                channels: authorizedChannels
            };

        }
    };

}
