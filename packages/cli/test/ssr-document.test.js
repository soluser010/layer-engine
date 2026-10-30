import assert from 'node:assert/strict';
import test from 'node:test';
import {layerStaticSsrDocumentsCreate} from '../src/ssr-document.js';

const shellSource = '<!doctype html><html><head><meta name="description" content="shell"></head><body><main data-layer-root></main></body></html>';

//Function for creating one complete static route record
const staticRouteCreate = function( routeOptions = {} ){
    //Creating one compiler-shaped route record with explicit per-test overrides.
    return Object.freeze({
        id: String( 'home' ),
        file: String( 'src/pages/index.layer.js' ),
        path: String( '/' ),
        render: String( 'ssr' ),
        component: String( '_layer/components/page.mjs' ),
        style: String( '_layer/components/page.css' ),
        layout: null,
        metadata: Object.freeze({}),
        ...routeOptions
    });

};

test( 'static SSR composes metadata, layout, and deterministic server context', async function(){
    //Executing every build-time API handle through a self-contained component module.
    const pageModule = `
        export function renderToString({context}) {
            const api = context['layer.api'];
            const query = api.query({operation: 'profile.read'});
            const command = api.command({operation: 'profile.write'});
            const queryDispose = query.subscribe();
            const commandDispose = command.subscribe();

            query.snapshot();
            queryDispose();
            void query.refresh();
            query.cancel();
            void query.cacheUpdate();
            void query.cacheInsert();
            void query.cacheRemove();
            void query.settled();
            query.dispose();
            command.snapshot();
            commandDispose();
            void command.execute().catch(() => null);
            command.cancel();
            void command.settled();
            command.dispose();
            void api.sync().catch(() => null);

            return {html: '<article data-context-route="' + context['layer.route'].route.id + '">SSR page</article>'};
        }
        //# sourceMappingURL=page.mjs.map
    `;
    const layoutModule = `
        export function renderToString() {
            return {html: '<section data-layout><main data-layer-layout-outlet></main></section>'};
        }
    `;
    const routeData = staticRouteCreate({
        layout: String( 'application' ),
        metadata: Object.freeze({
            title: String( 'SSR title' ),
            description: String( 'SSR description' ),
            canonical: String( '/' ),
            language: String( 'ru' ),
            direction: String( 'ltr' ),
            openGraphType: String( 'website' )
        })
    });
    const documentArtifacts = await layerStaticSsrDocumentsCreate({
        shellSource,
        routes: [routeData],
        layouts: [{
            name: String( 'application' ),
            component: String( '_layer/layouts/application.mjs' ),
            style: String( '_layer/layouts/application.css' )
        }],
        componentArtifacts: {
            '_layer/components/page.mjs': pageModule,
            '_layer/layouts/application.mjs': layoutModule
        }
    });
    const rootDocument = documentArtifacts['index.html'];
    const offlineShell = documentArtifacts['_layer/shell.html'];

    assert.ok( rootDocument );
    assert.ok( offlineShell );
    assert.match( rootDocument, /data-layer-ssr="home"/ );
    assert.match( rootDocument, /data-context-route="home"/ );
    assert.match( rootDocument, /data-layout/ );
    assert.match( rootDocument, /<title[^>]*>SSR title<\/title>/ );
    assert.match( rootDocument, /name="description" content="SSR description"/ );
    assert.match( rootDocument, /property="og:type" content="website"/ );
    assert.match( rootDocument, /<html lang="ru" dir="ltr">/ );
    assert.match( rootDocument, /data-layer-layout-style/ );
    assert.match( rootDocument, /data-layer-page-style/ );
    assert.doesNotMatch( offlineShell, /SSR page/ );

} );

test( 'static SSR skips non-static routes and reuses one component artifact', async function(){
    //Combining static, dynamic, and client-only routes in one document projection.
    const routeModule = `
        export function renderToString() {
            return {html: '<p>shared route</p>'};
        }
    `;
    const documentArtifacts = await layerStaticSsrDocumentsCreate({
        shellSource: '<!doctype html><html><head><title>Shell</title></head><body><main data-layer-root></main></body></html>',
        routes: [
            staticRouteCreate({id: String( 'one' )}),
            staticRouteCreate({id: String( 'two' ), path: String( '/two' )}),
            staticRouteCreate({id: String( 'dynamic' ), path: String( '/item/:id' )}),
            staticRouteCreate({id: String( 'client' ), path: String( '/client' ), render: String( 'csr' )})
        ],
        layouts: [],
        componentArtifacts: {
            '_layer/components/page.mjs': routeModule
        }
    });
    const rootDocument = documentArtifacts['index.html'];
    const secondDocument = documentArtifacts['two/index.html'];

    assert.ok( rootDocument );
    assert.ok( secondDocument );
    assert.match( rootDocument, /shared route/ );
    assert.match( secondDocument, /shared route/ );
    assert.equal( documentArtifacts['item/:id/index.html'], undefined );
    assert.equal( documentArtifacts['client/index.html'], undefined );

} );

test( 'static SSR fails closed for unsafe shell, artifacts, rendering, and layouts', async function(){
    //Checking each security boundary independently so failures keep stable error codes.
    await assert.rejects(
        layerStaticSsrDocumentsCreate({
            shellSource: '<!doctype html><html><head></head><body></body></html>',
            routes: [],
            layouts: [],
            componentArtifacts: {}
        }),
        {code: String( 'CLI_BUILD_SSR_SHELL_INVALID' )}
    );

    await assert.rejects(
        layerStaticSsrDocumentsCreate({
            shellSource,
            routes: [staticRouteCreate()],
            layouts: [],
            componentArtifacts: {}
        }),
        {code: String( 'CLI_BUILD_SSR_FAILED' )}
    );

    await assert.rejects(
        layerStaticSsrDocumentsCreate({
            shellSource,
            routes: [staticRouteCreate()],
            layouts: [],
            componentArtifacts: {
                '_layer/components/page.mjs': 'export function renderToString(){ throw new Error("private render failure"); }'
            }
        }),
        {
            code: String( 'CLI_BUILD_SSR_FAILED' ),
            details: {
                route: String( 'src/pages/index.layer.js' ),
                reason: String( 'private render failure' )
            }
        }
    );

    await assert.rejects(
        layerStaticSsrDocumentsCreate({
            shellSource,
            routes: [staticRouteCreate({layout: String( 'application' )})],
            layouts: [{
                name: String( 'application' ),
                component: String( '_layer/layouts/application.mjs' ),
                style: String( '_layer/layouts/application.css' )
            }],
            componentArtifacts: {
                '_layer/components/page.mjs': 'export function renderToString(){ return {html: "<p>page</p>"}; }',
                '_layer/layouts/application.mjs': 'export function renderToString(){ return {html: "<main>missing outlet</main>"}; }'
            }
        }),
        {code: String( 'CLI_BUILD_SSR_FAILED' )}
    );

} );
