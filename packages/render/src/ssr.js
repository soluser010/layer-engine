import {layerExpressionEvaluate} from '@solcorp/layer-compiler/expression';
import {layerComponentInvocationResolve} from './component-invocation.js';
import {
    layerErrorBoundaryValueResolve,
    layerRenderErrorNormalize
} from './error-boundary.js';
import {
    layerAttributeValueNormalize,
    layerHtmlAttributeEscape,
    layerHtmlTextEscape,
    layerTextValueNormalize
} from './render-values.js';
import {
    layerReactiveValueRead,
    layerRepeatValueResolve,
    layerWhenValueResolve
} from './structures.js';

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
 * @param {unknown} keyValue
 * @returns {string}
 */
export function layerListKeyNormalize(keyValue) {
    //Accepting only stable scalar identities for keyed DOM reuse.
    if (typeof keyValue !== 'string' && typeof keyValue !== 'number') {
        throw new TypeError('l-key must resolve to a string or number.');

    }

    return `${typeof keyValue}:${String(keyValue)}`;

}

/**
 * @param {Record<string, unknown>} parentScope
 * @param {string} itemName
 * @param {string | null} indexName
 * @param {unknown} itemValue
 * @param {unknown} itemIndex
 */
export function layerListScopeCreate(parentScope, itemName, indexName, itemValue, itemIndex) {
    const itemScope = {
        ...parentScope,
        [itemName]: itemValue
    };

    //Adding the optional index name without mutating the parent scope.
    if (indexName !== null) {
        itemScope[indexName] = itemIndex;

    }

    return itemScope;

}

/**
 * @param {Record<string, unknown>} planData
 * @param {Record<string, unknown>} renderScope
 * @param {string} fallbackScopeIdentifier
 */
function slotRenderDataResolve(planData, renderScope, fallbackScopeIdentifier) {
    const slotCollection = renderScope.$slots;
    const slotName = String(planData.name);

    if (typeof slotCollection !== 'object' || slotCollection === null ||
        !Object.hasOwn(slotCollection, slotName)) {
        return {
            plans: /** @type {Record<string, unknown>[]} */ (planData.fallback),
            scope: renderScope,
            scopeId: fallbackScopeIdentifier
        };

    }

    const rawSlotContent = /** @type {Record<string, unknown>} */ (slotCollection)[slotName];

    if (typeof rawSlotContent !== 'object' || rawSlotContent === null) {
        throw new TypeError(`Slot ${slotName} content is invalid.`);

    }

    const slotContent = /** @type {Record<string, unknown>} */ (rawSlotContent);
    const rawSlotComponent = slotContent.component;

    if (typeof rawSlotComponent !== 'object' || rawSlotComponent === null) {
        throw new TypeError(`Slot ${slotName} content is invalid.`);

    }

    const slotComponent = /** @type {Record<string, unknown>} */ (rawSlotComponent);

    if (!Array.isArray(slotComponent.template) || typeof slotComponent.scopeId !== 'string' ||
        typeof slotContent.scope !== 'object' || slotContent.scope === null) {
        throw new TypeError(`Slot ${slotName} content is invalid.`);

    }

    return {
        plans: /** @type {Record<string, unknown>[]} */ (slotComponent.template),
        scope: /** @type {Record<string, unknown>} */ (slotContent.scope),
        scopeId: slotComponent.scopeId
    };

}

/**
 * @param {Record<string, unknown>} templateData
 * @param {unknown} templateResult
 * @param {Record<string, unknown>} parentScope
 */
