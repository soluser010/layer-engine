import {
    layerComponentHydrate,
    layerComponentMount
} from './dom-renderer.js';
import {layerRenderDiagnosticsCreate} from './diagnostics.js';
import {layerComponentInvocationRegister} from './component-invocation.js';
import {layerComponentRenderToString} from './ssr.js';
import {
    layerCommitWait,
    signal
} from './signals.js';

const componentDefinitionSet = new WeakSet();
const componentContextState = new WeakMap();
const slotContentSet = new WeakSet();
const publicNamePattern = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
const setupNamePattern = /^[A-Za-z_$][A-Za-z0-9_$]{0,79}$/;

/**
 * @param {string} eventName
 */
function componentEventHandlerNameCreate( eventName ){
    //Splitting public event names into the author-facing onEvent option
    const eventNameParts = eventName.split( /[^A-Za-z0-9]+/ ).filter( function( eventNamePart ){
        //Keeping only non-empty event name segments
        return Number( eventNamePart.length ) > Number( 0 );

    });
    let eventHandlerName = String( 'on' );

    //Converting each event segment without changing the declared event itself
    for ( const eventNamePart of eventNameParts ){
        eventHandlerName += eventNamePart.charAt( 0 ).toUpperCase() + eventNamePart.slice( 1 );

    }

    //CallBack THE STRING
    return eventHandlerName;

}

/**
 * @param {unknown} componentData
 */
function componentDataCheck(componentData) {
    return typeof componentData === 'object' && componentData !== null &&
        Array.isArray(/** @type {Record<string, unknown>} */ (componentData).template) &&
        typeof /** @type {Record<string, unknown>} */ (componentData).scopeId === 'string';

}

/**
 * @param {unknown} contextData
 */
function componentContextCheck(contextData) {
    //Recognizing only contexts created and tracked by this runtime.
    return typeof contextData === 'object' && contextData !== null && componentContextState.has(contextData);

}

/**
 * @param {string} contextKey
 */
function contextKeyCheck(contextKey) {
    //Rejecting unbounded or ambiguous public context keys.
    if (!publicNamePattern.test(contextKey)) {
        throw new TypeError('Component context key is invalid.');

    }

}

/**
 * @param {{parent?: object | null, values?: Record<string, unknown>}} [contextOptions]
 */
export function layerComponentContextCreate(contextOptions = {}) {
    const parentContext = contextOptions.parent ?? null;

    if (parentContext !== null && !componentContextCheck(parentContext)) {
        throw new TypeError('Parent component context is invalid.');

    }

    const initialValues = contextOptions.values ?? {};

    if (typeof initialValues !== 'object' || initialValues === null || Array.isArray(initialValues) ||
        Object.keys(initialValues).length > 100) {
        throw new TypeError('Component context values are invalid.');

    }

    const valueMap = new Map();

    //Copying owned context values without sharing the caller's record identity.
    for (const [contextKey, contextValue] of Object.entries(initialValues)) {
        contextKeyCheck(contextKey);
        valueMap.set(contextKey, contextValue);

    }

    const contextData = Object.freeze({
        /** @param {string} contextKey */
        has(contextKey) {
            contextKeyCheck(contextKey);

            //Walking the explicit parent chain without prototype lookup.
            let currentContext = contextData;

            while (currentContext !== null) {
                const currentState = componentContextState.get(currentContext);

                if (currentState?.values.has(contextKey)) {
                    return true;

                }

                currentContext = currentState?.parent ?? null;

            }

            return false;

        },
        /** @param {string} contextKey */
        get(contextKey) {
            contextKeyCheck(contextKey);

            //Returning the closest explicitly provided value in the context chain.
            let currentContext = contextData;

            while (currentContext !== null) {
                const currentState = componentContextState.get(currentContext);

                if (currentState?.values.has(contextKey)) {
                    return currentState.values.get(contextKey);

                }

                currentContext = currentState?.parent ?? null;

            }

            return undefined;

        },
        /** @param {Record<string, unknown>} [childValues] */
        derive(childValues = {}) {
            //Creating an isolated child layer rather than mutating this context.
            return layerComponentContextCreate({
                parent: contextData,
                values: childValues
            });

        }
    });

    componentContextState.set(contextData, {
        parent: parentContext,
        values: valueMap
    });

    return contextData;

}

