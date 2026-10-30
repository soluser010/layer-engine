import {
    parse,
    parseExpressionAt
} from 'acorn';
import {LayerCompilerError} from './compiler-error.js';

export const LAYER_SIGNAL_READ = Symbol.for('solcorp.layer.signal.read');

const blockedIdentifierSet = new Set([
    'Function',
    'document',
    'eval',
    'globalThis',
    'process',
    'window'
]);
const blockedPropertySet = new Set([
    '__proto__',
    'constructor',
    'prototype'
]);
const allowedUnaryOperatorSet = new Set([
    '!',
    '+',
    '-'
]);
const allowedBinaryOperatorSet = new Set([
    '===',
    '!==',
    '<',
    '<=',
    '>',
    '>=',
    '+',
    '-',
    '*',
    '/',
    '%'
]);
const allowedLogicalOperatorSet = new Set([
    '&&',
    '||',
    '??'
]);

/**
 * @typedef {object} LayerExpressionNode
 * @property {string} type
 * @property {unknown} [value]
 * @property {string} [name]
 * @property {string} [operator]
 * @property {boolean} [computed]
 * @property {boolean} [optional]
 * @property {LayerExpressionNode} [object]
 * @property {LayerExpressionNode} [property]
 * @property {LayerExpressionNode} [argument]
 * @property {LayerExpressionNode} [left]
 * @property {LayerExpressionNode} [right]
 * @property {LayerExpressionNode} [test]
 * @property {LayerExpressionNode} [consequent]
 * @property {LayerExpressionNode} [alternate]
 * @property {LayerExpressionNode} [callee]
 * @property {LayerExpressionNode} [expression]
 * @property {LayerExpressionNode[]} [arguments]
 * @property {(LayerExpressionNode | null)[]} [elements]
 * @property {{type: string, key: LayerExpressionNode, value: LayerExpressionNode, computed: boolean, kind: string, method: boolean, shorthand: boolean}[]} [properties]
 * @property {number} [start]
 * @property {number} [end]
 */

/**
 * @param {string} message
 * @returns {never}
 */
function expressionReject(message) {
    //Stopping compilation with one stable expression diagnostic.
    throw new LayerCompilerError('LAYER_EXPRESSION_INVALID', message);

}

/**
 * @param {LayerExpressionNode | undefined} expressionNode
 */
function expressionNodeValidate(expressionNode) {
    //Rejecting absent parser nodes before checking their supported form.
    if (expressionNode === undefined) {
        expressionReject('The expression contains an incomplete node.');

    }

    switch (expressionNode.type) {
        case 'Literal':
            if (typeof expressionNode.value === 'object' && expressionNode.value !== null) {
                expressionReject('Regular expressions and other object literals are not supported.');

            }

            return;

        case 'Identifier':
            if (expressionNode.name === undefined || blockedIdentifierSet.has(expressionNode.name)) {
                expressionReject('The expression references a blocked identifier.');

            }

            return;

        case 'UnaryExpression':
            if (expressionNode.operator === undefined || !allowedUnaryOperatorSet.has(expressionNode.operator)) {
                expressionReject('The expression uses an unsupported unary operator.');

            }

            expressionNodeValidate(expressionNode.argument);

            return;

        case 'BinaryExpression':
            if (expressionNode.operator === undefined || !allowedBinaryOperatorSet.has(expressionNode.operator)) {
                expressionReject('The expression uses an unsupported binary operator.');

            }

            expressionNodeValidate(expressionNode.left);
            expressionNodeValidate(expressionNode.right);

            return;

        case 'LogicalExpression':
            if (expressionNode.operator === undefined || !allowedLogicalOperatorSet.has(expressionNode.operator)) {
                expressionReject('The expression uses an unsupported logical operator.');

            }

            expressionNodeValidate(expressionNode.left);
            expressionNodeValidate(expressionNode.right);

            return;

        case 'ConditionalExpression':
            expressionNodeValidate(expressionNode.test);
            expressionNodeValidate(expressionNode.consequent);
            expressionNodeValidate(expressionNode.alternate);

            return;

        case 'MemberExpression':
            expressionNodeValidate(expressionNode.object);
            expressionNodeValidate(expressionNode.property);

            if (!expressionNode.computed && expressionNode.property?.name !== undefined &&
                blockedPropertySet.has(expressionNode.property.name)) {
                expressionReject('The expression references a blocked property.');

            }

            return;

        case 'CallExpression':
            expressionNodeValidate(expressionNode.callee);

            for (const argumentNode of expressionNode.arguments ?? []) {
                expressionNodeValidate(argumentNode);

            }

            return;

        case 'ArrayExpression':
            for (const elementNode of expressionNode.elements ?? []) {
                if (elementNode !== null) {
                    expressionNodeValidate(elementNode);

                }

            }

            return;

        case 'ObjectExpression':
            for (const propertyData of expressionNode.properties ?? []) {
                if (propertyData.type !== 'Property' || propertyData.kind !== 'init' || propertyData.method) {
                    expressionReject('The expression contains an unsupported object property.');

                }

                if (propertyData.computed) {
                    expressionNodeValidate(propertyData.key);

                } else if (propertyData.key.name !== undefined && blockedPropertySet.has(propertyData.key.name)) {
                    expressionReject('The expression creates a blocked property.');

                }

                expressionNodeValidate(propertyData.value);

            }

            return;

        case 'ChainExpression':
            expressionNodeValidate(expressionNode.expression);

            return;

        default:
            expressionReject(`The expression node ${expressionNode.type} is not supported.`);

    }

}

