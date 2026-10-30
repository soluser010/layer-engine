import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LayerCliError,
    layerOperationFacadeCreate
} from '../src/index.js';

test('generates deterministic typed query, command, and sync facades', function(){
    const facadeData = layerOperationFacadeCreate([
        {
            name: 'chat.messages.list',
            type: 'query',
            inputSchema: {
                type: 'object',
                additionalProperties: false,
                required: ['conversationId'],
                properties: {
                    conversationId: {
                        type: 'string'
                    }
                }
            },
            outputSchema: {
                type: 'array',
                items: {
                    type: 'string'
                }
            }
        },
        {
            name: 'chat.message.send',
            type: 'command',
            inputSchema: true,
            outputSchema: true
        },
        {
            name: 'chat.snapshot.sync',
            type: 'sync',
            inputSchema: true,
            outputSchema: true
        }
    ]);

    assert.match(facadeData.runtimeSource, /chatMessagesListQueryCreate/);
    assert.match(facadeData.runtimeSource, /chatMessageSendCommandCreate/);
    assert.match(facadeData.runtimeSource, /chatSnapshotSync/);
    assert.match(facadeData.declarationSource, /conversationId/);
    assert.match(facadeData.declarationSource, /readonly \(string\)\[\]/);
    assert.match(facadeData.declarationSource, /Creates a reactive query handle for chat[.]messages[.]list/u);
    assert.match(facadeData.declarationSource, /Persistent query-cache policy/u);
    assert.match(facadeData.declarationSource, /Cancels work, detaches listeners/u);
    assert.equal(JSON.parse(facadeData.manifestSource).length, 3);
});

test('does not duplicate the conventional sync suffix', function(){
    //Generating a domain operation whose last name segment already declares sync.
    const facadeData = layerOperationFacadeCreate([{
        name: 'chat.state.sync',
        type: 'sync',
        inputSchema: {type: 'object'},
        outputSchema: {type: 'object'}
    }]);

    assert.match(facadeData.runtimeSource, /export function chatStateSync\(/);
    assert.doesNotMatch(facadeData.runtimeSource, /chatStateSyncSync/);
});

test('rejects generated export collisions', function(){
    assert.throws(function operationCollisionCreate(){
        layerOperationFacadeCreate([
            {
                name: 'chat.message.send',
                type: 'query',
                inputSchema: true,
                outputSchema: true
            },
            {
                name: 'chat.message.send',
                type: 'query',
                inputSchema: true,
                outputSchema: true
            }
        ]);

    }, function collisionErrorCheck(errorData){
        return errorData instanceof LayerCliError && errorData.code === 'CLI_OPERATION_EXPORT_COLLISION';

    });
});

test('generates declaration variants for complete JSON Schema scalar and union shapes', function(){
    const facadeData = layerOperationFacadeCreate([
        {
            name: 'schema.variant.query',
            type: 'query',
            inputSchema: {
                type: 'object',
                required: ['mode'],
                properties: {
                    mode: {
                        enum: ['compact', 'complete']
                    },
                    enabled: {
                        type: 'boolean'
                    },
                    count: {
                        type: ['integer', 'null']
                    },
                    fixed: {
                        const: 7
                    },
                    choice: {
                        oneOf: [
                            {type: 'string'},
                            {type: 'number'}
                        ]
                    }
                },
                additionalProperties: {
                    type: 'string'
                }
            },
            outputSchema: {
                anyOf: [
                    false,
                    true
                ]
            }
        },
        {
            name: 'schema.empty.sync',
            type: 'sync',
            inputSchema: {
                type: 'object',
                additionalProperties: false
            },
            outputSchema: {
                type: 'null'
            }
        },
        {
            name: 'schema.command.send',
            type: 'command',
            inputSchema: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'commandId',
                    'title'
                ],
                properties: {
                    commandId: {
                        type: 'string'
                    },
                    title: {
                        type: 'string'
                    }
                }
            },
            outputSchema: {
                type: 'number'
            }
        }
    ]);

    assert.match(facadeData.declarationSource, /"compact" \| "complete"/);
    assert.match(facadeData.declarationSource, /number \| null/);
    assert.match(facadeData.declarationSource, /string \| number/);
    assert.match(facadeData.declarationSource, /never \| unknown/);
    assert.match(facadeData.declarationSource, /Readonly<Record<string, never>>/);
    assert.doesNotMatch(
        facadeData.declarationSource.match(/export type SchemaCommandSendInput = .*;/)?.[0] ?? '',
        /commandId/
    );
    assert.match(facadeData.declarationSource, /readonly "title": string/);
});

test('rejects a non-array operation facade input', function(){
    assert.throws(function invalidFacadeCreate(){
        layerOperationFacadeCreate(/** @type {any} */ ({}));

    }, function invalidFacadeErrorCheck(errorData){
        return errorData instanceof LayerCliError && errorData.code === 'CLI_OPERATION_CONTRACT_INVALID';

    });
});