/**
 * @param {unknown} propContract
 * @param {string} propName
 */
function propContractNormalize(propContract, propName) {
    if (typeof propContract !== 'object' || propContract === null || Array.isArray(propContract)) {
        throw new TypeError(`Component prop ${propName} contract is invalid.`);

    }

    const propRecord = /** @type {Record<string, unknown>} */ (propContract);
    const allowedFieldSet = new Set([
        'default',
        'defaultCreate',
        'required',
        'validate'
    ]);

    for (const fieldName of Object.keys(propRecord)) {
        if (!allowedFieldSet.has(fieldName)) {
            throw new TypeError(`Component prop ${propName} contains unknown metadata.`);

        }

    }

    if (Object.hasOwn(propRecord, 'default') && Object.hasOwn(propRecord, 'defaultCreate')) {
        throw new TypeError(`Component prop ${propName} declares two defaults.`);

    }

    if (propRecord.defaultCreate !== undefined && typeof propRecord.defaultCreate !== 'function') {
        throw new TypeError(`Component prop ${propName} default factory is invalid.`);

    }

    if (propRecord.validate !== undefined && typeof propRecord.validate !== 'function') {
        throw new TypeError(`Component prop ${propName} validator is invalid.`);

    }

    return Object.freeze({
        required: propRecord.required === true,
        hasDefault: Object.hasOwn(propRecord, 'default') || Object.hasOwn(propRecord, 'defaultCreate'),
        defaultValue: propRecord.default,
        defaultCreate: propRecord.defaultCreate ?? null,
        validate: propRecord.validate ?? null
    });

}

/**
 * @param {object} definitionOptions
 * @param {Record<string, unknown>} definitionOptions.component
 * @param {Record<string, unknown>} [definitionOptions.props]
 * @param {readonly string[] | Record<string, ((payloadData: unknown) => boolean) | null>} [definitionOptions.emits]
 * @param {(setupContext: Readonly<Record<string, unknown>>) => Record<string, unknown> | void} [definitionOptions.setup]
 */
export function layerComponentDefinitionCreate(definitionOptions) {
    if (typeof definitionOptions !== 'object' || definitionOptions === null ||
        !componentDataCheck(definitionOptions.component)) {
        throw new TypeError('Component definition is invalid.');

    }

    const allowedDefinitionFieldSet = new Set([
        'component',
        'emits',
        'props',
        'setup'
    ]);

    for (const fieldName of Object.keys(definitionOptions)) {
        if (!allowedDefinitionFieldSet.has(fieldName)) {
            throw new TypeError('Component definition contains unknown metadata.');

        }

    }

    const propSource = definitionOptions.props ?? {};

    if (typeof propSource !== 'object' || propSource === null || Array.isArray(propSource) ||
        Object.keys(propSource).length > 100) {
        throw new TypeError('Component props contract is invalid.');

    }

    const propContracts = Object.create(null);

    //Normalizing every declared prop before the definition becomes public.
    for (const [propName, propContract] of Object.entries(propSource)) {
        if (!setupNamePattern.test(propName) || propName.startsWith('$')) {
            throw new TypeError('Component prop name is invalid.');

        }

        propContracts[propName] = propContractNormalize(propContract, propName);

    }

    const emitSource = definitionOptions.emits ?? [];
    const emitContracts = Object.create(null);
    let emitEntryList;

    //Converting legacy arrays while retaining validator records unchanged
    if ( Array.isArray( emitSource ) ){
        emitEntryList = emitSource.map(function emitNameMap(emitName) {
            //Converting the legacy name list into one validator-free contract entry.
            return [emitName, null];

        });

    } else {
        emitEntryList = Object.entries(emitSource);

    }

    if ((typeof emitSource !== 'object' || emitSource === null) || emitEntryList.length > 100) {
        throw new TypeError('Component emits contract is invalid.');

    }

    const emitSet = new Set();

    //Rejecting ambiguous names and validators before exposing the definition.
    for (const [emitName, emitValidator] of emitEntryList) {
        if (typeof emitName !== 'string' || !publicNamePattern.test(emitName) || emitSet.has(emitName) ||
            (emitValidator !== null && typeof emitValidator !== 'function')) {
            throw new TypeError('Component emit contract is invalid or duplicated.');

        }

        emitSet.add(emitName);
        emitContracts[emitName] = emitValidator;

    }

    if (definitionOptions.setup !== undefined && typeof definitionOptions.setup !== 'function') {
        throw new TypeError('Component setup handler is invalid.');

    }

    const definitionData = Object.freeze({
        component: definitionOptions.component,
        props: Object.freeze(propContracts),
        emits: Object.freeze([...emitSet]),
        emitValidators: Object.freeze(emitContracts),
        setup: definitionOptions.setup ?? null
    });

    componentDefinitionSet.add(definitionData);

    return definitionData;

}