/**
 * @param {string} expressionSource
 * @returns {LayerExpressionNode}
 */
export function layerExpressionCompile(expressionSource) {
    const normalizedSource = expressionSource.trim();

    //Rejecting empty bindings before invoking the JavaScript parser.
    if (normalizedSource.length === 0) {
        expressionReject('A template expression cannot be empty.');

    }

    let expressionNode;

    try {
        //Parsing one expression without evaluating developer-controlled source.
        expressionNode = /** @type {LayerExpressionNode} */ (parseExpressionAt(normalizedSource, 0, {
            ecmaVersion: 'latest'
        }));

    } catch (expressionError) {
        throw new LayerCompilerError(
            'LAYER_EXPRESSION_INVALID',
            'The template expression is not valid JavaScript.',
            {
                cause: expressionError
            }
        );

    }

    //Rejecting trailing statements or a second expression.
    if (expressionNode.end !== normalizedSource.length) {
        expressionReject('A template binding must contain exactly one expression.');

    }

    expressionNodeValidate(expressionNode);

    return expressionNode;

}

/**
 * @param {string} scriptSource
 */
export function layerComponentScriptValidate(scriptSource) {
    let scriptProgram;

    try {
        //Parsing component code as ESM without executing the module.
        scriptProgram = /** @type {LayerExpressionNode} */ (parse(scriptSource, {
            ecmaVersion: 'latest',
            sourceType: 'module'
        }));

    } catch (scriptError) {
        throw new LayerCompilerError(
            'LAYER_SCRIPT_INVALID',
            'The component script is not valid ESM.',
            {
                cause: scriptError
            }
        );

    }

    const pendingNodes = [scriptProgram];

    //Scanning the parsed AST for explicitly prohibited dynamic execution forms.
    while (pendingNodes.length > 0) {
        const currentNode = pendingNodes.pop();

        if (currentNode === undefined) {
            continue;

        }

        if (currentNode.type === 'ImportExpression') {
            throw new LayerCompilerError('LAYER_SCRIPT_UNSAFE', 'Dynamic import is not allowed in a .layer component.');

        }

        if (currentNode.type === 'NewExpression' && currentNode.callee?.name === 'Function') {
            throw new LayerCompilerError('LAYER_SCRIPT_UNSAFE', 'The Function constructor is not allowed.');

        }

        if (currentNode.type === 'CallExpression' &&
            (currentNode.callee?.name === 'eval' || currentNode.callee?.name === 'Function')) {
            throw new LayerCompilerError('LAYER_SCRIPT_UNSAFE', 'Dynamic code execution is not allowed.');

        }

        for (const propertyValue of Object.values(currentNode)) {
            if (Array.isArray(propertyValue)) {
                for (const childNode of propertyValue) {
                    if (typeof childNode === 'object' && childNode !== null && 'type' in childNode) {
                        pendingNodes.push(/** @type {LayerExpressionNode} */ (childNode));

                    }

                }

            } else if (typeof propertyValue === 'object' && propertyValue !== null && 'type' in propertyValue) {
                pendingNodes.push(/** @type {LayerExpressionNode} */ (propertyValue));

            }

        }

    }

}

/**
 * @param {unknown} inputValue
 * @returns {unknown}
 */
function signalValueRead(inputValue) {
    //Reading signals through a shared symbol without coupling compiler to renderer.
    if (typeof inputValue === 'object' && inputValue !== null && LAYER_SIGNAL_READ in inputValue) {
        const signalReader = /** @type {Record<symbol, unknown>} */ (inputValue)[LAYER_SIGNAL_READ];

        if (typeof signalReader === 'function') {
            return signalReader.call(inputValue);

        }

    }

    return inputValue;

}

/**
 * @param {unknown} targetValue
 * @param {unknown} propertyValue
 * @returns {unknown}
 */
