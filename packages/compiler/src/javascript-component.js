import {parse} from 'acorn';
import {LayerCompilerError} from './compiler-error.js';
import {layerComponentCompile} from './compiler.js';
import {
    layerComponentScriptValidate,
    layerExpressionCompile
} from './expression.js';

const layerPublicModuleName = '@solcorp/layer';
const bindingAttributePattern = /([@.?]?)([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*$/;

/**
 * @typedef {import('./expression.js').LayerExpressionNode} LayerExpressionNode
 * @typedef {object} LayerJavascriptNode
 * @property {string} type
 * @property {number} start
 * @property {number} end
 * @property {string} [name]
 * @property {unknown} [value]
 * @property {string} [operator]
 * @property {string} [kind]
 * @property {boolean} [computed]
 * @property {boolean} [method]
 * @property {LayerJavascriptNode | null} [argument]
 * @property {LayerJavascriptNode} [body]
 * @property {LayerJavascriptNode} [source]
 * @property {LayerJavascriptNode} [imported]
 * @property {LayerJavascriptNode} [local]
 * @property {LayerJavascriptNode} [declaration]
 * @property {LayerJavascriptNode} [id]
 * @property {LayerJavascriptNode | null} [init]
 * @property {LayerJavascriptNode} [callee]
 * @property {LayerJavascriptNode} [tag]
 * @property {LayerJavascriptNode} [quasi]
 * @property {LayerJavascriptNode} [key]
 * @property {LayerJavascriptNode} [expression]
 * @property {LayerJavascriptNode[]} [bodyNodes]
 * @property {LayerJavascriptNode[]} [specifiers]
 * @property {LayerJavascriptNode[]} [declarations]
 * @property {LayerJavascriptNode[]} [arguments]
 * @property {LayerJavascriptNode[]} [expressions]
 * @property {LayerJavascriptNode[]} [quasis]
 * @property {LayerJavascriptNode[]} [properties]
 * @property {LayerJavascriptNode[]} [params]
 * @property {{raw?: string, cooked?: string | null}} [templateValue]
 * @property {{start?: {line?: number, column?: number}}} [loc]
 * @typedef {{kind: 'attribute' | 'boolean' | 'child' | 'component' | 'error-boundary' | 'event' | 'model' | 'property' | 'ref' | 'repeat' | 'when', marker: string, expression: LayerExpressionNode, source: string, start: number, end: number, line: number, column: number, name: string | null, structure?: {kind: 'when', truthyTemplate: LayerJavascriptNode, falsyTemplate: LayerJavascriptNode | null} | {kind: 'repeat', itemTemplate: LayerJavascriptNode} | {kind: 'component', slots: Record<string, LayerJavascriptNode>} | {kind: 'error-boundary', contentTemplate: LayerJavascriptNode, fallbackTemplate: LayerJavascriptNode}}} LayerJavascriptBinding
 * @typedef {{compilerVersion: number, componentId: string, scopeId: string, template: Record<string, unknown>[], script: {source: string}, style: {source: string, css: string, scoped: boolean}, sourceMap: Record<string, unknown>, format: 'layer.js', module: {componentName: string | null, metadata: Record<string, unknown>}}} LayerJavascriptComponentData
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
 * @param {unknown} inputData
 * @returns {unknown}
 */
function mutableDataCopy(inputData) {
    if (Array.isArray(inputData)) {
        //Copying compiler arrays before adapting the shared render-plan backend.
        return inputData.map(mutableDataCopy);

    }

    if (typeof inputData !== 'object' || inputData === null) {
        return inputData;

    }

    const resultData = /** @type {Record<string, unknown>} */ ({});

    for (const [propertyName, propertyValue] of Object.entries(inputData)) {
        resultData[propertyName] = mutableDataCopy(propertyValue);

    }

    return resultData;

}

/**
 * @param {string} message
 * @param {string | undefined} fileName
 * @param {LayerJavascriptNode | undefined} sourceNode
 * @returns {never}
 */
function componentErrorThrow(message, fileName, sourceNode) {
    let errorColumn;

    //Normalizing the optional parser column to the public one-based diagnostic contract.
    if (sourceNode?.loc?.start?.column !== undefined) {
        errorColumn = sourceNode.loc.start.column + 1;

    }

    //Passing one stable compiler diagnostic without exposing parser-owned structures.
    throw new LayerCompilerError('LAYER_JAVASCRIPT_COMPONENT_INVALID', message, {
        file: fileName,
        line: sourceNode?.loc?.start?.line,
        column: errorColumn
    });

}

/**
 * @param {LayerJavascriptNode} expressionNode
 * @param {string | undefined} fileName
 * @returns {unknown}
 */
function staticValueCreate(expressionNode, fileName) {
    if (expressionNode.type === 'Literal') {
        if (typeof expressionNode.value === 'object' && expressionNode.value !== null) {
            componentErrorThrow('Metadata regular expressions are not supported.', fileName, expressionNode);

        }

        return expressionNode.value;

    }

    if (expressionNode.type === 'UnaryExpression' && expressionNode.operator === '-' &&
        expressionNode.argument?.type === 'Literal' && typeof expressionNode.argument.value === 'number') {
        return -expressionNode.argument.value;

    }

    if (expressionNode.type === 'ArrayExpression') {
        const arrayValue = [];

        for (const elementNode of expressionNode.bodyNodes ?? []) {
            if (elementNode.type === 'SpreadElement') {
                componentErrorThrow('Metadata arrays cannot contain spread values.', fileName, elementNode);

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
                propertyNode.key === undefined || propertyNode.expression === undefined) {
                componentErrorThrow('Metadata objects accept static properties only.', fileName, propertyNode);

            }

            let propertyName;

            //Reading identifier and literal keys without evaluating computed metadata.
            if (propertyNode.key.type === 'Identifier') {
                propertyName = String(propertyNode.key.name);

            } else {
                propertyName = String(propertyNode.key.value);

            }

            if (propertyName === '__proto__' || propertyName === 'constructor' || propertyName === 'prototype') {
                componentErrorThrow('Metadata contains a blocked property name.', fileName, propertyNode.key);

            }

            objectValue[propertyName] = staticValueCreate(propertyNode.expression, fileName);

        }

        return objectValue;

    }

    componentErrorThrow('Metadata exports must contain static JSON-compatible values.', fileName, expressionNode);

}

/**
 * Acorn nodes are normalized once so the remaining compiler does not depend on parser internals.
 *
 * @param {Record<string, unknown>} sourceNode
 * @returns {LayerJavascriptNode}
 */
function javascriptNodeNormalize(sourceNode) {
    const nodeData = /** @type {LayerJavascriptNode} */ ({
        type: String(sourceNode.type),
        start: Number(sourceNode.start),
        end: Number(sourceNode.end)
    });

    for (const [propertyName, propertyValue] of Object.entries(sourceNode)) {
        if (propertyName === 'type' || propertyName === 'start' || propertyName === 'end') {
            continue;

        }

        if (Array.isArray(propertyValue)) {
            const childNodes = propertyValue.filter(function childNodeFilter(childValue) {
                //Keeping only parser nodes while intentionally discarding null array holes.
                return typeof childValue === 'object' && childValue !== null && 'type' in childValue;

            }).map(function childNodeNormalize(childValue) {
                //Normalizing every retained child before attaching it to the local AST shape.
                return javascriptNodeNormalize(/** @type {Record<string, unknown>} */ (childValue));

            });

            if (propertyName === 'body' || propertyName === 'elements') {
                nodeData.bodyNodes = childNodes;

            } else {
                nodeData[/** @type {'arguments'} */ (propertyName)] = childNodes;

            }

            continue;

        }

        if (typeof propertyValue === 'object' && propertyValue !== null && 'type' in propertyValue) {
            const childNode = javascriptNodeNormalize(/** @type {Record<string, unknown>} */ (propertyValue));

            if (propertyName === 'value') {
                nodeData.expression = childNode;

            } else {
                nodeData[/** @type {'argument'} */ (propertyName)] = childNode;

            }

            continue;

        }

        if (propertyName === 'value' && sourceNode.type === 'TemplateElement' &&
            typeof propertyValue === 'object' && propertyValue !== null) {
            nodeData.templateValue = /** @type {{raw?: string, cooked?: string | null}} */ (propertyValue);

            continue;

        }

        nodeData[/** @type {'name'} */ (propertyName)] = /** @type {never} */ (propertyValue);

    }

    return nodeData;

}

/**
 * @param {LayerJavascriptNode} programNode
 * @param {string | undefined} fileName
 */
function layerImportBindingsCollect(programNode, fileName) {
    const bindingMap = new Map();

    //Collecting only named primitives imported from the public Layer module.
    for (const statementNode of programNode.bodyNodes ?? []) {
        if (statementNode.type !== 'ImportDeclaration' || statementNode.source?.value !== layerPublicModuleName) {
            continue;

        }

        for (const specifierNode of statementNode.specifiers ?? []) {
            if (specifierNode.type !== 'ImportSpecifier') {
                componentErrorThrow('Layer primitives must use named ESM imports.', fileName, specifierNode);

            }

            bindingMap.set(String(specifierNode.imported?.name), String(specifierNode.local?.name));

        }

    }

    return bindingMap;

}


/**
 * @param {LayerJavascriptNode} programNode
 */
function componentImportBindingsCollect( programNode ){
    const componentBindingMap = new Map();

    //Collecting default imports which are compiled by the Layer component loader
    for ( const statementNode of programNode.bodyNodes ?? [] ){
        const componentSourceValue = statementNode.source?.value;

        if (
            statementNode.type !== String( 'ImportDeclaration' ) ||
            typeof componentSourceValue !== 'string' ||
            !/\.layer(?:\.js)?$/.test( componentSourceValue )
        ){
            //Next the cycle
            continue;

        }

        for ( const specifierNode of statementNode.specifiers ?? [] ){
            if (
                specifierNode.type === String( 'ImportDefaultSpecifier' ) &&
                specifierNode.local?.type === String( 'Identifier' )
            ){
                //Recording the local callable name and its source for diagnostics
                componentBindingMap.set(
                    String( specifierNode.local.name ),
                    String( componentSourceValue )
                );

            }

        }

    }

    //CallBack THE OBJECT
    return componentBindingMap;

}


/**
 * @param {LayerJavascriptNode} programNode
 * @param {Map<string, string>} layerBindingMap
 * @param {string | undefined} fileName
 */
function componentFunctionFind(programNode, layerBindingMap, fileName) {
    const componentFactoryName = layerBindingMap.get('layerComponentCreate');

    if (componentFactoryName === undefined) {
        componentErrorThrow('The component must import layerComponentCreate from @solcorp/layer.', fileName, programNode);

    }

    const defaultExportList = (programNode.bodyNodes ?? []).filter(function defaultExportFilter(statementNode) {
        //Selecting the single public component definition without executing module code.
        return statementNode.type === 'ExportDefaultDeclaration';

    });

    if (defaultExportList.length !== 1) {
        componentErrorThrow('A .layer.js component requires exactly one default export.', fileName, programNode);

    }

    const defaultExportNode = /** @type {LayerJavascriptNode} */ (defaultExportList[0]);
    const factoryCallNode = defaultExportNode.declaration;

    if (factoryCallNode?.type !== 'CallExpression' || factoryCallNode.callee?.type !== 'Identifier' ||
        factoryCallNode.callee.name !== componentFactoryName || (factoryCallNode.arguments ?? []).length !== 1) {
        componentErrorThrow(
            'The default export must call the imported layerComponentCreate with one component function.',
            fileName,
            defaultExportNode
        );

    }

    const componentFunctionNode = factoryCallNode.arguments?.[0];

    if (componentFunctionNode?.type !== 'FunctionExpression' && componentFunctionNode?.type !== 'ArrowFunctionExpression') {
        componentErrorThrow('layerComponentCreate requires a function expression.', fileName, componentFunctionNode);

    }

    return componentFunctionNode;

}

/**
 * @param {LayerJavascriptNode} componentFunctionNode
 * @param {string} htmlBindingName
 * @param {string | undefined} fileName
 */
function componentTemplateFind(componentFunctionNode, htmlBindingName, fileName) {
    //Reading the component body before selecting its one public template result.
    const functionBodyNode = componentFunctionNode.body;
    let returnExpressionNode;

    //Accepting a concise arrow result or one explicit top-level return in a function block.
    if (functionBodyNode?.type !== 'BlockStatement') {
        returnExpressionNode = functionBodyNode;

    } else {
        const returnStatementList = (functionBodyNode.bodyNodes ?? []).filter(function returnFilter(statementNode) {
            //Ignoring nested function returns because only direct component ownership is valid.
            return statementNode.type === 'ReturnStatement';

        });

        if (returnStatementList.length !== 1) {
            componentErrorThrow('The component function must contain one top-level template return.', fileName, functionBodyNode);

        }

        returnExpressionNode = returnStatementList[0]?.argument;

    }

    if (returnExpressionNode?.type !== 'TaggedTemplateExpression' || returnExpressionNode.tag?.type !== 'Identifier' ||
        returnExpressionNode.tag.name !== htmlBindingName) {
        componentErrorThrow(
            'The component function must return the imported html tagged template.',
            fileName,
            returnExpressionNode ?? undefined
        );

    }

    return returnExpressionNode;

}

/**
 * @param {LayerJavascriptNode | undefined} rendererNode
 * @param {string} htmlBindingName
 * @param {string} structureName
 * @param {string | undefined} fileName
 */
function structuralRendererTemplateFind(rendererNode, htmlBindingName, structureName, fileName) {
    if (rendererNode?.type !== 'FunctionExpression' && rendererNode?.type !== 'ArrowFunctionExpression') {
        componentErrorThrow(`${structureName} requires a template renderer function.`, fileName, rendererNode);

    }

    const functionBodyNode = rendererNode.body;

    if (functionBodyNode === undefined) {
        componentErrorThrow(`${structureName} renderer body is missing.`, fileName, rendererNode);

    }
    let returnExpressionNode;

    //Accepting one concise or block-bodied renderer without executing its JavaScript.
    if (functionBodyNode.type !== 'BlockStatement') {
        returnExpressionNode = functionBodyNode;

    } else {
        const returnStatementList = (functionBodyNode.bodyNodes ?? []).filter(function returnFilter(statementNode) {
            //Keeping only the renderer-owned return at this function depth.
            return statementNode.type === 'ReturnStatement';

        });

        if (returnStatementList.length !== 1) {
            componentErrorThrow(`${structureName} renderer requires one template return.`, fileName, functionBodyNode);

        }

        returnExpressionNode = returnStatementList[0]?.argument;

    }

    if (returnExpressionNode?.type !== 'TaggedTemplateExpression' ||
        returnExpressionNode.tag?.type !== 'Identifier' ||
        returnExpressionNode.tag.name !== htmlBindingName) {
        componentErrorThrow(`${structureName} renderer must return the imported html tag.`, fileName, returnExpressionNode ?? undefined);

    }

    return returnExpressionNode;

}
/**
 * @param {LayerJavascriptNode | undefined} slotValueNode
 * @param {string} htmlBindingName
 */
function componentSlotTemplateMaybeFind( slotValueNode, htmlBindingName ){
    if (
        slotValueNode?.type === String( 'TaggedTemplateExpression' ) &&
        slotValueNode.tag?.type === String( 'Identifier' ) &&
        slotValueNode.tag.name === htmlBindingName
    ){
        //CallBack THE OBJECT
        return slotValueNode;

    }

    if (
        slotValueNode?.type !== String( 'FunctionExpression' ) &&
        slotValueNode?.type !== String( 'ArrowFunctionExpression' )
    ){
        //CallBack THE BOOLEAN
        return false;

    }

    const functionBodyNode = slotValueNode.body;
    let returnExpressionNode = /** @type {LayerJavascriptNode | null | undefined} */ ( functionBodyNode );

    //Reading one direct return from a block-bodied lazy slot
    if ( functionBodyNode?.type === String( 'BlockStatement' ) ){
        const returnStatementList = ( functionBodyNode.bodyNodes ?? [] ).filter( function( statementNode ){
            //Keeping only the return owned by this slot callback
            return statementNode.type === String( 'ReturnStatement' );

        });

        if ( Number( returnStatementList.length ) !== Number( 1 ) ){
            //CallBack THE BOOLEAN
            return false;

        }

        returnExpressionNode = returnStatementList[0]?.argument;

    }

    //Checking that the lazy slot returns the imported html tagged template
    if (
        returnExpressionNode?.type !== String( 'TaggedTemplateExpression' ) ||
        returnExpressionNode.tag?.type !== String( 'Identifier' ) ||
        returnExpressionNode.tag.name !== htmlBindingName
    ){
        //CallBack THE BOOLEAN
        return false;

    }

    //CallBack THE OBJECT
    return returnExpressionNode;

}



/**
 * @param {LayerJavascriptNode} expressionNode
 * @param {Map<string, string>} layerBindingMap
 * @param {Map<string, string>} componentBindingMap
 * @param {string} htmlBindingName
 * @param {string | undefined} fileName
 */
function structuralBindingCreate(expressionNode, layerBindingMap, componentBindingMap, htmlBindingName, fileName) {
    if (expressionNode.type !== 'CallExpression' || expressionNode.callee?.type !== 'Identifier') {
        return null;

    }

    const argumentList = expressionNode.arguments ?? [];
    const whenBindingName = layerBindingMap.get('when');
    const repeatBindingName = layerBindingMap.get('repeat');
    const errorBoundaryBindingName = layerBindingMap.get('ErrorBoundary');

    if (whenBindingName !== undefined && expressionNode.callee.name === whenBindingName) {
        if (argumentList.length < 2 || argumentList.length > 3) {
            componentErrorThrow('when requires a condition and one or two template renderers.', fileName, expressionNode);

        }

        let falsyTemplate = null;

        //Compiling the optional false branch only when the author declared it.
        if (argumentList.length === 3) {
            falsyTemplate = structuralRendererTemplateFind(argumentList[2], htmlBindingName, 'when', fileName);

        }

        return {
            kind: /** @type {'when'} */ ('when'),
            truthyTemplate: structuralRendererTemplateFind(argumentList[1], htmlBindingName, 'when', fileName),
            falsyTemplate
        };

    }

    if (repeatBindingName !== undefined && expressionNode.callee.name === repeatBindingName) {
        const keySelectorNode = argumentList[1];

        if (argumentList.length !== 3 ||
            (keySelectorNode?.type !== 'FunctionExpression' && keySelectorNode?.type !== 'ArrowFunctionExpression')) {
            componentErrorThrow('repeat requires a collection, key selector, and item template renderer.', fileName, expressionNode);

        }

        return {
            kind: /** @type {'repeat'} */ ('repeat'),
            itemTemplate: structuralRendererTemplateFind(argumentList[2], htmlBindingName, 'repeat', fileName)
        };

    }

    if (
        errorBoundaryBindingName !== undefined &&
        expressionNode.callee.name === errorBoundaryBindingName
    ){
        const boundaryOptionsNode = argumentList[0];

        //Checking the complete static boundary options before compiling either branch
        if (
            Number( argumentList.length ) !== Number( 1 ) ||
            boundaryOptionsNode?.type !== String( 'ObjectExpression' )
        ){
            componentErrorThrow(
                'ErrorBoundary requires one static options object.',
                fileName,
                expressionNode
            );

        }

        const boundaryOptionMap = new Map();

        for ( const propertyNode of boundaryOptionsNode.properties ?? [] ){
            if (
                propertyNode.type !== String( 'Property' ) ||
                propertyNode.kind !== String( 'init' ) ||
                propertyNode.computed === true ||
                propertyNode.key === undefined ||
                propertyNode.expression === undefined
            ){
                componentErrorThrow(
                    'ErrorBoundary options must use static content and fallback properties.',
                    fileName,
                    propertyNode
                );

            }

            let optionName;

            //Reading only static identifier or literal option names
            if ( propertyNode.key.type === String( 'Identifier' ) ){
                optionName = String( propertyNode.key.name );

            } else {
                optionName = String( propertyNode.key.value );

            }

            if ( ![String( 'content' ), String( 'fallback' )].includes( optionName ) ){
                componentErrorThrow(
                    'ErrorBoundary contains an unknown option.',
                    fileName,
                    propertyNode
                );

            }

            boundaryOptionMap.set( optionName, propertyNode.expression );

        }

        if ( boundaryOptionMap.size !== Number( 2 ) ){
            componentErrorThrow(
                'ErrorBoundary requires content and fallback renderers.',
                fileName,
                boundaryOptionsNode
            );

        }

        //CallBack THE OBJECT
        return {
            kind: /** @type {'error-boundary'} */ ( 'error-boundary' ),
            contentTemplate: structuralRendererTemplateFind(
                boundaryOptionMap.get( String( 'content' ) ),
                htmlBindingName,
                String( 'ErrorBoundary content' ),
                fileName
            ),
            fallbackTemplate: structuralRendererTemplateFind(
                boundaryOptionMap.get( String( 'fallback' ) ),
                htmlBindingName,
                String( 'ErrorBoundary fallback' ),
                fileName
            )
        };

    }

    if ( componentBindingMap.has( String( expressionNode.callee.name ) ) === true ){
        if ( Number( argumentList.length ) > Number( 1 ) ){
            componentErrorThrow(
                'A nested component accepts one static options object.',
                fileName,
                expressionNode
            );

        }

        const componentSlotTemplates = Object.create( null );
        const componentOptionsNode = argumentList[0];

        //Checking the optional invocation object before inspecting slot templates
        if (
            componentOptionsNode !== undefined &&
            componentOptionsNode.type !== String( 'ObjectExpression' )
        ){
            componentErrorThrow(
                'Nested component options must use an object literal.',
                fileName,
                componentOptionsNode
            );

        }

        //Collecting only html template values as compiler-owned slots
        for ( const propertyNode of componentOptionsNode?.properties ?? [] ){
            if (
                propertyNode.type !== String( 'Property' ) ||
                propertyNode.kind !== String( 'init' ) ||
                propertyNode.computed === true ||
                propertyNode.key === undefined ||
                propertyNode.expression === undefined
            ){
                componentErrorThrow(
                    'Nested component options cannot contain spread, methods, or computed names.',
                    fileName,
                    propertyNode
                );

            }

            let propertyName = String();

            //Reading one static option name without evaluating author code
            if ( propertyNode.key.type === String( 'Identifier' ) ){
                propertyName = String( propertyNode.key.name );

            } else if ( propertyNode.key.type === String( 'Literal' ) ){
                propertyName = String( propertyNode.key.value );

            } else {
                componentErrorThrow(
                    'Nested component option names must be static.',
                    fileName,
                    propertyNode.key
                );

            }

            const slotTemplateNode = componentSlotTemplateMaybeFind(
                propertyNode.expression,
                htmlBindingName
            );

            //Skipping ordinary props and event handlers after their static name is checked
            if ( slotTemplateNode === false ){
                continue;

            }

            if ( Object.hasOwn( componentSlotTemplates, propertyName ) === true ){
                componentErrorThrow(
                    `Nested component slot ${propertyName} is duplicated.`,
                    fileName,
                    propertyNode
                );

            }

            componentSlotTemplates[propertyName] = slotTemplateNode;

        }

        //CallBack THE OBJECT
        return {
            kind: /** @type {'component'} */ ( 'component' ),
            slots: componentSlotTemplates
        };

    }

    return null;

}

/**
 * @param {LayerJavascriptNode} programNode
 * @param {Map<string, string>} layerBindingMap
 * @param {string | undefined} fileName
 */
function componentMetadataRead(programNode, layerBindingMap, fileName) {
    const metadataData = /** @type {Record<string, unknown>} */ (Object.create(null));
    const cssBindingName = layerBindingMap.get('css');
    const pageFactoryName = layerBindingMap.get('layerPageCreate');
    let styleTemplateNode = /** @type {LayerJavascriptNode | null} */ (null);

    for (const statementNode of programNode.bodyNodes ?? []) {
        let declarationNode;

        //Reading declarations only from explicit named exports.
        if (statementNode.type === 'ExportNamedDeclaration') {
            declarationNode = statementNode.declaration;

        }

        if (declarationNode?.type !== 'VariableDeclaration') {
            continue;

        }

        for (const variableNode of declarationNode.declarations ?? []) {
            let exportName = '';

            //Accepting simple named metadata exports only.
            if (variableNode.id?.type === 'Identifier') {
                exportName = String(variableNode.id.name);

            }

            if (!['events', 'page', 'properties', 'styles'].includes(exportName)) {
                continue;

            }

            if (declarationNode.kind !== 'const' || variableNode.init === null || variableNode.init === undefined) {
                componentErrorThrow(`The ${exportName} export must be an initialized const.`, fileName, declarationNode);

            }

            const initializerNode = variableNode.init;

            if (exportName === 'styles') {
                if (cssBindingName === undefined || initializerNode.type !== 'TaggedTemplateExpression' ||
                    initializerNode.tag?.type !== 'Identifier' || initializerNode.tag.name !== cssBindingName) {
                    componentErrorThrow('The styles export must use the imported css tagged template.', fileName, initializerNode);

                }

                if ((initializerNode.quasi?.expressions ?? []).length > 0) {
                    componentErrorThrow('Component CSS must be static and cannot contain interpolation.', fileName, initializerNode);

                }

                styleTemplateNode = initializerNode;
                continue;

            }

            if (exportName === 'page') {
                if (pageFactoryName === undefined || initializerNode.type !== 'CallExpression' ||
                    initializerNode.callee?.type !== 'Identifier' || initializerNode.callee.name !== pageFactoryName ||
                    (initializerNode.arguments ?? []).length !== 1) {
                    componentErrorThrow('The page export must call layerPageCreate with static metadata.', fileName, initializerNode);

                }

                metadataData.page = staticValueCreate(/** @type {LayerJavascriptNode} */ (initializerNode.arguments?.[0]), fileName);
                continue;

            }

            metadataData[exportName] = staticValueCreate(initializerNode, fileName);

        }

    }

    return {
        metadata: metadataData,
        styleTemplate: styleTemplateNode
    };

}

/**
 * @param {string} sourceData
 * @param {number} sourceOffset
 */
function sourceLocationCreate(sourceData, sourceOffset) {
    //Splitting only the prefix needed to calculate a stable one-based location.
    const lineData = sourceData.slice(0, sourceOffset).split('\n');

    return {
        line: lineData.length,
        column: (lineData[lineData.length - 1]?.length ?? 0) + 1
    };

}

/**
 * @param {string} staticSource
 * @param {{inTag: boolean, quote: string | null, inComment: boolean}} scannerState
 */
function htmlScannerAdvance(staticSource, scannerState) {
    //Advancing the lightweight HTML context scanner across one static template segment.
    for (let sourceIndex = 0; sourceIndex < staticSource.length; sourceIndex += 1) {
        if (scannerState.inComment) {
            if (staticSource.startsWith('-->', sourceIndex)) {
                scannerState.inComment = false;
                sourceIndex += 2;

            }

            continue;

        }

        if (!scannerState.inTag && staticSource.startsWith('<!--', sourceIndex)) {
            scannerState.inComment = true;
            sourceIndex += 3;
            continue;

        }

        const characterData = staticSource[sourceIndex];

        if (!scannerState.inTag && characterData === '<') {
            scannerState.inTag = true;
            continue;

        }

        if (!scannerState.inTag) {
            continue;

        }

        if (scannerState.quote !== null) {
            if (characterData === scannerState.quote) {
                scannerState.quote = null;

            }

            continue;

        }

        if (characterData === '"' || characterData === "'") {
            scannerState.quote = characterData;

        } else if (characterData === '>') {
            scannerState.inTag = false;

        }

    }

}

/**
 * @param {string} componentSource
 * @param {LayerJavascriptNode} taggedTemplateNode
 * @param {Map<string, string>} layerBindingMap
 * @param {Map<string, string>} componentBindingMap
 * @param {string | undefined} fileName
 */
function htmlTemplateCompileSourceCreate(componentSource, taggedTemplateNode, layerBindingMap, componentBindingMap, fileName) {
    const quasiNodeList = taggedTemplateNode.quasi?.quasis ?? [];
    const expressionNodeList = taggedTemplateNode.quasi?.expressions ?? [];
    const scannerState = {
        inTag: false,
        quote: /** @type {string | null} */ (null),
        inComment: false
    };
    const bindingList = /** @type {LayerJavascriptBinding[]} */ ([]);
    let syntheticTemplateSource = '';

    for (let expressionIndex = 0; expressionIndex < expressionNodeList.length; expressionIndex += 1) {
        const quasiNode = quasiNodeList[expressionIndex];
        const staticSource = String(quasiNode?.templateValue?.cooked ?? '');

        if (staticSource.includes('{{') || staticSource.includes('}}')) {
            componentErrorThrow('Legacy {{ expression }} interpolation is not allowed in .layer.js.', fileName, quasiNode);

        }

        htmlScannerAdvance(staticSource, scannerState);

        const expressionNode = /** @type {LayerJavascriptNode} */ (expressionNodeList[expressionIndex]);
        const expressionSource = componentSource.slice(expressionNode.start, expressionNode.end);
        const markerName = `__layer_expression_${String(expressionIndex + 1).padStart(6, '0')}__`;
        const htmlBindingName = /** @type {string} */ (layerBindingMap.get('html'));
        const structuralData = structuralBindingCreate(
            expressionNode,
            layerBindingMap,
            componentBindingMap,
            htmlBindingName,
            fileName
        );
        let expressionData;
        let expressionCompileSource = expressionSource;

        //Compiling structural calls as one runtime descriptor marker instead of executable callbacks.
        if (structuralData !== null) {
            expressionCompileSource = markerName;

        }

        try {
            //Compiling native interpolation without evaluating developer-controlled code.
            expressionData = layerExpressionCompile(expressionCompileSource);

        } catch (expressionError) {
            const locationData = sourceLocationCreate(componentSource, expressionNode.start);

            throw new LayerCompilerError(
                /** @type {{code?: string}} */ (expressionError).code ?? 'LAYER_EXPRESSION_INVALID',
                /** @type {{message?: string}} */ (expressionError).message ?? 'The interpolation is invalid.',
                {
                    cause: expressionError,
                    file: fileName,
                    line: locationData.line,
                    column: locationData.column
                }
            );

        }

        if (scannerState.inTag && structuralData !== null) {
            componentErrorThrow('Structural helpers and nested components can be used only as child regions.', fileName, expressionNode);

        }

        let bindingKind = /** @type {LayerJavascriptBinding['kind']} */ (structuralData?.kind ?? 'child');
        let bindingName = /** @type {string | null} */ (null);
        let transformedStaticSource = staticSource;

        if (scannerState.inTag) {
            if (scannerState.quote !== null) {
                componentErrorThrow('Interpolation must own the complete unquoted attribute value.', fileName, expressionNode);

            }

            const attributeMatch = staticSource.match(bindingAttributePattern);

            if (attributeMatch === null) {
                componentErrorThrow('Dynamic tag and attribute names are not allowed.', fileName, expressionNode);

            }

            const attributePrefix = attributeMatch[1] ?? '';
            bindingName = attributeMatch[2] ?? null;
            transformedStaticSource = staticSource.slice(0, attributeMatch.index);

            if (bindingName === 'l-model' && attributePrefix.length === 0) {
                bindingKind = 'model';
                transformedStaticSource += `l-model="${markerName}"`;

            } else if (bindingName === 'ref' && attributePrefix.length === 0) {
                bindingKind = 'ref';
                transformedStaticSource += `:__layer_ref="${markerName}"`;

            } else if (attributePrefix === '@') {
                bindingKind = 'event';
                transformedStaticSource += `@${bindingName}="${markerName}"`;

            } else if (attributePrefix === '.') {
                bindingKind = 'property';
                transformedStaticSource += `:${bindingName}="${markerName}"`;

            } else if (attributePrefix === '?') {
                bindingKind = 'boolean';
                transformedStaticSource += `:${bindingName}="${markerName}"`;

            } else if (attributePrefix.length === 0) {
                bindingKind = 'attribute';
                transformedStaticSource += `:${bindingName}="${markerName}"`;

            } else {
                componentErrorThrow('The binding prefix is not supported.', fileName, expressionNode);

            }

            const nextStaticSource = String(quasiNodeList[expressionIndex + 1]?.templateValue?.cooked ?? '');

            if (nextStaticSource.length > 0 && !/^[\s/>]/.test(nextStaticSource)) {
                componentErrorThrow('An attribute interpolation cannot be combined with static text.', fileName, expressionNode);

            }

        } else {
            transformedStaticSource += `{{${markerName}}}`;

        }

        const locationData = sourceLocationCreate(componentSource, expressionNode.start);

        const bindingRecord = /** @type {LayerJavascriptBinding} */ ({
            kind: bindingKind,
            marker: markerName,
            expression: expressionData,
            source: expressionSource,
            start: expressionNode.start,
            end: expressionNode.end,
            line: locationData.line,
            column: locationData.column,
            name: bindingName
        });

        if (structuralData !== null) {
            bindingRecord.structure = structuralData;

        }

        bindingList.push(bindingRecord);
        syntheticTemplateSource += transformedStaticSource;

    }

    const lastQuasiNode = quasiNodeList[quasiNodeList.length - 1];
    const lastStaticSource = String(lastQuasiNode?.templateValue?.cooked ?? '');

    if (lastStaticSource.includes('{{') || lastStaticSource.includes('}}')) {
        componentErrorThrow('Legacy {{ expression }} interpolation is not allowed in .layer.js.', fileName, lastQuasiNode);

    }

    syntheticTemplateSource += lastStaticSource;

    return {
        bindingList,
        source: syntheticTemplateSource
    };

}

/**
 * @param {LayerJavascriptNode | null} styleTemplateNode
 */
function styleSourceRead(styleTemplateNode) {
    //Returning the one static CSS segment or an empty stylesheet when styles are absent.
    return String(styleTemplateNode?.quasi?.quasis?.[0]?.templateValue?.cooked ?? '');

}

/**
 * @param {unknown} valueData
 * @param {string} identifierPrefix
 */
function planIdentifierPrefixApply(valueData, identifierPrefix) {
    if (Array.isArray(valueData)) {
        for (const childValue of valueData) {
            planIdentifierPrefixApply(childValue, identifierPrefix);

        }

        return;

    }

    if (typeof valueData !== 'object' || valueData === null) {
        return;

    }

    const valueRecord = /** @type {Record<string, unknown>} */ (valueData);

    //Namespacing compiler markers so nested templates cannot collide with their owner.
    for (const identifierName of ['bindingId', 'nodeId']) {
        if (typeof valueRecord[identifierName] === 'string') {
            valueRecord[identifierName] = `${identifierPrefix}:${valueRecord[identifierName]}`;

        }

    }

    for (const childValue of Object.values(valueRecord)) {
        planIdentifierPrefixApply(childValue, identifierPrefix);

    }

}

/**
 * @param {unknown} valueData
 */
function runtimeExpressionMarkersApply(valueData) {
    if (Array.isArray(valueData)) {
        for (const childValue of valueData) {
            runtimeExpressionMarkersApply(childValue);

        }

        return;

    }

    if (typeof valueData !== 'object' || valueData === null) {
        return;

    }

    const valueRecord = /** @type {Record<string, unknown>} */ (valueData);

    if (typeof valueRecord.sourceMarker === 'string' && Object.hasOwn(valueRecord, 'expression')) {
        valueRecord.expression = {
            type: 'Identifier',
            name: valueRecord.sourceMarker
        };
        delete valueRecord.sourceMarker;

    }

    for (const childValue of Object.values(valueRecord)) {
        runtimeExpressionMarkersApply(childValue);

    }

}

/**
 * @param {string} componentSource
 * @param {LayerJavascriptNode} templateNode
 * @param {Map<string, string>} layerBindingMap
 * @param {Map<string, string>} componentBindingMap
 * @param {{componentId: string, file?: string}} compilerOptions
 * @param {string} identifierPrefix
 */
function structuralTemplatePlanCompile(
    componentSource,
    templateNode,
    layerBindingMap,
    componentBindingMap,
    compilerOptions,
    identifierPrefix
) {
    const templateData = htmlTemplateCompileSourceCreate(
        componentSource,
        templateNode,
        layerBindingMap,
        componentBindingMap,
        compilerOptions.file
    );
    const legacyComponentData = layerComponentCompile(
        `<template>${templateData.source}</template>`,
        compilerOptions
    );
    const componentData = /** @type {Record<string, unknown>} */ (mutableDataCopy(legacyComponentData));
    const bindingMap = new Map(templateData.bindingList.map(function bindingMapEntryCreate(bindingData) {
        //Pairing the nested compiler marker with its native interpolation metadata.
        return [bindingData.marker, bindingData];

    }));
    const structuralPlanMap = structuralPlanMapCreate(
        componentSource,
        templateData.bindingList,
        layerBindingMap,
        componentBindingMap,
        compilerOptions,
        identifierPrefix
    );
    const templatePlan = renderPlanBindingsApply(
        /** @type {unknown[]} */ (componentData.template),
        bindingMap,
        structuralPlanMap
    );

    planIdentifierPrefixApply(templatePlan, identifierPrefix);
    runtimeExpressionMarkersApply(templatePlan);

    return {
        strings: (templateNode.quasi?.quasis ?? []).map(function staticTemplatePartRead(quasiNode) {
            //Retaining static strings so runtime callbacks cannot replace compiled HTML.
            return String(quasiNode.templateValue?.cooked ?? '');

        }),
        markers: templateData.bindingList.map(function markerNameRead(bindingData) {
            //Publishing marker order for the corresponding runtime template values.
            return bindingData.marker;

        }),
        template: templatePlan
    };

}

/**
 * @param {string} componentSource
 * @param {LayerJavascriptBinding[]} bindingList
 * @param {Map<string, string>} layerBindingMap
 * @param {Map<string, string>} componentBindingMap
 * @param {{componentId: string, file?: string}} compilerOptions
 * @param {string} identifierPrefix
 */
function structuralPlanMapCreate(
    componentSource,
    bindingList,
    layerBindingMap,
    componentBindingMap,
    compilerOptions,
    identifierPrefix
) {
    //Compiling each discovered structural callback into an isolated nested plan.
    const structuralPlanMap = new Map();

    for (const bindingData of bindingList) {
        const structureData = bindingData.structure;

        if (structureData === undefined) {
            continue;

        }

        if (structureData.kind === 'when') {
            const truthyPlan = structuralTemplatePlanCompile(
                componentSource,
                structureData.truthyTemplate,
                layerBindingMap,
                componentBindingMap,
                compilerOptions,
                `${identifierPrefix}:${bindingData.marker}:truthy`
            );
            let falsyPlan = null;

            if (structureData.falsyTemplate !== null) {
                falsyPlan = structuralTemplatePlanCompile(
                    componentSource,
                    structureData.falsyTemplate,
                    layerBindingMap,
                    componentBindingMap,
                    compilerOptions,
                    `${identifierPrefix}:${bindingData.marker}:falsy`
                );

            }

            structuralPlanMap.set(bindingData.marker, {
                kind: 'when',
                truthy: truthyPlan,
                falsy: falsyPlan
            });
            continue;

        }

        if ( structureData.kind === 'error-boundary' ){
            //Compiling both lazy branches into isolated renderer-owned plans
            const contentPlan = structuralTemplatePlanCompile(
                componentSource,
                structureData.contentTemplate,
                layerBindingMap,
                componentBindingMap,
                compilerOptions,
                `${identifierPrefix}:${bindingData.marker}:content`
            );
            const fallbackPlan = structuralTemplatePlanCompile(
                componentSource,
                structureData.fallbackTemplate,
                layerBindingMap,
                componentBindingMap,
                compilerOptions,
                `${identifierPrefix}:${bindingData.marker}:fallback`
            );

            structuralPlanMap.set( bindingData.marker, {
                kind: String( 'error-boundary' ),
                content: contentPlan,
                fallback: fallbackPlan
            });
            continue;

        }

        if ( structureData.kind === 'component' ){
            const componentSlotPlans = Object.create( null );

            //Compiling each declared slot through the same isolated template pipeline
            for ( const [slotName, slotTemplateNode] of Object.entries( structureData.slots ) ){
                componentSlotPlans[slotName] = structuralTemplatePlanCompile(
                    componentSource,
                    /** @type {LayerJavascriptNode} */ ( slotTemplateNode ),
                    layerBindingMap,
                    componentBindingMap,
                    compilerOptions,
                    `${identifierPrefix}:${bindingData.marker}:slot:${slotName}`
                );

            }

            structuralPlanMap.set( bindingData.marker, {
                kind: String( 'component' ),
                slots: componentSlotPlans
            });
            continue;

        }

        const itemPlan = structuralTemplatePlanCompile(
            componentSource,
            structureData.itemTemplate,
            layerBindingMap,
            componentBindingMap,
            compilerOptions,
            `${identifierPrefix}:${bindingData.marker}:item`
        );

        if (itemPlan.template.length !== 1 || itemPlan.template[0]?.kind !== 'element') {
            componentErrorThrow(
                'repeat item renderer must contain one root element.',
                compilerOptions.file,
                structureData.itemTemplate
            );

        }

        structuralPlanMap.set(bindingData.marker, {
            kind: 'repeat',
            item: itemPlan
        });

    }

    return structuralPlanMap;

}

/**
 * @param {unknown[]} planList
 * @param {Map<string, LayerJavascriptBinding>} bindingMap
 * @param {Map<string, Record<string, unknown>>} structuralPlanMap
 * @returns {Record<string, unknown>[]}
 */
function renderPlanBindingsApply(planList, bindingMap, structuralPlanMap) {
    const resultPlanList = [];

    for (const unknownPlanData of planList) {
        const planData = /** @type {Record<string, unknown>} */ (unknownPlanData);

        if (planData.kind === 'text') {
            let bufferedPartList = /** @type {Record<string, unknown>[]} */ ([]);

            function bufferedTextFlush() {
                //Emitting scalar text collected before the next structural child boundary.
                if (bufferedPartList.length === 0) {
                    return;

                }

                resultPlanList.push({
                    ...planData,
                    parts: bufferedPartList
                });
                bufferedPartList = [];

            }

            for (const partData of /** @type {Record<string, unknown>[]} */ (planData.parts)) {
                const expressionNode = /** @type {LayerExpressionNode | undefined} */ (partData.expression);
                let bindingData;

                //Resolving only compiler-owned marker identifiers in text parts.
                if (expressionNode?.type === 'Identifier' && expressionNode.name !== undefined) {
                    bindingData = bindingMap.get(expressionNode.name);

                }

                if (bindingData?.structure !== undefined) {
                    const structuralPlan = structuralPlanMap.get(bindingData.marker);

                    if (structuralPlan === undefined) {
                        throw new TypeError(`Missing structural plan for ${bindingData.marker}.`);

                    }

                    bufferedTextFlush();
                    resultPlanList.push({
                        ...structuralPlan,
                        bindingId: partData.bindingId,
                        expression: {
                            type: 'Identifier',
                            name: bindingData.marker
                        },
                        sourceMarker: bindingData.marker
                    });
                    continue;

                } else if (bindingData !== undefined) {
                    partData.sourceMarker = bindingData.marker;
                    partData.expression = bindingData.expression;

                }

                bufferedPartList.push(partData);

            }

            bufferedTextFlush();
            continue;

        }

        if (planData.kind !== 'element') {
            resultPlanList.push(planData);
            continue;

        }

        const remainingAttributeBindings = [];

        for (const attributeBindingData of /** @type {Record<string, unknown>[]} */ (planData.attributeBindings)) {
            const expressionNode = /** @type {LayerExpressionNode} */ (attributeBindingData.expression);
            let bindingData;

            //Resolving the native interpolation that owns this attribute boundary.
            if (expressionNode.type === 'Identifier' && expressionNode.name !== undefined) {
                bindingData = bindingMap.get(expressionNode.name);

            }

            if (bindingData === undefined) {
                remainingAttributeBindings.push(attributeBindingData);
                continue;

            }

            attributeBindingData.sourceMarker = bindingData.marker;
            attributeBindingData.expression = bindingData.expression;

            if (bindingData.kind === 'ref') {
                planData.refBinding = {
                    bindingId: attributeBindingData.bindingId,
                    sourceMarker: bindingData.marker,
                    expression: bindingData.expression
                };
                continue;

            }

            attributeBindingData.mode = bindingData.kind;
            remainingAttributeBindings.push(attributeBindingData);

        }

        planData.attributeBindings = remainingAttributeBindings;

        for (const bindingCollectionName of ['eventBindings', 'modelBindings']) {
            for (const bindingPlanData of /** @type {Record<string, unknown>[]} */ (
                planData[bindingCollectionName] ?? []
            )) {
                const expressionNode = /** @type {LayerExpressionNode} */ (bindingPlanData.expression);
                let bindingData;

                //Resolving compiler markers shared by event and model bindings.
                if (expressionNode.type === 'Identifier' && expressionNode.name !== undefined) {
                    bindingData = bindingMap.get(expressionNode.name);

                }

                if (bindingData !== undefined) {
                    bindingPlanData.sourceMarker = bindingData.marker;
                    bindingPlanData.expression = bindingData.expression;

                }

            }

        }

        planData.children = renderPlanBindingsApply(
            /** @type {unknown[]} */ (planData.children),
            bindingMap,
            structuralPlanMap
        );
        resultPlanList.push(planData);

    }

    return resultPlanList;

}

/**
 * Compile one canonical .layer.js component without evaluating developer code.
 *
 * @param {string} componentSource
 * @param {{componentId: string, file?: string}} compilerOptions
 * @returns {Readonly<LayerJavascriptComponentData>}
 */
export function layerJavascriptComponentCompile(componentSource, compilerOptions) {
    let programNode;

    try {
        //Parsing the complete component as ESM with stable source locations.
        programNode = javascriptNodeNormalize(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (parse(componentSource, {
            ecmaVersion: 'latest',
            locations: true,
            sourceType: 'module'
        }))));

    } catch (parseError) {
        let errorColumn;
        const errorLocation = /** @type {{loc?: {line?: number, column?: number}}} */ (parseError).loc;

        //Normalizing the optional Acorn column to a one-based public diagnostic.
        if (errorLocation?.column !== undefined) {
            errorColumn = errorLocation.column + 1;

        }

        throw new LayerCompilerError(
            'LAYER_JAVASCRIPT_INVALID',
            'The .layer.js component is not valid JavaScript ESM.',
            {
                cause: parseError,
                file: compilerOptions.file,
                line: errorLocation?.line,
                column: errorColumn
            }
        );

    }

    try {
        //Applying the common ban on dynamic imports and runtime code generation.
        layerComponentScriptValidate(componentSource);

    } catch (scriptError) {
        throw new LayerCompilerError(
            /** @type {{code?: string}} */ (scriptError).code ?? 'LAYER_SCRIPT_INVALID',
            /** @type {{message?: string}} */ (scriptError).message ?? 'The component script is invalid.',
            {cause: scriptError, file: compilerOptions.file}
        );

    }

    const layerBindingMap = layerImportBindingsCollect(programNode, compilerOptions.file);
    const componentBindingMap = componentImportBindingsCollect( programNode );
    const htmlBindingName = layerBindingMap.get('html');

    if (htmlBindingName === undefined) {
        componentErrorThrow('The component must import html from @solcorp/layer.', compilerOptions.file, programNode);

    }

    const componentFunctionNode = componentFunctionFind(programNode, layerBindingMap, compilerOptions.file);
    const templateNode = componentTemplateFind(componentFunctionNode, htmlBindingName, compilerOptions.file);
    const metadataData = componentMetadataRead(programNode, layerBindingMap, compilerOptions.file);
    const templateData = htmlTemplateCompileSourceCreate(
        componentSource,
        templateNode,
        layerBindingMap,
        componentBindingMap,
        compilerOptions.file
    );
    const styleSource = styleSourceRead(metadataData.styleTemplate);
    let legacyComponentSource = `<template>${templateData.source}</template>`;

    if (styleSource.length > 0) {
        legacyComponentSource += `<style scoped>${styleSource}</style>`;

    }

    const legacyComponentData = layerComponentCompile(legacyComponentSource, compilerOptions);
    const componentData = /** @type {Record<string, unknown>} */ (mutableDataCopy(legacyComponentData));

    //Indexing native interpolations before replacing internal compatibility markers.
    const bindingMap = new Map(templateData.bindingList.map(function bindingMapEntryCreate(bindingData) {
        //Pairing each deterministic marker with its original expression contract.
        return [bindingData.marker, bindingData];

    }));

    const structuralPlanMap = structuralPlanMapCreate(
        componentSource,
        templateData.bindingList,
        layerBindingMap,
        componentBindingMap,
        compilerOptions,
        'structure'
    );

    componentData.template = renderPlanBindingsApply(
        /** @type {unknown[]} */ (componentData.template),
        bindingMap,
        structuralPlanMap
    );
    componentData.format = 'layer.js';
    componentData.script = {
        source: componentSource
    };
    componentData.module = {
        componentName: componentFunctionNode.id?.name ?? null,
        metadata: metadataData.metadata
    };
    componentData.sourceMap = {
        .../** @type {Record<string, unknown>} */ (componentData.sourceMap),
        expressions: templateData.bindingList.map(function bindingSourceCreate(bindingData) {
            //Publishing stable source offsets without exposing parser-owned nodes.
            return {
                marker: bindingData.marker,
                kind: bindingData.kind,
                name: bindingData.name,
                source: bindingData.source,
                start: bindingData.start,
                end: bindingData.end,
                line: bindingData.line,
                column: bindingData.column
            };

        })
    };

    return /** @type {Readonly<LayerJavascriptComponentData>} */ (
        immutableDataCreate(componentData)
    );

}
