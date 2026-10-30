import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LayerRouterError,
    layerRouteManifestCreate,
    layerRouteMetadataDocumentCreate,
    layerRouteMatch,
    layerRouterCreate
} from '../src/index.js';

function routeManifestFixtureCreate() {
    return layerRouteManifestCreate([
        {
            file: 'src/pages/index.layer',
            route: {
                auth: 'none',
                offline: 'shell',
                metadata: {
                    title: 'Home'
                }
            }
        },
        {
            file: 'src/pages/chats/new.layer',
            layout: 'application',
            route: {
                permissions: ['chat.create']
            }
        },
        {
            file: 'src/pages/chats/[dialogId].layer',
            layout: 'application',
            route: {
                permissions: ['chat.read'],
                preload: ['chat.dialog.get'],
                guard: 'chat.dialog.guard',
                offline: 'snapshot'
            }
        },
        {
            file: 'src/pages/users/[...segments].layer',
            route: {
                auth: 'none',
                render: 'csr',
                offline: 'local',
                cache: 'public'
            }
        }
    ]);
}

test('file routes compile deterministically and prefer static paths', () => {
    const manifest = routeManifestFixtureCreate();
    const staticMatch = layerRouteMatch(manifest, '/chats/new/');
    const dynamicMatch = layerRouteMatch(manifest, '/chats/dialog-42/?source=list');
    const catchAllMatch = layerRouteMatch(manifest, '/users/team/design/');

    assert.equal(Object.isFrozen(manifest), true);
    assert.equal(staticMatch?.route.id, 'chats/new');
    assert.equal(dynamicMatch?.route.id, 'chats/[dialogId]');
    assert.deepEqual(dynamicMatch?.params, {
        dialogId: 'dialog-42'
    });
    assert.deepEqual(catchAllMatch?.params, {
        segments: 'team/design'
    });
    assert.equal(layerRouteMatch(manifest, '/missing/'), null);
});

test('route metadata creates complete document entries with explicit social fallbacks', () => {
    const manifest = layerRouteManifestCreate([{
        file: 'src/pages/index.layer.js',
        route: {
            metadata: {
                title: 'Layer application',
                description: 'Layer route description',
                robots: 'index,follow',
                canonical: 'https://app.example.com/',
                language: 'ru-RU',
                direction: 'ltr',
                openGraphType: 'website',
                openGraphImage: '/assets/social.png',
                twitterCard: 'summary_large_image'
            }
        }
    }]);
    const routeData = manifest[0];

    assert.ok(routeData);

    const documentData = layerRouteMetadataDocumentCreate(routeData.metadata);
    const entryByKey = new Map(documentData.entries.map((entryData) => [
        entryData.key,
        entryData
    ]));

    assert.equal(documentData.title, 'Layer application');
    assert.equal(documentData.language, 'ru-RU');
    assert.equal(documentData.direction, 'ltr');
    assert.equal(entryByKey.get('description')?.valueData, 'Layer route description');
    assert.equal(entryByKey.get('canonical')?.valueData, 'https://app.example.com/');
    assert.equal(entryByKey.get('openGraphTitle')?.valueData, 'Layer application');
    assert.equal(entryByKey.get('openGraphDescription')?.valueData, 'Layer route description');
    assert.equal(entryByKey.get('openGraphUrl')?.valueData, 'https://app.example.com/');
    assert.equal(entryByKey.get('twitterTitle')?.valueData, 'Layer application');
    assert.equal(entryByKey.get('twitterImage')?.valueData, '/assets/social.png');
});

test('route metadata rejects unknown, unsafe, and invalid document fields', () => {
    const routeCreate = (/** @type {Record<string, string>} */ metadataData) => layerRouteManifestCreate([{
        file: 'src/pages/index.layer.js',
        route: {
            metadata: metadataData
        }
    }]);

    assert.throws(() => routeCreate({
        unknown: 'value'
    }), /invalid field/);
    assert.throws(() => routeCreate({
        canonical: 'javascript:alert(1)'
    }), /URL fields/);
    assert.throws(() => routeCreate({
        direction: 'left'
    }), /direction/);
    assert.throws(() => routeCreate({
        twitterCard: 'large'
    }), /twitterCard/);
    assert.throws(() => routeCreate({
        language: 'invalid_language'
    }), /language/);
});

test('route manifest rejects collisions, unsafe paths, and unknown policy fields', () => {
    assert.throws(() => layerRouteManifestCreate([
        {file: 'src/pages/chats/[id].layer'},
        {file: 'src/pages/chats/[dialogId].layer'}
    ]), (errorData) => errorData instanceof LayerRouterError && errorData.code === 'ROUTE_MANIFEST_INVALID');
    assert.throws(() => layerRouteManifestCreate([
        {file: '../outside.layer'}
    ]), LayerRouterError);
    assert.throws(() => layerRouteManifestCreate([
        {
            file: 'src/pages/index.layer',
            route: {
                unknown: true
            }
        }
    ]), LayerRouterError);
    assert.throws(() => layerRouteManifestCreate([
        {file: 'src/pages/[...all]/extra.layer'}
    ]), LayerRouterError);
    assert.throws(() => layerRouteMatch(routeManifestFixtureCreate(), '/users/%E0%A4%A/'), (errorData) => {
        return /** @type {any} */ (errorData).code === 'ROUTE_PARAMETER_INVALID';
    });
});

