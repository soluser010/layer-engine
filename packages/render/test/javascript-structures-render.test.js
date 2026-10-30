import assert from 'node:assert/strict';
import test from 'node:test';
import {layerJavascriptComponentCompile} from '@solcorp/layer-compiler';
import {
    html,
    repeat,
    when
} from '@solcorp/layer';
import {JSDOM} from 'jsdom';
import {
    layerCommitWait,
    layerComponentHydrate,
    layerComponentMount,
    layerComponentRenderToString,
    layerRenderDiagnosticsCreate,
    signal
} from '../src/index.js';

const structuralSource = [
    "import {html, layerComponentCreate, repeat, when} from '@solcorp/layer';",
    'export default layerComponentCreate(function StructuralExample() {',
    '    return html`<main>${when(visible, () => html`<p>${label}</p>`, () => html`<p>Hidden</p>`)}</main><ul>${repeat(items, (item) => item.id, (item) => html`<li><input .value=${item.title}><span>${item.title}</span></li>`)}</ul>`;',
    '});'
].join('\n');

const componentData = layerJavascriptComponentCompile(structuralSource, {
    componentId: 'examples/structures',
    file: 'Structures.layer.js'
});

function structuralScopeCreate() {
    //Creating independent reactive values for each mount, SSR, or hydration pass.
    const visible = signal(true);
    const label = signal('Visible');
    const items = signal([
        {id: 'message-a', title: 'Alpha'},
        {id: 'message-b', title: 'Beta'}
    ]);

    //Function for rendering the active conditional branch
    const visibleRender = function(){
        //CallBack THE TEMPLATE
        return html`<p>${label}</p>`;

    };

    //Function for rendering the inactive conditional branch
    const hiddenRender = function(){
        //CallBack THE TEMPLATE
        return html`<p>Hidden</p>`;

    };

    //Function for reading one stable item identity
    const itemKeyGet = function( /** @type {{id: string, title: string}} */ itemData ){
        //CallBack THE STRING
        return String( itemData.id );

    };

    //Function for rendering one keyed item template
    const itemRender = function( /** @type {{id: string, title: string}} */ itemData ){
        //CallBack THE TEMPLATE
        return html`<li><input .value=${itemData.title}><span>${itemData.title}</span></li>`;

    };
    const templateResult = html`<main>${when(visible, visibleRender, hiddenRender)}</main><ul>${repeat(items, itemKeyGet, itemRender)}</ul>`;
    const expressionList = /** @type {any[]} */ (componentData.sourceMap.expressions);
    const renderScope = /** @type {Record<string, unknown>} */ ({});

    for (const [expressionIndex, expressionData] of expressionList.entries()) {
        renderScope[expressionData.marker] = templateResult.values[expressionIndex];

    }

    return {
        items,
        label,
        renderScope,
        visible
    };

}

test('when updates only its child region and repeat preserves keyed nodes', async function() {
    //Mounting the compiled plan into one isolated DOM document.
    const browserData = new JSDOM('<!doctype html><div id="root"></div>');
    const rootNode = browserData.window.document.querySelector('#root');

    if (rootNode === null) {
        throw new Error('The test root is unavailable.');

    }

    const scopeData = structuralScopeCreate();
    const diagnostics = layerRenderDiagnosticsCreate();
    const renderHandle = layerComponentMount(componentData, rootNode, scopeData.renderScope, {
        diagnostics
    });
    const mainNode = rootNode.querySelector('main');
    const alphaNode = rootNode.querySelectorAll('li')[0];
    const betaNode = rootNode.querySelectorAll('li')[1];
    const betaInput = betaNode?.querySelector('input');

    if ( betaInput === null || betaInput === undefined ){
        throw new Error( 'The keyed focus target is unavailable.' );

    }

    betaInput.focus();

    diagnostics.reset();
    scopeData.label.set('Updated');
    await layerCommitWait();

    assert.equal(rootNode.querySelector('main'), mainNode);
    assert.equal(rootNode.querySelector('p')?.textContent, 'Updated');
    assert.equal(diagnostics.snapshot().text, 1);
    assert.equal(diagnostics.snapshot().create, 0);

    diagnostics.reset();
    scopeData.items.set([
        {id: 'message-b', title: 'Beta updated'},
        {id: 'message-a', title: 'Alpha'},
        {id: 'message-c', title: 'Gamma'}
    ]);
    await layerCommitWait();

    const nextNodes = rootNode.querySelectorAll('li');

    assert.equal(nextNodes[0], betaNode);
    assert.equal(nextNodes[1], alphaNode);
    assert.equal(nextNodes[0]?.textContent, 'Beta updated');
    assert.equal(nextNodes[2]?.textContent, 'Gamma');
    assert.equal(browserData.window.document.activeElement, betaInput);
    assert.equal(diagnostics.snapshot().create, 6);
    assert.ok(diagnostics.snapshot().move >= 1);

    scopeData.visible.set(false);
    await layerCommitWait();
    assert.equal(rootNode.querySelector('p')?.textContent, 'Hidden');

    renderHandle.dispose();

});