/**
 * @param {Record<string, unknown>} componentData
 * @param {Record<string, unknown>} renderScope
 */
export function layerSlotContentCreate(componentData, renderScope) {
    //Validating both compiled content and its isolated render scope.
    if (!componentDataCheck(componentData) || typeof renderScope !== 'object' ||
        renderScope === null || Array.isArray(renderScope)) {
        throw new TypeError('Slot content is invalid.');

    }

    const slotContent = Object.freeze({
        component: componentData,
        scope: renderScope
    });

    slotContentSet.add(slotContent);

    return slotContent;

}
/**
 * @param {Record<string, unknown>} slotSource
 */
function componentInvocationSlotCollectionCreate( slotSource ){
    const slotCollection = Object.create( null );

    //Converting compiler-owned slot plans into branded component slot content
    for ( const [slotName, slotData] of Object.entries( slotSource ) ){
        //Checking the internal slot plan before it enters the component instance
        if (
            !slotData ||
            typeof slotData !== String( 'object' ) ||
            !Object.hasOwn( slotData, String( 'component' ) ) ||
            !Object.hasOwn( slotData, String( 'scope' ) )
        ){
            //Passing the malformed nested slot to the controlled component boundary
            throw new TypeError( String( `Nested component slot ${slotName} is invalid.` ) );

        }

        const objectSlotData = /** @type {Record<string, unknown>} */ ( slotData );

        //Creating slot content through the same public runtime contract as direct instances
        slotCollection[slotName] = layerSlotContentCreate(
            /** @type {Record<string, unknown>} */ ( objectSlotData.component ),
            /** @type {Record<string, unknown>} */ ( objectSlotData.scope )
        );

    }

    //CallBack THE OBJECT
    return slotCollection;

}

/**
 * @param {ReturnType<typeof layerComponentDefinitionCreate>} definitionData
 * @param {Record<string, unknown>} invocationOptions
 */
