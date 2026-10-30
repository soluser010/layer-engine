import {
    layerExpressionAssign,
    layerExpressionEvaluate
} from '@solcorp/layer-compiler/expression';
import {
    layerErrorBoundaryValueResolve,
    layerRenderErrorNormalize
} from './error-boundary.js';
import {layerComponentInvocationResolve} from './component-invocation.js';
import {layerRenderDiagnosticsCreate} from './diagnostics.js';
import {layerAttributeValueNormalize} from './render-values.js';
import {layerRegionCollectionCreate} from './server-regions.js';
import {
    layerReactiveValueRead,
    layerRepeatValueResolve,
    layerWhenValueResolve
} from './structures.js';
import {
    layerListKeyNormalize,
    layerListScopeCreate,
    structuralTemplateScopeCreate
} from './ssr.js';
import {
    computed,
    layerBindingObserve,
    signal
} from './signals.js';

/**
 * @param {LayerDomContext} domContext
 * @param {number} cleanupStartIndex
 */
function cleanupHandlersRollback( domContext, cleanupStartIndex ){
    const rollbackHandlers = domContext.cleanupHandlers.splice( cleanupStartIndex );

    //Releasing partially connected bindings in reverse ownership order
    for ( let handlerIndex = rollbackHandlers.length - 1; handlerIndex >= 0; handlerIndex -= 1 ){
        rollbackHandlers[handlerIndex]?.();

    }

}

/**
 * @typedef {{nodes: Node[], dispose: () => void}} LayerDomInstance
 * @typedef {{diagnostics: ReturnType<typeof layerRenderDiagnosticsCreate>, document: Document, cleanupHandlers: (() => void)[], refs: Map<string, Set<Element>>, regions: Map<string, {element: Element, revision: number}>}} LayerDomContext
 * @typedef {{scope: Record<string, unknown>, valueReaders: ReturnType<typeof computed>[], valueSignals: ReturnType<typeof signal>[]}} LayerStructuralTemplateState
 */

/**
 * @param {() => void} cleanupHandler
 * @param {LayerDomContext} domContext
 */
function cleanupHandlerRegister(cleanupHandler, domContext) {
    //Retaining every binding cleanup for mismatch recovery and root disposal.
    domContext.cleanupHandlers.push(cleanupHandler);

}

/**
 * @param {Node[]} instanceNodes
 * @param {(() => void)[]} cleanupHandlers
 * @returns {LayerDomInstance}
 */
function domInstanceCreate(instanceNodes, cleanupHandlers) {
    let disposedStatus = false;

    return {
        nodes: instanceNodes,
        dispose() {
            //Making structural disposal safe when parent and root cleanup overlap.
            if (disposedStatus) {
                return;

            }

            disposedStatus = true;

            for (let cleanupIndex = cleanupHandlers.length - 1; cleanupIndex >= 0; cleanupIndex -= 1) {
                cleanupHandlers[cleanupIndex]?.();

            }

        }
    };

}

/**
 * @param {Element} elementNode
 * @param {string} regionName
 * @param {LayerDomContext} domContext
 * @param {boolean} hydrateStatus
 */
function serverRegionConnect(elementNode, regionName, domContext, hydrateStatus) {
    if (domContext.regions.has(regionName)) {
        throw new TypeError(`Duplicate live server-driven region: ${regionName}.`);

    }

    if (hydrateStatus) {
        //Requiring SSR to declare the same initial region contract as the compiler plan.
        if (elementNode.getAttribute('data-layer-region') !== regionName ||
            elementNode.getAttribute('data-layer-region-revision') !== '0') {
            throw new TypeError(`Server-driven region hydration mismatch: ${regionName}.`);

        }

    } else {
        elementNode.setAttribute('data-layer-region', regionName);
        elementNode.setAttribute('data-layer-region-revision', '0');

    }

    const regionState = {
        element: elementNode,
        revision: 0
    };

    domContext.regions.set(regionName, regionState);

    const regionDispose = function serverRegionDispose() {
        //Removing only the registration still owned by this exact element instance.
        if (domContext.regions.get(regionName) === regionState) {
            domContext.regions.delete(regionName);

        }

    };

    cleanupHandlerRegister(regionDispose, domContext);

    return regionDispose;

}

/**
 * @param {Node} nodeData
 * @param {LayerDomContext} domContext
 * @param {string | null} bindingIdentifier
 * @param {string | null} nodeIdentifier
 */
function domNodeRemove(nodeData, domContext, bindingIdentifier, nodeIdentifier) {
    //Removing only nodes still owned by their current parent.
    if (nodeData.parentNode !== null) {
        nodeData.parentNode.removeChild(nodeData);
        domContext.diagnostics.mutationRecord('remove', bindingIdentifier, nodeIdentifier);

    }

}

/**
 * @param {LayerDomInstance} instanceData
 * @param {LayerDomContext} domContext
 * @param {string | null} bindingIdentifier
 * @param {string | null} nodeIdentifier
 */
function domInstanceRemove(instanceData, domContext, bindingIdentifier, nodeIdentifier) {
    instanceData.dispose();

    //Removing all nodes owned by this instance boundary.
    for (const nodeData of instanceData.nodes) {
        domNodeRemove(nodeData, domContext, bindingIdentifier, nodeIdentifier);

    }

}

/**
 * @param {ParentNode & Node} parentNode
 * @param {Node} nodeData
 * @param {Node | null} beforeNode
 * @param {LayerDomContext} domContext
 * @param {string | null} nodeIdentifier
 */
function createdNodeInsert(parentNode, nodeData, beforeNode, domContext, nodeIdentifier) {
    //Inserting a newly created node at its compiler-defined position.
    parentNode.insertBefore(nodeData, beforeNode);
    domContext.diagnostics.mutationRecord('create', null, nodeIdentifier);

}

/**
 * @param {Node | null} commentNode
 * @param {string} expectedValue
 * @returns {asserts commentNode is Comment}
 */
function hydrationCommentAssert(commentNode, expectedValue) {
    //Checking exact boundary markers before binding existing DOM ownership.
    if (commentNode === null || commentNode.nodeType !== 8 || commentNode.nodeValue !== expectedValue) {
        throw new TypeError(`Hydration marker mismatch: ${expectedValue}.`);

    }

}

/**
 * @param {Element} elementNode
 * @param {Record<string, unknown>} bindingData
 * @param {Record<string, unknown>} renderScope
 * @param {LayerDomContext} domContext
 */
function attributeBindingConnect(elementNode, bindingData, renderScope, domContext) {
    const bindingIdentifier = String(bindingData.bindingId);
    const nodeIdentifier = elementNode.getAttribute('data-layer-node');

    const bindingDispose = layerBindingObserve(function attributeBindingUpdate() {
        //Evaluating this binding only when one of its signal dependencies changes.
        const rawValue = layerExpressionEvaluate(
            /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (bindingData.expression),
            renderScope
        );
        const attributeName = String(bindingData.name);

        if (bindingData.mode === 'property') {
            const propertyTarget = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (elementNode));
            let propertyValue = rawValue;

            if (attributeName === 'value' && (propertyValue === null || propertyValue === undefined)) {
                propertyValue = '';

            }

            if ((attributeName === 'checked' || attributeName === 'selected' || attributeName === 'indeterminate') &&
                typeof propertyValue !== 'boolean') {
                propertyValue = Boolean(propertyValue);

            }

            if (!Object.is(propertyTarget[attributeName], propertyValue)) {
                propertyTarget[attributeName] = propertyValue;
                domContext.diagnostics.mutationRecord('property', bindingIdentifier, nodeIdentifier);

            }

            return;

        }

        const normalizedValue = layerAttributeValueNormalize(attributeName, rawValue);
        const currentValue = elementNode.getAttribute(attributeName);

        if (normalizedValue === null) {
            if (currentValue !== null) {
                elementNode.removeAttribute(attributeName);
                domContext.diagnostics.mutationRecord('attribute', bindingIdentifier, nodeIdentifier);

            }

        } else if (currentValue !== normalizedValue) {
            elementNode.setAttribute(attributeName, normalizedValue);
            domContext.diagnostics.mutationRecord('attribute', bindingIdentifier, nodeIdentifier);

        }

    });

    cleanupHandlerRegister(bindingDispose, domContext);

    return bindingDispose;

}

/**
 * @param {Element} elementNode
 * @param {Record<string, unknown>} bindingData
 * @param {Record<string, unknown>} renderScope
 * @param {LayerDomContext} domContext
 */
function eventBindingConnect(elementNode, bindingData, renderScope, domContext) {
    const eventName = String(bindingData.event);

    /** @param {Event} eventData */
    const eventHandler = function compiledEventHandle(eventData) {
        //Resolving the current handler at event time without a persistent signal edge.
        const expressionResult = layerExpressionEvaluate(
            /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (bindingData.expression),
            renderScope
        );

        if (typeof expressionResult === 'function') {
            expressionResult(eventData);

        }

    };

    elementNode.addEventListener(eventName, eventHandler);

    const eventDispose = function compiledEventDispose() {
        //Removing the exact listener installed for this element binding.
        elementNode.removeEventListener(eventName, eventHandler);

    };

    cleanupHandlerRegister(eventDispose, domContext);

    return eventDispose;

}

/**
 * @param {Element} elementNode
 * @param {Record<string, unknown>} bindingData
 * @param {Record<string, unknown>} renderScope
 * @param {LayerDomContext} domContext
 */
function modelBindingConnect(elementNode, bindingData, renderScope, domContext) {
    const bindingIdentifier = String(bindingData.bindingId);
    const propertyName = /** @type {'checked' | 'value'} */ (bindingData.property);
    const propertyTarget = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (elementNode));
    const nodeIdentifier = elementNode.getAttribute('data-layer-node');

    const bindingDispose = layerBindingObserve(function modelBindingUpdate() {
        //Synchronizing the form property only when the model dependency changes.
        const modelValue = layerExpressionEvaluate(
            /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (bindingData.expression),
            renderScope
        );
        let propertyValue = /** @type {string | boolean} */ (String(modelValue ?? ''));

        //Preserving boolean DOM semantics for checkbox state.
        if (propertyName === 'checked') {
            propertyValue = Boolean(modelValue);

        }

        if (!Object.is(propertyTarget[propertyName], propertyValue)) {
            propertyTarget[propertyName] = propertyValue;
            domContext.diagnostics.mutationRecord('property', bindingIdentifier, nodeIdentifier);

        }

    });

    /** @param {Event} _eventData */
    const modelEventHandle = function modelEventHandle(_eventData) {
        //Writing the browser-owned control value through the compiled assignment boundary.
        layerExpressionAssign(
            /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (bindingData.expression),
            renderScope,
            propertyTarget[propertyName]
        );

    };

    elementNode.addEventListener(String(bindingData.event), modelEventHandle);

    const modelDispose = function modelDispose() {
        //Disconnecting both dependency observation and the exact DOM listener.
        bindingDispose();
        elementNode.removeEventListener(String(bindingData.event), modelEventHandle);

    };

    cleanupHandlerRegister(modelDispose, domContext);

    return modelDispose;

}

