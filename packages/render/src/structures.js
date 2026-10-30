import {LAYER_SIGNAL_READ} from '@solcorp/layer-compiler/expression';

const whenStateMap = new WeakMap();
const repeatStateMap = new WeakMap();

/**
 * @typedef {Readonly<{strings: readonly string[], values: readonly unknown[]}>} LayerTemplateResult
 * @typedef {(templateResult: unknown) => boolean} LayerTemplateResultCheck
 * @typedef {Readonly<{condition: unknown, render: (branchStatus: boolean) => LayerTemplateResult | null}>} LayerWhenValueState
 * @typedef {Readonly<{collection: unknown, key: (itemValue: unknown, itemIndex: number) => unknown, render: (itemValue: unknown, itemIndex: number) => LayerTemplateResult}>} LayerRepeatValueState
 */

/**
 * @param {unknown} inputValue
 * @returns {unknown}
 */
export function layerReactiveValueRead(inputValue) {
    if (typeof inputValue === 'object' && inputValue !== null) {
        const signalReader = /** @type {Record<symbol, unknown>} */ (inputValue)[LAYER_SIGNAL_READ];

        if (typeof signalReader === 'function') {
            //Reading through the shared signal protocol while the structural observer is active.
            return signalReader.call(inputValue);

        }

    }

    return inputValue;

}

/**
 * @param {unknown} templateResult
 * @param {LayerTemplateResultCheck} templateResultCheck
 * @param {string} structureName
 * @returns {LayerTemplateResult}
 */
function structuralTemplateResultAssert(templateResult, templateResultCheck, structureName) {
    if (!templateResultCheck(templateResult)) {
        throw new TypeError(`${structureName} renderer must return an html tagged template.`);

    }

    return /** @type {LayerTemplateResult} */ (templateResult);

}

/**
 * @param {unknown} conditionValue
 * @param {() => unknown} truthyRenderer
 * @param {(() => unknown) | null} falsyRenderer
 * @param {LayerTemplateResultCheck} templateResultCheck
 */
export function layerWhenValueCreate(conditionValue, truthyRenderer, falsyRenderer, templateResultCheck) {
    const descriptorData = Object.freeze({});

    whenStateMap.set(descriptorData, Object.freeze({
        condition: conditionValue,
        /** @param {boolean} branchStatus */
        render(branchStatus) {
            let branchRenderer = falsyRenderer;

            //Selecting the true renderer only for the active conditional branch.
            if (branchStatus) {
                branchRenderer = truthyRenderer;

            }

            if (branchRenderer === null) {
                return null;

            }

            //Validating every lazily-created branch template before it reaches the DOM renderer.
            return structuralTemplateResultAssert(
                branchRenderer(),
                templateResultCheck,
                'when'
            );

        }
    }));

    return descriptorData;

}

/**
 * @param {unknown} descriptorData
 * @returns {LayerWhenValueState}
 */
export function layerWhenValueResolve(descriptorData) {
    if (typeof descriptorData !== 'object' || descriptorData === null || !whenStateMap.has(descriptorData)) {
        throw new TypeError('A when binding requires the descriptor created by @solcorp/layer.');

    }

    //Returning only state owned by this exact descriptor identity.
    return /** @type {LayerWhenValueState} */ (whenStateMap.get(descriptorData));

}

/**
 * @param {unknown} collectionValue
 * @param {(itemValue: unknown, itemIndex: number) => unknown} keySelector
 * @param {(itemValue: unknown, itemIndex: number) => unknown} itemRenderer
 * @param {LayerTemplateResultCheck} templateResultCheck
 */
export function layerRepeatValueCreate(collectionValue, keySelector, itemRenderer, templateResultCheck) {
    const descriptorData = Object.freeze({});

    repeatStateMap.set(descriptorData, Object.freeze({
        collection: collectionValue,
        /** @param {unknown} itemValue @param {number} itemIndex */
        key(itemValue, itemIndex) {
            //Delegating stable identity to the author selector without changing the value.
            return keySelector(itemValue, itemIndex);

        },
        /** @param {unknown} itemValue @param {number} itemIndex */
        render(itemValue, itemIndex) {
            //Checking each item result because list callbacks execute lazily during reconciliation.
            return structuralTemplateResultAssert(
                itemRenderer(itemValue, itemIndex),
                templateResultCheck,
                'repeat'
            );

        }
    }));

    return descriptorData;

}

/**
 * @param {unknown} descriptorData
 * @returns {LayerRepeatValueState}
 */
export function layerRepeatValueResolve(descriptorData) {
    if (typeof descriptorData !== 'object' || descriptorData === null || !repeatStateMap.has(descriptorData)) {
        throw new TypeError('A repeat binding requires the descriptor created by @solcorp/layer.');

    }

    //Returning only state owned by this exact descriptor identity.
    return /** @type {LayerRepeatValueState} */ (repeatStateMap.get(descriptorData));

}
