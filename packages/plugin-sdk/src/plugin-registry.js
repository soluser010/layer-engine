import {layerProtocolValidatorCreate} from '@solcorp/layer-protocol';
import {LayerPluginError} from './plugin-error.js';
import {
    layerPluginEngineCompatible,
    layerPluginManifestValidate
} from './plugin-manifest.js';

/**
 * @typedef {ReturnType<typeof layerPluginManifestValidate>} LayerPluginManifest
 * @typedef {(pluginContext: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>} LayerPluginSetup
 * @typedef {{manifest: LayerPluginManifest, setup: LayerPluginSetup, configValidate: ((configData: unknown) => boolean) & {errors?: unknown}}} LayerRegisteredPlugin
 */

/**
 * @param {LayerPluginManifest} pluginManifest
 * @param {Readonly<Record<string, unknown>>} serviceData
 * @param {unknown} configData
 */
function pluginContextCreate(pluginManifest, serviceData, configData) {
    const pluginContext = /** @type {Record<string, unknown>} */ ({});

    //Selecting only explicitly requested and host-provided capabilities.
    for (const capabilityName of pluginManifest.capabilities) {
        if (capabilityName === 'config') {
            pluginContext.config = configData;

            continue;

        }

        if (!Object.prototype.hasOwnProperty.call(serviceData, capabilityName)) {
            throw new LayerPluginError('PLUGIN_CAPABILITY_UNAVAILABLE', 'A requested plugin capability is unavailable.', {
                details: {
                    plugin: pluginManifest.name,
                    capability: capabilityName
                }
            });

        }

        pluginContext[capabilityName] = serviceData[capabilityName];

    }

    return Object.freeze(pluginContext);

}

/**
 * @param {{engineVersion: string}} registryOptions
 */
export function layerPluginRegistryCreate(registryOptions) {
    if (registryOptions === null || typeof registryOptions !== 'object' || typeof registryOptions.engineVersion !== 'string') {
        throw new TypeError('Plugin registry requires an engineVersion.');

    }

    const protocolValidator = layerProtocolValidatorCreate();
    const registeredPlugins = new Map();
    let sealedStatus = false;
    let initializedStatus = false;

    return Object.freeze({
        /**
         * @param {{manifest: unknown, setup: LayerPluginSetup}} pluginDefinition
         */
        define(pluginDefinition) {
            //Rejecting late registration after readiness or explicit sealing.
            if (sealedStatus) {
                throw new LayerPluginError('PLUGIN_REGISTRY_SEALED', 'Plugin registry is sealed.');

            }

            if (pluginDefinition === null || typeof pluginDefinition !== 'object' || typeof pluginDefinition.setup !== 'function') {
                throw new LayerPluginError('PLUGIN_DEFINITION_INVALID', 'Plugin definition requires a manifest and setup function.');

            }

            const pluginManifest = layerPluginManifestValidate(pluginDefinition.manifest);

            if (registeredPlugins.has(pluginManifest.name)) {
                throw new LayerPluginError('PLUGIN_DUPLICATE', 'Plugin name is already registered.', {
                    details: {
                        plugin: pluginManifest.name
                    }
                });

            }

            if (!layerPluginEngineCompatible(pluginManifest.engine, registryOptions.engineVersion)) {
                throw new LayerPluginError('PLUGIN_ENGINE_INCOMPATIBLE', 'Plugin does not support this Layer-Engine version.', {
                    details: {
                        plugin: pluginManifest.name,
                        engine: registryOptions.engineVersion,
                        required: pluginManifest.engine
                    }
                });

            }

            let configValidate;

            try {
                //Compiling the validated schema once during plugin registration.
                configValidate = protocolValidator.schemaCompile(pluginManifest.configSchema);

            } catch (schemaError) {
                throw new LayerPluginError('PLUGIN_CONFIG_SCHEMA_INVALID', 'Plugin config schema could not be compiled.', {
                    cause: schemaError
                });

            }

            registeredPlugins.set(pluginManifest.name, {
                manifest: pluginManifest,
                setup: pluginDefinition.setup,
                configValidate
            });

            return pluginManifest;

        },
        seal() {
            //Preventing plugin registration after host readiness begins.
            sealedStatus = true;

            return true;

        },
        isSealed() {
            //Returning the current registry lifecycle state.
            return sealedStatus;

        },
        list() {
            //Returning manifests without setup functions or compiled validators.
            return Object.freeze([...registeredPlugins.values()].map(function pluginInspectionCreate(pluginData) {
                //Selecting only the immutable public plugin manifest.
                return pluginData.manifest;

            }));

        },
        /**
         * @param {{services?: Readonly<Record<string, unknown>>, configs?: Readonly<Record<string, unknown>>}} [initializeOptions]
         */
        async initialize(initializeOptions = {}) {
            if (initializedStatus) {
                throw new LayerPluginError('PLUGIN_REGISTRY_INITIALIZED', 'Plugins have already been initialized.');

            }

            sealedStatus = true;
            const serviceData = initializeOptions.services ?? {};
            const configurationData = initializeOptions.configs ?? {};
            const initializationResults = /** @type {Record<string, unknown>} */ ({});

            for (const pluginData of registeredPlugins.values()) {
                const pluginConfig = configurationData[pluginData.manifest.name] ?? {};

                //Validating plugin-owned configuration before exposing capabilities.
                if (!pluginData.configValidate(pluginConfig)) {
                    throw new LayerPluginError('PLUGIN_CONFIG_INVALID', 'Plugin configuration failed its declared schema.', {
                        details: {
                            plugin: pluginData.manifest.name
                        }
                    });

                }

                const pluginContext = pluginContextCreate(pluginData.manifest, serviceData, pluginConfig);

                try {
                    //Initializing trusted installed code in deterministic registration order.
                    initializationResults[pluginData.manifest.name] = await pluginData.setup(pluginContext);

                } catch (setupError) {
                    throw new LayerPluginError('PLUGIN_SETUP_FAILED', 'Plugin setup failed.', {
                        details: {
                            plugin: pluginData.manifest.name
                        },
                        cause: setupError
                    });

                }

            }

            initializedStatus = true;

            return Object.freeze(initializationResults);

        }
    });

}
