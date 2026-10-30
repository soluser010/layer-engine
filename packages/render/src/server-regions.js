import {layerAttributeValueNormalize} from './render-values.js';

const blockedElementSet = new Set([
    'base',
    'embed',
    'iframe',
    'link',
    'meta',
    'object',
    'script',
    'style',
    'template'
]);
const blockedAttributeSet = new Set([
    'innerhtml',
    'srcdoc',
    'style'
]);
const regionNamePattern = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
const elementNamePattern = /^[a-z][a-z0-9-]{0,39}$/;
const attributeNamePattern = /^[A-Za-z_][A-Za-z0-9_.:-]{0,79}$/;

/**
 * @typedef {{element: Element, revision: number}} LayerRegionState
 * @typedef {{mutationRecord: (mutationType: string, bindingId?: string | null, nodeId?: string | null) => void}} LayerRegionDiagnostics
 */

/**
 * @param {unknown} inputData
 * @returns {inputData is Record<string, unknown>}
 */
function plainRecordCheck(inputData) {
    //Accepting JSON-shaped records without inherited protocol fields.
    return typeof inputData === 'object' && inputData !== null && !Array.isArray(inputData) &&
        (Object.getPrototypeOf(inputData) === Object.prototype || Object.getPrototypeOf(inputData) === null);

}

/**
 * @param {Record<string, unknown>} inputData
 * @param {string[]} allowedKeys
 */
function recordKeysCheck(inputData, allowedKeys) {
    const allowedKeySet = new Set(allowedKeys);

    //Rejecting undeclared patch fields before any DOM mutation is attempted.
    if (Object.keys(inputData).some(function unknownKeyFind(inputKey) {
        //Comparing every enumerable protocol field with the operation allowlist.
        return !allowedKeySet.has(inputKey);

    })) {
        throw new TypeError('A view patch contains an unknown field.');

    }

}

/**
 * @param {unknown} pathData
 * @returns {number[]}
 */
function elementPathValidate(pathData) {
    if (!Array.isArray(pathData) || pathData.length > 32 || pathData.some(function pathIndexInvalid(pathIndex) {
        //Keeping traversal bounded to non-negative element indexes.
        return !Number.isSafeInteger(pathIndex) || pathIndex < 0 || pathIndex > 10_000;

    })) {
        throw new TypeError('A view patch element path is invalid.');

    }

    return pathData;

}

/**
 * @param {Element} regionElement
 * @param {number[]} elementPath
 */
function regionTargetResolve(regionElement, elementPath) {
    let targetElement = regionElement;

    //Resolving paths against element children so whitespace text cannot change addressing.
    for (const childIndex of elementPath) {
        const childElement = targetElement.children.item(childIndex);

        if (childElement === null) {
            throw new TypeError('A view patch element path does not exist.');

        }

        targetElement = childElement;

    }

    return targetElement;

}

/**
 * @param {unknown} attributeName
 * @returns {string}
 */
function patchAttributeNameValidate(attributeName) {
    //Requiring a bounded HTML-compatible name before applying security policy.
    if (typeof attributeName !== 'string' || !attributeNamePattern.test(attributeName)) {
        throw new TypeError('A view patch attribute name is invalid.');

    }

    const normalizedName = attributeName.toLowerCase();

    if (normalizedName.startsWith('on') || normalizedName.startsWith('data-layer-') ||
        blockedAttributeSet.has(normalizedName)) {
        throw new TypeError('A view patch attribute is not allowed.');

    }

    return attributeName;

}

/**
 * @param {unknown} nodeData
 * @param {{count: number}} nodeBudget
 * @param {number} nodeDepth
 */
