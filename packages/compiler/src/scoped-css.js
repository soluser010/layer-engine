import {createHash} from 'node:crypto';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import {LayerCompilerError} from './compiler-error.js';

const cssUrlPattern = /url\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/giu;

/**
 * @param {string} styleSource
 * @param {string | undefined} fileName
 */
function styleRootCreate(styleSource, fileName) {
    try {
        //Parsing CSS once before module, asset, and scope transformations.
        return postcss.parse(styleSource, {
            from: fileName
        });

    } catch (styleError) {
        const styleRecord = /** @type {{line?: number, column?: number}} */ (styleError);

        throw new LayerCompilerError('LAYER_STYLE_INVALID', 'The component stylesheet is invalid.', {
            cause: styleError,
            file: fileName,
            line: styleRecord.line,
            column: styleRecord.column
        });

    }

}

/**
 * @param {import('postcss').Root} styleRoot
 * @param {string} scopeIdentifier
 */
function styleRootScopeApply(styleRoot, scopeIdentifier) {
    styleRoot.walkRules(function scopeRuleTransform(ruleData) {
        //Leaving keyframe step selectors outside component DOM scoping.
        if (ruleData.parent?.type === 'atrule' && /keyframes$/i.test(ruleData.parent.name)) {
            return;

        }

        try {
            const selectorProcessor = selectorParser(function selectorTransform(selectorRoot) {
                //Transforming each comma-separated selector independently.
                selectorRoot.each(function singleSelectorTransform(selectorData) {
                    let scopeAnchor;

                    selectorData.each(function scopeAnchorFind(selectorNode) {
                        //Keeping the last local simple selector before pseudo states.
                        if (selectorNode.type !== 'combinator' && selectorNode.type !== 'pseudo') {
                            scopeAnchor = selectorNode;

                        }

                    });

                    //Adding the stable scope only when a local selector exists.
                    if (scopeAnchor !== undefined) {
                        const scopeAttribute = selectorParser.attribute({
                            attribute: 'data-layer-scope',
                            operator: '=',
                            quoteMark: null,
                            raws: {},
                            value: scopeIdentifier
                        });

                        //Quoting every hash so digit-prefixed scope identifiers remain valid CSS.
                        scopeAttribute.setValue(scopeIdentifier, {
                            quoteMark: '"'
                        });
                        selectorData.insertAfter(scopeAnchor, scopeAttribute);

                    }

                    selectorData.walkPseudos(function globalPseudoReplace(pseudoData) {
                        //Unwrapping explicit :global(...) without scoping its inner selector.
                        if (pseudoData.value === ':global' && pseudoData.nodes?.[0] !== undefined) {
                            pseudoData.replaceWith(...pseudoData.nodes[0].nodes);

                        }

                    });

                });

            });

            ruleData.selector = selectorProcessor.processSync(ruleData.selector);

        } catch (selectorError) {
            throw new LayerCompilerError('LAYER_STYLE_INVALID', 'A component selector cannot be scoped.', {
                cause: selectorError,
                file: styleRoot.source?.input.file,
                line: ruleData.source?.start?.line,
                column: ruleData.source?.start?.column
            });

        }

    });

}

/**
 * @param {import('postcss').Root} styleRoot
 * @param {string} scopeIdentifier
 * @returns {Readonly<Record<string, string>>}
 */
function styleModuleApply(styleRoot, scopeIdentifier) {
    const classMap = /** @type {Record<string, string>} */ ({});
    const moduleSuffix = createHash('sha256').update(scopeIdentifier).digest('hex').slice(0, 8);

    styleRoot.walkRules(function moduleRuleTransform(ruleData) {
        if (ruleData.parent?.type === 'atrule' && /keyframes$/i.test(ruleData.parent.name)) {
            return;

        }

        try {
            const selectorProcessor = selectorParser(function moduleSelectorTransform(selectorRoot) {
                selectorRoot.walkClasses(function moduleClassTransform(classNode) {
                    let parentNode = classNode.parent;
                    let globalStatus = false;

                    //Preserving classes explicitly owned by :global(...).
                    while (parentNode !== undefined) {
                        if (parentNode.type === 'pseudo' && parentNode.value === ':global') {
                            globalStatus = true;
                            break;

                        }

                        parentNode = parentNode.parent;

                    }

                    if (globalStatus) {
                        return;

                    }

                    const localClassName = classNode.value;

                    if (!Object.hasOwn(classMap, localClassName)) {
                        classMap[localClassName] = `${localClassName}__${moduleSuffix}`;

                    }

                    classNode.value = String(classMap[localClassName]);

                });

            });

            ruleData.selector = selectorProcessor.processSync(ruleData.selector);

        } catch (selectorError) {
            throw new LayerCompilerError('LAYER_STYLE_INVALID', 'A CSS Module selector cannot be transformed.', {
                cause: selectorError,
                file: styleRoot.source?.input.file,
                line: ruleData.source?.start?.line,
                column: ruleData.source?.start?.column
            });

        }

    });

    return Object.freeze(classMap);

}

