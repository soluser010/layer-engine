---
title: Справочник сигнатур — @solcorp/layer-protocol
description: Параметры, возвращаемые значения и связанные типы.
audience: advanced
order: 310
status: documented
updated: 2026-10-31
---

# Справочник сигнатур — @solcorp/layer-protocol

Начните с [руководства и примеров](operations.md). Ниже — точные формы публичных вызовов и вложенных options текущей версии. Это справочник обозначений, **не код для вставки в приложение**: приложение остаётся JavaScript ESM. `?` означает необязательность, `|` — варианты, `Promise<T>` — асинхронный результат; readonly запрещает изменение через этот контракт. Необязательность не задаёт default: поведение и значения по умолчанию описаны в тематической статье.

Подпись описывает форму данных, а не доступность браузерной функции и не гарантию подключения provider. Server API нельзя переносить в браузер. Advanced factories нужны для собственного host; обычный компонент использует context. Ограничения route/cache/offline: [настройки страницы](page-configuration.md).

## Импорты

| Import | Export |
| --- | --- |
| `@solcorp/layer-protocol` | `LAYER_ERROR_CODES` |
| `@solcorp/layer-protocol` | `LAYER_PROTOCOL_VERSION` |
| `@solcorp/layer-protocol` | `LAYER_REQUEST_TYPES` |
| `@solcorp/layer-protocol` | `LayerError` |
| `@solcorp/layer-protocol` | `layerErrorNormalize` |
| `@solcorp/layer-protocol` | `layerErrorResponseDataCreate` |
| `@solcorp/layer-protocol` | `layerSuccessResponseDataCreate` |
| `@solcorp/layer-protocol` | `layerDomainEventSchema` |
| `@solcorp/layer-protocol` | `layerErrorResponseSchema` |
| `@solcorp/layer-protocol` | `layerRequestEnvelopeSchema` |
| `@solcorp/layer-protocol` | `layerSuccessResponseSchema` |
| `@solcorp/layer-protocol` | `layerProtocolDataValidatorCreate` |
| `@solcorp/layer-protocol` | `layerProtocolValidatorCreate` |
| `@solcorp/layer-protocol/constants` | `LAYER_PROTOCOL_VERSION` |
| `@solcorp/layer-protocol/constants` | `LAYER_REQUEST_TYPES` |
| `@solcorp/layer-protocol/constants` | `LAYER_ERROR_CODES` |
| `@solcorp/layer-protocol/data-validator` | `LayerValidationResult` |
| `@solcorp/layer-protocol/data-validator` | `LayerValidationIssue` |
| `@solcorp/layer-protocol/data-validator` | `layerProtocolDataValidatorCreate` |

## Параметры и результаты

Именованные типы раскрываются ниже; типы DOM и внешних библиотек сохраняют свои стандартные имена. Одинаковый helper из другого Layer-пакета включён только если нужен для публичной подписи.

