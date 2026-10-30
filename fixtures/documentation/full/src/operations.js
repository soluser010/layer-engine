import {layerOperationContractsCreate} from '@solcorp/layer';

export const operations = layerOperationContractsCreate([
    {
        name: 'chat.message.send',
        type: 'command',
        auth: 'session',
        permissions: ['chat.message.send'],
        rateLimitBucket: 'chat.write',
        cost: 2,
        timeoutMs: 15000,
        concurrency: 16,
        transaction: true,
        offlineReplay: true,
        audit: {
            enabled: true,
            category: 'chat-command'
        },
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['commandId', 'roomId', 'text', 'baseRevision'],
            properties: {
                commandId: {
                    type: 'string',
                    format: 'uuid'
                },
                roomId: {
                    type: 'string',
                    format: 'uuid'
                },
                text: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 4000
                },
                baseRevision: {
                    type: 'integer',
                    minimum: 0
                }
            }
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['messageId', 'revision'],
            properties: {
                messageId: {
                    type: 'string',
                    format: 'uuid'
                },
                revision: {
                    type: 'integer',
                    minimum: 1
                }
            }
        }
    }
]);
