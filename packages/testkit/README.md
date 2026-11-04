# @solcorp/layer-testkit

**Part of [Layer-Engine](https://www.npmjs.com/package/@solcorp/layer), a JavaScript framework for full PWA applications.** Isolated protocol and operation fixtures for application tests.

## What's new in 0.1.2

Layer-Engine now shows a branded first-install PWA screen with verified file progress, limits update-card descriptions to 47 characters, and includes RU/EN release history. A vulnerable development-tool dependency is fixed.

This package is part of the coordinated 0.1.2 release, prepared for publication. [Changes and upgrade steps](https://github.com/soluser010/layer-engine/blob/main/docs/en/updates/0.1.2.md) · [History](https://github.com/soluser010/layer-engine/blob/main/docs/en/updates/README.md) · [Что нового (RU)](https://github.com/soluser010/layer-engine/blob/main/docs/ru/updates/0.1.2.md).

Start with `npm install @solcorp/layer`; this module is installed automatically. You do not need to assemble the framework package by package.

[Quick start](https://github.com/soluser010/layer-engine/blob/main/README.md#quick-start) · [API guide EN](https://github.com/soluser010/layer-engine/blob/main/docs/en/testing.md) · [Документация RU](https://github.com/soluser010/layer-engine/blob/main/docs/ru/testing.md) · [Source](https://github.com/soluser010/layer-engine/tree/main/packages/testkit)

Часть фреймворка **Layer-Engine**. Для разработки приложения установите основной пакет `@solcorp/layer`; этот модуль входит в его зависимости. Ссылки выше ведут к назначению, API, примерам и ограничениям модуля.

Reusable valid fixtures for protocol consumers and operation registry tests. Every factory creates a fresh object graph, so one test cannot mutate another test's data.

```js
import {
    layerOperationFixtureCreate,
    layerRequestFixtureCreate
} from '@solcorp/layer-testkit';

const requestData = layerRequestFixtureCreate({
    operation: 'chat.message.list'
});

const operationData = layerOperationFixtureCreate({
    name: 'chat.message.list'
});
```

Every override is copied into a new object graph. Factories do not validate deliberately invalid overrides; use the protocol validator or operation registry to assert the expected failure contract.