/**
 * @param {Element} elementNode
 * @param {string} refName
 * @param {LayerDomContext} domContext
 */
function templateRefConnect(elementNode, refName, domContext) {
    let refSet = domContext.refs.get(refName);

    if (refSet === undefined) {
        refSet = new Set();
        domContext.refs.set(refName, refSet);

    }

    //Registering every repeated keyed ref without exposing a mutable collection.
    refSet.add(elementNode);

    const refDispose = function templateRefDispose() {
        //Removing only this element and pruning the empty named ref collection.
        refSet.delete(elementNode);

        if (refSet.size === 0) {
            domContext.refs.delete(refName);

        }

    };

    cleanupHandlerRegister(refDispose, domContext);

    return refDispose;

}

/**
 * @param {Element} elementNode
 * @param {Record<string, unknown>} bindingData
 * @param {Record<string, unknown>} renderScope
 * @param {LayerDomContext} domContext
 */
function dynamicTemplateRefConnect(elementNode, bindingData, renderScope, domContext) {
    const referenceData = layerExpressionEvaluate(
        /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (bindingData.expression),
        renderScope
    );

    if (typeof referenceData !== 'object' || referenceData === null ||
        !Object.hasOwn(referenceData, 'current')) {
        throw new TypeError('A dynamic ref binding requires a Layer reference object.');

    }

    const referenceTarget = /** @type {{current: Element | null}} */ (referenceData);

    if (referenceTarget.current !== null && referenceTarget.current !== elementNode) {
        throw new TypeError('A Layer reference is already connected to another element.');

    }

    //Connecting the live element only after the binding contract has been validated.
    referenceTarget.current = elementNode;

    const referenceDispose = function dynamicTemplateRefDispose() {
        //Clearing only the element still owned by this binding instance.
        if (referenceTarget.current === elementNode) {
            referenceTarget.current = null;

        }

    };

    cleanupHandlerRegister(referenceDispose, domContext);

    return referenceDispose;

}

/**
 * @param {Map<string, Set<Element>>} refMap
 */
function templateRefsViewCreate(refMap) {
    return Object.freeze({
        /** @param {string} refName */
        get(refName) {
            //Returning the first live ref for convenient single-element access.
            return refMap.get(refName)?.values().next().value ?? null;

        },
        /** @param {string} refName */
        getAll(refName) {
            //Returning a frozen snapshot so callers cannot mutate renderer ownership.
            return Object.freeze([...(refMap.get(refName) ?? [])]);

        },
        /** @param {string} refName */
        has(refName) {
            //Reporting only names with at least one live element.
            return (refMap.get(refName)?.size ?? 0) > 0;

        },
        list() {
            //Listing names in stable lexical order for diagnostics.
            return Object.freeze([...refMap.keys()].sort());

        }
    });

}

/**
 * @param {Record<string, unknown>} planData
 * @param {Record<string, unknown>} renderScope
 */