function viewNodeValidate(nodeData, nodeBudget, nodeDepth) {
    if (!plainRecordCheck(nodeData) || nodeDepth > 16) {
        throw new TypeError('A view patch node is invalid.');

    }

    nodeBudget.count += 1;

    if (nodeBudget.count > 500) {
        throw new TypeError('A view patch exceeds its node budget.');

    }

    if (nodeData.type === 'text') {
        recordKeysCheck(nodeData, ['type', 'value']);

        if (typeof nodeData.value !== 'string' || nodeData.value.length > 65_536) {
            throw new TypeError('A view patch text node is invalid.');

        }

        return;

    }

    if (nodeData.type !== 'element') {
        throw new TypeError('A view patch node type is invalid.');

    }

    recordKeysCheck(nodeData, ['type', 'tag', 'attributes', 'children']);

    if (typeof nodeData.tag !== 'string' || !elementNamePattern.test(nodeData.tag) ||
        blockedElementSet.has(nodeData.tag)) {
        throw new TypeError('A view patch element name is not allowed.');

    }

    const attributeData = nodeData.attributes ?? {};

    if (!plainRecordCheck(attributeData) || Object.keys(attributeData).length > 50) {
        throw new TypeError('A view patch attribute collection is invalid.');

    }

    for (const [attributeName, attributeValue] of Object.entries(attributeData)) {
        patchAttributeNameValidate(attributeName);

        if (attributeValue !== null && typeof attributeValue !== 'string' &&
            typeof attributeValue !== 'number' && typeof attributeValue !== 'boolean') {
            throw new TypeError('A view patch attribute value is invalid.');

        }

    }

    const childNodes = nodeData.children ?? [];

    if (!Array.isArray(childNodes) || childNodes.length > 100) {
        throw new TypeError('A view patch child collection is invalid.');

    }

    //Validating the complete structured subtree before creating any live DOM node.
    for (const childNode of childNodes) {
        viewNodeValidate(childNode, nodeBudget, nodeDepth + 1);

    }

}

/**
 * @param {Document} documentData
 * @param {Record<string, unknown>} nodeData
 * @returns {Node}
 */
function viewNodeCreate(documentData, nodeData) {
    if (nodeData.type === 'text') {
        return documentData.createTextNode(String(nodeData.value));

    }

    const elementNode = documentData.createElement(String(nodeData.tag));
    const attributeData = /** @type {Record<string, unknown>} */ (nodeData.attributes ?? {});

    //Applying only normalized attributes to the detached structured node.
    for (const [attributeName, attributeValue] of Object.entries(attributeData)) {
        const normalizedValue = layerAttributeValueNormalize(attributeName, attributeValue);

        if (normalizedValue !== null) {
            elementNode.setAttribute(attributeName, normalizedValue);

        }

    }

    for (const childData of /** @type {Record<string, unknown>[]} */ (nodeData.children ?? [])) {
        elementNode.appendChild(viewNodeCreate(documentData, childData));

    }

    return elementNode;

}

/**
 * @param {Element} regionElement
 * @param {Record<string, unknown>} operationData
 * @param {LayerRegionDiagnostics | null} diagnostics
 */
function patchOperationApply(regionElement, operationData, diagnostics) {
    const operationType = operationData.type;

    if (operationType === 'text.set') {
        recordKeysCheck(operationData, ['type', 'path', 'value']);
        const targetElement = regionTargetResolve(regionElement, elementPathValidate(operationData.path));

        if (typeof operationData.value !== 'string' || operationData.value.length > 65_536) {
            throw new TypeError('A view patch text value is invalid.');

        }

        targetElement.textContent = operationData.value;
        diagnostics?.mutationRecord('text', null, targetElement.getAttribute('data-layer-node'));

        return;

    }

    if (operationType === 'attribute.set' || operationType === 'attribute.remove') {
        let allowedKeys = ['type', 'path', 'name'];

        //Allowing a value field only for the attribute.set operation.
        if (operationType === 'attribute.set') {
            allowedKeys = ['type', 'path', 'name', 'value'];

        }

        recordKeysCheck(operationData, allowedKeys);
        const elementPath = elementPathValidate(operationData.path);

        if (elementPath.length === 0) {
            throw new TypeError('A view patch cannot change attributes on the region boundary.');

        }

        const targetElement = regionTargetResolve(regionElement, elementPath);
        const attributeName = patchAttributeNameValidate(operationData.name);

        if (operationType === 'attribute.remove') {
            targetElement.removeAttribute(attributeName);

        } else {
            const attributeValue = operationData.value;

            if (attributeValue !== null && typeof attributeValue !== 'string' &&
                typeof attributeValue !== 'number' && typeof attributeValue !== 'boolean') {
                throw new TypeError('A view patch attribute value is invalid.');

            }

            const normalizedValue = layerAttributeValueNormalize(attributeName, attributeValue);

            if (normalizedValue === null) {
                targetElement.removeAttribute(attributeName);

            } else {
                targetElement.setAttribute(attributeName, normalizedValue);

            }

        }

        diagnostics?.mutationRecord('attribute', null, targetElement.getAttribute('data-layer-node'));

        return;

    }

    if (operationType === 'children.replace') {
        recordKeysCheck(operationData, ['type', 'path', 'nodes']);
        const targetElement = regionTargetResolve(regionElement, elementPathValidate(operationData.path));
        const childNodes = operationData.nodes;

        if (!Array.isArray(childNodes) || childNodes.length > 100) {
            throw new TypeError('A view patch replacement collection is invalid.');

        }

        const nodeBudget = {count: 0};

        for (const childNode of childNodes) {
            viewNodeValidate(childNode, nodeBudget, 0);

        }

        const fragmentNode = targetElement.ownerDocument.createDocumentFragment();

        for (const childNode of /** @type {Record<string, unknown>[]} */ (childNodes)) {
            fragmentNode.appendChild(viewNodeCreate(targetElement.ownerDocument, childNode));

        }

        const removedCount = targetElement.childNodes.length;

        targetElement.replaceChildren(fragmentNode);

        if (removedCount > 0) {
            diagnostics?.mutationRecord('remove', null, targetElement.getAttribute('data-layer-node'));

        }

        if (childNodes.length > 0) {
            diagnostics?.mutationRecord('create', null, targetElement.getAttribute('data-layer-node'));

        }

        return;

    }

    throw new TypeError('A view patch operation type is invalid.');

}