[LAYER_ERROR_CODES](#layer_error_codes) · [LAYER_PROTOCOL_VERSION](#layer_protocol_version) · [LAYER_REQUEST_TYPES](#layer_request_types) · [layerDomainEventSchema](#layerdomaineventschema) · [LayerError](#layererror) · [layerErrorNormalize](#layererrornormalize) · [LayerErrorOptions](#layererroroptions) · [layerErrorResponseDataCreate](#layererrorresponsedatacreate) · [layerErrorResponseSchema](#layererrorresponseschema) · [layerProtocolDataValidatorCreate](#layerprotocoldatavalidatorcreate) · [layerProtocolValidatorCreate](#layerprotocolvalidatorcreate) · [layerRequestEnvelopeSchema](#layerrequestenvelopeschema) · [LayerSuccessResponseCreateOptions](#layersuccessresponsecreateoptions) · [layerSuccessResponseDataCreate](#layersuccessresponsedatacreate) · [layerSuccessResponseSchema](#layersuccessresponseschema) · [LayerValidationIssue](#layervalidationissue) · [LayerValidationResult](#layervalidationresult) · [ValidateFunction](#validatefunction)

### LAYER_ERROR_CODES

```typescript
export declare const LAYER_ERROR_CODES: Readonly<{
    AUTH_REQUIRED: "AUTH_REQUIRED";
    AUTH_CREDENTIALS_INVALID: "AUTH_CREDENTIALS_INVALID";
    AUTH_CHALLENGE_INVALID: "AUTH_CHALLENGE_INVALID";
    AUTH_EMAIL_VERIFICATION_REQUIRED: "AUTH_EMAIL_VERIFICATION_REQUIRED";
    AUTH_IDENTIFIER_INVALID: "AUTH_IDENTIFIER_INVALID";
    AUTH_INVITATION_INVALID: "AUTH_INVITATION_INVALID";
    AUTH_MFA_REQUIRED: "AUTH_MFA_REQUIRED";
    AUTH_MFA_INVALID: "AUTH_MFA_INVALID";
    AUTH_OIDC_IDENTITY_UNAVAILABLE: "AUTH_OIDC_IDENTITY_UNAVAILABLE";
    AUTH_OIDC_LINK_REQUIRED: "AUTH_OIDC_LINK_REQUIRED";
    AUTH_OIDC_PROVIDER_INVALID: "AUTH_OIDC_PROVIDER_INVALID";
    AUTH_OIDC_STATE_INVALID: "AUTH_OIDC_STATE_INVALID";
    AUTH_OIDC_UPSTREAM_FAILED: "AUTH_OIDC_UPSTREAM_FAILED";
    AUTH_OAUTH_SCOPE_UNREGISTERED: "AUTH_OAUTH_SCOPE_UNREGISTERED";
    AUTH_PASSWORD_COMMON: "AUTH_PASSWORD_COMMON";
    AUTH_PASSWORD_INVALID: "AUTH_PASSWORD_INVALID";
    AUTH_PASSKEY_INVALID: "AUTH_PASSKEY_INVALID";
    AUTH_PASSKEY_REPLAY: "AUTH_PASSKEY_REPLAY";
    AUTH_PASSKEY_UNAVAILABLE: "AUTH_PASSKEY_UNAVAILABLE";
    AUTH_RECENT_AUTHENTICATION_REQUIRED: "AUTH_RECENT_AUTHENTICATION_REQUIRED";
    AUTH_RECOVERY_UNAVAILABLE: "AUTH_RECOVERY_UNAVAILABLE";
    AUTH_REGISTRATION_DISABLED: "AUTH_REGISTRATION_DISABLED";
    AUTH_REGISTRATION_UNAVAILABLE: "AUTH_REGISTRATION_UNAVAILABLE";
    AUTH_SESSION_CONFLICT: "AUTH_SESSION_CONFLICT";
    AUTH_TOTP_REPLAY: "AUTH_TOTP_REPLAY";
    AUTH_TOTP_UNAVAILABLE: "AUTH_TOTP_UNAVAILABLE";
    AUTH_VERIFICATION_UNAVAILABLE: "AUTH_VERIFICATION_UNAVAILABLE";
    AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED";
    AUTHORIZATION_DENIED: "AUTHORIZATION_DENIED";
    CONFLICT: "CONFLICT";
    CSRF_INVALID: "CSRF_INVALID";
    CURSOR_EXPIRED: "CURSOR_EXPIRED";
    DEPENDENCY_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE";
    INTERNAL_ERROR: "INTERNAL_ERROR";
    INVALID_ENVELOPE: "INVALID_ENVELOPE";
    INVALID_OPERATION_DEFINITION: "INVALID_OPERATION_DEFINITION";
    INVALID_OPERATION_SCHEMA: "INVALID_OPERATION_SCHEMA";
    INVALID_PAYLOAD: "INVALID_PAYLOAD";
    INVALID_REQUEST: "INVALID_REQUEST";
    METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED";
    NOT_FOUND: "NOT_FOUND";
    OBJECT_ACCESS_DENIED: "OBJECT_ACCESS_DENIED";
    OPERATION_DUPLICATE: "OPERATION_DUPLICATE";
    OPERATION_NOT_FOUND: "OPERATION_NOT_FOUND";
    OPERATION_REGISTRY_SEALED: "OPERATION_REGISTRY_SEALED";
    OPERATION_TIMEOUT: "OPERATION_TIMEOUT";
    OUTBOUND_REQUEST_DENIED: "OUTBOUND_REQUEST_DENIED";
    PERMISSION_DENIED: "PERMISSION_DENIED";
    RATE_LIMITED: "RATE_LIMITED";
    REQUEST_TOO_LARGE: "REQUEST_TOO_LARGE";
    REQUEST_ABORTED: "REQUEST_ABORTED";
    REVISION_CONFLICT: "REVISION_CONFLICT";
    RUNTIME_UPDATE_REQUIRED: "RUNTIME_UPDATE_REQUIRED";
    TIMEOUT: "TIMEOUT";
    UNSUPPORTED_PROTOCOL: "UNSUPPORTED_PROTOCOL";
}>;
```

### LAYER_PROTOCOL_VERSION

```typescript
export declare const LAYER_PROTOCOL_VERSION = 1;
```

### LAYER_REQUEST_TYPES

```typescript
export declare const LAYER_REQUEST_TYPES: readonly string[];
```

### layerDomainEventSchema

```typescript
export declare const layerDomainEventSchema: Readonly<{
    $id: "https://layer.engine/schemas/protocol/domain-event.json";
    $schema: "https://json-schema.org/draft/2020-12/schema";
    type: "object";
    additionalProperties: false;
    required: string[];
    properties: {
        eventId: {
            type: string;
            minLength: number;
            maxLength: number;
        };
        channel: {
            type: string;
            minLength: number;
            maxLength: number;
            pattern: string;
        };
        sequence: {
            type: string;
            minimum: number;
        };
        entityRevision: {
            type: string;
            minimum: number;
        };
        type: {
            type: string;
            minLength: number;
            maxLength: number;
            pattern: string;
        };
        payload: {
            type: string;
        };
        occurredAt: {
            type: string;
            format: string;
        };
    };
}>;
```

### LayerError

```typescript
export declare class LayerError extends Error {
    #private;
    code: string;
    retryable: boolean;
    status: number;
    details: Record<string, unknown> | null;

    constructor(code: string, message: string, options?: LayerErrorOptions);

    internalCauseGet(): unknown;

    toJSON(): {
        code: string;
        message: string;
        retryable: boolean;
        details: Record<string, unknown> | null;
    };
}
```

### layerErrorNormalize

```typescript
export declare function layerErrorNormalize(errorData: unknown): LayerError;
```

### LayerErrorOptions

```typescript
export type LayerErrorOptions = {
    cause?: unknown;
    details?: Record<string, unknown> | null;
    retryable?: boolean;
    status?: number;
};
```

### layerErrorResponseDataCreate

```typescript
export declare function layerErrorResponseDataCreate(responseOptions: {
    requestId: string;
    error: unknown;
}): {
    protocol: 1;
    requestId: string;
    ok: false;
    error: {
        code: string;
        message: string;
        retryable: boolean;
        details: Record<string, unknown> | null;
    };
};
```

### layerErrorResponseSchema

```typescript
export declare const layerErrorResponseSchema: Readonly<{
    $id: "https://layer.engine/schemas/protocol/error-response.json";
    $schema: "https://json-schema.org/draft/2020-12/schema";
    type: "object";
    additionalProperties: false;
    required: string[];
    properties: {
        protocol: {
            const: number;
        };
        requestId: Readonly<{
            type: "string";
            format: "uuid";
        }>;
        ok: {
            const: boolean;
        };
        error: {
            type: string;
            additionalProperties: boolean;
            required: string[];
            properties: {
                code: {
                    enum: ("AUTHENTICATION_REQUIRED" | "AUTHORIZATION_DENIED" | "AUTH_CHALLENGE_INVALID" | "AUTH_CREDENTIALS_INVALID" | "AUTH_EMAIL_VERIFICATION_REQUIRED" | "AUTH_IDENTIFIER_INVALID" | "AUTH_INVITATION_INVALID" | "AUTH_MFA_INVALID" | "AUTH_MFA_REQUIRED" | "AUTH_OAUTH_SCOPE_UNREGISTERED" | "AUTH_OIDC_IDENTITY_UNAVAILABLE" | "AUTH_OIDC_LINK_REQUIRED" | "AUTH_OIDC_PROVIDER_INVALID" | "AUTH_OIDC_STATE_INVALID" | "AUTH_OIDC_UPSTREAM_FAILED" | "AUTH_PASSKEY_INVALID" | "AUTH_PASSKEY_REPLAY" | "AUTH_PASSKEY_UNAVAILABLE" | "AUTH_PASSWORD_COMMON" | "AUTH_PASSWORD_INVALID" | "AUTH_RECENT_AUTHENTICATION_REQUIRED" | "AUTH_RECOVERY_UNAVAILABLE" | "AUTH_REGISTRATION_DISABLED" | "AUTH_REGISTRATION_UNAVAILABLE" | "AUTH_REQUIRED" | "AUTH_SESSION_CONFLICT" | "AUTH_TOTP_REPLAY" | "AUTH_TOTP_UNAVAILABLE" | "AUTH_VERIFICATION_UNAVAILABLE" | "CONFLICT" | "CSRF_INVALID" | "CURSOR_EXPIRED" | "DEPENDENCY_UNAVAILABLE" | "INTERNAL_ERROR" | "INVALID_ENVELOPE" | "INVALID_OPERATION_DEFINITION" | "INVALID_OPERATION_SCHEMA" | "INVALID_PAYLOAD" | "INVALID_REQUEST" | "METHOD_NOT_ALLOWED" | "NOT_FOUND" | "OBJECT_ACCESS_DENIED" | "OPERATION_DUPLICATE" | "OPERATION_NOT_FOUND" | "OPERATION_REGISTRY_SEALED" | "OPERATION_TIMEOUT" | "OUTBOUND_REQUEST_DENIED" | "PERMISSION_DENIED" | "RATE_LIMITED" | "REQUEST_ABORTED" | "REQUEST_TOO_LARGE" | "REVISION_CONFLICT" | "RUNTIME_UPDATE_REQUIRED" | "TIMEOUT" | "UNSUPPORTED_PROTOCOL")[];
                };
                message: {
                    type: string;
                    minLength: number;
                    maxLength: number;
                };
                retryable: {
                    type: string;
                };
                details: {
                    anyOf: {
                        type: string;
                    }[];
                };
            };
        };
    };
}>;
```

### layerProtocolDataValidatorCreate

```typescript
export declare function layerProtocolDataValidatorCreate(): Readonly<{

    requestValidate(inputData: unknown): LayerValidationResult;

    successResponseValidate(inputData: unknown): LayerValidationResult;

    errorResponseValidate(inputData: unknown): LayerValidationResult;

    eventValidate(inputData: unknown): LayerValidationResult;
}>;
```

### layerProtocolValidatorCreate

```typescript
export declare function layerProtocolValidatorCreate(): Readonly<{
    requestValidate: (inputData: unknown) => import("./data-validator.js").LayerValidationResult;
    successResponseValidate: (inputData: unknown) => import("./data-validator.js").LayerValidationResult;
    errorResponseValidate: (inputData: unknown) => import("./data-validator.js").LayerValidationResult;
    eventValidate: (inputData: unknown) => import("./data-validator.js").LayerValidationResult;

    schemaCompile(schemaData: object | boolean): ValidateFunction;
}>;
```

### layerRequestEnvelopeSchema

```typescript
export declare const layerRequestEnvelopeSchema: Readonly<{
    $id: "https://layer.engine/schemas/protocol/request-envelope.json";
    $schema: "https://json-schema.org/draft/2020-12/schema";
    type: "object";
    additionalProperties: false;
    required: string[];
    properties: {
        protocol: {
            const: number;
        };
        requestId: Readonly<{
            type: "string";
            format: "uuid";
        }>;
        type: {
            enum: readonly string[];
        };
        operation: {
            type: string;
            minLength: number;
            maxLength: number;
            pattern: string;
        };
        payload: {
            type: string;
        };
        cursor: {
            anyOf: ({
                type: string;
                minLength: number;
                maxLength: number;
                propertyNames?: never;
                additionalProperties?: never;
                maxProperties?: never;
            } | {
                minLength?: never;
                maxLength?: never;
                type: string;
                propertyNames: {
                    pattern: string;
                };
                additionalProperties: {
                    type: string;
                    minimum: number;
                };
                maxProperties: number;
            } | {
                minLength?: never;
                maxLength?: never;
                propertyNames?: never;
                additionalProperties?: never;
                maxProperties?: never;
                type: string;
            })[];
        };
    };
    dependentSchemas: {
        cursor: {
            properties: {
                type: {
                    enum: string[];
                };
            };
        };
    };
}>;
```

### LayerSuccessResponseCreateOptions

```typescript
export type LayerSuccessResponseCreateOptions = {
    requestId: string;
    data: unknown;
    meta?: Record<string, unknown>;
};
```

### layerSuccessResponseDataCreate

```typescript
export declare function layerSuccessResponseDataCreate(responseOptions: LayerSuccessResponseCreateOptions): {
    protocol: 1;
    requestId: string;
    ok: true;
    data: unknown;
    meta?: Record<string, unknown>;
};
```

### layerSuccessResponseSchema

```typescript
export declare const layerSuccessResponseSchema: Readonly<{
    $id: "https://layer.engine/schemas/protocol/success-response.json";
    $schema: "https://json-schema.org/draft/2020-12/schema";
    type: "object";
    additionalProperties: false;
    required: string[];
    properties: {
        protocol: {
            const: number;
        };
        requestId: Readonly<{
            type: "string";
            format: "uuid";
        }>;
        ok: {
            const: boolean;
        };
        data: {};
        meta: {
            type: string;
        };
    };
}>;
```

### LayerValidationIssue

```typescript
export type LayerValidationIssue = {
    instancePath: string;
    keyword: string;
    message: string;
    schemaPath: string;
};
```

### LayerValidationResult

```typescript
export type LayerValidationResult = {
    valid: true;
    errors: readonly [];
} | {
    valid: false;
    errors: readonly LayerValidationIssue[];
};
```

### ValidateFunction

```typescript
export type ValidateFunction = import('ajv').ValidateFunction;
```

Далее: [карта возможностей](capabilities.md), [каталог API](api-catalog.md).