export function layerComponentInvocationCreate( definitionData, invocationOptions = {} ){
    //Checking the component definition before accepting author options
    if ( componentDefinitionSet.has( definitionData ) !== true ){
        //Passing a foreign definition to the nested component boundary
        throw new TypeError( String( 'Nested components require a Layer component definition.' ) );

    }

    //Checking the invocation envelope before classifying props, events, and slots
    if (
        !invocationOptions ||
        typeof invocationOptions !== String( 'object' ) ||
        Array.isArray( invocationOptions ) === true ||
        Number( Object.keys( invocationOptions ).length ) > Number( 150 )
    ){
        //Passing malformed author options to the nested component boundary
        throw new TypeError( String( 'Nested component options are invalid.' ) );

    }

    const componentProperties = Object.create( null );
    const componentSlotValues = Object.create( null );
    const componentEventHandlers = new Map();
    const eventHandlerNames = new Map();

    //Indexing the declared events by their author-facing handler option
    for ( const eventName of definitionData.emits ){
        const eventHandlerName = componentEventHandlerNameCreate( eventName );

        //Checking ambiguous normalized handlers before any instance is created
        if ( eventHandlerNames.has( eventHandlerName ) === true ){
            //Passing an ambiguous event contract to the component definition owner
            throw new TypeError( String( `Component event handler ${eventHandlerName} is ambiguous.` ) );

        }

        eventHandlerNames.set( eventHandlerName, eventName );

    }

    //Classifying every author option against the compiled child definition
    for ( const [optionName, optionValue] of Object.entries( invocationOptions ) ){
        if ( Object.hasOwn( definitionData.props, optionName ) === true ){
            //Recording one declared property without sharing the options object
            componentProperties[optionName] = optionValue;
            continue;

        }

        if ( eventHandlerNames.has( optionName ) === true ){
            //Checking the event callback before exposing it to context.emit
            if ( typeof optionValue !== String( 'function' ) ){
                //Passing the invalid event receiver to the component boundary
                throw new TypeError( String( `Component event handler ${optionName} is invalid.` ) );

            }

            componentEventHandlers.set( eventHandlerNames.get( optionName ), optionValue );
            continue;

        }

        //Checking slot names and values before the compiler-owned plan resolves them
        if (
            publicNamePattern.test( optionName ) !== true ||
            (
                typeof optionValue !== String( 'function' ) &&
                (
                    !optionValue ||
                    typeof optionValue !== String( 'object' ) ||
                    Array.isArray( optionValue ) === true
                )
            )
        ){
            //Passing an unknown scalar option instead of silently creating a prop or slot
            throw new TypeError( String( `Unknown nested component option ${optionName}.` ) );

        }

        componentSlotValues[optionName] = optionValue;

    }

    const immutableProperties = Object.freeze( componentProperties );
    const immutableSlotValues = Object.freeze( componentSlotValues );

    /**
     * @param {Record<string, unknown>} boundaryOptions
     */
    function componentInstanceOptionsCreate( boundaryOptions ){
        const compiledSlots = componentInvocationSlotCollectionCreate(
            /** @type {Record<string, unknown>} */ ( boundaryOptions.slots ?? {} )
        );

        //Creating the low-level instance contract without accepting identity from component props
        return {
            context: boundaryOptions.context,
            diagnostics: boundaryOptions.diagnostics,
            props: immutableProperties,
            slots: compiledSlots,
            /**
             * @param {string} eventName
             * @param {unknown} payloadData
             */
            onEmit( eventName, payloadData ){
                //Getting the optional receiver for this declared child event
                const componentEventHandler = componentEventHandlers.get( eventName );

                if ( componentEventHandler === undefined ){
                    //CallBack THE BOOLEAN
                    return false;

                }

                //Sending the payload only to the parent-owned event callback
                return componentEventHandler( payloadData );

            },
            render: boundaryOptions.render
        };

    }

    //Registering renderer operations behind an opaque invocation descriptor
    return layerComponentInvocationRegister( Object.freeze({
        slotValues: immutableSlotValues,
        mount( rootNode, boundaryOptions ){
            //Creating one child instance inside the renderer-owned fragment
            return layerComponentInstanceMount( definitionData, rootNode, componentInstanceOptionsCreate( boundaryOptions ) );

        },
        hydrate( rootNode, boundaryOptions ){
            //Connecting one child instance to the SSR nodes inside the renderer-owned fragment
            return layerComponentInstanceHydrate( definitionData, rootNode, componentInstanceOptionsCreate( boundaryOptions ) );

        },
        renderToString( boundaryOptions ){
            //Rendering one child instance through the same server component contract
            return layerComponentInstanceRenderToString( definitionData, componentInstanceOptionsCreate( boundaryOptions ) );

        }
    }) );

}



