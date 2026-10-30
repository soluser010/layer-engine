import {layerRouteMatch} from './route-manifest.js';
import {LayerRouterError} from './router-error.js';

/**
 * @typedef {import('./route-manifest.js').LayerRouteRecord} LayerRouteRecord
 * @typedef {{authenticated: boolean, permissions?: readonly string[]}} LayerRouteIdentity
 * @typedef {object} LayerRouterOptions
 * @property {readonly Readonly<LayerRouteRecord>[]} manifest
 * @property {() => LayerRouteIdentity | Promise<LayerRouteIdentity>} [identityGet]
 * @property {() => boolean} [onlineGet]
 * @property {(guardName: string, contextData: Readonly<{route: Readonly<LayerRouteRecord>, params: Readonly<Record<string, string>>, identity: LayerRouteIdentity}>) => boolean | string | Promise<boolean | string>} [guardRun]
 * @property {(operationName: string, payloadData: Readonly<{params: Readonly<Record<string, string>>}>) => unknown | Promise<unknown>} [preload]
 * @property {Pick<History, 'pushState' | 'replaceState'>} [history]
 */

/**
 * @param {LayerRouterOptions} routerOptions
 */
export function layerRouterCreate(routerOptions) {
    //Checking the immutable route manifest before accepting navigation work.
    if (routerOptions === null || typeof routerOptions !== 'object' || !Array.isArray(routerOptions.manifest)) {
        throw new TypeError('Router options must contain a route manifest.');

    }

    let currentRouteMatch = /** @type {ReturnType<typeof layerRouteMatch>} */ (null);
    let navigationSequence = 0;

    /**
     * @param {string} pathnameData
     * @param {{replace?: boolean, history?: boolean, scrollX?: number, scrollY?: number}} [navigationOptions]
     */
    async function navigate(pathnameData, navigationOptions = {}) {
        const navigationIdentifier = ++navigationSequence;
        const routeMatch = layerRouteMatch(routerOptions.manifest, pathnameData);

        function supersededResultCreate() {
            //Returning an inert result that cannot replace the latest route.
            return Object.freeze({
                status: 'superseded',
                pathname: pathnameData,
                route: routeMatch?.route ?? null,
                params: routeMatch?.params ?? Object.freeze({})
            });

        }

        function supersededCheck() {
            //Comparing this navigation with the most recently requested route.
            return navigationIdentifier !== navigationSequence;

        }

        //Returning a stable not-found boundary without leaking matcher details.
        if (routeMatch === null) {
            return Object.freeze({
                status: 'not-found',
                pathname: pathnameData
            });

        }

        const onlineStatus = routerOptions.onlineGet?.() ?? true;

        if (!onlineStatus && routeMatch.route.offline === 'deny') {
            return Object.freeze({
                status: 'offline',
                route: routeMatch.route,
                params: routeMatch.params
            });

        }

        //Loading trusted application identity before guards and preload operations.
        let identityData;

        if (routerOptions.identityGet === undefined) {
            identityData = {
                authenticated: false,
                permissions: Object.freeze([])
            };

        } else {
            identityData = await routerOptions.identityGet();

        }

        if (supersededCheck()) {
            return supersededResultCreate();

        }

        const identityPermissions = new Set(identityData.permissions ?? []);

        if (routeMatch.route.auth === 'session' && identityData.authenticated !== true) {
            return Object.freeze({
                status: 'auth-required',
                route: routeMatch.route,
                params: routeMatch.params
            });

        }

        const missingPermission = routeMatch.route.permissions.find(function routePermissionFind(/** @type {string} */ permissionName) {
            //Finding the first route permission absent from trusted identity.
            return !identityPermissions.has(permissionName);

        });

        if (missingPermission !== undefined) {
            return Object.freeze({
                status: 'forbidden',
                route: routeMatch.route,
                params: routeMatch.params,
                permission: missingPermission
            });

        }

        if (routeMatch.route.guard !== null) {
            if (routerOptions.guardRun === undefined) {
                throw new LayerRouterError('ROUTE_GUARD_UNAVAILABLE', 'The route declares a guard but no guard runner is configured.', {
                    guard: routeMatch.route.guard
                });

            }

            //Running the named guard after identity checks and before preload.
            const guardResult = await routerOptions.guardRun(routeMatch.route.guard, Object.freeze({
                route: routeMatch.route,
                params: routeMatch.params,
                identity: identityData
            }));

            if (supersededCheck()) {
                return supersededResultCreate();

            }

            if (guardResult !== true) {
                let boundaryStatus = 'forbidden';

                if (typeof guardResult === 'string') {
                    boundaryStatus = guardResult;

                }

                return Object.freeze({
                    status: boundaryStatus,
                    route: routeMatch.route,
                    params: routeMatch.params
                });

            }

        }

        const preloadResults = /** @type {Record<string, unknown>} */ ({});

        if (routeMatch.route.preload.length > 0 && routerOptions.preload === undefined) {
            throw new LayerRouterError('ROUTE_PRELOAD_UNAVAILABLE', 'The route declares preload operations but no preload runner is configured.');

        }

        //Loading route data in declaration order with only validated parameters.
        for (const operationName of routeMatch.route.preload) {
            const preloadResult = await /** @type {NonNullable<LayerRouterOptions['preload']>} */ (routerOptions.preload)(operationName, Object.freeze({
                params: routeMatch.params
            }));

            if (supersededCheck()) {
                return supersededResultCreate();

            }

            preloadResults[operationName] = preloadResult;

        }

        if (supersededCheck()) {
            return supersededResultCreate();

        }

        const previousRoute = currentRouteMatch?.route ?? null;
        const preserveLayout = previousRoute !== null && previousRoute.layout === routeMatch.route.layout;
        let scrollX = 0;
        let scrollY = 0;

        //Normalizing finite scroll metadata without carrying application payloads.
        if (Number.isFinite(navigationOptions.scrollX)) {
            scrollX = Number(navigationOptions.scrollX);

        }

        if (Number.isFinite(navigationOptions.scrollY)) {
            scrollY = Number(navigationOptions.scrollY);

        }

        const historyState = Object.freeze({
            layerRouteId: routeMatch.route.id,
            scrollX,
            scrollY
        });

        //Recording only route identity and scroll metadata in browser history.
        if (routerOptions.history !== undefined && navigationOptions.history !== false) {
            if (navigationOptions.replace === true) {
                routerOptions.history.replaceState(historyState, '', pathnameData);

            } else {
                routerOptions.history.pushState(historyState, '', pathnameData);

            }

        }

        currentRouteMatch = routeMatch;

        return Object.freeze({
            status: 'ready',
            route: routeMatch.route,
            params: routeMatch.params,
            preload: Object.freeze(preloadResults),
            preserveLayout,
            historyState
        });

    }

    return Object.freeze({
        resolve(/** @type {string} */ pathnameData) {
            //Resolving a pathname without applying navigation side effects.
            return layerRouteMatch(routerOptions.manifest, pathnameData);

        },
        navigate,
        currentGet() {
            //Returning the last successfully committed route match.
            return currentRouteMatch;

        }
    });

}
