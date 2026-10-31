---
title: Каталог публичных API
description: API компонентов, хранилища и серверных интеграций приложения.
audience: advanced
order: 255
status: documented
updated: 2026-10-31
---

# Каталог публичных API

[Карта возможностей](capabilities.md)

Начинайте с `@solcorp/layer` и [Context API](context-api.md), а не с ручного создания всех перечисленных объектов. Таблица перечисляет функции компонентов и серверных интеграций; внутренние инструменты сборки в неё не входят. Constants, types и nested methods описаны в связанных статьях/generated declarations; отсутствие отдельного примера на каждый низкоуровневый helper не означает отсутствующую функцию.

| Уровень | Как использовать |
| --- | --- |
| application | Обычный код компонентов, декларативная schema, локальное хранилище |
| advanced | Явно собранный server/browser host; вызывающий владеет auth, lifecycle, ресурсами и ошибками |
| experimental | Доверенный Plugin SDK кандидата; закрепляйте версии, не рассчитывайте на sandbox или автоматический loader |

Корневой `@solcorp/layer-auth` содержит server primitives. В браузере импортируйте только `@solcorp/layer-auth/browser`, серверный интеграционный entrypoint — `@solcorp/layer-auth/server`. `@solcorp/layer-server/system` предназначен для trusted system operations, не прикладного обхода security metadata. Публичный export не означает разрешение включать серверный модуль в браузер.

## Карта методов приложения

- [Шаблоны и компоненты](authoring-layer-js.md), [props/context](components.md), [store и boundaries](advanced-runtime.md).
- [Query/command](context-api.md), [cache и очередь](cache-outbox.md), [server operations](operations.md).
- [SQL CRUD](structured-data.md), [IndexedDB](indexeddb.md), [серверные события](server-events.md).
- [Auth](layer-auth.md), [роли и сессии](auth-advanced.md).
- [PWA capabilities](pwa-capabilities.md), [sharing](sharing.md), [push](web-push.md), [updates](application-updates.md), [links](links-navigation.md).
- [Viewport/keyboard](viewport.md), [routing](routing-ssr.md), [configuration](configuration-reference.md).

## Exports

