/**
 * @param {unknown} valueData
 */
function objectRecordCheck( valueData ){
    //Checking the metadata value before reading its schema fields
    return valueData !== null && typeof valueData === String( 'object' ) && Array.isArray( valueData ) === false;

}

/**
 * @param {string} nameData
 */
function propertyNameSourceCreate( nameData ){
    //Serializing every public name so punctuation cannot change the declaration syntax
    return JSON.stringify( String( nameData ) );

}


/**
 * @param {readonly string[]} optionNames
 */
function optionNameUnionSourceCreate( optionNames ){
    let optionNameUnionSource = String( 'never' );

    //Creating a Pick key union only when the contract owns matching fields
    if ( Number( optionNames.length ) > Number( 0 ) ){
        optionNameUnionSource = optionNames.map(function( optionName ){
            //Serializing each field through the same safe property-name contract
            return propertyNameSourceCreate( optionName );

        }).join( String( ' | ' ) );

    }

    //CallBack THE STRING
    return optionNameUnionSource;

}

/**
 * @param {string} eventName
 */
function eventHandlerNameCreate( eventName ){
    //Splitting the runtime event name through the same public separator contract
    const eventNameParts = eventName.split( /[^A-Za-z0-9]+/ ).filter(function( eventNamePart ){
        //Keeping only meaningful event segments
        return Number( eventNamePart.length ) > Number( 0 );

    });
    let eventHandlerName = String( 'on' );

    //Creating the author-facing onEvent callback name
    for ( const eventNamePart of eventNameParts ){
        eventHandlerName += eventNamePart.charAt( 0 ).toUpperCase() + eventNamePart.slice( 1 );

    }

    //CallBack THE STRING
    return eventHandlerName;

}

/**
 * @param {unknown} schemaData
 * @param {number} [depthData]
 * @returns {string}
 */
function schemaTypeSourceCreate( schemaData, depthData = Number( 0 ) ){
    //Limiting recursive metadata before producing a declaration
    if ( Number( depthData ) > Number( 20 ) ){
        //CallBack THE STRING
        return String( 'unknown' );

    }

    //Converting the compact Layer scalar schema into TypeScript syntax
    if ( typeof schemaData === 'string' ){
        const scalarTypeMap = /** @type {Readonly<Record<string, string>>} */ ( Object.freeze({
            array: 'readonly unknown[]',
            bigint: 'bigint',
            boolean: 'boolean',
            function: '(...argumentsData: readonly unknown[]) => unknown',
            integer: 'number',
            null: 'null',
            number: 'number',
            object: 'Readonly<Record<string, unknown>>',
            string: 'string',
            symbol: 'symbol',
            undefined: 'undefined'
        }) );

        if ( Object.hasOwn( scalarTypeMap, schemaData ) === true ){
            //CallBack THE STRING
            return /** @type {string} */ ( scalarTypeMap[schemaData] );

        }

        //CallBack THE STRING
        return String( 'unknown' );

    }

    //Checking whether the schema contains a nested object contract
    if ( objectRecordCheck( schemaData ) === false ){
        //CallBack THE STRING
        return String( 'unknown' );

    }

    const schemaRecord = /** @type {Record<string, unknown>} */ ( schemaData );

    //Using the explicit schema type before treating fields as an object contract
    if ( typeof schemaRecord.type === 'string' ){
        //CallBack THE STRING
        return schemaTypeSourceCreate( schemaRecord.type, Number( depthData ) + Number( 1 ) );

    }

    const schemaEntries = Object.entries( schemaRecord ).sort(function( firstEntry, secondEntry ){
        //Keeping field order deterministic across metadata producers
        return firstEntry[0].localeCompare( secondEntry[0] );

    });

    if ( Number( schemaEntries.length ) === Number( 0 ) ){
        //CallBack THE STRING
        return String( 'Readonly<Record<string, never>>' );

    }

    /** @type {string[]} */
    const fieldSources = schemaEntries.map(function( schemaEntry ){
        const fieldName = schemaEntry[0];
        const fieldSchema = schemaEntry[1];

        //Creating one readonly event payload field
        return `readonly ${propertyNameSourceCreate( fieldName )}: ${schemaTypeSourceCreate(
            fieldSchema,
            Number( depthData ) + Number( 1 )
        )};`;

    });

    //CallBack THE STRING
    return `Readonly<{ ${fieldSources.join( ' ' )} }>`;

}

/**
 * @param {readonly unknown[]} renderPlanList
 * @param {Set<string>} slotNameSet
 */
