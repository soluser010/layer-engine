import {createHash} from 'node:crypto';
import {parseFragment} from 'parse5';
import {LayerCompilerError} from './compiler-error.js';
import {
    layerComponentScriptValidate,
    layerExpressionCompile
} from './expression.js';
import {layerScopedCssCompile} from './scoped-css.js';

export const LAYER_COMPILER_VERSION = 3;

const blockedElementSet = new Set([
    'base',
    'embed',
    'iframe',
    'link',
    'meta',
    'object',
    'script'
]);
const propertyBindingSet = new Set([
    'checked',
    'indeterminate',
    'selected',
    'value'
]);
const voidElementSet = new Set([
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

/**
 * @typedef {import('./expression.js').LayerExpressionNode} LayerExpressionNode
 * @typedef {{name: string, value: string}} LayerTemplateAttribute
 * @typedef {{nodeName: string, tagName?: string, value?: string, attrs?: LayerTemplateAttribute[], childNodes?: LayerTemplateNode[], content?: {childNodes?: LayerTemplateNode[]}, sourceCodeLocation?: {startLine?: number, startCol?: number}}} LayerTemplateNode
 * @typedef {{kind: 'static', value: string} | {kind: 'expression', bindingId: string, expression: LayerExpressionNode}} LayerTextPart
 * @typedef {{kind: 'text', nodeId: string, parts: LayerTextPart[]} | {kind: 'element', nodeId: string, tag: string, attributes: {name: string, value: string}[], attributeBindings: {bindingId: string, name: string, mode: 'attribute' | 'property', expression: LayerExpressionNode}[], eventBindings: {bindingId: string, event: string, expression: LayerExpressionNode}[], modelBindings: {bindingId: string, property: 'checked' | 'value', event: 'change' | 'input', expression: LayerExpressionNode}[], refName: string | null, regionName: string | null, children: LayerRenderPlanNode[]} | {kind: 'if', bindingId: string, expression: LayerExpressionNode, template: LayerRenderPlanNode} | {kind: 'for', bindingId: string, source: LayerExpressionNode, key: LayerExpressionNode, itemName: string, indexName: string | null, template: LayerRenderPlanNode} | {kind: 'slot', bindingId: string, nodeId: string, name: string, fallback: LayerRenderPlanNode[]}} LayerRenderPlanNode
 */

/**
 * @param {unknown} inputData
 * @returns {unknown}
 */
function immutableDataCreate(inputData) {
    //Leaving scalar values unchanged while recursively freezing compiler output.
    if (typeof inputData !== 'object' || inputData === null || Object.isFrozen(inputData)) {
        return inputData;

    }

    for (const childValue of Object.values(inputData)) {
        immutableDataCreate(childValue);

    }

    return Object.freeze(inputData);

}

/**
 * @param {LayerTemplateNode} sectionNode
 * @returns {string}
 */
function sectionTextGet(sectionNode) {
    let sectionText = '';

    //Combining raw script or style text nodes in source order.
    for (const childNode of sectionNode.childNodes ?? []) {
        if (childNode.nodeName === '#text') {
            sectionText += childNode.value ?? '';

        }

    }

    return sectionText;

}

/**
 * @param {string} componentIdentifier
 * @returns {string}
 */
function scopeIdentifierCreate(componentIdentifier) {
    //Creating a stable compact scope from the public component identifier.
    return createHash('sha256').update(componentIdentifier, 'utf8').digest('hex').slice(0, 12);

}

/**
 * @param {string} forSource
 */
function forDirectiveParse(forSource) {
    const forMatch = forSource.trim().match(
        /^(?:\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\)|([A-Za-z_$][\w$]*))\s+(?:in|of)\s+(.+)$/
    );

    //Requiring an explicit local name and source expression.
    if (forMatch === null || forMatch[4] === undefined) {
        throw new LayerCompilerError(
            'LAYER_TEMPLATE_INVALID',
            'l-for must use "item in items" or "(item, index) in items" syntax.'
        );

    }

    return {
        itemName: forMatch[1] ?? forMatch[3] ?? '',
        indexName: forMatch[2] ?? null,
        source: layerExpressionCompile(forMatch[4])
    };

}

/**
 * @param {string} textValue
 * @param {() => string} bindingIdentifierCreate
 * @param {(bindingId: string, kind: string, nodeId: string) => void} bindingMapAdd
 * @param {string} nodeIdentifier
 * @returns {LayerTextPart[]}
 */
function textPartsCompile(textValue, bindingIdentifierCreate, bindingMapAdd, nodeIdentifier) {
    const textParts = [];
    const interpolationPattern = /{{([\s\S]+?)}}/g;
    let textOffset = 0;
    let interpolationMatch;

    //Splitting text into static and precompiled expression parts.
    while ((interpolationMatch = interpolationPattern.exec(textValue)) !== null) {
        if (interpolationMatch.index > textOffset) {
            textParts.push({
                kind: /** @type {const} */ ('static'),
                value: textValue.slice(textOffset, interpolationMatch.index)
            });

        }

        const bindingIdentifier = bindingIdentifierCreate();

        textParts.push({
            kind: /** @type {const} */ ('expression'),
            bindingId: bindingIdentifier,
            expression: layerExpressionCompile(interpolationMatch[1] ?? '')
        });
        bindingMapAdd(bindingIdentifier, 'text', nodeIdentifier);
        textOffset = interpolationMatch.index + interpolationMatch[0].length;

    }

    if (textOffset < textValue.length) {
        textParts.push({
            kind: /** @type {const} */ ('static'),
            value: textValue.slice(textOffset)
        });

    }

    return textParts;

}

/**
 * @param {LayerExpressionNode} expressionNode
 */
function modelExpressionValidate(expressionNode) {
    //Allowing assignment only to a declared scope signal or an owned member field.
    if (expressionNode.type !== 'Identifier' && expressionNode.type !== 'MemberExpression') {
        throw new LayerCompilerError(
            'LAYER_TEMPLATE_INVALID',
            'l-model must reference a signal or an owned object field.'
        );

    }

    if (expressionNode.type === 'MemberExpression' && expressionNode.optional === true) {
        throw new LayerCompilerError(
            'LAYER_TEMPLATE_INVALID',
            'l-model does not accept optional member access.'
        );

    }

}

/**
 * @param {LayerRenderPlanNode} planData
 * @returns {boolean}
 */
function regionChildStaticCheck(planData) {
    if (planData.kind === 'text') {
        //Accepting only literal text because region updates own all descendant state.
        return planData.parts.every(function regionTextPartStatic(partData) {
            //Rejecting every expression marker inside the server-owned subtree.
            return partData.kind === 'static';

        });

    }

    if (planData.kind !== 'element') {
        return false;

    }

    if (planData.attributeBindings.length > 0 || planData.eventBindings.length > 0 ||
        planData.modelBindings.length > 0 || planData.refName !== null || planData.regionName !== null) {
        return false;

    }

    //Walking the complete subtree so no client binding competes with server ownership.
    return planData.children.every(regionChildStaticCheck);

}

/**
 * @param {LayerRenderPlanNode[]} renderPlans
 * @param {boolean} structuralOwnership
 */
function regionStructuralOwnershipValidate(renderPlans, structuralOwnership = false) {
    //Walking structural boundaries before exposing the immutable compiler output.
    for (const planData of renderPlans) {
        if (planData.kind === 'element') {
            if (structuralOwnership && planData.regionName !== null) {
                throw new LayerCompilerError(
                    'LAYER_TEMPLATE_INVALID',
                    'l-region cannot be created by a conditional, list, or slot boundary.'
                );

            }

            regionStructuralOwnershipValidate(planData.children, structuralOwnership);

            continue;

        }

        if (planData.kind === 'if' || planData.kind === 'for') {
            regionStructuralOwnershipValidate([planData.template], true);

            continue;

        }

        if (planData.kind === 'slot') {
            regionStructuralOwnershipValidate(planData.fallback, true);

        }

    }

}

/**
 * @param {LayerTemplateNode[]} templateNodes
 * @param {object} compilerState
 * @param {() => string} compilerState.nodeIdentifierCreate
 * @param {() => string} compilerState.bindingIdentifierCreate
 * @param {(bindingId: string, kind: string, nodeId: string) => void} compilerState.bindingMapAdd
 * @param {(regionName: string, nodeId: string) => void} compilerState.regionMapAdd
 * @returns {LayerRenderPlanNode[]}
 */
function templateNodesCompile(templateNodes, compilerState) {
    const renderNodes = [];
    let conditionalSourceList = /** @type {string[]} */ ([]);

    //Compiling source nodes in deterministic document order.
    for (const sourceTemplateNode of templateNodes) {
        let templateNode = sourceTemplateNode;

        if (templateNode.nodeName === '#comment') {
            continue;

        }

        if (templateNode.nodeName === '#text') {
            const textValue = templateNode.value ?? '';

            if (textValue.length === 0) {
                continue;

            }

            //Keeping a conditional chain open only across formatting whitespace.
            if (textValue.trim().length > 0) {
                conditionalSourceList = [];

            }

            const nodeIdentifier = compilerState.nodeIdentifierCreate();
            const textParts = textPartsCompile(
                textValue,
                compilerState.bindingIdentifierCreate,
                compilerState.bindingMapAdd,
                nodeIdentifier
            );

            renderNodes.push({
                kind: /** @type {const} */ ('text'),
                nodeId: nodeIdentifier,
                parts: textParts
            });

            continue;

        }

        if (templateNode.tagName === undefined) {
            throw new LayerCompilerError('LAYER_TEMPLATE_INVALID', 'The template contains an unsupported node.');

        }

        const conditionalAttributes = (templateNode.attrs ?? []).filter(function conditionalAttributeFilter(attributeData) {
            //Collecting mutually exclusive conditional directives before normal attribute compilation.
            return attributeData.name === 'l-if' ||
                attributeData.name === 'l-else-if' ||
                attributeData.name === 'l-else';

        });

        if (conditionalAttributes.length > 1) {
            throw new LayerCompilerError(
                'LAYER_TEMPLATE_INVALID',
                'A template element accepts one conditional directive only.'
            );

        }

        const conditionalAttribute = conditionalAttributes[0];

        if (conditionalAttribute?.name === 'l-if') {
            conditionalSourceList = [conditionalAttribute.value];

        } else if (conditionalAttribute?.name === 'l-else-if' || conditionalAttribute?.name === 'l-else') {
            if (conditionalSourceList.length === 0) {
                throw new LayerCompilerError(
                    'LAYER_TEMPLATE_INVALID',
                    `${conditionalAttribute.name} requires a preceding sibling l-if chain.`
                );

            }

            const previousCondition = conditionalSourceList
                .map(function conditionalSourceWrap(sourceData) {
                    //Preserving source precedence while composing the exclusive branch guard.
                    return `(${sourceData})`;

                })
                .join(' || ');
            let branchCondition = `!(${previousCondition})`;

            if (conditionalAttribute.name === 'l-else-if') {
                if (conditionalAttribute.value.trim().length === 0) {
                    throw new LayerCompilerError(
                        'LAYER_TEMPLATE_INVALID',
                        'l-else-if requires an expression.'
                    );

                }

                branchCondition += ` && (${conditionalAttribute.value})`;
                conditionalSourceList.push(conditionalAttribute.value);

            } else {
                if (conditionalAttribute.value.trim().length > 0) {
                    throw new LayerCompilerError(
                        'LAYER_TEMPLATE_INVALID',
                        'l-else does not accept an expression.'
                    );

                }

                conditionalSourceList = [];

            }

            templateNode = {
                ...templateNode,
                attrs: [
                    ...(templateNode.attrs ?? []).filter(function conditionalDirectiveRemove(attributeData) {
                        //Replacing the branch directive with one compiler-owned exclusive condition.
                        return attributeData.name !== 'l-else-if' && attributeData.name !== 'l-else';

                    }),
                    {
                        name: 'l-if',
                        value: branchCondition
                    }
                ]
            };

        } else {
            conditionalSourceList = [];

        }

        const elementTag = /** @type {string} */ (templateNode.tagName).toLowerCase();

        //Blocking executable or document-level elements inside component templates.
        if (blockedElementSet.has(elementTag)) {
            throw new LayerCompilerError(
                'LAYER_TEMPLATE_UNSAFE',
                `The <${elementTag}> element is not allowed in a component template.`
            );

        }

        if (elementTag === 'slot') {
            const slotAttributes = templateNode.attrs ?? [];

            if (slotAttributes.some(function slotAttributeInvalid(attributeData) {
                //Keeping slot selection static and free from competing structural directives.
                return attributeData.name !== 'name';

            })) {
                throw new LayerCompilerError(
                    'LAYER_TEMPLATE_INVALID',
                    'A slot accepts a static name attribute only.'
                );

            }

            const slotName = slotAttributes.find(function slotNameFind(attributeData) {
                //Reading the optional static slot name.
                return attributeData.name === 'name';

            })?.value ?? 'default';

            if (!/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(slotName)) {
                throw new LayerCompilerError('LAYER_TEMPLATE_INVALID', 'Slot name is invalid.');

            }

            const nodeIdentifier = compilerState.nodeIdentifierCreate();
            const bindingIdentifier = compilerState.bindingIdentifierCreate();
            const childNodes = templateNode.childNodes ?? [];

            renderNodes.push({
                kind: /** @type {const} */ ('slot'),
                bindingId: bindingIdentifier,
                nodeId: nodeIdentifier,
                name: slotName,
                fallback: templateNodesCompile(childNodes, compilerState)
            });
            compilerState.bindingMapAdd(bindingIdentifier, 'slot', nodeIdentifier);

            continue;

        }

        const nodeIdentifier = compilerState.nodeIdentifierCreate();
        const staticAttributes = [];
        const attributeBindings = [];
        const eventBindings = [];
        const modelBindings = [];
        let ifSource;
        let forSource;
        let keySource;
        let modelSource;
        let refName = /** @type {string | null} */ (null);
        let regionName = /** @type {string | null} */ (null);

        //Separating static HTML from compiler-owned directive attributes.
        for (const attributeData of templateNode.attrs ?? []) {
            const attributeName = attributeData.name;

            if (attributeName === 'l-if') {
                ifSource = attributeData.value;

                continue;

            }

            if (attributeName === 'l-for') {
                forSource = attributeData.value;

                continue;

            }

            if (attributeName === 'l-key') {
                keySource = attributeData.value;

                continue;

            }

            if (attributeName === 'l-model') {
                modelSource = attributeData.value;

                continue;

            }

            if (attributeName === 'l-ref') {
                if (!/^[A-Za-z_$][A-Za-z0-9_$.-]{0,79}$/.test(attributeData.value)) {
                    throw new LayerCompilerError('LAYER_TEMPLATE_INVALID', 'l-ref name is invalid.');

                }

                refName = attributeData.value;

                continue;

            }

            if (attributeName === 'l-region') {
                if (!/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(attributeData.value)) {
                    throw new LayerCompilerError('LAYER_TEMPLATE_INVALID', 'l-region name is invalid.');

                }

                regionName = attributeData.value;

                continue;

            }

            if (attributeName.startsWith('@')) {
                const eventName = attributeName.slice(1);

                if (!/^[a-z][a-z0-9:-]*$/i.test(eventName)) {
                    throw new LayerCompilerError('LAYER_TEMPLATE_INVALID', 'The event binding name is invalid.');

                }

                const bindingIdentifier = compilerState.bindingIdentifierCreate();

                eventBindings.push({
                    bindingId: bindingIdentifier,
                    event: eventName,
                    expression: layerExpressionCompile(attributeData.value)
                });
                compilerState.bindingMapAdd(bindingIdentifier, 'event', nodeIdentifier);

                continue;

            }

            if (attributeName.startsWith(':')) {
                const boundName = attributeName.slice(1);

                if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(boundName) ||
                    boundName.toLowerCase() === 'innerhtml' ||
                    boundName.toLowerCase().startsWith('on')) {
                    throw new LayerCompilerError('LAYER_TEMPLATE_UNSAFE', 'The attribute binding target is not allowed.');

                }

                const bindingIdentifier = compilerState.bindingIdentifierCreate();
                let bindingMode = /** @type {'attribute' | 'property'} */ ('attribute');

                //Selecting direct properties only for the known form-control fields.
                if (propertyBindingSet.has(boundName)) {
                    bindingMode = 'property';

                }

                attributeBindings.push({
                    bindingId: bindingIdentifier,
                    name: boundName,
                    mode: /** @type {'attribute' | 'property'} */ (bindingMode),
                    expression: layerExpressionCompile(attributeData.value)
                });
                compilerState.bindingMapAdd(bindingIdentifier, bindingMode, nodeIdentifier);

                continue;

            }

            if (attributeName.toLowerCase().startsWith('on')) {
                throw new LayerCompilerError('LAYER_TEMPLATE_UNSAFE', 'Inline HTML event attributes are not allowed.');

            }

            staticAttributes.push({
                name: attributeName,
                value: attributeData.value
            });

        }

        if (modelSource !== undefined) {
            if (elementTag !== 'input' && elementTag !== 'textarea' && elementTag !== 'select') {
                throw new LayerCompilerError(
                    'LAYER_TEMPLATE_INVALID',
                    'l-model is supported on input, textarea, and select elements only.'
                );

            }

            const inputType = staticAttributes.find(function inputTypeFind(attributeData) {
                //Reading only a static input type so binding ownership cannot change at runtime.
                return attributeData.name === 'type';

            })?.value.toLowerCase();

            if (elementTag === 'input' && (inputType === 'file' || inputType === 'radio')) {
                throw new LayerCompilerError(
                    'LAYER_TEMPLATE_INVALID',
                    `l-model does not support input type ${inputType}.`
                );

            }

            let modelProperty = 'value';
            let modelEvent = 'input';

            //Using checked state and change events for checkbox ownership.
            if (elementTag === 'input' && inputType === 'checkbox') {
                modelProperty = 'checked';
                modelEvent = 'change';

            } else if (elementTag === 'select') {
                //Using change events because select value settles after selection.
                modelEvent = 'change';

            }

            if (staticAttributes.some(function staticModelPropertyOwned(attributeData) {
                //Keeping static HTML from competing with model-owned state.
                return attributeData.name === modelProperty;

            }) || attributeBindings.some(function modelPropertyOwned(bindingData) {
                //Preventing two bindings from owning the same form-control property.
                return bindingData.name === modelProperty;

            }) || eventBindings.some(function modelEventOwned(bindingData) {
                //Preventing an explicit listener from competing with the model event.
                return bindingData.event === modelEvent;

            })) {
                throw new LayerCompilerError(
                    'LAYER_TEMPLATE_INVALID',
                    'l-model cannot share its property or event with another binding.'
                );

            }

            const modelExpression = layerExpressionCompile(modelSource);
            const bindingIdentifier = compilerState.bindingIdentifierCreate();

            modelExpressionValidate(modelExpression);
            modelBindings.push({
                bindingId: bindingIdentifier,
                property: /** @type {'checked' | 'value'} */ (modelProperty),
                event: /** @type {'change' | 'input'} */ (modelEvent),
                expression: modelExpression
            });
            compilerState.bindingMapAdd(bindingIdentifier, 'model', nodeIdentifier);

        }

        const childNodes = templateNode.content?.childNodes ?? templateNode.childNodes ?? [];
        let compiledChildren = /** @type {LayerRenderPlanNode[]} */ ([]);

        if (modelSource !== undefined && elementTag === 'textarea' && childNodes.some(function textareaChildMeaningful(childNode) {
            //Reserving textarea contents for the model while allowing formatting whitespace.
            return childNode.nodeName !== '#comment' &&
                (childNode.nodeName !== '#text' || (childNode.value ?? '').trim().length > 0);

        })) {
            throw new LayerCompilerError(
                'LAYER_TEMPLATE_INVALID',
                'A textarea with l-model cannot declare template content.'
            );

        }

        //Skipping forbidden children for void elements and compiling all others.
        if (!voidElementSet.has(elementTag) && !(modelSource !== undefined && elementTag === 'textarea')) {
            compiledChildren = templateNodesCompile(childNodes, compilerState);

        }

        if (regionName !== null) {
            if (voidElementSet.has(elementTag) || ifSource !== undefined || forSource !== undefined) {
                throw new LayerCompilerError(
                    'LAYER_TEMPLATE_INVALID',
                    'l-region requires a stable non-void element boundary.'
                );

            }

            if (!compiledChildren.every(regionChildStaticCheck)) {
                throw new LayerCompilerError(
                    'LAYER_TEMPLATE_INVALID',
                    'l-region descendants must be static because the server owns the region.'
                );

            }

            compilerState.regionMapAdd(regionName, nodeIdentifier);

        }

        const elementPlan = /** @type {LayerRenderPlanNode} */ ({
            kind: 'element',
            nodeId: nodeIdentifier,
            tag: elementTag,
            attributes: staticAttributes,
            attributeBindings,
            eventBindings,
            modelBindings,
            refName,
            regionName,
            children: compiledChildren
        });
        let renderPlan = elementPlan;

        //Wrapping conditional ownership around the compiled element boundary.
        if (ifSource !== undefined) {
            const bindingIdentifier = compilerState.bindingIdentifierCreate();

            renderPlan = {
                kind: 'if',
                bindingId: bindingIdentifier,
                expression: layerExpressionCompile(ifSource),
                template: renderPlan
            };
            compilerState.bindingMapAdd(bindingIdentifier, 'if', nodeIdentifier);

        }

        //Wrapping list ownership only when a stable key expression is declared.
        if (forSource !== undefined) {
            if (keySource === undefined) {
                throw new LayerCompilerError('LAYER_TEMPLATE_INVALID', 'l-for requires a stable l-key expression.');

            }

            if (ifSource !== undefined) {
                throw new LayerCompilerError(
                    'LAYER_TEMPLATE_INVALID',
                    'l-if and l-for cannot own the same element boundary.'
                );

            }

            const forData = forDirectiveParse(forSource);
            const bindingIdentifier = compilerState.bindingIdentifierCreate();

            renderPlan = {
                kind: 'for',
                bindingId: bindingIdentifier,
                source: forData.source,
                key: layerExpressionCompile(keySource),
                itemName: forData.itemName,
                indexName: forData.indexName,
                template: renderPlan
            };
            compilerState.bindingMapAdd(bindingIdentifier, 'for', nodeIdentifier);

        } else if (keySource !== undefined) {
            throw new LayerCompilerError('LAYER_TEMPLATE_INVALID', 'l-key can only be used with l-for.');

        }

        renderNodes.push(renderPlan);

    }

    return renderNodes;

}

