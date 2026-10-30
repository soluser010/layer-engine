const assert = require('node:assert/strict');
const test = require('node:test');
const {
    embeddedDocumentAtOffsetCreate,
    embeddedRegionsFind
} = require('../src/embedded-language.js');
const {
    embeddedCompletionProvide,
    embeddedDiagnosticsProvide,
    embeddedHoverProvide,
    layerCompletionItemsCreate
} = require('../src/embedded-language-service.js');
const {layerFileDecorationDataCreate} = require('../src/file-decoration.js');

test('embedded scanner selects nested HTML and CSS while returning interpolations to JavaScript', () => {
    const sourceData = [
        "const ignored = 'html`<main></main>`';",
        '// css`body { color: red; }`',
        'const view = html`',
        '    <section class=${state.className}>',
        '        ${when(state.ready, () => html`<span>${state.label}</span>`)}',
        '    </section>',
        '`;',
        'const styles = css`',
        '    section { display: grid; }',
        '`;'
    ].join('\n');
    const regionRecords = embeddedRegionsFind(sourceData);
    const outerHtmlOffset = sourceData.indexOf('<section') + 2;
    const interpolationOffset = sourceData.indexOf('state.className') + 2;
    const nestedHtmlOffset = sourceData.indexOf('<span>') + 2;
    const nestedInterpolationOffset = sourceData.indexOf('state.label') + 2;
    const cssOffset = sourceData.indexOf('display') + 2;

    assert.deepEqual(regionRecords.map((regionData) => regionData.languageId), ['html', 'html', 'css']);
    assert.equal(embeddedDocumentAtOffsetCreate(sourceData, outerHtmlOffset)?.languageId, 'html');
    assert.equal(embeddedDocumentAtOffsetCreate(sourceData, interpolationOffset), null);
    assert.equal(embeddedDocumentAtOffsetCreate(sourceData, nestedHtmlOffset)?.languageId, 'html');
    assert.equal(embeddedDocumentAtOffsetCreate(sourceData, nestedInterpolationOffset), null);
    assert.equal(embeddedDocumentAtOffsetCreate(sourceData, cssOffset)?.languageId, 'css');
});

test('embedded scanner tolerates incomplete templates, escapes, comments, and regular expressions', () => {
    const sourceData = [
        'const pattern = /[}]/u;',
        'const view = html`',
        '    <p data-value="escaped \\` marker">',
        '        ${pattern.test(value) ? `nested ${value}` : value}',
        '    </p>'
    ].join('\n');
    const contentOffset = sourceData.indexOf('<p') + 1;
    const interpolationOffset = sourceData.indexOf('pattern.test') + 1;
    const regionRecords = embeddedRegionsFind(sourceData);

    assert.equal(regionRecords.length, 1);
    assert.equal(regionRecords[0].closed, false);
    assert.equal(embeddedDocumentAtOffsetCreate(sourceData, contentOffset)?.languageId, 'html');
    assert.equal(embeddedDocumentAtOffsetCreate(sourceData, interpolationOffset), null);
});

test('embedded language services provide standard and Layer HTML and CSS completions', () => {
    const htmlSourceData = 'const view = html`<sec`;';
    const htmlCompletionResult = embeddedCompletionProvide({
        source: htmlSourceData,
        offset: htmlSourceData.indexOf('<sec') + 4,
        uri: 'file:///component.layer.js',
        version: 1
    });
    const attributeSourceData = 'const view = html`<button aria->Open</button>`;';
    const attributeCompletionResult = embeddedCompletionProvide({
        source: attributeSourceData,
        offset: attributeSourceData.indexOf('aria-') + 5,
        uri: 'file:///component.layer.js',
        version: 2
    });
    const cssSourceData = 'const styles = css`section { dis }`;';
    const cssCompletionResult = embeddedCompletionProvide({
        source: cssSourceData,
        offset: cssSourceData.indexOf('dis') + 3,
        uri: 'file:///component.layer.js',
        version: 3
    });
    const gridSourceData = 'const styles = css`section { grid-template- }`;';
    const gridCompletionResult = embeddedCompletionProvide({
        source: gridSourceData,
        offset: gridSourceData.indexOf('grid-template-') + 'grid-template-'.length,
        uri: 'file:///component.layer.js',
        version: 4
    });

    assert.ok(htmlCompletionResult?.items.some((itemData) => itemData.label === 'section'));
    assert.ok(attributeCompletionResult?.items.some((itemData) => itemData.label === 'aria-label'));
    assert.ok(cssCompletionResult?.items.some((itemData) => itemData.label === 'display'));
    assert.ok(gridCompletionResult?.items.some((itemData) => itemData.label === 'grid-template-columns'));
    assert.ok(htmlCompletionResult?.items.some((itemData) => itemData.label === '@click'));
    assert.ok(cssCompletionResult?.items.some((itemData) => itemData.label === ':global()'));
});