function slotRenderDataResolve(planData, renderScope) {
    const slotCollection = renderScope.$slots;
    const slotName = String(planData.name);

    if (typeof slotCollection !== 'object' || slotCollection === null ||
        !Object.hasOwn(slotCollection, slotName)) {
        return {
            plans: /** @type {Record<string, unknown>[]} */ (planData.fallback),
            scope: renderScope,
            scopeId: planData.scopeId
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

    if (
        !Array.isArray(slotComponent.template) || typeof slotComponent.scopeId !== 'string' ||
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
 */
function structuralTemplateResultAssert(templateData, templateResult) {
    if (typeof templateResult !== 'object' || templateResult === null) {
        throw new TypeError('A structural renderer returned an invalid template result.');

    }

    const templateRecord = /** @type {Record<string, unknown>} */ (templateResult);
    const expectedMarkerList = /** @type {string[]} */ (templateData.markers);
    const expectedStringList = /** @type {string[]} */ (templateData.strings);
    const actualStringList = templateRecord.strings;
    const actualValueList = templateRecord.values;

    if (!Array.isArray(actualStringList) || !Array.isArray(actualValueList) ||
        actualValueList.length !== expectedMarkerList.length ||
        actualStringList.length !== expectedStringList.length) {
        throw new TypeError('A structural runtime template does not match its compiled plan.');

    }

    for (let stringIndex = 0; stringIndex < expectedStringList.length; stringIndex += 1) {
        if (actualStringList[stringIndex] !== expectedStringList[stringIndex]) {
            throw new TypeError('A structural runtime template changed its compiled static HTML.');

        }

    }

    return /** @type {{values: readonly unknown[]}} */ (templateRecord);

}

/**
 * @param {Record<string, unknown>} templateData
 * @param {unknown} templateResult
 * @param {Record<string, unknown>} parentScope
 * @returns {LayerStructuralTemplateState}
 */
function structuralTemplateStateCreate(templateData, templateResult, parentScope) {
    const resultData = structuralTemplateResultAssert(templateData, templateResult);
    const markerList = /** @type {string[]} */ (templateData.markers);
    const valueSignals = resultData.values.map(function templateValueSignalCreate(valueData) {
        //Keeping one writable bridge for later renders of the same structural template.
        return signal(valueData);

    });
    const valueReaders = valueSignals.map(function templateValueReaderCreate(valueSignal) {
        //Flattening a captured signal or scalar through one stable local dependency.
        return computed(function templateValueRead() {
            //Returning the latest scalar behind both the local bridge and an author signal.
            return layerReactiveValueRead(valueSignal.get());

        });

    });
    const templateScope = {
        ...parentScope
    };

    for (let markerIndex = 0; markerIndex < markerList.length; markerIndex += 1) {
        const markerName = /** @type {string} */ (markerList[markerIndex]);
        const valueReader = /** @type {ReturnType<typeof computed>} */ (valueReaders[markerIndex]);

        templateScope[markerName] = valueReader;

    }

    return {
        scope: templateScope,
        valueReaders,
        valueSignals
    };

}

/**
 * @param {Record<string, unknown>} templateData
 * @param {unknown} templateResult
 * @param {LayerStructuralTemplateState} templateState
 */
function structuralTemplateStateUpdate(templateData, templateResult, templateState) {
    //Validating static shape before publishing new values to existing DOM bindings.
    const resultData = structuralTemplateResultAssert(templateData, templateResult);

    for (let valueIndex = 0; valueIndex < resultData.values.length; valueIndex += 1) {
        templateState.valueSignals[valueIndex]?.set(resultData.values[valueIndex]);

    }

}

/**
 * @param {Record<string, unknown>} templateData
 * @param {unknown} templateResult
 * @param {ParentNode & Node} parentNode
 * @param {Node | null} beforeNode
 * @param {Record<string, unknown>} parentScope
 * @param {LayerDomContext} domContext
 * @param {string} scopeIdentifier
 * @param {{listKey?: string}} [mountOptions]
 */
function structuralTemplateMount(
    templateData,
    templateResult,
    parentNode,
    beforeNode,
    parentScope,
    domContext,
    scopeIdentifier,
    mountOptions = {}
) {
    const templateState = structuralTemplateStateCreate(templateData, templateResult, parentScope);
    const childInstances = /** @type {LayerDomInstance[]} */ ([]);
    const childNodes = /** @type {Node[]} */ ([]);

    for (const childPlan of /** @type {Record<string, unknown>[]} */ (templateData.template)) {
        const scopedChildPlan = {
            ...childPlan,
            scopeId: scopeIdentifier
        };
        const childInstance = planMount(
            scopedChildPlan,
            parentNode,
            beforeNode,
            templateState.scope,
            domContext,
            mountOptions
        );

        childInstances.push(childInstance);
        childNodes.push(...childInstance.nodes);

    }

    const templateDispose = function structuralTemplateDispose() {
        //Disconnecting bridge computations before child bindings release their nodes.
        for (const valueReader of templateState.valueReaders) {
            valueReader.dispose();

        }

        for (const childInstance of childInstances) {
            childInstance.dispose();

        }

    };

    return {
        instance: domInstanceCreate(childNodes, [templateDispose]),
        state: templateState
    };

}

/**
 * @param {Record<string, unknown>} templateData
 * @param {unknown} templateResult
 * @param {Node | null} currentNode
 * @param {Record<string, unknown>} parentScope
 * @param {LayerDomContext} domContext
 * @param {string} scopeIdentifier
 */
function structuralTemplateHydrate(
    templateData,
    templateResult,
    currentNode,
    parentScope,
    domContext,
    scopeIdentifier
) {
    const templateState = structuralTemplateStateCreate(templateData, templateResult, parentScope);
    const childInstances = /** @type {LayerDomInstance[]} */ ([]);
    const childNodes = /** @type {Node[]} */ ([]);
    let nextNode = currentNode;

    for (const childPlan of /** @type {Record<string, unknown>[]} */ (templateData.template)) {
        const scopedChildPlan = {
            ...childPlan,
            scopeId: scopeIdentifier
        };
        const childHydration = planHydrate(scopedChildPlan, nextNode, templateState.scope, domContext);

        childInstances.push(childHydration.instance);
        childNodes.push(...childHydration.instance.nodes);
        nextNode = childHydration.nextNode;

    }

    const templateDispose = function structuralTemplateDispose() {
        //Disconnecting hydrated bridge computations and child bindings together.
        for (const valueReader of templateState.valueReaders) {
            valueReader.dispose();

        }

        for (const childInstance of childInstances) {
            childInstance.dispose();

        }

    };

    return {
        instance: domInstanceCreate(childNodes, [templateDispose]),
        nextNode,
        state: templateState
    };

}

/**
 * @param {Record<string, unknown>} planData
 * @param {boolean} branchStatus
 */
function whenTemplateDataSelect(planData, branchStatus) {
    let templateData = planData.falsy;

    //Selecting the true compiled branch only when its condition is active.
    if (branchStatus) {
        templateData = planData.truthy;

    }

    return /** @type {Record<string, unknown> | null} */ (templateData);

}

/**
 * @param {Record<string, unknown>} planData
 * @param {ParentNode & Node} parentNode
 * @param {Node | null} beforeNode
 * @param {Record<string, unknown>} renderScope
 * @param {LayerDomContext} domContext
 */
function whenPlanMount(planData, parentNode, beforeNode, renderScope, domContext) {
    const bindingIdentifier = String(planData.bindingId);
    const startMarker = domContext.document.createComment(`layer-when:${bindingIdentifier}:start`);
    const endMarker = domContext.document.createComment(`layer-when:${bindingIdentifier}:end`);
    let activeBranch = /** @type {boolean | null} */ (null);
    let activeTemplate = /** @type {{instance: LayerDomInstance, state: LayerStructuralTemplateState} | null} */ (null);

    createdNodeInsert(parentNode, startMarker, beforeNode, domContext, null);
    createdNodeInsert(parentNode, endMarker, beforeNode, domContext, null);

    const bindingDispose = layerBindingObserve(function whenBindingUpdate() {
        const descriptorData = layerWhenValueResolve(layerExpressionEvaluate(
            /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (planData.expression),
            renderScope
        ));
        const branchStatus = Boolean(layerReactiveValueRead(descriptorData.condition));
        const templateData = whenTemplateDataSelect(planData, branchStatus);
        const templateResult = descriptorData.render(branchStatus);

        if (templateData === null) {
            if (activeTemplate !== null) {
                domInstanceRemove(activeTemplate.instance, domContext, bindingIdentifier, null);
                activeTemplate = null;

            }

            activeBranch = branchStatus;
            return;

        }

        if (activeTemplate !== null && activeBranch === branchStatus) {
            structuralTemplateStateUpdate(templateData, templateResult, activeTemplate.state);
            return;

        }

        if (activeTemplate !== null) {
            domInstanceRemove(activeTemplate.instance, domContext, bindingIdentifier, null);

        }

        activeTemplate = structuralTemplateMount(
            templateData,
            templateResult,
            parentNode,
            endMarker,
            renderScope,
            domContext,
            String(planData.scopeId ?? '')
        );
        activeBranch = branchStatus;

    });
    const whenDispose = function whenDispose() {
        //Disconnecting the boundary observer and the currently mounted branch.
        bindingDispose();
        activeTemplate?.instance.dispose();
        activeTemplate = null;

    };

    cleanupHandlerRegister(whenDispose, domContext);

    return domInstanceCreate([startMarker, endMarker], [whenDispose]);

}

/**
 * @param {Record<string, unknown>} planData
 * @param {Node | null} currentNode
 * @param {Record<string, unknown>} renderScope
 * @param {LayerDomContext} domContext
 */
function whenPlanHydrate(planData, currentNode, renderScope, domContext) {
    const bindingIdentifier = String(planData.bindingId);
    const startMarker = /** @type {Comment | null} */ (currentNode);

    hydrationCommentAssert(startMarker, `layer-when:${bindingIdentifier}:start`);

    const descriptorData = layerWhenValueResolve(layerExpressionEvaluate(
        /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (planData.expression),
        renderScope
    ));
    let activeBranch = Boolean(layerReactiveValueRead(descriptorData.condition));
    let activeTemplate = /** @type {{instance: LayerDomInstance, nextNode?: Node | null, state: LayerStructuralTemplateState} | null} */ (
        null
    );
    const templateData = whenTemplateDataSelect(planData, activeBranch);
    let nextNode = /** @type {Node | null} */ (startMarker.nextSibling);

    if (templateData !== null) {
        const hydratedTemplate = structuralTemplateHydrate(
            templateData,
            descriptorData.render(activeBranch),
            nextNode,
            renderScope,
            domContext,
            String(planData.scopeId ?? '')
        );

        activeTemplate = hydratedTemplate;
        nextNode = hydratedTemplate.nextNode;

    }

    const endMarker = /** @type {Comment | null} */ (nextNode);

    hydrationCommentAssert(endMarker, `layer-when:${bindingIdentifier}:end`);

    const bindingDispose = layerBindingObserve(function hydratedWhenBindingUpdate() {
        const nextDescriptor = layerWhenValueResolve(layerExpressionEvaluate(
            /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (planData.expression),
            renderScope
        ));
        const nextBranch = Boolean(layerReactiveValueRead(nextDescriptor.condition));
        const nextTemplateData = whenTemplateDataSelect(planData, nextBranch);
        const nextTemplateResult = nextDescriptor.render(nextBranch);

        if (nextTemplateData === null) {
            if (activeTemplate !== null) {
                domInstanceRemove(activeTemplate.instance, domContext, bindingIdentifier, null);
                activeTemplate = null;

            }

            activeBranch = nextBranch;
            return;

        }

        if (activeTemplate !== null && activeBranch === nextBranch) {
            structuralTemplateStateUpdate(nextTemplateData, nextTemplateResult, activeTemplate.state);
            return;

        }

        if (activeTemplate !== null) {
            domInstanceRemove(activeTemplate.instance, domContext, bindingIdentifier, null);

        }

        activeTemplate = structuralTemplateMount(
            nextTemplateData,
            nextTemplateResult,
            /** @type {ParentNode & Node} */ (endMarker.parentNode),
            endMarker,
            renderScope,
            domContext,
            String(planData.scopeId ?? '')
        );
        activeBranch = nextBranch;

    });
    const whenDispose = function hydratedWhenDispose() {
        //Disconnecting the hydrated boundary and its currently active child template.
        bindingDispose();
        activeTemplate?.instance.dispose();
        activeTemplate = null;

    };

    cleanupHandlerRegister(whenDispose, domContext);

    return {
        instance: domInstanceCreate([startMarker, endMarker], [whenDispose]),
        nextNode: endMarker.nextSibling
    };

}

/**
 * @param {Record<string, unknown>} planData
 * @param {ParentNode & Node} parentNode
 * @param {Comment} endMarker
 * @param {Record<string, unknown>} renderScope
 * @param {LayerDomContext} domContext
 * @param {Map<string, {key: string, instance: LayerDomInstance, state: LayerStructuralTemplateState}>} entryMap
 */
function repeatBindingConnect(planData, parentNode, endMarker, renderScope, domContext, entryMap) {
    const bindingIdentifier = String(planData.bindingId);

    return layerBindingObserve(function repeatBindingUpdate() {
        const descriptorData = layerRepeatValueResolve(layerExpressionEvaluate(
            /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (planData.expression),
            renderScope
        ));
        const collectionValue = layerReactiveValueRead(descriptorData.collection);

        if (!Array.isArray(collectionValue)) {
            throw new TypeError('repeat source must resolve to an array.');

        }

        const nextEntryMap = /** @type {Map<string, {key: string, instance: LayerDomInstance, state: LayerStructuralTemplateState}>} */ (
            new Map()
        );
        const nextEntryList = /** @type {{key: string, instance: LayerDomInstance, state: LayerStructuralTemplateState}[]} */ ([]);
        const itemTemplate = /** @type {Record<string, unknown>} */ (planData.item);

        //Resolving the complete next key set before removing or moving live entries.
        for (let itemIndex = 0; itemIndex < collectionValue.length; itemIndex += 1) {
            const itemValue = collectionValue[itemIndex];
            const normalizedKey = layerListKeyNormalize(descriptorData.key(itemValue, itemIndex));

            if (nextEntryMap.has(normalizedKey)) {
                throw new TypeError(`Duplicate repeat key: ${normalizedKey}.`);

            }

            const itemResult = descriptorData.render(itemValue, itemIndex);
            let entryData = entryMap.get(normalizedKey);

            if (entryData === undefined) {
                const mountedTemplate = structuralTemplateMount(
                    itemTemplate,
                    itemResult,
                    parentNode,
                    endMarker,
                    renderScope,
                    domContext,
                    String(planData.scopeId ?? ''),
                    {
                        listKey: normalizedKey
                    }
                );

                entryData = {
                    key: normalizedKey,
                    instance: mountedTemplate.instance,
                    state: mountedTemplate.state
                };

            } else {
                structuralTemplateStateUpdate(itemTemplate, itemResult, entryData.state);

            }

            nextEntryMap.set(normalizedKey, entryData);
            nextEntryList.push(entryData);

        }

        for (const [entryKey, entryData] of entryMap.entries()) {
            if (!nextEntryMap.has(entryKey)) {
                domInstanceRemove(entryData.instance, domContext, bindingIdentifier, null);

            }

        }

        let cursorNode = /** @type {Node} */ (endMarker);

        //Moving retained node ranges from the end so focus and element identity survive reorder.
        for (let entryIndex = nextEntryList.length - 1; entryIndex >= 0; entryIndex -= 1) {
            const entryData = /** @type {{key: string, instance: LayerDomInstance, state: LayerStructuralTemplateState}} */ (nextEntryList[entryIndex]);
            const entryNodes = entryData.instance.nodes;
            const lastEntryNode = entryNodes[entryNodes.length - 1];

            if (lastEntryNode?.nextSibling !== cursorNode) {
                for (let nodeIndex = entryNodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
                    parentNode.insertBefore(/** @type {Node} */ (entryNodes[nodeIndex]), cursorNode);

                }

                domContext.diagnostics.mutationRecord('move', bindingIdentifier, null);

            }

            cursorNode = entryNodes[0] ?? cursorNode;

        }

        entryMap.clear();

        for (const [entryKey, entryData] of nextEntryMap.entries()) {
            entryMap.set(entryKey, entryData);

        }

    });

}

/**
 * @param {Record<string, unknown>} planData
 * @param {ParentNode & Node} parentNode
 * @param {Node | null} beforeNode
 * @param {Record<string, unknown>} renderScope
 * @param {LayerDomContext} domContext
 */
function repeatPlanMount(planData, parentNode, beforeNode, renderScope, domContext) {
    const bindingIdentifier = String(planData.bindingId);
    const startMarker = domContext.document.createComment(`layer-repeat:${bindingIdentifier}:start`);
    const endMarker = domContext.document.createComment(`layer-repeat:${bindingIdentifier}:end`);
    const entryMap = /** @type {Map<string, {key: string, instance: LayerDomInstance, state: LayerStructuralTemplateState}>} */ (
        new Map()
    );

    createdNodeInsert(parentNode, startMarker, beforeNode, domContext, null);
    createdNodeInsert(parentNode, endMarker, beforeNode, domContext, null);

    const bindingDispose = repeatBindingConnect(
        planData,
        parentNode,
        endMarker,
        renderScope,
        domContext,
        entryMap
    );
    const repeatDispose = function repeatDispose() {
        //Disconnecting reconciliation before releasing all surviving keyed entries.
        bindingDispose();

        for (const entryData of entryMap.values()) {
            entryData.instance.dispose();

        }

        entryMap.clear();

    };

    cleanupHandlerRegister(repeatDispose, domContext);

    return domInstanceCreate([startMarker, endMarker], [repeatDispose]);

}

/**
 * @param {Record<string, unknown>} planData
 * @param {Node | null} currentNode
 * @param {Record<string, unknown>} renderScope
 * @param {LayerDomContext} domContext
 */
function repeatPlanHydrate(planData, currentNode, renderScope, domContext) {
    const bindingIdentifier = String(planData.bindingId);
    const startMarker = /** @type {Comment | null} */ (currentNode);

    hydrationCommentAssert(startMarker, `layer-repeat:${bindingIdentifier}:start`);

    const descriptorData = layerRepeatValueResolve(layerExpressionEvaluate(
        /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (planData.expression),
        renderScope
    ));
    const collectionValue = layerReactiveValueRead(descriptorData.collection);

    if (!Array.isArray(collectionValue)) {
        throw new TypeError('repeat source must resolve to an array.');

    }

    const entryMap = /** @type {Map<string, {key: string, instance: LayerDomInstance, state: LayerStructuralTemplateState}>} */ (
        new Map()
    );
    const itemTemplate = /** @type {Record<string, unknown>} */ (planData.item);
    let nextNode = /** @type {Node | null} */ (startMarker.nextSibling);

    //Hydrating every server-rendered item against its deterministic key and template shape.
    for (let itemIndex = 0; itemIndex < collectionValue.length; itemIndex += 1) {
        const itemValue = collectionValue[itemIndex];
        const normalizedKey = layerListKeyNormalize(descriptorData.key(itemValue, itemIndex));
        let hydratedKeyMatches = false;

        if (nextNode !== null && nextNode.nodeType === 1) {
            hydratedKeyMatches = /** @type {Element} */ (nextNode).getAttribute('data-layer-key') === normalizedKey;

        }

        if (entryMap.has(normalizedKey) || !hydratedKeyMatches) {
            throw new TypeError(`Keyed repeat hydration mismatch at ${normalizedKey}.`);

        }

        const hydratedTemplate = structuralTemplateHydrate(
            itemTemplate,
            descriptorData.render(itemValue, itemIndex),
            nextNode,
            renderScope,
            domContext,
            String(planData.scopeId ?? '')
        );

        entryMap.set(normalizedKey, {
            key: normalizedKey,
            instance: hydratedTemplate.instance,
            state: hydratedTemplate.state
        });
        nextNode = hydratedTemplate.nextNode;

    }

    const endMarker = /** @type {Comment | null} */ (nextNode);

    hydrationCommentAssert(endMarker, `layer-repeat:${bindingIdentifier}:end`);

    const bindingDispose = repeatBindingConnect(
        planData,
        /** @type {ParentNode & Node} */ (endMarker.parentNode),
        endMarker,
        renderScope,
        domContext,
        entryMap
    );
    const repeatDispose = function hydratedRepeatDispose() {
        //Disconnecting hydrated reconciliation before releasing retained entries.
        bindingDispose();

        for (const entryData of entryMap.values()) {
            entryData.instance.dispose();

        }

        entryMap.clear();

    };

    cleanupHandlerRegister(repeatDispose, domContext);

    return {
        instance: domInstanceCreate([startMarker, endMarker], [repeatDispose]),
        nextNode: endMarker.nextSibling
    };

}

/**
 * @param {Record<string, unknown>} planData
 * @param {ReturnType<typeof layerComponentInvocationResolve>} componentInvocationState
 * @param {Record<string, unknown>} renderScope
 */
function componentSlotCollectionCreate( planData, componentInvocationState, renderScope ){
    const compiledSlotPlans = /** @type {Record<string, unknown>} */ ( planData.slots ?? {} );
    const componentSlotValues = componentInvocationState.slotValues;
    const slotCollection = Object.create( null );

    //Checking that every runtime slot has one compiler-owned static plan
    for ( const slotName of Object.keys( componentSlotValues ) ){
        if ( Object.hasOwn( compiledSlotPlans, slotName ) !== true ){
            //Passing an uncompiled slot value to the nested component boundary
            throw new TypeError( String( `Nested component slot ${slotName} has no compiled plan.` ) );

        }

    }

    //Creating isolated slot scopes from the matching runtime template values
    for ( const [slotName, compiledSlotPlan] of Object.entries( compiledSlotPlans ) ){
        if ( Object.hasOwn( componentSlotValues, slotName ) !== true ){
            //Passing a changed invocation shape to the nested component boundary
            throw new TypeError( String( `Nested component slot ${slotName} is missing at runtime.` ) );

        }

        let slotTemplateResult = componentSlotValues[slotName];

        //Calling a lazy slot only when the child instance is being created
        if ( typeof slotTemplateResult === 'function' ){
            slotTemplateResult = slotTemplateResult();

        }

        const objectCompiledSlotPlan = /** @type {Record<string, unknown>} */ ( compiledSlotPlan );
        const slotRenderScope = structuralTemplateScopeCreate(
            objectCompiledSlotPlan,
            slotTemplateResult,
            renderScope
        );

        //Preparing the internal slot contract for branding by the component runtime
        slotCollection[slotName] = {
            component: {
                scopeId: String( planData.scopeId ?? '' ),
                template: objectCompiledSlotPlan.template
            },
            scope: slotRenderScope
        };

    }

    //CallBack THE OBJECT
    return slotCollection;

}

/**
 * @param {Record<string, unknown>} planData
 * @param {Record<string, unknown>} renderScope
 * @param {LayerDomContext} domContext
 */
function componentBoundaryOptionsCreate( planData, renderScope, domContext ){
    const componentInvocationState = layerComponentInvocationResolve( layerExpressionEvaluate(
        /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ ( planData.expression ),
        renderScope
    ) );
    const parentContext = renderScope.$context;

    //Checking the inherited context before creating a child ownership scope
    if ( !parentContext || typeof parentContext !== String( 'object' ) ){
        //Passing the missing parent context to the nested component boundary
        throw new TypeError( String( 'Nested component context is unavailable.' ) );

    }

    //Creating the child render contract from compiler-owned plans and runtime values
    return {
        componentInvocationState,
        options: {
            context: parentContext,
            diagnostics: domContext.diagnostics,
            slots: componentSlotCollectionCreate( planData, componentInvocationState, renderScope )
        }
    };

}

/**
 * @param {Record<string, unknown>} planData
 * @param {ParentNode & Node} parentNode
 * @param {Node | null} beforeNode
 * @param {Record<string, unknown>} renderScope
 * @param {LayerDomContext} domContext
 */
function componentPlanMount( planData, parentNode, beforeNode, renderScope, domContext ){
    const bindingIdentifier = String( planData.bindingId );
    const startMarker = domContext.document.createComment( `layer-component:${bindingIdentifier}:start` );
    const endMarker = domContext.document.createComment( `layer-component:${bindingIdentifier}:end` );

    //Creating the stable nested component boundary before mounting its child nodes
    createdNodeInsert( parentNode, startMarker, beforeNode, domContext, null );
    createdNodeInsert( parentNode, endMarker, beforeNode, domContext, null );

    const componentBoundaryData = componentBoundaryOptionsCreate( planData, renderScope, domContext );
    const componentFragment = domContext.document.createDocumentFragment();
    const componentController = componentBoundaryData.componentInvocationState.mount(
        componentFragment,
        componentBoundaryData.options
    );
    const componentNodes = Array.from( componentFragment.childNodes );

    //Moving the already-bound child nodes into their parent boundary
    parentNode.insertBefore( componentFragment, endMarker );

    const componentDispose = function(){
        //Disposing child bindings and lifecycle before parent nodes are removed
        componentController.dispose();

    };

    cleanupHandlerRegister( componentDispose, domContext );

    //CallBack THE OBJECT
    return domInstanceCreate(
        [startMarker, ...componentNodes, endMarker],
        [componentDispose]
    );

}

/**
 * @param {Record<string, unknown>} planData
 * @param {Node | null} currentNode
 * @param {Record<string, unknown>} renderScope
 * @param {LayerDomContext} domContext
 */
function componentPlanHydrate( planData, currentNode, renderScope, domContext ){
    const bindingIdentifier = String( planData.bindingId );
    const startMarkerValue = `layer-component:${bindingIdentifier}:start`;
    const endMarkerValue = `layer-component:${bindingIdentifier}:end`;

    //Checking the opening marker before adopting server-rendered child nodes
    hydrationCommentAssert( currentNode, startMarkerValue );
    const startMarker = /** @type {Comment} */ ( currentNode );
    let endMarker = startMarker.nextSibling;

    //Finding the exact closing marker owned by this nested component boundary
    while (
        endMarker !== null &&
        (
            endMarker.nodeType !== Number( 8 ) ||
            endMarker.nodeValue !== endMarkerValue
        )
    ){
        endMarker = endMarker.nextSibling;

    }

    //Checking the closing marker before moving any server-rendered nodes
    hydrationCommentAssert( endMarker, endMarkerValue );
    const componentFragment = domContext.document.createDocumentFragment();
    let childNode = startMarker.nextSibling;

    //Moving only nodes inside the nested component boundary into an isolated hydration root
    while ( childNode !== endMarker ){
        const nextChildNode = childNode?.nextSibling ?? null;

        if ( childNode !== null ){
            componentFragment.append( childNode );

        }

        childNode = nextChildNode;

    }

    const componentBoundaryData = componentBoundaryOptionsCreate( planData, renderScope, domContext );
    const componentController = componentBoundaryData.componentInvocationState.hydrate(
        componentFragment,
        componentBoundaryData.options
    );
    const componentNodes = Array.from( componentFragment.childNodes );

    //Returning the adopted nodes to their original boundary without recreating them
    endMarker.parentNode?.insertBefore( componentFragment, endMarker );

    const componentDispose = function(){
        //Disposing hydrated child bindings and lifecycle before parent cleanup
        componentController.dispose();

    };

    cleanupHandlerRegister( componentDispose, domContext );

    //CallBack THE OBJECT
    return {
        instance: domInstanceCreate(
            [startMarker, ...componentNodes, endMarker],
            [componentDispose]
        ),
        nextNode: endMarker.nextSibling
    };

}

/**
 * @param {Record<string, unknown>} planData
 * @param {ParentNode & Node} parentNode
 * @param {Node | null} beforeNode
 * @param {Record<string, unknown>} renderScope
 * @param {LayerDomContext} domContext
 */
function errorBoundaryPlanMount( planData, parentNode, beforeNode, renderScope, domContext ){
    const bindingIdentifier = String( planData.bindingId );
    const boundaryDescriptor = layerErrorBoundaryValueResolve( layerExpressionEvaluate(
        /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ ( planData.expression ),
        renderScope
    ) );
    const boundaryFragment = domContext.document.createDocumentFragment();
    const startMarker = domContext.document.createComment( `layer-error-boundary:${bindingIdentifier}:start` );
    const endMarker = domContext.document.createComment( `layer-error-boundary:${bindingIdentifier}:end` );
    let branchName = String( 'content' );
    let activeTemplate;

    createdNodeInsert( boundaryFragment, startMarker, null, domContext, null );
    createdNodeInsert( boundaryFragment, endMarker, null, domContext, null );

    const contentCleanupStart = domContext.cleanupHandlers.length;

    try {
        //Mounting content off-document so a failed branch never leaks partial DOM
        activeTemplate = structuralTemplateMount(
            /** @type {Record<string, unknown>} */ ( planData.content ),
            boundaryDescriptor.content(),
            boundaryFragment,
            endMarker,
            renderScope,
            domContext,
            String( planData.scopeId ?? '' )
        );

    } catch ( renderFailure ){
        cleanupHandlersRollback( domContext, contentCleanupStart );

        //Removing every partial content node while retaining the boundary markers
        while ( startMarker.nextSibling !== endMarker ){
            startMarker.nextSibling?.remove();

        }

        branchName = String( 'fallback' );
        const fallbackCleanupStart = domContext.cleanupHandlers.length;

        try {
            //Rendering only a normalized failure contract into the fallback branch
            activeTemplate = structuralTemplateMount(
                /** @type {Record<string, unknown>} */ ( planData.fallback ),
                boundaryDescriptor.fallback( layerRenderErrorNormalize( renderFailure ) ),
                boundaryFragment,
                endMarker,
                renderScope,
                domContext,
                String( planData.scopeId ?? '' )
            );

        } catch ( fallbackFailure ){
            cleanupHandlersRollback( domContext, fallbackCleanupStart );
            throw fallbackFailure;

        }

    }

    const branchMarker = domContext.document.createComment(
        `layer-error-boundary:${bindingIdentifier}:${branchName}`
    );

    createdNodeInsert( boundaryFragment, branchMarker, startMarker.nextSibling, domContext, null );
    const boundaryNodes = Array.from( boundaryFragment.childNodes );

    //Publishing the complete successful branch as one DOM insertion
    parentNode.insertBefore( boundaryFragment, beforeNode );

    const boundaryDispose = function errorBoundaryDispose(){
        //Releasing only the branch which successfully acquired this boundary
        activeTemplate?.instance.dispose();

    };

    cleanupHandlerRegister( boundaryDispose, domContext );

    //CallBack THE OBJECT
    return domInstanceCreate( boundaryNodes, [boundaryDispose] );

}

/**
 * @param {Record<string, unknown>} planData
 * @param {Node | null} currentNode
 * @param {Record<string, unknown>} renderScope
 * @param {LayerDomContext} domContext
 */
function errorBoundaryPlanHydrate( planData, currentNode, renderScope, domContext ){
    const bindingIdentifier = String( planData.bindingId );
    const startMarker = /** @type {Comment | null} */ ( currentNode );

    hydrationCommentAssert( startMarker, `layer-error-boundary:${bindingIdentifier}:start` );
    const branchMarker = /** @type {Comment | null} */ ( startMarker.nextSibling );
    const contentMarkerValue = `layer-error-boundary:${bindingIdentifier}:content`;
    const fallbackMarkerValue = `layer-error-boundary:${bindingIdentifier}:fallback`;

    if (
        branchMarker === null ||
        branchMarker.nodeType !== Number( 8 ) ||
        ![contentMarkerValue, fallbackMarkerValue].includes( String( branchMarker.nodeValue ) )
    ){
        //Passing an unknown server-selected branch to root hydration recovery
        throw new TypeError( String( `Hydration marker mismatch: layer-error-boundary:${bindingIdentifier}.` ) );

    }

    const boundaryDescriptor = layerErrorBoundaryValueResolve( layerExpressionEvaluate(
        /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ ( planData.expression ),
        renderScope
    ) );
    let templateData = /** @type {Record<string, unknown>} */ ( planData.content );
    let templateResult;

    if ( branchMarker.nodeValue === contentMarkerValue ){
        //Recreating the branch selected by SSR before binding existing nodes
        templateResult = boundaryDescriptor.content();

    } else {
        templateData = /** @type {Record<string, unknown>} */ ( planData.fallback );
        let renderFailure;

        try {
            boundaryDescriptor.content();
            renderFailure = new TypeError( String( 'The server selected the error fallback.' ) );

        } catch ( contentFailure ){
            renderFailure = contentFailure;

        }

        templateResult = boundaryDescriptor.fallback( layerRenderErrorNormalize( renderFailure ) );

    }

    const hydratedTemplate = structuralTemplateHydrate(
        templateData,
        templateResult,
        branchMarker.nextSibling,
        renderScope,
        domContext,
        String( planData.scopeId ?? '' )
    );
    const endMarker = /** @type {Comment | null} */ ( hydratedTemplate.nextNode );

    hydrationCommentAssert( endMarker, `layer-error-boundary:${bindingIdentifier}:end` );

    const boundaryDispose = function hydratedErrorBoundaryDispose(){
        //Releasing all bindings adopted from the server-selected branch
        hydratedTemplate.instance.dispose();

    };

    cleanupHandlerRegister( boundaryDispose, domContext );

    //CallBack THE OBJECT
    return {
        instance: domInstanceCreate(
            [startMarker, branchMarker, ...hydratedTemplate.instance.nodes, endMarker],
            [boundaryDispose]
        ),
        nextNode: endMarker.nextSibling
    };

}

/**
 * @param {Record<string, unknown>} planData
 * @param {ParentNode & Node} parentNode
 * @param {Node | null} beforeNode
 * @param {Record<string, unknown>} renderScope
 * @param {LayerDomContext} domContext
 * @param {{listKey?: string}} [mountOptions]
 * @returns {LayerDomInstance}
 */
function planMount(planData, parentNode, beforeNode, renderScope, domContext, mountOptions = {}) {
    //Routing every compiler-owned node kind to its isolated mount implementation.
    if ( planData.kind === String( 'error-boundary' ) ){
        return errorBoundaryPlanMount( planData, parentNode, beforeNode, renderScope, domContext );

    }

    if (planData.kind === 'component') {
        return componentPlanMount(planData, parentNode, beforeNode, renderScope, domContext);

    }

    if (planData.kind === 'when') {
        return whenPlanMount(planData, parentNode, beforeNode, renderScope, domContext);

    }

    if (planData.kind === 'repeat') {
        return repeatPlanMount(planData, parentNode, beforeNode, renderScope, domContext);

    }

    if (planData.kind === 'slot') {
        const bindingIdentifier = String(planData.bindingId);
        const startMarker = domContext.document.createComment(`layer-slot:${bindingIdentifier}:start`);
        const endMarker = domContext.document.createComment(`layer-slot:${bindingIdentifier}:end`);
        const slotInstances = /** @type {LayerDomInstance[]} */ ([]);
        const slotNodes = /** @type {Node[]} */ ([startMarker]);
        const slotRenderData = slotRenderDataResolve(planData, renderScope);

        createdNodeInsert(parentNode, startMarker, beforeNode, domContext, String(planData.nodeId));
        createdNodeInsert(parentNode, endMarker, beforeNode, domContext, String(planData.nodeId));

        //Mounting either provided slot content or compiler-owned fallback plans.
        for (const slotPlan of slotRenderData.plans) {
            const scopedSlotPlan = {
                ...slotPlan,
                scopeId: slotRenderData.scopeId
            };
            const slotInstance = planMount(
                scopedSlotPlan,
                parentNode,
                endMarker,
                slotRenderData.scope,
                domContext
            );

            slotInstances.push(slotInstance);
            slotNodes.push(...slotInstance.nodes);

        }

        slotNodes.push(endMarker);

        const slotDispose = function slotDispose() {
            //Disconnecting all bindings owned by the selected slot content.
            for (const slotInstance of slotInstances) {
                slotInstance.dispose();

            }

        };

        cleanupHandlerRegister(slotDispose, domContext);

        return domInstanceCreate(slotNodes, [slotDispose]);

    }

    if (planData.kind === 'text') {
        const textNodes = /** @type {Node[]} */ ([]);
        const cleanupHandlers = [];

        //Creating static and dynamic text parts without parsing raw HTML.
        for (const partData of /** @type {Record<string, unknown>[]} */ (planData.parts)) {
            if (partData.kind === 'static') {
                const staticNode = domContext.document.createTextNode(String(partData.value));
                createdNodeInsert(parentNode, staticNode, beforeNode, domContext, String(planData.nodeId));
                textNodes.push(staticNode);

                continue;

            }

            const bindingIdentifier = String(partData.bindingId);
            const startMarker = domContext.document.createComment(`layer-text:${bindingIdentifier}:start`);
            const valueNode = domContext.document.createTextNode('');
            const endMarker = domContext.document.createComment(`layer-text:${bindingIdentifier}:end`);

            createdNodeInsert(parentNode, startMarker, beforeNode, domContext, String(planData.nodeId));
            createdNodeInsert(parentNode, valueNode, beforeNode, domContext, String(planData.nodeId));
            createdNodeInsert(parentNode, endMarker, beforeNode, domContext, String(planData.nodeId));
            textNodes.push(startMarker, valueNode, endMarker);

            const bindingDispose = layerBindingObserve(function textBindingUpdate() {
                //Updating only this text node when its expression dependencies change.
                const nextValue = layerExpressionEvaluate(
                    /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (partData.expression),
                    renderScope
                );
                let normalizedValue = '';

                if (nextValue !== null && nextValue !== undefined) {
                    normalizedValue = String(nextValue);

                }

                if (valueNode.data !== normalizedValue) {
                    valueNode.data = normalizedValue;
                    domContext.diagnostics.mutationRecord('text', bindingIdentifier, String(planData.nodeId));

                }

            });

            cleanupHandlers.push(bindingDispose);
            cleanupHandlerRegister(bindingDispose, domContext);

        }

        return domInstanceCreate(textNodes, cleanupHandlers);

    }

    if (planData.kind === 'if') {
        const bindingIdentifier = String(planData.bindingId);
        const startMarker = domContext.document.createComment(`layer-if:${bindingIdentifier}:start`);
        const endMarker = domContext.document.createComment(`layer-if:${bindingIdentifier}:end`);
        let childInstance = /** @type {LayerDomInstance | null} */ (null);

        createdNodeInsert(parentNode, startMarker, beforeNode, domContext, null);
        createdNodeInsert(parentNode, endMarker, beforeNode, domContext, null);

        const bindingDispose = layerBindingObserve(function conditionalBindingUpdate() {
            //Mounting or removing only the declared conditional boundary.
            const visibleStatus = Boolean(layerExpressionEvaluate(
                /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (planData.expression),
                renderScope
            ));

            if (visibleStatus && childInstance === null) {
                const childPlan = {
                    .../** @type {Record<string, unknown>} */ (planData.template),
                    scopeId: planData.scopeId
                };

                childInstance = planMount(
                    childPlan,
                    parentNode,
                    endMarker,
                    renderScope,
                    domContext
                );

            } else if (!visibleStatus && childInstance !== null) {
                domInstanceRemove(childInstance, domContext, bindingIdentifier, null);
                childInstance = null;

            }

        });
        const conditionalDispose = function conditionalDispose() {
            //Disposing the active child and its condition observer together.
            bindingDispose();

            if (childInstance !== null) {
                childInstance.dispose();
                childInstance = null;

            }

        };

        cleanupHandlerRegister(conditionalDispose, domContext);

        return domInstanceCreate([
            startMarker,
            endMarker
        ], [conditionalDispose]);

    }

    if (planData.kind === 'for') {
        return listPlanMount(planData, parentNode, beforeNode, renderScope, domContext);

    }

    if (planData.kind !== 'element') {
        throw new TypeError(`Unsupported render plan node: ${String(planData.kind)}.`);

    }

    const elementNode = domContext.document.createElement(String(planData.tag));
    const nodeIdentifier = String(planData.nodeId);
    const cleanupHandlers = [];

    elementNode.setAttribute('data-layer-node', nodeIdentifier);
    elementNode.setAttribute('data-layer-scope', String(planData.scopeId ?? ''));

    if (planData.refName !== null && planData.refName !== undefined) {
        elementNode.setAttribute('data-layer-ref', String(planData.refName));

    }

    if (planData.regionName !== null && planData.regionName !== undefined) {
        cleanupHandlers.push(serverRegionConnect(
            elementNode,
            String(planData.regionName),
            domContext,
            false
        ));

    }

    if (mountOptions.listKey !== undefined) {
        elementNode.setAttribute('data-layer-key', mountOptions.listKey);

    }

    //Applying compiler-owned static attributes through the URL policy.
    for (const attributeData of /** @type {Record<string, unknown>[]} */ (planData.attributes)) {
        const attributeName = String(attributeData.name);
        const attributeValue = layerAttributeValueNormalize(attributeName, attributeData.value);

        if (attributeValue !== null) {
            elementNode.setAttribute(attributeName, attributeValue);

        }

    }

    createdNodeInsert(parentNode, elementNode, beforeNode, domContext, nodeIdentifier);

    //Connecting scalar attribute and property bindings directly to this element.
    for (const bindingData of /** @type {Record<string, unknown>[]} */ (planData.attributeBindings)) {
        cleanupHandlers.push(attributeBindingConnect(elementNode, bindingData, renderScope, domContext));

    }

    //Connecting event handlers without creating inline JavaScript attributes.
    for (const bindingData of /** @type {Record<string, unknown>[]} */ (planData.eventBindings)) {
        cleanupHandlers.push(eventBindingConnect(elementNode, bindingData, renderScope, domContext));

    }

    if (planData.refName !== null && planData.refName !== undefined) {
        cleanupHandlers.push(templateRefConnect(elementNode, String(planData.refName), domContext));

    }

    if (typeof planData.refBinding === 'object' && planData.refBinding !== null) {
        cleanupHandlers.push(dynamicTemplateRefConnect(
            elementNode,
            /** @type {Record<string, unknown>} */ (planData.refBinding),
            renderScope,
            domContext
        ));

    }

    for (const childPlan of /** @type {Record<string, unknown>[]} */ (planData.children)) {
        const scopedChildPlan = {
            ...childPlan,
            scopeId: planData.scopeId
        };
        const childInstance = planMount(scopedChildPlan, elementNode, null, renderScope, domContext);

        cleanupHandlers.push(childInstance.dispose);

    }

    //Connecting form models after children so select options already exist.
    for (const bindingData of /** @type {Record<string, unknown>[]} */ (planData.modelBindings ?? [])) {
        cleanupHandlers.push(modelBindingConnect(elementNode, bindingData, renderScope, domContext));

    }

    return domInstanceCreate([elementNode], cleanupHandlers);

}

/**
 * @param {Record<string, unknown>} planData
 * @param {ParentNode & Node} parentNode
 * @param {Node | null} beforeNode
 * @param {Record<string, unknown>} renderScope
 * @param {LayerDomContext} domContext
 * @returns {LayerDomInstance}
 */
function listPlanMount(planData, parentNode, beforeNode, renderScope, domContext) {
    const bindingIdentifier = String(planData.bindingId);
    const startMarker = domContext.document.createComment(`layer-for:${bindingIdentifier}:start`);
    const endMarker = domContext.document.createComment(`layer-for:${bindingIdentifier}:end`);
    const entryMap = new Map();

    createdNodeInsert(parentNode, startMarker, beforeNode, domContext, null);
    createdNodeInsert(parentNode, endMarker, beforeNode, domContext, null);

    const bindingDispose = layerBindingObserve(function listBindingUpdate() {
        const collectionValue = layerExpressionEvaluate(
            /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (planData.source),
            renderScope
        );

        if (!Array.isArray(collectionValue)) {
            throw new TypeError('l-for source must resolve to an array.');

        }

        const nextEntryMap = new Map();
        const nextEntries = [];

        //Resolving stable keys before mutating the existing list.
        for (let itemIndex = 0; itemIndex < collectionValue.length; itemIndex += 1) {
            let indexName = null;

            //Normalizing the optional index local before evaluating the key.
            if (planData.indexName !== null) {
                indexName = String(planData.indexName);

            }

            const temporaryScope = layerListScopeCreate(
                renderScope,
                String(planData.itemName),
                indexName,
                collectionValue[itemIndex],
                itemIndex
            );
            const normalizedKey = layerListKeyNormalize(layerExpressionEvaluate(
                /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (planData.key),
                temporaryScope
            ));

            if (nextEntryMap.has(normalizedKey)) {
                throw new TypeError(`Duplicate l-key value: ${normalizedKey}.`);

            }

            let entryData = entryMap.get(normalizedKey);

            if (entryData === undefined) {
                const itemSignal = signal(collectionValue[itemIndex]);
                const indexSignal = signal(itemIndex);
                const itemScope = layerListScopeCreate(
                    renderScope,
                    String(planData.itemName),
                    indexName,
                    itemSignal,
                    indexSignal
                );
                const itemPlan = {
                    .../** @type {Record<string, unknown>} */ (planData.template),
                    scopeId: planData.scopeId
                };
                const itemInstance = planMount(itemPlan, parentNode, endMarker, itemScope, domContext, {
                    listKey: normalizedKey
                });

                entryData = {
                    key: normalizedKey,
                    itemSignal,
                    indexSignal,
                    instance: itemInstance
                };

            } else {
                entryData.itemSignal.set(collectionValue[itemIndex]);
                entryData.indexSignal.set(itemIndex);

            }

            nextEntryMap.set(normalizedKey, entryData);
            nextEntries.push(entryData);

        }

        //Removing entries no longer present in the new key set.
        for (const [entryKey, entryData] of entryMap.entries()) {
            if (!nextEntryMap.has(entryKey)) {
                domInstanceRemove(entryData.instance, domContext, bindingIdentifier, null);

            }

        }

        let cursorNode = /** @type {Node} */ (endMarker);

        //Moving only entries whose existing node range is out of keyed order.
        for (let entryIndex = nextEntries.length - 1; entryIndex >= 0; entryIndex -= 1) {
            const entryData = nextEntries[entryIndex];
            const entryNodes = entryData.instance.nodes;
            const lastEntryNode = entryNodes[entryNodes.length - 1];

            if (lastEntryNode?.nextSibling !== cursorNode) {
                for (let nodeIndex = entryNodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
                    parentNode.insertBefore(entryNodes[nodeIndex], cursorNode);

                }

                domContext.diagnostics.mutationRecord('move', bindingIdentifier, null);

            }

            cursorNode = entryNodes[0] ?? cursorNode;

        }

        entryMap.clear();

        for (const [entryKey, entryData] of nextEntryMap.entries()) {
            entryMap.set(entryKey, entryData);

        }

    });
    const listDispose = function listDispose() {
        //Disposing the list observer and all surviving keyed child bindings.
        bindingDispose();

        for (const entryData of entryMap.values()) {
            entryData.instance.dispose();

        }

        entryMap.clear();

    };

    cleanupHandlerRegister(listDispose, domContext);

    return domInstanceCreate([
        startMarker,
        endMarker
    ], [listDispose]);

}

/**
 * @param {Record<string, unknown>} planData
 * @param {Node | null} currentNode
 * @param {Record<string, unknown>} renderScope
 * @param {LayerDomContext} domContext
 * @returns {{instance: LayerDomInstance, nextNode: Node | null}}
 */
function planHydrate(planData, currentNode, renderScope, domContext) {
    if ( planData.kind === String( 'error-boundary' ) ){
        return errorBoundaryPlanHydrate( planData, currentNode, renderScope, domContext );

    }

    //Routing every compiler-owned node kind to its matching hydration implementation.
    if (planData.kind === 'component') {
        return componentPlanHydrate(planData, currentNode, renderScope, domContext);

    }

    if (planData.kind === 'when') {
        return whenPlanHydrate(planData, currentNode, renderScope, domContext);

    }

    if (planData.kind === 'repeat') {
        return repeatPlanHydrate(planData, currentNode, renderScope, domContext);

    }

    if (planData.kind === 'slot') {
        const bindingIdentifier = String(planData.bindingId);
        const startMarker = /** @type {Comment | null} */ (currentNode);
        const slotInstances = /** @type {LayerDomInstance[]} */ ([]);
        const slotNodes = /** @type {Node[]} */ ([]);
        const slotRenderData = slotRenderDataResolve(planData, renderScope);

        hydrationCommentAssert(startMarker, `layer-slot:${bindingIdentifier}:start`);
        slotNodes.push(startMarker);
        let nextNode = /** @type {Node | null} */ (startMarker.nextSibling);

        //Hydrating the exact provided slot or fallback plan selected during SSR.
        for (const slotPlan of slotRenderData.plans) {
            const scopedSlotPlan = {
                ...slotPlan,
                scopeId: slotRenderData.scopeId
            };
            const slotHydration = planHydrate(
                scopedSlotPlan,
                nextNode,
                slotRenderData.scope,
                domContext
            );

            slotInstances.push(slotHydration.instance);
            slotNodes.push(...slotHydration.instance.nodes);
            nextNode = slotHydration.nextNode;

        }

        const endMarker = /** @type {Comment | null} */ (nextNode);

        hydrationCommentAssert(endMarker, `layer-slot:${bindingIdentifier}:end`);
        slotNodes.push(endMarker);

        const slotDispose = function hydratedSlotDispose() {
            //Disconnecting every binding recovered from provided slot content.
            for (const slotInstance of slotInstances) {
                slotInstance.dispose();

            }

        };

        cleanupHandlerRegister(slotDispose, domContext);

        return {
            instance: domInstanceCreate(slotNodes, [slotDispose]),
            nextNode: endMarker.nextSibling
        };

    }

    if (planData.kind === 'text') {
        const textNodes = /** @type {Node[]} */ ([]);
        const cleanupHandlers = [];
        let nextNode = currentNode;

        //Matching each SSR text part and connecting dynamic observers in place.
        for (const partData of /** @type {Record<string, unknown>[]} */ (planData.parts)) {
            if (partData.kind === 'static') {
                if (nextNode === null || nextNode.nodeType !== 3 || nextNode.nodeValue !== String(partData.value)) {
                    throw new TypeError('Static text hydration mismatch.');

                }

                textNodes.push(nextNode);
                nextNode = nextNode.nextSibling;

                continue;

            }

            const bindingIdentifier = String(partData.bindingId);
            const startMarker = /** @type {Comment | null} */ (nextNode);

            hydrationCommentAssert(startMarker, `layer-text:${bindingIdentifier}:start`);
            nextNode = startMarker.nextSibling;

            let valueNode = /** @type {Text | null} */ (null);

            if (nextNode !== null && nextNode.nodeType === 3) {
                valueNode = /** @type {Text} */ (nextNode);
                nextNode = nextNode.nextSibling;

            }

            const endMarker = /** @type {Comment | null} */ (nextNode);

            hydrationCommentAssert(endMarker, `layer-text:${bindingIdentifier}:end`);
            nextNode = endMarker.nextSibling;
            textNodes.push(startMarker);

            if (valueNode !== null) {
                textNodes.push(valueNode);

            }

            textNodes.push(endMarker);

            const bindingDispose = layerBindingObserve(function hydratedTextBindingUpdate() {
                //Reusing SSR text and creating a node only when an empty binding later gains content.
                const expressionValue = layerExpressionEvaluate(
                    /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (partData.expression),
                    renderScope
                );
                let normalizedValue = '';

                if (expressionValue !== null && expressionValue !== undefined) {
                    normalizedValue = String(expressionValue);

                }

                if (valueNode === null && normalizedValue.length > 0) {
                    valueNode = domContext.document.createTextNode(normalizedValue);
                    endMarker.parentNode?.insertBefore(valueNode, endMarker);
                    textNodes.splice(textNodes.length - 1, 0, valueNode);
                    domContext.diagnostics.mutationRecord('create', bindingIdentifier, String(planData.nodeId));

                } else if (valueNode !== null && valueNode.data !== normalizedValue) {
                    valueNode.data = normalizedValue;
                    domContext.diagnostics.mutationRecord('text', bindingIdentifier, String(planData.nodeId));

                }

            });

            cleanupHandlers.push(bindingDispose);
            cleanupHandlerRegister(bindingDispose, domContext);

        }

        return {
            instance: domInstanceCreate(textNodes, cleanupHandlers),
            nextNode
        };

    }

    if (planData.kind === 'if') {
        const bindingIdentifier = String(planData.bindingId);
        const startMarker = /** @type {Comment | null} */ (currentNode);

        hydrationCommentAssert(startMarker, `layer-if:${bindingIdentifier}:start`);

        const visibleStatus = Boolean(layerExpressionEvaluate(
            /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (planData.expression),
            renderScope
        ));
        let nextNode = /** @type {Node | null} */ (startMarker.nextSibling);
        let childInstance = /** @type {LayerDomInstance | null} */ (null);

        if (visibleStatus) {
            const childPlan = {
                .../** @type {Record<string, unknown>} */ (planData.template),
                scopeId: planData.scopeId
            };
            const childHydration = planHydrate(
                childPlan,
                nextNode,
                renderScope,
                domContext
            );

            childInstance = childHydration.instance;
            nextNode = childHydration.nextNode;

        }

        const endMarker = /** @type {Comment | null} */ (nextNode);

        hydrationCommentAssert(endMarker, `layer-if:${bindingIdentifier}:end`);

        const bindingDispose = layerBindingObserve(function hydratedConditionalUpdate() {
            //Updating the hydrated boundary without replacing its parent element.
            const nextVisibleStatus = Boolean(layerExpressionEvaluate(
                /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (planData.expression),
                renderScope
            ));

            if (nextVisibleStatus && childInstance === null) {
                const childPlan = {
                    .../** @type {Record<string, unknown>} */ (planData.template),
                    scopeId: planData.scopeId
                };

                childInstance = planMount(
                    childPlan,
                    /** @type {ParentNode & Node} */ (endMarker.parentNode),
                    endMarker,
                    renderScope,
                    domContext
                );

            } else if (!nextVisibleStatus && childInstance !== null) {
                domInstanceRemove(childInstance, domContext, bindingIdentifier, null);
                childInstance = null;

            }

        });
        const conditionalDispose = function hydratedConditionalDispose() {
            //Disposing the hydrated condition and active child bindings.
            bindingDispose();

            if (childInstance !== null) {
                childInstance.dispose();
                childInstance = null;

            }

        };

        cleanupHandlerRegister(conditionalDispose, domContext);

        return {
            instance: domInstanceCreate([
                startMarker,
                endMarker
            ], [conditionalDispose]),
            nextNode: endMarker.nextSibling
        };

    }

    if (planData.kind === 'for') {
        return listPlanHydrate(planData, currentNode, renderScope, domContext);

    }

    if (planData.kind !== 'element' || currentNode === null || currentNode.nodeType !== 1) {
        throw new TypeError('Element hydration mismatch.');

    }

    const elementNode = /** @type {Element} */ (currentNode);
    const nodeIdentifier = String(planData.nodeId);

    if (elementNode.localName !== String(planData.tag) ||
        elementNode.getAttribute('data-layer-node') !== nodeIdentifier) {
        throw new TypeError(`Element hydration mismatch at ${nodeIdentifier}.`);

    }

    let expectedRefName = null;

    //Normalizing only declared refs so absent markers remain absent.
    if (planData.refName !== null && planData.refName !== undefined) {
        expectedRefName = String(planData.refName);

    }

    if (elementNode.getAttribute('data-layer-ref') !== expectedRefName) {
        throw new TypeError(`Element ref hydration mismatch at ${nodeIdentifier}.`);

    }

    const cleanupHandlers = [];

    if (planData.regionName !== null && planData.regionName !== undefined) {
        cleanupHandlers.push(serverRegionConnect(
            elementNode,
            String(planData.regionName),
            domContext,
            true
        ));

    }

    //Verifying compiler-owned static attributes before connecting bindings.
    for (const attributeData of /** @type {Record<string, unknown>[]} */ (planData.attributes)) {
        const attributeName = String(attributeData.name);
        const expectedValue = layerAttributeValueNormalize(attributeName, attributeData.value);

        if (elementNode.getAttribute(attributeName) !== expectedValue) {
            throw new TypeError(`Static attribute hydration mismatch at ${nodeIdentifier}.`);

        }

    }

    for (const bindingData of /** @type {Record<string, unknown>[]} */ (planData.attributeBindings)) {
        cleanupHandlers.push(attributeBindingConnect(elementNode, bindingData, renderScope, domContext));

    }

    for (const bindingData of /** @type {Record<string, unknown>[]} */ (planData.eventBindings)) {
        cleanupHandlers.push(eventBindingConnect(elementNode, bindingData, renderScope, domContext));

    }

    for (const bindingData of /** @type {Record<string, unknown>[]} */ (planData.modelBindings ?? [])) {
        cleanupHandlers.push(modelBindingConnect(elementNode, bindingData, renderScope, domContext));

    }

    if (expectedRefName !== null) {
        cleanupHandlers.push(templateRefConnect(elementNode, expectedRefName, domContext));

    }

    if (typeof planData.refBinding === 'object' && planData.refBinding !== null) {
        cleanupHandlers.push(dynamicTemplateRefConnect(
            elementNode,
            /** @type {Record<string, unknown>} */ (planData.refBinding),
            renderScope,
            domContext
        ));

    }

    let childNode = /** @type {Node | null} */ (elementNode.firstChild);
    const modelBindings = /** @type {unknown[]} */ (planData.modelBindings ?? []);

    //Textarea text is an SSR representation of its model-owned value, not a child binding.
    if (planData.tag === 'textarea' && modelBindings.length > 0) {
        childNode = null;

    }

    for (const childPlan of /** @type {Record<string, unknown>[]} */ (planData.children)) {
        const scopedChildPlan = {
            ...childPlan,
            scopeId: planData.scopeId
        };
        const childHydration = planHydrate(scopedChildPlan, childNode, renderScope, domContext);

        cleanupHandlers.push(childHydration.instance.dispose);
        childNode = childHydration.nextNode;

    }

    if (childNode !== null) {
        throw new TypeError(`Unexpected hydrated child at ${nodeIdentifier}.`);

    }

    return {
        instance: domInstanceCreate([elementNode], cleanupHandlers),
        nextNode: elementNode.nextSibling
    };

}

/**
 * @param {Record<string, unknown>} planData
 * @param {Node | null} currentNode
 * @param {Record<string, unknown>} renderScope
 * @param {LayerDomContext} domContext
 * @returns {{instance: LayerDomInstance, nextNode: Node | null}}
 */
function listPlanHydrate(planData, currentNode, renderScope, domContext) {
    const bindingIdentifier = String(planData.bindingId);
    const startMarker = /** @type {Comment | null} */ (currentNode);

    hydrationCommentAssert(startMarker, `layer-for:${bindingIdentifier}:start`);

    const collectionValue = layerExpressionEvaluate(
        /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (planData.source),
        renderScope
    );

    if (!Array.isArray(collectionValue)) {
        throw new TypeError('l-for source must resolve to an array.');

    }

    const entryMap = new Map();
    let nextNode = /** @type {Node | null} */ (startMarker.nextSibling);

    //Matching each SSR entry by its stable key and binding its existing element.
    for (let itemIndex = 0; itemIndex < collectionValue.length; itemIndex += 1) {
        let indexName = null;

        //Normalizing the optional index local before matching this SSR entry.
        if (planData.indexName !== null) {
            indexName = String(planData.indexName);

        }

        const plainScope = layerListScopeCreate(
            renderScope,
            String(planData.itemName),
            indexName,
            collectionValue[itemIndex],
            itemIndex
        );
        const normalizedKey = layerListKeyNormalize(layerExpressionEvaluate(
            /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (planData.key),
            plainScope
        ));

        let hydratedKeyMatches = false;

        //Checking the current SSR element key without reading a non-element node.
        if (nextNode !== null && nextNode.nodeType === 1) {
            hydratedKeyMatches = /** @type {Element} */ (nextNode).getAttribute('data-layer-key') === normalizedKey;

        }

        if (entryMap.has(normalizedKey) || !hydratedKeyMatches) {
            throw new TypeError(`Keyed list hydration mismatch at ${normalizedKey}.`);

        }

        const itemSignal = signal(collectionValue[itemIndex]);
        const indexSignal = signal(itemIndex);
        const itemScope = layerListScopeCreate(
            renderScope,
            String(planData.itemName),
            indexName,
            itemSignal,
            indexSignal
        );
        const itemPlan = {
            .../** @type {Record<string, unknown>} */ (planData.template),
            scopeId: planData.scopeId
        };
        const itemHydration = planHydrate(itemPlan, nextNode, itemScope, domContext);

        entryMap.set(normalizedKey, {
            key: normalizedKey,
            itemSignal,
            indexSignal,
            instance: itemHydration.instance
        });
        nextNode = itemHydration.nextNode;

    }

    const endMarker = /** @type {Comment | null} */ (nextNode);

    hydrationCommentAssert(endMarker, `layer-for:${bindingIdentifier}:end`);

    const bindingDispose = layerBindingObserve(function hydratedListBindingUpdate() {
        //Reconciling later list values against the hydrated keyed entries.
        const nextCollection = layerExpressionEvaluate(
            /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (planData.source),
            renderScope
        );

        if (!Array.isArray(nextCollection)) {
            throw new TypeError('l-for source must resolve to an array.');

        }

        const nextEntryMap = new Map();
        const nextEntries = [];

        for (let itemIndex = 0; itemIndex < nextCollection.length; itemIndex += 1) {
            let indexName = null;

            //Normalizing the optional index local before reconciling this entry.
            if (planData.indexName !== null) {
                indexName = String(planData.indexName);

            }

            const plainScope = layerListScopeCreate(
                renderScope,
                String(planData.itemName),
                indexName,
                nextCollection[itemIndex],
                itemIndex
            );
            const normalizedKey = layerListKeyNormalize(layerExpressionEvaluate(
                /** @type {import('@solcorp/layer-compiler/expression').LayerExpressionNode} */ (planData.key),
                plainScope
            ));

            if (nextEntryMap.has(normalizedKey)) {
                throw new TypeError(`Duplicate l-key value: ${normalizedKey}.`);

            }

            let entryData = entryMap.get(normalizedKey);

            if (entryData === undefined) {
                const itemSignal = signal(nextCollection[itemIndex]);
                const indexSignal = signal(itemIndex);
                const itemScope = layerListScopeCreate(
                    renderScope,
                    String(planData.itemName),
                    indexName,
                    itemSignal,
                    indexSignal
                );
                const itemPlan = {
                    .../** @type {Record<string, unknown>} */ (planData.template),
                    scopeId: planData.scopeId
                };
                const itemInstance = planMount(
                    itemPlan,
                    /** @type {ParentNode & Node} */ (endMarker.parentNode),
                    endMarker,
                    itemScope,
                    domContext,
                    {
                        listKey: normalizedKey
                    }
                );

                entryData = {
                    key: normalizedKey,
                    itemSignal,
                    indexSignal,
                    instance: itemInstance
                };

            } else {
                entryData.itemSignal.set(nextCollection[itemIndex]);
                entryData.indexSignal.set(itemIndex);

            }

            nextEntryMap.set(normalizedKey, entryData);
            nextEntries.push(entryData);

        }

        //Removing hydrated entries that disappeared from the next collection.
        for (const [entryKey, entryData] of entryMap.entries()) {
            if (!nextEntryMap.has(entryKey)) {
                domInstanceRemove(entryData.instance, domContext, bindingIdentifier, null);

            }

        }

        let cursorNode = /** @type {Node} */ (endMarker);

        //Reordering existing entry elements only when their key order changed.
        for (let entryIndex = nextEntries.length - 1; entryIndex >= 0; entryIndex -= 1) {
            const entryData = nextEntries[entryIndex];
            const entryNodes = entryData.instance.nodes;
            const lastEntryNode = entryNodes[entryNodes.length - 1];

            if (lastEntryNode?.nextSibling !== cursorNode) {
                for (let nodeIndex = entryNodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
                    endMarker.parentNode?.insertBefore(entryNodes[nodeIndex], cursorNode);

                }

                domContext.diagnostics.mutationRecord('move', bindingIdentifier, null);

            }

            cursorNode = entryNodes[0] ?? cursorNode;

        }

        entryMap.clear();

        for (const [entryKey, entryData] of nextEntryMap.entries()) {
            entryMap.set(entryKey, entryData);

        }

    });
    const listDispose = function hydratedListDispose() {
        //Disposing the hydrated list and every surviving keyed entry.
        bindingDispose();

        for (const entryData of entryMap.values()) {
            entryData.instance.dispose();

        }

        entryMap.clear();

    };

    cleanupHandlerRegister(listDispose, domContext);

    return {
        instance: domInstanceCreate([
            startMarker,
            endMarker
        ], [listDispose]),
        nextNode: endMarker.nextSibling
    };

}

/**
 * @param {Element | DocumentFragment} rootNode
 * @param {ReturnType<typeof layerRenderDiagnosticsCreate>} diagnostics
 */
function rootChildrenRemove(rootNode, diagnostics) {
    //Removing every current child as one controlled component-boundary recovery.
    while (rootNode.firstChild !== null) {
        rootNode.removeChild(rootNode.firstChild);
        diagnostics.mutationRecord('remove', null, null);

    }

}

/**
 * @param {{scopeId: string, template: Record<string, unknown>[]}} componentData
 * @param {Element | DocumentFragment} rootNode
 * @param {Record<string, unknown>} renderScope
 * @param {{diagnostics?: ReturnType<typeof layerRenderDiagnosticsCreate>}} [renderOptions]
 */
export function layerComponentMount(componentData, rootNode, renderScope, renderOptions = {}) {
    //Requiring an empty owner boundary for the first client-side render.
    if (rootNode.firstChild !== null) {
        throw new TypeError('A CSR mount root must be empty.');

    }

    const diagnostics = renderOptions.diagnostics ?? layerRenderDiagnosticsCreate();
    const documentData = rootNode.ownerDocument ?? /** @type {Document} */ (/** @type {unknown} */ (rootNode));
    const domContext = /** @type {LayerDomContext} */ ({
        diagnostics,
        document: documentData,
        cleanupHandlers: [],
        refs: new Map(),
        regions: new Map()
    });
    const refs = templateRefsViewCreate(domContext.refs);
    const regions = layerRegionCollectionCreate(domContext.regions, diagnostics);
    const rootInstances = /** @type {LayerDomInstance[]} */ ([]);

    //Mounting compiler plans directly through DOM APIs without innerHTML.
    for (const planData of componentData.template) {
        const scopedPlan = {
            ...planData,
            scopeId: componentData.scopeId
        };

        rootInstances.push(planMount(scopedPlan, rootNode, null, renderScope, domContext));

    }

    let disposedStatus = false;

    return Object.freeze({
        recovered: false,
        diagnostics,
        refs,
        regions,
        dispose() {
            //Disconnecting bindings before removing the owned component boundary.
            if (disposedStatus) {
                return;

            }

            disposedStatus = true;

            for (const rootInstance of rootInstances) {
                rootInstance.dispose();

            }

            rootChildrenRemove(rootNode, diagnostics);

        }
    });

}

/**
 * @param {{scopeId: string, template: Record<string, unknown>[]}} componentData
 * @param {Element | DocumentFragment} rootNode
 * @param {Record<string, unknown>} renderScope
 * @param {{diagnostics?: ReturnType<typeof layerRenderDiagnosticsCreate>}} [renderOptions]
 */
export function layerComponentHydrate(componentData, rootNode, renderScope, renderOptions = {}) {
    const diagnostics = renderOptions.diagnostics ?? layerRenderDiagnosticsCreate();
    const documentData = rootNode.ownerDocument ?? /** @type {Document} */ (/** @type {unknown} */ (rootNode));
    const domContext = /** @type {LayerDomContext} */ ({
        diagnostics,
        document: documentData,
        cleanupHandlers: [],
        refs: new Map(),
        regions: new Map()
    });
    const refs = templateRefsViewCreate(domContext.refs);
    const regions = layerRegionCollectionCreate(domContext.regions, diagnostics);
    const rootInstances = /** @type {LayerDomInstance[]} */ ([]);
    let currentNode = /** @type {Node | null} */ (rootNode.firstChild);
    let recoveredStatus = false;

    try {
        //Connecting the compiled plan to matching SSR nodes without recreating them.
        for (const planData of componentData.template) {
            const scopedPlan = {
                ...planData,
                scopeId: componentData.scopeId
            };
            const hydrationResult = planHydrate(scopedPlan, currentNode, renderScope, domContext);

            rootInstances.push(hydrationResult.instance);
            currentNode = hydrationResult.nextNode;

        }

        if (currentNode !== null) {
            throw new TypeError('Unexpected nodes remain after component hydration.');

        }

    } catch (hydrationError) {
        //Disconnecting any partially connected observers before local recovery.
        for (let cleanupIndex = domContext.cleanupHandlers.length - 1; cleanupIndex >= 0; cleanupIndex -= 1) {
            domContext.cleanupHandlers[cleanupIndex]?.();

        }

        diagnostics.mismatchRecord();
        rootChildrenRemove(rootNode, diagnostics);
        rootInstances.length = 0;
        domContext.cleanupHandlers.length = 0;

        for (const planData of componentData.template) {
            const scopedPlan = {
                ...planData,
                scopeId: componentData.scopeId
            };

            rootInstances.push(planMount(scopedPlan, rootNode, null, renderScope, domContext));

        }

        recoveredStatus = true;
        void hydrationError;

    }

    let disposedStatus = false;

    return Object.freeze({
        recovered: recoveredStatus,
        diagnostics,
        refs,
        regions,
        dispose() {
            //Disconnecting hydrated bindings and removing the component boundary.
            if (disposedStatus) {
                return;

            }

            disposedStatus = true;

            for (const rootInstance of rootInstances) {
                rootInstance.dispose();

            }

            rootChildrenRemove(rootNode, diagnostics);

        }
    });

}
