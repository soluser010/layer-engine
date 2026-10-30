import {parse} from 'acorn';
import {LayerCompilerError} from './compiler-error.js';

const clientOperationTypes = Object.freeze([
    'query',
    'command',
    'sync'
]);

const operationContractFields = Object.freeze([
    'audit',
    'auth',
    'concurrency',
    'cost',
    'inputSchema',
    'name',
    'offlineReplay',
    'outputSchema',
    'permissions',
    'rateLimitBucket',
    'timeoutMs',
    'transaction',
    'type'
]);

/**
 * @param {unknown} valueData
 */
function plainObjectCheck(valueData) {
    //Checking operation metadata before reading schema fields.
    return typeof valueData === 'object' && valueData !== null && !Array.isArray(valueData);

}

/**
 * @param {string} message
 * @param {string | undefined} fileName
 * @param {Record<string, any> | null} [sourceNode]
 * @returns {never}
 */
function operationErrorThrow(message, fileName, sourceNode = null) {
    let errorColumn;

    //Normalizing Acorn coordinates to the public one-based diagnostic contract.
    if (sourceNode?.loc?.start?.column !== undefined) {
        errorColumn = Number(sourceNode.loc.start.column) + 1;

    }

    throw new LayerCompilerError('LAYER_OPERATION_CONTRACT_INVALID', message, {
        file: fileName,
        line: sourceNode?.loc?.start?.line,
        column: errorColumn
    });

}

/**
 * @param {Record<string, any>} expressionNode
 * @param {string | undefined} fileName
 * @returns {unknown}
 */
function staticValueCreate(expressionNode, fileName) {
    if (expressionNode.type === 'Literal') {
        if (typeof expressionNode.value === 'object' && expressionNode.value !== null) {
            operationErrorThrow('Operation contracts cannot contain regular expressions.', fileName, expressionNode);

        }

        return expressionNode.value;

    }

    if (expressionNode.type === 'UnaryExpression' && expressionNode.operator === '-' &&
        expressionNode.argument?.type === 'Literal' && typeof expressionNode.argument.value === 'number') {
        return -expressionNode.argument.value;

    }

    if (expressionNode.type === 'ArrayExpression') {
        const arrayValue = [];

        for (const elementNode of expressionNode.elements ?? []) {
            if (elementNode === null || elementNode.type === 'SpreadElement') {
                operationErrorThrow('Operation contract arrays cannot contain holes or spread values.', fileName, elementNode);

            }

            arrayValue.push(staticValueCreate(elementNode, fileName));

        }

        return arrayValue;

    }

    if (expressionNode.type === 'ObjectExpression') {
        const objectValue = /** @type {Record<string, unknown>} */ (Object.create(null));

        for (const propertyNode of expressionNode.properties ?? []) {
            if (propertyNode.type !== 'Property' || propertyNode.kind !== 'init' ||
                propertyNode.method === true || propertyNode.computed === true ||
                propertyNode.key === undefined || propertyNode.value === undefined) {
                operationErrorThrow('Operation contract objects accept static properties only.', fileName, propertyNode);

            }

            let propertyName;

            //Reading identifier and literal names without evaluating computed JavaScript.
            if (propertyNode.key.type === 'Identifier') {
                propertyName = String(propertyNode.key.name);

            } else {
                propertyName = String(propertyNode.key.value);

            }

            if (propertyName === '__proto__' || propertyName === 'constructor' || propertyName === 'prototype') {
                operationErrorThrow('Operation metadata contains a blocked property name.', fileName, propertyNode.key);

            }

            objectValue[propertyName] = staticValueCreate(propertyNode.value, fileName);

        }

        return objectValue;

    }

    operationErrorThrow('Operation contracts must contain static JSON-compatible values.', fileName, expressionNode);

}

/**
 * @param {unknown} operationData
 * @param {Set<string>} operationNames
 * @param {string | undefined} fileName
 */
