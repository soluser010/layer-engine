import assert from 'node:assert/strict';
import {
    mkdir,
    mkdtemp,
    readFile,
    rm,
    writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {
    layerConfigLoad,
    layerProjectBuild,
    layerProjectCreate
} from '../src/index.js';

//Function for creating one isolated canonical layout project
const layoutProjectCreate = async function(){
    //Creating the project through the same public CLI used by developers
    const temporaryRoot = await mkdtemp( path.join( os.tmpdir(), String( 'layer-layout-' ) ) );
    const projectDirectory = path.join( temporaryRoot, String( 'layout-project' ) );

    await layerProjectCreate({
        targetDirectory: projectDirectory,
        projectName: String( 'layout-project' )
    });

    const pageDirectory = path.join( projectDirectory, String( 'src/pages' ) );
    const layoutDirectory = path.join( projectDirectory, String( 'src/layouts' ) );

    await rm( path.join( pageDirectory, String( 'index.layer.js' ) ) );
    await mkdir( layoutDirectory, {recursive: true} );

    //CallBack THE OBJECT
    return {
        layoutDirectory,
        pageDirectory,
        projectDirectory,
        temporaryRoot
    };

};

/**
 * @param {string} pageDirectory
 * @param {string} pageName
 * @param {string} headingData
 */
//Function for writing one page owned by the application layout
const layoutPageWrite = async function( pageDirectory, pageName, headingData ){
    const pageSource = [
        "import {html, layerComponentCreate, layerPageCreate} from '@solcorp/layer';",
        '',
        `export const page = layerPageCreate({layout: 'application', render: 'ssr', auth: 'none', offline: 'shell', cache: 'public', metadata: {title: '${headingData}', description: '${headingData} route', canonical: '${pageName === 'index' ? '/' : `/${pageName}/`}', openGraphType: 'website'}});`,
        '',
        `export default layerComponentCreate(function ${headingData.replace( /[^A-Za-z]/g, String( '' ) )}Page(){`,
        '    return html`',
        `        <article data-page-name="${pageName}">${headingData}</article>`,
        '    `;',
        '',
        '});'
    ].join( String( '\n' ) );

    //Writing only the canonical page file selected by file routing
    await writeFile(
        path.join( pageDirectory, String( `${pageName}.layer.js` ) ),
        pageSource,
        'utf8'
    );

};

/**
 * @param {string} layoutDirectory
 */
//Function for writing the valid reusable application layout
const applicationLayoutWrite = async function( layoutDirectory ){
    const layoutSource = [
        "import {css, html, layerComponentCreate} from '@solcorp/layer';",
        '',
        'export const styles = css`',
        '.ApplicationLayout { display: grid; }',
        '`;',
        '',
        'export default layerComponentCreate(function ApplicationLayout(){',
        '    return html`',
        '        <section class="ApplicationLayout" data-layout-identity="application">',
        '            <header>Persistent navigation</header>',
        '            <main data-layer-layout-outlet></main>',
        '        </section>',
        '    `;',
        '',
        '});'
    ].join( String( '\n' ) );

    //Writing one statically verifiable outlet owned by the layout
    await writeFile(
        path.join( layoutDirectory, String( 'application.layer.js' ) ),
        layoutSource,
        'utf8'
    );

};

test( 'CLI bundles one referenced layout and exposes its isolated page outlet', async function( testContext ){
    //Creating the layout fixture and registering deterministic cleanup
    const projectData = await layoutProjectCreate();

    testContext.after( async function(){
        //Removing only the isolated fixture created by this test
        await rm( projectData.temporaryRoot, {recursive: true, force: true} );

    });

    await applicationLayoutWrite( projectData.layoutDirectory );
    await layoutPageWrite( projectData.pageDirectory, String( 'index' ), String( 'Home' ) );
    await layoutPageWrite( projectData.pageDirectory, String( 'settings' ), String( 'Settings' ) );

    const configData = await layerConfigLoad( projectData.projectDirectory );
    const buildResult = await layerProjectBuild({
        rootDirectory: projectData.projectDirectory,
        config: configData
    });
    const layoutManifest = JSON.parse( await readFile(
        path.join( projectData.projectDirectory, String( 'dist/_layer/layouts.json' ) ),
        'utf8'
    ) );
    const applicationBundle = await readFile(
        path.join( projectData.projectDirectory, String( 'dist/_layer/application.mjs' ) ),
        'utf8'
    );
    const rootDocument = await readFile(
        path.join( projectData.projectDirectory, String( 'dist/index.html' ) ),
        'utf8'
    );
    const settingsDocument = await readFile(
        path.join( projectData.projectDirectory, String( 'dist/settings/index.html' ) ),
        'utf8'
    );

    assert.equal( buildResult.layouts.length, Number( 1 ) );
    assert.equal( buildResult.routes.every(function( routeData ){
        //Checking that both fixture pages reference the validated layout name
        return routeData.layout === String( 'application' );

    }), true );
    assert.equal( layoutManifest.length, Number( 1 ) );
    assert.equal( layoutManifest[0].name, String( 'application' ) );
    assert.equal( layoutManifest[0].file, String( 'src/layouts/application.layer.js' ) );
    assert.equal( buildResult.artifacts.includes( layoutManifest[0].component ), true );
    assert.equal( buildResult.artifacts.includes( layoutManifest[0].style ), true );
    assert.equal(
        buildResult.artifacts.includes( String( '_layer/types/src/layouts/application.layer.d.ts' ) ),
        true
    );
    assert.match( applicationBundle, /layoutAssetByName/ );
    assert.match( applicationBundle, /activeLayoutController/ );
    assert.match( applicationBundle, /history\.scrollRestoration\s*=\s*["']manual["']/ );
    assert.match( applicationBundle, /window\.scrollTo\(\{/ );
    assert.match( rootDocument, /data-layer-ssr="index"/ );
    assert.match( rootDocument, /Persistent navigation/ );
    assert.match( rootDocument, /data-page-name="index">Home/ );
    assert.match( settingsDocument, /data-layer-ssr="settings"/ );
    assert.match( settingsDocument, /data-page-name="settings">Settings/ );
    assert.match( settingsDocument, /<title[^>]*>Settings<\/title>/ );
    assert.match( settingsDocument, /name="description" content="Settings route"/ );
    assert.match( settingsDocument, /property="og:title" content="Settings"/ );
    assert.match( settingsDocument, /rel="canonical" href="\/settings\/"/ );
    assert.match( settingsDocument, /data-layer-layout-style/ );
    assert.match( settingsDocument, /data-layer-page-style/ );

    const layoutModuleFile = path.join(
        projectData.projectDirectory,
        String( 'dist' ),
        layoutManifest[0].component
    );
    const layoutModule = await import( pathToFileURL( layoutModuleFile ).href );
    const browserData = new JSDOM( String( '<!doctype html><div id="root"></div>' ) );
    const rootNode = browserData.window.document.querySelector( String( '#root' ) );

    //Checking the browser root before mounting the compiled layout module
    if ( rootNode === null ){
        //Passing the unavailable test root to the runner
        throw new Error( String( 'Layout test root is unavailable.' ) );

    }

    const layoutController = layoutModule.mount( rootNode );

    assert.equal( rootNode.querySelectorAll( String( '[data-layer-layout-outlet]' ) ).length, Number( 1 ) );
    assert.equal( rootNode.querySelector( String( 'header' ) )?.textContent, String( 'Persistent navigation' ) );

    layoutController.dispose();

});

test( 'CLI rejects missing and structurally ambiguous referenced layouts', async function( testContext ){
    //Creating one fixture that advances through both failure contracts
    const projectData = await layoutProjectCreate();

    testContext.after( async function(){
        //Removing only the isolated fixture created by this test
        await rm( projectData.temporaryRoot, {recursive: true, force: true} );

    });

    await layoutPageWrite( projectData.pageDirectory, String( 'index' ), String( 'Home' ) );

    const configData = await layerConfigLoad( projectData.projectDirectory );

    await assert.rejects(
        layerProjectBuild({
            rootDirectory: projectData.projectDirectory,
            config: configData
        }),
        /** @param {any} errorData */
        function missingLayoutCheck( errorData ){
            //Checking the stable missing layout code without matching private paths
            return errorData?.code === String( 'CLI_BUILD_LAYOUT_MISSING' );

        }
    );

    const ambiguousLayoutSource = [
        "import {html, layerComponentCreate} from '@solcorp/layer';",
        '',
        'export default layerComponentCreate(function ApplicationLayout(){',
        '    return html`',
        '        <section>',
        '            <main data-layer-layout-outlet></main>',
        '            <aside data-layer-layout-outlet></aside>',
        '        </section>',
        '    `;',
        '',
        '});'
    ].join( String( '\n' ) );

    await writeFile(
        path.join( projectData.layoutDirectory, String( 'application.layer.js' ) ),
        ambiguousLayoutSource,
        'utf8'
    );

    await assert.rejects(
        layerProjectBuild({
            rootDirectory: projectData.projectDirectory,
            config: configData
        }),
        /** @param {any} errorData */
        function invalidLayoutCheck( errorData ){
            //Checking the stable outlet diagnostic without exposing compiler details
            return errorData?.code === String( 'CLI_BUILD_LAYOUT_INVALID' );

        }
    );

});
