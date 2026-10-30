import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LayerPluginError,
    layerPluginEngineCompatible,
    layerPluginManifestValidate,
    layerPluginRegistryCreate
} from '../src/index.js';

function pluginManifestFixtureCreate(/** @type {Record<string, unknown>} */ overrideData = {}) {
    return {
        name: '@example/audit-plugin',
        version: '1.2.0',
        engine: '^0.1.0',
        operations: ['audit.record.create'],
        migrations: ['001-audit-records'],
        eventChannels: ['audit.records'],
        capabilities: ['config', 'logger', 'operations'],
        configSchema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            additionalProperties: false,
            properties: {
                enabled: {
                    type: 'boolean'
                }
            },
            required: ['enabled']
        },
        permissions: ['audit.record'],
        browserPackages: ['@example/audit-browser'],
        integrity: {
            sha256: 'a'.repeat(64),
            provenance: 'registry-signature:example'
        },
        ...overrideData
    };
}

test('plugin manifest validates contracts and engine ranges', () => {
    const manifest = layerPluginManifestValidate(pluginManifestFixtureCreate());

    assert.equal(Object.isFrozen(manifest), true);
    assert.equal(manifest.operations[0], 'audit.record.create');
    assert.equal(layerPluginEngineCompatible('^0.1.0', '0.1.9'), true);
    assert.equal(layerPluginEngineCompatible('^0.1.0', '1.0.0'), false);
    assert.equal(layerPluginEngineCompatible('>=0.1.0 <0.3.0', '0.2.4'), true);
    assert.equal(layerPluginEngineCompatible('0.1.0', '0.1.0'), true);
    assert.equal(layerPluginEngineCompatible('*', '9.0.0'), true);
});

test('plugin manifest rejects unknown fields, capabilities, schema, and integrity', () => {
    assert.throws(() => layerPluginManifestValidate(pluginManifestFixtureCreate({
        unknown: true
    })), LayerPluginError);
    assert.throws(() => layerPluginManifestValidate(pluginManifestFixtureCreate({
        capabilities: ['filesystem']
    })), LayerPluginError);
    assert.throws(() => layerPluginManifestValidate(pluginManifestFixtureCreate({
        configSchema: {
            type: 'unknown'
        }
    })), LayerPluginError);
    assert.throws(() => layerPluginManifestValidate(pluginManifestFixtureCreate({
        integrity: {
            sha256: 'invalid',
            provenance: 'test'
        }
    })), LayerPluginError);
});

test('plugin registry exposes only requested capabilities and seals on initialize', async () => {
    const registry = layerPluginRegistryCreate({
        engineVersion: '0.1.0'
    });
    const setupContexts = /** @type {any[]} */ ([]);
    const manifest = registry.define({
        manifest: pluginManifestFixtureCreate(),
        async setup(contextData) {
            setupContexts.push(contextData);

            return {ready: true};
        }
    });
    const operationService = {define() {}};
    const loggerService = {info() {}};
    const results = await registry.initialize({
        configs: {
            [manifest.name]: {
                enabled: true
            }
        },
        services: {
            operations: operationService,
            logger: loggerService,
            database: {query() {}}
        }
    });

    assert.equal(registry.isSealed(), true);
    assert.deepEqual(results, {
        '@example/audit-plugin': {
            ready: true
        }
    });
    assert.deepEqual(Object.keys(setupContexts[0]).sort(), [
        'config',
        'logger',
        'operations'
    ]);
    assert.equal('database' in setupContexts[0], false);
    assert.equal('setup' in registry.list()[0], false);
    assert.throws(() => registry.define({
        manifest: pluginManifestFixtureCreate({name: '@example/late'}),
        setup() {}
    }), (errorData) => /** @type {any} */ (errorData).code === 'PLUGIN_REGISTRY_SEALED');
});

test('plugin registry rejects duplicates, incompatible engines, config, and setup failures', async () => {
    const duplicateRegistry = layerPluginRegistryCreate({engineVersion: '0.1.0'});
    duplicateRegistry.define({manifest: pluginManifestFixtureCreate(), setup() {}});
    assert.throws(() => duplicateRegistry.define({manifest: pluginManifestFixtureCreate(), setup() {}}), LayerPluginError);

    const incompatibleRegistry = layerPluginRegistryCreate({engineVersion: '1.0.0'});
    assert.throws(() => incompatibleRegistry.define({manifest: pluginManifestFixtureCreate(), setup() {}}), (errorData) => {
        return /** @type {any} */ (errorData).code === 'PLUGIN_ENGINE_INCOMPATIBLE';
    });

    const invalidConfigRegistry = layerPluginRegistryCreate({engineVersion: '0.1.0'});
    invalidConfigRegistry.define({manifest: pluginManifestFixtureCreate(), setup() {}});
    await assert.rejects(() => invalidConfigRegistry.initialize({
        configs: {
            '@example/audit-plugin': {
                enabled: 'yes'
            }
        }
    }), (errorData) => /** @type {any} */ (errorData).code === 'PLUGIN_CONFIG_INVALID');

    const failedRegistry = layerPluginRegistryCreate({engineVersion: '0.1.0'});
    failedRegistry.define({
        manifest: pluginManifestFixtureCreate({capabilities: []}),
        setup() {
            throw new Error('private failure');
        }
    });
    await assert.rejects(() => failedRegistry.initialize({
        configs: {
            '@example/audit-plugin': {
                enabled: true
            }
        }
    }), (errorData) => {
        assert.equal('cause' in /** @type {any} */ (errorData).toJSON(), false);

        return /** @type {any} */ (errorData).code === 'PLUGIN_SETUP_FAILED';
    });
});
