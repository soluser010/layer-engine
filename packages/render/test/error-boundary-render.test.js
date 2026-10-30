import assert from 'node:assert/strict';
import test from 'node:test';
import {layerJavascriptComponentCompile} from '@solcorp/layer-compiler';
import {
    ErrorBoundary,
    html
} from '../../layer/src/index.js';
import {JSDOM} from 'jsdom';
import {
    layerComponentHydrate,
    layerComponentMount,
    layerComponentRenderToString
} from '../src/index.js';

const boundaryComponentSource = [
    "import {ErrorBoundary, html, layerComponentCreate} from '@solcorp/layer';",
    'export default layerComponentCreate(function BoundaryPage() {',
    '    return html`<main>${ErrorBoundary({',
    '        content() {',
    '            return html`<p>${renderFailureCreate()}</p>`;',
    '        },',
    '        fallback(errorData) {',
    '            return html`<aside data-code=${errorData.code}>Recovered</aside>`;',
    '        }',
    '    })}</main>`;',
    '});'
].join( String( '\n' ) );

const boundaryComponentData = layerJavascriptComponentCompile( boundaryComponentSource, {
    componentId: String( 'examples/error-boundary-render' ),
    file: String( 'ErrorBoundaryRender.layer.js' )
});

//Function for getting the compiler-owned boundary marker name
function boundaryMarkerNameGet(){
    //Selecting the root element before locating its structural child plan
    const rootPlan = boundaryComponentData.template.find(function rootPlanFind( planData ){
        //Keeping only the compiled main element
        return planData.kind === String( 'element' );

    });
    const rootPlanData = /** @type {Record<string, unknown> | undefined} */ ( rootPlan );
    const childPlanList = /** @type {Record<string, unknown>[]} */ ( rootPlanData?.children ?? [] );
    const boundaryPlan = childPlanList.find(function boundaryPlanFind( planData ){
        //Keeping only the compiler-owned error boundary region
        return planData.kind === String( 'error-boundary' );

    });
    const boundaryExpression = /** @type {Record<string, unknown> | undefined} */ ( boundaryPlan?.expression );

    if ( boundaryExpression?.type !== String( 'Identifier' ) ){
        //Failing before a malformed compiler plan reaches the renderer test
        throw new Error( String( 'The ErrorBoundary marker is unavailable.' ) );

    }

    //CallBack THE STRING
    return String( boundaryExpression.name );

}

//Function for creating one failing runtime descriptor per render owner
function boundaryRenderScopeCreate(){
    //Creating lazy protected content and a safe fallback template
    const boundaryDescriptor = ErrorBoundary({
        content(){
            //Throwing one private failure before protected markup is committed
            throw Object.assign(
                new Error( String( 'private boundary detail' ) ),
                {code: String( 'EXAMPLE_FAILED' )}
            );

        },
        fallback( renderError ){
            //Rendering only the normalized failure code into public markup
            return html`<aside data-code=${renderError.code}>Recovered</aside>`;

        }
    });

    //CallBack THE OBJECT
    return {
        [boundaryMarkerNameGet()]: boundaryDescriptor
    };

}

test( 'ErrorBoundary renders one fallback branch across CSR, SSR, and hydration', function(){
    //Mounting the protected region into a fresh browser root
    const browserData = new JSDOM( String( '<!doctype html><div id="root"></div>' ) );
    const rootNode = browserData.window.document.querySelector( String( '#root' ) );

    if ( rootNode === null ){
        //Failing before an unavailable DOM root reaches the renderer
        throw new Error( String( 'The ErrorBoundary test root is unavailable.' ) );

    }

    const mountController = layerComponentMount(
        boundaryComponentData,
        rootNode,
        boundaryRenderScopeCreate()
    );

    assert.equal( rootNode.querySelector( String( 'aside' ) )?.textContent, String( 'Recovered' ) );
    assert.equal(
        rootNode.querySelector( String( 'aside' ) )?.getAttribute( String( 'data-code' ) ),
        String( 'EXAMPLE_FAILED' )
    );
    assert.doesNotMatch( rootNode.innerHTML, /private boundary detail/ );
    mountController.dispose();

    //Rendering the same fallback on the server with an explicit branch marker
    const serverResult = layerComponentRenderToString(
        boundaryComponentData,
        boundaryRenderScopeCreate()
    );

    assert.match( serverResult.html, /layer-error-boundary:.*:fallback/ );
    assert.doesNotMatch( serverResult.html, /private boundary detail/ );

    rootNode.innerHTML = serverResult.html;
    const serverFallbackNode = rootNode.querySelector( String( 'aside' ) );
    const hydrationController = layerComponentHydrate(
        boundaryComponentData,
        rootNode,
        boundaryRenderScopeCreate()
    );

    assert.equal( hydrationController.recovered, false );
    assert.equal( rootNode.querySelector( String( 'aside' ) ), serverFallbackNode );
    hydrationController.dispose();

});
