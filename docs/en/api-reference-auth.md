---
title: Signature reference — @solcorp/layer-auth
description: Parameters, return values and related types.
audience: advanced
order: 310
status: documented
updated: 2026-10-31
---

# Signature reference — @solcorp/layer-auth

Start with the [guide and examples](layer-auth.md). Below are the exact public call shapes and nested options for this version. This is notation reference, **not code to paste into an application**: applications remain JavaScript ESM. `?` means optional, `|` alternatives, `Promise<T>` an asynchronous result; readonly prohibits mutation through that contract. Optional does not define a default: behavior and defaults belong to the topic guide.

A signature describes data shape, not browser availability or a connected provider. Do not import server APIs into browser code. Advanced factories are for custom hosts; ordinary components use context. Route/cache/offline limitations: [page options](page-configuration.md).

## Imports

| Import | Export |
| --- | --- |
| `@solcorp/layer-auth` | `LAYER_AUTH_BROWSER_API_VERSION` |
| `@solcorp/layer-auth` | `layerAuthConfigurationCreate` |
| `@solcorp/layer-auth` | `layerAuthConfigurationRedact` |
| `@solcorp/layer-auth` | `layerAuthContextExtensionCreate` |
| `@solcorp/layer-auth` | `LayerAuthError` |
| `@solcorp/layer-auth` | `layerAuthIdentifierCreate` |
| `@solcorp/layer-auth` | `LAYER_AUTH_ARGON2_PARAMETERS` |
| `@solcorp/layer-auth` | `layerAuthPasswordCheck` |
| `@solcorp/layer-auth` | `layerAuthPasswordHashCreate` |
| `@solcorp/layer-auth` | `layerAuthPasswordLengthGet` |
| `@solcorp/layer-auth` | `layerAuthPasswordVerify` |
| `@solcorp/layer-auth` | `layerAuthPasskeyServiceCreate` |
| `@solcorp/layer-auth` | `layerAuthTotpServiceCreate` |
| `@solcorp/layer-auth` | `layerAuthOidcAdapterFactoryCreate` |
| `@solcorp/layer-auth` | `layerAuthOAuthProviderCreate` |
| `@solcorp/layer-auth` | `layerAuthOAuthSigningJwksCreate` |
| `@solcorp/layer-auth` | `layerAuthAccountLifecycleCreate` |
| `@solcorp/layer-auth` | `layerAuthRoleServiceCreate` |
| `@solcorp/layer-auth` | `layerAuthOidcServiceCreate` |
| `@solcorp/layer-auth` | `layerAuthServiceCreate` |
| `@solcorp/layer-auth` | `layerAuthOperationDefinitionsCreate` |
| `@solcorp/layer-auth` | `layerAuthPasskeyOperationDefinitionsCreate` |
| `@solcorp/layer-auth` | `layerAuthTotpOperationDefinitionsCreate` |
| `@solcorp/layer-auth` | `layerAuthServerRuntimeCreate` |
| `@solcorp/layer-auth` | `layerAuthMailDeliveryCreate` |
| `@solcorp/layer-auth` | `layerAuthMailQueueCreate` |
| `@solcorp/layer-auth` | `layerAuthSecretEnvelopeCreate` |
| `@solcorp/layer-auth` | `layerAuthSessionDataCreate` |
| `@solcorp/layer-auth/browser` | `LAYER_AUTH_BROWSER_API_VERSION` |
| `@solcorp/layer-auth/browser` | `layerAuthBrowserCreate` |
| `@solcorp/layer-auth/server` | `layerAuthConfigurationCreate` |
| `@solcorp/layer-auth/server` | `layerAuthConfigurationRedact` |
| `@solcorp/layer-auth/server` | `layerAuthContextExtensionCreate` |
| `@solcorp/layer-auth/server` | `LayerAuthError` |
| `@solcorp/layer-auth/server` | `layerAuthIdentifierCreate` |
| `@solcorp/layer-auth/server` | `LAYER_AUTH_ARGON2_PARAMETERS` |
| `@solcorp/layer-auth/server` | `layerAuthPasswordCheck` |
| `@solcorp/layer-auth/server` | `layerAuthPasswordHashCreate` |
| `@solcorp/layer-auth/server` | `layerAuthPasswordLengthGet` |
| `@solcorp/layer-auth/server` | `layerAuthPasswordVerify` |
| `@solcorp/layer-auth/server` | `layerAuthPasskeyServiceCreate` |
| `@solcorp/layer-auth/server` | `layerAuthTotpServiceCreate` |
| `@solcorp/layer-auth/server` | `layerAuthOidcAdapterFactoryCreate` |
| `@solcorp/layer-auth/server` | `layerAuthOAuthProviderCreate` |
| `@solcorp/layer-auth/server` | `layerAuthOAuthSigningJwksCreate` |
| `@solcorp/layer-auth/server` | `layerAuthAccountLifecycleCreate` |
| `@solcorp/layer-auth/server` | `layerAuthRoleServiceCreate` |
| `@solcorp/layer-auth/server` | `layerAuthOidcServiceCreate` |
| `@solcorp/layer-auth/server` | `layerAuthServiceCreate` |
| `@solcorp/layer-auth/server` | `layerAuthOperationDefinitionsCreate` |
| `@solcorp/layer-auth/server` | `layerAuthPasskeyOperationDefinitionsCreate` |
| `@solcorp/layer-auth/server` | `layerAuthTotpOperationDefinitionsCreate` |
| `@solcorp/layer-auth/server` | `layerAuthServerRuntimeCreate` |
| `@solcorp/layer-auth/server` | `layerAuthMailDeliveryCreate` |
| `@solcorp/layer-auth/server` | `layerAuthMailQueueCreate` |
| `@solcorp/layer-auth/server` | `layerAuthSecretEnvelopeCreate` |
| `@solcorp/layer-auth/server` | `layerAuthSessionDataCreate` |

## Parameters and results

Named types are expanded below; DOM and external-library types retain their standard names. A helper from another Layer package is included only when required by a public signature.

