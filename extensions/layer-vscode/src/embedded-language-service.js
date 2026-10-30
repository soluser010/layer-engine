'use strict';

const {getCSSLanguageService} = require('vscode-css-languageservice');
const {
    getDefaultHTMLDataProvider,
    getLanguageService: htmlLanguageServiceCreate
} = require('vscode-html-languageservice');
const {TextDocument} = require('vscode-languageserver-textdocument');
const {
    embeddedDocumentAtOffsetCreate,
    embeddedDocumentByteLimit,
    embeddedDocumentsCreate,
    embeddedInterpolationCheck
} = require('./embedded-language.js');

const htmlLanguageService = htmlLanguageServiceCreate();
const htmlDefaultDataProvider = getDefaultHTMLDataProvider();
const cssLanguageService = getCSSLanguageService();
const languageDocumentCacheLimit = 32;
const languageDocumentCache = new Map();
const htmlVoidTags = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr'
]);
const htmlOptionalEndTags = new Set([
    'body',
    'colgroup',
    'dd',
    'dt',
    'head',
    'html',
    'li',
    'option',
    'p',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr'
]);
const htmlTagData = Object.freeze(htmlDefaultDataProvider.provideTags().map(function htmlTagNormalize(tagData) {
    //Retaining the built-in HTML catalog while preventing shared mutable records.
    return Object.freeze({
        description: tagData.description,
        name: String(tagData.name),
        void: Boolean(tagData.void)
    });

}));

const layerHtmlCompletionData = Object.freeze([
    Object.freeze({label: 'data-layer-keyboard', detail: 'Keyboard policy: resize working area or preserve its pre-keyboard height', insertText: 'data-layer-keyboard="${1|resize,preserve|}"'}),
    Object.freeze({label: 'data-layer-scroll', detail: 'Preserve scroll without automatically revealing this input', insertText: 'data-layer-scroll="preserve"'}),
    Object.freeze({label: 'data-layer-focus', detail: 'Retain composer focus for explicitly marked pointer actions, not user blur', insertText: 'data-layer-focus="retain"'}),
    Object.freeze({label: 'data-layer-focus-retain', detail: 'Mark a pointer action that must not take focus away from a retained composer', insertText: 'data-layer-focus-retain'}),
    Object.freeze({label: 'data-layer-viewport', detail: 'Declare a named local viewport region', insertText: 'data-layer-viewport="${1:chat}"'}),
    Object.freeze({label: 'data-layer-viewport-target', detail: 'Choose the named viewport region affected by this input', insertText: 'data-layer-viewport-target="${1:chat}"'}),
    Object.freeze({label: 'data-layer-scroll-region', detail: 'Declare an independently scrollable app region', insertText: 'data-layer-scroll-region="${1:messages}"'}),
    Object.freeze({label: 'data-layer-scroll-key', detail: 'Mark a stable item used for item-relative scroll anchors', insertText: 'data-layer-scroll-key="${1:message-id}"'}),
    Object.freeze({label: '@click', detail: 'Layer event binding', insertText: '@click=\\${${1:handler}}'}),
    Object.freeze({label: '.value', detail: 'Layer DOM property binding', insertText: '.value=\\${${1:value}}'}),
    Object.freeze({label: '?disabled', detail: 'Layer boolean attribute binding', insertText: '?disabled=\\${${1:condition}}'}),
    Object.freeze({label: 'class=${...}', detail: 'Layer dynamic attribute binding', insertText: 'class=\\${${1:className}}'}),
    Object.freeze({label: 'l-model', detail: 'Layer two-way form binding', insertText: 'l-model=\\${${1:field}}'}),
    Object.freeze({label: 'ref=${...}', detail: 'Layer element reference', insertText: 'ref=\\${${1:reference}}'}),
    Object.freeze({
        label: 'when()',
        detail: 'Layer conditional child renderer',
        insertText: '\\${when(${1:condition}, () => html`${0}`)}'
    }),
    Object.freeze({
        label: 'repeat()',
        detail: 'Layer keyed list renderer',
        insertText: '\\${repeat(${1:items}, ${2:key}, (${3:item}) => html`${0}`)}'
    })
]);
const layerCssCompletionData = Object.freeze([
    Object.freeze({
        label: ':global()',
        detail: 'Layer global selector escape',
        insertText: ':global(${1:selector}) {\n    ${0}\n}'
    }),
    Object.freeze({
        label: '--layer-property',
        detail: 'CSS custom property',
        insertText: '--${1:name}: ${2:value};'
    }),
    Object.freeze({
        label: 'Layer scoped rule',
        detail: 'Scoped component style rule',
        insertText: '.${1:component} {\n    ${2:display}: ${3:block};\n}'
    })
]);

