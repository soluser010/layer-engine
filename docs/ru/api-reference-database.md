---
title: Справочник сигнатур — @solcorp/layer-database
description: Параметры, возвращаемые значения и связанные типы.
audience: advanced
order: 310
status: documented
updated: 2026-10-31
---

# Справочник сигнатур — @solcorp/layer-database

Начните с [руководства и примеров](structured-data.md). Ниже — точные формы публичных вызовов и вложенных options текущей версии. Это справочник обозначений, **не код для вставки в приложение**: приложение остаётся JavaScript ESM. `?` означает необязательность, `|` — варианты, `Promise<T>` — асинхронный результат; readonly запрещает изменение через этот контракт. Необязательность не задаёт default: поведение и значения по умолчанию описаны в тематической статье.

Подпись описывает форму данных, а не доступность браузерной функции и не гарантию подключения provider. Server API нельзя переносить в браузер. Advanced factories нужны для собственного host; обычный компонент использует context. Ограничения route/cache/offline: [настройки страницы](page-configuration.md).

## Импорты

| Import | Export |
| --- | --- |
| `@solcorp/layer-database` | `layerApiKeyRepositoryCreate` |
| `@solcorp/layer-database` | `layerAuditRepositoryCreate` |
| `@solcorp/layer-database` | `layerAuthSessionRepositoryCreate` |
| `@solcorp/layer-database` | `layerAuthRoleRepositoryCreate` |
| `@solcorp/layer-database` | `layerAuthChallengeRepositoryCreate` |
| `@solcorp/layer-database` | `layerAuthExternalIdentityRepositoryCreate` |
| `@solcorp/layer-database` | `layerAuthInvitationRepositoryCreate` |
| `@solcorp/layer-database` | `layerAuthMailRepositoryCreate` |
| `@solcorp/layer-database` | `layerAuthPasskeyRepositoryCreate` |
| `@solcorp/layer-database` | `layerAuthTotpRepositoryCreate` |
| `@solcorp/layer-database` | `layerAuthUserRepositoryCreate` |
| `@solcorp/layer-database` | `layerCacheInvalidationRepositoryCreate` |
| `@solcorp/layer-database` | `layerCommandResultRepositoryCreate` |
| `@solcorp/layer-database` | `LayerDatabaseError` |
| `@solcorp/layer-database` | `layerDatabaseRateLimiterCreate` |
| `@solcorp/layer-database` | `layerDatabaseLeaseManagerCreate` |
| `@solcorp/layer-database` | `layerDatabaseLegacyMigrate` |
| `@solcorp/layer-database` | `layerDatabaseMigrate` |
| `@solcorp/layer-database` | `layerPgliteDatabaseCreate` |
| `@solcorp/layer-database` | `layerPostgresClusterCreate` |
| `@solcorp/layer-database` | `layerPostgresDatabaseCreate` |
| `@solcorp/layer-database` | `LAYER_DATABASE_COLUMN_TYPES` |
| `@solcorp/layer-database` | `LAYER_DATABASE_TABLE_SCOPES` |
| `@solcorp/layer-database` | `layerDatabaseSchemaDefinitionCheck` |
| `@solcorp/layer-database` | `layerDatabaseSchemaDefine` |
| `@solcorp/layer-database` | `layerTableDefine` |
| `@solcorp/layer-database` | `layerDatabaseSchemaDeclarationsCreate` |
| `@solcorp/layer-database` | `layerDatabaseSchemaApply` |
| `@solcorp/layer-database` | `layerDatabaseSchemaPlan` |
| `@solcorp/layer-database` | `layerDatabaseSchemaSynchronize` |
| `@solcorp/layer-database` | `layerSessionRepositoryCreate` |
| `@solcorp/layer-database` | `layerDatabaseFacadeCreate` |
| `@solcorp/layer-database` | `LAYER_SYSTEM_TABLE_NAMES` |
| `@solcorp/layer-database` | `layerSqlIdentifierQuote` |
| `@solcorp/layer-database` | `layerSystemSchemaNameAssert` |
| `@solcorp/layer-database` | `layerSystemSchemaNameCreate` |
| `@solcorp/layer-database` | `layerSystemSchemaRead` |
| `@solcorp/layer-database` | `layerSystemTableReferenceCreate` |

## Параметры и результаты

Именованные типы раскрываются ниже; типы DOM и внешних библиотек сохраняют свои стандартные имена. Одинаковый helper из другого Layer-пакета включён только если нужен для публичной подписи.