/**
 * @param {Record<string, unknown>} slotSource
 */
function slotCollectionNormalize(slotSource) {
    if (typeof slotSource !== 'object' || slotSource === null || Array.isArray(slotSource) ||
        Object.keys(slotSource).length > 50) {
        throw new TypeError('Component slots are invalid.');

    }

    const slotCollection = Object.create(null);

    //Accepting only content created by the public slot factory.
    for (const [slotName, slotContent] of Object.entries(slotSource)) {
        if (!publicNamePattern.test(slotName) || typeof slotContent !== 'object' || slotContent === null ||
            !slotContentSet.has(slotContent)) {
            throw new TypeError('Component slot entry is invalid.');

        }

        slotCollection[slotName] = slotContent;

    }

    return Object.freeze(slotCollection);

}

/**
 * @param {ReturnType<typeof layerComponentDefinitionCreate>} definitionData
 * @param {Record<string, unknown>} inputProps
 */
function componentPropsResolve(definitionData, inputProps) {
    if (typeof inputProps !== 'object' || inputProps === null || Array.isArray(inputProps)) {
        throw new TypeError('Component props are invalid.');

    }

    for (const propName of Object.keys(inputProps)) {
        if (!Object.hasOwn(definitionData.props, propName)) {
            throw new TypeError(`Unknown component prop ${propName}.`);

        }

    }

    const propValues = Object.create(null);

    //Resolving required values, defaults, and custom validation deterministically.
    for (const [propName, propContract] of Object.entries(definitionData.props)) {
        const typedContract = /** @type {Record<string, any>} */ (propContract);
        let propValue = inputProps[propName];

        if (!Object.hasOwn(inputProps, propName) && typedContract.hasDefault) {
            if (typedContract.defaultCreate !== null) {
                propValue = typedContract.defaultCreate();

            } else {
                propValue = typedContract.defaultValue;

            }

        }

        if (typedContract.required && propValue === undefined) {
            throw new TypeError(`Required component prop ${propName} is missing.`);

        }

        if (typedContract.validate !== null && !typedContract.validate(propValue)) {
            throw new TypeError(`Component prop ${propName} is invalid.`);

        }

        propValues[propName] = propValue;

    }

    return propValues;

}

/**
 * @param {ReturnType<typeof layerComponentDefinitionCreate>} definitionData
 * @param {Record<string, unknown>} instanceOptions
 * @param {'browser' | 'server'} environmentName
 */
