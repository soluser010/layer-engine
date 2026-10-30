import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LAYER_ERROR_CODES,
    LayerError
} from '@solcorp/layer-protocol';
import {layerOperationRegistryCreate} from '../src/index.js';

/**
 * @param {Record<string, unknown>} [overrideData]
 * @returns {any}
 */
function operationDataCreate(overrideData = {}) {
    return {
        name: 'chat.message.list',
        type: 'query',
        inputSchema: {
            type: 'object',
            additionalProperties: false
        },
        outputSchema: {
            type: 'object'
        },
        handler: async (/** @type {unknown} */ inputData) => inputData,
        ...overrideData
    };
}

/**
 * @param {() => unknown} callback
 * @param {string} expectedCode
 */
function layerErrorAssert(callback, expectedCode) {
    assert.throws(callback, (errorData) => {
        assert.ok(errorData instanceof LayerError);
        assert.equal(errorData.code, expectedCode);

        return true;
    });
}

test('applies conservative defaults and exposes runtime lookup', async () => {
    const operationRegistry = layerOperationRegistryCreate();
    const inspectionData = operationRegistry.define(operationDataCreate());
    const operationData = operationRegistry.get('chat.message.list');

    assert.deepEqual(inspectionData, {
        name: 'chat.message.list',
        type: 'query',
        auth: 'session',
        permissions: [],
        rateLimitBucket: 'operation.default',
        cost: 1,
        timeoutMs: 10000,
        concurrency: 32,
        transaction: false,
        offlineReplay: false,
        audit: {
            enabled: true,
            category: 'metadata'
        },
        cache: null,
        cacheInvalidation: null
    });
    assert.equal(operationRegistry.has('chat.message.list'), true);
    assert.equal(operationRegistry.has('missing.operation'), false);
    assert.ok(operationData);
    assert.deepEqual(await operationData.handler({
        value: 1
    }, {}), {
        value: 1
    });
    assert.equal(operationData.outputValidate({
        value: 1
    }), true);
    assert.equal(operationData.inputValidate({}), true);
});

test('requires explicit auth none for a public operation', () => {
    const defaultRegistry = layerOperationRegistryCreate();
    const publicRegistry = layerOperationRegistryCreate();

    defaultRegistry.define(operationDataCreate());
    publicRegistry.define(operationDataCreate({
        auth: 'none'
    }));

    assert.equal(defaultRegistry.list()[0]?.auth, 'session');
    assert.equal(publicRegistry.list()[0]?.auth, 'none');

    layerErrorAssert(() => {
        publicRegistry.define(operationDataCreate({
            name: 'health.permission.read',
            auth: 'none',
            permissions: [
                'health.read'
            ]
        }));
    }, LAYER_ERROR_CODES.INVALID_OPERATION_DEFINITION);
});

test('supports explicit bounded security metadata for commands', () => {
    const operationRegistry = layerOperationRegistryCreate();
    const inspectionData = operationRegistry.define(operationDataCreate({
        name: 'chat.message.send',
        type: 'command',
        auth: 'bearer',
        permissions: [
            'chat.message.send'
        ],
        rateLimitBucket: 'chat.send',
        cost: 4,
        timeoutMs: 12000,
        concurrency: 8,
        transaction: true,
        offlineReplay: true,
        audit: {
            enabled: false,
            category: 'chat-command'
        }
    }));

    assert.equal(inspectionData.timeoutMs, 12000);
    assert.equal(inspectionData.offlineReplay, true);
    assert.equal(inspectionData.transaction, true);
    assert.equal(inspectionData.auth, 'bearer');
    assert.deepEqual(inspectionData.audit, {
        enabled: false,
        category: 'chat-command'
    });
});

test('accepts bounded opt-in cache metadata only for compatible queries', () => {
    const operationRegistry = layerOperationRegistryCreate();
    const inspectionData = operationRegistry.define(operationDataCreate({
        cache: {
            ttlMs: 30000,
            scope: 'tenant',
            tags: ['chat-messages']
        }
    }));

    assert.deepEqual( inspectionData.cache, {
        ttlMs: 30000,
        scope: 'tenant',
        tags: ['chat-messages']
    });
    assert.equal( Object.isFrozen( inspectionData.cache ), true );
    assert.equal( Object.isFrozen( inspectionData.cache?.tags ), true );

    for ( const invalidCacheData of [
        {ttlMs: 99, scope: 'tenant'},
        {ttlMs: 30000, scope: 'unknown'},
        {ttlMs: 30000, scope: 'tenant', tags: ['Invalid tag']},
        {ttlMs: 30000, scope: 'tenant', tags: ['chat', 'chat']},
        {ttlMs: 30000, scope: 'tenant', unknown: true}
    ] ){
        const invalidRegistryData = layerOperationRegistryCreate();

        layerErrorAssert(() => invalidRegistryData.define(operationDataCreate({
            cache: invalidCacheData
        })), LAYER_ERROR_CODES.INVALID_OPERATION_DEFINITION);

    }

    layerErrorAssert(() => layerOperationRegistryCreate().define(operationDataCreate({
        type: 'command',
        cache: {ttlMs: 30000, scope: 'tenant'}
    })), LAYER_ERROR_CODES.INVALID_OPERATION_DEFINITION);
    layerErrorAssert(() => layerOperationRegistryCreate().define(operationDataCreate({
        auth: 'none',
        cache: {ttlMs: 30000, scope: 'user'}
    })), LAYER_ERROR_CODES.INVALID_OPERATION_DEFINITION);

});

