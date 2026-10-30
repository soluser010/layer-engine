import {createHash} from 'node:crypto';
import {
    lstat,
    readFile
} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
    layerComponentCompile,
    layerJavascriptComponentCompile,
    layerStylesheetCompile
} from '@solcorp/layer-compiler';
import {build} from 'esbuild-wasm';
import {LayerCliError} from './cli-error.js';
import {layerComponentDeclarationCreate} from './component-declaration.js';
import {frameworkVersionsRead} from './package-versions.js';

const layerRenderEntryFile = fileURLToPath(import.meta.resolve('@solcorp/layer-render'));

const layerPublicEntryFile = fileURLToPath(import.meta.resolve('@solcorp/layer'));
/**
 * @param {string | Uint8Array} contentData
 */
function contentHashCreate(contentData) {
    //Producing the same deterministic identity scheme as the project manifest.
    return createHash('sha256').update(contentData).digest('hex');

}

/**
 * @param {string} rootDirectory
 * @param {string} fileData
 */
function relativeFileNormalize(rootDirectory, fileData) {
    //Normalizing artifact and source-map paths independently from the host platform.
    return path.relative(rootDirectory, fileData).replaceAll('\\', '/');

}

/**
 * @param {string} sourceDirectory
 * @param {string} absoluteFile
 */
function sourceFileBoundaryCheck(sourceDirectory, absoluteFile) {
    //Comparing resolved paths before the bundler is allowed to read an import.
    const relativeFile = path.relative(sourceDirectory, absoluteFile);

    if (relativeFile === '' || relativeFile.startsWith('..') || path.isAbsolute(relativeFile)) {
        throw new LayerCliError(
            'CLI_BUILD_IMPORT_DENIED',
            'A .layer component import must stay inside the configured source directory.'
        );

    }

}


/**
 * @param {string} fileData
 */
function componentFileSuffixGet(fileData) {
    //Selecting the longest canonical suffix before the legacy compatibility suffix.
    if (fileData.endsWith('.layer.js')) {
        return '.layer.js';

    }

    if (fileData.endsWith('.layer')) {
        return '.layer';

    }

    return null;

}

/**
 * @param {Readonly<Record<string, unknown>>} componentData
 */
function browserComponentDataCreate(componentData) {
    const browserData = structuredClone(componentData);
    const styleData = /** @type {Record<string, unknown>} */ (browserData.style);

    /** @param {unknown} valueData */
    function runtimeExpressionApply(valueData) {
        if (Array.isArray(valueData)) {
            for (const childValue of valueData) {
                runtimeExpressionApply(childValue);

            }

            return;

        }

        if (typeof valueData !== 'object' || valueData === null) {
            return;

        }

        const valueRecord = /** @type {Record<string, unknown>} */ (valueData);

        //Replacing source expressions with values captured by the html tag at runtime.
        if (typeof valueRecord.sourceMarker === 'string' && Object.hasOwn(valueRecord, 'expression')) {
            valueRecord.expression = {
                type: 'Identifier',
                name: valueRecord.sourceMarker
            };
            delete valueRecord.sourceMarker;

        }

        for (const childValue of Object.values(valueRecord)) {
            runtimeExpressionApply(childValue);

        }

    }

    if (browserData.format === 'layer.js') {
        runtimeExpressionApply(browserData.template);

    }

    //Removing raw author source while retaining render plans, CSS, and diagnostics.
    return {
        ...browserData,
        script: {source: ''},
        style: {
            ...styleData,
            source: ''
        }
    };

}

/**
 * @param {Readonly<Record<string, unknown>>} componentData
 */
