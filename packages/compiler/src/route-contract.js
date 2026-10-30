import {parse} from 'acorn';
import {LayerCompilerError} from './compiler-error.js';
import {layerComponentScriptValidate} from './expression.js';

/** @typedef {import('./expression.js').LayerExpressionNode} LayerExpressionNode */

/**
 * @param {string} messageData
 * @returns {never}
 */
function routeExportReject(messageData) {
    //Passing a stable static route contract error to build tooling.
    throw new LayerCompilerError('LAYER_ROUTE_EXPORT_INVALID', messageData);

}

/**
 * @param {any} valueNode
 * @returns {unknown}
 */
function staticValueCreate(valueNode) {
    if (valueNode.type === 'Literal') {
        //Returning only JSON-compatible scalar literals.
        if (typeof valueNode.value === 'string' || typeof valueNode.value === 'number' ||
            typeof valueNode.value === 'boolean' || valueNode.value === null) {
            return valueNode.value;

        }

        routeExportReject('Route configuration contains an unsupported literal.');

    }

    if (valueNode.type === 'ArrayExpression') {
        const arrayValue = [];

        //Building the route array without evaluating executable expressions.
        for (const elementNode of valueNode.elements ?? []) {
            if (elementNode === null || elementNode.type === 'SpreadElement') {
                routeExportReject('Route configuration arrays cannot contain holes or spread elements.');

            }

            arrayValue.push(staticValueCreate(elementNode));

        }

        return Object.freeze(arrayValue);

    }

    if (valueNode.type === 'ObjectExpression') {
        const objectValue = /** @type {Record<string, unknown>} */ ({});

        //Building a prototype-safe route object from static named properties.
        for (const propertyNode of valueNode.properties ?? []) {
            if (propertyNode.type !== 'Property' || propertyNode.computed || propertyNode.kind !== 'init' || propertyNode.method || propertyNode.shorthand) {
                routeExportReject('Route configuration accepts only static named properties.');

            }

            const propertyName = propertyNode.key.name ?? propertyNode.key.value;

            if (typeof propertyName !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(propertyName)) {
                routeExportReject('Route configuration contains an unsafe property name.');

            }

            objectValue[propertyName] = staticValueCreate(propertyNode.value);

        }

        return Object.freeze(objectValue);

    }

    routeExportReject('Route configuration must contain static JSON-compatible values.');

}

/**
 * @param {string} scriptSource
 * @returns {Readonly<Record<string, unknown>> | null}
 */
export function layerComponentRouteExtract(scriptSource) {
    //Applying the complete component script safety scan before route extraction.
    layerComponentScriptValidate(scriptSource);

    const scriptProgram = /** @type {any} */ (parse(scriptSource, {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }));
    let routeConfiguration = /** @type {Readonly<Record<string, unknown>> | null} */ (null);

    for (const statementNode of scriptProgram.body ?? []) {
        if (statementNode.type !== 'ExportNamedDeclaration' || statementNode.declaration?.type !== 'VariableDeclaration') {
            continue;

        }

        for (const declarationNode of statementNode.declaration.declarations ?? []) {
            if (declarationNode.id?.name !== 'route') {
                continue;

            }

            //Requiring one immutable route export with a static object initializer.
            if (statementNode.declaration.kind !== 'const' || declarationNode.init?.type !== 'ObjectExpression' || routeConfiguration !== null) {
                routeExportReject('A page must export route once as a const object.');

            }

            routeConfiguration = /** @type {Readonly<Record<string, unknown>>} */ (staticValueCreate(declarationNode.init));

        }

    }

    return routeConfiguration;

}