[LAYER_AUTH_BROWSER_API_VERSION](#layer_auth_browser_api_version) · [layerAuthAccountLifecycleCreate](#layerauthaccountlifecyclecreate) · [layerAuthBrowserCreate](#layerauthbrowsercreate) · [layerAuthConfigurationCreate](#layerauthconfigurationcreate) · [layerAuthConfigurationRedact](#layerauthconfigurationredact) · [layerAuthContextExtensionCreate](#layerauthcontextextensioncreate) · [LayerAuthError](#layerautherror) · [layerAuthIdentifierCreate](#layerauthidentifiercreate) · [layerAuthMailDeliveryCreate](#layerauthmaildeliverycreate) · [layerAuthMailQueueCreate](#layerauthmailqueuecreate) · [layerAuthOAuthProviderCreate](#layerauthoauthprovidercreate) · [layerAuthOAuthSigningJwksCreate](#layerauthoauthsigningjwkscreate) · [layerAuthOidcAdapterFactoryCreate](#layerauthoidcadapterfactorycreate) · [layerAuthOidcServiceCreate](#layerauthoidcservicecreate) · [layerAuthOperationDefinitionsCreate](#layerauthoperationdefinitionscreate) · [layerAuthPasskeyOperationDefinitionsCreate](#layerauthpasskeyoperationdefinitionscreate) · [layerAuthPasskeyServiceCreate](#layerauthpasskeyservicecreate) · [layerAuthPasswordCheck](#layerauthpasswordcheck) · [layerAuthPasswordHashCreate](#layerauthpasswordhashcreate) · [layerAuthPasswordLengthGet](#layerauthpasswordlengthget) · [layerAuthPasswordVerify](#layerauthpasswordverify) · [layerAuthRoleServiceCreate](#layerauthroleservicecreate) · [layerAuthSecretEnvelopeCreate](#layerauthsecretenvelopecreate) · [layerAuthServerRuntimeCreate](#layerauthserverruntimecreate) · [layerAuthServiceCreate](#layerauthservicecreate) · [layerAuthSessionDataCreate](#layerauthsessiondatacreate) · [layerAuthTotpOperationDefinitionsCreate](#layerauthtotpoperationdefinitionscreate) · [layerAuthTotpServiceCreate](#layerauthtotpservicecreate)

### LAYER_AUTH_BROWSER_API_VERSION

```typescript
export declare const LAYER_AUTH_BROWSER_API_VERSION = 1;
```

### layerAuthAccountLifecycleCreate

```typescript
export declare function layerAuthAccountLifecycleCreate(lifecycleOptions: {
    configuration: Readonly<Record<string, any>>;
    users: {
        findById: Function;
        statusSet: Function;
        anonymize: Function;
    };
    sessions: {
        revokeAllByUser: Function;
    };
    oauth?: {
        revokeAccount: Function;
    } | null;
    apiKeys?: {
        revokeAllByUser: Function;
    } | null;
}): Readonly<{

    disable(userIdentifierData: string, reasonData?: string): Promise<Readonly<{
        disabled: false;
    }> | Readonly<{
        revokedSessions: number;
        revokedApiKeys: number;
        oauthRevoked: boolean;
        disabled: true;
    }>>;

    anonymize(userIdentifierData: string): Promise<Readonly<{
        anonymized: false;
    }> | Readonly<{
        anonymized: true;
        repeated: true;
    }> | Readonly<{
        revokedSessions: number;
        revokedApiKeys: number;
        oauthRevoked: boolean;
        anonymized: boolean;
        repeated: false;
    }>>;

    invalidate(userIdentifierData: string, reasonData?: string): Promise<Readonly<{
        revokedSessions: number;
        revokedApiKeys: number;
        oauthRevoked: boolean;
    }>>;
}>;
```

### layerAuthBrowserCreate

```typescript
export declare function layerAuthBrowserCreate(browserOptions: {
    request: (requestData: Readonly<Record<string, any>>) => Promise<{
        data: any;
    }>;
    storagePurge?: () => Promise<void>;
    phoneOperations?: {
        start: string;
        verify: string;
    };
    passkey?: {
        startAuthentication?: typeof startAuthentication;
        startRegistration?: typeof startRegistration;
    };
}): Readonly<{
    phone: Readonly<{

        start(phoneData: {
            phone: string;
        }, requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;

        verify(verificationData: {
            phone: string;
            challengeId: string;
            code: string;
        }, requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;
    }> | null;
    state: Readonly<{

        get(requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;
    }>;
    registration: Readonly<{

        create(registrationData: {
            identifier: string;
            password: string;
            invitationToken?: string;
        }, requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;
    }>;
    emailVerification: Readonly<{

        request(identifierData: string, requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;

        confirm(tokenData: string, requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;
    }>;
    passwordRecovery: Readonly<{

        request(identifierData: string, requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;

        complete(recoveryData: {
            token: string;
            password: string;
        }, requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;
    }>;
    signIn: Readonly<{

        password(signInData: {
            identifier: string;
            password: string;
            remember?: boolean;
        }, requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;

        passkey(signInData?: {
            remember?: boolean;
        }, requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;

        oidc(providerIdentifierData: string, signInData?: {
            returnTo?: string;
        }, requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;
    }>;
    oidc: Readonly<{
        providers: Readonly<{

            list(requestOptionsData?: {
                signal?: AbortSignal;
                timeoutMs?: number;
            }): Promise<any>;
        }>;

        begin(providerIdentifierData: string, beginData?: {
            returnTo?: string;
        }, requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;

        complete(completeData?: {
            callbackUrl?: string;
            remember?: boolean;
        }, requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;

        redirect(providerIdentifierData: string, beginData?: {
            returnTo?: string;
        }, requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;
    }>;
    passkey: Readonly<{
        registration: Readonly<{

            begin(requestOptionsData?: {
                signal?: AbortSignal;
                timeoutMs?: number;
            }): Promise<any>;

            complete(registrationData: {
                challenge: string;
                response: Record<string, any>;
                displayName?: string;
            }, requestOptionsData?: {
                signal?: AbortSignal;
                timeoutMs?: number;
            }): Promise<any>;

            create(registrationData?: {
                displayName?: string;
            }, requestOptionsData?: {
                signal?: AbortSignal;
                timeoutMs?: number;
            }): Promise<any>;
        }>;

        list(requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;

        remove(credentialIdentifierData: string, requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;
    }>;
    mfa: Readonly<{

        verify(verificationData: {
            challenge: string;
            code?: string;
            recoveryCode?: string;
        }, requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;
    }>;
    totp: Readonly<{

        state(requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;
        enrollment: Readonly<{

            begin(requestOptionsData?: {
                signal?: AbortSignal;
                timeoutMs?: number;
            }): Promise<any>;

            confirm(tokenData: string, requestOptionsData?: {
                signal?: AbortSignal;
                timeoutMs?: number;
            }): Promise<any>;
        }>;
        recoveryCodes: Readonly<{

            rotate(tokenData: string, requestOptionsData?: {
                signal?: AbortSignal;
                timeoutMs?: number;
            }): Promise<any>;
        }>;

        disable(tokenData: string, requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;
    }>;

    signOut(requestOptionsData?: {
        signal?: AbortSignal;
        timeoutMs?: number;
    }): Promise<any>;
    sessions: Readonly<{

        list(requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;

        revoke(sessionIdentifierData: string, requestOptionsData?: {
            signal?: AbortSignal;
            timeoutMs?: number;
        }): Promise<any>;
    }>;
}>;
```

### layerAuthConfigurationCreate

```typescript
export declare function layerAuthConfigurationCreate(authInputData: Readonly<Record<string, unknown>>): Readonly<Record<string, any>>;
```

### layerAuthConfigurationRedact

```typescript
export declare function layerAuthConfigurationRedact(authConfigurationData: null | Readonly<Record<string, any>>): Readonly<{
    secret: Readonly<{
        configured: true;
    }> | null;
    smtp: any;
    oauth: any;
    authorizationResolve: string | null;
    anonymization: string | null;
    oidc: readonly never[];
}> | null;
```

### layerAuthContextExtensionCreate

```typescript
export declare function layerAuthContextExtensionCreate(contextOptions: {
    sessions: {
        dataGetById: Function;
        dataReplaceById: Function;
        revokeAllByUser: Function;
    };
    authorizationInvalidate?: (userIdentifierData: string) => Promise<Readonly<Record<string, unknown>>>;
    dataMaximumBytes?: number;
}): (requestContextData: Readonly<Record<string, any>>) => Readonly<{
    auth: Readonly<{
        user: Readonly<{
            id: string;
        }> | null;
        permissions: any;
        assurance: any;
        session: Readonly<{
            id: string;
            data: Readonly<{
                get: () => Promise<Readonly<{
                    value: Readonly<Record<string, unknown>>;
                    revision: number;
                }>>;
                set: (nextValueData: unknown, expectedRevisionData: number) => Promise<Readonly<{
                    value: Readonly<Record<string, unknown>>;
                    revision: number;
                }>>;
                merge: (patchData: Readonly<Record<string, unknown>>, expectedRevisionData: number) => Promise<Readonly<{
                    value: Readonly<Record<string, unknown>>;
                    revision: number;
                }>>;
                delete: (fieldNamesData: readonly string[], expectedRevisionData: number) => Promise<Readonly<{
                    value: Readonly<Record<string, unknown>>;
                    revision: number;
                }>>;
            }>;
        }> | null;
        authorization: Readonly<{
            invalidate(): Promise<Readonly<Record<string, unknown>> | Readonly<{
                revokedSessions: number;
            }>>;
        }>;
    }>;
}>;
```

### LayerAuthError

```typescript
export declare class LayerAuthError extends Error {
    code: string;
    details: Readonly<Record<string, unknown>> | null;

    constructor(code: string, message: string, details?: Readonly<Record<string, unknown>> | null, cause?: unknown);
    toJSON(): {
        code: string;
        message: string;
        details: Readonly<Record<string, unknown>> | null;
    };
}
```

### layerAuthIdentifierCreate

```typescript
export declare function layerAuthIdentifierCreate(identifierData: unknown, identifierPolicyData: {
    email: boolean;
    username: boolean;
    phone?: boolean;
}): Readonly<{
    type: string;
    normalized: string;
    display: string;
}>;
```

### layerAuthMailDeliveryCreate

```typescript
export declare function layerAuthMailDeliveryCreate(deliveryOptions: {
    repository: any;
    queue: any;
    smtp: Readonly<Record<string, any>>;
    password?: string;
    workerId?: string;
    clock?: () => number;
    transportCreate?: (optionsData: Record<string, unknown>) => any;
    render?: (templateNameData: string, localeData: string, payloadData: Readonly<Record<string, unknown>>) => Promise<{
        subject: string;
        text: string;
        html?: string;
    }> | {
        subject: string;
        text: string;
        html?: string;
    };
    diagnostics?: (diagnosticData: Readonly<Record<string, unknown>>) => void;
}): Readonly<{
    runOnce: () => Promise<Readonly<{
        processed: number;
    }>>;
    start(): Promise<void>;
    stop(): Promise<void>;
    isRunning(): boolean;
}>;
```

### layerAuthMailQueueCreate

```typescript
export declare function layerAuthMailQueueCreate(queueOptions: {
    repository: any;
    secret: string;
}): Readonly<{

    enqueue(mailData: {
        templateName: string;
        recipient: string;
        locale?: string;
        payload: Readonly<Record<string, unknown>>;
        database?: {
            query: Function;
        };
    }): Promise<any>;

    open(queuedMailData: {
        recipientEncrypted: Uint8Array;
        payloadEncrypted: Uint8Array;
    }): Readonly<{
        recipient: string;
        payload: any;
    }>;
}>;
```

### layerAuthOAuthProviderCreate

```typescript
export declare function layerAuthOAuthProviderCreate(providerOptions: {
    configuration: Readonly<Record<string, any>>;
    adapter: Function;
    users: {
        findById: Function;
        identifiersList: Function;
    };
    authorizationResolve: (userIdentifierData: string) => Promise<{
        tenantId: string | null;
        permissions: readonly string[];
    }>;
    secret: string;
    jwks: {
        keys: readonly Record<string, any>[];
    };
    environment?: Record<string, string | undefined>;
    interactionHandler?: Function;
    auditTrail?: {
        record: Function;
    };
    rateLimiter?: {
        consume: Function;
    };
}): Readonly<{
    provider: any;
    requestHandle: (requestData: import('node:http').IncomingMessage, responseData: import('node:http').ServerResponse) => Promise<boolean>;
    accessTokenResolve: (accessTokenData: string, requestContextData?: Readonly<Record<string, any>>) => Promise<Readonly<{
        id: `oauth:${string}`;
        userId: string;
        tenantId: string | null;
        permissions: readonly string[];
        assurance: readonly string[];
        expiresAt: number;
        status: "active";
    }> | null>;

    scopesValidate(operationInspectionData: readonly {
        permissions?: readonly string[];
    }[]): true;

    revokeAccount(accountIdentifierData: string): Promise<void>;
}>;
```

### layerAuthOAuthSigningJwksCreate

```typescript
export declare function layerAuthOAuthSigningJwksCreate(signingOptions?: {
    identifierCreate?: () => string;
}): Promise<Readonly<{
    keys: readonly Readonly<import("jose").JWK>[];
}>>;
```

### layerAuthOidcAdapterFactoryCreate

```typescript
export declare function layerAuthOidcAdapterFactoryCreate(adapterOptions: {
    database: {
        query: Function;
        systemSchema: string;
    };
    envelope: {
        seal: Function;
        open: Function;
    };
    pepper: string;
    clock?: () => number;
}): {
    new (modelNameData: string): {
        modelName: string;

        reference(identifierData: string): string;

        destroy(identifierData: string): Promise<void>;

        consume(identifierData: string): Promise<void>;

        recordOpen(recordRowData: Record<string, any> | undefined): any;

        find(identifierData: string): Promise<any>;

        findByUid(uidData: string): Promise<any>;

        findByUserCode(userCodeData: string): Promise<any>;

        upsert(identifierData: string, payloadData: Record<string, any>, expiresInData?: number): Promise<void>;

        claim(identifierData: string, payloadData: Record<string, any>, expiresInData: number): Promise<boolean>;

        revokeByGrantId(grantIdentifierData: string): Promise<void>;

        revokeByAccountId(accountIdentifierData: string): Promise<void>;
    };
};
```

### layerAuthOidcServiceCreate

```typescript
export declare function layerAuthOidcServiceCreate(serviceOptions: {
    configuration: Readonly<Record<string, any>>;
    users: {
        create: Function;
        findByIdentifier: Function;
    };
    externalIdentities: {
        find: Function;
        create: Function;
    };
    challenges: {
        create: Function;
        consume: Function;
    };
    envelope: {
        seal: Function;
        open: Function;
    };
    sessionIssue: Function;
    environment?: Record<string, string | undefined>;
    clock?: () => number;
    client?: typeof openidClient;
}): Readonly<{
    providers(): any;

    begin(beginData: {
        providerId: string;
        returnTo?: string;
    }): Promise<Readonly<{
        providerId: string;
        authorizationUrl: string;
        expiresAt: number;
    }>>;

    complete(completeData: {
        callbackUrl: string;
        remember?: boolean;
    }): Promise<Readonly<{
        userId: string;
        returnTo: string;
        session: any;
    }>>;
}>;
```

### layerAuthOperationDefinitionsCreate

```typescript
export declare function layerAuthOperationDefinitionsCreate(operationOptions: {
    service: {
        registration: {
            create: Function;
        };
        emailVerification: {
            request: Function;
            confirm: Function;
        };
        passwordRecovery: {
            request: Function;
            complete: Function;
        };
        signIn: {
            password: Function;
        };
        sessions: {
            list: Function;
            revoke: Function;
        };
        passkey?: any;
        totp?: any;
        oidc?: any;
    };
    clock?: () => number;
}): readonly any[];
```

### layerAuthPasskeyOperationDefinitionsCreate

```typescript
export declare function layerAuthPasskeyOperationDefinitionsCreate(operationOptions: {
    service: any;
    clock?: () => number;
}): readonly ({
    name: string;
    type: string;
    auth: string;
    inputSchema: Readonly<{
        type: "object";
        additionalProperties: false;
    }>;
    outputSchema: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            options: {
                type: string;
                additionalProperties: boolean;
            };
        };
    };
    rateLimitBucket: string;
    cost: number;
    timeoutMs: number;
    concurrency: number;
    transaction: boolean;
    offlineReplay: boolean;
    audit: {
        enabled: boolean;
        category: string;
    };
    handler(payloadData: any, contextData: any): Promise<any>;
} | {
    name: string;
    type: string;
    auth: string;
    inputSchema: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            challenge: {
                type: string;
                minLength: number;
                maxLength: number;
            };
            displayName: {
                type: string;
                minLength: number;
                maxLength: number;
            };
            response: Readonly<{
                type: "object";
                additionalProperties: false;
                required: string[];
                properties: {
                    id: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    rawId: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    type: {
                        const: string;
                    };
                    authenticatorAttachment: {
                        type: string[];
                        enum: (string | null)[];
                    };
                    clientExtensionResults: {
                        type: string;
                        maxProperties: number;
                        additionalProperties: boolean;
                    };
                    response: {
                        type: string;
                        additionalProperties: boolean;
                        required: string[];
                        properties: {
                            attestationObject: {
                                type: string;
                                minLength: number;
                                maxLength: number;
                            };
                            clientDataJSON: {
                                type: string;
                                minLength: number;
                                maxLength: number;
                            };
                            transports: {
                                type: string;
                                maxItems: number;
                                uniqueItems: boolean;
                                items: {
                                    type: string;
                                    maxLength: number;
                                };
                            };
                            publicKeyAlgorithm: {
                                type: string;
                            };
                            publicKey: {
                                type: string[];
                                maxLength: number;
                            };
                            authenticatorData: {
                                type: string[];
                                maxLength: number;
                            };
                        };
                    };
                };
            }>;
        };
    };
    outputSchema: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            registered: {
                const: boolean;
            };
            passkey: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    credentialId: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    displayName: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                };
            };
        };
    };
    rateLimitBucket: string;
    cost: number;
    timeoutMs: number;
    concurrency: number;
    transaction: boolean;
    offlineReplay: boolean;
    audit: {
        enabled: boolean;
        category: string;
    };
    handler(payloadData: any, contextData: any): Promise<any>;
} | {
    name: string;
    type: string;
    auth: string;
    inputSchema: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            challenge: {
                type: string;
                minLength: number;
                maxLength: number;
            };
            remember: {
                type: string;
            };
            response: Readonly<{
                type: "object";
                additionalProperties: false;
                required: string[];
                properties: {
                    id: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    rawId: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    type: {
                        const: string;
                    };
                    authenticatorAttachment: {
                        type: string[];
                        enum: (string | null)[];
                    };
                    clientExtensionResults: {
                        type: string;
                        maxProperties: number;
                        additionalProperties: boolean;
                    };
                    response: {
                        type: string;
                        additionalProperties: boolean;
                        required: string[];
                        properties: {
                            authenticatorData: {
                                type: string;
                                minLength: number;
                                maxLength: number;
                            };
                            clientDataJSON: {
                                type: string;
                                minLength: number;
                                maxLength: number;
                            };
                            signature: {
                                type: string;
                                minLength: number;
                                maxLength: number;
                            };
                            userHandle: {
                                type: string[];
                                maxLength: number;
                            };
                        };
                    };
                };
            }>;
        };
    };
    outputSchema: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            user: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    id: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                };
            };
            session: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    id: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    idleExpiresAt: {
                        type: string;
                        minimum: number;
                    };
                    absoluteExpiresAt: {
                        type: string;
                        minimum: number;
                    };
                };
            };
        };
    };
    rateLimitBucket: string;
    cost: number;
    timeoutMs: number;
    concurrency: number;
    transaction: boolean;
    offlineReplay: boolean;
    audit: {
        enabled: boolean;
        category: string;
    };
    handler(payloadData: any, contextData: any): Promise<Readonly<{
        user: Readonly<{
            id: string;
        }>;
        session: Readonly<{
            id: string;
            idleExpiresAt: number;
            absoluteExpiresAt: number;
        }>;
    }>>;
} | {
    name: string;
    type: string;
    auth: string;
    inputSchema: Readonly<{
        type: "object";
        additionalProperties: false;
    }>;
    outputSchema: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            passkeys: {
                type: string;
                maxItems: number;
                items: {
                    type: string;
                    additionalProperties: boolean;
                };
            };
        };
    };
    rateLimitBucket: string;
    cost: number;
    timeoutMs: number;
    concurrency: number;
    transaction: boolean;
    offlineReplay: boolean;
    audit: {
        enabled: boolean;
        category: string;
    };
    handler(payloadData: any, contextData: any): Promise<Readonly<{
        passkeys: any;
    }>>;
} | {
    name: string;
    type: string;
    auth: string;
    inputSchema: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            credentialId: {
                type: string;
                minLength: number;
                maxLength: number;
            };
        };
    };
    outputSchema: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            removed: {
                type: string;
            };
        };
    };
    rateLimitBucket: string;
    cost: number;
    timeoutMs: number;
    concurrency: number;
    transaction: boolean;
    offlineReplay: boolean;
    audit: {
        enabled: boolean;
        category: string;
    };
    handler(payloadData: any, contextData: any): Promise<Readonly<{
        removed: boolean;
    }>>;
})[];
```

### layerAuthPasskeyServiceCreate

```typescript
export declare function layerAuthPasskeyServiceCreate(serviceOptions: {
    configuration: Readonly<Record<string, any>>;
    users: any;
    challenges: any;
    passkeys: any;
    sessionIssue: (userIdentifierData: string, rememberStatusData: boolean, assuranceData: readonly string[]) => Promise<any>;
    clock?: () => number;
    webAuthn?: {
        generateRegistrationOptions: typeof generateRegistrationOptions;
        verifyRegistrationResponse: typeof verifyRegistrationResponse;
        generateAuthenticationOptions: typeof generateAuthenticationOptions;
        verifyAuthenticationResponse: typeof verifyAuthenticationResponse;
    };
}): Readonly<{
    registration: Readonly<{

        begin(userIdentifierData: string): Promise<Readonly<{
            options: import("@simplewebauthn/server").PublicKeyCredentialCreationOptionsJSON;
        }>>;

        complete(userIdentifierData: string, registrationData: {
            challenge: string;
            response: any;
            displayName?: string;
        }): Promise<Readonly<{
            registered: true;
            passkey: never;
        }>>;
    }>;
    signIn: Readonly<{
        begin(): Promise<Readonly<{
            options: import("@simplewebauthn/server").PublicKeyCredentialRequestOptionsJSON;
        }>>;

        complete(authenticationData: {
            challenge: string;
            response: any;
            remember?: boolean;
        }): Promise<Readonly<{
            userId: string;
            session: any;
        }>>;
    }>;

    list(userIdentifierData: string): any;

    remove(userIdentifierData: string, credentialIdentifierData: string): any;
}>;
```

### layerAuthPasswordCheck

```typescript
export declare function layerAuthPasswordCheck(passwordData: unknown, passwordPolicyData: {
    minimumLength: number;
    maximumLength: number;
    commonPasswordBlocklist: boolean;
}): boolean;
```

### layerAuthPasswordHashCreate

```typescript
export declare function layerAuthPasswordHashCreate(passwordData: string): Promise<string>;
```

### layerAuthPasswordLengthGet

```typescript
export declare function layerAuthPasswordLengthGet(passwordData: string): number;
```

### layerAuthPasswordVerify

```typescript
export declare function layerAuthPasswordVerify(passwordHashData: string, passwordData: string): Promise<boolean>;
```

### layerAuthRoleServiceCreate

```typescript
export declare function layerAuthRoleServiceCreate(roleOptions: {
    roles: any;
    accounts: {
        invalidate: Function;
    };
}): Readonly<{

    define(roleData: {
        name: string;
        permissions: readonly string[];
        status?: 'active' | 'disabled';
    }): Promise<any>;

    assign(userIdentifierData: string, roleNameData: string): Promise<any>;

    remove(userIdentifierData: string, roleNameData: string): Promise<any>;

    listForUser(userIdentifierData: string): any;
}>;
```

### layerAuthSecretEnvelopeCreate

```typescript
export declare function layerAuthSecretEnvelopeCreate(envelopeOptions: {
    secret: string;
    randomBytesCreate?: (sizeData: number) => Buffer;
}): Readonly<{

    seal(valueData: unknown, purposeData: string): Buffer<ArrayBuffer>;

    open(envelopeData: Uint8Array, purposeData: string): any;
}>;
```

### layerAuthServerRuntimeCreate

```typescript
export declare function layerAuthServerRuntimeCreate(runtimeOptions: {
    configuration: Readonly<Record<string, any>>;
    users: any;
    sessions: any;
    challenges?: any;
    mailQueue?: any;
    mailDelivery?: any;
    phoneChallenge?: {
        start: Function;
        consume: Function;
    } | null;
    passkeys?: any;
    totp?: any;
    externalIdentities?: any;
    invitations?: any;
    secretEnvelope?: {
        seal: Function;
        open: Function;
    };
    oauthAdapter?: Function;
    oauthSecret?: string;
    oauthJwks?: {
        keys: readonly Record<string, any>[];
    };
    oauthEnvironment?: Record<string, string | undefined>;
    oauthInteractionHandler?: Function;
    auditTrail?: {
        record: Function;
    };
    rateLimiter?: {
        consume: Function;
    };
    oidcClient?: any;
    roles?: any;
    apiKeys?: any;
    allowedOrigins: readonly string[];
    secureCookies?: boolean;
    authorizationResolve?: Function | null;
    bearerResolve?: Function;
    apiKeyResolve?: Function;
    clock?: () => number;
    dummyPasswordHash?: string;
}): Readonly<{
    enabled: true;
    operations: any[];
    security: Readonly<{
        contextResolve(requestSecurityData: {
            auth: 'session' | 'authenticated' | 'bearer' | 'api-key' | 'none';
            permissions: readonly string[];
            headers: Record<string, string | string[] | undefined>;
            remoteAddress: string;
        }): Promise<Readonly<{
            authenticationType: 'anonymous' | 'session' | 'bearer' | 'api-key';
            credentialId: string | null;
            sessionId: string | null;
            userId: string | null;
            tenantId: string | null;
            permissions: readonly string[];
            remoteAddress: string;
            assurance?: readonly string[];
            credentialReference?: string;
        }>>;
    }>;
    service: Readonly<{
        authorization: Readonly<{
            resolve(userIdentifierData: string): Promise<Readonly<{
                tenantId: string | null;
                permissions: readonly string[];
            }>>;
        }>;
        registration: Readonly<{
            create(registrationData: {
                identifier: string;
                password: string;
                invitationToken?: string;
            }): Promise<Readonly<{
                accepted: true;
                verificationRequired: boolean;
                userId: string;
            }>>;
            createManaged(registrationData: {
                identifier: string;
                password: string;
                roles?: readonly string[];
            }): Promise<Readonly<{
                accepted: true;
                verificationRequired: boolean;
                userId: string;
            }>>;
        }>;
        invitations: Readonly<{
            issue(invitationData: {
                email?: string | null;
                roles?: readonly string[];
                expiresAt: string | number | Date;
                createdBy?: string | null;
            }): Promise<any>;
        }>;
        emailVerification: Readonly<{
            confirm(verificationData: {
                token: string;
            }): Promise<Readonly<{
                verified: true;
            }>>;
            request(verificationData: {
                identifier: string;
            }): Promise<Readonly<{
                accepted: true;
            }>>;
        }>;
        passwordRecovery: Readonly<{
            request(recoveryData: {
                identifier: string;
            }): Promise<Readonly<{
                accepted: true;
            }>>;
            complete(recoveryData: {
                token: string;
                password: string;
            }): Promise<Readonly<{
                completed: true;
            }>>;
        }>;
        passkey: Readonly<{
            registration: Readonly<{
                begin(userIdentifierData: string): Promise<Readonly<{
                    options: import("@simplewebauthn/server").PublicKeyCredentialCreationOptionsJSON;
                }>>;
                complete(userIdentifierData: string, registrationData: {
                    challenge: string;
                    response: any;
                    displayName?: string;
                }): Promise<Readonly<{
                    registered: true;
                    passkey: never;
                }>>;
            }>;
            signIn: Readonly<{
                begin(): Promise<Readonly<{
                    options: import("@simplewebauthn/server").PublicKeyCredentialRequestOptionsJSON;
                }>>;
                complete(authenticationData: {
                    challenge: string;
                    response: any;
                    remember?: boolean;
                }): Promise<Readonly<{
                    userId: string;
                    session: any;
                }>>;
            }>;
            list(userIdentifierData: string): any;
            remove(userIdentifierData: string, credentialIdentifierData: string): any;
        }> | null;
        totp: Readonly<{
            isEnabled(userIdentifierData: string): Promise<boolean>;
            enrollment: Readonly<{
                begin(userIdentifierData: string): Promise<Readonly<{
                    secret: string;
                    uri: string;
                }>>;
                confirm(userIdentifierData: string, tokenData: string): Promise<Readonly<{
                    enabled: true;
                    recoveryCodes: readonly any[];
                }>>;
            }>;
            challenge(userIdentifierData: string, rememberStatusData: boolean): Promise<Readonly<{
                mfaRequired: true;
                challenge: string;
                expiresAt: number;
                methods: readonly string[];
            }>>;
            verify(verificationData: {
                challenge: string;
                code?: string;
                recoveryCode?: string;
            }): Promise<Readonly<{
                userId: string;
                session: any;
            }>>;
            recoveryCodesRotate(userIdentifierData: string, tokenData: string): Promise<Readonly<{
                recoveryCodes: readonly any[];
            }>>;
            disable(userIdentifierData: string, tokenData: string): Promise<Readonly<{
                disabled: boolean;
            }>>;
        }> | null;
        oidc: Readonly<{
            providers(): any;
            begin(beginData: {
                providerId: string;
                returnTo?: string;
            }): Promise<Readonly<{
                providerId: string;
                authorizationUrl: string;
                expiresAt: number;
            }>>;
            complete(completeData: {
                callbackUrl: string;
                remember?: boolean;
            }): Promise<Readonly<{
                userId: string;
                returnTo: string;
                session: any;
            }>>;
        }> | null;
        mfa: Readonly<{
            verify: (verificationData: {
                challenge: string;
                code?: string;
                recoveryCode?: string;
            }) => Promise<Readonly<{
                userId: string;
                session: any;
            }>>;
        }> | null;
        signIn: Readonly<{
            verifiedPhone(signInData: {
                phone: string;
                remember?: boolean;
            }): Promise<Readonly<{
                userId: string;
                session: any;
            }>>;
            password(signInData: {
                identifier: string;
                password: string;
                remember?: boolean;
            }): Promise<Readonly<{
                mfaRequired: true;
                challenge: string;
                expiresAt: number;
                methods: readonly string[];
            }> | Readonly<{
                userId: string;
                session: any;
            }>>;
        }>;
        sessions: Readonly<{
            list(userIdentifierData: string): Promise<any>;
            revoke(sessionIdentifierData: string, userIdentifierData: string): Promise<any>;
        }>;
    }>;
    contextExtend: (requestContextData: Readonly<Record<string, any>>) => Readonly<{
        auth: Readonly<{
            user: Readonly<{
                id: string;
            }> | null;
            permissions: any;
            assurance: any;
            session: Readonly<{
                id: string;
                data: Readonly<{
                    get: () => Promise<Readonly<{
                        value: Readonly<Record<string, unknown>>;
                        revision: number;
                    }>>;
                    set: (nextValueData: unknown, expectedRevisionData: number) => Promise<Readonly<{
                        value: Readonly<Record<string, unknown>>;
                        revision: number;
                    }>>;
                    merge: (patchData: Readonly<Record<string, unknown>>, expectedRevisionData: number) => Promise<Readonly<{
                        value: Readonly<Record<string, unknown>>;
                        revision: number;
                    }>>;
                    delete: (fieldNamesData: readonly string[], expectedRevisionData: number) => Promise<Readonly<{
                        value: Readonly<Record<string, unknown>>;
                        revision: number;
                    }>>;
                }>;
            }> | null;
            authorization: Readonly<{
                invalidate(): Promise<Readonly<Record<string, unknown>> | Readonly<{
                    revokedSessions: number;
                }>>;
            }>;
        }>;
    }>;
    roles: Readonly<{
        define(roleData: {
            name: string;
            permissions: readonly string[];
            status?: 'active' | 'disabled';
        }): Promise<any>;
        assign(userIdentifierData: string, roleNameData: string): Promise<any>;
        remove(userIdentifierData: string, roleNameData: string): Promise<any>;
        listForUser(userIdentifierData: string): any;
    }> | null;
    accounts: Readonly<{
        disable(userIdentifierData: string, reasonData?: string): Promise<Readonly<{
            disabled: false;
        }> | Readonly<{
            revokedSessions: number;
            revokedApiKeys: number;
            oauthRevoked: boolean;
            disabled: true;
        }>>;
        anonymize(userIdentifierData: string): Promise<Readonly<{
            anonymized: false;
        }> | Readonly<{
            anonymized: true;
            repeated: true;
        }> | Readonly<{
            revokedSessions: number;
            revokedApiKeys: number;
            oauthRevoked: boolean;
            anonymized: boolean;
            repeated: false;
        }>>;
        invalidate(userIdentifierData: string, reasonData?: string): Promise<Readonly<{
            revokedSessions: number;
            revokedApiKeys: number;
            oauthRevoked: boolean;
        }>>;
    }>;
    audit: {
        record: Function;
    } | null;
    oauth: Readonly<{
        provider: any;
        requestHandle: (requestData: import("http").IncomingMessage, responseData: import("http").ServerResponse) => Promise<boolean>;
        accessTokenResolve: (accessTokenData: string, requestContextData?: Readonly<Record<string, any>>) => Promise<Readonly<{
            id: `oauth:${string}`;
            userId: string;
            tenantId: string | null;
            permissions: readonly string[];
            assurance: readonly string[];
            expiresAt: number;
            status: "active";
        }> | null>;
        scopesValidate(operationInspectionData: readonly {
            permissions?: readonly string[];
        }[]): true;
        revokeAccount(accountIdentifierData: string): Promise<void>;
    }> | null;
    http: Readonly<{
        requestHandlers: readonly Function[];
    }>;
    start(): Promise<void>;
    stop(): Promise<void>;

    register(operationRegistryData: {
        define: (operationData: any) => unknown;
        list?: () => readonly any[];
    }): readonly unknown[];
}>;
```

### layerAuthServiceCreate

```typescript
export declare function layerAuthServiceCreate(serviceOptions: {
    configuration: Readonly<Record<string, any>>;
    users: any;
    sessions: any;
    challenges?: any;
    mailQueue?: any;
    passkeys?: any;
    totp?: any;
    externalIdentities?: any;
    invitations?: any;
    roles?: any;
    secretEnvelope?: {
        seal: Function;
        open: Function;
    };
    oidcEnvironment?: Record<string, string | undefined>;
    oidcClient?: any;
    clock?: () => number;
    dummyPasswordHash?: string;
}): Readonly<{
    authorization: Readonly<{

        resolve(userIdentifierData: string): Promise<Readonly<{
            tenantId: string | null;
            permissions: readonly string[];
        }>>;
    }>;
    registration: Readonly<{

        create(registrationData: {
            identifier: string;
            password: string;
            invitationToken?: string;
        }): Promise<Readonly<{
            accepted: true;
            verificationRequired: boolean;
            userId: string;
        }>>;

        createManaged(registrationData: {
            identifier: string;
            password: string;
            roles?: readonly string[];
        }): Promise<Readonly<{
            accepted: true;
            verificationRequired: boolean;
            userId: string;
        }>>;
    }>;
    invitations: Readonly<{

        issue(invitationData: {
            email?: string | null;
            roles?: readonly string[];
            expiresAt: string | number | Date;
            createdBy?: string | null;
        }): Promise<any>;
    }>;
    emailVerification: Readonly<{

        confirm(verificationData: {
            token: string;
        }): Promise<Readonly<{
            verified: true;
        }>>;

        request(verificationData: {
            identifier: string;
        }): Promise<Readonly<{
            accepted: true;
        }>>;
    }>;
    passwordRecovery: Readonly<{

        request(recoveryData: {
            identifier: string;
        }): Promise<Readonly<{
            accepted: true;
        }>>;

        complete(recoveryData: {
            token: string;
            password: string;
        }): Promise<Readonly<{
            completed: true;
        }>>;
    }>;
    passkey: Readonly<{
        registration: Readonly<{
            begin(userIdentifierData: string): Promise<Readonly<{
                options: import("@simplewebauthn/server").PublicKeyCredentialCreationOptionsJSON;
            }>>;
            complete(userIdentifierData: string, registrationData: {
                challenge: string;
                response: any;
                displayName?: string;
            }): Promise<Readonly<{
                registered: true;
                passkey: never;
            }>>;
        }>;
        signIn: Readonly<{
            begin(): Promise<Readonly<{
                options: import("@simplewebauthn/server").PublicKeyCredentialRequestOptionsJSON;
            }>>;
            complete(authenticationData: {
                challenge: string;
                response: any;
                remember?: boolean;
            }): Promise<Readonly<{
                userId: string;
                session: any;
            }>>;
        }>;
        list(userIdentifierData: string): any;
        remove(userIdentifierData: string, credentialIdentifierData: string): any;
    }> | null;
    totp: Readonly<{
        isEnabled(userIdentifierData: string): Promise<boolean>;
        enrollment: Readonly<{
            begin(userIdentifierData: string): Promise<Readonly<{
                secret: string;
                uri: string;
            }>>;
            confirm(userIdentifierData: string, tokenData: string): Promise<Readonly<{
                enabled: true;
                recoveryCodes: readonly any[];
            }>>;
        }>;
        challenge(userIdentifierData: string, rememberStatusData: boolean): Promise<Readonly<{
            mfaRequired: true;
            challenge: string;
            expiresAt: number;
            methods: readonly string[];
        }>>;
        verify(verificationData: {
            challenge: string;
            code?: string;
            recoveryCode?: string;
        }): Promise<Readonly<{
            userId: string;
            session: any;
        }>>;
        recoveryCodesRotate(userIdentifierData: string, tokenData: string): Promise<Readonly<{
            recoveryCodes: readonly any[];
        }>>;
        disable(userIdentifierData: string, tokenData: string): Promise<Readonly<{
            disabled: boolean;
        }>>;
    }> | null;
    oidc: Readonly<{
        providers(): any;
        begin(beginData: {
            providerId: string;
            returnTo?: string;
        }): Promise<Readonly<{
            providerId: string;
            authorizationUrl: string;
            expiresAt: number;
        }>>;
        complete(completeData: {
            callbackUrl: string;
            remember?: boolean;
        }): Promise<Readonly<{
            userId: string;
            returnTo: string;
            session: any;
        }>>;
    }> | null;
    mfa: Readonly<{
        verify: (verificationData: {
            challenge: string;
            code?: string;
            recoveryCode?: string;
        }) => Promise<Readonly<{
            userId: string;
            session: any;
        }>>;
    }> | null;
    signIn: Readonly<{

        verifiedPhone(signInData: {
            phone: string;
            remember?: boolean;
        }): Promise<Readonly<{
            userId: string;
            session: any;
        }>>;

        password(signInData: {
            identifier: string;
            password: string;
            remember?: boolean;
        }): Promise<Readonly<{
            mfaRequired: true;
            challenge: string;
            expiresAt: number;
            methods: readonly string[];
        }> | Readonly<{
            userId: string;
            session: any;
        }>>;
    }>;
    sessions: Readonly<{

        list(userIdentifierData: string): Promise<any>;

        revoke(sessionIdentifierData: string, userIdentifierData: string): Promise<any>;
    }>;
}>;
```

### layerAuthSessionDataCreate

```typescript
export declare function layerAuthSessionDataCreate(sessionDataInput: unknown, sessionDataOptions?: {
    maximumBytes?: number;
}): Readonly<Record<string, unknown>>;
```

### layerAuthTotpOperationDefinitionsCreate

```typescript
export declare function layerAuthTotpOperationDefinitionsCreate(operationOptions: {
    service: any;
    clock?: () => number;
}): readonly ({
    name: string;
    type: string;
    auth: string;
    inputSchema: Readonly<{
        type: "object";
        additionalProperties: false;
    }>;
    outputSchema: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            enabled: {
                type: string;
            };
        };
    };
    rateLimitBucket: string;
    cost: number;
    timeoutMs: number;
    concurrency: number;
    transaction: boolean;
    offlineReplay: boolean;
    audit: {
        enabled: boolean;
        category: string;
    };
    handler(payloadData: any, contextData: any): Promise<Readonly<{
        enabled: boolean;
    }>>;
} | {
    name: string;
    type: string;
    auth: string;
    inputSchema: Readonly<{
        type: "object";
        additionalProperties: false;
    }>;
    outputSchema: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            secret: {
                type: string;
                minLength: number;
                maxLength: number;
            };
            uri: {
                type: string;
                minLength: number;
                maxLength: number;
            };
        };
    };
    rateLimitBucket: string;
    cost: number;
    timeoutMs: number;
    concurrency: number;
    transaction: boolean;
    offlineReplay: boolean;
    audit: {
        enabled: boolean;
        category: string;
    };
    handler(payloadData: any, contextData: any): Promise<any>;
} | {
    name: string;
    type: string;
    auth: string;
    inputSchema: {
        oneOf: ({
            type: string;
            additionalProperties: boolean;
            required: string[];
            properties: {
                challenge: {
                    type: string;
                    minLength: number;
                    maxLength: number;
                };
                code: Readonly<{
                    type: "string";
                    pattern: "^\\d{6,8}$";
                }>;
                recoveryCode?: never;
            };
        } | {
            type: string;
            additionalProperties: boolean;
            required: string[];
            properties: {
                code?: never;
                challenge: {
                    type: string;
                    minLength: number;
                    maxLength: number;
                };
                recoveryCode: {
                    type: string;
                    pattern: string;
                };
            };
        })[];
    };
    outputSchema: Readonly<{
        type: "object";
        additionalProperties: false;
        required: string[];
        properties: {
            user: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    id: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                };
            };
            session: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    id: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    idleExpiresAt: {
                        type: string;
                        minimum: number;
                    };
                    absoluteExpiresAt: {
                        type: string;
                        minimum: number;
                    };
                };
            };
        };
    }>;
    rateLimitBucket: string;
    cost: number;
    timeoutMs: number;
    concurrency: number;
    transaction: boolean;
    offlineReplay: boolean;
    audit: {
        enabled: boolean;
        category: string;
    };
    handler(payloadData: any, contextData: any): Promise<Readonly<{
        user: Readonly<{
            id: string;
        }>;
        session: Readonly<{
            id: string;
            idleExpiresAt: number;
            absoluteExpiresAt: number;
        }>;
    }>>;
} | {
    name: string;
    type: string;
    auth: string;
    inputSchema: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            code: Readonly<{
                type: "string";
                pattern: "^\\d{6,8}$";
            }>;
        };
    };
    outputSchema: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            recoveryCodes: {
                type: string;
                minItems: number;
                maxItems: number;
                uniqueItems: boolean;
                items: {
                    type: string;
                    pattern: string;
                };
            };
        };
    };
    rateLimitBucket: string;
    cost: number;
    timeoutMs: number;
    concurrency: number;
    transaction: boolean;
    offlineReplay: boolean;
    audit: {
        enabled: boolean;
        category: string;
    };
    handler(payloadData: any, contextData: any): Promise<any>;
} | {
    name: string;
    type: string;
    auth: string;
    inputSchema: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            code: Readonly<{
                type: "string";
                pattern: "^\\d{6,8}$";
            }>;
        };
    };
    outputSchema: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            disabled: {
                type: string;
            };
        };
    };
    rateLimitBucket: string;
    cost: number;
    timeoutMs: number;
    concurrency: number;
    transaction: boolean;
    offlineReplay: boolean;
    audit: {
        enabled: boolean;
        category: string;
    };
    handler(payloadData: any, contextData: any): Promise<any>;
})[];
```

### layerAuthTotpServiceCreate

```typescript
export declare function layerAuthTotpServiceCreate(serviceOptions: {
    configuration: Readonly<Record<string, any>>;
    users: any;
    challenges: any;
    totp: any;
    envelope: {
        seal: Function;
        open: Function;
    };
    sessionIssue: (userIdentifierData: string, rememberStatusData: boolean, assuranceData: readonly string[]) => Promise<any>;
    clock?: () => number;
    randomBytesCreate?: (sizeData: number) => Buffer;
}): Readonly<{

    isEnabled(userIdentifierData: string): Promise<boolean>;
    enrollment: Readonly<{

        begin(userIdentifierData: string): Promise<Readonly<{
            secret: string;
            uri: string;
        }>>;

        confirm(userIdentifierData: string, tokenData: string): Promise<Readonly<{
            enabled: true;
            recoveryCodes: readonly any[];
        }>>;
    }>;

    challenge(userIdentifierData: string, rememberStatusData: boolean): Promise<Readonly<{
        mfaRequired: true;
        challenge: string;
        expiresAt: number;
        methods: readonly string[];
    }>>;

    verify(verificationData: {
        challenge: string;
        code?: string;
        recoveryCode?: string;
    }): Promise<Readonly<{
        userId: string;
        session: any;
    }>>;

    recoveryCodesRotate(userIdentifierData: string, tokenData: string): Promise<Readonly<{
        recoveryCodes: readonly any[];
    }>>;

    disable(userIdentifierData: string, tokenData: string): Promise<Readonly<{
        disabled: boolean;
    }>>;
}>;
```

Next: [capability map](capabilities.md), [API catalog](api-catalog.md).
