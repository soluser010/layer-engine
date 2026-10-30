export {layerPwaCapabilitiesCreate} from './capabilities.js';
export {layerLinksConfigurationCreate} from './links-configuration.js';
/** @typedef {import('./links-configuration.js').LayerLinksConfiguration} LayerLinksConfiguration */
/** @typedef {import('./links-configuration.js').LayerAndroidAssociation} LayerAndroidAssociation */
/** @typedef {import('./links-configuration.js').LayerAppleAssociation} LayerAppleAssociation */
/** @typedef {import('./links-configuration.js').LayerWindowsAssociation} LayerWindowsAssociation */
/** @typedef {import('./links-configuration.js').LayerWebAssociation} LayerWebAssociation */
export {layerLinkAssociationDocumentsCreate, layerLinkAssociationPathCheck} from './link-associations.js';
export {LayerPwaError} from './pwa-error.js';
export {layerServiceWorkerRegister} from './registration.js';
export {layerServiceWorkerRuntimeCreate} from './service-worker.js';
export {layerUpdateCoordinatorCreate} from './update-coordinator.js';
export {layerApplicationUpdatesCreate} from './application-updates.js';
export {layerUpdateCardCreate} from './update-card.js';
export {LAYER_UPDATE_BUILD_PLACEHOLDER, layerUpdateDescriptorValidate, layerUpdatesConfigurationCreate,
    layerUpdateMetadataPathCheck} from './update-protocol.js';
/** @typedef {import('./application-updates.js').LayerApplicationUpdateState} LayerApplicationUpdateState */
export {
    layerVersionCompare,
    layerVersionManifestValidate
} from './version-manifest.js';
export {layerWebAppManifestCreate} from './web-app-manifest.js';
export {layerWebAppManifestValidate} from './web-app-manifest-validator.js';
