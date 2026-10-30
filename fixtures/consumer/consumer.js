import {
    LAYER_PROTOCOL_VERSION,
    layerProtocolValidatorCreate
} from '@solcorp/layer-protocol';
import {
    layerNotificationsConfigurationCreate,
    layerNotificationsRuntimeCreate,
    layerNotificationsVapidGenerate
} from '@solcorp/layer-notifications';
import {
    css,
    html,
    layerComponentCreate,
    layerPageCreate,
    layerSignalCreate
} from '@solcorp/layer';
import {
    LAYER_PROTOCOL_VERSION as LAYER_PROTOCOL_CONSTANT_VERSION
} from '@solcorp/layer-protocol/constants';
import {
    layerPwaCapabilitiesCreate,
    layerServiceWorkerRegister,
    layerServiceWorkerRuntimeCreate,
    layerVersionManifestValidate,
    layerWebAppManifestCreate,
    layerWebAppManifestValidate
} from '@solcorp/layer-pwa';
import {
    layerComponentCompile,
    layerComponentRouteExtract
} from '@solcorp/layer-compiler';
import {
    layerExpressionAssign,
    layerExpressionEvaluate
} from '@solcorp/layer-compiler/expression';
import {
    layerConfigValidate,
    layerDevelopmentHostCreate,
    layerDevelopmentRequestHandlerCreate,
    layerDocumentationGenerate
} from '@solcorp/layer-cli';
import {
    layerApiKeyRepositoryCreate,
    layerAuditRepositoryCreate,
    layerDatabaseMigrate,
    layerPostgresDatabaseCreate
} from '@solcorp/layer-database';
import {
    layerAuthConfigurationCreate,
    layerAuthIdentifierCreate
} from '@solcorp/layer-auth';
import {layerAuthBrowserCreate} from '@solcorp/layer-auth/browser';
import {layerAuthServiceCreate} from '@solcorp/layer-auth/server';
import {
    layerEventRepositoryCreate,
    layerEventStreamManagerCreate
} from '@solcorp/layer-events';
import {
    layerAuthenticationCreate,
    layerInMemoryRateLimiterCreate,
    layerOutboundUrlPolicyCreate,
    layerRedisRateLimiterCreate,
    layerSessionSecurityCreate
} from '@solcorp/layer-security';
import {
    layerComponentContextCreate,
    layerComponentDefinitionCreate,
    layerComponentInstanceRenderToString,
    layerComponentRenderToString,
    layerSlotContentCreate,
    signal
} from '@solcorp/layer-render';
import {
    layerApiClientCreate,
    layerApplicationApiCreate,
    layerCommandRuntimeCreate,
    layerEventSubscriptionsCreate,
    layerEventRuntimeCreate,
    layerDevtoolsCreate,
    layerDevtoolsPanelCreate,
    layerPostEventStreamCreate
} from '@solcorp/layer-runtime';
import {layerPluginRegistryCreate} from '@solcorp/layer-plugin-sdk';
import {
    layerRouteManifestCreate,
    layerRouterCreate
} from '@solcorp/layer-router';
import {
    layerHttpRuntimeCreate,
    layerOperationExecutorCreate,
    layerOperationRegistryCreate
} from '@solcorp/layer-server';
import {
    layerOfflineOutboxCreate,
    layerShareTargetInboxCreate,
    layerStorageOpen,
    layerStorageSchemaDefine,
    layerWorkerOutboxConfigurationClear,
    layerWorkerOutboxConfigure,
    layerWorkerOutboxDrainCreate,
    layerWorkerShareTargetCaptureCreate
} from '@solcorp/layer-storage';
import {
    layerOperationFixtureCreate,
    layerRequestFixtureCreate
} from '@solcorp/layer-testkit';

const protocolValidator = layerProtocolValidatorCreate();
const operationRegistry = layerOperationRegistryCreate();
const operationData = layerOperationFixtureCreate();
const requestData = layerRequestFixtureCreate();

operationRegistry.define(operationData);

if (
    LAYER_PROTOCOL_VERSION !== 1
    || LAYER_PROTOCOL_CONSTANT_VERSION !== LAYER_PROTOCOL_VERSION
    || !protocolValidator.requestValidate(requestData).valid
) {
    throw new Error('The protocol consumer fixture failed.');
}

if (!operationRegistry.has(operationData.name)) {
    throw new Error('The server consumer fixture failed.');
}