test('accepts durable cache invalidation only for transactional commands', () => {
    const operationRegistryData = layerOperationRegistryCreate();
    const inspectionData = operationRegistryData.define(operationDataCreate({
        name: 'chat.message.send',
        type: 'command',
        transaction: true,
        cacheInvalidation: {
            scope: 'tenant',
            tags: ['chat-messages']
        }
    }));

    assert.deepEqual( inspectionData.cacheInvalidation, {
        scope: 'tenant',
        tags: ['chat-messages']
    });
    assert.equal( Object.isFrozen( inspectionData.cacheInvalidation ), true );
    assert.equal( Object.isFrozen( inspectionData.cacheInvalidation?.tags ), true );

    for ( const invalidOverrideData of [{
        type: 'query',
        transaction: false
    }, {
        type: 'command',
        transaction: false
    }, {
        type: 'command',
        transaction: true,
        cacheInvalidation: {scope: 'tenant', tags: []}
    }, {
        type: 'command',
        transaction: true,
        cacheInvalidation: {scope: 'tenant', tags: ['Invalid tag']}
    }, {
        type: 'command',
        transaction: true,
        cacheInvalidation: {scope: 'tenant', tags: ['chat'], unknown: true}
    }]){
        const invalidRegistryData = layerOperationRegistryCreate();

        layerErrorAssert(() => invalidRegistryData.define(operationDataCreate({
            name: 'chat.message.send',
            cacheInvalidation: {
                scope: 'tenant',
                tags: ['chat-messages']
            },
            ...invalidOverrideData
        })), LAYER_ERROR_CODES.INVALID_OPERATION_DEFINITION);

    }
});

test('rejects duplicate operations', () => {
    const operationRegistry = layerOperationRegistryCreate();

    operationRegistry.define(operationDataCreate());

    layerErrorAssert(() => {
        operationRegistry.define(operationDataCreate());
    }, LAYER_ERROR_CODES.OPERATION_DUPLICATE);
});

test('rejects unknown fields and malformed definitions', () => {
    const invalidOverrides = [
        {
            unknownMetadata: true
        },
        {
            name: 'Invalid name'
        },
        {
            name: `${'a'.repeat(80)}.${'b'.repeat(81)}`
        },
        {
            type: 'unknown'
        },
        {
            handler: 'not-a-function'
        },
        {
            authorize: 'not-a-function'
        },
        {
            inputSchema: null
        },
        {
            permissions: 'chat.read'
        },
        {
            permissions: [
                'invalid'
            ]
        },
        {
            permissions: [
                'chat.read',
                'chat.read'
            ]
        },
        {
            auth: 'cookie'
        },
        {
            rateLimitBucket: 'Invalid bucket'
        },
        {
            cost: 0
        },
        {
            timeoutMs: 12.5
        },
        {
            concurrency: 10001
        },
        {
            transaction: 'yes'
        },
        {
            audit: 'metadata'
        },
        {
            audit: {
                secret: true
            }
        },
        {
            audit: {
                enabled: 'yes'
            }
        },
        {
            audit: {
                category: ''
            }
        }
    ];

    for (const invalidOverride of invalidOverrides) {
        const operationRegistry = layerOperationRegistryCreate();

        layerErrorAssert(() => {
            operationRegistry.define(operationDataCreate(invalidOverride));
        }, LAYER_ERROR_CODES.INVALID_OPERATION_DEFINITION);
    }

    const operationRegistry = layerOperationRegistryCreate();

    layerErrorAssert(() => {
        operationRegistry.define(/** @type {never} */ (null));
    }, LAYER_ERROR_CODES.INVALID_OPERATION_DEFINITION);
});

test('rejects invalid and unknown-keyword schemas', () => {
    const invalidSchemas = [
        {
            type: 'not-a-json-schema-type'
        },
        {
            type: 'object',
            unknownKeyword: true
        }
    ];

    for (const inputSchema of invalidSchemas) {
        const operationRegistry = layerOperationRegistryCreate();

        layerErrorAssert(() => {
            operationRegistry.define(operationDataCreate({
                inputSchema
            }));
        }, LAYER_ERROR_CODES.INVALID_OPERATION_SCHEMA);
    }
});

test('restricts transaction and offline replay combinations', () => {
    const invalidOverrides = [
        {
            type: 'query',
            transaction: true
        },
        {
            type: 'sync',
            offlineReplay: true,
            transaction: true
        },
        {
            type: 'command',
            offlineReplay: true,
            transaction: false
        }
    ];

    for (const invalidOverride of invalidOverrides) {
        const operationRegistry = layerOperationRegistryCreate();

        layerErrorAssert(() => {
            operationRegistry.define(operationDataCreate(invalidOverride));
        }, LAYER_ERROR_CODES.INVALID_OPERATION_DEFINITION);
    }
});

test('seals the registry against later changes', () => {
    const operationRegistry = layerOperationRegistryCreate();

    assert.equal(operationRegistry.isSealed(), false);
    operationRegistry.seal();
    assert.equal(operationRegistry.isSealed(), true);

    layerErrorAssert(() => {
        operationRegistry.define(operationDataCreate());
    }, LAYER_ERROR_CODES.OPERATION_REGISTRY_SEALED);
});

test('list inspection does not expose handlers or validators', () => {
    const operationRegistry = layerOperationRegistryCreate();

    operationRegistry.define(operationDataCreate());

    const operationList = operationRegistry.list();
    const inspectionData = operationList[0];

    assert.ok(Object.isFrozen(operationList));
    assert.ok(inspectionData);
    assert.ok(Object.isFrozen(inspectionData));
    assert.equal('handler' in inspectionData, false);
    assert.equal('authorize' in inspectionData, false);
    assert.equal('inputValidate' in inspectionData, false);
    assert.equal('outputValidate' in inspectionData, false);
    assert.equal('inputSchema' in inspectionData, false);
    assert.equal('outputSchema' in inspectionData, false);
});