function componentModuleSourceCreate(componentData) {
    //Linking trusted setup exports to the compiled render plan through the public runtime.
    const serializedComponent = JSON.stringify(browserComponentDataCreate(componentData));
    const javascriptComponentStatus = componentData.format === 'layer.js';
    let definitionSource = `
const __layerDefinitionProperties = __layerUserModule.props ?? {};
const __layerDefinitionEvents = __layerUserModule.emits ?? [];
const __layerDefinitionSetup = __layerUserModule.setup;
`;

    if (javascriptComponentStatus) {
        definitionSource = `
import {
    layerComponentDefinitionCheck as __layerComponentDefinitionCheck,
    layerTemplateResultCheck as __layerTemplateResultCheck
} from '@solcorp/layer';

function __layerSchemaValueCheck(valueData, schemaData) {
    if (schemaData === null || schemaData === undefined) {
        return true;
    }
    if (typeof schemaData === 'string') {
        if (schemaData === 'array') {
            return Array.isArray(valueData);
        }
        if (schemaData === 'integer') {
            return Number.isInteger(valueData);
        }
        if (schemaData === 'object') {
            return valueData !== null && typeof valueData === 'object' && !Array.isArray(valueData);
        }
        return typeof valueData === schemaData;
    }
    if (!schemaData || typeof schemaData !== 'object' || Array.isArray(schemaData)) {
        return false;
    }
    if (Object.hasOwn(schemaData, 'type')) {
        return __layerSchemaValueCheck(valueData, schemaData.type);
    }
    if (!valueData || typeof valueData !== 'object' || Array.isArray(valueData)) {
        return false;
    }
    const schemaEntries = Object.entries(schemaData);
    const valueKeys = Object.keys(valueData);
    if (valueKeys.length !== schemaEntries.length) {
        return false;
    }
    for (const [fieldName, fieldSchema] of schemaEntries) {
        if (!Object.hasOwn(valueData, fieldName) ||
            !__layerSchemaValueCheck(valueData[fieldName], fieldSchema)) {
            return false;
        }
    }
    return true;
}

function __layerPropertyContractsCreate(propertySource) {
    const propertyContracts = {};
    for (const [propertyName, propertyData] of Object.entries(propertySource ?? {})) {
        const propertyContract = {};
        const propertyRequired = propertyData && typeof propertyData === 'object' &&
            propertyData.required === true;
        if (propertyRequired) {
            propertyContract.required = true;
        }
        if (propertyData && typeof propertyData === 'object' && Object.hasOwn(propertyData, 'default')) {
            propertyContract.default = propertyData.default;
        }
        if (propertyData && typeof propertyData === 'object' && typeof propertyData.type === 'string') {
            propertyContract.validate = function(propertyValue) {
                if (propertyValue === undefined && !propertyRequired) {
                    return true;
                }
                return __layerSchemaValueCheck(propertyValue, propertyData.type);
            };
        }
        propertyContracts[propertyName] = propertyContract;
    }
    return propertyContracts;
}

function __layerEventContractsCreate(eventSource) {
    const eventContracts = {};
    if (Array.isArray(eventSource)) {
        for (const eventName of eventSource) {
            eventContracts[eventName] = null;
        }
        return eventContracts;
    }
    if (eventSource && typeof eventSource === 'object') {
        for (const [eventName, eventSchema] of Object.entries(eventSource)) {
            eventContracts[eventName] = function(payloadData) {
                return __layerSchemaValueCheck(payloadData, eventSchema);
            };
        }
    }
    return eventContracts;
}

const __layerSignalReadSymbol = Symbol.for('solcorp.layer.signal.read');

function __layerReadonlySignalCreate(signalData) {
    return Object.freeze({
        [__layerSignalReadSymbol]() {
            return signalData.get();
        },
        get() {
            return signalData.get();
        },
        peek() {
            return signalData.peek();
        }
    });
}

function __layerObservableStateCreate(runtimeHandle, fieldNames, ownedStateDisposers) {
    const signalByField = {};
    const readonlyByField = {};
    const initialSnapshot = runtimeHandle.snapshot();

    for (const fieldName of fieldNames) {
        const fieldSignal = __layerSignalCreate(initialSnapshot[fieldName]);
        signalByField[fieldName] = fieldSignal;
        readonlyByField[fieldName] = __layerReadonlySignalCreate(fieldSignal);
    }

    const subscriptionDispose = runtimeHandle.subscribe(function(snapshotData) {
        for (const fieldName of fieldNames) {
            signalByField[fieldName].set(snapshotData[fieldName]);
        }
    });
    let disposedStatus = false;

    const stateDispose = function() {
        if (disposedStatus) {
            return false;
        }

        disposedStatus = true;
        ownedStateDisposers.delete(stateDispose);
        subscriptionDispose();
        runtimeHandle.dispose();

        return true;
    };

    ownedStateDisposers.add(stateDispose);

    return Object.freeze({
        signals: Object.freeze(readonlyByField),
        dispose: stateDispose
    });
}

function __layerQueryHandleCreate(runtimeHandle, ownedStateDisposers) {
    const observableState = __layerObservableStateCreate(
        runtimeHandle,
        ['data', 'pending', 'error', 'updatedAt', 'stale', 'status', 'source'],
        ownedStateDisposers
    );

    return Object.freeze({
        operation: runtimeHandle.operation,
        data: observableState.signals.data,
        pending: observableState.signals.pending,
        error: observableState.signals.error,
        updatedAt: observableState.signals.updatedAt,
        stale: observableState.signals.stale,
        status: observableState.signals.status,
        source: observableState.signals.source,
        refresh: runtimeHandle.refresh,
        cancel: runtimeHandle.cancel,
        cacheUpdate: runtimeHandle.cacheUpdate,
        cacheInsert: runtimeHandle.cacheInsert,
        cacheRemove: runtimeHandle.cacheRemove,
        settled: runtimeHandle.settled,
        dispose: observableState.dispose
    });
}

function __layerCommandHandleCreate(runtimeHandle, ownedStateDisposers) {
    const observableState = __layerObservableStateCreate(
        runtimeHandle,
        ['pending', 'error', 'lastResult', 'commandId', 'state'],
        ownedStateDisposers
    );

    return Object.freeze({
        operation: runtimeHandle.operation,
        pending: observableState.signals.pending,
        error: observableState.signals.error,
        lastResult: observableState.signals.lastResult,
        commandId: observableState.signals.commandId,
        state: observableState.signals.state,
        execute: runtimeHandle.execute,
        cancel: runtimeHandle.cancel,
        settled: runtimeHandle.settled,
        dispose: observableState.dispose
    });
}

function __layerComponentApiCreate(applicationApi, disposeRegister) {
    if (!applicationApi || typeof applicationApi !== 'object') {
        return null;
    }

    if (typeof applicationApi.query !== 'function' || typeof applicationApi.command !== 'function' ||
        typeof applicationApi.sync !== 'function') {
        throw new TypeError('The Layer application API context is invalid.');
    }

    const ownedStateDisposers = new Set();

    disposeRegister(function componentApiDispose() {
        for (const stateDispose of [...ownedStateDisposers]) {
            stateDispose();
        }

        ownedStateDisposers.clear();
    });

    return Object.freeze({
        query(queryOptions) {
            const runtimeHandle = applicationApi.query(queryOptions);

            return __layerQueryHandleCreate(runtimeHandle, ownedStateDisposers);
        },
        command(commandOptions) {
            const runtimeHandle = applicationApi.command(commandOptions);

            return __layerCommandHandleCreate(runtimeHandle, ownedStateDisposers);
        },
        sync(operationName, payloadData, syncOptions = {}) {
            return applicationApi.sync(operationName, payloadData, syncOptions);
        }
    });
}

const __layerAuthorDefinition = __layerUserModule.default;

//Function for adapting the shared viewport into a component-owned reactive snapshot
function __layerComponentViewportCreate(viewportController, setupContext){
    //Keeping build-time SSR free from browser resources
    if (!viewportController || setupContext.environment !== 'browser') {
        return null;

    }

    //Acquiring a local owner so lazy chunks do not share signal dependency graphs
    const viewportOwner = viewportController.createOwner();
    const viewportSignal = __layerSignalCreate(viewportOwner.getState());
    viewportOwner.subscribe(function viewportStateApply(viewportState){
        //Publishing only the geometry bindings observed by this component
        viewportSignal.set(viewportState);

    });
    setupContext.onDisposed(function viewportOwnerDispose(){
        //Releasing subscriptions and registrations with the component lifecycle
        viewportOwner.dispose();

    });

    //CallBack THE OBJECT
    return Object.freeze({
        ...viewportOwner,
        state: __layerReadonlySignalCreate(viewportSignal)
    });

}

//Function for acquiring component-owned link resources only in a browser host
function __layerComponentLinksCreate(linksController, setupContext){
    //Keeping SSR and isolated hosts free from browser navigation side effects
    if (!linksController || setupContext.environment !== 'browser') {
        return null;

    }
    const linksOwner = linksController.createOwner();
    setupContext.onDisposed(function(){
        //Closing only this component's viewer at unmount
        linksOwner.dispose();

    });

    //CallBack THE OBJECT
    return linksOwner;

}

if (!__layerComponentDefinitionCheck(__layerAuthorDefinition)) {
    throw new TypeError('The default .layer.js export is not a Layer component.');
}

const __layerDefinitionProperties = __layerPropertyContractsCreate(__layerUserModule.properties);
const __layerDefinitionEvents = __layerEventContractsCreate(__layerUserModule.events);
const __layerDefinitionSetup = function(setupContext) {
    const applicationApi = setupContext.inject('layer.api');
    const componentApi = __layerComponentApiCreate(applicationApi, setupContext.onDisposed);
    const componentViewport = __layerComponentViewportCreate(setupContext.inject('layer.viewport'), setupContext);
    const componentContext = Object.freeze({
        environment: setupContext.environment,
        slots: setupContext.slots,
        emit: setupContext.emit,
        provide: setupContext.provide,
        consume: setupContext.inject,
        get: setupContext.inject,
        use: setupContext.inject,
        api: componentApi,
        viewport: componentViewport,
        keyboard: componentViewport?.keyboard ?? null,
        links: __layerComponentLinksCreate(setupContext.inject('layer.links'), setupContext),
        command: setupContext.inject('layer.command'),
        events: setupContext.inject('layer.events'),
        navigate: setupContext.inject('layer.navigate'),
        route: setupContext.inject('layer.route'),
        storage: setupContext.inject('layer.storage'),
        capabilities: setupContext.inject('layer.capabilities'),
        logger: setupContext.inject('layer.logger'),
        onMount: setupContext.onMounted,
        onHydrate: setupContext.onHydrated,
        onUpdate: setupContext.onUpdated,
        onDestroy: setupContext.onDisposed
    });
    const templateResult = __layerAuthorDefinition.render(setupContext.props, componentContext);

    if (!__layerTemplateResultCheck(templateResult)) {
        throw new TypeError('A .layer.js component must return its html tagged template.');
    }

    const expressionList = __layerCompiledComponent.sourceMap.expressions ?? [];

    if (templateResult.values.length !== expressionList.length) {
        throw new TypeError('The runtime template does not match its compiled interpolation plan.');
    }

    const renderScope = {};

    for (const [expressionIndex, expressionData] of expressionList.entries()) {
        renderScope[expressionData.marker] = templateResult.values[expressionIndex];
    }

    return renderScope;
};
`;

    }

    return `
import {
    layerComponentContextCreate as __layerComponentContextCreate,
    layerComponentDefinitionCreate as __layerComponentDefinitionCreate,
    layerComponentInvocationCreate as __layerComponentInvocationCreate,
    layerComponentInstanceHydrate as __layerComponentInstanceHydrate,
    layerComponentInstanceMount as __layerComponentInstanceMount,
    layerComponentInstanceRenderToString as __layerComponentInstanceRenderToString,
    signal as __layerSignalCreate
} from '@solcorp/layer-render';
import * as __layerUserModule from 'layer-script';
export * from 'layer-script';

const __layerCompiledComponent = ${serializedComponent};
${definitionSource}

export {__layerCompiledComponent as component};
export const css = __layerCompiledComponent.style.css;
export const definition = __layerComponentDefinitionCreate({
    component: __layerCompiledComponent,
    props: __layerDefinitionProperties,
    emits: __layerDefinitionEvents,
    setup: __layerDefinitionSetup
});

export default function componentInvoke(instanceOptions = {}) {
    return __layerComponentInvocationCreate(definition, instanceOptions);
}

function __layerInstanceOptionsCreate(instanceOptions = {}) {
    const contextValues = instanceOptions.context ?? {};
    const context = __layerComponentContextCreate({values: contextValues});

    return {
        ...instanceOptions,
        context
    };
}

export function mount(rootNode, instanceOptions = {}) {
    return __layerComponentInstanceMount(
        definition,
        rootNode,
        __layerInstanceOptionsCreate(instanceOptions)
    );
}

export function hydrate(rootNode, instanceOptions = {}) {
    return __layerComponentInstanceHydrate(
        definition,
        rootNode,
        __layerInstanceOptionsCreate(instanceOptions)
    );
}

export function renderToString(instanceOptions = {}) {
    return __layerComponentInstanceRenderToString(
        definition,
        __layerInstanceOptionsCreate(instanceOptions)
    );
}
`;

}