function propertyValueRead(targetValue, propertyValue) {
    const normalizedTarget = signalValueRead(targetValue);
    const propertyName = String(propertyValue);

    //Blocking prototype traversal at runtime even for computed property names.
    if (blockedPropertySet.has(propertyName)) {
        return undefined;

    }

    if ((typeof normalizedTarget !== 'object' || normalizedTarget === null) &&
        typeof normalizedTarget !== 'string') {
        return undefined;

    }

    const targetObject = Object(normalizedTarget);

    //Reading only own values so expressions cannot walk host prototypes.
    if (!Object.hasOwn(targetObject, propertyName)) {
        return undefined;

    }

    return signalValueRead(/** @type {Record<string, unknown>} */ (targetObject)[propertyName]);

}

/**
 * @param {unknown} assignmentTarget
 * @param {unknown} nextValue
 */
function signalValueAssign(assignmentTarget, nextValue) {
    if (typeof assignmentTarget !== 'object' || assignmentTarget === null ||
        !Object.hasOwn(assignmentTarget, 'set')) {
        return false;

    }

    const signalSetter = /** @type {Record<string, unknown>} */ (assignmentTarget).set;

    if (typeof signalSetter !== 'function') {
        return false;

    }

    //Writing through the public signal contract without exposing internal graph state.
    signalSetter.call(assignmentTarget, nextValue);

    return true;

}

/**
 * @param {LayerExpressionNode} expressionNode
 * @param {Readonly<Record<string, unknown>>} expressionScope
 * @param {unknown} nextValue
 */
export function layerExpressionAssign(expressionNode, expressionScope, nextValue) {
    if (expressionNode.type === 'Identifier') {
        if (expressionNode.name === undefined || !Object.hasOwn(expressionScope, expressionNode.name) ||
            !signalValueAssign(expressionScope[expressionNode.name], nextValue)) {
            throw new TypeError('The l-model identifier must resolve to a writable signal.');

        }

        return;

    }

    if (expressionNode.type !== 'MemberExpression' || expressionNode.optional === true) {
        throw new TypeError('The l-model expression is not assignable.');

    }

    const targetValue = layerExpressionEvaluate(
        /** @type {LayerExpressionNode} */ (expressionNode.object),
        expressionScope
    );
    let propertyValue;

    if (expressionNode.computed) {
        propertyValue = layerExpressionEvaluate(
            /** @type {LayerExpressionNode} */ (expressionNode.property),
            expressionScope
        );

    } else {
        propertyValue = expressionNode.property?.name;

    }

    const propertyName = String(propertyValue);

    if (typeof targetValue !== 'object' || targetValue === null ||
        blockedPropertySet.has(propertyName) || !Object.hasOwn(targetValue, propertyName)) {
        throw new TypeError('The l-model member must resolve to an owned writable field.');

    }

    const currentValue = /** @type {Record<string, unknown>} */ (targetValue)[propertyName];

    if (!signalValueAssign(currentValue, nextValue)) {
        //Assigning through a reactive store proxy or an explicitly mutable owned object.
        /** @type {Record<string, unknown>} */ (targetValue)[propertyName] = nextValue;

    }

}

/**
 * @param {LayerExpressionNode} expressionNode
 * @param {Readonly<Record<string, unknown>>} expressionScope
 * @returns {unknown}
 */
