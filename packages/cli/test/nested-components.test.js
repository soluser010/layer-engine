import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {
    mkdir,
    mkdtemp,
    readFile,
    rm,
    writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {promisify} from 'node:util';
import {
    layerConfigLoad,
    layerProjectBuild,
    layerProjectCreate
} from '../src/index.js';

const execFileAsync = promisify( execFile );
const typescriptCompilerFile = fileURLToPath( new URL( '../../../node_modules/typescript/bin/tsc', import.meta.url ) );

//Function for creating a compiled project with one parent and child component
const nestedComponentProjectCreate = async function(){
    //Creating an isolated project through the public CLI contract
    const temporaryRoot = await mkdtemp( path.join( os.tmpdir(), String( 'layer-nested-' ) ) );
    const projectDirectory = path.join( temporaryRoot, String( 'nested-components' ) );

    await layerProjectCreate({
        targetDirectory: projectDirectory,
        projectName: String( 'nested-components' )
    });

    const pageDirectory = path.join( projectDirectory, String( 'src/pages' ) );
    const componentDirectory = path.join( projectDirectory, String( 'src/components' ) );

    //Replacing the generated canonical page with the dedicated composition fixture
    await rm( path.join( pageDirectory, String( 'index.layer.js' ) ) );
    await mkdir( componentDirectory, {recursive: true} );

    //Creating the child contract with props, events, slots, context, and lifecycle
    const childSource = [
        "import {html, layerComponentCreate} from '@solcorp/layer';",
        '',
        'export const properties = {',
        "    compact: {type: 'boolean', default: false},",
        "    label: {type: 'string', required: true}",
        '};',
        '',
        'export const events = {activate: {status: \'string\'}};',
        '',
        'export default layerComponentCreate(function ActionCard(properties, context) {',
        "    const themeName = context.consume('playground.theme', 'missing');",
        '',
        '    context.onMount(function actionCardMounted() {',
        "        context.logger.record('mounted');",
        '    });',
        '',
        '    context.onHydrate(function actionCardHydrated() {',
        "        context.logger.record('hydrated');",
        '    });',
        '',
        '    context.onDestroy(function actionCardDestroyed() {',
        "        context.logger.record('destroyed');",
        '    });',
        '',
        '    function actionActivate() {',
        "        context.emit('activate', {status: 'saved'});",
        '    }',
        '',
        '    return html`',
        '        <article data-theme=${themeName}>',
        '            <button type="button" @click=${actionActivate}>${properties.label}</button>',
        '            <slot name="children"><em>Fallback</em></slot>',
        '        </article>',
        '    `;',
        '});'
    ].join( String( '\n' ) );

    //Creating the parent invocation with a named slot and event callback
    const parentSource = [
        "import {ErrorBoundary, html, layerComponentCreate, layerPageCreate, layerSignalCreate} from '@solcorp/layer';",
        "import ActionCard from '../components/ActionCard.layer.js';",
        '',
        "export const page = layerPageCreate({auth: 'none', render: 'csr'});",
        '',
        'export default layerComponentCreate(function ComponentPage(properties, context) {',
        "    const saveState = layerSignalCreate('idle');",
        "    context.provide('playground.theme', 'violet');",
        '',
        '    function unsafeContentRead() {',
        "        throw new Error('private renderer detail');",
        '    }',
        '',
        '    return html`',
        '        <main>',
        '            ${ActionCard({',
        "                label: 'Save',",
        '                onActivate(eventData) {',
        '                    saveState.set(eventData.status);',
        '                },',
        '                children: html`<strong>Named slot</strong>`',
        '            })}',
        '            <output>${saveState}</output>',
        '            ${ErrorBoundary({',
        '                content() {',
        '                    return html`<p>${unsafeContentRead()}</p>`;',
        '                },',
        '                fallback(errorData) {',
        '                    return html`<aside data-error-code=${errorData.code}>Recovered safely</aside>`;',
        '                }',
        '            })}',
        '        </main>',
        '    `;',
        '});'
    ].join( String( '\n' ) );

    await writeFile(
        path.join( componentDirectory, String( 'ActionCard.layer.js' ) ),
        childSource,
        'utf8'
    );
    await writeFile(
        path.join( pageDirectory, String( 'index.layer.js' ) ),
        parentSource,
        'utf8'
    );

    //Building the application and loading the generated route module
    const configData = await layerConfigLoad( projectDirectory );
    await layerProjectBuild({
        rootDirectory: projectDirectory,
        config: configData
    });

    const routeManifest = JSON.parse( await readFile(
        path.join( projectDirectory, String( 'dist/_layer/routes.json' ) ),
        'utf8'
    ) );
    const componentFile = path.join( projectDirectory, String( 'dist' ), routeManifest[0].component );
    const componentModule = await import( pathToFileURL( componentFile ).href );
    const routeDeclarationFile = componentFile.replace( /\.mjs$/, String( '.d.mts' ) );
    const childDeclarationFile = path.join(
        projectDirectory,
        String( 'dist/_layer/types/src/components/ActionCard.layer.d.ts' )
    );

    //CallBack THE OBJECT
    return {
        childDeclarationFile,
        componentModule,
        componentFile,
        projectDirectory,
        routeDeclarationFile,
        temporaryRoot
    };

};

test( 'CLI bundles callable nested components across CSR, SSR, hydration, and cleanup', async function( testContext ){
    //Creating the compiled fixture and registering deterministic cleanup
    const projectData = await nestedComponentProjectCreate();
    const componentBundle = await readFile( projectData.componentFile, 'utf8' );

    //Confirming that dynamic API handles use one setup-owned lifecycle registry
    assert.match( componentBundle, /ownedStateDisposers/ );
    assert.match( componentBundle, /componentApiDispose/ );

    testContext.after( async function(){
        //Removing only the isolated fixture created by this test
        await rm( projectData.temporaryRoot, {recursive: true, force: true} );

    });

    const lifecycleEvents = Array();
    const applicationLogger = Object.freeze({
        /**
         * @param {unknown} eventName
         */
        record( eventName ){
            //Recording child lifecycle events for the public behavior assertion
            lifecycleEvents.push( String( eventName ) );

        }
    });
    const browserData = new JSDOM( String( '<!doctype html><div id="root"></div>' ) );
    const rootNode = browserData.window.document.querySelector( String( '#root' ) );

    //Checking the browser root before mounting the compiled application
    if ( rootNode === null ){
        //Passing the unavailable test root to the runner
        throw new Error( String( 'Nested component test root is unavailable.' ) );

    }

    const componentController = projectData.componentModule.mount( rootNode, {
        context: {
            'layer.logger': applicationLogger
        }
    });
    const actionButton = rootNode.querySelector( String( 'button' ) );

    assert.equal( actionButton?.textContent, String( 'Save' ) );
    assert.equal( rootNode.querySelector( String( 'strong' ) )?.textContent, String( 'Named slot' ) );
    assert.equal( rootNode.querySelector( String( 'article' ) )?.getAttribute( String( 'data-theme' ) ), String( 'violet' ) );
    assert.deepEqual( lifecycleEvents, [String( 'mounted' )] );
    assert.equal( rootNode.querySelector( String( 'aside' ) )?.textContent, String( 'Recovered safely' ) );
    assert.equal(
        rootNode.querySelector( String( 'aside' ) )?.getAttribute( String( 'data-error-code' ) ),
        String( 'COMPONENT_RENDER_FAILED' )
    );

    //Sending the declared child event through its parent callback
    actionButton?.dispatchEvent( new browserData.window.Event( String( 'click' ), {bubbles: true} ) );
    await componentController.settled();

    assert.equal( rootNode.querySelector( String( 'output' ) )?.textContent, String( 'saved' ) );

    //Disposing the parent and checking automatic child lifecycle cleanup
    componentController.dispose();
    assert.deepEqual( lifecycleEvents, [String( 'mounted' ), String( 'destroyed' )] );

    //Rendering a fresh server instance without running browser-only lifecycle hooks
    lifecycleEvents.length = Number( 0 );
    const serverResult = projectData.componentModule.renderToString({
        context: {
            'layer.logger': applicationLogger
        }
    });

    assert.match( serverResult.html, /Named slot/ );
    assert.match( serverResult.html, /layer-component:/ );
    assert.match( serverResult.html, /layer-error-boundary:.*:fallback/ );
    assert.doesNotMatch( serverResult.html, /private renderer detail/ );
    assert.deepEqual( lifecycleEvents, Array() );

    //Hydrating the SSR nodes and preserving the existing child button identity
    rootNode.innerHTML = serverResult.html;
    const serverButton = rootNode.querySelector( String( 'button' ) );
    const hydrationController = projectData.componentModule.hydrate( rootNode, {
        context: {
            'layer.logger': applicationLogger
        }
    });

    assert.equal( hydrationController.recovered, false );
    assert.equal( rootNode.querySelector( String( 'button' ) ), serverButton );
    assert.deepEqual( lifecycleEvents, [String( 'hydrated' )] );
    assert.equal( rootNode.querySelector( String( 'aside' ) )?.textContent, String( 'Recovered safely' ) );

    hydrationController.dispose();
    assert.deepEqual( lifecycleEvents, [String( 'hydrated' ), String( 'destroyed' )] );

});

test( 'CLI generates checked declarations for route and nested layer.js components', async function( testContext ){
    //Creating the canonical nested fixture and registering deterministic cleanup
    const projectData = await nestedComponentProjectCreate();

    testContext.after( async function(){
        //Removing only the isolated declaration fixture
        await rm( projectData.temporaryRoot, {recursive: true, force: true} );

    });

    //Loading the route and source-mirrored declarations from the build output
    const routeDeclarationSource = await readFile( projectData.routeDeclarationFile, 'utf8' );
    const childDeclarationSource = await readFile( projectData.childDeclarationFile, 'utf8' );

    assert.match( routeDeclarationSource, /declare function componentInvoke/ );
    assert.match( childDeclarationSource, /readonly "compact"\?: boolean;/ );
    assert.match( childDeclarationSource, /readonly "label": string;/ );
    assert.match( childDeclarationSource, /readonly "onActivate"\?: \(eventData: Readonly<\{ readonly "status": string; \}>\) => unknown;/ );
    assert.match( childDeclarationSource, /readonly "children"\?: LayerComponentSlot;/ );
    assert.match( childDeclarationSource, /export type LayerComponentProperties = Pick<LayerComponentOptions, "compact" \| "label">;/ );
    assert.match( childDeclarationSource, /export type LayerComponentEventHandlers = Pick<LayerComponentOptions, "onActivate">;/ );
    assert.match( childDeclarationSource, /export type LayerComponentSlots = Pick<LayerComponentOptions, "children">;/ );
    assert.match( childDeclarationSource, /Props, onEvent callbacks, and named slots/u );
    assert.match( childDeclarationSource, /Attaches bindings to matching SSR markup/u );
    assert.match( childDeclarationSource, /partial property update without remounting/u );

    const declarationConsumerFile = path.join( projectData.projectDirectory, String( 'declaration-consumer.mts' ) );
    const declarationConsumerSource = [
        "import ActionCard from './dist/_layer/types/src/components/ActionCard.layer.js';",
        '',
        'const slotContent = {',
        "    strings: [''],",
        '    values: []',
        '};',
        '',
        'ActionCard({',
        "    label: 'Save',",
        '    onActivate(eventData) {',
        '        const statusData: string = eventData.status;',
        '        return statusData;',
        '    },',
        '    children: slotContent',
        '});',
        '',
        "ActionCard({label: 'Save', compact: true});",
        '',
        '// @ts-expect-error the required label cannot be omitted',
        'ActionCard({});',
        '',
        '// @ts-expect-error the label contract accepts strings only',
        'ActionCard({label: 42});',
        ''
    ].join( String( '\n' ) );

    await writeFile( declarationConsumerFile, declarationConsumerSource, 'utf8' );

    //Checking the emitted declaration through the real TypeScript 7 command-line resolver
    await execFileAsync( process.execPath, [
        typescriptCompilerFile,
        String( '--noEmit' ),
        String( '--strict' ),
        String( '--module' ),
        String( 'nodenext' ),
        String( '--moduleResolution' ),
        String( 'nodenext' ),
        String( '--target' ),
        String( 'es2022' ),
        declarationConsumerFile
    ], {
        cwd: projectData.projectDirectory,
        windowsHide: true
    } );

});
