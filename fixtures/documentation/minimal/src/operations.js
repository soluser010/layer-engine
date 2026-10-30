import {layerOperationContractsCreate} from '@solcorp/layer';

export const operations = layerOperationContractsCreate([
    {
        name: 'status.public.read',
        type: 'query',
        auth: 'none',
        inputSchema: {
            type: 'object',
            additionalProperties: false
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['status'],
            properties: {
                status: {
                    type: 'string',
                    const: 'ok'
                }
            }
        }
    }
]);