test('SSR and hydration preserve structural nodes before later keyed updates', async function() {
    //Rendering server markers before connecting the same plan to existing nodes.
    const serverScope = structuralScopeCreate();
    const serverResult = layerComponentRenderToString(componentData, serverScope.renderScope);

    assert.match(serverResult.html, /layer-when:/);
    assert.match(serverResult.html, /layer-repeat:/);

    const browserData = new JSDOM(`<!doctype html><div id="root">${serverResult.html}</div>`);
    const rootNode = browserData.window.document.querySelector('#root');

    if (rootNode === null) {
        throw new Error('The hydration root is unavailable.');

    }

    const firstItemNode = rootNode.querySelector('li');
    const clientScope = structuralScopeCreate();
    const renderHandle = layerComponentHydrate(componentData, rootNode, clientScope.renderScope);

    assert.equal(renderHandle.recovered, false);
    assert.equal(rootNode.querySelector('li'), firstItemNode);

    clientScope.items.set([
        {id: 'message-b', title: 'Beta'},
        {id: 'message-a', title: 'Alpha'}
    ]);
    await layerCommitWait();

    assert.equal(rootNode.querySelectorAll('li')[1], firstItemNode);
    renderHandle.dispose();

});

test('structural runtime rejects forged descriptors, duplicate keys, and static drift', function() {
    const expressionList = /** @type {any[]} */ (componentData.sourceMap.expressions);
    const whenMarker = expressionList[0].marker;
    const repeatMarker = expressionList[1].marker;

    //Function for creating a valid conditional descriptor matching the compiled branches
    const validWhenCreate = function(){
        //CallBack THE OBJECT
        return when(
            true,
            function visibleRender(){
                //CallBack THE TEMPLATE
                return html`<p>${'Visible'}</p>`;

            },
            function hiddenRender(){
                //CallBack THE TEMPLATE
                return html`<p>Hidden</p>`;

            }
        );

    };

    //Function for requiring one mount-time structural failure
    const invalidMountRequire = function(
        /** @type {Record<string, unknown>} */ renderScope,
        /** @type {RegExp} */ messagePattern
    ){
        const browserData = new JSDOM('<!doctype html><div id="root"></div>');
        const rootNode = browserData.window.document.querySelector('#root');

        if ( rootNode === null ){
            throw new Error( 'The structural failure root is unavailable.' );

        }

        //Rejecting the invalid descriptor before it can own application content.
        assert.throws(function invalidStructureMount(){
            //Mounting through the same public component boundary as a real application.
            layerComponentMount(componentData, rootNode, renderScope);

        }, messagePattern);

    };
    const validRepeat = repeat(
        [{id: 'message-a', title: 'Alpha'}],
        function itemKeyGet( itemData ){
            //CallBack THE STRING
            return String( itemData.id );

        },
        function itemRender( itemData ){
            //CallBack THE TEMPLATE
            return html`<li><input .value=${itemData.title}><span>${itemData.title}</span></li>`;

        }
    );

    invalidMountRequire({
        [whenMarker]: {},
        [repeatMarker]: validRepeat
    }, /descriptor created by/);

    const duplicateRepeat = repeat(
        [
            {id: 'duplicate', title: 'One'},
            {id: 'duplicate', title: 'Two'}
        ],
        function itemKeyGet( itemData ){
            //CallBack THE STRING
            return String( itemData.id );

        },
        function itemRender( itemData ){
            //CallBack THE TEMPLATE
            return html`<li><input .value=${itemData.title}><span>${itemData.title}</span></li>`;

        }
    );

    invalidMountRequire({
        [whenMarker]: validWhenCreate(),
        [repeatMarker]: duplicateRepeat
    }, /Duplicate repeat key/);

    const driftedRepeat = repeat(
        [{id: 'message-a', title: 'Alpha'}],
        function itemKeyGet( itemData ){
            //CallBack THE STRING
            return String( itemData.id );

        },
        function itemRender( itemData ){
            //Returning a valid html value whose static shape does not match the build artifact.
            return html`<li><input .value=${itemData.title}><em>${itemData.title}</em></li>`;

        }
    );

    invalidMountRequire({
        [whenMarker]: validWhenCreate(),
        [repeatMarker]: driftedRepeat
    }, /changed its compiled static HTML/);

});