test('router applies identity, permissions, guards, preload, and layout preservation', async () => {
    const historyRecords = /** @type {any[]} */ ([]);
    const preloadRequests = /** @type {any[]} */ ([]);
    const router = layerRouterCreate({
        manifest: routeManifestFixtureCreate(),
        identityGet: async () => ({
            authenticated: true,
            permissions: ['chat.read', 'chat.create']
        }),
        onlineGet: () => true,
        guardRun: async (guardName, contextData) => {
            assert.equal(guardName, 'chat.dialog.guard');
            assert.equal(contextData.params.dialogId, 'dialog-42');

            return true;
        },
        preload: async (operationName, payloadData) => {
            preloadRequests.push({operationName, payloadData});

            return {revision: 7};
        },
        history: {
            pushState(stateData, _unused, urlData) {
                historyRecords.push({method: 'push', stateData, urlData});
            },
            replaceState(stateData, _unused, urlData) {
                historyRecords.push({method: 'replace', stateData, urlData});
            }
        }
    });

    const firstResult = await router.navigate('/chats/new/');
    const secondResult = await router.navigate('/chats/dialog-42/', {
        replace: true,
        scrollY: 120
    });

    assert.equal(firstResult.status, 'ready');
    assert.equal(secondResult.status, 'ready');
    assert.equal(/** @type {any} */ (secondResult).preserveLayout, true);
    assert.deepEqual(preloadRequests[0], {
        operationName: 'chat.dialog.get',
        payloadData: {
            params: {
                dialogId: 'dialog-42'
            }
        }
    });
    assert.equal(historyRecords[1].method, 'replace');
    assert.equal(historyRecords[1].stateData.scrollY, 120);
    assert.equal(router.currentGet()?.route.id, 'chats/[dialogId]');

    await router.navigate('/chats/new/', {history: false});

    assert.equal(historyRecords.length, 2);
    assert.equal(router.currentGet()?.route.id, 'chats/new');
});

test('router lets only the latest asynchronous navigation commit', async function latestNavigationCommitCheck(){
    //Holding the first preload while a newer route completes.
    const historyRecords = /** @type {any[]} */ ([]);
    let firstPreloadRelease = function firstPreloadReleaseDefault(){
        //Keeping a callable placeholder until the promise captures its resolver.

    };
    let firstPreloadStarted = function firstPreloadStartedDefault(){
        //Keeping a callable placeholder until the promise captures its resolver.

    };
    const firstPreloadWait = new Promise(function firstPreloadReleaseCapture( resolve ){
        //Exposing deterministic release control to this test.
        firstPreloadRelease = function firstPreloadReleaseExecute(){
            //Releasing the first navigation from its controlled preload boundary.
            resolve( undefined );

        };

    });
    const firstPreloadStartedWait = new Promise(function firstPreloadStartedCapture( resolve ){
        //Reporting when the first navigation reaches its asynchronous boundary.
        firstPreloadStarted = function firstPreloadStartedReport(){
            //Unblocking the test after the first preload begins.
            resolve( undefined );

        };

    });
    const router = layerRouterCreate({
        manifest: routeManifestFixtureCreate(),
        identityGet(){
            //Returning the trusted identity required by the dynamic route.
            return {
                authenticated: true,
                permissions: ['chat.read']
            };

        },
        guardRun(){
            //Allowing both navigation attempts to reach their preload work.
            return true;

        },
        async preload( _operationName, payloadData ){
            //Suspending only the first route while the second route advances.
            if (payloadData.params.dialogId === 'first') {
                firstPreloadStarted();
                await firstPreloadWait;

            }

            return {
                dialogId: payloadData.params.dialogId
            };

        },
        history: {
            pushState( stateData, _unused, urlData ){
                //Recording only navigation commits visible to browser history.
                historyRecords.push({stateData, urlData});

            },
            replaceState(){
                //Providing the complete history contract without recording unused replacements.

            }
        }
    });
    const firstNavigation = router.navigate('/chats/first/');

    await firstPreloadStartedWait;

    const secondResult = await router.navigate('/chats/second/');

    firstPreloadRelease();

    const firstResult = await firstNavigation;

    assert.equal(firstResult.status, 'superseded');
    assert.equal(secondResult.status, 'ready');
    assert.equal(historyRecords.length, 1);
    assert.equal(historyRecords[0].urlData, '/chats/second/');
    assert.deepEqual(router.currentGet()?.params, {
        dialogId: 'second'
    });

});

test('router returns explicit navigation boundaries and rejects missing integrations', async () => {
    const manifest = routeManifestFixtureCreate();
    const anonymousRouter = layerRouterCreate({
        manifest
    });
    const forbiddenRouter = layerRouterCreate({
        manifest,
        identityGet: () => ({
            authenticated: true,
            permissions: []
        })
    });
    const offlineRouter = layerRouterCreate({
        manifest,
        onlineGet: () => false
    });

    assert.equal((await anonymousRouter.navigate('/missing/')).status, 'not-found');
    assert.equal((await anonymousRouter.navigate('/chats/new/')).status, 'auth-required');
    assert.equal((await forbiddenRouter.navigate('/chats/new/')).status, 'forbidden');
    assert.equal((await offlineRouter.navigate('/chats/new/')).status, 'offline');
    await assert.rejects(() => layerRouterCreate({
        manifest,
        identityGet: () => ({
            authenticated: true,
            permissions: ['chat.read']
        }),
        preload: async () => ({})
    }).navigate('/chats/dialog-42/'), (errorData) => {
        return /** @type {any} */ (errorData).code === 'ROUTE_GUARD_UNAVAILABLE';
    });
    await assert.rejects(() => layerRouterCreate({
        manifest,
        identityGet: () => ({
            authenticated: true,
            permissions: ['chat.read']
        }),
        guardRun: () => true
    }).navigate('/chats/dialog-42/'), (errorData) => {
        return /** @type {any} */ (errorData).code === 'ROUTE_PRELOAD_UNAVAILABLE';
    });
});