/**
 * @param {string} assetUrl
 * @param {import('postcss').Declaration} declarationData
 * @param {string | undefined} fileName
 */
function assetUrlAssert(assetUrl, declarationData, fileName) {
    const controlCharacterStatus = [...assetUrl].some(function controlCharacterFind(characterData) {
        const characterCode = characterData.charCodeAt(0);

        //Rejecting ASCII controls without placing them in a regular expression.
        return characterCode <= 31 || characterCode === 127;

    });

    if (assetUrl.length === 0 || assetUrl.length > 2048 || controlCharacterStatus) {
        throw new LayerCompilerError('LAYER_STYLE_URL_INVALID', 'A CSS asset URL is empty or malformed.', {
            file: fileName,
            line: declarationData.source?.start?.line,
            column: declarationData.source?.start?.column
        });

    }

    if (/^(?:data|blob|file|https?|javascript):/iu.test(assetUrl) || assetUrl.startsWith('//')) {
        throw new LayerCompilerError('LAYER_STYLE_URL_INVALID', 'External and executable CSS asset URLs are not allowed.', {
            file: fileName,
            line: declarationData.source?.start?.line,
            column: declarationData.source?.start?.column
        });

    }

}

/**
 * @param {import('postcss').Root} styleRoot
 * @param {Readonly<Record<string, string>>} assetUrlMap
 * @param {string | undefined} fileName
 */
function styleAssetsApply(styleRoot, assetUrlMap, fileName) {
    const assetReferences = new Set();

    styleRoot.walkDecls(function declarationAssetTransform(declarationData) {
        //Rewriting every CSS URL through the same local-asset security boundary.
        declarationData.value = declarationData.value.replace(cssUrlPattern, function assetUrlReplace(
            _fullMatch,
            quoteData,
            quotedUrl,
            unquotedUrl
        ) {
            //Normalizing quoted and unquoted syntax before validating the URL.
            const assetUrl = String(quotedUrl ?? unquotedUrl ?? '').trim();

            assetUrlAssert(assetUrl, declarationData, fileName);

            if (assetUrl.startsWith('/') || assetUrl.startsWith('#')) {
                return `url(${JSON.stringify(assetUrl)})`;

            }

            assetReferences.add(assetUrl);
            const replacementUrl = assetUrlMap[assetUrl] ?? assetUrl;

            return `url(${JSON.stringify(replacementUrl)})`;

        });

    });

    return Object.freeze([...assetReferences].sort());

}

/**
 * @param {import('postcss').Root} styleRoot
 */
function styleSourceMapCreate(styleRoot) {
    const sourceRanges = /** @type {Readonly<Record<string, unknown>>[]} */ ([]);

    styleRoot.walk(function styleNodeRangeCollect(styleNode) {
        //Keeping only authored nodes that can produce useful compiler diagnostics.
        if (styleNode.type !== 'rule' && styleNode.type !== 'decl' && styleNode.type !== 'atrule') {
            return;

        }

        sourceRanges.push(Object.freeze({
            kind: styleNode.type,
            line: styleNode.source?.start?.line ?? null,
            column: styleNode.source?.start?.column ?? null,
            endLine: styleNode.source?.end?.line ?? null,
            endColumn: styleNode.source?.end?.column ?? null
        }));

    });

    return Object.freeze(sourceRanges);

}

/**
 * @param {string} styleSource
 * @param {{scopeIdentifier: string, scoped?: boolean, modules?: boolean, assetUrlMap?: Readonly<Record<string, string>>, file?: string}} compilerOptions
 */
export function layerStylesheetCompile(styleSource, compilerOptions) {
    //Rejecting unstable scope identifiers before PostCSS receives the source.
    if (typeof styleSource !== 'string' || typeof compilerOptions?.scopeIdentifier !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,160}$/.test(compilerOptions.scopeIdentifier)) {
        throw new LayerCompilerError('LAYER_STYLE_INVALID', 'A stylesheet and stable scope identifier are required.');

    }

    const styleRoot = styleRootCreate(styleSource, compilerOptions.file);
    let classMap = Object.freeze({});

    //Creating a class map only for an explicitly requested module stylesheet.
    if (compilerOptions.modules === true) {
        classMap = styleModuleApply(styleRoot, compilerOptions.scopeIdentifier);

    }
    const assetReferences = styleAssetsApply(
        styleRoot,
        compilerOptions.assetUrlMap ?? {},
        compilerOptions.file
    );

    if (compilerOptions.scoped !== false) {
        styleRootScopeApply(styleRoot, compilerOptions.scopeIdentifier);

    }

    return Object.freeze({
        css: styleRoot.toString(),
        classes: classMap,
        assets: assetReferences,
        sourceMap: styleSourceMapCreate(styleRoot),
        scoped: compilerOptions.scoped !== false
    });

}

/**
 * @param {string} styleSource
 * @param {string} scopeIdentifier
 * @returns {string}
 */
export function layerScopedCssCompile(styleSource, scopeIdentifier) {
    //Preserving the original scalar API through the complete stylesheet compiler.
    return layerStylesheetCompile(styleSource, {
        scopeIdentifier
    }).css;

}