/**
 * @param {object} bundleOptions
 * @param {string} bundleOptions.rootDirectory
 * @param {string} bundleOptions.sourceDirectory
 * @param {string} bundleOptions.pageFile
 * @param {Readonly<Record<string, unknown>>} bundleOptions.componentData
 * @param {string} bundleOptions.outputFile
 * @param {string} bundleOptions.operationFacadeSource
 */
export async function layerComponentBundleCreate(bundleOptions) {
    //Rejecting incompatible compiler/runtime installations before generating browser bindings
    frameworkVersionsRead();
    const componentRecordMap = new Map();
    const externalStyleRequestMap = new Map();
    const externalStyleRecordMap = new Map();
    const assetArtifactMap = new Map();
    const rootRelativeFile = relativeFileNormalize(bundleOptions.rootDirectory, bundleOptions.pageFile);

    componentRecordMap.set(rootRelativeFile, {
        absoluteFile: bundleOptions.pageFile,
        componentData: bundleOptions.componentData
    });

    /**
     * @param {string} absoluteFile
     */
    async function componentRecordGet(absoluteFile) {
        //Loading each nested component once under a deterministic project-relative key.
        sourceFileBoundaryCheck(bundleOptions.sourceDirectory, absoluteFile);

        const componentSuffix = componentFileSuffixGet(absoluteFile);

        if (componentSuffix === null) {
            throw new LayerCliError('CLI_BUILD_IMPORT_DENIED', 'Only .layer.js and legacy .layer files can use the component loader.');

        }

        const relativeFile = relativeFileNormalize(bundleOptions.rootDirectory, absoluteFile);
        const currentRecord = componentRecordMap.get(relativeFile);

        if (currentRecord !== undefined) {
            return currentRecord;

        }

        const componentSource = await readFile(absoluteFile, 'utf8');
        const descriptiveIdentifier = relativeFile
            .slice(0, -componentSuffix.length)
            .replace(/[^A-Za-z0-9._/-]/g, '-');
        const componentIdentifier = `${descriptiveIdentifier.slice(0, 140)}-${contentHashCreate(relativeFile).slice(0, 12)}`;
        let componentData;

        //Selecting the canonical JavaScript compiler while preserving legacy SFC compatibility.
        if (componentSuffix === '.layer.js') {
            componentData = layerJavascriptComponentCompile(componentSource, {
                componentId: componentIdentifier,
                file: relativeFile
            });

        } else {
            componentData = layerComponentCompile(componentSource, {
                componentId: componentIdentifier,
                file: relativeFile
            });

        }
        const componentRecord = {
            absoluteFile,
            componentData
        };

        componentRecordMap.set(relativeFile, componentRecord);

        return componentRecord;

    }

    try {
        const buildResult = await build({
            absWorkingDir: bundleOptions.rootDirectory,
            bundle: true,
            charset: 'utf8',
            entryPoints: ['layer-entry'],
            format: 'esm',
            legalComments: 'eof',
            logLevel: 'silent',
            outfile: path.join(bundleOptions.rootDirectory, bundleOptions.outputFile),
            platform: 'browser',
            sourcemap: 'linked',
            sourcesContent: false,
            target: ['es2022'],
            treeShaking: true,
            write: false,
            plugins: [{
                name: 'layer-component',
                setup(buildApi) {
                    buildApi.onResolve({filter: /^layer-entry$/}, function layerEntryResolve() {
                        //Starting the bundle from the requested page without exposing its absolute path.
                        return {
                            namespace: 'layer-component',
                            path: rootRelativeFile
                        };

                    });

                    buildApi.onResolve({filter: /^layer-script$/, namespace: 'layer-component'}, function layerScriptResolve(resolveData) {
                        //Pairing each generated wrapper with the original script from the same component.
                        return {
                            namespace: 'layer-script',
                            path: resolveData.importer
                        };

                    });

                    buildApi.onResolve({filter: /^@solcorp\/layer-render$/, namespace: 'layer-component'}, function layerRenderResolve() {
                        //Resolving the CLI-owned runtime from its declared package dependency.
                        return {
                            namespace: 'file',
                            path: layerRenderEntryFile
                        };

                    });

                    buildApi.onResolve({filter: /^@solcorp\/layer$/}, function layerPublicResolve() {
                        //Resolving the canonical authoring facade without a browser bare import.
                        return {
                            namespace: 'file',
                            path: layerPublicEntryFile
                        };

                    });

                    buildApi.onResolve({filter: /^#layer\/operations$/}, function layerOperationsResolve() {
                        //Providing the generated facade to every component and nested source module.
                        return {
                            namespace: 'layer-operations',
                            path: '#layer/operations'
                        };

                    });

                    buildApi.onResolve({filter: /\.layer(?:\.js)?$/, namespace: 'layer-script'}, async function nestedLayerResolve(resolveData) {
                        //Compiling explicit nested Layer component imports through the same isolated loader.
                        const absoluteFile = path.resolve(resolveData.resolveDir, resolveData.path);
                        const componentRecord = await componentRecordGet(absoluteFile);

                        return {
                            namespace: 'layer-component',
                            path: relativeFileNormalize(bundleOptions.rootDirectory, componentRecord.absoluteFile)
                        };

                    });

                    buildApi.onResolve({
                        filter: /(?:\.layer\.module\.css|\.global\.layer\.css|\.layer\.css|\.module\.css)$/,
                        namespace: 'layer-script'
                    }, async function layerStyleResolve(resolveData) {
                        //Binding a direct stylesheet import to its owning Layer component.
                        const absoluteFile = path.resolve(resolveData.resolveDir, resolveData.path);

                        sourceFileBoundaryCheck(bundleOptions.sourceDirectory, absoluteFile);

                        const componentRecord = componentRecordMap.get(resolveData.importer);

                        if (componentRecord === undefined) {
                            throw new LayerCliError(
                                'CLI_BUILD_STYLE_IMPORT_INVALID',
                                'A Layer stylesheet must be imported directly by a .layer.js component.'
                            );

                        }

                        const styleRequestKey = `${resolveData.importer}:${relativeFileNormalize(
                            bundleOptions.rootDirectory,
                            absoluteFile
                        )}`;

                        externalStyleRequestMap.set(styleRequestKey, {
                            absoluteFile,
                            componentFile: resolveData.importer,
                            componentRecord
                        });

                        return {
                            namespace: 'layer-style',
                            path: styleRequestKey
                        };

                    });

                    buildApi.onResolve({filter: /.*/, namespace: 'layer-script'}, async function sourceImportResolve(resolveData) {
                        if (/** @type {Record<string, unknown> | undefined} */ (resolveData.pluginData)?.layerDefaultResolve === true) {
                            return null;

                        }

                        const importerDirectory = resolveData.resolveDir;
                        const sourceRelative = path.relative(bundleOptions.sourceDirectory, importerDirectory);

                        //Confining relative developer imports before delegating to the standard resolver.
                        if ((resolveData.path.startsWith('./') || resolveData.path.startsWith('../')) &&
                            (sourceRelative === '' || (!sourceRelative.startsWith('..') && !path.isAbsolute(sourceRelative)))) {
                            sourceFileBoundaryCheck(
                                bundleOptions.sourceDirectory,
                                path.resolve(importerDirectory, resolveData.path)
                            );

                        }

                        return buildApi.resolve(resolveData.path, {
                            importer: resolveData.importer,
                            kind: resolveData.kind,
                            namespace: 'file',
                            pluginData: {layerDefaultResolve: true},
                            resolveDir: resolveData.resolveDir
                        });

                    });

                    buildApi.onLoad({filter: /.*/, namespace: 'layer-component'}, async function componentWrapperLoad(loadData) {
                        //Generating a wrapper that exposes component data, CSS, and its definition.
                        const componentRecord = componentRecordMap.get(loadData.path);

                        if (componentRecord === undefined) {
                            throw new Error('The compiled Layer component record is unavailable.');

                        }

                        return {
                            contents: componentModuleSourceCreate(componentRecord.componentData),
                            loader: 'js',
                            resolveDir: path.dirname(componentRecord.absoluteFile)
                        };

                    });

                    buildApi.onLoad({filter: /.*/, namespace: 'layer-script'}, async function componentScriptLoad(loadData) {
                        const componentRecord = componentRecordMap.get(loadData.path);

                        if (componentRecord === undefined) {
                            throw new Error('The Layer component script record is unavailable.');

                        }

                        const scriptData = /** @type {Record<string, unknown>} */ (componentRecord.componentData.script);

                        return {
                            contents: String(scriptData.source),
                            loader: 'js',
                            resolveDir: path.dirname(componentRecord.absoluteFile)
                        };

                    });

                    buildApi.onLoad({filter: /.*/, namespace: 'layer-operations'}, function layerOperationsLoad() {
                        //Bundling operation wrappers without a browser bare import or extra transport.
                        return {
                            contents: bundleOptions.operationFacadeSource,
                            loader: 'js'
                        };

                    });

                    buildApi.onLoad({filter: /.*/, namespace: 'layer-style'}, async function layerStyleLoad(loadData) {
                        const styleRequest = externalStyleRequestMap.get(loadData.path);

                        if (styleRequest === undefined) {
                            throw new LayerCliError('CLI_BUILD_STYLE_IMPORT_INVALID', 'The Layer stylesheet request is unavailable.');

                        }

                        const styleStatus = await lstat(styleRequest.absoluteFile);

                        if (!styleStatus.isFile() || styleStatus.isSymbolicLink() || styleStatus.size > 256 * 1024) {
                            throw new LayerCliError(
                                'CLI_BUILD_STYLE_IMPORT_INVALID',
                                'A Layer stylesheet must be a regular file no larger than 256 KiB.'
                            );

                        }

                        const styleSource = await readFile(styleRequest.absoluteFile, 'utf8');
                        const styleRelativeFile = relativeFileNormalize(bundleOptions.rootDirectory, styleRequest.absoluteFile);
                        const componentData = /** @type {Record<string, unknown>} */ (styleRequest.componentRecord.componentData);
                        const scopeIdentifier = String(componentData.scopeId);
                        const globalStatus = styleRequest.absoluteFile.endsWith('.global.layer.css');
                        const layerStyleStatus = styleRequest.absoluteFile.endsWith('.layer.css') ||
                            styleRequest.absoluteFile.endsWith('.layer.module.css');
                        const moduleStatus = !globalStatus && (
                            layerStyleStatus || styleRequest.absoluteFile.endsWith('.module.css')
                        );
                        const scopedStatus = !globalStatus && layerStyleStatus;
                        const discoveryResult = layerStylesheetCompile(styleSource, {
                            scopeIdentifier,
                            scoped: scopedStatus,
                            modules: moduleStatus,
                            file: styleRelativeFile
                        });
                        const assetUrlMap = /** @type {Record<string, string>} */ ({});

                        for (const assetReference of discoveryResult.assets) {
                            const assetFile = path.resolve(path.dirname(styleRequest.absoluteFile), assetReference);

                            sourceFileBoundaryCheck(bundleOptions.sourceDirectory, assetFile);

                            const assetStatus = await lstat(assetFile);

                            if (!assetStatus.isFile() || assetStatus.isSymbolicLink() || assetStatus.size > 10 * 1024 * 1024) {
                                throw new LayerCliError(
                                    'CLI_BUILD_STYLE_ASSET_INVALID',
                                    'A CSS asset must be a regular file no larger than 10 MiB.'
                                );

                            }

                            const assetContent = await readFile(assetFile);
                            const assetExtension = path.extname(assetFile).toLowerCase();
                            let safeExtension = '.bin';

                            //Retaining only short alphanumeric extensions in public asset names.
                            if (/^\.[a-z0-9]{1,10}$/.test(assetExtension)) {
                                safeExtension = assetExtension;

                            }

                            const assetName = `_layer/assets/${contentHashCreate(assetContent).slice(0, 24)}${safeExtension}`;

                            assetArtifactMap.set(assetName, assetContent);
                            assetUrlMap[assetReference] = `/${assetName}`;

                        }

                        const compiledStyle = layerStylesheetCompile(styleSource, {
                            scopeIdentifier,
                            scoped: scopedStatus,
                            modules: moduleStatus,
                            assetUrlMap,
                            file: styleRelativeFile
                        });

                        externalStyleRecordMap.set(loadData.path, {
                            componentFile: styleRequest.componentFile,
                            css: compiledStyle.css,
                            file: styleRelativeFile,
                            classes: compiledStyle.classes,
                            sourceMap: compiledStyle.sourceMap
                        });

                        return {
                            contents: `const classNames = Object.freeze(${JSON.stringify(compiledStyle.classes)});\n\nexport {classNames};\nexport default classNames;\n`,
                            loader: 'js',
                            resolveDir: path.dirname(styleRequest.absoluteFile)
                        };

                    });

                }
            }]
        });
        const bundleArtifacts = /** @type {Record<string, string | Uint8Array>} */ ({});

        for (const outputData of buildResult.outputFiles ?? []) {
            const outputName = relativeFileNormalize(bundleOptions.rootDirectory, outputData.path);

            bundleArtifacts[outputName] = outputData.text;

        }

        if (!Object.hasOwn(bundleArtifacts, bundleOptions.outputFile) ||
            !Object.hasOwn(bundleArtifacts, `${bundleOptions.outputFile}.map`)) {
            throw new Error('The component bundle did not produce its module and source map.');

        }

        const styleFile = bundleOptions.outputFile.replace(/\.mjs$/, '.css');
        const componentStyleSources = [...componentRecordMap.entries()]
            .sort(function componentStyleSort(firstEntry, secondEntry) {
                //Keeping aggregated scoped CSS stable across import traversal order.
                return firstEntry[0].localeCompare(secondEntry[0]);

            })
            .map(function componentStyleMap([_componentFile, componentRecord]) {
                //Reading only compiled scoped CSS, never the author source section.
                const styleData = /** @type {Record<string, unknown>} */ (componentRecord.componentData.style);

                return String(styleData.css).trim();

            })
            .filter(function componentStylePresent(styleData) {
                //Omitting empty style sections without changing component order.
                return styleData.length > 0;

            });
        const externalStyleSources = [...externalStyleRecordMap.entries()]
            .sort(function externalStyleSort(firstEntry, secondEntry) {
                //Keeping external stylesheet order deterministic across resolver timing.
                return firstEntry[0].localeCompare(secondEntry[0]);

            })
            .map(function externalStyleMap([_styleKey, styleRecord]) {
                //Adding compiler-owned external CSS to the same route asset.
                return String(styleRecord.css).trim();

            })
            .filter(function externalStylePresent(styleData) {
                //Omitting empty external files without changing class module exports.
                return styleData.length > 0;

            });
        const styleContent = [
            ...componentStyleSources,
            ...externalStyleSources
        ].join('\n\n');

        let styleArtifact = '';

        //Ending non-empty CSS with one stable newline for reproducible hashing.
        if (styleContent.length > 0) {
            styleArtifact = `${styleContent}\n`;

        }

        bundleArtifacts[styleFile] = styleArtifact;

        //Publishing content-addressed CSS assets beside generated route artifacts.
        for (const [assetName, assetContent] of assetArtifactMap.entries()) {
            bundleArtifacts[assetName] = assetContent;

        }

        //Creating the conventional declaration beside the executable route module
        const routeDeclarationSource = layerComponentDeclarationCreate( bundleOptions.componentData );

        if ( routeDeclarationSource !== null ){
            const routeDeclarationFile = bundleOptions.outputFile.replace( /\.mjs$/, String( '.d.mts' ) );

            bundleArtifacts[routeDeclarationFile] = routeDeclarationSource;

        }

        //Publishing declarations for every nested source component under one private metadata tree
        for ( const [componentFile, componentRecord] of [...componentRecordMap.entries()].sort(function( firstEntry, secondEntry ){
            //Keeping declaration artifact insertion deterministic
            return firstEntry[0].localeCompare( secondEntry[0] );

        }) ){
            const componentDeclarationSource = layerComponentDeclarationCreate( componentRecord.componentData );

            if ( componentDeclarationSource === null || componentFile.endsWith( String( '.layer.js' ) ) === false ){
                continue;

            }

            const declarationFile = `_layer/types/${componentFile.slice( Number( 0 ), Number( -3 ) )}.d.ts`;

            bundleArtifacts[declarationFile] = componentDeclarationSource;

        }

        return Object.freeze(bundleArtifacts);

    } catch (bundleError) {
        if (bundleError instanceof LayerCliError) {
            throw bundleError;

        }

        let failureReason = 'Unknown bundle failure.';

        //Publishing a bounded bundler diagnostic without leaking internal error objects.
        if (bundleError instanceof Error) {
            failureReason = bundleError.message.slice(0, 500);

        }

        throw new LayerCliError(
            'CLI_BUILD_BUNDLE_FAILED',
            'A .layer browser module could not be bundled.',
            {
                file: rootRelativeFile,
                reason: failureReason
            }
        );

    }

}