function operationContractAssert(operationData, operationNames, fileName) {
    if (!plainObjectCheck(operationData)) {
        operationErrorThrow('Each operation contract must be an object.', fileName);

    }

    const operationRecord = /** @type {Record<string, unknown>} */ (operationData);
    const unknownFields = Object.keys(operationRecord).filter(function operationFieldUnknown(fieldName) {
        //Rejecting metadata that cannot be shared safely between compiler and server.
        return !operationContractFields.includes(fieldName);

    });

    if (unknownFields.length > 0) {
        operationErrorThrow(`Operation contract contains unknown fields: ${unknownFields.join(', ')}.`, fileName);

    }

    if (typeof operationRecord.name !== 'string' ||
        !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(operationRecord.name) ||
        operationRecord.name.length > 160) {
        operationErrorThrow('Operation name must be a dotted lowercase identifier up to 160 characters.', fileName);

    }

    if (operationNames.has(operationRecord.name)) {
        operationErrorThrow(`Operation ${operationRecord.name} is duplicated.`, fileName);

    }

    if (!clientOperationTypes.includes(String(operationRecord.type))) {
        operationErrorThrow('Client operation type must be query, command, or sync.', fileName);

    }

    if ((!plainObjectCheck(operationRecord.inputSchema) && typeof operationRecord.inputSchema !== 'boolean') ||
        (!plainObjectCheck(operationRecord.outputSchema) && typeof operationRecord.outputSchema !== 'boolean')) {
        operationErrorThrow('Operation inputSchema and outputSchema must be JSON Schema objects or booleans.', fileName);

    }

    operationNames.add(operationRecord.name);

}

/**
 * Compiles the static `operations` export without importing or executing project code.
 *
 * @param {string} operationSource
 * @param {{file?: string}} [compilerOptions]
 */
export function layerOperationContractsCompile(operationSource, compilerOptions = {}) {
    let programNode;

    try {
        //Parsing the complete contract module as JavaScript ESM with source locations.
        programNode = /** @type {Record<string, any>} */ (parse(operationSource, {
            ecmaVersion: 'latest',
            locations: true,
            sourceType: 'module'
        }));

    } catch (parseError) {
        const errorLocation = /** @type {{loc?: {line?: number, column?: number}}} */ (parseError).loc;
        let errorColumn;

        //Converting Acorn's zero-based column only when a location is available.
        if (errorLocation?.column !== undefined) {
            errorColumn = errorLocation.column + 1;

        }

        throw new LayerCompilerError(
            'LAYER_OPERATION_CONTRACT_JAVASCRIPT_INVALID',
            'The operation contract module is not valid JavaScript ESM.',
            {
                cause: parseError,
                file: compilerOptions.file,
                line: errorLocation?.line,
                column: errorColumn
            }
        );

    }

    let factoryBindingName = null;

    //Finding the exact public factory binding instead of matching source text.
    for (const statementNode of programNode.body ?? []) {
        if (statementNode.type !== 'ImportDeclaration' || statementNode.source?.value !== '@solcorp/layer') {
            continue;

        }

        for (const specifierNode of statementNode.specifiers ?? []) {
            if (specifierNode.type === 'ImportSpecifier' &&
                specifierNode.imported?.name === 'layerOperationContractsCreate') {
                factoryBindingName = String(specifierNode.local?.name);

            }

        }

    }

    if (factoryBindingName === null) {
        operationErrorThrow('The module must import layerOperationContractsCreate from @solcorp/layer.', compilerOptions.file, programNode);

    }

    let operationInitializer = null;

    //Selecting one canonical named export used by CLI, server, and generated types.
    for (const statementNode of programNode.body ?? []) {
        if (statementNode.type !== 'ExportNamedDeclaration' ||
            statementNode.declaration?.type !== 'VariableDeclaration') {
            continue;

        }

        for (const declarationNode of statementNode.declaration.declarations ?? []) {
            if (declarationNode.id?.type !== 'Identifier' || declarationNode.id.name !== 'operations') {
                continue;

            }

            if (statementNode.declaration.kind !== 'const') {
                operationErrorThrow('The operations export must be a const.', compilerOptions.file, declarationNode);

            }

            if (operationInitializer !== null) {
                operationErrorThrow('The module must declare one operations export.', compilerOptions.file, declarationNode);

            }

            operationInitializer = declarationNode.init;

        }

    }

    if (operationInitializer?.type !== 'CallExpression' ||
        operationInitializer.callee?.type !== 'Identifier' ||
        operationInitializer.callee.name !== factoryBindingName ||
        operationInitializer.arguments?.length !== 1) {
        operationErrorThrow(
            'The operations export must call layerOperationContractsCreate with one static array.',
            compilerOptions.file,
            operationInitializer ?? programNode
        );

    }

    const operationList = staticValueCreate(operationInitializer.arguments[0], compilerOptions.file);

    if (!Array.isArray(operationList)) {
        operationErrorThrow('layerOperationContractsCreate requires an operation array.', compilerOptions.file, operationInitializer.arguments[0]);

    }

    const operationNames = new Set();

    for (const operationData of operationList) {
        operationContractAssert(operationData, operationNames, compilerOptions.file);

    }

    return Object.freeze(operationList.map(function operationFreeze(operationData) {
        //Returning compiler-owned values that cannot be changed by later build stages.
        return Object.freeze(structuredClone(operationData));

    }));

}