export function layerExpressionEvaluate(expressionNode, expressionScope) {
    switch (expressionNode.type) {
        case 'Literal':
            return expressionNode.value;

        case 'Identifier':
            if (expressionNode.name === undefined || !Object.hasOwn(expressionScope, expressionNode.name)) {
                return undefined;

            }

            return signalValueRead(expressionScope[expressionNode.name]);

        case 'UnaryExpression': {
            const argumentValue = layerExpressionEvaluate(/** @type {LayerExpressionNode} */ (expressionNode.argument), expressionScope);

            if (expressionNode.operator === '!') {
                return !argumentValue;

            }

            if (expressionNode.operator === '+') {
                return Number(argumentValue);

            }

            return -Number(argumentValue);

        }

        case 'BinaryExpression': {
            const leftValue = layerExpressionEvaluate(/** @type {LayerExpressionNode} */ (expressionNode.left), expressionScope);
            const rightValue = layerExpressionEvaluate(/** @type {LayerExpressionNode} */ (expressionNode.right), expressionScope);

            switch (expressionNode.operator) {
                case '===':
                    return leftValue === rightValue;
                case '!==':
                    return leftValue !== rightValue;
                case '<':
                    return /** @type {number | string} */ (leftValue) < /** @type {number | string} */ (rightValue);
                case '<=':
                    return /** @type {number | string} */ (leftValue) <= /** @type {number | string} */ (rightValue);
                case '>':
                    return /** @type {number | string} */ (leftValue) > /** @type {number | string} */ (rightValue);
                case '>=':
                    return /** @type {number | string} */ (leftValue) >= /** @type {number | string} */ (rightValue);
                case '+':
                    if (typeof leftValue === 'string' || typeof rightValue === 'string') {
                        return String(leftValue) + String(rightValue);

                    }

                    return Number(leftValue) + Number(rightValue);
                case '-':
                    return Number(leftValue) - Number(rightValue);
                case '*':
                    return Number(leftValue) * Number(rightValue);
                case '/':
                    return Number(leftValue) / Number(rightValue);
                default:
                    return Number(leftValue) % Number(rightValue);
            }

        }

        case 'LogicalExpression': {
            const leftValue = layerExpressionEvaluate(/** @type {LayerExpressionNode} */ (expressionNode.left), expressionScope);

            if (expressionNode.operator === '&&') {
                return leftValue && layerExpressionEvaluate(/** @type {LayerExpressionNode} */ (expressionNode.right), expressionScope);

            }

            if (expressionNode.operator === '||') {
                return leftValue || layerExpressionEvaluate(/** @type {LayerExpressionNode} */ (expressionNode.right), expressionScope);

            }

            return leftValue ?? layerExpressionEvaluate(/** @type {LayerExpressionNode} */ (expressionNode.right), expressionScope);

        }

        case 'ConditionalExpression':
            if (layerExpressionEvaluate(/** @type {LayerExpressionNode} */ (expressionNode.test), expressionScope)) {
                return layerExpressionEvaluate(/** @type {LayerExpressionNode} */ (expressionNode.consequent), expressionScope);

            }

            return layerExpressionEvaluate(/** @type {LayerExpressionNode} */ (expressionNode.alternate), expressionScope);

        case 'MemberExpression': {
            const targetValue = layerExpressionEvaluate(/** @type {LayerExpressionNode} */ (expressionNode.object), expressionScope);
            let propertyValue;

            if (expressionNode.computed) {
                propertyValue = layerExpressionEvaluate(/** @type {LayerExpressionNode} */ (expressionNode.property), expressionScope);

            } else {
                propertyValue = expressionNode.property?.name;

            }

            if (expressionNode.optional && (targetValue === null || targetValue === undefined)) {
                return undefined;

            }

            return propertyValueRead(targetValue, propertyValue);

        }

        case 'CallExpression': {
            let callableValue;
            let thisValue;

            if (expressionNode.callee?.type === 'MemberExpression') {
                thisValue = layerExpressionEvaluate(/** @type {LayerExpressionNode} */ (expressionNode.callee.object), expressionScope);
                let propertyValue;

                if (expressionNode.callee.computed) {
                    propertyValue = layerExpressionEvaluate(
                        /** @type {LayerExpressionNode} */ (expressionNode.callee.property),
                        expressionScope
                    );

                } else {
                    propertyValue = expressionNode.callee.property?.name;

                }

                callableValue = propertyValueRead(thisValue, propertyValue);

            } else {
                callableValue = layerExpressionEvaluate(/** @type {LayerExpressionNode} */ (expressionNode.callee), expressionScope);

            }

            if (expressionNode.optional && (callableValue === null || callableValue === undefined)) {
                return undefined;

            }

            if (typeof callableValue !== 'function') {
                throw new TypeError('The template expression target is not callable.');

            }

            const argumentValues = [];

            //Evaluating call arguments from left to right in the local scope.
            for (const argumentNode of expressionNode.arguments ?? []) {
                argumentValues.push(layerExpressionEvaluate(argumentNode, expressionScope));

            }

            return callableValue.apply(thisValue, argumentValues);

        }

        case 'ArrayExpression': {
            const arrayValue = [];

            //Creating a new array without sharing parser-owned node structures.
            for (const elementNode of expressionNode.elements ?? []) {
                let elementValue;

                //Preserving sparse entries without evaluating an absent node.
                if (elementNode !== null) {
                    elementValue = layerExpressionEvaluate(elementNode, expressionScope);

                }

                arrayValue.push(elementValue);

            }

            return arrayValue;

        }

        case 'ObjectExpression': {
            const objectValue = Object.create(null);

            //Creating a prototype-free object from explicitly validated properties.
            for (const propertyData of expressionNode.properties ?? []) {
                let propertyName;

                if (propertyData.computed) {
                    propertyName = String(layerExpressionEvaluate(propertyData.key, expressionScope));

                } else {
                    propertyName = propertyData.key.name ?? String(propertyData.key.value);

                }

                if (!blockedPropertySet.has(propertyName)) {
                    objectValue[propertyName] = layerExpressionEvaluate(propertyData.value, expressionScope);

                }

            }

            return objectValue;

        }

        case 'ChainExpression':
            return layerExpressionEvaluate(/** @type {LayerExpressionNode} */ (expressionNode.expression), expressionScope);

        default:
            throw new TypeError(`Unsupported compiled expression node: ${expressionNode.type}.`);

    }

}