function componentInstancePrepare(definitionData, instanceOptions, environmentName) {
    if (!componentDefinitionSet.has(definitionData)) {
        throw new TypeError('Component definition must be created by Layer-Engine.');

    }

    const inputProps = /** @type {Record<string, unknown>} */ (instanceOptions.props ?? {});
    const propValues = componentPropsResolve(definitionData, inputProps);
    const propSignals = Object.create(null);
    const propsView = Object.create(null);

    //Exposing readonly live prop getters backed by field-level signals.
    for (const [propName, propValue] of Object.entries(propValues)) {
        const propSignal = signal(propValue);
        propSignals[propName] = propSignal;
        Object.defineProperty(propsView, propName, {
            enumerable: true,
            get() {
                //Reading the latest parent-provided value without exposing its signal.
                return propSignal.get();

            }
        });

    }

    Object.freeze(propsView);

    const parentContext = /** @type {any} */ (instanceOptions.context ?? layerComponentContextCreate());

    if (!componentContextCheck(parentContext)) {
        throw new TypeError('Component instance context is invalid.');

    }

    const childContext = layerComponentContextCreate({parent: parentContext});
    const childContextState = componentContextState.get(childContext);
    const slots = slotCollectionNormalize(/** @type {Record<string, unknown>} */ (instanceOptions.slots ?? {}));
    const emitSet = new Set(definitionData.emits);
    const onEmit = instanceOptions.onEmit;
    const lifecycleHooks = /** @type {Record<'disposed' | 'hydrated' | 'mounted' | 'updated', Function[]>} */ ({
        disposed: [],
        hydrated: [],
        mounted: [],
        updated: []
    });
    let setupActive = true;

    if (onEmit !== undefined && typeof onEmit !== 'function') {
        throw new TypeError('Component emit receiver is invalid.');

    }

    /** @param {'disposed' | 'hydrated' | 'mounted' | 'updated'} hookName @param {unknown} hookHandler */
    function lifecycleHookRegister(hookName, hookHandler) {
        //Keeping hook registration deterministic and setup-bound.
        if (!setupActive || typeof hookHandler !== 'function') {
            throw new TypeError('Lifecycle hooks must be registered synchronously during setup.');

        }

        lifecycleHooks[hookName].push(hookHandler);

    }

    const setupContext = Object.freeze({
        environment: environmentName,
        props: propsView,
        slots,
        /** @param {string} emitName @param {unknown} payloadData */
        emit(emitName, payloadData) {
            if (!emitSet.has(emitName)) {
                throw new TypeError(`Component emitted undeclared event ${emitName}.`);

            }

            const emitValidator = definitionData.emitValidators[emitName];

            //Checking the declared event payload before it crosses the child boundary.
            if (emitValidator !== null && !emitValidator(payloadData)) {
                throw new TypeError(`Component event ${emitName} payload is invalid.`);

            }

            //Forwarding declared events without creating implicit global dispatch.
            return /** @type {Function | undefined} */ (onEmit)?.(emitName, payloadData);

        },
        /** @param {string} contextKey @param {unknown} contextValue */
        provide(contextKey, contextValue) {
            //Allowing providers to establish immutable context keys during setup only.
            if (!setupActive || childContextState === undefined) {
                throw new TypeError('Context values must be provided synchronously during setup.');

            }

            contextKeyCheck(contextKey);

            if (childContextState.values.has(contextKey)) {
                throw new TypeError(`Component context ${contextKey} is already provided.`);

            }

            childContextState.values.set(contextKey, contextValue);

        },
        /** @param {string} contextKey @param {unknown} [fallbackValue] */
        inject(contextKey, fallbackValue) {
            //Reading the parent-facing context without treating undefined as presence.
            if (parentContext.has(contextKey)) {
                return parentContext.get(contextKey);

            }

            return fallbackValue;

        },
        /** @param {unknown} hookHandler */
        onMounted(hookHandler) {
            //Registering the browser mount boundary explicitly.
            lifecycleHookRegister('mounted', hookHandler);

        },
        /** @param {unknown} hookHandler */
        onHydrated(hookHandler) {
            //Registering the browser hydration boundary explicitly.
            lifecycleHookRegister('hydrated', hookHandler);

        },
        /** @param {unknown} hookHandler */
        onUpdated(hookHandler) {
            //Registering the coalesced reactive update boundary explicitly.
            lifecycleHookRegister('updated', hookHandler);

        },
        /** @param {unknown} hookHandler */
        onDisposed(hookHandler) {
            //Registering deterministic teardown work explicitly.
            lifecycleHookRegister('disposed', hookHandler);

        }
    });
    let setupState = {};

    try {
        let setupResult = /** @type {void | Record<string, unknown>} */ ({});

        //Running an optional trusted setup handler exactly once.
        if (definitionData.setup !== null) {
            setupResult = definitionData.setup(setupContext);

        }

        if (setupResult !== undefined) {
            if (typeof setupResult !== 'object' || setupResult === null || Array.isArray(setupResult) ||
                typeof /** @type {Record<string, unknown>} */ (setupResult).then === 'function') {
                throw new TypeError('Component setup must return a synchronous state record.');

            }

            setupState = setupResult;

        }

    } finally {
        setupActive = false;

    }

    const renderScope = Object.create(null);

    for (const [propName, propSignal] of Object.entries(propSignals)) {
        renderScope[propName] = propSignal;

    }

    //Merging setup state only when it does not shadow props or reserved infrastructure.
    for (const [stateName, stateValue] of Object.entries(setupState)) {
        if (!setupNamePattern.test(stateName) || stateName.startsWith('$') || Object.hasOwn(renderScope, stateName)) {
            throw new TypeError(`Component setup state ${stateName} is invalid or duplicated.`);

        }

        renderScope[stateName] = stateValue;

    }

    renderScope.$props = propsView;
    renderScope.$slots = slots;
    renderScope.$context = childContext;

    return {
        childContext,
        lifecycleHooks,
        propSignals,
        propsView,
        renderScope,
        slots
    };

}