export function structuralTemplateScopeCreate(templateData, templateResult, parentScope) {
    if (typeof templateResult !== 'object' || templateResult === null) {
        throw new TypeError('A structural renderer returned an invalid template result.');

    }

    const resultData = /** @type {Record<string, unknown>} */ (templateResult);
    const actualStringList = resultData.strings;
    const actualValueList = resultData.values;
    const expectedStringList = /** @type {string[]} */ (templateData.strings);
    const markerList = /** @type {string[]} */ (templateData.markers);

    if (!Array.isArray(actualStringList) || !Array.isArray(actualValueList) ||
        actualStringList.length !== expectedStringList.length || actualValueList.length !== markerList.length) {
        throw new TypeError('A structural runtime template does not match its compiled plan.');

    }

    const templateScope = {
        ...parentScope
    };

    for (let markerIndex = 0; markerIndex < markerList.length; markerIndex += 1) {
        if (actualStringList[markerIndex] !== expectedStringList[markerIndex]) {
            throw new TypeError('A structural runtime template changed its compiled static HTML.');

        }

        const markerName = /** @type {string} */ (markerList[markerIndex]);

        templateScope[markerName] = actualValueList[markerIndex];

    }

    if (actualStringList[expectedStringList.length - 1] !== expectedStringList[expectedStringList.length - 1]) {
        throw new TypeError('A structural runtime template changed its compiled static HTML.');

    }

    return templateScope;

}

/**
 * @param {Record<string, unknown>} templateData
 * @param {unknown} templateResult
 * @param {Record<string, unknown>} parentScope
 * @param {string} scopeIdentifier
 * @param {{listKey?: string}} [renderOptions]
 */
function structuralTemplateRender(
    templateData,
    templateResult,
    parentScope,
    scopeIdentifier,
    renderOptions = {}
) {
    const templateScope = structuralTemplateScopeCreate(templateData, templateResult, parentScope);
    let templateHtml = '';

    for (const childPlan of /** @type {Record<string, unknown>[]} */ (templateData.template)) {
        templateHtml += renderPlanToHtml(childPlan, templateScope, scopeIdentifier, renderOptions);

    }

    return templateHtml;

}
/**
 * @param {Record<string, unknown>} planData
 * @param {ReturnType<typeof layerComponentInvocationResolve>} componentInvocationState
 * @param {Record<string, unknown>} renderScope
 * @param {string} scopeIdentifier
 */
function componentSlotCollectionCreate( planData, componentInvocationState, renderScope, scopeIdentifier ){
    const compiledSlotPlans = /** @type {Record<string, unknown>} */ ( planData.slots ?? {} );
    const componentSlotValues = componentInvocationState.slotValues;
    const slotCollection = Object.create( null );

    //Checking that every runtime slot has one compiler-owned static plan
    for ( const slotName of Object.keys( componentSlotValues ) ){
        if ( Object.hasOwn( compiledSlotPlans, slotName ) !== true ){
            //Passing an uncompiled slot value to the server renderer
            throw new TypeError( String( `Nested component slot ${slotName} has no compiled plan.` ) );

        }

    }

    //Creating deterministic server slot scopes from the runtime template results
    for ( const [slotName, compiledSlotPlan] of Object.entries( compiledSlotPlans ) ){
        if ( Object.hasOwn( componentSlotValues, slotName ) !== true ){
            //Passing a changed invocation shape to the server renderer
            throw new TypeError( String( `Nested component slot ${slotName} is missing at runtime.` ) );

        }

        let slotTemplateResult = componentSlotValues[slotName];

        //Calling a lazy slot only for the current server component instance
        if ( typeof slotTemplateResult === 'function' ){
            slotTemplateResult = slotTemplateResult();

        }

        const objectCompiledSlotPlan = /** @type {Record<string, unknown>} */ ( compiledSlotPlan );

        //Preparing the internal slot contract for branding by the component runtime
        slotCollection[slotName] = {
            component: {
                scopeId: scopeIdentifier,
                template: objectCompiledSlotPlan.template
            },
            scope: structuralTemplateScopeCreate(
                objectCompiledSlotPlan,
                slotTemplateResult,
                renderScope
            )
        };

    }

    //CallBack THE OBJECT
    return slotCollection;

}



/**
 * @param {Record<string, unknown>} planData
 * @param {Record<string, unknown>} renderScope
 * @param {string} scopeIdentifier
 * @param {{listKey?: string}} [renderOptions]
 * @returns {string}
 */
