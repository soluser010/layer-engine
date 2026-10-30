import {LayerRouterError} from './router-error.js';

const routeConfigurationFields = Object.freeze([
    'auth',
    'cache',
    'guard',
    'layout',
    'metadata',
    'offline',
    'permissions',
    'preload',
    'render'
]);
const routeMetadataMaximumLengths = /** @type {Readonly<Record<string, number>>} */ (Object.freeze({
    title: 200,
    description: 500,
    robots: 200,
    canonical: 2048,
    author: 200,
    keywords: 500,
    themeColor: 100,
    colorScheme: 100,
    applicationName: 200,
    language: 35,
    direction: 4,
    openGraphTitle: 200,
    openGraphDescription: 500,
    openGraphType: 100,
    openGraphUrl: 2048,
    openGraphImage: 2048,
    openGraphImageAlt: 500,
    openGraphSiteName: 200,
    openGraphLocale: 35,
    twitterCard: 30,
    twitterTitle: 200,
    twitterDescription: 500,
    twitterImage: 2048,
    twitterImageAlt: 500
}));
const routeMetadataUrlFields = Object.freeze([
    'canonical',
    'openGraphImage',
    'openGraphUrl',
    'twitterImage'
]);

/**
 * @typedef {'ssr' | 'csr'} LayerRouteRender
 * @typedef {'session' | 'none'} LayerRouteAuth
 * @typedef {'deny' | 'shell' | 'snapshot' | 'local'} LayerRouteOffline
 * @typedef {'private' | 'public' | 'no-store'} LayerRouteCache
 * @typedef {object} LayerRouteSource
 * @property {string} file
 * @property {unknown} [route]
 * @property {string | null} [layout]
 * @typedef {object} LayerRouteRecord
 * @property {string} id
 * @property {string} file
 * @property {string} path
 * @property {LayerRouteRender} render
 * @property {string | null} layout
 * @property {LayerRouteAuth} auth
 * @property {readonly string[]} permissions
 * @property {readonly string[]} preload
 * @property {string | null} guard
 * @property {LayerRouteOffline} offline
 * @property {LayerRouteCache} cache
 * @property {Readonly<Record<string, string>>} metadata
 * @property {RegExp} matcher
 * @property {readonly string[]} parameters
 * @property {number} score
 */

/**
 * @param {unknown} valueData
 * @returns {valueData is Record<string, unknown>}
 */
function plainObjectCheck(valueData) {
    //Checking the object boundary before reading route configuration fields.
    return typeof valueData === 'object' && valueData !== null && !Array.isArray(valueData);

}

/**
 * @param {string} messageData
 * @param {Readonly<Record<string, unknown>>} [detailsData]
 */
function routeManifestErrorCreate(messageData, detailsData = {}) {
    //Creating one stable build-time route diagnostic.
    return new LayerRouterError('ROUTE_MANIFEST_INVALID', messageData, detailsData);

}

/**
 * @param {unknown} listData
 * @param {string} fieldName
 */
function dottedNameListNormalize(listData, fieldName) {
    if (listData === undefined) {
        return Object.freeze([]);

    }

    //Checking the declared list before normalizing route operation names.
    if (!Array.isArray(listData) || listData.length > 64) {
        throw routeManifestErrorCreate(`${fieldName} must be an array with at most 64 entries.`);

    }

    const normalizedNames = listData.map(function routeNameNormalize(nameData) {
        //Checking every public operation or permission name.
        if (typeof nameData !== 'string' || !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(nameData)) {
            throw routeManifestErrorCreate(`${fieldName} contains an invalid dotted name.`);

        }

        return nameData;

    });

    if (new Set(normalizedNames).size !== normalizedNames.length) {
        throw routeManifestErrorCreate(`${fieldName} must not contain duplicates.`);

    }

    return Object.freeze(normalizedNames);

}

/**
 * @param {unknown} metadataData
 */