<!-- generated-contract:start -->
| Пакет / export | Уровень | Руководство |
| --- | --- | --- |
| `@solcorp/layer-auth` / `LayerAuthError` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthAccountLifecycleCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthConfigurationCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthConfigurationRedact` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthContextExtensionCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthIdentifierCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthMailDeliveryCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthMailQueueCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthOAuthProviderCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthOAuthSigningJwksCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthOidcAdapterFactoryCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthOidcServiceCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthOperationDefinitionsCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthPasskeyOperationDefinitionsCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthPasskeyServiceCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthPasswordCheck` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthPasswordHashCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthPasswordLengthGet` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthPasswordVerify` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthRoleServiceCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthSecretEnvelopeCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthServerRuntimeCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthServiceCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthSessionDataCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthTotpOperationDefinitionsCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-auth` / `layerAuthTotpServiceCreate` | advanced | [API](layer-auth.md) |
| `@solcorp/layer-database` / `LayerDatabaseError` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerApiKeyRepositoryCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerAuditRepositoryCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerAuthChallengeRepositoryCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerAuthExternalIdentityRepositoryCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerAuthInvitationRepositoryCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerAuthMailRepositoryCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerAuthPasskeyRepositoryCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerAuthRoleRepositoryCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerAuthSessionRepositoryCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerAuthTotpRepositoryCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerAuthUserRepositoryCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerCacheInvalidationRepositoryCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerCommandResultRepositoryCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerDatabaseFacadeCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerDatabaseLeaseManagerCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerDatabaseLegacyMigrate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerDatabaseMigrate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerDatabaseRateLimiterCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerDatabaseSchemaApply` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerDatabaseSchemaDeclarationsCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerDatabaseSchemaDefine` | application | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerDatabaseSchemaDefinitionCheck` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerDatabaseSchemaPlan` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerDatabaseSchemaSynchronize` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerPgliteDatabaseCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerPostgresClusterCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerPostgresDatabaseCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerSessionRepositoryCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerSqlIdentifierQuote` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerSystemSchemaNameAssert` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerSystemSchemaNameCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerSystemSchemaRead` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerSystemTableReferenceCreate` | advanced | [API](structured-data.md) |
| `@solcorp/layer-database` / `layerTableDefine` | application | [API](structured-data.md) |
| `@solcorp/layer-events` / `layerCacheInvalidationSynchronizerCreate` | advanced | [API](server-events.md) |
| `@solcorp/layer-events` / `layerControlFrameCreate` | advanced | [API](server-events.md) |
| `@solcorp/layer-events` / `layerDatabaseEventBusCreate` | advanced | [API](server-events.md) |
| `@solcorp/layer-events` / `layerEventDistributionCreate` | advanced | [API](server-events.md) |
| `@solcorp/layer-events` / `layerEventFrameCreate` | advanced | [API](server-events.md) |
| `@solcorp/layer-events` / `layerEventRepositoryCreate` | advanced | [API](server-events.md) |
| `@solcorp/layer-events` / `layerEventStreamManagerCreate` | advanced | [API](server-events.md) |
| `@solcorp/layer-events` / `layerEventsOpenOperationDefinitionCreate` | advanced | [API](server-events.md) |
| `@solcorp/layer-events` / `layerHeartbeatFrameCreate` | advanced | [API](server-events.md) |
| `@solcorp/layer-events` / `layerHybridEventBusCreate` | advanced | [API](server-events.md) |
| `@solcorp/layer-events` / `layerOutboxPublisherCreate` | advanced | [API](server-events.md) |
| `@solcorp/layer-events` / `layerOutboxRepositoryCreate` | advanced | [API](server-events.md) |
| `@solcorp/layer-events` / `layerRedisCoordinationCreate` | advanced | [API](server-events.md) |
| `@solcorp/layer-events` / `layerRedisEventBusCreate` | advanced | [API](server-events.md) |
| `@solcorp/layer-events` / `layerRedisQueryCacheCreate` | advanced | [API](server-events.md) |
| `@solcorp/layer` / `ErrorBoundary` | application | [API](authoring-layer-js.md) |
| `@solcorp/layer` / `css` | application | [API](authoring-layer-js.md) |
| `@solcorp/layer` / `html` | application | [API](authoring-layer-js.md) |
| `@solcorp/layer` / `layerBatch` | application | [API](authoring-layer-js.md) |
| `@solcorp/layer` / `layerComponentCreate` | application | [API](authoring-layer-js.md) |
| `@solcorp/layer` / `layerComponentDefinitionCheck` | application | [API](authoring-layer-js.md) |
| `@solcorp/layer` / `layerComputedCreate` | application | [API](authoring-layer-js.md) |
| `@solcorp/layer` / `layerEffectCreate` | application | [API](authoring-layer-js.md) |
| `@solcorp/layer` / `layerOperationContractsCreate` | application | [API](authoring-layer-js.md) |
| `@solcorp/layer` / `layerPageCreate` | application | [API](authoring-layer-js.md) |
| `@solcorp/layer` / `layerReferenceCreate` | application | [API](authoring-layer-js.md) |
| `@solcorp/layer` / `layerSignalCreate` | application | [API](authoring-layer-js.md) |
| `@solcorp/layer` / `layerStoreCreate` | application | [API](authoring-layer-js.md) |
| `@solcorp/layer` / `layerTemplateResultCheck` | application | [API](authoring-layer-js.md) |
| `@solcorp/layer` / `repeat` | application | [API](authoring-layer-js.md) |
| `@solcorp/layer` / `when` | application | [API](authoring-layer-js.md) |
| `@solcorp/layer-notifications` / `layerNotificationsConfigurationCreate` | advanced | [API](web-push.md) |
| `@solcorp/layer-notifications` / `layerNotificationsRuntimeCreate` | advanced | [API](web-push.md) |
| `@solcorp/layer-notifications` / `layerNotificationsSecretsRead` | advanced | [API](web-push.md) |
| `@solcorp/layer-notifications` / `layerNotificationsVapidGenerate` | advanced | [API](web-push.md) |
| `@solcorp/layer-plugin-sdk` / `LayerPluginError` | experimental | [API](advanced-runtime.md) |
| `@solcorp/layer-plugin-sdk` / `layerPluginEngineCompatible` | experimental | [API](advanced-runtime.md) |
| `@solcorp/layer-plugin-sdk` / `layerPluginManifestValidate` | experimental | [API](advanced-runtime.md) |
| `@solcorp/layer-plugin-sdk` / `layerPluginRegistryCreate` | experimental | [API](advanced-runtime.md) |
| `@solcorp/layer-protocol` / `LayerError` | advanced | [API](operations.md) |
| `@solcorp/layer-protocol` / `layerErrorNormalize` | advanced | [API](operations.md) |
| `@solcorp/layer-protocol` / `layerErrorResponseDataCreate` | advanced | [API](operations.md) |
| `@solcorp/layer-protocol` / `layerProtocolDataValidatorCreate` | advanced | [API](operations.md) |
| `@solcorp/layer-protocol` / `layerProtocolValidatorCreate` | advanced | [API](operations.md) |
| `@solcorp/layer-protocol` / `layerSuccessResponseDataCreate` | advanced | [API](operations.md) |
| `@solcorp/layer-pwa` / `LayerPwaError` | advanced | [API](pwa-capabilities.md) |
| `@solcorp/layer-pwa` / `layerApplicationUpdatesCreate` | advanced | [API](pwa-capabilities.md) |
| `@solcorp/layer-pwa` / `layerLinkAssociationDocumentsCreate` | advanced | [API](pwa-capabilities.md) |
| `@solcorp/layer-pwa` / `layerLinkAssociationPathCheck` | advanced | [API](pwa-capabilities.md) |
| `@solcorp/layer-pwa` / `layerLinksConfigurationCreate` | advanced | [API](pwa-capabilities.md) |
| `@solcorp/layer-pwa` / `layerPwaCapabilitiesCreate` | advanced | [API](pwa-capabilities.md) |
| `@solcorp/layer-pwa` / `layerServiceWorkerRegister` | advanced | [API](pwa-capabilities.md) |
| `@solcorp/layer-pwa` / `layerServiceWorkerRuntimeCreate` | advanced | [API](pwa-capabilities.md) |
| `@solcorp/layer-pwa` / `layerUpdateCardCreate` | advanced | [API](pwa-capabilities.md) |
| `@solcorp/layer-pwa` / `layerUpdateCoordinatorCreate` | advanced | [API](pwa-capabilities.md) |
| `@solcorp/layer-pwa` / `layerUpdateDescriptorValidate` | advanced | [API](pwa-capabilities.md) |
| `@solcorp/layer-pwa` / `layerUpdateMetadataPathCheck` | advanced | [API](pwa-capabilities.md) |
| `@solcorp/layer-pwa` / `layerUpdatesConfigurationCreate` | advanced | [API](pwa-capabilities.md) |
| `@solcorp/layer-pwa` / `layerVersionCompare` | advanced | [API](pwa-capabilities.md) |
| `@solcorp/layer-pwa` / `layerVersionManifestValidate` | advanced | [API](pwa-capabilities.md) |
| `@solcorp/layer-pwa` / `layerWebAppManifestCreate` | advanced | [API](pwa-capabilities.md) |
| `@solcorp/layer-pwa` / `layerWebAppManifestValidate` | advanced | [API](pwa-capabilities.md) |
| `@solcorp/layer-render` / `batch` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `computed` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `effect` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerBindingObserve` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerCommitWait` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerComponentContextCreate` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerComponentDefinitionCreate` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerComponentHydrate` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerComponentInstanceHydrate` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerComponentInstanceMount` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerComponentInstanceRenderToString` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerComponentInvocationCreate` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerComponentMount` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerComponentRenderToString` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerErrorBoundaryValueCreate` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerErrorBoundaryValueResolve` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerReactiveValueRead` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerReferenceCreate` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerRenderDiagnosticsCreate` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerRenderErrorNormalize` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerRepeatValueCreate` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerRepeatValueResolve` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerSchedulerFlush` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerSlotContentCreate` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerWhenValueCreate` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `layerWhenValueResolve` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `signal` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-render` / `store` | advanced | [API](advanced-runtime.md) |
| `@solcorp/layer-router` / `LayerRouterError` | advanced | [API](routing-ssr.md) |
| `@solcorp/layer-router` / `layerRouteManifestCreate` | advanced | [API](routing-ssr.md) |
| `@solcorp/layer-router` / `layerRouteMatch` | advanced | [API](routing-ssr.md) |
| `@solcorp/layer-router` / `layerRouteMetadataDocumentCreate` | advanced | [API](routing-ssr.md) |
| `@solcorp/layer-router` / `layerRouterCreate` | advanced | [API](routing-ssr.md) |
| `@solcorp/layer-runtime` / `LayerRuntimeError` | advanced | [API](context-api.md) |
| `@solcorp/layer-runtime` / `layerApiClientCreate` | advanced | [API](context-api.md) |
| `@solcorp/layer-runtime` / `layerApplicationApiCreate` | advanced | [API](context-api.md) |
| `@solcorp/layer-runtime` / `layerCommandRuntimeCreate` | advanced | [API](context-api.md) |
| `@solcorp/layer-runtime` / `layerDevtoolsCreate` | advanced | [API](context-api.md) |
| `@solcorp/layer-runtime` / `layerDevtoolsPanelCreate` | advanced | [API](context-api.md) |
| `@solcorp/layer-runtime` / `layerEventRuntimeCreate` | advanced | [API](context-api.md) |
| `@solcorp/layer-runtime` / `layerEventStreamParserCreate` | advanced | [API](context-api.md) |
| `@solcorp/layer-runtime` / `layerEventSubscriptionsCreate` | advanced | [API](context-api.md) |
| `@solcorp/layer-runtime` / `layerLinksCreate` | advanced | [API](context-api.md) |
| `@solcorp/layer-runtime` / `layerMultiTabEventsCreate` | advanced | [API](context-api.md) |
| `@solcorp/layer-runtime` / `layerPostEventStreamCreate` | advanced | [API](context-api.md) |
| `@solcorp/layer-runtime` / `layerViewportCreate` | advanced | [API](context-api.md) |
| `@solcorp/layer-security` / `layerAuthenticationCreate` | advanced | [API](security-auth.md) |
| `@solcorp/layer-security` / `layerCookieValueGet` | advanced | [API](security-auth.md) |
| `@solcorp/layer-security` / `layerHeaderValueGet` | advanced | [API](security-auth.md) |
| `@solcorp/layer-security` / `layerIdentityCacheCreate` | advanced | [API](security-auth.md) |
| `@solcorp/layer-security` / `layerInMemoryRateLimiterCreate` | advanced | [API](security-auth.md) |
| `@solcorp/layer-security` / `layerOutboundUrlPolicyCreate` | advanced | [API](security-auth.md) |
| `@solcorp/layer-security` / `layerRateLimiterFailoverCreate` | advanced | [API](security-auth.md) |
| `@solcorp/layer-security` / `layerRedisRateLimiterCreate` | advanced | [API](security-auth.md) |
| `@solcorp/layer-security` / `layerSessionSecurityCreate` | advanced | [API](security-auth.md) |
| `@solcorp/layer-server` / `layerClientAddressResolve` | advanced | [API](server-runtime.md) |
| `@solcorp/layer-server` / `layerDiagnosticsCreate` | advanced | [API](server-runtime.md) |
| `@solcorp/layer-server` / `layerHttpRuntimeCreate` | advanced | [API](server-runtime.md) |
| `@solcorp/layer-server` / `layerOperationExecutorCreate` | advanced | [API](server-runtime.md) |
| `@solcorp/layer-server` / `layerOperationRegistryCreate` | advanced | [API](server-runtime.md) |
| `@solcorp/layer-server` / `layerRequestBodyRead` | advanced | [API](server-runtime.md) |
| `@solcorp/layer-server` / `layerTrustedProxyCreate` | advanced | [API](server-runtime.md) |
| `@solcorp/layer-storage` / `LayerStorageError` | advanced | [API](indexeddb.md) |
| `@solcorp/layer-storage` / `layerOfflineOutboxCreate` | advanced | [API](indexeddb.md) |
| `@solcorp/layer-storage` / `layerShareTargetInboxCreate` | advanced | [API](indexeddb.md) |
| `@solcorp/layer-storage` / `layerStorageOpen` | application | [API](indexeddb.md) |
| `@solcorp/layer-storage` / `layerStorageSchemaDefine` | application | [API](indexeddb.md) |
| `@solcorp/layer-storage` / `layerWorkerOutboxConfigurationClear` | advanced | [API](indexeddb.md) |
| `@solcorp/layer-storage` / `layerWorkerOutboxConfigure` | advanced | [API](indexeddb.md) |
| `@solcorp/layer-storage` / `layerWorkerOutboxDrainCreate` | advanced | [API](indexeddb.md) |
| `@solcorp/layer-storage` / `layerWorkerShareTargetCaptureCreate` | advanced | [API](indexeddb.md) |
<!-- generated-contract:end -->

## Ошибки и границы

Проверяйте nullable context/provider и освобождайте handles по lifecycle. Advanced adapters не дают автоматически гарантий managed runtime. Для методов ниже уровня статьи смотрите JSDoc/.d.ts: там заданы обязательные adapters, return type и ошибки. Не импортируйте неэкспортируемые `src/*` пути — они не являются поддерживаемым API.

Далее: [справочник конфигурации](configuration-reference.md), [ошибки](errors.md).