/**
 * @param {string} documentUri
 * @param {number} documentVersion
 * @param {{languageId: 'html' | 'css', text: string, region: {contentStart: number}}} embeddedDocumentData
 */
function languageTextDocumentCreate(documentUri, documentVersion, embeddedDocumentData) {
    //Creating a stable virtual URI while preserving every host source position.
    const virtualDocumentUri = `${documentUri}.layer-${embeddedDocumentData.region.contentStart}.${embeddedDocumentData.languageId}`;

    return TextDocument.create(
        virtualDocumentUri,
        embeddedDocumentData.languageId,
        Number(documentVersion),
        embeddedDocumentData.text
    );

}

/**
 * @param {string} sourceData
 */
function sourceFingerprintCreate(sourceData) {
    let fingerprintData = 2166136261;

    //Creating a small deterministic cache discriminator without retaining duplicate source text.
    for (let sourceOffset = 0; sourceOffset < sourceData.length; sourceOffset += 1) {
        fingerprintData ^= sourceData.charCodeAt(sourceOffset);
        fingerprintData = Math.imul(fingerprintData, 16777619);

    }

    //CallBack THE STRING
    return (fingerprintData >>> 0).toString(16);

}

/**
 * @param {string} documentUri
 * @param {number} documentVersion
 * @param {{languageId: 'html' | 'css', text: string, region: {contentStart: number}}} embeddedDocumentData
 */
function languageDocumentParsedGet(documentUri, documentVersion, embeddedDocumentData) {
    const sourceFingerprint = sourceFingerprintCreate(embeddedDocumentData.text);
    const cacheKey = `${documentUri}|${documentVersion}|${embeddedDocumentData.languageId}|${embeddedDocumentData.region.contentStart}|${sourceFingerprint}`;
    const cachedDocumentData = languageDocumentCache.get(cacheKey);

    if (cachedDocumentData !== undefined) {
        //CallBack THE OBJECT
        return cachedDocumentData;

    }

    const languageDocument = languageTextDocumentCreate(
        documentUri,
        documentVersion,
        embeddedDocumentData
    );
    let parsedDocument;

    if (embeddedDocumentData.languageId === 'html') {
        //Parsing the virtual HTML document once for completion, hover, and validation.
        parsedDocument = htmlLanguageService.parseHTMLDocument(languageDocument);

    } else {
        //Parsing the virtual CSS document once for completion, hover, and validation.
        parsedDocument = cssLanguageService.parseStylesheet(languageDocument);

    }

    const parsedDocumentData = Object.freeze({
        languageDocument,
        parsedDocument
    });
    languageDocumentCache.set(cacheKey, parsedDocumentData);

    if (languageDocumentCache.size > languageDocumentCacheLimit) {
        //Removing the oldest cached document before retaining more editor revisions.
        const oldestCacheKey = languageDocumentCache.keys().next().value;

        if (oldestCacheKey !== undefined) {
            languageDocumentCache.delete(oldestCacheKey);

        }

    }

    //CallBack THE OBJECT
    return parsedDocumentData;

}

/**
 * @typedef {object} LayerCompletionItem
 * @property {string} label
 * @property {string} detail
 * @property {string} insertText
 * @property {number} insertTextFormat
 * @property {number} kind
 * @property {string} sortText
 * @property {{newText: string, range: {start: {line: number, character: number}, end: {line: number, character: number}}}} [textEdit]
 */

/**
 * @param {'html' | 'css'} languageId
 * @param {{source: string, sourceOffset: number, embeddedDocumentData: {region: {contentStart: number}}, languageDocument: ReturnType<typeof languageTextDocumentCreate>} | null} [completionContext]
 */
