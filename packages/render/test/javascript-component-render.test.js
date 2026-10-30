import assert from 'node:assert/strict';
import test from 'node:test';
import {layerJavascriptComponentCompile} from '@solcorp/layer-compiler';
import {JSDOM} from 'jsdom';
import {
    layerCommitWait,
    layerComponentHydrate,
    layerComponentMount,
    layerComponentRenderToString,
    layerReferenceCreate,
    signal
} from '../src/index.js';

const componentSource = [
    "import {html, layerComponentCreate} from '@solcorp/layer';",
    'export default layerComponentCreate(function FieldExample() {',
    '    return html`',
    '        <section aria-label=${label}>',
    '            <h1>${title}</h1>',
    '            <input .value=${fieldValue} ?disabled=${disabled} ref=${fieldReference}>',
    '            <textarea l-model=${draft}></textarea>',
    '            <button type="button" @click=${buttonClick}>Save</button>',
    '        </section>',
    '    `;',
    '});'
].join('\n');

const componentData = layerJavascriptComponentCompile(componentSource, {
    componentId: 'examples/field',
    file: 'FieldExample.layer.js'
});

function renderScopeCreate() {
    const selectedEventList = /** @type {string[]} */ ([]);

    return {
        label: signal('Editor'),
        title: signal('Initial title'),
        fieldValue: signal('Initial field'),
        disabled: signal(true),
        fieldReference: layerReferenceCreate(),
        draft: signal('Initial draft'),
        buttonClick: function buttonClick(/** @type {Event} */ eventData) {
            selectedEventList.push(eventData.type);

        },
        selectedEventList
    };

}

test('mounts .layer.js bindings and mutates only their owned DOM targets', async function() {
    const browserData = new JSDOM('<!doctype html><div id="root"></div>');
    const rootNode = browserData.window.document.querySelector('#root');

    if (rootNode === null) {
        throw new Error('The test root is unavailable.');

    }

    const renderScope = renderScopeCreate();
    const renderHandle = layerComponentMount(componentData, rootNode, renderScope);
    const sectionNode = rootNode.querySelector('section');
    const inputNode = rootNode.querySelector('input');
    const textareaNode = rootNode.querySelector('textarea');
    const buttonNode = rootNode.querySelector('button');

    assert.equal(rootNode.querySelector('h1')?.textContent, 'Initial title');
    assert.equal(sectionNode?.getAttribute('aria-label'), 'Editor');
    assert.equal(inputNode?.value, 'Initial field');
    assert.equal(inputNode?.hasAttribute('disabled'), true);
    assert.equal(renderScope.fieldReference.current, inputNode);

    renderScope.title.set('Updated title');
    renderScope.fieldValue.set('Updated field');
    renderScope.disabled.set(false);
    await layerCommitWait();

    assert.equal(rootNode.querySelector('section'), sectionNode);
    assert.equal(rootNode.querySelector('input'), inputNode);
    assert.equal(rootNode.querySelector('h1')?.textContent, 'Updated title');
    assert.equal(inputNode?.value, 'Updated field');
    assert.equal(inputNode?.hasAttribute('disabled'), false);

    buttonNode?.dispatchEvent(new browserData.window.Event('click'));
    assert.deepEqual(renderScope.selectedEventList, ['click']);

    if (textareaNode !== null) {
        textareaNode.value = 'Edited draft';
        textareaNode.dispatchEvent(new browserData.window.Event('input'));

    }

    assert.equal(renderScope.draft.get(), 'Edited draft');

    renderHandle.dispose();
    assert.equal(renderScope.fieldReference.current, null);
});

test('hydrates .layer.js without replacing SSR nodes and reconnects dynamic refs', function() {
    const serverScope = renderScopeCreate();
    const serverResult = layerComponentRenderToString(componentData, serverScope);

    assert.doesNotMatch(serverResult.html, /data-layer-ref/);

    const browserData = new JSDOM(`<!doctype html><div id="root">${serverResult.html}</div>`);
    const rootNode = browserData.window.document.querySelector('#root');

    if (rootNode === null) {
        throw new Error('The hydration root is unavailable.');

    }

    const inputNode = rootNode.querySelector('input');
    const clientScope = renderScopeCreate();
    const renderHandle = layerComponentHydrate(componentData, rootNode, clientScope);

    assert.equal(renderHandle.recovered, false);
    assert.equal(rootNode.querySelector('input'), inputNode);
    assert.equal(clientScope.fieldReference.current, inputNode);

    renderHandle.dispose();
    assert.equal(clientScope.fieldReference.current, null);
});

test('rejects a non-reference value at the dynamic ref boundary', function() {
    const browserData = new JSDOM('<!doctype html><div id="root"></div>');
    const rootNode = browserData.window.document.querySelector('#root');

    if (rootNode === null) {
        throw new Error('The test root is unavailable.');

    }

    const renderScope = renderScopeCreate();
    const invalidScope = {
        ...renderScope,
        fieldReference: {
            value: null
        }
    };

    assert.throws(function invalidReferenceMount() {
        layerComponentMount(componentData, rootNode, invalidScope);
    }, /reference object/);
});
