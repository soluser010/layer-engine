import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LayerCompilerError,
    layerJavascriptComponentCompile
} from '../src/index.js';

test( 'compiles imported component calls and named html slots as owned regions', function(){
    //Compiling a parent template which invokes one imported child component
    const nestedComponentSource = [
        "import {html, layerComponentCreate} from '@solcorp/layer';",
        "import MessageCard from '../components/MessageCard.layer.js';",
        'export default layerComponentCreate(function Conversation() {',
        "    const title = 'Pinned message';",
        "    const body = 'Safe slot body';",
        '    return html`',
        '        <main>',
        '            ${MessageCard({',
        '                title,',
        '                onOpen() {},',
        '                children: html`<p>${body}</p>`',
        '            })}',
        '        </main>',
        '    `;',
        '});'
    ].join( String( '\n' ) );
    const componentData = /** @type {any} */ ( layerJavascriptComponentCompile( nestedComponentSource, {
        componentId: String( 'chat/conversation' ),
        file: String( 'Conversation.layer.js' )
    }) );
    const rootPlan = componentData.template.find(function rootPlanFind( /** @type {any} */ planData ){
        //Selecting the compiled parent element which owns the child region
        return planData.kind === String( 'element' );

    });
    const componentPlan = rootPlan.children.find(function componentPlanFind( /** @type {any} */ planData ){
        //Selecting the opaque nested component plan for contract assertions
        return planData.kind === String( 'component' );

    });

    assert.ok( componentPlan );
    assert.equal( componentPlan.slots.children.template[0].kind, String( 'element' ) );
    assert.equal( componentPlan.slots.children.template[0].tag, String( 'p' ) );
    assert.equal( componentData.sourceMap.expressions[0].kind, String( 'component' ) );

});

test( 'compiles ErrorBoundary content and fallback as isolated structural plans', function(){
    //Compiling both lazy branches without executing their author functions
    const boundarySource = [
        "import {ErrorBoundary, html, layerComponentCreate} from '@solcorp/layer';",
        'export default layerComponentCreate(function BoundaryExample() {',
        '    function contentRead() {',
        "        return 'ready';",
        '    }',
        '    return html`<main>${ErrorBoundary({',
        '        content() {',
        '            return html`<p>${contentRead()}</p>`;',
        '        },',
        '        fallback(errorData) {',
        '            return html`<aside data-code=${errorData.code}>Recovered</aside>`;',
        '        }',
        '    })}</main>`;',
        '});'
    ].join( String( '\n' ) );
    const componentData = /** @type {any} */ ( layerJavascriptComponentCompile( boundarySource, {
        componentId: String( 'examples/error-boundary' ),
        file: String( 'ErrorBoundary.layer.js' )
    }) );
    const rootPlan = componentData.template.find(function rootPlanFind( /** @type {any} */ planData ){
        //Selecting the only root element emitted by the compiler
        return planData.kind === String( 'element' );

    });
    const boundaryPlan = rootPlan.children.find(function boundaryPlanFind( /** @type {any} */ planData ){
        //Selecting the isolated error boundary child plan
        return planData.kind === String( 'error-boundary' );

    });

    assert.ok( boundaryPlan );
    assert.equal( boundaryPlan.content.template[0].tag, String( 'p' ) );
    assert.equal( boundaryPlan.fallback.template[0].tag, String( 'aside' ) );
    assert.equal( componentData.sourceMap.expressions[0].kind, String( 'error-boundary' ) );

});

test( 'rejects incomplete or unknown ErrorBoundary options', function(){
    //Creating one boundary whose static option name is outside the public contract
    const invalidBoundarySource = [
        "import {ErrorBoundary, html, layerComponentCreate} from '@solcorp/layer';",
        'export default layerComponentCreate(function Invalid() {',
        '    return html`${ErrorBoundary({',
        '        content: () => html`<p>Content</p>`,',
        '        unknown: () => html`<p>Unknown</p>`',
        '    })}`;',
        '});'
    ].join( String( '\n' ) );

    assert.throws(function invalidBoundaryCompile(){
        //Compiling the malformed static envelope through the public compiler
        layerJavascriptComponentCompile( invalidBoundarySource, {
            componentId: String( 'invalid/error-boundary' )
        });

    }, LayerCompilerError );

});

test( 'rejects dynamic nested component option envelopes', function(){
    //Creating both variable and spread envelopes which the compiler cannot own safely
    const invalidNestedSourceList = [
        [
            "import {html, layerComponentCreate} from '@solcorp/layer';",
            "import MessageCard from './MessageCard.layer.js';",
            'const options = {};',
            'export default layerComponentCreate(function Invalid() {',
            '    return html`${MessageCard(options)}`;',
            '});'
        ].join( String( '\n' ) ),
        [
            "import {html, layerComponentCreate} from '@solcorp/layer';",
            "import MessageCard from './MessageCard.layer.js';",
            'const options = {};',
            'export default layerComponentCreate(function Invalid() {',
            '    return html`${MessageCard({...options})}`;',
            '});'
        ].join( String( '\n' ) )
    ];

    //Checking each dynamic shape through the same stable diagnostic contract
    for ( const invalidNestedSource of invalidNestedSourceList ){
        assert.throws(function invalidNestedComponentCompile(){
            //Compiling one unsupported invocation without executing its module
            layerJavascriptComponentCompile( invalidNestedSource, {
                componentId: String( 'invalid/nested' ),
                file: String( 'Invalid.layer.js' )
            });

        }, LayerCompilerError );

    }

});