test('Layer global CSS completion replaces a partial selector without duplicating the colon', () => {
    const selectorPrefixData = ['', ':', ':g', ':global'];

    for (const [prefixIndex, selectorPrefix] of selectorPrefixData.entries()) {
        const sourceData = `const styles = css\`\n    ${selectorPrefix}\n\`;`;
        const prefixStartOffset = sourceData.indexOf('\n    ') + '\n    '.length;
        const sourceOffset = prefixStartOffset + selectorPrefix.length;
        const completionResult = embeddedCompletionProvide({
            source: sourceData,
            offset: sourceOffset,
            uri: 'file:///component.layer.js',
            version: prefixIndex + 1
        });
        const globalCompletion = completionResult?.items.find((itemData) => itemData.label === ':global()');

        assert.equal(globalCompletion?.textEdit?.newText, ':global(${1:selector}) {\n    ${0}\n}');
        assert.deepEqual(globalCompletion?.textEdit?.range, {
            start: {line: 1, character: 4},
            end: {line: 1, character: 4 + selectorPrefix.length}
        });

        const sourceBeforeCompletion = sourceData.slice(0, prefixStartOffset);
        const sourceAfterCompletion = sourceData.slice(sourceOffset);
        const completedSource = `${sourceBeforeCompletion}${globalCompletion?.textEdit?.newText}${sourceAfterCompletion}`;

        assert.equal(completedSource.includes('::global'), false);

    }
});

test('bare HTML tag completion replaces the entered word with a complete element', () => {
    const sourceData = 'const view = html`\n    section\n`;';
    const completionResult = embeddedCompletionProvide({
        source: sourceData,
        offset: sourceData.indexOf('section') + 'section'.length,
        uri: 'file:///component.layer.js',
        version: 1
    });
    const sectionCompletion = completionResult?.items.find((itemData) => itemData.label === 'section');

    assert.equal(sectionCompletion?.textEdit?.newText, '<section>${0}</section>');
    assert.deepEqual(sectionCompletion?.textEdit?.range, {
        start: {line: 1, character: 4},
        end: {line: 1, character: 11}
    });
    assert.equal(sectionCompletion?.preselect, true);
});

test('bare HTML tag completion stays outside tags and JavaScript identifiers', () => {
    const attributeSourceData = 'const view = html`<section class>`;';
    const identifierSourceData = 'const view = html`component.section`;';
    const attributeResult = embeddedCompletionProvide({
        source: attributeSourceData,
        offset: attributeSourceData.indexOf('class') + 'class'.length,
        uri: 'file:///component.layer.js',
        version: 1
    });
    const identifierResult = embeddedCompletionProvide({
        source: identifierSourceData,
        offset: identifierSourceData.indexOf('section') + 'section'.length,
        uri: 'file:///component.layer.js',
        version: 2
    });

    assert.equal(attributeResult?.items.some((itemData) => itemData.textEdit?.newText === '<section>${0}</section>'), false);
    assert.equal(identifierResult?.items.some((itemData) => itemData.textEdit?.newText === '<section>${0}</section>'), false);
});

test('embedded language services preserve native JavaScript ownership in interpolation', () => {
    const sourceData = 'const view = html`<p>${state.value}</p>`;';
    const resultData = embeddedCompletionProvide({
        source: sourceData,
        offset: sourceData.indexOf('state.value') + 3,
        uri: 'file:///component.layer.js',
        version: 1
    });

    assert.equal(resultData, null);
});

test('embedded language services provide hover and bounded diagnostics', () => {
    const hoverSourceData = 'const styles = css`section { display: grid; }`;';
    const hoverResult = embeddedHoverProvide({
        source: hoverSourceData,
        offset: hoverSourceData.indexOf('display') + 2,
        uri: 'file:///component.layer.js',
        version: 1
    });
    const diagnosticSourceData = [
        'const view = html`<section><strong>Open</section>`;',
        'const styles = css`section { unknown-layer-property: red; }`;'
    ].join('\n');
    const diagnosticRecords = embeddedDiagnosticsProvide({
        source: diagnosticSourceData,
        uri: 'file:///component.layer.js',
        version: 2
    });

    assert.ok(hoverResult);
    assert.ok(diagnosticRecords.some((diagnosticData) => diagnosticData.code === 'LAYER_HTML_TAG_UNCLOSED'));
    assert.ok(diagnosticRecords.some((diagnosticData) => String(diagnosticData.message).includes('Unknown property')));
});

test('Layer completion items remain isolated by embedded language', () => {
    const htmlItems = layerCompletionItemsCreate('html');
    const cssItems = layerCompletionItemsCreate('css');

    assert.ok(htmlItems.some((itemData) => itemData.label === 'repeat()'));
    assert.equal(htmlItems.some((itemData) => itemData.label === ':global()'), false);
    assert.ok(cssItems.some((itemData) => itemData.label === ':global()'));
    assert.equal(cssItems.some((itemData) => itemData.label === '@click'), false);
    assert.ok(htmlItems.some((itemData) => itemData.label === 'data-layer-keyboard' && itemData.insertText.includes('resize,preserve')));
    assert.ok(htmlItems.some((itemData) => itemData.label === 'data-layer-focus-retain'));
    assert.equal(cssItems.some((itemData) => itemData.label === 'data-layer-keyboard'), false);
});

test('Layer file decoration identifies only canonical component files', () => {
    assert.deepEqual(layerFileDecorationDataCreate('C:/project/card.layer.js'), {
        badge: 'L',
        tooltip: 'Layer component'
    });
    assert.deepEqual(layerFileDecorationDataCreate('C:/project/CARD.LAYER.JS'), {
        badge: 'L',
        tooltip: 'Layer component'
    });
    assert.equal(layerFileDecorationDataCreate('C:/project/card.js'), null);
});