function routeMetadataNormalize(metadataData) {
    if (metadataData === undefined) {
        return Object.freeze({});

    }

    //Checking metadata before copying browser-visible values.
    if (!plainObjectCheck(metadataData) || Object.keys(metadataData).length > 24) {
        throw routeManifestErrorCreate('metadata must be an object with at most 24 supported entries.');

    }

    const normalizedMetadata = /** @type {Record<string, string>} */ ({});

    for (const [metadataName, metadataValue] of Object.entries(metadataData)) {
        const maximumLength = routeMetadataMaximumLengths[metadataName];

        //Restricting metadata to the documented bounded SEO and document fields.
        if (maximumLength === undefined || typeof metadataValue !== 'string' ||
            metadataValue.length < 1 || metadataValue.length > maximumLength ||
            [...metadataValue].some(function metadataCharacterUnsafe(characterData) {
                //Rejecting C0 controls and DEL without embedding controls in a regular expression.
                const characterCode = characterData.codePointAt(0) ?? 0;

                return characterCode < 32 || characterCode === 127;

            })) {
            throw routeManifestErrorCreate('metadata contains an invalid field or value.');

        }

        if (routeMetadataUrlFields.includes(metadataName) &&
            !/^(?:https?:\/\/[^\s]+|\/(?:[^/\s][^\s]*)?)$/i.test(metadataValue)) {
            throw routeManifestErrorCreate('metadata URL fields require HTTPS, HTTP, or a root-relative path.');

        }

        if (metadataName === 'language' && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(metadataValue)) {
            throw routeManifestErrorCreate('metadata language is invalid.');

        }

        if (metadataName === 'direction' && !['auto', 'ltr', 'rtl'].includes(metadataValue)) {
            throw routeManifestErrorCreate('metadata direction is invalid.');

        }

        if (metadataName === 'twitterCard' &&
            !['app', 'player', 'summary', 'summary_large_image'].includes(metadataValue)) {
            throw routeManifestErrorCreate('metadata twitterCard is invalid.');

        }

        normalizedMetadata[metadataName] = metadataValue;

    }

    return Object.freeze(normalizedMetadata);

}

/**
 * @param {unknown} routeData
 * @param {string | null | undefined} inheritedLayout
 */
function routeConfigurationNormalize(routeData, inheritedLayout) {
    let routeRecord;

    //Selecting the declared route configuration or an empty secure default.
    if (routeData === undefined) {
        routeRecord = {};

    } else {
        routeRecord = routeData;

    }

    //Checking the route object and rejecting configuration typos.
    if (!plainObjectCheck(routeRecord)) {
        throw routeManifestErrorCreate('route configuration must be an object.');

    }

    const unknownFields = Object.keys(routeRecord).filter(function unknownRouteFieldFind(fieldName) {
        //Finding fields outside the stable route contract.
        return !routeConfigurationFields.includes(fieldName);

    });

    if (unknownFields.length > 0) {
        throw routeManifestErrorCreate('route configuration contains unknown fields.', {
            fields: unknownFields
        });

    }

    const renderData = routeRecord.render ?? 'ssr';
    const authData = routeRecord.auth ?? 'session';
    const offlineData = routeRecord.offline ?? 'deny';
    const cacheData = routeRecord.cache ?? 'private';
    const layoutData = routeRecord.layout ?? inheritedLayout ?? null;
    const guardData = routeRecord.guard ?? null;

    //Checking bounded route policies before publishing the manifest.
    if (!['ssr', 'csr'].includes(String(renderData)) || !['session', 'none'].includes(String(authData)) ||
        !['deny', 'shell', 'snapshot', 'local'].includes(String(offlineData)) ||
        !['private', 'public', 'no-store'].includes(String(cacheData))) {
        throw routeManifestErrorCreate('route configuration contains an unsupported policy.');

    }

    if (layoutData !== null && (typeof layoutData !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(layoutData))) {
        throw routeManifestErrorCreate('layout must be null or a lowercase layout name.');

    }

    if (guardData !== null && (typeof guardData !== 'string' || !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(guardData))) {
        throw routeManifestErrorCreate('guard must be null or a dotted guard name.');

    }

    return Object.freeze({
        render: /** @type {LayerRouteRender} */ (renderData),
        layout: /** @type {string | null} */ (layoutData),
        auth: /** @type {LayerRouteAuth} */ (authData),
        permissions: dottedNameListNormalize(routeRecord.permissions, 'permissions'),
        preload: dottedNameListNormalize(routeRecord.preload, 'preload'),
        guard: /** @type {string | null} */ (guardData),
        offline: /** @type {LayerRouteOffline} */ (offlineData),
        cache: /** @type {LayerRouteCache} */ (cacheData),
        metadata: routeMetadataNormalize(routeRecord.metadata)
    });

}

