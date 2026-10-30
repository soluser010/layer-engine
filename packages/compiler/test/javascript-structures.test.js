import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LayerCompilerError,
    layerJavascriptComponentCompile
} from '../src/index.js';

const structuralSource = [
    "import {html, layerComponentCreate, repeat, when} from '@solcorp/layer';",
    'export default layerComponentCreate(function StructuralExample() {',
    '    return html`<main>${when(visible, () => html`<p>${label}</p>`, () => html`<p>Hidden</p>`)}</main><ul>${repeat(items, (item) => item.id, (item) => html`<li><input .value=${item.title}><span>${item.title}</span></li>`)}</ul>`;',
    '});'
].join('\n');

test('compiles when and repeat into isolated nested render plans', function() {
    //Compiling one source that covers both public structural helpers.
    const componentData = /** @type {any} */ (layerJavascriptComponentCompile(structuralSource, {
        componentId: 'examples/structures',
        file: 'Structures.layer.js'
    }));
    const mainPlan = componentData.template[0];
    const listPlan = componentData.template[1];
    const whenPlan = mainPlan.children[0];
    const repeatPlan = listPlan.children[0];

    assert.equal(whenPlan.kind, 'when');
    assert.equal(whenPlan.truthy.template[0].tag, 'p');
    assert.equal(whenPlan.falsy.template[0].tag, 'p');
    assert.deepEqual(whenPlan.truthy.markers, ['__layer_expression_000001__']);
    assert.equal(repeatPlan.kind, 'repeat');
    assert.equal(repeatPlan.item.template[0].tag, 'li');
    assert.match(repeatPlan.item.template[0].nodeId, /^structure:/);
    assert.deepEqual(componentData.sourceMap.expressions.map(function expressionKindRead(/** @type {any} */ expressionData) {
        //Reading the stable public kind without exposing compiler AST nodes.
        return expressionData.kind;

    }), ['when', 'repeat']);

});

test('rejects malformed structural helpers before runtime', function() {
    //Collecting invalid arity, callback, and item-root contracts.
    const invalidSourceList = [
        "import {html, layerComponentCreate, when} from '@solcorp/layer'; export default layerComponentCreate(function Invalid(){ return html`${when(visible)}`; });",
        "import {html, layerComponentCreate, repeat} from '@solcorp/layer'; export default layerComponentCreate(function Invalid(){ return html`${repeat(items, 'id', (item) => html`<p>${item.id}</p>`)}`; });",
        "import {html, layerComponentCreate, repeat} from '@solcorp/layer'; export default layerComponentCreate(function Invalid(){ return html`${repeat(items, (item) => item.id, (item) => html`<p>${item.id}</p><p>Duplicate</p>`)}`; });",
        "import {html, layerComponentCreate, when} from '@solcorp/layer'; export default layerComponentCreate(function Invalid(){ return html`<p title=${when(visible, () => html`<span>Invalid</span>`)}>Text</p>`; });",
        "import {html, layerComponentCreate, when} from '@solcorp/layer'; export default layerComponentCreate(function Invalid(){ return html`${when(visible, () => html`<script>alert(1)</script>`)}`; });"
    ];

    for (const invalidSource of invalidSourceList) {
        assert.throws(function invalidStructureCompile() {
            //Rejecting malformed structure during compilation rather than DOM work.
            layerJavascriptComponentCompile(invalidSource, {
                componentId: 'invalid/structure',
                file: 'Invalid.layer.js'
            });

        }, LayerCompilerError);

    }

});