function layerCompletionItemsCreate(languageId, completionContext = null) {
    let completionSourceData = /** @type {ReadonlyArray<Readonly<{
        label: string,
        detail: string,
        insertText: string
    }>>} */ (layerCssCompletionData);

    if (languageId === 'html') {
        //Selecting only Layer snippets that are valid in HTML templates.
        completionSourceData = layerHtmlCompletionData;

    }

    //Creating LSP-compatible snippet items for the selected embedded language.
    return completionSourceData.map(function layerCompletionItemCreate(completionData) {
        //Converting one declarative snippet into an LSP completion item.
        const completionItemData = /** @type {LayerCompletionItem} */ ({
            label: completionData.label,
            detail: completionData.detail,
            insertText: completionData.insertText,
            insertTextFormat: 2,
            kind: 15,
            sortText: `0-layer-${completionData.label}`
        });

        //Replacing the complete partially entered :global token to avoid a duplicate colon.
        if (
            languageId === 'css' &&
            completionData.label === ':global()' &&
            completionContext !== null
        ) {
            const embeddedPrefixData = completionContext.source.slice(
                completionContext.embeddedDocumentData.region.contentStart,
                completionContext.sourceOffset
            );
            const enteredTokenMatch = /:?[A-Za-z-]*$/u.exec(embeddedPrefixData);
            const enteredTokenData = String(enteredTokenMatch?.[0] ?? '');
            const replacementStartOffset = completionContext.sourceOffset - enteredTokenData.length;

            completionItemData.textEdit = {
                newText: completionData.insertText,
                range: {
                    start: completionContext.languageDocument.positionAt(replacementStartOffset),
                    end: completionContext.languageDocument.positionAt(completionContext.sourceOffset)
                }
            };

        }

        //CallBack THE OBJECT
        return completionItemData;

    });

}

/**
 * @param {string} sourceData
 * @param {number} sourceOffset
 * @param {{region: {contentStart: number}}} embeddedDocumentData
 * @param {ReturnType<typeof languageTextDocumentCreate>} languageDocument
 */
function htmlBareTagCompletionItemsCreate(sourceData, sourceOffset, embeddedDocumentData, languageDocument) {
    const contentSourceData = sourceData.slice(embeddedDocumentData.region.contentStart, sourceOffset);
    const tagNameMatch = contentSourceData.match(/([A-Za-z][A-Za-z0-9-]*)$/u);

    if (tagNameMatch === null) {
        return [];

    }

    const enteredTagName = tagNameMatch[1];
    const tagNameStartOffset = sourceOffset - enteredTagName.length;
    const precedingCharacter = sourceData[tagNameStartOffset - 1] ?? '';
    const lastTagOpenOffset = contentSourceData.lastIndexOf('<');
    const lastTagCloseOffset = contentSourceData.lastIndexOf('>');

    if (
        lastTagOpenOffset > lastTagCloseOffset ||
        (precedingCharacter !== '' && !/[\s>]/u.test(precedingCharacter))
    ) {
        return [];

    }

    const replacementRange = {
        start: languageDocument.positionAt(tagNameStartOffset),
        end: languageDocument.positionAt(sourceOffset)
    };
    const normalizedTagName = enteredTagName.toLowerCase();

    //Creating ordinary HTML-style tag expansion without changing JavaScript language ownership.
    return htmlTagData.map(function htmlBareTagCompletionItemCreate(tagData) {
        let insertionData;

        if (tagData.void) {
            //Completing void elements without creating an invalid closing tag.
            insertionData = `<${tagData.name}>`;

        } else {
            //Completing ordinary elements with a cursor stop inside the new pair.
            insertionData = `<${tagData.name}>\${0}</${tagData.name}>`;

        }

        const exactMatchStatus = tagData.name === normalizedTagName;
        let sortPriority = '1';

        if (exactMatchStatus) {
            //Selecting the exact entered tag before the remaining prefix matches.
            sortPriority = '0';

        }

        //Returning a source-coordinate edit that replaces only the entered bare word.
        return {
            label: tagData.name,
            detail: 'HTML element · Layer template',
            documentation: tagData.description,
            filterText: tagData.name,
            insertTextFormat: 2,
            kind: 15,
            preselect: exactMatchStatus,
            sortText: `${sortPriority}-html-tag-${tagData.name}`,
            textEdit: {
                newText: insertionData,
                range: replacementRange
            }
        };

    });

}

/**
 * @param {{source: string, offset: number, uri: string, version: number}} completionOptions
 */
