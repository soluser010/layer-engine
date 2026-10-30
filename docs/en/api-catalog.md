---
title: Public API catalog
description: Application APIs, trusted host primitives and build tooling.
audience: advanced
order: 255
status: release-candidate
updated: 2026-10-28
---

# Public API catalog

Start with `@solcorp/layer` and [Context API](context-api.md), not manual construction of every object listed below. This table lists callable exports of main entrypoints. Constants, types and nested methods are documented in linked guides/generated declarations. A missing standalone example for a low-level helper does not imply missing implementation.

| Level | Intended use |
| --- | --- |
| application | Normal component code, declarative schemas and local storage |
| advanced | Explicit server/browser hosts; callers own auth, lifecycle, resources and failures |
| tooling | CLI/compiler/testkit integration, not browser bundles |
| experimental | Trusted candidate Plugin SDK; pin versions and do not assume a sandbox or automatic loader |

Root `@solcorp/layer-auth` includes server primitives. Browser code must import only `@solcorp/layer-auth/browser`; use `@solcorp/layer-auth/server` for server integration. `@solcorp/layer-server/system` is for trusted system operations, not bypassing application security metadata. Public export does not mean a server module may be bundled into browsers.

## Application method map

- [Templates/components](authoring-layer-js.md), [props/context](components.md), [stores/boundaries](advanced-runtime.md).
- [Query/command](context-api.md), [cache/queue](cache-outbox.md), [server operations](operations.md).
- [SQL CRUD](structured-data.md), [IndexedDB](indexeddb.md), [server events](server-events.md).
- [Auth](layer-auth.md), [roles/sessions](auth-advanced.md).
- [PWA capabilities](pwa-capabilities.md), [sharing](sharing.md), [push](web-push.md), [updates](application-updates.md), [links](links-navigation.md).
- [Viewport/keyboard](viewport.md), [routing](routing-ssr.md), [configuration](configuration-reference.md).

## Exports

<!-- generated-contract:start -->
| Package / export | Level | Guide |
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
| `@solcorp/layer-cli` / `LayerCliError` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerApplicationServerRuntimeCreate` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerCliErrorDiagnosticCreate` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerCliErrorDiagnosticFormat` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerCliRun` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerConfigLoad` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerConfigPublicCreate` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerConfigValidate` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerDatabaseConfigurationCreate` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerDatabaseSchemaWorkflowRun` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerDevelopmentHostCreate` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerDevelopmentRequestHandlerCreate` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerDevelopmentServerCreate` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerDevelopmentWatchCreate` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerDoctorRun` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerDocumentationGenerate` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerInfrastructureConfigurationRedact` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerInfrastructureDatabaseRuntimeCreate` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerOperationFacadeCreate` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerProductionSecretsAssert` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerProjectBuild` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerProjectCreate` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerRedisConfigurationCreate` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-cli` / `layerRuntimeConfigurationCreate` | tooling | [API](installation-cli.md) |
| `@solcorp/layer-compiler` / `LayerCompilerError` | tooling | [API](advanced-runtime.md) |
| `@solcorp/layer-compiler` / `layerComponentCompile` | tooling | [API](advanced-runtime.md) |
| `@solcorp/layer-compiler` / `layerComponentRouteExtract` | tooling | [API](advanced-runtime.md) |
| `@solcorp/layer-compiler` / `layerComponentScriptValidate` | tooling | [API](advanced-runtime.md) |
| `@solcorp/layer-compiler` / `layerExpressionAssign` | tooling | [API](advanced-runtime.md) |
| `@solcorp/layer-compiler` / `layerExpressionCompile` | tooling | [API](advanced-runtime.md) |
| `@solcorp/layer-compiler` / `layerExpressionEvaluate` | tooling | [API](advanced-runtime.md) |
| `@solcorp/layer-compiler` / `layerJavascriptComponentCompile` | tooling | [API](advanced-runtime.md) |
| `@solcorp/layer-compiler` / `layerOperationContractsCompile` | tooling | [API](advanced-runtime.md) |
| `@solcorp/layer-compiler` / `layerScopedCssCompile` | tooling | [API](advanced-runtime.md) |
| `@solcorp/layer-compiler` / `layerStylesheetCompile` | tooling | [API](advanced-runtime.md) |
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
| `@solcorp/layer-docs` / `layerGuideServe` | tooling | [API](installation-cli.md) |
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
| `@solcorp/layer-testkit` / `layerErrorResponseFixtureCreate` | tooling | [API](testing.md) |
| `@solcorp/layer-testkit` / `layerEventFixtureCreate` | tooling | [API](testing.md) |
| `@solcorp/layer-testkit` / `layerOperationFixtureCreate` | tooling | [API](testing.md) |
| `@solcorp/layer-testkit` / `layerRequestFixtureCreate` | tooling | [API](testing.md) |
| `@solcorp/layer-testkit` / `layerSuccessResponseFixtureCreate` | tooling | [API](testing.md) |
<!-- generated-contract:end -->

## Failures and boundaries

Check nullable context/providers and dispose handles with their lifecycle. Advanced adapters do not automatically inherit managed-runtime guarantees. Consult JSDoc/.d.ts for lower-level adapter requirements, return types and failures. Do not import unexported `src/*` paths; they are not supported API.

Next: [configuration reference](configuration-reference.md), [errors](errors.md).
