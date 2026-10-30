// @ts-nocheck

import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LayerCompilerError,
    layerJavascriptComponentCompile
} from '../src/index.js';

function componentSourceCreate({
    imports = 'html, layerComponentCreate',
    exports = '',
    body = 'return html`<p>Ready</p>`;',
    defaultExport = 'layerComponentCreate(function Example() { BODY })'
} = {}) {
    return [
        `import {${imports}} from '@solcorp/layer';`,
        exports,
        `export default ${defaultExport.replace('BODY', body)};`
    ].join('\n');

}

function invalidComponentAssert(componentSource) {
    assert.throws(function invalidComponentCompile() {
        layerJavascriptComponentCompile(componentSource, {
            componentId: 'tests/invalid',
            file: 'Invalid.layer.js'
        });
    }, LayerCompilerError);

}

test('reports malformed modules and invalid component export boundaries', function() {
    invalidComponentAssert('import {');
    invalidComponentAssert("import * as Layer from '@solcorp/layer'; export default Layer;");
    invalidComponentAssert("import {html} from '@solcorp/layer'; export const value = 1;");
    invalidComponentAssert(componentSourceCreate({
        defaultExport: 'layerComponentCreate'
    }));
    invalidComponentAssert(componentSourceCreate({
        defaultExport: 'layerComponentCreate(1)'
    }));
    invalidComponentAssert(componentSourceCreate({
        body: 'const value = 1;'
    }));
    invalidComponentAssert(componentSourceCreate({
        body: 'return "plain text";'
    }));
});

test('accepts concise component functions and static JSON metadata variants', function() {
    const componentData = layerJavascriptComponentCompile(componentSourceCreate({
        imports: 'html, layerComponentCreate, layerPageCreate',
        exports: [
            'export const properties = {',
            "    count: {type: 'number', minimum: -1},",
            "    choices: ['first', 'second']",
            '};',
            "export const page = layerPageCreate({render: 'csr'});"
        ].join('\n'),
        defaultExport: 'layerComponentCreate(() => html`<!-- safe --><p>Ready</p>`)'
    }), {
        componentId: 'tests/concise'
    });

    assert.equal(componentData.module.componentName, null);
    assert.equal(componentData.module.metadata.properties.count.minimum, -1);
    assert.deepEqual(componentData.module.metadata.properties.choices, ['first', 'second']);
});

test('rejects executable, mutable, spread, method, and blocked metadata', function() {
    const invalidExportList = [
        'export let properties = {};',
        'export const properties = schema;',
        'export const properties = {pattern: /unsafe/};',
        'export const properties = {items: [...otherItems]};',
        'export const properties = {method() { return true; }};',
        'export const properties = {constructor: {}};',
        'export const page = {};'
    ];

    for (const exportSource of invalidExportList) {
        invalidComponentAssert(componentSourceCreate({
            imports: 'html, layerComponentCreate, layerPageCreate',
            exports: exportSource
        }));
    }
});

test('rejects invalid style ownership and unsafe template structures', function() {
    const invalidSourceList = [
        componentSourceCreate({
            exports: 'export const styles = ".x {}";'
        }),
        componentSourceCreate({
            body: 'return html`<p>${title}{{ title }}</p>`;'
        }),
        componentSourceCreate({
            body: 'return html`<script>blocked</script>`;'
        }),
        componentSourceCreate({
            body: 'return html`<button onclick="blocked()">Blocked</button>`;'
        }),
        componentSourceCreate({
            body: 'return html`<div l-model=${draft}></div>`;'
        })
    ];

    for (const invalidSource of invalidSourceList) {
        invalidComponentAssert(invalidSource);
    }
});
