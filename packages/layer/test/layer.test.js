import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
    css,
    html,
    layerBatch,
    layerComponentCreate,
    layerComponentDefinitionCheck,
    layerComputedCreate,
    layerOperationContractsCreate,
    layerPageCreate,
    layerReferenceCreate,
    layerSignalCreate,
    layerStoreCreate,
    layerTemplateResultCheck
} from '../src/index.js';

test('creates owned component definitions and native template values', function(){
    const componentDefinition = layerComponentCreate(function ExampleComponent(){
        return html`<p>${'Layer'}</p>`;

    });
    const templateResult = componentDefinition.render({}, {});

    assert.equal(layerComponentDefinitionCheck(componentDefinition), true);
    assert.equal(layerTemplateResultCheck(templateResult), true);
    assert.deepEqual(templateResult.strings, [
        '<p>',
        '</p>'
    ]);
    assert.deepEqual(templateResult.values, [
        'Layer'
    ]);
    assert.equal(Object.isFrozen(templateResult), true);
});

test('rejects invalid factories and foreign template records', function(){
    assert.throws(function invalidComponentCreate(){
        layerComponentCreate(/** @type {any} */ (null));

    }, TypeError);
    assert.throws(function invalidHtmlCall(){
        html(/** @type {any} */ ([]));

    }, TypeError);
    assert.equal(layerComponentDefinitionCheck({render() {}}), false);
    assert.equal(layerTemplateResultCheck({strings: [], values: []}), false);
});

test('creates static CSS and cloned page metadata', function(){
    const styleData = css`.Example { color: red; }`;
    const pageInput = {
        render: /** @type {'csr'} */ ('csr'),
        metadata: {
            title: 'Example'
        }
    };
    const pageData = layerPageCreate(pageInput);

    pageInput.metadata.title = 'Changed';

    assert.equal(styleData, '.Example { color: red; }');
    assert.equal(pageData.metadata?.title, 'Example');
    assert.equal(Object.isFrozen(pageData), true);
    assert.throws(function dynamicCssCreate(){
        css`.Example { color: ${'red'}; }`;

    }, TypeError);
    assert.throws(function invalidPageCreate(){
        layerPageCreate(/** @type {any} */ ([]));

    }, TypeError);
});

test('generated declarations preserve public authoring instructions and page fields', async function(){
    const declarationSourceData = await readFile(new URL('../dist/index.d.ts', import.meta.url), 'utf8');

    assert.match(declarationSourceData, /Declares static route\/page policies/u);
    assert.match(declarationSourceData, /Use `auth: 'none'` explicitly for a public page/u);
    assert.match(declarationSourceData, /export type LayerPageConfiguration/u);
    assert.match(declarationSourceData, /render\?: LayerPageRenderMode/u);
    assert.match(declarationSourceData, /permissions\?: readonly string\[\]/u);
    assert.match(declarationSourceData, /metadata\?: LayerPageMetadata/u);
    assert.match(declarationSourceData, /Declares compiler-owned HTML/u);
    assert.match(declarationSourceData, /Layer scopes selectors to this component/u);
    assert.match(declarationSourceData, /Creates an immutable Layer component/u);
    assert.match(declarationSourceData, /Creates a writable reactive value/u);
    assert.match(declarationSourceData, /Runs multiple signal writes as one scheduled reactive commit/u);
    assert.match(declarationSourceData, /holder for `ref=\$\{reference\}`/u);
});

test('validates isolated immutable operation contracts', function(){
    const inputSchema = {
        type: 'object',
        properties: {
            title: {
                type: 'string'
            }
        }
    };
    const contractList = layerOperationContractsCreate([{
        name: 'article.list',
        type: 'query',
        inputSchema,
        outputSchema: true,
        auth: 'none'
    }]);

    inputSchema.type = 'string';
    const operationData = contractList[0];

    assert.ok(operationData);
    assert.equal(operationData.name, 'article.list');
    assert.equal(/** @type {any} */ (operationData.inputSchema).type, 'object');
    assert.equal(Object.isFrozen(contractList), true);
    assert.equal(Object.isFrozen(contractList[0]), true);
    assert.throws(function operationListReject(){
        layerOperationContractsCreate(/** @type {any} */ ({}));

    }, /must be an array/);
    assert.throws(function operationTypeReject(){
        layerOperationContractsCreate([{
            name: 'article.list',
            type: 'events.open',
            inputSchema: true,
            outputSchema: true
        }]);

    }, /query, command, or sync/);
    assert.throws(function executableMetadataReject(){
        layerOperationContractsCreate([{
            name: 'article.list',
            type: 'query',
            inputSchema: true,
            outputSchema: true,
            handler() {}
        }]);

    }, /unknown fields/);
    assert.throws(function duplicateOperationReject(){
        layerOperationContractsCreate([{
            name: 'article.list',
            type: 'query',
            inputSchema: true,
            outputSchema: true
        }, {
            name: 'article.list',
            type: 'query',
            inputSchema: true,
            outputSchema: true
        }]);

    }, /duplicated/);
    const metadataContracts = layerOperationContractsCreate([{
        name: 'article.create',
        type: 'command',
        inputSchema: true,
        outputSchema: false,
        permissions: ['article.create'],
        audit: {
            enabled: true
        }
    }]);

    assert.equal(Object.isFrozen(metadataContracts[0]?.permissions), true);
    assert.equal(Object.isFrozen(metadataContracts[0]?.audit), true);
    assert.throws(function unsupportedMetadataValueReject(){
        layerOperationContractsCreate([{
            name: 'article.date',
            type: 'query',
            inputSchema: true,
            outputSchema: true,
            audit: {
                createdAt: new Date()
            }
        }]);

    }, /JSON-compatible/);
});

test('exposes canonical reactive aliases and references', function(){
    const count = layerSignalCreate(1);
    const doubled = layerComputedCreate(function doubledCompute(){
        return count.get() * 2;

    });
    const state = layerStoreCreate({
        status: 'ready'
    });
    const referenceData = layerReferenceCreate();

    layerBatch(function countBatch(){
        count.set(2);
        state.status = 'updated';

    });

    assert.equal(doubled.get(), 4);
    assert.equal(state.status, 'updated');
    assert.equal(referenceData.current, null);
    doubled.dispose();
});