function renderPlanSlotsCollect( renderPlanList, slotNameSet ){
    //Walking every compiler-owned plan without evaluating component expressions
    for ( const renderPlanData of renderPlanList ){
        if ( objectRecordCheck( renderPlanData ) === false ){
            continue;

        }

        const renderPlanRecord = /** @type {Record<string, unknown>} */ ( renderPlanData );

        //Recording the declared slot outlet
        if ( renderPlanRecord.kind === String( 'slot' ) && typeof renderPlanRecord.name === 'string' ){
            slotNameSet.add( renderPlanRecord.name );

        }

        //Walking ordinary element children
        if ( Array.isArray( renderPlanRecord.children ) === true ){
            renderPlanSlotsCollect( renderPlanRecord.children, slotNameSet );

        }

        //Walking structural fallback and branch plans
        if ( Array.isArray( renderPlanRecord.fallback ) === true ){
            renderPlanSlotsCollect( renderPlanRecord.fallback, slotNameSet );

        }

        if ( objectRecordCheck( renderPlanRecord.template ) === true ){
            renderPlanSlotsCollect( [renderPlanRecord.template], slotNameSet );

        }

    }

}


/**
 * @param {Readonly<Record<string, unknown>>} componentData
 */
export function layerComponentDeclarationCreate( componentData ){
    //Checking the canonical compiler output before reading author metadata
    if ( componentData.format !== String( 'layer.js' ) ){
        //CallBack THE STRING
        return null;

    }

    const moduleData = /** @type {Record<string, unknown>} */ ( componentData.module );
    let metadataData = /** @type {Record<string, unknown>} */ ( {} );
    let propertyData = /** @type {Record<string, unknown>} */ ( {} );
    let eventData = /** @type {Record<string, unknown>} */ ( {} );

    //Getting static component metadata when the compiler provided its record
    if ( objectRecordCheck( moduleData?.metadata ) === true ){
        metadataData = /** @type {Record<string, unknown>} */ ( moduleData.metadata );

    }

    //Getting declared property contracts without sharing mutable author data
    if ( objectRecordCheck( metadataData.properties ) === true ){
        propertyData = /** @type {Record<string, unknown>} */ ( metadataData.properties );

    }

    //Getting declared event payload contracts
    if ( objectRecordCheck( metadataData.events ) === true ){
        eventData = /** @type {Record<string, unknown>} */ ( metadataData.events );

    }

    const slotNameSet = new Set();
    const optionNameSet = new Set();
    const propertySources = Array();
    const eventSources = Array();
    const slotSources = Array();
    const propertyOptionNames = Array();
    const eventOptionNames = Array();
    const slotOptionNames = Array();
    let requiredPropertyStatus = false;

    //Collecting slots from the same static render plan used by CSR and SSR
    if ( Array.isArray( componentData.template ) === true ){
        renderPlanSlotsCollect( componentData.template, slotNameSet );

    }

    //Creating prop fields and remembering whether invocation options are mandatory
    for ( const [propertyName, propertyContractData] of Object.entries( propertyData ).sort(function( firstEntry, secondEntry ){
        //Keeping public prop declarations stable
        return firstEntry[0].localeCompare( secondEntry[0] );

    }) ){
        let propertyContract = /** @type {Record<string, unknown>} */ ( {} );

        //Getting the property schema when the static contract is an object
        if ( objectRecordCheck( propertyContractData ) === true ){
            propertyContract = /** @type {Record<string, unknown>} */ ( propertyContractData );

        }

        const defaultStatus = Object.hasOwn( propertyContract, String( 'default' ) );
        const requiredStatus = propertyContract.required === true && defaultStatus === false;
        let optionalSource = String( '?' );

        //Marking a prop as required only when runtime cannot create its default
        if ( requiredStatus === true ){
            optionalSource = String();
            requiredPropertyStatus = true;

        }

        optionNameSet.add( propertyName );
        propertyOptionNames.push( propertyName );
        propertySources.push(
            `    readonly ${propertyNameSourceCreate( propertyName )}${optionalSource}: ${schemaTypeSourceCreate( propertyContract.type )};`
        );

    }

    //Creating optional onEvent callbacks from declared payload schemas
    for ( const [eventName, eventSchemaData] of Object.entries( eventData ).sort(function( firstEntry, secondEntry ){
        //Keeping public event declarations stable
        return firstEntry[0].localeCompare( secondEntry[0] );

    }) ){
        const eventHandlerName = eventHandlerNameCreate( eventName );

        //Skipping a callback name already owned by a prop exactly as runtime does
        if ( optionNameSet.has( eventHandlerName ) === true ){
            continue;

        }

        optionNameSet.add( eventHandlerName );
        eventOptionNames.push( eventHandlerName );
        eventSources.push(
            `    readonly ${propertyNameSourceCreate( eventHandlerName )}?: (eventData: ${schemaTypeSourceCreate( eventSchemaData )}) => unknown;`
        );

    }

    //Creating optional named slot fields without shadowing props or callbacks
    for ( const slotName of [...slotNameSet].sort(function( firstName, secondName ){
        //Keeping declared slots deterministic
        return firstName.localeCompare( secondName );

    }) ){
        if ( optionNameSet.has( slotName ) === true ){
            continue;

        }

        optionNameSet.add( slotName );
        slotOptionNames.push( slotName );
        slotSources.push(
            `    readonly ${propertyNameSourceCreate( slotName )}?: LayerComponentSlot;`
        );

    }

    const optionSources = [
        ...propertySources,
        ...eventSources,
        ...slotSources
    ];
    let optionBodySource = String( '    readonly [optionName: string]: never;' );

    //Using only known public fields when the component has a contract
    if ( Number( optionSources.length ) > Number( 0 ) ){
        optionBodySource = optionSources.join( String( '\n' ) );

    }

    let invocationArgumentSource = String( 'options?: LayerComponentOptions' );
    let instanceArgumentSource = String( 'instanceOptions?: LayerComponentInstanceOptions' );

    //Requiring input when at least one prop has no default
    if ( requiredPropertyStatus === true ){
        invocationArgumentSource = String( 'options: LayerComponentOptions' );
        instanceArgumentSource = String( 'instanceOptions: LayerComponentInstanceOptions' );

    }

    const declarationSource = [
        '/** Opaque HTML content returned by the Layer html tag. */',
        'export type LayerComponentContent = Readonly<{',
        '    strings: readonly string[];',
        '    values: readonly unknown[];',
        '}>;',
        '',
        '/** Named slot content, provided directly or through a lazy renderer. */',
        'export type LayerComponentSlot = LayerComponentContent | (() => LayerComponentContent);',
        '',
        'declare const layerComponentInvocationBrand: unique symbol;',
        '',
        'export type LayerComponentInvocation = Readonly<{',
        '    [layerComponentInvocationBrand]: true;',
        '}>;',
        '',
        '/** Props, onEvent callbacks, and named slots accepted by this compiled component. */',
        'export interface LayerComponentOptions {',
        optionBodySource,
        '}',
        '',
        `export type LayerComponentProperties = Pick<LayerComponentOptions, ${optionNameUnionSourceCreate( propertyOptionNames )}>;`,
        '',
        `export type LayerComponentEventHandlers = Pick<LayerComponentOptions, ${optionNameUnionSourceCreate( eventOptionNames )}>;`,
        '',
        `export type LayerComponentSlots = Pick<LayerComponentOptions, ${optionNameUnionSourceCreate( slotOptionNames )}>;`,
        '',
        '/** Low-level mount, hydrate, and SSR options. Normal application composition uses the default component function. */',
        'export interface LayerComponentInstanceOptions {',
        '    /** Explicit infrastructure context for an isolated/manual component host. */',
        '    readonly context?: Readonly<Record<string, unknown>>;',
        '    /** Optional bounded diagnostics sink owned by the host runtime. */',
        '    readonly diagnostics?: unknown;',
        '    /** Initial component properties validated against the generated contract. */',
        '    readonly props?: LayerComponentProperties;',
        '    /** Renderer integration options reserved for a trusted Layer host. */',
        '    readonly render?: Readonly<Record<string, unknown>>;',
        '    /** Named slot templates keyed by the generated slot contract. */',
        '    readonly slots?: LayerComponentSlots;',
        '}',
        '',
        '/** Lifecycle controller returned by manual mount and hydration. */',
        'export interface LayerComponentController {',
        '    /** True when the renderer recovered from a bounded hydration mismatch. */',
        '    readonly recovered: boolean;',
        '    /** Unmounts the component, effects, listeners, and owned DOM bindings. */',
        '    dispose(): void;',
        '    /** Waits until scheduled rendering and lifecycle work becomes idle. */',
        '    settled(): Promise<void>;',
        '    /** Applies a validated partial property update without remounting the component. */',
        '    update(nextProperties: Partial<LayerComponentProperties>): Promise<void>;',
        '}',
        '',
        '/** Creates a compiler-owned component invocation for use inside html interpolation. */',
        `declare function componentInvoke(${invocationArgumentSource}): LayerComponentInvocation;`,
        '',
        'export default componentInvoke;',
        '',
        'export declare const component: Readonly<Record<string, unknown>>;',
        'export declare const css: string;',
        'export declare const definition: Readonly<Record<string, unknown>>;',
        'export declare const events: Readonly<Record<string, unknown>>;',
        'export declare const properties: Readonly<Record<string, unknown>>;',
        'export declare const styles: string;',
        '',
        '/** Mounts a fresh client component into an empty/owned root node. */',
        `export declare function mount(rootNode: Element | DocumentFragment, ${instanceArgumentSource}): LayerComponentController;`,
        '/** Attaches bindings to matching SSR markup and reports controlled recovery through the controller. */',
        `export declare function hydrate(rootNode: Element | DocumentFragment, ${instanceArgumentSource}): LayerComponentController;`,
        '/** Produces escaped server HTML and renderer metadata without browser DOM APIs. */',
        `export declare function renderToString(${instanceArgumentSource}): Readonly<{html: string; [resultName: string]: unknown}>;`,
        ''
    ].join( String( '\n' ) );

    //CallBack THE STRING
    return declarationSource;

}