/**
 * @param {string} staticSegment
 */
function regularExpressionEscape(staticSegment) {
    //Escaping static file segments before creating the route matcher.
    return staticSegment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

}

/**
 * @param {string} fileData
 */
function routePathCompile(fileData) {
    const normalizedFile = fileData.replaceAll('\\', '/');
    const pagePrefix = 'src/pages/';
    let componentSuffix = null;

    //Selecting the canonical JavaScript suffix before the legacy SFC suffix.
    if (normalizedFile.endsWith('.layer.js')) {
        componentSuffix = '.layer.js';

    } else if (normalizedFile.endsWith('.layer')) {
        componentSuffix = '.layer';

    }

    //Checking that route sources stay inside the declared page directory.
    if (!normalizedFile.startsWith(pagePrefix) || componentSuffix === null || normalizedFile.includes('../')) {
        throw routeManifestErrorCreate('route file must be a .layer.js or legacy .layer file inside src/pages.', {
            file: fileData
        });

    }

    const relativeFile = normalizedFile.slice(pagePrefix.length, -componentSuffix.length);
    const fileSegments = relativeFile.split('/');

    if (fileSegments.at(-1) === 'index') {
        fileSegments.pop();

    }

    const routeSegments = [];
    const matcherSegments = [];
    const parameterNames = [];
    const collisionSegments = [];
    let routeScore = 0;

    for (const [segmentIndex, fileSegment] of fileSegments.entries()) {
        const catchAllMatch = /^\[\.\.\.([a-z][a-zA-Z0-9]*)\]$/.exec(fileSegment);
        const parameterMatch = /^\[([a-z][a-zA-Z0-9]*)\]$/.exec(fileSegment);

        //Compiling a terminal catch-all segment.
        if (catchAllMatch !== null) {
            if (segmentIndex !== fileSegments.length - 1) {
                throw routeManifestErrorCreate('catch-all route segments must be terminal.', {
                    file: fileData
                });

            }

            const parameterName = String(catchAllMatch[1]);
            routeSegments.push(`*${parameterName}`);
            matcherSegments.push('(.+?)');
            parameterNames.push(parameterName);
            collisionSegments.push('*');
            routeScore += 1;

            continue;

        }

        //Compiling one dynamic route parameter.
        if (parameterMatch !== null) {
            const parameterName = String(parameterMatch[1]);
            routeSegments.push(`:${parameterName}`);
            matcherSegments.push('([^/]+)');
            parameterNames.push(parameterName);
            collisionSegments.push(':');
            routeScore += 10;

            continue;

        }

        //Checking and compiling one static route segment.
        if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(fileSegment)) {
            throw routeManifestErrorCreate('static route segments must use lowercase letters, numbers, and hyphens.', {
                file: fileData,
                segment: fileSegment
            });

        }

        routeSegments.push(fileSegment);
        matcherSegments.push(regularExpressionEscape(fileSegment));
        collisionSegments.push(fileSegment);
        routeScore += 100;

    }

    let pathData = '/';
    let matcherSource = '^/$';
    let collisionKey = '/';

    //Creating non-root path, matcher, and collision shapes from compiled segments.
    if (routeSegments.length > 0) {
        pathData = `/${routeSegments.join('/')}/`;
        matcherSource = `^/${matcherSegments.join('/')}/?$`;
        collisionKey = `/${collisionSegments.join('/')}/`;

    }

    return Object.freeze({
        id: relativeFile,
        path: pathData,
        matcher: new RegExp(matcherSource),
        parameters: Object.freeze(parameterNames),
        collisionKey,
        score: routeScore + fileSegments.length
    });

}