[AuthRoleDatabase](#authroledatabase) · [layerApiKeyRepositoryCreate](#layerapikeyrepositorycreate) · [layerAuditRepositoryCreate](#layerauditrepositorycreate) · [layerAuthChallengeRepositoryCreate](#layerauthchallengerepositorycreate) · [layerAuthExternalIdentityRepositoryCreate](#layerauthexternalidentityrepositorycreate) · [layerAuthInvitationRepositoryCreate](#layerauthinvitationrepositorycreate) · [layerAuthMailRepositoryCreate](#layerauthmailrepositorycreate) · [layerAuthPasskeyRepositoryCreate](#layerauthpasskeyrepositorycreate) · [layerAuthRoleRepositoryCreate](#layerauthrolerepositorycreate) · [layerAuthSessionRepositoryCreate](#layerauthsessionrepositorycreate) · [layerAuthTotpRepositoryCreate](#layerauthtotprepositorycreate) · [layerAuthUserRepositoryCreate](#layerauthuserrepositorycreate) · [layerCacheInvalidationRepositoryCreate](#layercacheinvalidationrepositorycreate) · [LayerClusterConnection](#layerclusterconnection) · [LayerClusterDatabase](#layerclusterdatabase) · [LayerClusterQuery](#layerclusterquery) · [LayerClusterQueryResult](#layerclusterqueryresult) · [layerCommandResultRepositoryCreate](#layercommandresultrepositorycreate) · [LayerDatabaseError](#layerdatabaseerror) · [layerDatabaseFacadeCreate](#layerdatabasefacadecreate) · [layerDatabaseLeaseManagerCreate](#layerdatabaseleasemanagercreate) · [layerDatabaseLegacyMigrate](#layerdatabaselegacymigrate) · [layerDatabaseMigrate](#layerdatabasemigrate) · [layerDatabaseRateLimiterCreate](#layerdatabaseratelimitercreate) · [layerDatabaseSchemaApply](#layerdatabaseschemaapply) · [layerDatabaseSchemaDeclarationsCreate](#layerdatabaseschemadeclarationscreate) · [layerDatabaseSchemaDefine](#layerdatabaseschemadefine) · [layerDatabaseSchemaDefinitionCheck](#layerdatabaseschemadefinitioncheck) · [layerDatabaseSchemaPlan](#layerdatabaseschemaplan) · [layerDatabaseSchemaSynchronize](#layerdatabaseschemasynchronize) · [LayerDurableRateDatabase](#layerdurableratedatabase) · [LayerDurableRateProfile](#layerdurablerateprofile) · [LayerDurableRateTransaction](#layerdurableratetransaction) · [layerPgliteDatabaseCreate](#layerpglitedatabasecreate) · [LayerPgliteDriver](#layerpglitedriver) · [LayerPgliteDriverQueries](#layerpglitedriverqueries) · [LayerPgliteDriverResult](#layerpglitedriverresult) · [LayerPgliteQuery](#layerpglitequery) · [LayerPgliteTransactionClient](#layerpglitetransactionclient) · [layerPostgresClusterCreate](#layerpostgresclustercreate) · [layerPostgresDatabaseCreate](#layerpostgresdatabasecreate) · [LayerQueryResult](#layerqueryresult) · [LayerSchemaDatabase](#layerschemadatabase) · [LayerSchemaReader](#layerschemareader) · [layerSessionRepositoryCreate](#layersessionrepositorycreate) · [layerSqlIdentifierQuote](#layersqlidentifierquote) · [LayerSqlQuery](#layersqlquery) · [LayerStructuredDatabase](#layerstructureddatabase) · [LayerStructuredQuery](#layerstructuredquery) · [LayerStructuredQueryResult](#layerstructuredqueryresult) · [LayerStructuredSecurity](#layerstructuredsecurity) · [layerSystemSchemaNameAssert](#layersystemschemanameassert) · [layerSystemSchemaNameCreate](#layersystemschemanamecreate) · [layerSystemSchemaRead](#layersystemschemaread) · [layerSystemTableReferenceCreate](#layersystemtablereferencecreate) · [layerTableDefine](#layertabledefine) · [LayerTransactionClient](#layertransactionclient) · [MigrationDatabase](#migrationdatabase) · [MigrationQueryResult](#migrationqueryresult) · [MigrationTransactionClient](#migrationtransactionclient)

### AuthRoleDatabase

```typescript
export type AuthRoleDatabase = {
    systemSchema?: string;
    query: (queryData: {
        text: string;
        values: readonly unknown[];
    }) => Promise<{
        rows: Record<string, any>[];
        rowCount: number | null;
    }>;
    transaction: <ResultData>(handlerData: (databaseData: AuthRoleDatabase) => Promise<ResultData>) => Promise<ResultData>;
};
```

### layerApiKeyRepositoryCreate

```typescript
export declare function layerApiKeyRepositoryCreate(repositoryOptions: {
    database: {
        query: (queryData: {
            text: string;
            values: readonly unknown[];
        }) => Promise<{
            rows: Record<string, unknown>[];
            rowCount: number | null;
        }>;
        transaction?: <ResultData>(handlerData: (databaseData: any) => Promise<ResultData>) => Promise<ResultData>;
    };
    secretCreate?: () => string;
}): Readonly<{

    issue(keyData: {
        keyId: string;
        userId: string;
        tenantId: string | null;
        permissions: readonly string[];
        expiresAt: string | number | Date;
    }): Promise<Readonly<{
        id: string;
        secret: string;
    }>>;

    resolve(apiKeyHash: string): Promise<{
        id: string;
        userId: string;
        tenantId: string | null;
        permissions: string[];
        status: "active" | "revoked";
        expiresAt: number;
    } | null>;

    revoke(keyIdentifier: string): Promise<any>;

    revokeWithCacheTag(keyIdentifier: string): Promise<any>;

    revokeAllByUser(userIdentifierData: string): Promise<any>;
}>;
```

### layerAuditRepositoryCreate

```typescript
export declare function layerAuditRepositoryCreate(repositoryOptions: {
    database: {
        query: (queryData: {
            text: string;
            values: readonly unknown[];
        }) => Promise<{
            rows: Record<string, unknown>[];
            rowCount: number | null;
        }>;
    };
    auditPepper: string;
    idCreate?: () => string;
    clock?: () => Date;
}): Readonly<{

    record(auditData: {
        requestId: string;
        operation: string;
        category: string;
        authenticationType: string;
        credentialId: string | null;
        userId: string | null;
        tenantId: string | null;
        remoteAddress: string;
        outcome: 'success' | 'denied' | 'failed';
        errorCode: string | null;
    }): Promise<string>;
}>;
```

### layerAuthChallengeRepositoryCreate

```typescript
export declare function layerAuthChallengeRepositoryCreate(repositoryOptions: {
    database: {
        systemSchema?: string;
        query: (queryData: {
            text: string;
            values: readonly unknown[];
        }) => Promise<{
            rows: Record<string, any>[];
            rowCount: number | null;
        }>;
        transaction: <ResultData>(handlerData: (databaseData: any) => Promise<ResultData>) => Promise<ResultData>;
    };
    challengePepper: string;
    clock?: () => number;
    identifierCreate?: () => string;
    tokenCreate?: () => string;
}): Readonly<{

    create(challengeData: {
        type: string;
        subject: string;
        userId?: string | null;
        payload?: Readonly<Record<string, unknown>>;
        attempts?: number;
        token?: string;
        expiresAt: number;
        database?: {
            query: Function;
        };
    }): Promise<Readonly<{
        challengeId: string;
        token: string;
        expiresAt: number;
    }>>;

    consume(challengeConsumeData: {
        type: string;
        token: string;
        effect?: (challengeData: Readonly<{
            challengeId: string;
            userId: string | null;
            payload: Readonly<Record<string, unknown>>;
        }>, databaseData: any) => Promise<void>;
    }): Promise<Readonly<{
        challengeId: string;
        userId: string | null;
        payload: any;
    }> | null>;
}>;
```

### layerAuthExternalIdentityRepositoryCreate

```typescript
export declare function layerAuthExternalIdentityRepositoryCreate(repositoryOptions: {
    database: {
        systemSchema?: string;
        query: (queryData: {
            text: string;
            values: readonly unknown[];
        }) => Promise<{
            rows: Record<string, any>[];
            rowCount: number | null;
        }>;
        transaction: <ResultData>(handlerData: (databaseData: any) => Promise<ResultData>) => Promise<ResultData>;
    };
    envelope: {
        seal: Function;
        open: Function;
    };
    subjectPepper: string;
    identifierCreate?: () => string;
}): Readonly<{

    find(providerIdentifierData: string, subjectData: string): Promise<Readonly<{
        externalIdentityId: string;
        userId: string;
        status: string;
        claims: any;
    }> | null>;

    create(identityData: {
        providerId: string;
        subject: string;
        userId: string;
        claims: Readonly<Record<string, unknown>>;
        database?: {
            query: Function;
        };
    }): Promise<Readonly<{
        externalIdentityId: string;
        userId: string;
    }>>;
}>;
```

### layerAuthInvitationRepositoryCreate

```typescript
export declare function layerAuthInvitationRepositoryCreate(repositoryOptions: {
    database: {
        systemSchema?: string;
        query: Function;
        transaction: <ResultData>(handlerData: (databaseData: any) => Promise<ResultData>) => Promise<ResultData>;
    };
    invitationPepper: string;
    tokenCreate?: () => string;
    identifierCreate?: () => string;
    clock?: () => number;
}): Readonly<{

    issue(invitationData: {
        email?: string | null;
        roles?: readonly string[];
        expiresAt: string | number | Date;
        createdBy?: string | null;
    }): Promise<Readonly<{
        id: string;
        token: string;
        expiresAt: number;
    }>>;

    consume<ResultData>(consumptionData: {
        token: string;
        email?: string | null;
        effect: (invitationData: Readonly<{
            id: string;
            roles: readonly string[];
        }>, databaseData: any) => Promise<ResultData>;
    }): Promise<ResultData | null>;
}>;
```

### layerAuthMailRepositoryCreate

```typescript
export declare function layerAuthMailRepositoryCreate(repositoryOptions: {
    database: {
        systemSchema?: string;
        query: (queryData: {
            text: string;
            values: readonly unknown[];
        }) => Promise<{
            rows: Record<string, any>[];
            rowCount: number | null;
        }>;
        transaction: <ResultData>(handlerData: (databaseData: any) => Promise<ResultData>) => Promise<ResultData>;
    };
    identifierCreate?: () => string;
}): Readonly<{

    enqueue(mailData: {
        templateName: string;
        recipientHash: string;
        recipientEncrypted: Uint8Array;
        locale: string;
        payloadEncrypted: Uint8Array;
        database?: {
            query: Function;
        };
    }): Promise<string>;

    lease(leaseData: {
        owner: string;
        limit: number;
        leaseUntil: number;
    }): Promise<readonly Readonly<{
        mailId: string;
        templateName: string;
        recipientEncrypted: Buffer<any>;
        locale: string;
        payloadEncrypted: Buffer<any>;
        attempts: number;
    }>[]>;

    sent(mailIdentifierData: string, ownerData: string): Promise<boolean>;

    failed(failureData: {
        mailId: string;
        owner: string;
        errorCode: string;
        nextAttemptAt: number;
        terminal: boolean;
    }): Promise<boolean>;
}>;
```

### layerAuthPasskeyRepositoryCreate

```typescript
export declare function layerAuthPasskeyRepositoryCreate(repositoryOptions: {
    database: {
        systemSchema?: string;
        query: Function;
        transaction: Function;
    };
}): Readonly<{

    create(passkeyData: {
        credentialId: string;
        userId: string;
        publicKey: Uint8Array;
        counter: number;
        transports: readonly string[];
        backupEligible: boolean;
        backupState: boolean;
        displayName: string;
    }, databaseData?: {
        query: Function;
    }): Promise<boolean>;

    findByCredentialId(credentialIdentifierData: string): Promise<Readonly<{
        credentialId: string;
        userId: string;
        publicKey: Buffer<any>;
        counter: number;
        transports: readonly string[];
        backupEligible: boolean;
        backupState: boolean;
        displayName: string;
        userStatus: string;
    }> | null>;

    listForUser(userIdentifierData: string): Promise<any>;

    counterAdvance(counterData: {
        credentialId: string;
        userId: string;
        expectedCounter: number;
        newCounter: number;
        backupState: boolean;
    }, databaseData?: {
        query: Function;
    }): Promise<boolean>;

    remove(credentialIdentifierData: string, userIdentifierData: string): Promise<boolean>;
}>;
```

### layerAuthRoleRepositoryCreate

```typescript
export declare function layerAuthRoleRepositoryCreate(repositoryOptions: {
    database: AuthRoleDatabase;
    identifierCreate?: () => string;
}): Readonly<{

    define(roleData: {
        name: string;
        permissions: readonly string[];
        status?: 'active' | 'disabled';
    }): Promise<Readonly<{
        id: string;
        name: string;
        status: string;
        permissions: readonly string[];
    }>>;

    assign(userIdentifierData: string, roleNameData: string, databaseData?: {
        query: Function;
    }): Promise<boolean>;

    remove(userIdentifierData: string, roleNameData: string): Promise<boolean>;

    listForUser(userIdentifierData: string): Promise<readonly Readonly<{
        id: string;
        name: string;
        permissions: readonly string[];
    }>[]>;

    usersList(roleNameData: string): Promise<readonly string[]>;
}>;
```

### layerAuthSessionRepositoryCreate

```typescript
export declare function layerAuthSessionRepositoryCreate(repositoryOptions: {
    database: {
        systemSchema?: string;
        query: (queryData: {
            text: string;
            values: readonly unknown[];
        }) => Promise<{
            rows: Record<string, any>[];
            rowCount: number | null;
        }>;
        transaction: <ResultData>(handlerData: (databaseData: any) => Promise<ResultData>) => Promise<ResultData>;
    };
    sessionPepper: string;
    clock?: () => number;
    identifierCreate?: () => string;
    tokenCreate?: () => string;
}): Readonly<{

    issue(sessionIssueData: {
        userId: string;
        tenantId?: string | null;
        permissions?: readonly string[];
        assurance?: readonly string[];
        idleExpiresAt: number;
        idleLifetimeMs?: number;
        absoluteExpiresAt: number;
    }): Promise<Readonly<{
        sessionId: string;
        sessionToken: string;
        csrfToken: string;
        idleExpiresAt: number;
        absoluteExpiresAt: number;
    }>>;

    resolve(sessionTokenData: string): Promise<Readonly<{
        id: string;
        userId: string;
        tenantId: string | null;
        permissions: readonly string[];
        csrfTokenHash: string;
        assurance: readonly string[];
        dataRevision: number;
        idleExpiresAt: number;
        absoluteExpiresAt: number;
        expiresAt: number;
        status: 'active';
    }> | null>;

    touch(sessionTokenData: string, touchIntervalMsData?: number): Promise<boolean>;

    list(userIdentifierData: string): Promise<readonly Readonly<{
        sessionId: string;
        assurance: readonly string[];
        lastSeenAt: number;
        idleExpiresAt: number;
        absoluteExpiresAt: number;
        createdAt: number;
    }>[]>;

    revokeById(sessionIdentifierData: string, userIdentifierData: string, reasonData?: string): Promise<boolean>;

    revokeAllByUser(userIdentifierData: string, reasonData?: string, databaseData?: {
        query: Function;
    }): Promise<number>;

    dataGetById(sessionIdentifierData: string, userIdentifierData: string): Promise<Readonly<{
        value: any;
        revision: number;
    }> | null>;

    dataReplaceById(sessionIdentifierData: string, userIdentifierData: string, expectedRevisionData: number, customDataValue: Readonly<Record<string, unknown>>): Promise<number | null>;

    dataGet(sessionTokenData: string): Promise<Readonly<{
        value: any;
        revision: number;
    }> | null>;

    dataReplace(sessionTokenData: string, expectedRevisionData: number, customDataValue: Readonly<Record<string, unknown>>): Promise<number | null>;
}>;
```

### layerAuthTotpRepositoryCreate

```typescript
export declare function layerAuthTotpRepositoryCreate(repositoryOptions: {
    database: {
        systemSchema?: string;
        query: Function;
        transaction: Function;
    };
    recoveryPepper: string;
    identifierCreate?: () => string;
}): Readonly<{

    pendingSave(credentialData: {
        userId: string;
        encryptedSecret: Uint8Array;
        keyId: string;
        algorithm: string;
        digits: number;
        period: number;
    }): Promise<boolean>;

    get(userIdentifierData: string, databaseData?: {
        query: Function;
    }): Promise<Readonly<{
        userId: string;
        encryptedSecret: Buffer<any>;
        keyId: string;
        algorithm: string;
        digits: number;
        period: number;
        lastCounter: number | null;
        confirmedAt: number | null;
    }> | null>;

    confirm(confirmationData: {
        userId: string;
        counter: number;
        recoveryCodes: readonly string[];
    }): Promise<any>;

    counterAdvance(counterData: {
        userId: string;
        expectedCounter: number | null;
        counter: number;
    }, databaseData?: {
        query: Function;
    }): Promise<boolean>;

    recoveryCodeConsume(userIdentifierData: string, recoveryCodeData: string, databaseData?: {
        query: Function;
    }): Promise<boolean>;

    recoveryCodesReplace(userIdentifierData: string, recoveryCodesData: readonly string[]): Promise<any>;

    remove(userIdentifierData: string): Promise<any>;
}>;
```

### layerAuthUserRepositoryCreate

```typescript
export declare function layerAuthUserRepositoryCreate(repositoryOptions: {
    database: {
        systemSchema?: string;
        query: (queryData: {
            text: string;
            values: readonly unknown[];
        }) => Promise<{
            rows: Record<string, any>[];
            rowCount: number | null;
        }>;
        transaction: <ResultData>(handlerData: (databaseData: any) => Promise<ResultData>) => Promise<ResultData>;
    };
    identifierCreate?: () => string;
}): Readonly<{

    create(userCreateData: {
        userId?: string;
        status?: 'pending' | 'active';
        identifier: {
            type: 'email' | 'username';
            normalized: string;
            display: string;
            verified?: boolean;
        };
        password?: {
            hash: string;
            parameters: Readonly<Record<string, unknown>>;
        } | null;
        afterCreate?: (createdData: Readonly<{
            userId: string;
            identifierId: string;
        }>, databaseData: any) => Promise<void>;
    }, databaseData?: {
        query: Function;
        transaction?: Function;
    }): Promise<Readonly<{
        userId: string;
        status: string;
    }>>;

    findByIdentifier(identifierTypeData: 'email' | 'username', identifierValueData: string): Promise<Readonly<{
        userId: string;
        status: string;
        identifierId: string;
        verified: boolean;
        passwordHash: string | null;
        passwordParameters: any;
    }> | null>;

    findById(userIdentifierData: string): Promise<Readonly<{
        userId: string;
        status: string;
        disabledReason: string | null;
        anonymizedAt: number | null;
    }> | null>;

    identifiersList(userIdentifierData: string): Promise<readonly Readonly<{
        identifierId: string;
        type: string;
        display: string;
        verified: boolean;
    }>[]>;

    permissionsResolve(userIdentifierData: string): Promise<readonly string[]>;

    statusSet(userIdentifierData: string, statusData: 'pending' | 'active' | 'disabled' | 'anonymization-pending' | 'anonymized', reasonData?: string | null, databaseData?: {
        systemSchema?: string;
        query: (queryData: {
            text: string;
            values: readonly unknown[];
        }) => Promise<{
            rows: Record<string, any>[];
            rowCount: number | null;
        }>;
        transaction: <ResultData>(handlerData: (databaseData: any) => Promise<ResultData>) => Promise<ResultData>;
    }): Promise<boolean>;

    anonymize(userIdentifierData: string): Promise<boolean>;

    identifierVerify(userIdentifierData: string, identityIdentifierData: string, databaseData?: {
        query: Function;
    }): Promise<boolean>;

    passwordReplace(userIdentifierData: string, passwordData: {
        hash: string;
        parameters: Readonly<Record<string, unknown>>;
    }, databaseData?: {
        query: Function;
    }): Promise<boolean>;
}>;
```

### layerCacheInvalidationRepositoryCreate

```typescript
export declare function layerCacheInvalidationRepositoryCreate(repositoryOptionsData: {
    database: {
        systemSchema?: string;
        query: (queryData: {
            text: string;
            values: readonly unknown[];
        }) => Promise<{
            rows: Record<string, unknown>[];
            rowCount: number | null;
        }>;
    };
}): Readonly<{

    record(invalidationData: {
        eventId: string;
        scope: 'global' | 'tenant' | 'user';
        tenantId: string | null;
        userId: string | null;
        tags: readonly string[];
    }): Promise<number>;

    readAfter(replayData: {
        cursor: number;
        limit?: number;
    }): Promise<readonly Readonly<{
        invalidationId: number;
        eventId: string;
        occurredAt: string;
    }>[]>;
}>;
```

### LayerClusterConnection

```typescript
export type LayerClusterConnection = {
    name: string;
    role: 'primary' | 'replica';
    connectionOptions: import('pg').PoolConfig;
};
```

### LayerClusterDatabase

```typescript
export type LayerClusterDatabase = {
    kind: 'postgres';
    systemSchema: string;
    connect: () => Promise<void>;
    query: (queryData: LayerClusterQuery) => Promise<LayerClusterQueryResult>;
    transaction: <ResultData>(handlerData: (transactionClientData: any) => Promise<ResultData>) => Promise<ResultData>;
    healthCheck: () => Promise<boolean>;
    close: () => Promise<void>;
    isReady: () => boolean;
};
```

### LayerClusterQuery

```typescript
export type LayerClusterQuery = {
    text: string;
    values: readonly unknown[];
    consistency?: 'strong' | 'eventual';
};
```

### LayerClusterQueryResult

```typescript
export type LayerClusterQueryResult = {
    rows: Record<string, unknown>[];
    rowCount: number | null;
};
```

### layerCommandResultRepositoryCreate

```typescript
export declare function layerCommandResultRepositoryCreate(transactionClient: {
    kind?: string;
    query: (queryData: {
        text: string;
        values: readonly unknown[];
    }) => Promise<{
        rows: Record<string, unknown>[];
        rowCount: number | null;
    }>;
}): Readonly<{

    find(commandIdentityData: {
        tenantKey: string;
        commandId: string;
    }): Promise<Record<string, unknown> | null>;

    save(commandResultData: {
        tenantKey: string;
        commandId: string;
        operation: string;
        result: unknown;
        actorKey?: string | null;
        requestDigest?: string | null;
    }): Promise<void>;
}>;
```

### LayerDatabaseError

```typescript
export declare class LayerDatabaseError extends Error {
    code: string;

    constructor(codeData: string, messageData: string);
}
```

### layerDatabaseFacadeCreate

```typescript
export declare const layerDatabaseFacadeCreate: (facadeOptionsData: {
    database: LayerStructuredDatabase;
    schema: unknown;
    security?: LayerStructuredSecurity;
    transaction?: boolean;
}) => Readonly<{
    where: Readonly<{

        equal(columnNameData: string, valueData: unknown): Readonly<{
            operator: string;
            column: string | null;
            value: unknown;
            children: readonly unknown[];
        }>;

        notEqual(columnNameData: string, valueData: unknown): Readonly<{
            operator: string;
            column: string | null;
            value: unknown;
            children: readonly unknown[];
        }>;

        greaterThan(columnNameData: string, valueData: unknown): Readonly<{
            operator: string;
            column: string | null;
            value: unknown;
            children: readonly unknown[];
        }>;

        lessThan(columnNameData: string, valueData: unknown): Readonly<{
            operator: string;
            column: string | null;
            value: unknown;
            children: readonly unknown[];
        }>;

        in(columnNameData: string, valuesData: readonly unknown[]): Readonly<{
            operator: string;
            column: string | null;
            value: unknown;
            children: readonly unknown[];
        }>;

        isNull(columnNameData: string): Readonly<{
            operator: string;
            column: string | null;
            value: unknown;
            children: readonly unknown[];
        }>;

        and(...descriptorsData: unknown[]): Readonly<{
            operator: string;
            column: string | null;
            value: unknown;
            children: readonly unknown[];
        }>;

        or(...descriptorsData: unknown[]): Readonly<{
            operator: string;
            column: string | null;
            value: unknown;
            children: readonly unknown[];
        }>;
    }>;

    table(tableNameData: string): Readonly<{
        findMany(queryOptionsData?: {}): Promise<readonly Readonly<Record<string, unknown>>[]>;
        findOne(queryOptionsData?: {}): Promise<Readonly<Record<string, unknown>> | null>;
        count(queryOptionsData?: {}): Promise<number>;
        exists(queryOptionsData?: {}): Promise<boolean>;

        insert(insertOptionsData: Record<string, unknown>): Promise<Readonly<Record<string, unknown>> | undefined>;

        update(updateOptionsData: Record<string, unknown>): Promise<readonly Readonly<Record<string, unknown>>[]>;

        delete(deleteOptionsData: Record<string, unknown>): Promise<readonly Readonly<Record<string, unknown>>[]>;
    }>;

    transaction(transactionHandlerData: (transactionFacadeData: ReturnType<typeof layerDatabaseFacadeCreate>) => Promise<unknown>): Promise<unknown>;

    sql(stringsData: TemplateStringsArray, ...valuesData: unknown[]): Promise<LayerStructuredQueryResult>;
}>;
```

### layerDatabaseLeaseManagerCreate

```typescript
export declare function layerDatabaseLeaseManagerCreate(managerOptionsData: {
    database: {
        systemSchema?: string;
        query: (queryData: {
            text: string;
            values: readonly unknown[];
        }) => Promise<{
            rows: Record<string, unknown>[];
            rowCount: number | null;
        }>;
    };
    owner: string;
}): Readonly<{

    acquire(leaseKeyData: string, timeToLiveData: number): Promise<boolean>;

    renew(leaseKeyData: string, timeToLiveData: number): Promise<boolean>;

    release(leaseKeyData: string): Promise<boolean>;
}>;
```

### layerDatabaseLegacyMigrate

```typescript
export declare function layerDatabaseLegacyMigrate(database: MigrationDatabase): Promise<boolean>;
```

### layerDatabaseMigrate

```typescript
export declare function layerDatabaseMigrate(database: MigrationDatabase): Promise<readonly number[]>;
```

### layerDatabaseRateLimiterCreate

```typescript
export declare function layerDatabaseRateLimiterCreate(limiterOptionsData: {
    database: LayerDurableRateDatabase;
    profiles?: Readonly<Record<'anonymous' | 'session' | 'bearer' | 'api-key', LayerDurableRateProfile>>;
    keyPrefix?: string;
    entryTtlMs?: number;
    clock?: () => number;
}): Readonly<{

    consume(rateRequestData: {
        profile: 'anonymous' | 'session' | 'bearer' | 'api-key';
        remoteAddress: string;
        credentialId?: string | null;
        sessionId: string | null;
        userId: string | null;
        tenantId: string | null;
        operation: string;
        cost: number;
    }): Promise<Readonly<{
        allowed: false;
        remaining: number;
        retryAfterMs: number;
    }> | Readonly<{
        allowed: true;
        remaining: number;
        retryAfterMs: number;
    }>>;
}>;
```

### layerDatabaseSchemaApply

```typescript
export declare function layerDatabaseSchemaApply(applyOptionsData: {
    database: LayerSchemaDatabase;
    schema: unknown;
    checksum: string;
    confirmDataLoss: boolean;
}): Promise<Readonly<{
    checksum: string;
    statements: number;
}>>;
```

### layerDatabaseSchemaDeclarationsCreate

```typescript
export declare function layerDatabaseSchemaDeclarationsCreate(schemaDefinitionData: ReturnType<typeof import('./schema-definition.js').layerDatabaseSchemaDefine>): string;
```

### layerDatabaseSchemaDefine

```typescript
export declare function layerDatabaseSchemaDefine(tableDefinitionsData: readonly ReturnType<typeof layerTableDefine>[]): Readonly<{
    tables: readonly any[];
}>;
```

### layerDatabaseSchemaDefinitionCheck

```typescript
export declare function layerDatabaseSchemaDefinitionCheck(schemaDefinitionData: unknown): schemaDefinitionData is ReturnType<typeof layerDatabaseSchemaDefine>;
```

### layerDatabaseSchemaPlan

```typescript
export declare function layerDatabaseSchemaPlan(planOptionsData: {
    database: LayerSchemaReader;
    schema: unknown;
}): Promise<Readonly<{
    checksum: string;
    schema: string;
    additiveStatements: readonly string[];
    changes: readonly (Readonly<{
        type: "table-add";
        table: any;
        blocking: false;
    }> | Readonly<{
        type: string;
        table: any;
        column: unknown;
        blocking: boolean;
    }> | Readonly<{
        type: "column-remove";
        table: any;
        column: any;
        blocking: false;
    }> | Readonly<{
        type: "table-remove";
        table: any;
        blocking: false;
    }>)[];
    blocking: boolean;
}>>;
```

### layerDatabaseSchemaSynchronize

```typescript
export declare function layerDatabaseSchemaSynchronize(synchronizeOptionsData: {
    database: LayerSchemaDatabase;
    schema: unknown;
}): Promise<Readonly<{
    checksum: string;
    schema: string;
    additiveStatements: readonly string[];
    changes: readonly (Readonly<{
        type: "table-add";
        table: any;
        blocking: false;
    }> | Readonly<{
        type: string;
        table: any;
        column: unknown;
        blocking: boolean;
    }> | Readonly<{
        type: "column-remove";
        table: any;
        column: any;
        blocking: false;
    }> | Readonly<{
        type: "table-remove";
        table: any;
        blocking: false;
    }>)[];
    blocking: boolean;
}>>;
```

### LayerDurableRateDatabase

```typescript
export type LayerDurableRateDatabase = Readonly<{
    systemSchema?: string;
    transaction: <ResultData>(handlerData: (transactionData: LayerDurableRateTransaction) => Promise<ResultData>) => Promise<ResultData>;
}>;
```

### LayerDurableRateProfile

```typescript
export type LayerDurableRateProfile = Readonly<{
    capacity: number;
    refillPerMinute: number;
}>;
```

### LayerDurableRateTransaction

```typescript
export type LayerDurableRateTransaction = Readonly<{
    query: (queryData: {
        text: string;
        values: readonly unknown[];
    }) => Promise<{
        rows: Record<string, unknown>[];
        rowCount: number | null;
    }>;
}>;
```

### layerPgliteDatabaseCreate

```typescript
export declare function layerPgliteDatabaseCreate(databaseOptions: {
    dataDirectory: string;
    systemSchema: string;
    pgliteCreate?: (dataDirectory: string) => Promise<LayerPgliteDriver>;
}): Readonly<{
    kind: "embedded";
    systemSchema: string;
    connect(): Promise<void>;

    query(queryData: LayerPgliteQuery): Promise<{
        rows: Record<string, unknown>[];
        rowCount: number;
    }>;

    transaction<TransactionResult>(transactionHandlerData: (transactionClient: LayerPgliteTransactionClient) => Promise<TransactionResult>): Promise<TransactionResult>;
    healthCheck(): Promise<boolean>;
    close(): Promise<void>;
    isReady(): boolean;
}>;
```

### LayerPgliteDriver

```typescript
export type LayerPgliteDriver = LayerPgliteDriverQueries & {
    transaction: <T>(handlerData: (transactionData: LayerPgliteDriverQueries) => Promise<T>) => Promise<T>;
    close: () => Promise<void>;
};
```

### LayerPgliteDriverQueries

```typescript
export type LayerPgliteDriverQueries = {
    query: (textData: string, valuesData: unknown[]) => Promise<LayerPgliteDriverResult>;
    exec: (textData: string) => Promise<LayerPgliteDriverResult[]>;
};
```

### LayerPgliteDriverResult

```typescript
export type LayerPgliteDriverResult = {
    rows: unknown[];
    rowCount?: number;
    affectedRows?: number;
};
```

### LayerPgliteQuery

```typescript
export type LayerPgliteQuery = {
    text: string;
    values: readonly unknown[];
};
```

### LayerPgliteTransactionClient

```typescript
export type LayerPgliteTransactionClient = {
    kind: 'embedded';
    systemSchema: string;
    query: (queryData: LayerPgliteQuery) => Promise<{
        rows: Record<string, unknown>[];
        rowCount: number | null;
    }>;
};
```

### layerPostgresClusterCreate

```typescript
export declare const layerPostgresClusterCreate: (clusterOptionsData: {
    connections: readonly LayerClusterConnection[];
    systemSchema: string;
    maximumConnectionsPerWorker?: number;
    maximumLagMs?: number;
    applicationName?: string;
    databaseCreate?: (connectionData: LayerClusterConnection, databaseOptionsData: Record<string, unknown>) => LayerClusterDatabase;
}) => Readonly<{
    kind: 'postgres';
    systemSchema: string;
    connect(): Promise<undefined>;

    query(queryData: LayerClusterQuery): Promise<LayerClusterQueryResult>;

    transaction<ResultData>(transactionHandlerData: (transactionClientData: any) => Promise<ResultData>): Promise<ResultData>;
    healthCheck(): Promise<boolean>;
    close(): Promise<void>;
    isReady(): boolean;
}>;
```

### layerPostgresDatabaseCreate

```typescript
export declare function layerPostgresDatabaseCreate(databaseOptions: {
    connectionString?: string;
    connectionOptions?: import('pg').PoolConfig;
    maxConnections?: number;
    connectionTimeoutMs?: number;
    statementTimeoutMs?: number;
    applicationName?: string;
    systemSchema?: string;
    poolCreate?: (poolOptions: import('pg').PoolConfig) => import('pg').Pool | Promise<import('pg').Pool>;
}): Readonly<{
    kind: "postgres";
    systemSchema: string;
    connect(): Promise<void>;

    query(queryData: LayerSqlQuery): Promise<LayerQueryResult>;

    transaction<TransactionResult>(transactionHandler: (transactionClient: LayerTransactionClient) => Promise<TransactionResult>): Promise<TransactionResult>;
    healthCheck(): Promise<boolean>;
    close(): Promise<void>;
    isReady(): boolean;
}>;
```

### LayerQueryResult

```typescript
export type LayerQueryResult = {
    rows: Record<string, unknown>[];
    rowCount: number | null;
};
```

### LayerSchemaDatabase

```typescript
export type LayerSchemaDatabase = LayerSchemaReader & {
    transaction: <ResultData>(handlerData: (transactionClientData: LayerSchemaReader) => Promise<ResultData>) => Promise<ResultData>;
};
```

### LayerSchemaReader

```typescript
export type LayerSchemaReader = {
    kind?: 'embedded' | 'postgres' | undefined;
    systemSchema?: string;
    query: (queryData: {
        text: string;
        values: readonly unknown[];
    }) => Promise<{
        rows: Record<string, unknown>[];
        rowCount: number | null;
    }>;
};
```

### layerSessionRepositoryCreate

```typescript
export declare function layerSessionRepositoryCreate(repositoryOptions: {
    database: {
        query: (queryData: {
            text: string;
            values: readonly unknown[];
        }) => Promise<{
            rows: Record<string, unknown>[];
            rowCount: number | null;
        }>;
        transaction?: <ResultData>(handlerData: (databaseData: any) => Promise<ResultData>) => Promise<ResultData>;
    };
    sessionPepper: string;
}): Readonly<{

    resolve(sessionIdentifier: string): Promise<{
        id: string;
        userId: string;
        tenantId: string | null;
        permissions: string[];
        csrfTokenHash: string;
        status: "active" | "revoked";
        expiresAt: number;
    } | null>;

    revoke(sessionIdentifier: string): Promise<any>;

    cacheTagCreate(sessionIdentifier: string): string;
}>;
```

### layerSqlIdentifierQuote

```typescript
export declare function layerSqlIdentifierQuote(identifierData: string): string;
```

### LayerSqlQuery

```typescript
export type LayerSqlQuery = {
    text: string;
    values: readonly unknown[];
};
```

### LayerStructuredDatabase

```typescript
export type LayerStructuredDatabase = {
    kind?: 'embedded' | 'postgres';
    systemSchema?: string;
    query: (queryData: LayerStructuredQuery) => Promise<LayerStructuredQueryResult>;
    transaction?: <ResultData>(handlerData: (transactionDatabaseData: LayerStructuredDatabase) => Promise<ResultData>) => Promise<ResultData>;
};
```

### LayerStructuredQuery

```typescript
export type LayerStructuredQuery = {
    text: string;
    values: readonly unknown[];
    consistency?: 'strong' | 'eventual';
};
```

### LayerStructuredQueryResult

```typescript
export type LayerStructuredQueryResult = {
    rows: Record<string, unknown>[];
    rowCount: number | null;
};
```

### LayerStructuredSecurity

```typescript
export type LayerStructuredSecurity = {
    tenantId?: string | null;
    userId?: string | null;
};
```

### layerSystemSchemaNameAssert

```typescript
export declare function layerSystemSchemaNameAssert(schemaNameData: unknown): string;
```

### layerSystemSchemaNameCreate

```typescript
export declare function layerSystemSchemaNameCreate(applicationNameData: string): string;
```

### layerSystemSchemaRead

```typescript
export declare function layerSystemSchemaRead(databaseData: unknown): string;
```

### layerSystemTableReferenceCreate

```typescript
export declare function layerSystemTableReferenceCreate(databaseData: unknown, tableNameData: string): string;
```

### layerTableDefine

```typescript
export declare function layerTableDefine(tableInputData: {
    name: string;
    scope: 'global' | 'tenant' | 'user';
    columns: Record<string, Readonly<{
        type: string;
        nullable?: boolean;
        generated?: 'uuid' | 'identity';
        default?: unknown;
    }>>;
    primaryKey: string;
}): Readonly<{
    name: string;
    scope: 'global' | 'tenant' | 'user';
    primaryKey: string;
    columns: readonly Readonly<{
        name: string;
        databaseName: string;
        type: 'boolean' | 'integer' | 'json' | 'number' | 'string' | 'timestamp' | 'uuid';
        nullable: boolean;
        generated: 'uuid' | 'identity' | null;
        defaultPresent: boolean;
        default: unknown;
    }>[];
}>;
```

### LayerTransactionClient

```typescript
export type LayerTransactionClient = {
    query: (queryData: LayerSqlQuery) => Promise<LayerQueryResult>;
};
```

### MigrationDatabase

```typescript
export type MigrationDatabase = {
    kind?: 'embedded' | 'postgres';
    systemSchema?: string;
    query: (queryData: {
        text: string;
        values: readonly unknown[];
    }) => Promise<MigrationQueryResult>;
    transaction: <ResultData>(handler: (transactionClient: MigrationTransactionClient) => Promise<ResultData>) => Promise<ResultData>;
};
```

### MigrationQueryResult

```typescript
export type MigrationQueryResult = {
    rows: Record<string, unknown>[];
    rowCount: number | null;
};
```

### MigrationTransactionClient

```typescript
export type MigrationTransactionClient = {
    kind?: 'embedded' | 'postgres';
    systemSchema?: string;
    query: (queryData: {
        text: string;
        values: readonly unknown[];
    }) => Promise<MigrationQueryResult>;
};
```

Далее: [карта возможностей](capabilities.md), [каталог API](api-catalog.md).