function embeddedCompletionProvide(completionOptions) {
    if (Buffer.byteLength(completionOptions.source, 'utf8') > embeddedDocumentByteLimit) {
        return null;

    }

    const embeddedDocumentData = embeddedDocumentAtOffsetCreate(
        completionOptions.source,
        completionOptions.offset
    );

    if (embeddedDocumentData === null) {
        return null;

    }

    const parsedDocumentData = languageDocumentParsedGet(
        completionOptions.uri,
        completionOptions.version,
        embeddedDocumentData
    );
    const languageDocument = parsedDocumentData.languageDocument;
    const completionPosition = languageDocument.positionAt(completionOptions.offset);
    let completionResult;

    if (embeddedDocumentData.languageId === 'html') {
        //Getting standard HTML tags, attributes, values, and ARIA metadata.
        completionResult = htmlLanguageService.doComplete(languageDocument, completionPosition, parsedDocumentData.parsedDocument, {
            attributeDefaultValue: 'doublequotes'
        });

    } else {
        //Getting standard CSS selectors, properties, and values.
        completionResult = cssLanguageService.doComplete(languageDocument, completionPosition, parsedDocumentData.parsedDocument);

    }

    let bareTagCompletionItems = /** @type {ReturnType<typeof htmlBareTagCompletionItemsCreate>} */ ([]);

    if (embeddedDocumentData.languageId === 'html') {
        //Adding bare-word tag expansion only to HTML template content.
        bareTagCompletionItems = htmlBareTagCompletionItemsCreate(
            completionOptions.source,
            completionOptions.offset,
            embeddedDocumentData,
            languageDocument
        );

    }

    //Adding only the Layer snippets owned by this embedded language.
    return Object.freeze({
        languageId: embeddedDocumentData.languageId,
        isIncomplete: Boolean(completionResult.isIncomplete),
        items: Object.freeze([
            ...layerCompletionItemsCreate(embeddedDocumentData.languageId, {
                source: completionOptions.source,
                sourceOffset: completionOptions.offset,
                embeddedDocumentData,
                languageDocument
            }),
            ...bareTagCompletionItems,
            ...completionResult.items
        ])
    });

}

/**
 * @param {{source: string, offset: number, uri: string, version: number}} hoverOptions
 */
function embeddedHoverProvide(hoverOptions) {
    if (Buffer.byteLength(hoverOptions.source, 'utf8') > embeddedDocumentByteLimit) {
        return null;

    }

    const embeddedDocumentData = embeddedDocumentAtOffsetCreate(hoverOptions.source, hoverOptions.offset);

    if (embeddedDocumentData === null) {
        return null;

    }

    const parsedDocumentData = languageDocumentParsedGet(
        hoverOptions.uri,
        hoverOptions.version,
        embeddedDocumentData
    );
    const languageDocument = parsedDocumentData.languageDocument;
    const hoverPosition = languageDocument.positionAt(hoverOptions.offset);

    if (embeddedDocumentData.languageId === 'html') {
        //Getting HTML reference documentation for the current symbol.
        return htmlLanguageService.doHover(languageDocument, hoverPosition, parsedDocumentData.parsedDocument);

    }

    //Getting CSS reference documentation for the current symbol.
    return cssLanguageService.doHover(languageDocument, hoverPosition, parsedDocumentData.parsedDocument);

}

/**
 * @param {import('vscode-html-languageservice').Node} nodeData
 * @param {import('vscode-html-languageservice').Node[]} nodeRecords
 */
function htmlNodesCollect(nodeData, nodeRecords) {
    //Recording this parsed node before visiting its children.
    nodeRecords.push(nodeData);

    for (const childNodeData of nodeData.children) {
        htmlNodesCollect(childNodeData, nodeRecords);

    }

}

/**
 * @param {ReturnType<typeof languageTextDocumentCreate>} languageDocument
 * @param {{text: string}} embeddedDocumentData
 * @param {import('vscode-html-languageservice').HTMLDocument} htmlDocument
 */