/**
 * @param {string} componentSource
 * @param {{componentId: string, file?: string}} compilerOptions
 */
export function layerComponentCompile(componentSource, compilerOptions) {
    //Checking stable identity before generating markers and CSS scope.
    if (typeof compilerOptions.componentId !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/.test(compilerOptions.componentId)) {
        throw new LayerCompilerError('LAYER_COMPONENT_INVALID', 'componentId is invalid.');

    }

    let componentFragment;

    try {
        //Parsing the SFC as HTML with source locations for build diagnostics.
        componentFragment = /** @type {{childNodes: LayerTemplateNode[]}} */ (parseFragment(componentSource, {
            sourceCodeLocationInfo: true
        }));

    } catch (templateParseError) {
        throw new LayerCompilerError('LAYER_COMPONENT_INVALID', 'The .layer document cannot be parsed.', {
            cause: templateParseError,
            file: compilerOptions.file
        });

    }

    let templateSection;
    let scriptSection;
    let styleSection;

    //Collecting exactly one top-level section of each supported type.
    for (const sectionNode of componentFragment.childNodes) {
        if (sectionNode.nodeName === '#comment') {
            continue;

        }

        if (sectionNode.nodeName === '#text' && (sectionNode.value ?? '').trim().length === 0) {
            continue;

        }

        if (sectionNode.tagName === 'template' && templateSection === undefined) {
            templateSection = sectionNode;

            continue;

        }

        if (sectionNode.tagName === 'script' && scriptSection === undefined) {
            scriptSection = sectionNode;

            continue;

        }

        if (sectionNode.tagName === 'style' && styleSection === undefined) {
            styleSection = sectionNode;

            continue;

        }

        throw new LayerCompilerError(
            'LAYER_COMPONENT_INVALID',
            'A .layer document accepts one template, one script, and one style section only.',
            {
                file: compilerOptions.file,
                line: sectionNode.sourceCodeLocation?.startLine,
                column: sectionNode.sourceCodeLocation?.startCol
            }
        );

    }

    if (templateSection === undefined) {
        throw new LayerCompilerError('LAYER_COMPONENT_INVALID', 'A .layer component requires a template section.');

    }

    let scriptSource = '';

    //Reading optional component code only from its dedicated section.
    if (scriptSection !== undefined) {
        scriptSource = sectionTextGet(scriptSection);

    }

    if (scriptSource.length > 0) {
        layerComponentScriptValidate(scriptSource);

    }

    const scopeIdentifier = scopeIdentifierCreate(compilerOptions.componentId);
    let styleSource = '';
    let scopedStyle = '';

    //Reading optional component CSS only from its dedicated section.
    if (styleSection !== undefined) {
        styleSource = sectionTextGet(styleSection);

    }

    if (styleSection !== undefined) {
        const scopedAttribute = styleSection.attrs?.find(function scopedAttributeFind(attributeData) {
            //Finding the explicit scoped marker on the component style section.
            return attributeData.name === 'scoped';

        });

        if (scopedAttribute === undefined) {
            throw new LayerCompilerError('LAYER_STYLE_INVALID', 'Component styles must declare the scoped attribute.');

        }

        scopedStyle = layerScopedCssCompile(styleSource, scopeIdentifier);

    }

    let nodeCounter = 0;
    let bindingCounter = 0;
    const bindingMap = /** @type {{bindingId: string, kind: string, nodeId: string}[]} */ ([]);
    const regionMap = /** @type {{name: string, nodeId: string}[]} */ ([]);
    const regionNameSet = new Set();

    function nodeIdentifierCreate() {
        //Allocating a stable node marker in document order.
        nodeCounter += 1;

        return `n${nodeCounter}`;

    }

    function bindingIdentifierCreate() {
        //Allocating a stable binding marker in document order.
        bindingCounter += 1;

        return `b${bindingCounter}`;

    }

    /**
     * @param {string} bindingId
     * @param {string} kind
     * @param {string} nodeId
     */
    function bindingMapAdd(bindingId, kind, nodeId) {
        //Recording compiler ownership for hydration diagnostics.
        bindingMap.push({
            bindingId,
            kind,
            nodeId
        });

    }

    /**
     * @param {string} regionName
     * @param {string} nodeId
     */
    function regionMapAdd(regionName, nodeId) {
        if (regionNameSet.has(regionName)) {
            throw new LayerCompilerError('LAYER_TEMPLATE_INVALID', `Duplicate l-region name: ${regionName}.`);

        }

        //Recording one stable server-owned boundary per public region name.
        regionNameSet.add(regionName);
        regionMap.push({
            name: regionName,
            nodeId
        });

    }

    const templateNodes = templateSection.content?.childNodes ?? [];
    const renderPlan = templateNodesCompile(templateNodes, {
        nodeIdentifierCreate,
        bindingIdentifierCreate,
        bindingMapAdd,
        regionMapAdd
    });

    regionStructuralOwnershipValidate(renderPlan);

    const componentData = {
        compilerVersion: LAYER_COMPILER_VERSION,
        componentId: compilerOptions.componentId,
        scopeId: scopeIdentifier,
        template: renderPlan,
        script: {
            source: scriptSource
        },
        style: {
            source: styleSource,
            css: scopedStyle,
            scoped: true
        },
        sourceMap: {
            file: compilerOptions.file ?? null,
            bindings: bindingMap,
            regions: regionMap
        }
    };

    return /** @type {Readonly<typeof componentData>} */ (immutableDataCreate(componentData));

}