/**
 * @param {Function[]} hookList
 * @param {unknown} hookData
 */
function lifecycleHooksRun(hookList, hookData) {
    //Running a stable snapshot so hooks cannot change the active iteration.
    for (const hookHandler of [...hookList]) {
        hookHandler(hookData);

    }

}

/**
 * @param {ReturnType<typeof layerComponentDefinitionCreate>} definitionData
 * @param {Element | DocumentFragment} rootNode
 * @param {Record<string, unknown>} instanceOptions
 * @param {boolean} hydrateStatus
 */
function componentInstanceMount(definitionData, rootNode, instanceOptions = {}, hydrateStatus) {
    const preparedData = componentInstancePrepare(definitionData, instanceOptions, 'browser');
    const externalDiagnostics = /** @type {any} */ (
        instanceOptions.diagnostics ?? layerRenderDiagnosticsCreate()
    );
    let lifecycleActive = false;
    let disposedStatus = false;
    let updatedScheduled = false;
    let updatedPromise = Promise.resolve();

    if (typeof externalDiagnostics !== 'object' || externalDiagnostics === null ||
        typeof /** @type {Record<string, unknown>} */ (externalDiagnostics).mutationRecord !== 'function') {
        throw new TypeError('Component diagnostics are invalid.');

    }

    function updatedSchedule() {
        if (!lifecycleActive || disposedStatus || updatedScheduled) {
            return;

        }

        updatedScheduled = true;
        updatedPromise = Promise.resolve().then(async function updatedCommitWait() {
            //Waiting until all binding phases settle before notifying lifecycle observers.
            await layerCommitWait();
            updatedScheduled = false;

            if (!disposedStatus) {
                lifecycleHooksRun(preparedData.lifecycleHooks.updated, controllerData);

            }

        });

    }

    const diagnostics = Object.freeze({
        /** @param {string} mutationType @param {string | null} bindingId @param {string | null} nodeId */
        mutationRecord(mutationType, bindingId = null, nodeId = null) {
            //Forwarding counters while using mutations as the component update boundary.
            externalDiagnostics.mutationRecord(mutationType, bindingId, nodeId);
            updatedSchedule();

        },
        /** @param {string | null} bindingId @param {string | null} nodeId */
        mismatchRecord(bindingId = null, nodeId = null) {
            //Forwarding hydration mismatches without creating an update event.
            externalDiagnostics.mismatchRecord(bindingId, nodeId);

        },
        snapshot() {
            //Returning an immutable diagnostics view from the underlying renderer.
            return externalDiagnostics.snapshot();

        },
        reset() {
            //Resetting counters through the renderer-owned diagnostics instance.
            return externalDiagnostics.reset();

        }
    });
    let renderController;

    //Reusing SSR nodes when hydration was explicitly requested.
    if (hydrateStatus) {
        renderController = layerComponentHydrate(
            /** @type {any} */ (definitionData.component),
            rootNode,
            preparedData.renderScope,
            {diagnostics}
        );

    } else {
        //Creating a fresh component boundary for ordinary client mounting.
        renderController = layerComponentMount(
            /** @type {any} */ (definitionData.component),
            rootNode,
            preparedData.renderScope,
            {diagnostics}
        );

    }
    const controllerData = {
        context: preparedData.childContext,
        diagnostics,
        props: preparedData.propsView,
        recovered: renderController.recovered,
        refs: renderController.refs,
        regions: renderController.regions,
        slots: preparedData.slots,
        /** @param {Record<string, unknown>} nextProps */
        async update(nextProps) {
            if (disposedStatus) {
                throw new TypeError('A disposed component cannot be updated.');

            }

            const nextValues = componentPropsResolve(definitionData, {
                ...Object.fromEntries(Object.entries(preparedData.propsView)),
                ...nextProps
            });

            //Updating only changed prop signals before one renderer commit.
            for (const [propName, propValue] of Object.entries(nextValues)) {
                preparedData.propSignals[propName].set(propValue);

            }

            await layerCommitWait();
            await updatedPromise;

        },
        async settled() {
            //Waiting for both reactive bindings and the coalesced updated hook.
            await layerCommitWait();
            await updatedPromise;

        },
        dispose() {
            //Making teardown idempotent for router and parent-component cleanup.
            if (disposedStatus) {
                return;

            }

            disposedStatus = true;
            renderController.dispose();
            lifecycleHooksRun(preparedData.lifecycleHooks.disposed, controllerData);

        }
    };

    const publicController = Object.freeze(controllerData);

    lifecycleActive = true;

    try {
        //Selecting the single browser entry lifecycle matching the render mode.
        if (hydrateStatus) {
            lifecycleHooksRun(preparedData.lifecycleHooks.hydrated, publicController);

        } else {
            lifecycleHooksRun(preparedData.lifecycleHooks.mounted, publicController);

        }

    } catch( lifecycleErrorData ){
        disposedStatus = true;

        try {
            //Rolling back bindings, DOM ownership, and component resources after a failed lifecycle hook.
            renderController.dispose();
            lifecycleHooksRun(preparedData.lifecycleHooks.disposed, publicController);

        } catch( lifecycleCleanupErrorData ){
            //Preserving the primary lifecycle failure after best-effort cleanup.
            void lifecycleCleanupErrorData;

        }

        //Passing the original lifecycle error to the router or parent boundary.
        throw lifecycleErrorData;

    }

    return publicController;

}

