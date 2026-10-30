import {LayerPwaError} from './pwa-error.js';

const globalScope = /** @type {any} */ (globalThis);
/** @type {{createScriptURL: (scriptUrl: string) => unknown} | null} */
let serviceWorkerScriptPolicy = null;

/**
 * @param {string} hostname
 */
function developmentHostnameCheck(hostname) {
    const normalizedHostname = hostname.toLowerCase();

    //Allowing only browser-defined local development hosts without weakening production transport.
    return normalizedHostname === 'localhost' ||
        normalizedHostname.endsWith('.localhost') ||
        normalizedHostname === '[::1]' ||
        normalizedHostname.startsWith('127.');

}

/**
 * @param {string} scriptUrl
 * @param {{hostname: string, origin?: string, protocol?: string, port?: string}} locationData
 */
function serviceWorkerScriptUrlValidate(scriptUrl, locationData) {
    let scriptUrlData;
    let locationProtocol = 'https:';
    let locationPort = '';
    let locationOrigin;

    //Reading the complete browser location when the caller provides it.
    if (typeof locationData.protocol === 'string' && locationData.protocol.length > 0) {
        locationProtocol = locationData.protocol;

    }
    if (typeof locationData.port === 'string' && locationData.port.length > 0) {
        locationPort = `:${locationData.port}`;

    }

    //Building the test-compatible origin only when the native value is unavailable.
    if (typeof locationData.origin === 'string' && locationData.origin.length > 0) {
        locationOrigin = locationData.origin;

    } else {
        locationOrigin = `${locationProtocol}//${locationData.hostname}${locationPort}`;

    }

    //Parsing the complete URL before it reaches the browser script sink.
    try {
        scriptUrlData = new URL(scriptUrl, `${locationOrigin}/`);

    } catch (scriptUrlError) {
        throw new LayerPwaError(
            'PWA_SERVICE_WORKER_URL_INVALID',
            'The Service Worker script URL is invalid.',
            {
                cause: scriptUrlError
            }
        );

    }

    //Allowing only one same-origin HTTP(S) script without credentials or fragments.
    if (
        !['http:', 'https:'].includes(scriptUrlData.protocol) ||
        scriptUrlData.origin !== locationOrigin ||
        scriptUrlData.username.length > 0 ||
        scriptUrlData.password.length > 0 ||
        scriptUrlData.hash.length > 0
    ) {
        throw new LayerPwaError(
            'PWA_SERVICE_WORKER_URL_INVALID',
            'The Service Worker script URL must be same-origin HTTP(S) without credentials or a fragment.'
        );

    }

    //CallBack THE STRING
    return scriptUrlData.href;

}

/**
 * @param {string} scriptUrl
 * @param {string} validatedScriptUrl
 * @param {{createPolicy: (name: string, policyOptions: {createScriptURL: (scriptUrl: string) => string}) => {createScriptURL: (scriptUrl: string) => unknown}} | undefined} trustedTypesData
 */
function serviceWorkerTrustedScriptUrlCreate(scriptUrl, validatedScriptUrl, trustedTypesData) {
    //Keeping native strings for browsers that do not implement Trusted Types.
    if (trustedTypesData === undefined || typeof trustedTypesData.createPolicy !== 'function') {
        //CallBack THE STRING
        return scriptUrl;

    }

    if (serviceWorkerScriptPolicy === null) {
        //Creating one private policy whose input has already passed the same-origin validator.
        serviceWorkerScriptPolicy = trustedTypesData.createPolicy('layer-service-worker', {
            createScriptURL(scriptUrlData) {
                //CallBack THE STRING
                return scriptUrlData;

            }
        });

    }

    //CallBack THE TRUSTED SCRIPT URL
    return serviceWorkerScriptPolicy.createScriptURL(validatedScriptUrl);

}

/**
 * @param {{
 *     scriptUrl?: string,
 *     scope?: string,
 *     serviceWorkerContainer?: Pick<ServiceWorkerContainer, 'register'>,
 *     location?: Pick<Location, 'hostname'>,
 *     secureContext?: boolean
 * }} [registrationOptions]
 */
export async function layerServiceWorkerRegister(registrationOptions = {}) {
    const scriptUrl = registrationOptions.scriptUrl ?? '/layer-service-worker.js';
    const scope = registrationOptions.scope ?? '/';
    const serviceWorkerContainer = registrationOptions.serviceWorkerContainer ?? globalThis.navigator?.serviceWorker;
    const locationData = registrationOptions.location ?? globalThis.location;
    const secureContext = registrationOptions.secureContext ?? globalThis.isSecureContext === true;
    const trustedTypesData = globalScope.trustedTypes;

    //Rejecting production HTTP before the browser produces an ambiguous registration failure.
    if (locationData === undefined || (!secureContext && !developmentHostnameCheck(locationData.hostname))) {
        throw new LayerPwaError(
            'PWA_SECURE_CONTEXT_REQUIRED',
            'Service Worker registration requires HTTPS or a localhost development context.'
        );

    }

    //Keeping unsupported browsers visible to application fallback logic.
    if (serviceWorkerContainer === undefined || typeof serviceWorkerContainer.register !== 'function') {
        throw new LayerPwaError(
            'PWA_SERVICE_WORKER_UNAVAILABLE',
            'Service Worker registration is unavailable in this browser.'
        );

    }

    const validatedScriptUrl = serviceWorkerScriptUrlValidate(scriptUrl, locationData);
    const trustedScriptUrl = serviceWorkerTrustedScriptUrlCreate(
        scriptUrl,
        validatedScriptUrl,
        trustedTypesData
    );

    return serviceWorkerContainer.register(
        /** @type {string | URL} */ (/** @type {unknown} */ (trustedScriptUrl)),
        {
            scope,
            type: 'module',
            updateViaCache: 'none'
        }
    );

}