/**
 * @param {Map<string, LayerRegionState>} regionMap
 * @param {LayerRegionDiagnostics} diagnostics
 */
export function layerRegionCollectionCreate(regionMap, diagnostics) {
    return Object.freeze({
        /** @param {string} regionName */
        has(regionName) {
            //Reporting declared live regions without exposing their DOM elements.
            return regionMap.has(regionName);

        },
        list() {
            //Returning a stable inspection snapshot sorted by public region name.
            return Object.freeze([...regionMap.entries()]
                .sort(function regionEntrySort(leftEntry, rightEntry) {
                    //Keeping inspection order independent from mount traversal details.
                    return leftEntry[0].localeCompare(rightEntry[0]);

                })
                .map(function regionEntryMap([regionName, regionState]) {
                    //Projecting only public identity and revision metadata.
                    return Object.freeze({
                        name: regionName,
                        revision: regionState.revision
                    });

                }));

        },
        /** @param {string} regionName */
        revision(regionName) {
            //Resolving the current revision without exposing the mutable region state.
            const regionState = regionMap.get(regionName);

            if (regionState === undefined) {
                throw new TypeError(`Unknown server-driven region: ${regionName}.`);

            }

            return regionState.revision;

        },
        /** @param {unknown} patchData */
        apply(patchData) {
            if (!plainRecordCheck(patchData)) {
                throw new TypeError('A view patch envelope is invalid.');

            }

            recordKeysCheck(patchData, ['region', 'baseRevision', 'revision', 'operations']);

            if (typeof patchData.region !== 'string' || !regionNamePattern.test(patchData.region)) {
                throw new TypeError('A view patch region name is invalid.');

            }

            if (!Number.isSafeInteger(patchData.baseRevision) || Number(patchData.baseRevision) < 0 ||
                !Number.isSafeInteger(patchData.revision) || Number(patchData.revision) <= Number(patchData.baseRevision)) {
                throw new TypeError('A view patch revision is invalid.');

            }

            if (!Array.isArray(patchData.operations) || patchData.operations.length === 0 ||
                patchData.operations.length > 100) {
                throw new TypeError('A view patch operation collection is invalid.');

            }

            const regionState = regionMap.get(patchData.region);

            if (regionState === undefined) {
                throw new TypeError(`Unknown server-driven region: ${patchData.region}.`);

            }

            if (regionState.revision !== patchData.baseRevision) {
                throw new TypeError('A view patch base revision conflicts with the current region.');

            }

            const simulationElement = /** @type {Element} */ (regionState.element.cloneNode(true));

            //Simulating the complete ordered patch before mutating the live region.
            for (const operationData of patchData.operations) {
                if (!plainRecordCheck(operationData)) {
                    throw new TypeError('A view patch operation is invalid.');

                }

                patchOperationApply(simulationElement, operationData, null);

            }

            for (const operationData of /** @type {Record<string, unknown>[]} */ (patchData.operations)) {
                patchOperationApply(regionState.element, operationData, diagnostics);

            }

            regionState.revision = Number(patchData.revision);
            regionState.element.setAttribute('data-layer-region-revision', String(regionState.revision));

            return Object.freeze({
                operationCount: patchData.operations.length,
                region: patchData.region,
                revision: regionState.revision
            });

        }
    });

}
