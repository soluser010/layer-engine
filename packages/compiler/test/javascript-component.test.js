import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LayerCompilerError,
    layerExpressionEvaluate,
    layerJavascriptComponentCompile
} from '../src/index.js';

const componentSource = [
    "import {css as layerCss, html as layerHtml, layerComponentCreate as componentCreate, layerPageCreate} from '@solcorp/layer';",
    '',
    'export const properties = {',
    "    title: {type: 'string', required: true}",
    '};',
    '',
    'export const events = {submit: {}};',
    '',
    'export const page = layerPageCreate({',
    "    render: 'ssr',",
    "    auth: 'session'",
    '});',
    '',
    'export const styles = layerCss`',
    '    .editor {',
    '        display: grid;',
    '    }',
    '`;',
    '',
    'export default componentCreate(function MessageEditor(properties, context) {',
    '    const draft = properties.draft;',
    '    const inputReference = properties.inputReference;',
    '',
    '    function formSubmit(event) {',
    '        event.preventDefault();',
    "        context.emit('submit', {});",
    '    }',
    '',
    '    return layerHtml`',
    '        <form class="editor" aria-label=${properties.title} @submit=${formSubmit}>',
    '            <h1>${properties.title}</h1>',
    '            <input .value=${draft} ?disabled=${properties.disabled} ref=${inputReference}>',
    '            <textarea l-model=${draft}></textarea>',
    '        </form>',
    '    `;',
    '});'
].join('\n');

/**
 * @param {Record<string, unknown>[]} planList
 * @returns {any[]}
 */
function elementPlanListCreate(planList) {
    const elementPlanList = [];

    for (const planData of planList) {
        if (planData.kind !== 'element') {
            continue;

        }

        elementPlanList.push(planData);
        elementPlanList.push(...elementPlanListCreate(
            /** @type {Record<string, unknown>[]} */ (planData.children)
        ));

    }

    return elementPlanList;

}

test('compiles aliased .layer.js imports and native interpolation contexts', function() {
    const componentData = /** @type {any} */ (layerJavascriptComponentCompile(componentSource, {
        componentId: 'forms/message-editor',
        file: 'MessageEditor.layer.js'
    }));
    const elementPlanList = elementPlanListCreate(componentData.template);
    const formPlan = elementPlanList.find(function formPlanFind(planData) {
        return planData.tag === 'form';

    });
    const inputPlan = elementPlanList.find(function inputPlanFind(planData) {
        return planData.tag === 'input';

    });
    const textareaPlan = elementPlanList.find(function textareaPlanFind(planData) {
        return planData.tag === 'textarea';

    });

    assert.equal(componentData.format, 'layer.js');
    assert.equal(componentData.module.componentName, 'MessageEditor');
    assert.equal(componentData.module.metadata.properties.title.required, true);
    assert.equal(componentData.module.metadata.page.render, 'ssr');
    assert.match(componentData.style.css, /data-layer-scope/);
    assert.equal(formPlan?.attributeBindings[0].mode, 'attribute');
    assert.equal(formPlan?.eventBindings[0].event, 'submit');
    assert.deepEqual(inputPlan?.attributeBindings.map(function bindingModeRead(/** @type {any} */ bindingData) {
        return bindingData.mode;

    }), ['property', 'boolean']);
    assert.equal(inputPlan?.refBinding.expression.type, 'Identifier');
    assert.equal(textareaPlan?.modelBindings[0].expression.type, 'Identifier');
    assert.equal(componentData.sourceMap.expressions.length, 7);
    assert.ok(Object.isFrozen(componentData));
    assert.ok(Object.isFrozen(componentData.template));
});

test('preserves expression AST values without executing the component module', function() {
    const componentData = /** @type {any} */ (layerJavascriptComponentCompile(componentSource, {
        componentId: 'forms/message-editor'
    }));
    const headingPlan = elementPlanListCreate(componentData.template).find(function headingPlanFind(planData) {
        return planData.tag === 'h1';

    });
    const textExpression = headingPlan?.children[0].parts.find(function expressionPartFind(/** @type {any} */ partData) {
        return partData.kind === 'expression';

    }).expression;

    assert.equal(layerExpressionEvaluate(textExpression, {
        properties: {
            title: 'Safe title'
        }
    }), 'Safe title');
});

test('rejects legacy interpolation and ambiguous HTML binding positions', function() {
    const invalidTemplateList = [
        '<p>{{ properties.title }}</p>',
        '<p title="${properties.title}">Text</p>',
        '<${properties.tag}>Text</${properties.tag}>',
        '<p title=${properties.title}suffix>Text</p>'
    ];

    for (const templateSource of invalidTemplateList) {
        const invalidSource = [
            "import {html, layerComponentCreate} from '@solcorp/layer';",
            'export default layerComponentCreate(function Invalid(properties) {',
            `    return html\`${templateSource}\`;`,
            '});'
        ].join('\n');

        assert.throws(function invalidTemplateCompile() {
            layerJavascriptComponentCompile(invalidSource, {
                componentId: 'invalid/template',
                file: 'Invalid.layer.js'
            });
        }, LayerCompilerError);
    }
});

test('requires Layer import bindings and static component CSS metadata', function() {
    const invalidSourceList = [
        [
            "import {layerComponentCreate} from '@solcorp/layer';",
            "import {html} from './fake-runtime.js';",
            'export default layerComponentCreate(function Invalid() {',
            '    return html`<p>Invalid</p>`;',
            '});'
        ].join('\n'),
        [
            "import {css, html, layerComponentCreate} from '@solcorp/layer';",
            "const color = 'red';",
            'export const styles = css`.x { color: ${color}; }`;',
            'export default layerComponentCreate(function Invalid() {',
            '    return html`<p>Invalid</p>`;',
            '});'
        ].join('\n')
    ];

    for (const invalidSource of invalidSourceList) {
        assert.throws(function invalidModuleCompile() {
            layerJavascriptComponentCompile(invalidSource, {
                componentId: 'invalid/module'
            });
        }, LayerCompilerError);
    }
});

test('rejects unsafe expressions and runtime code generation with source diagnostics', function() {
    const unsafeSourceList = [
        [
            "import {html, layerComponentCreate} from '@solcorp/layer';",
            'export default layerComponentCreate(function Invalid() {',
            '    return html`<p>${globalThis.secret}</p>`;',
            '});'
        ].join('\n'),
        [
            "import {html, layerComponentCreate} from '@solcorp/layer';",
            'export default layerComponentCreate(function Invalid() {',
            "    const result = eval('1');",
            '    return html`<p>${result}</p>`;',
            '});'
        ].join('\n')
    ];

    for (const unsafeSource of unsafeSourceList) {
        assert.throws(function unsafeModuleCompile() {
            layerJavascriptComponentCompile(unsafeSource, {
                componentId: 'unsafe/module',
                file: 'Unsafe.layer.js'
            });
        }, function unsafeDiagnosticCheck(errorData) {
            const compilerError = /** @type {LayerCompilerError} */ (errorData);

            return compilerError instanceof LayerCompilerError && compilerError.file === 'Unsafe.layer.js';
        });
    }
});