/**
 * @param {ReturnType<typeof layerComponentDefinitionCreate>} definitionData
 * @param {Element | DocumentFragment} rootNode
 * @param {Record<string, unknown>} [instanceOptions]
 */
export function layerComponentInstanceMount(definitionData, rootNode, instanceOptions = {}) {
    //Delegating to the fresh-DOM component entry path.
    return componentInstanceMount(definitionData, rootNode, instanceOptions, false);

}

/**
 * @param {ReturnType<typeof layerComponentDefinitionCreate>} definitionData
 * @param {Element | DocumentFragment} rootNode
 * @param {Record<string, unknown>} [instanceOptions]
 */
export function layerComponentInstanceHydrate(definitionData, rootNode, instanceOptions = {}) {
    //Delegating to the SSR-reuse component entry path.
    return componentInstanceMount(definitionData, rootNode, instanceOptions, true);

}

/**
 * @param {ReturnType<typeof layerComponentDefinitionCreate>} definitionData
 * @param {Record<string, unknown>} [instanceOptions]
 */
export function layerComponentInstanceRenderToString(definitionData, instanceOptions = {}) {
    const preparedData = componentInstancePrepare(definitionData, instanceOptions, 'server');

    //Rendering setup state and slots through the same compiler plan as the browser.
    return layerComponentRenderToString(
        /** @type {any} */ (definitionData.component),
        preparedData.renderScope,
        /** @type {Record<string, unknown>} */ (instanceOptions.render ?? {})
    );

}
