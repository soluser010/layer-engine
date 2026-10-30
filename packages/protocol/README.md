# @solcorp/layer-protocol

**Part of [Layer-Engine](https://www.npmjs.com/package/@solcorp/layer), a JavaScript framework for full PWA applications.** Validated request, response, error and event contracts.

Start with `npm install @solcorp/layer`; this module is installed automatically. You do not need to assemble the framework package by package.

[Quick start](https://github.com/soluser010/layer-engine/blob/main/README.md#quick-start) · [API guide EN](https://github.com/soluser010/layer-engine/blob/main/docs/en/operations.md) · [Документация RU](https://github.com/soluser010/layer-engine/blob/main/docs/ru/operations.md) · [Source](https://github.com/soluser010/layer-engine/tree/main/packages/protocol)

Часть фреймворка **Layer-Engine**. Для разработки приложения установите основной пакет `@solcorp/layer`; этот модуль входит в его зависимости. Ссылки выше ведут к назначению, API, примерам и ограничениям модуля.

Public Layer-Engine protocol constants, Draft 2020-12 JSON schemas, validators, safe errors, and response factories.

```js
import {
    layerProtocolValidatorCreate,
    layerSuccessResponseDataCreate
} from '@solcorp/layer-protocol';

const protocolValidator = layerProtocolValidatorCreate();
const validationResult = protocolValidator.requestValidate(requestData);

const responseData = layerSuccessResponseDataCreate({
    requestId: requestData.requestId,
    data: {
        accepted: true
    }
});
```

Validation never coerces, defaults, removes, or otherwise changes input data. A failed validation returns safe structured issues rather than throwing.

## Failure contract

- Validator methods return `{ valid: false, errors }` for invalid data.
- Invalid application schemas passed to `schemaCompile` throw during compilation.
- `layerErrorResponseDataCreate` converts an unknown error to `INTERNAL_ERROR` and never exposes its message, stack, or cause.
- Only stable values from `LAYER_ERROR_CODES` are accepted by the public error-response schema.