/**
 * @param {readonly LayerRouteSource[]} routeSources
 * @returns {readonly Readonly<LayerRouteRecord>[]}
 */
export function layerRouteManifestCreate(routeSources) {
    //Checking the complete source list before compiling any route.
    if (!Array.isArray(routeSources) || routeSources.length < 1 || routeSources.length > 10000) {
        throw routeManifestErrorCreate('route sources must contain between 1 and 10000 pages.');

    }

    const collisionKeys = new Map();
    const routeRecords = routeSources.map(function routeSourceCompile(routeSource) {
        //Checking each source record before reading its page file.
        if (!plainObjectCheck(routeSource) || typeof routeSource.file !== 'string') {
            throw routeManifestErrorCreate('each route source must contain a file.');

        }

        const pathData = routePathCompile(routeSource.file);
        const inheritedLayout = routeSource.layout;

        if (inheritedLayout !== undefined && inheritedLayout !== null && typeof inheritedLayout !== 'string') {
            throw routeManifestErrorCreate('source layout must be null or a layout name.');

        }

        const routeConfiguration = routeConfigurationNormalize(routeSource.route, inheritedLayout);
        const previousFile = collisionKeys.get(pathData.collisionKey);

        if (previousFile !== undefined) {
            throw routeManifestErrorCreate('route sources compile to the same route shape.', {
                file: routeSource.file,
                previousFile
            });

        }

        collisionKeys.set(pathData.collisionKey, routeSource.file);

        return Object.freeze({
            id: pathData.id,
            file: routeSource.file.replaceAll('\\', '/'),
            path: pathData.path,
            matcher: pathData.matcher,
            parameters: pathData.parameters,
            score: pathData.score,
            ...routeConfiguration
        });

    });

    //Sorting specific static routes before dynamic and catch-all routes.
    routeRecords.sort(function routeSpecificityCompare(firstRoute, secondRoute) {
        //Ordering by specificity and then by stable public path.
        return secondRoute.score - firstRoute.score || firstRoute.path.localeCompare(secondRoute.path);

    });

    return Object.freeze(routeRecords);

}

/**
 * @param {readonly Readonly<LayerRouteRecord>[]} routeManifest
 * @param {string} pathnameData
 */
export function layerRouteMatch(routeManifest, pathnameData) {
    //Checking the runtime lookup input before executing route matchers.
    if (!Array.isArray(routeManifest) || typeof pathnameData !== 'string' || !pathnameData.startsWith('/')) {
        throw new LayerRouterError('ROUTE_LOOKUP_INVALID', 'A route manifest and absolute pathname are required.');

    }

    const normalizedPathname = pathnameData.split(/[?#]/, 1)[0] ?? '/';

    for (const routeData of routeManifest) {
        const matchData = routeData.matcher.exec(normalizedPathname);

        if (matchData === null) {
            continue;

        }

        const parameterData = /** @type {Record<string, string>} */ ({});

        try {
            //Decoding each matched parameter without changing static route identity.
            for (const [parameterIndex, parameterName] of routeData.parameters.entries()) {
                parameterData[parameterName] = decodeURIComponent(matchData[parameterIndex + 1] ?? '');

            }

        } catch {
            throw new LayerRouterError('ROUTE_PARAMETER_INVALID', 'A route parameter is not valid UTF-8.', null);

        }

        return Object.freeze({
            route: routeData,
            params: Object.freeze(parameterData)
        });

    }

    return null;

}