function renderPlanToHtml(planData, renderScope, scopeIdentifier, renderOptions = {}) {
    if ( planData.kind === String( 'error-boundary' ) ){
        const bindingIdentifier = String( planData.bindingId );
        const boundaryDescriptor = layerErrorBoundaryValueResolve( layerExpressionEvaluate(
            /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ ( planData.expression ),
            renderScope
        ) );
        let branchName = String( 'content' );
        let boundaryHtml;

        try {
            //Rendering the complete content branch before committing its HTML
            boundaryHtml = structuralTemplateRender(
                /** @type {Record<string, unknown>} */ ( planData.content ),
                boundaryDescriptor.content(),
                renderScope,
                scopeIdentifier,
                renderOptions
            );

        } catch ( renderFailure ){
            branchName = String( 'fallback' );

            //Exposing only the normalized renderer failure to author fallback markup
            boundaryHtml = structuralTemplateRender(
                /** @type {Record<string, unknown>} */ ( planData.fallback ),
                boundaryDescriptor.fallback( layerRenderErrorNormalize( renderFailure ) ),
                renderScope,
                scopeIdentifier,
                renderOptions
            );

        }

        //CallBack THE STRING
        return `<!--layer-error-boundary:${bindingIdentifier}:start--><!--layer-error-boundary:${bindingIdentifier}:${branchName}-->${boundaryHtml}<!--layer-error-boundary:${bindingIdentifier}:end-->`;

    }

    if (planData.kind === 'component') {
        const bindingIdentifier = String( planData.bindingId );
        const componentInvocationState = layerComponentInvocationResolve( layerExpressionEvaluate(
            /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ ( planData.expression ),
            renderScope
        ) );
        const parentContext = renderScope.$context;

        //Checking the inherited context before rendering a child component
        if ( !parentContext || typeof parentContext !== String( 'object' ) ){
            //Passing the missing parent context to the server component boundary
            throw new TypeError( String( 'Nested component context is unavailable.' ) );

        }

        //Rendering the child with compiler-owned slots and the inherited component context
        const childRenderResult = componentInvocationState.renderToString({
            context: parentContext,
            render: renderOptions,
            slots: componentSlotCollectionCreate(
                planData,
                componentInvocationState,
                renderScope,
                scopeIdentifier
            )
        });

        //Checking the server renderer result before adding boundary markers
        if ( !childRenderResult || typeof childRenderResult.html !== String( 'string' ) ){
            //Passing an invalid child server result to the component boundary
            throw new TypeError( String( 'Nested component SSR result is invalid.' ) );

        }

        //CallBack THE STRING
        return `<!--layer-component:${bindingIdentifier}:start-->${childRenderResult.html}<!--layer-component:${bindingIdentifier}:end-->`;

    }

    if (planData.kind === 'when') {
        const bindingIdentifier = String(planData.bindingId);
        const descriptorData = layerWhenValueResolve(layerExpressionEvaluate(
            /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (planData.expression),
            renderScope
        ));
        const branchStatus = Boolean(layerReactiveValueRead(descriptorData.condition));
        let templateData = /** @type {Record<string, unknown> | null} */ (planData.falsy);

        //Selecting the true compiled branch only for an active server condition.
        if (branchStatus) {
            templateData = /** @type {Record<string, unknown>} */ (planData.truthy);

        }

        let conditionalHtml = `<!--layer-when:${bindingIdentifier}:start-->`;

        if (templateData !== null) {
            conditionalHtml += structuralTemplateRender(
                templateData,
                descriptorData.render(branchStatus),
                renderScope,
                scopeIdentifier
            );

        }

        conditionalHtml += `<!--layer-when:${bindingIdentifier}:end-->`;

        return conditionalHtml;

    }

    if (planData.kind === 'repeat') {
        const bindingIdentifier = String(planData.bindingId);
        const descriptorData = layerRepeatValueResolve(layerExpressionEvaluate(
            /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (planData.expression),
            renderScope
        ));
        const collectionValue = layerReactiveValueRead(descriptorData.collection);

        if (!Array.isArray(collectionValue)) {
            throw new TypeError('repeat source must resolve to an array.');

        }

        const keySet = new Set();
        const itemTemplate = /** @type {Record<string, unknown>} */ (planData.item);
        let listHtml = `<!--layer-repeat:${bindingIdentifier}:start-->`;

        for (let itemIndex = 0; itemIndex < collectionValue.length; itemIndex += 1) {
            const itemValue = collectionValue[itemIndex];
            const normalizedKey = layerListKeyNormalize(descriptorData.key(itemValue, itemIndex));

            if (keySet.has(normalizedKey)) {
                throw new TypeError(`Duplicate repeat key: ${normalizedKey}.`);

            }

            keySet.add(normalizedKey);
            listHtml += structuralTemplateRender(
                itemTemplate,
                descriptorData.render(itemValue, itemIndex),
                renderScope,
                scopeIdentifier,
                {
                    listKey: normalizedKey
                }
            );

        }

        listHtml += `<!--layer-repeat:${bindingIdentifier}:end-->`;

        return listHtml;

    }

    if (planData.kind === 'slot') {
        const bindingIdentifier = String(planData.bindingId);
        const slotRenderData = slotRenderDataResolve(planData, renderScope, scopeIdentifier);
        let slotHtml = `<!--layer-slot:${bindingIdentifier}:start-->`;

        //Rendering provided component plans or the compiler-owned fallback safely.
        for (const slotPlan of slotRenderData.plans) {
            slotHtml += renderPlanToHtml(slotPlan, slotRenderData.scope, slotRenderData.scopeId);

        }

        slotHtml += `<!--layer-slot:${bindingIdentifier}:end-->`;

        return slotHtml;

    }

    if (planData.kind === 'text') {
        let textHtml = '';

        //Rendering static text and marked expression values in source order.
        for (const partData of /** @type {Record<string, unknown>[]} */ (planData.parts)) {
            if (partData.kind === 'static') {
                textHtml += layerHtmlTextEscape(String(partData.value));

            } else {
                const bindingIdentifier = String(partData.bindingId);
                const expressionValue = layerExpressionEvaluate(
                    /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (partData.expression),
                    renderScope
                );

                textHtml += `<!--layer-text:${bindingIdentifier}:start-->`;
                textHtml += layerHtmlTextEscape(layerTextValueNormalize(expressionValue));
                textHtml += `<!--layer-text:${bindingIdentifier}:end-->`;

            }

        }

        return textHtml;

    }

    if (planData.kind === 'if') {
        const bindingIdentifier = String(planData.bindingId);
        const visibleStatus = Boolean(layerExpressionEvaluate(
            /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (planData.expression),
            renderScope
        ));
        let conditionalHtml = `<!--layer-if:${bindingIdentifier}:start-->`;

        //Rendering the owned boundary only when its condition is true.
        if (visibleStatus) {
            conditionalHtml += renderPlanToHtml(
                /** @type {Record<string, unknown>} */ (planData.template),
                renderScope,
                scopeIdentifier
            );

        }

        conditionalHtml += `<!--layer-if:${bindingIdentifier}:end-->`;

        return conditionalHtml;

    }

    if (planData.kind === 'for') {
        const bindingIdentifier = String(planData.bindingId);
        const collectionValue = layerExpressionEvaluate(
            /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (planData.source),
            renderScope
        );

        if (!Array.isArray(collectionValue)) {
            throw new TypeError('l-for source must resolve to an array.');

        }

        const keySet = new Set();
        let listHtml = `<!--layer-for:${bindingIdentifier}:start-->`;

        //Rendering keyed entries while rejecting duplicate identity.
        for (let itemIndex = 0; itemIndex < collectionValue.length; itemIndex += 1) {
            let indexName = null;

            //Normalizing the optional index local before creating the item scope.
            if (planData.indexName !== null) {
                indexName = String(planData.indexName);

            }

            const itemScope = layerListScopeCreate(
                renderScope,
                String(planData.itemName),
                indexName,
                collectionValue[itemIndex],
                itemIndex
            );
            const keyValue = layerExpressionEvaluate(
                /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (planData.key),
                itemScope
            );
            const normalizedKey = layerListKeyNormalize(keyValue);

            if (keySet.has(normalizedKey)) {
                throw new TypeError(`Duplicate l-key value: ${normalizedKey}.`);

            }

            keySet.add(normalizedKey);
            listHtml += renderPlanToHtml(
                /** @type {Record<string, unknown>} */ (planData.template),
                itemScope,
                scopeIdentifier,
                {
                    listKey: normalizedKey
                }
            );

        }

        listHtml += `<!--layer-for:${bindingIdentifier}:end-->`;

        return listHtml;

    }

    if (planData.kind !== 'element') {
        throw new TypeError(`Unsupported render plan node: ${String(planData.kind)}.`);

    }

    const elementTag = String(planData.tag);
    let attributeHtml = ` data-layer-node="${layerHtmlAttributeEscape(String(planData.nodeId))}"`;
    attributeHtml += ` data-layer-scope="${layerHtmlAttributeEscape(scopeIdentifier)}"`;

    if (planData.refName !== null && planData.refName !== undefined) {
        attributeHtml += ` data-layer-ref="${layerHtmlAttributeEscape(String(planData.refName))}"`;

    }

    if (planData.regionName !== null && planData.regionName !== undefined) {
        attributeHtml += ` data-layer-region="${layerHtmlAttributeEscape(String(planData.regionName))}"`;
        attributeHtml += ' data-layer-region-revision="0"';

    }

    if (renderOptions.listKey !== undefined) {
        attributeHtml += ` data-layer-key="${layerHtmlAttributeEscape(renderOptions.listKey)}"`;

    }

    //Serializing trusted static attributes from the compiler plan.
    for (const attributeData of /** @type {Record<string, unknown>[]} */ (planData.attributes)) {
        const attributeName = String(attributeData.name);
        const attributeValue = layerAttributeValueNormalize(attributeName, attributeData.value);

        if (attributeValue !== null) {
            attributeHtml += ` ${attributeName}="${layerHtmlAttributeEscape(attributeValue)}"`;

        }

    }

    //Serializing dynamic attributes through the same policy used by the browser.
    for (const bindingData of /** @type {Record<string, unknown>[]} */ (planData.attributeBindings)) {
        const attributeName = String(bindingData.name);
        const attributeValue = layerAttributeValueNormalize(
            attributeName,
            layerExpressionEvaluate(
                /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (bindingData.expression),
                renderScope
            )
        );

        if (attributeValue !== null) {
            attributeHtml += ` ${attributeName}="${layerHtmlAttributeEscape(attributeValue)}"`;

        }

    }

    let textareaModelHtml = /** @type {string | null} */ (null);

    //Serializing model-owned initial state without emitting executable markup.
    for (const bindingData of /** @type {Record<string, unknown>[]} */ (planData.modelBindings ?? [])) {
        const modelValue = layerExpressionEvaluate(
            /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (bindingData.expression),
            renderScope
        );

        if (bindingData.property === 'checked') {
            if (modelValue) {
                attributeHtml += ' checked=""';

            }

        } else if (elementTag === 'textarea') {
            textareaModelHtml = layerHtmlTextEscape(layerTextValueNormalize(modelValue));

        } else {
            attributeHtml += ` value="${layerHtmlAttributeEscape(layerTextValueNormalize(modelValue))}"`;

        }

    }

    let elementHtml = `<${elementTag}${attributeHtml}>`;

    if (!voidElementSet.has(elementTag)) {
        if (textareaModelHtml !== null) {
            elementHtml += textareaModelHtml;

        } else {
            for (const childPlan of /** @type {Record<string, unknown>[]} */ (planData.children)) {
                elementHtml += renderPlanToHtml(childPlan, renderScope, scopeIdentifier);

            }

        }

        elementHtml += `</${elementTag}>`;

    }

    return elementHtml;

}

/**
 * @param {{compilerVersion: number, componentId: string, scopeId: string, template: Record<string, unknown>[], style: {css: string}}} componentData
 * @param {Record<string, unknown>} renderScope
 * @param {{runtimeVersion?: string, protocolVersion?: number}} [renderOptions]
 */
export function layerComponentRenderToString(componentData, renderScope, renderOptions = {}) {
    let componentHtml = '';

    //Rendering every top-level plan node without executing component source code.
    for (const planData of componentData.template) {
        componentHtml += renderPlanToHtml(planData, renderScope, componentData.scopeId);

    }

    return Object.freeze({
        html: componentHtml,
        css: componentData.style.css,
        metadata: Object.freeze({
            componentId: componentData.componentId,
            compilerVersion: componentData.compilerVersion,
            runtimeVersion: renderOptions.runtimeVersion ?? '0.1.0',
            protocolVersion: renderOptions.protocolVersion ?? 1
        })
    });

}