function htmlDiagnosticsCreate(languageDocument, embeddedDocumentData, htmlDocument) {
    const htmlNodeRecords = /** @type {import('vscode-html-languageservice').Node[]} */ ([]);

    for (const rootNodeData of htmlDocument.roots) {
        htmlNodesCollect(rootNodeData, htmlNodeRecords);

    }

    const diagnosticRecords = [];

    for (const nodeData of htmlNodeRecords) {
        const tagName = String(nodeData.tag ?? '').toLowerCase();

        //Ignoring text fragments, void tags, optional end tags, and explicit self-closing tags.
        if (
            tagName.length === 0 ||
            htmlVoidTags.has(tagName) ||
            htmlOptionalEndTags.has(tagName) ||
            nodeData.startTagEnd === undefined ||
            embeddedDocumentData.text.slice(nodeData.start, nodeData.startTagEnd).trimEnd().endsWith('/>') ||
            nodeData.endTagStart !== undefined
        ) {
            continue;

        }

        //Reporting an unclosed non-optional HTML element at its opening tag.
        diagnosticRecords.push({
            range: {
                start: languageDocument.positionAt(nodeData.start),
                end: languageDocument.positionAt(nodeData.startTagEnd)
            },
            message: `The <${tagName}> element is not closed.`,
            severity: 1,
            source: 'Layer HTML',
            code: 'LAYER_HTML_TAG_UNCLOSED'
        });

    }

    return diagnosticRecords;

}

/**
 * @param {{source: string, uri: string, version: number}} diagnosticOptions
 */
function embeddedDiagnosticsProvide(diagnosticOptions) {
    if (Buffer.byteLength(diagnosticOptions.source, 'utf8') > embeddedDocumentByteLimit) {
        return Object.freeze([]);

    }

    const diagnosticRecords = [];
    const diagnosticKeys = new Set();

    for (const embeddedDocumentData of embeddedDocumentsCreate(diagnosticOptions.source)) {
        const parsedDocumentData = languageDocumentParsedGet(
            diagnosticOptions.uri,
            diagnosticOptions.version,
            embeddedDocumentData
        );
        const languageDocument = parsedDocumentData.languageDocument;
        let languageDiagnostics;

        if (embeddedDocumentData.languageId === 'html') {
            //Checking structural HTML errors that the tolerant completion parser can recover from.
            languageDiagnostics = htmlDiagnosticsCreate(
                languageDocument,
                embeddedDocumentData,
                parsedDocumentData.parsedDocument
            );

        } else {
            //Checking CSS syntax and property values with the standard CSS service.
            languageDiagnostics = cssLanguageService.doValidation(
                languageDocument,
                parsedDocumentData.parsedDocument
            );

        }

        for (const diagnosticData of languageDiagnostics) {
            const diagnosticStartOffset = languageDocument.offsetAt(diagnosticData.range.start);
            const diagnosticEndOffset = languageDocument.offsetAt(diagnosticData.range.end);
            const regionData = embeddedDocumentData.region;

            //Keeping only diagnostics owned by this template and outside JavaScript interpolation.
            if (
                diagnosticStartOffset < regionData.contentStart ||
                diagnosticStartOffset > regionData.contentEnd ||
                embeddedInterpolationCheck(regionData, diagnosticStartOffset) ||
                embeddedInterpolationCheck(regionData, Math.max(diagnosticStartOffset, diagnosticEndOffset - 1))
            ) {
                continue;

            }

            const diagnosticKey = `${diagnosticStartOffset}:${diagnosticEndOffset}:${String(diagnosticData.code)}:${diagnosticData.message}`;

            if (diagnosticKeys.has(diagnosticKey)) {
                continue;

            }

            diagnosticKeys.add(diagnosticKey);
            diagnosticRecords.push(diagnosticData);

        }

    }

    //CallBack THE OBJECT
    return Object.freeze(diagnosticRecords);

}

/**
 * @param {string} documentUri
 */
//Function for releasing cached virtual documents owned by one closed editor
function embeddedLanguageCacheClear(documentUri) {
    //Removing every parsed HTML or CSS document owned by this editor URI.
    const cacheKeyPrefix = `${documentUri}|`;

    for (const cacheKey of languageDocumentCache.keys()) {
        if (cacheKey.startsWith(cacheKeyPrefix)) {
            languageDocumentCache.delete(cacheKey);

        }

    }

}

module.exports = {
    embeddedCompletionProvide,
    embeddedDiagnosticsProvide,
    embeddedHoverProvide,
    embeddedLanguageCacheClear,
    layerCompletionItemsCreate
};