const titleSignal = signal('Layer-Engine');
const publicPageData = layerPageCreate({
    render: 'ssr',
    auth: 'none',
    offline: 'shell',
    cache: 'public',
    metadata: {
        title: 'Consumer page',
        language: 'en',
        direction: 'ltr'
    }
});
const publicTitleSignal = layerSignalCreate('Layer public API');
const publicComponentStyles = css`.ConsumerTitle { display: block; }`;
const publicComponentDefinition = layerComponentCreate(function ConsumerTitle(){
    return html`<h1 class="ConsumerTitle">${publicTitleSignal}</h1>`;

});
const componentData = layerComponentCompile('<template><h1>{{ title }}</h1></template>', {
    componentId: 'consumer/title'
});
const ssrResult = layerComponentRenderToString(componentData, {
    title: titleSignal
});

if (!ssrResult.html.includes('Layer-Engine')) {
    throw new Error('The compiler and render consumer fixture failed.');
}

if (
    publicPageData.render !== 'ssr' ||
    publicComponentStyles.includes('.ConsumerTitle') === false ||
    typeof publicComponentDefinition.render !== 'function'
) {
    throw new Error('The public Layer authoring API consumer fixture failed.');

}

const componentDefinition = layerComponentDefinitionCreate({
    component: componentData,
    props: {
        title: {required: true}
    },
    setup(/** @type {any} */ _setupContext) {
        return {ready: true};
    }
});
const componentResult = layerComponentInstanceRenderToString(componentDefinition, {
    props: {title: 'Defined component'},
    context: layerComponentContextCreate(),
    slots: {}
});

if (!componentResult.html.includes('Defined component')) {
    throw new Error('The component-definition consumer fixture failed.');
}

const publicFactories = [
    layerNotificationsConfigurationCreate,
    layerNotificationsRuntimeCreate,
    layerNotificationsVapidGenerate,
    layerApiKeyRepositoryCreate,
    layerAuthBrowserCreate,
    layerAuthConfigurationCreate,
    layerAuthIdentifierCreate,
    layerAuthServiceCreate,
    layerComponentCreate,
    layerAuditRepositoryCreate,
    layerDatabaseMigrate,
    layerPostgresDatabaseCreate,
    layerEventRepositoryCreate,
    layerEventStreamManagerCreate,
    layerAuthenticationCreate,
    layerInMemoryRateLimiterCreate,
    layerOutboundUrlPolicyCreate,
    layerRedisRateLimiterCreate,
    layerSessionSecurityCreate,
    layerHttpRuntimeCreate,
    layerOperationExecutorCreate,
    layerComponentCompile,
    layerComponentRouteExtract,
    layerExpressionAssign,
    layerExpressionEvaluate,
    layerComponentContextCreate,
    layerComponentDefinitionCreate,
    layerComponentInstanceRenderToString,
    layerComponentRenderToString,
    layerSlotContentCreate,
    layerConfigValidate,
    layerDevelopmentHostCreate,
    layerDevelopmentRequestHandlerCreate,
    layerDocumentationGenerate,
    layerDevtoolsCreate,
    layerDevtoolsPanelCreate,
    layerApiClientCreate,
    layerApplicationApiCreate,
    layerCommandRuntimeCreate,
    layerEventSubscriptionsCreate,
    layerEventRuntimeCreate,
    layerPostEventStreamCreate,
    layerPluginRegistryCreate,
    layerRouteManifestCreate,
    layerRouterCreate,
    layerPwaCapabilitiesCreate,
    layerPageCreate,
    layerServiceWorkerRegister,
    layerServiceWorkerRuntimeCreate,
    layerVersionManifestValidate,
    layerWebAppManifestCreate,
    layerWebAppManifestValidate,
    layerStorageOpen,
    layerSignalCreate,
    layerStorageSchemaDefine,
    layerOfflineOutboxCreate,
    layerShareTargetInboxCreate,
    layerWorkerOutboxConfigurationClear,
    layerWorkerOutboxConfigure,
    layerWorkerOutboxDrainCreate,
    layerWorkerShareTargetCaptureCreate,
    signal
];

//Checking real ESM resolution and generated declarations for every implemented package.
for (const publicFactory of publicFactories) {
    if (typeof publicFactory !== 'function') {
        throw new Error('A public Layer-Engine factory is unavailable.');

    }

}
