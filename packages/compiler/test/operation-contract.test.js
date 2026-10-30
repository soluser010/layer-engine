import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LayerCompilerError,
    layerOperationContractsCompile
} from '../src/index.js';

const operationSource = `
import {layerOperationContractsCreate as contractsCreate} from '@solcorp/layer';

export const operations = contractsCreate([
    {
        name: 'article.list',
        type: 'query',
        auth: 'none',
        inputSchema: {
            type: 'object',
            additionalProperties: false
        },
        outputSchema: {
            type: 'array',
            items: {
                type: 'string'
            }
        }
    }
]);
`;

test('compiles static operation contracts without executing the module', function(){
    const operationList = layerOperationContractsCompile(operationSource, {
        file: 'src/operations.js'
    });

    assert.equal(operationList.length, 1);
    assert.equal(operationList[0]?.name, 'article.list');
    assert.equal(operationList[0]?.type, 'query');
    assert.equal(Object.isFrozen(operationList), true);
    assert.equal(Object.isFrozen(operationList[0]), true);
});

test('rejects executable, duplicate, and unsupported operation contracts', function(){
    const invalidSourceList = [
        operationSource.replace("type: 'query'", "type: 'events.open'"),
        operationSource.replace('inputSchema: {', 'handler() {},\n        inputSchema: {'),
        operationSource.replace(']);', `,
    {
        name: 'article.list',
        type: 'query',
        inputSchema: true,
        outputSchema: true
    }
]);`),
        operationSource.replace("auth: 'none'", 'auth: globalThis.operationAuth')
    ];

    for (const invalidSource of invalidSourceList) {
        assert.throws(function invalidOperationCompile(){
            layerOperationContractsCompile(invalidSource, {
                file: 'src/operations.js'
            });

        }, function compilerErrorCheck(errorData){
            return errorData instanceof LayerCompilerError &&
                errorData.code === 'LAYER_OPERATION_CONTRACT_INVALID';

        });

    }
});

test('rejects malformed operation module boundaries and static metadata hazards', function(){
    const invalidSourceList = [
        operationSource.replace('import {layerOperationContractsCreate as contractsCreate} from \'@solcorp/layer\';', ''),
        operationSource.replace('export const operations', 'export let operations'),
        operationSource.replace('contractsCreate([', '[').replace(']);', '];'),
        operationSource.replace('contractsCreate([', 'contractsCreate({value: [').replace(']);', ']});'),
        operationSource.replace('name: \'article.list\'', 'name: \'Article\''),
        operationSource.replace('inputSchema: {', 'unknownField: true,\n        inputSchema: {'),
        operationSource.replace('inputSchema: {', 'inputSchema: null,\n        ignoredSchema: {'),
        operationSource.replace('auth: \'none\',', 'auth: /none/,'),
        operationSource.replace('auth: \'none\',', 'auth: \'none\',\n        __proto__: {},'),
        operationSource.replace('contractsCreate([', 'contractsCreate([,')
    ];

    for (const invalidSource of invalidSourceList) {
        assert.throws(function invalidBoundaryCompile(){
            layerOperationContractsCompile(invalidSource, {
                file: 'src/operations.js'
            });

        }, LayerCompilerError);

    }

    assert.throws(function malformedJavascriptCompile(){
        layerOperationContractsCompile('export const operations = [', {
            file: 'src/operations.js'
        });

    }, function javascriptErrorCheck(errorData){
        return errorData instanceof LayerCompilerError &&
            errorData.code === 'LAYER_OPERATION_CONTRACT_JAVASCRIPT_INVALID';

    });
});

test('accepts negative static numbers while leaving bounded metadata to server validation', function(){
    const operationList = layerOperationContractsCompile(
        operationSource.replace("auth: 'none',", "auth: 'none',\n        cost: -1,"),
        {
            file: 'src/operations.js'
        }
    );

    assert.equal(operationList[0]?.cost, -1);
});
