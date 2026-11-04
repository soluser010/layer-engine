# @solcorp/layer-plugin-sdk

**Part of [Layer-Engine](https://www.npmjs.com/package/@solcorp/layer), a JavaScript framework for full PWA applications.** Contracts for trusted server plugins and restricted contexts.

## What's new in 0.1.2

Layer-Engine now shows a branded first-install PWA screen with verified file progress, limits update-card descriptions to 47 characters, and includes RU/EN release history. A vulnerable development-tool dependency is fixed.

This package is part of the coordinated 0.1.2 release, prepared for publication. [Changes and upgrade steps](https://github.com/soluser010/layer-engine/blob/main/docs/en/updates/0.1.2.md) · [History](https://github.com/soluser010/layer-engine/blob/main/docs/en/updates/README.md) · [Что нового (RU)](https://github.com/soluser010/layer-engine/blob/main/docs/ru/updates/0.1.2.md).

Start with `npm install @solcorp/layer`; this module is installed automatically. You do not need to assemble the framework package by package.

[Quick start](https://github.com/soluser010/layer-engine/blob/main/README.md#quick-start) · [API guide EN](https://github.com/soluser010/layer-engine/blob/main/docs/en/reference.md) · [Документация RU](https://github.com/soluser010/layer-engine/blob/main/docs/ru/reference.md) · [Source](https://github.com/soluser010/layer-engine/tree/main/packages/plugin-sdk)

Часть фреймворка **Layer-Engine**. Для разработки приложения установите основной пакет `@solcorp/layer`; этот модуль входит в его зависимости. Ссылки выше ведут к назначению, API, примерам и ограничениям модуля.

Contracts for explicitly installed trusted server plugins. A plugin is process-authorized code, not an untrusted sandbox.

```js
import {layerPluginRegistryCreate} from '@solcorp/layer-plugin-sdk';

const plugins = layerPluginRegistryCreate({
    engineVersion: '0.1.0'
});

plugins.define({
    manifest: {
        name: '@example/audit-plugin',
        version: '1.0.0',
        engine: '^0.1.0',
        capabilities: ['config', 'logger', 'operations'],
        operations: ['audit.record.create'],
        configSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                enabled: {type: 'boolean'}
            },
            required: ['enabled']
        }
    },
    async setup(context) {
        context.logger.info('Audit plugin initialized');
    }
});
```

Manifests are validated before startup, engine ranges fail closed, configuration uses strict Draft 2020-12 validation, and the setup context contains only requested capabilities. Raw HTTP requests, unrestricted database pools, filesystem, network, child processes, and secrets are not granted by the SDK.
